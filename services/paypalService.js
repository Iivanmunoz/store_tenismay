const axios = require('axios');

class PayPalService {
  constructor() {
    // URLs para sandbox y producción
    this.baseURL = process.env.NODE_ENV === 'production' 
      ? 'https://api.paypal.com' 
      : 'https://api.sandbox.paypal.com';
    
    this.clientId = process.env.PAYPAL_CLIENT_ID;
    this.clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    
    // Cache para el token de acceso
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Genera un token de acceso OAuth2
   */
  async generateAccessToken() {
    try {
      // Si ya tenemos un token válido, lo retornamos
      if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        return this.accessToken;
      }

      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      
      const response = await axios({
        url: `${this.baseURL}/v1/oauth2/token`,
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'Es-MX',
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: 'grant_type=client_credentials'
      });

      const data = response.data;
      this.accessToken = data.access_token;
      // Guardamos el tiempo de expiración (restamos 60 segundos para estar seguros)
      this.tokenExpiry = Date.now() + ((data.expires_in - 60) * 1000);
      
      return this.accessToken;
    } catch (error) {
      console.error('Error generando token de acceso:', error.response?.data || error.message);
      throw new Error('No se pudo generar el token de acceso de PayPal');
    }
  }

  /**
   * Crea una orden de pago en PayPal
   */
  async createOrder(orderData) {
    try {
      const accessToken = await this.generateAccessToken();

      // Estructura de la orden según la documentación de PayPal v2
      const order = {
        intent: 'CAPTURE', // CAPTURE para capturar inmediatamente
        purchase_units: [{
          reference_id: orderData.reference_id || 'default',
          amount: {
            currency_code: orderData.currency || 'MXN',
            value: orderData.amount.toString(),
            breakdown: orderData.breakdown || {}
          },
          description: orderData.description || 'Compra en TENIS2_SHOP',
          custom_id: orderData.custom_id || null,
          invoice_id: orderData.invoice_id || null,
          items: orderData.items || [],
          shipping: orderData.shipping || null
        }],
        application_context: {
          brand_name: orderData.brand_name || 'TENIS2_SHOP',
          landing_page: 'BILLING', // NO_PREFERENCE, LOGIN, BILLING, GUEST_CHECKOUT
          shipping_preference: 'SET_PROVIDED_ADDRESS', // GET_FROM_FILE, NO_SHIPPING, SET_PROVIDED_ADDRESS
          user_action: 'PAY_NOW', // CONTINUE, PAY_NOW
          return_url: orderData.return_url || `${process.env.BASE_URL}/api/paypal/success`,
          cancel_url: orderData.cancel_url || `${process.env.BASE_URL}/api/paypal/cancel`
        }
      };

      const response = await axios({
        url: `${this.baseURL}/v2/checkout/orders`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'PayPal-Request-Id': this.generateRequestId(), // Para idempotencia
          'Prefer': 'return=representation'
        },
        data: order
      });

      return {
        success: true,
        order: response.data,
        approvalUrl: response.data.links.find(link => link.rel === 'approve')?.href
      };

    } catch (error) {
      console.error('Error creando orden:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Obtiene los detalles de una orden
   */
  async getOrder(orderId) {
    try {
      const accessToken = await this.generateAccessToken();

      const response = await axios({
        url: `${this.baseURL}/v2/checkout/orders/${orderId}`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        }
      });

      return {
        success: true,
        order: response.data
      };

    } catch (error) {
      console.error('Error obteniendo orden:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Captura el pago de una orden aprobada
   */
  async captureOrder(orderId, paymentSource = null) {
    try {
      const accessToken = await this.generateAccessToken();

      const captureData = {};
      
      // Si se proporciona payment_source (para pagos directos)
      if (paymentSource) {
        captureData.payment_source = paymentSource;
      }

      const response = await axios({
        url: `${this.baseURL}/v2/checkout/orders/${orderId}/capture`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'PayPal-Request-Id': this.generateRequestId(),
          'Prefer': 'return=representation'
        },
        data: captureData
      });

      return {
        success: true,
        capture: response.data,
        captureId: response.data.purchase_units[0]?.payments?.captures?.[0]?.id,
        status: response.data.status
      };

    } catch (error) {
      console.error('Error capturando orden:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Autoriza una orden (para captura posterior)
   */
  async authorizeOrder(orderId, paymentSource = null) {
    try {
      const accessToken = await this.generateAccessToken();

      const authData = {};
      if (paymentSource) {
        authData.payment_source = paymentSource;
      }

      const response = await axios({
        url: `${this.baseURL}/v2/checkout/orders/${orderId}/authorize`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'PayPal-Request-Id': this.generateRequestId(),
          'Prefer': 'return=representation'
        },
        data: authData
      });

      return {
        success: true,
        authorization: response.data,
        authorizationId: response.data.purchase_units[0]?.payments?.authorizations?.[0]?.id,
        status: response.data.status
      };

    } catch (error) {
      console.error('Error autorizando orden:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Actualiza una orden existente
   */
  async updateOrder(orderId, updateData) {
    try {
      const accessToken = await this.generateAccessToken();

      const response = await axios({
        url: `${this.baseURL}/v2/checkout/orders/${orderId}`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        data: updateData
      });

      return {
        success: true,
        status: response.status
      };

    } catch (error) {
      console.error('Error actualizando orden:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Procesa un webhook de PayPal
   */
  async verifyWebhook(webhookEvent, webhookId, certId, authAlgo, transmissionId, transmissionTime, webhookSignature) {
    try {
      const accessToken = await this.generateAccessToken();

      const verificationData = {
        auth_algo: authAlgo,
        cert_id: certId,
        transmission_id: transmissionId,
        transmission_sig: webhookSignature,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: webhookEvent
      };

      const response = await axios({
        url: `${this.baseURL}/v1/notifications/verify-webhook-signature`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        data: verificationData
      });

      return {
        success: true,
        verified: response.data.verification_status === 'SUCCESS'
      };

    } catch (error) {
      console.error('Error verificando webhook:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Genera un ID de request único para idempotencia
   */
  generateRequestId() {
    return Date.now().toString() + Math.random().toString(36).substring(2, 15);
  }

  /**
   * Validar configuración de PayPal
   */
  validateConfig() {
    if (!this.clientId) {
      throw new Error('PAYPAL_CLIENT_ID no está configurado');
    }
    if (!this.clientSecret) {
      throw new Error('PAYPAL_CLIENT_SECRET no está configurado');
    }
  }

  /**
   * Método de utilidad para formatear montos
   */
  static formatAmount(amount, currency = 'USD') {
    const formattedAmount = parseFloat(amount).toFixed(2);
    return {
      currency_code: currency,
      value: formattedAmount
    };
  }
}

module.exports = PayPalService;