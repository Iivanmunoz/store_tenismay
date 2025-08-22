const PayPalService = require('./paypalService');

class PayPalController {
  constructor() {
    this.paypalService = new PayPalService();
  }

  /**
   * Crear una nueva orden de pago
   * POST /api/paypal/create-order
   */
  async createOrder(req, res) {
    try {
      // Validar que el servicio esté configurado
      this.paypalService.validateConfig();

      const { amount, currency, items, shipping, description, custom_id } = req.body;

      // Validaciones básicas
      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'El monto debe ser mayor a 0'
        });
      }

      // Preparar los datos de la orden
      const orderData = {
        amount: parseFloat(amount),
        currency: currency || 'USD',
        description: description || 'Compra en TENIS2_SHOP',
        custom_id: custom_id,
        reference_id: `order_${Date.now()}`,
        items: items || [],
        shipping: shipping,
        return_url: `${req.protocol}://${req.get('host')}/api/paypal/success`,
        cancel_url: `${req.protocol}://${req.get('host')}/api/paypal/cancel`
      };

      // Si se proporcionan items, calcular el breakdown
      if (items && items.length > 0) {
        let itemTotal = 0;
        let taxTotal = 0;
        let shippingTotal = 0;

        items.forEach(item => {
          itemTotal += parseFloat(item.unit_amount?.value || 0) * parseInt(item.quantity || 1);
        });

        if (shipping?.amount) {
          shippingTotal = parseFloat(shipping.amount.value);
        }

        // El tax se puede calcular o venir en los items
        // Por simplificar, asumimos que no hay tax separado
        
        orderData.breakdown = {
          item_total: PayPalService.formatAmount(itemTotal, currency),
          shipping: shippingTotal > 0 ? PayPalService.formatAmount(shippingTotal, currency) : undefined,
          tax_total: taxTotal > 0 ? PayPalService.formatAmount(taxTotal, currency) : undefined
        };
      }

      // Crear la orden en PayPal
      const result = await this.paypalService.createOrder(orderData);

      if (result.success) {
        // Guardar el ID de la orden en la base de datos si es necesario
        // await this.saveOrderToDatabase(result.order);

        res.json({
          success: true,
          orderId: result.order.id,
          approvalUrl: result.approvalUrl,
          order: result.order
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Error creando la orden en PayPal',
          error: result.error
        });
      }

    } catch (error) {
      console.error('Error en createOrder:', error);
      res.status(500).json({
        success: false,
        message: 'Error interno del servidor',
        error: error.message
      });
    }
  }

  /**
   * Capturar el pago de una orden
   * POST /api/paypal/capture-order/:orderId
   */
  async captureOrder(req, res) {
    try {
      const { orderId } = req.params;

      if (!orderId) {
        return res.status(400).json({
          success: false,
          message: 'ID de orden requerido'
        });
      }

      // Primero obtener los detalles de la orden
      const orderDetails = await this.paypalService.getOrder(orderId);
      
      if (!orderDetails.success) {
        return res.status(404).json({
          success: false,
          message: 'Orden no encontrada',
          error: orderDetails.error
        });
      }

      // Verificar que la orden esté en estado APPROVED
      if (orderDetails.order.status !== 'APPROVED') {
        return res.status(400).json({
          success: false,
          message: `La orden no puede ser capturada. Estado actual: ${orderDetails.order.status}`
        });
      }

      // Capturar el pago
      const captureResult = await this.paypalService.captureOrder(orderId);

      if (captureResult.success) {
        // Actualizar la base de datos con el resultado del pago
        // await this.updateOrderInDatabase(orderId, captureResult);

        res.json({
          success: true,
          captureId: captureResult.captureId,
          status: captureResult.status,
          capture: captureResult.capture
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Error capturando el pago',
          error: captureResult.error
        });
      }

    } catch (error) {
      console.error('Error en captureOrder:', error);
      res.status(500).json({
        success: false,
        message: 'Error interno del servidor',
        error: error.message
      });
    }
  }

  /**
   * Obtener detalles de una orden
   * GET /api/paypal/order/:orderId
   */
  async getOrder(req, res) {
    try {
      const { orderId } = req.params;

      const result = await this.paypalService.getOrder(orderId);

      if (result.success) {
        res.json({
          success: true,
          order: result.order
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'Orden no encontrada',
          error: result.error
        });
      }

    } catch (error) {
      console.error('Error en getOrder:', error);
      res.status(500).json({
        success: false,
        message: 'Error interno del servidor',
        error: error.message
      });
    }
  }

  /**
   * Manejar el retorno exitoso de PayPal
   * GET /api/paypal/success?token=ORDER_ID&PayerID=PAYER_ID
   */
  async handleSuccess(req, res) {
    try {
      const { token: orderId, PayerID } = req.query;

      if (!orderId) {
        return res.redirect('/payment-error?message=orden-no-encontrada');
      }

      // Automáticamente capturar el pago
      const captureResult = await this.paypalService.captureOrder(orderId);

      if (captureResult.success) {
        // Redirigir a página de éxito con información del pago
        res.redirect(`/payment-success?orderId=${orderId}&captureId=${captureResult.captureId}`);
      } else {
        res.redirect('/payment-error?message=error-capturando-pago');
      }

    } catch (error) {
      console.error('Error en handleSuccess:', error);
      res.redirect('/payment-error?message=error-interno');
    }
  }

  /**
   * Manejar la cancelación del pago
   * GET /api/paypal/cancel?token=ORDER_ID
   */
  async handleCancel(req, res) {
    try {
      const { token: orderId } = req.query;
      
      // Opcional: actualizar el estado de la orden en la base de datos
      // await this.markOrderAsCancelled(orderId);

      res.redirect('/payment-cancelled');

    } catch (error) {
      console.error('Error en handleCancel:', error);
      res.redirect('/payment-error?message=error-cancelacion');
    }
  }

  /**
   * Webhook para notificaciones de PayPal
   * POST /api/paypal/webhook
   */
  async handleWebhook(req, res) {
    try {
      const webhookEvent = req.body;
      const headers = req.headers;

      // Extraer headers de verificación
      const webhookId = process.env.PAYPAL_WEBHOOK_ID;
      const certId = headers['paypal-cert-id'];
      const authAlgo = headers['paypal-auth-algo'];
      const transmissionId = headers['paypal-transmission-id'];
      const transmissionSig = headers['paypal-transmission-sig'];
      const transmissionTime = headers['paypal-transmission-time'];

      // Verificar la autenticidad del webhook
      const verification = await this.paypalService.verifyWebhook(
        webhookEvent,
        webhookId,
        certId,
        authAlgo,
        transmissionId,
        transmissionTime,
        transmissionSig
      );

      if (!verification.success || !verification.verified) {
        return res.status(400).json({
          success: false,
          message: 'Webhook no verificado'
        });
      }

      // Procesar el evento
      await this.processWebhookEvent(webhookEvent);

      res.status(200).json({ success: true });

    } catch (error) {
      console.error('Error en handleWebhook:', error);
      res.status(500).json({
        success: false,
        message: 'Error procesando webhook'
      });
    }
  }

  /**
   * Procesar eventos de webhook
   */
  async processWebhookEvent(event) {
    console.log(`Procesando evento: ${event.event_type}`);
    
    switch (event.event_type) {
      case 'CHECKOUT.ORDER.APPROVED':
        console.log('Orden aprobada:', event.resource.id);
        // Procesar orden aprobada
        break;
        
      case 'PAYMENT.CAPTURE.COMPLETED':
        console.log('Pago capturado:', event.resource.id);
        // Actualizar estado del pedido en la base de datos
        break;
        
      case 'PAYMENT.CAPTURE.DENIED':
        console.log('Pago denegado:', event.resource.id);
        // Manejar pago denegado
        break;
        
      default:
        console.log('Evento no manejado:', event.event_type);
    }
  }

  /**
   * Generar token de cliente para frontend (opcional)
   * GET /api/paypal/client-token
   */
  async getClientToken(req, res) {
    try {
      res.json({
        success: true,
        clientId: process.env.PAYPAL_CLIENT_ID,
        environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error obteniendo configuración del cliente'
      });
    }
  }
}

module.exports = PayPalController;