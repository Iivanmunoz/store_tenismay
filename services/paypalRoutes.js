const express = require('express');
const PayPalController = require('./paypalController');

const router = express.Router();
const paypalController = new PayPalController();

// Middleware para logging
router.use((req, res, next) => {
  console.log(`PayPal API - ${req.method} ${req.originalUrl}`);
  next();
});

// Crear una nueva orden
router.post('/create-order', async (req, res) => {
  await paypalController.createOrder(req, res);
});

// Capturar el pago de una orden
router.post('/capture-order/:orderId', async (req, res) => {
  await paypalController.captureOrder(req, res);
});

// Obtener detalles de una orden
router.get('/order/:orderId', async (req, res) => {
  await paypalController.getOrder(req, res);
});

// Manejo de retorno exitoso desde PayPal
router.get('/success', async (req, res) => {
  await paypalController.handleSuccess(req, res);
});

// Manejo de cancelación de pago
router.get('/cancel', async (req, res) => {
  await paypalController.handleCancel(req, res);
});

// Webhook de PayPal
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  await paypalController.handleWebhook(req, res);
});

// Obtener configuración del cliente para frontend
router.get('/client-config', async (req, res) => {
  await paypalController.getClientToken(req, res);
});

module.exports = router;