// server.js
require('dotenv').config();
// -----------------------------------------------------------------------------
// | Requerimientos e Inicialización del Servidor                              |
// -----------------------------------------------------------------------------
const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const paypal = require('@paypal/checkout-server-sdk');
const crypto = require('crypto');




// -----------------------------------------------------------------------------
// | Requerimientos e Inicialización del servidor de correos                    |
// -----------------------------------------------------------------------------
const { verifyConnection } = require('./services/emailService');
const { sendPasswordResetEmail } = require('./services/emailService');

const app = express();
app.use(express.static('public'));
const PORT = process.env.PORT || 3000;

// -----------------------------------------------------------------------------
// | Configuración de la Base de Datos MySQL                                   |
// -----------------------------------------------------------------------------
const dbConfig = {
    host: 'mysql.railway.internal',
    user: 'root',
    password: 'KxvPCoTBQFFOBLACyubsEHxDIfTVqKPk',
    database: 'railway',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// Configurar almacén de sesiones en MySQL
const sessionStore = new MySQLStore({
    expiration: 24 * 60 * 60 * 1000, // 24 horas
    createDatabaseTable: true,
    schema: {
        tableName: 'sessions',
        columnNames: {
            session_id: 'session_id',
            expires: 'expires',
            data: 'data'
        }
    }
}, pool);

// Función para probar la conexión
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Conexión exitosa a MySQL');
        connection.release();
    } catch (error) {
        console.error('❌ Error conectando a MySQL:', error.message);
    }
            await verifyConnection();

}
    function environment() {
    let clientId = process.env.PAYPAL_CLIENT_ID;
    let clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    return process.env.NODE_ENV === 'developer'
        ? new paypal.core.LiveEnvironment(clientId, clientSecret)
        : new paypal.core.SandboxEnvironment(clientId, clientSecret);
    }

    function paypalClient() {
        return new paypal.core.PayPalHttpClient(environment());
    }
   


testConnection();
paypalClient();

// -----------------------------------------------------------------------------
// | Configuración de Middlewares                                              |
// -----------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Configurar sesiones
app.use(session({
    key: 'session_cookie_name',
    secret: process.env.SESSION_SECRET || 'tu_clave_secreta_aqui',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 24 horas
        httpOnly: true,
        secure: false // cambiar a true en producción con HTTPS
    }
}));

// Configuración CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] 
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// -----------------------------------------------------------------------------
// | Rutas de Autenticación                                                    |
// -----------------------------------------------------------------------------

// Ruta para registrar usuario nuevo
app.post('/registernew', async (req, res) => {
    const { nombre, email, telefono, password, confirmPassword, direccion, colonia, codigoPostal, ciudad, estado, fechaNacimiento, genero, preferenciaMarca } = req.body;
    // Validaciones
    if (!nombre || !email || !password || !confirmPassword) {
        return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios.' });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'Las contraseñas no coinciden.' });
    }

    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: 'Email inválido.' });
    }

    try {
        // Verificar si el usuario ya existe
        const [existingUser] = await pool.execute(
            'SELECT id FROM clientes WHERE correo_electronico = ?',
            [email]
        );

        if (existingUser.length > 0) {
            return res.status(400).json({ success: false, message: 'El email ya está registrado.' });
        }

        // Hashear la contraseña
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insertar nuevo usuario
        const query = `
            INSERT INTO clientes (nombre, correo_electronico,telefono, password_hash, direccion, colonia, codigo_postal, ciudad, estado, fecha_nacimiento, genero, preferencia_marca, gasto_total, creado_en, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, NOW(), NOW())
        `;

        const [result] = await pool.execute(query, [
            nombre,
            email,
            telefono, // telefono
            hashedPassword,
            direccion || null,
            colonia || null,
            codigoPostal || null,
            ciudad || null,
            estado || null,
            fechaNacimiento || null,
            genero || null,
            preferenciaMarca || null
        ]);
        console.log('--- Usuario Nuevo Registrado ---');
        console.log(`ID: ${result.insertId}`);
        console.log(`Nombre: ${nombre}`);
        console.log(`Email: ${email}`);
        console.log('-------------------------');

        res.status(201).json({
            success: true,
            message: '¡Usuario registrado exitosamente!',
            userId: result.insertId
        });

    } catch (error) {
        console.error('Error al registrar usuario:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// Ruta para login
app.post('/api/auth/login', async (req, res) => {
    const { email, password, remember } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email y contraseña son obligatorios.' });
    }

    try {
        // Buscar usuario por email
        const [users] = await pool.execute(
            'SELECT id, nombre, correo_electronico, password_hash, is_active FROM clientes WHERE correo_electronico = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
        }

        const user = users[0];

        // Verificar si la cuenta está activa
        if (!user.is_active) {
            return res.status(401).json({ success: false, message: 'Cuenta desactivada.' });
        }

        // Verificar contraseña
        const isValidPassword = await bcrypt.compare(password, user.password_hash);

        if (!isValidPassword) {
            return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
        }

        // Actualizar último login
        await pool.execute(
            'UPDATE clientes SET ultimo_login = NOW() WHERE id = ?',
            [user.id]
        );

        // Configurar sesión
        req.session.userId = user.id;
        req.session.userEmail = user.correo_electronico;
        req.session.userName = user.nombre;

        // Configurar duración de cookie si "recordar" está marcado
        if (remember) {
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 días
        }

        console.log('--- Usuario Logueado ---');
        console.log(`ID: ${user.id}`);
        console.log(`Email: ${user.correo_electronico}`);
        console.log('----------------------');

        res.json({
            success: true,
            message: 'Login exitoso',
            user: {
                id: user.id,
                nombre: user.nombre,
                email: user.correo_electronico
            }
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// Ruta para logout
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Error al cerrar sesión.' });
        }
        res.clearCookie('session_cookie_name');
        res.json({ success: true, message: 'Sesión cerrada exitosamente.' });
    });
});

// Ruta para verificar sesión activa
app.get('/api/auth/check', (req, res) => {
    if (req.session.userId) {
        res.json({
            success: true,
            authenticated: true,
            user: {
                id: req.session.userId,
                nombre: req.session.userName,
                email: req.session.userEmail
            }
        });
    } else {
        res.json({
            success: true,
            authenticated: false
        });
    }
});

// Middleware para proteger rutas
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Acceso no autorizado.' });
    }
    next();
}

// -----------------------------------------------------------------------------
// | Rutas Existentes                                                          |
// -----------------------------------------------------------------------------

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.post('/registrar', async (req, res) => {
  const { nombre, email, mensaje } = req.body;

  if (!nombre || !email || !mensaje) {
    return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Email inválido.' });
  }

  try {
    const query = `
      INSERT INTO mensajes_contacto (nombre, correo_electronico, mensaje)
      VALUES (?, ?, ?)
    `;
    const [result] = await pool.execute(query, [nombre, email, mensaje]);

    console.log('--- Mensaje Guardado ---');
    // console.log(`ID: ${result.insertId}`);
    // console.log(`Nombre: ${nombre}`);
    // console.log(`Email: ${email}`);
    // console.log('------------------------');

    res.json({
      success: true,
      message: '¡Gracias por tu mensaje! Nos pondremos en contacto pronto.',
      id: result.insertId
    });

  } catch (error) {
    console.error('Error al insertar mensaje:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
});

// GET /api/me  -> devuelve { logged: true, nombre: '...' } o { logged: false }
app.get('/api/me', (req, res) => {
  if (req.session && req.session.clienteId) {
    //devolver también el nombre que ya tienes en BD
    return res.json({ logged: true, nombre: req.session.clienteNombre });
  }
  res.json({ logged: false });
});

// Rutas protegidas - requieren autenticación
app.get('/api/contactos', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM contactos ORDER BY fecha_creacion DESC');
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error al obtener contactos:', error);
        res.status(500).json({ success: false, message: 'Error al obtener los datos.' });
    }
});

app.get('/api/contactos/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    
    try {
        const [rows] = await pool.execute('SELECT * FROM contactos WHERE id = ?', [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        }
        
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Error al obtener contacto:', error);
        res.status(500).json({ success: false, message: 'Error al obtener el contacto.' });
    }
});

// Ruta adicional para página de confirmación
app.get('/confirmacion', requireAuth, async (req, res) => {
    const pedidoId = req.query.pedido;
    const clienteId = req.session.userId;
    
    if (!pedidoId) {
        return res.redirect('/');
    }
    
    try {
        const [pedidoInfo] = await pool.execute(`
            SELECT 
                p.id,
                p.monto_total,
                p.estado,
                p.fecha_pedido,
                c.nombre as cliente_nombre,
                c.correo_electronico,
                GROUP_CONCAT(
                    CONCAT(pr.nombre, ' - Talla: ', ip.talla, ' (Cant: ', ip.cantidad, ')')
                    SEPARATOR '<br>'
                ) as productos_detalle
            FROM pedidos p
            INNER JOIN clientes c ON p.cliente_id = c.id
            INNER JOIN items_pedido ip ON p.id = ip.pedido_id
            INNER JOIN productos pr ON ip.producto_id = pr.id
            WHERE p.id = ? AND p.cliente_id = ?
            GROUP BY p.id
        `, [pedidoId, clienteId]);
        
        if (pedidoInfo.length === 0) {
            return res.status(404).send('Pedido no encontrado');
        }
        
        // Aquí podrías renderizar una página de confirmación
        res.sendFile(path.join(__dirname, 'views', 'confirmacion_pago.html'));
        
    } catch (error) {
        console.error('Error obteniendo información del pedido:', error);
        res.status(500).send('Error obteniendo información del pedido');
    }
});

// Ruta para obtener historial de pedidos del cliente
app.get('/api/pedidos/historial', requireAuth, async (req, res) => {
    const clienteId = req.session.userId;
    
    try {
        const [pedidos] = await pool.execute(`
            SELECT 
                p.id,
                p.monto_total,
                p.estado,
                p.fecha_pedido,
                p.actualizado_en,
                GROUP_CONCAT(
                    CONCAT(pr.nombre, ' (Talla: ', ip.talla, ', Cant: ', ip.cantidad, ')')
                    SEPARATOR '; '
                ) as productos
            FROM pedidos p
            INNER JOIN items_pedido ip ON p.id = ip.pedido_id
            INNER JOIN productos pr ON ip.producto_id = pr.id
            WHERE p.cliente_id = ?
            GROUP BY p.id
            ORDER BY p.fecha_pedido DESC
        `, [clienteId]);
        
        res.json({
            success: true,
            data: pedidos
        });
        
    } catch (error) {
        console.error('Error obteniendo historial:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo historial de pedidos'
        });
    }
});
//Ruta para traer los pedidos por el ID del cliente
app.get('/api/pedidos/:id', requireAuth, async (req, res) => {
    const pedidoId = req.params.id;
    const clienteId = req.session.userId;

    try {
        const [pedido] = await pool.execute(`
            SELECT 
                p.id,
                p.monto_total,
                p.estado,
                p.fecha_pedido,
                c.nombre AS cliente_nombre,
                c.correo_electronico
            FROM pedidos p
            INNER JOIN clientes c ON p.cliente_id = c.id
            WHERE p.id = ? AND p.cliente_id = ?
        `, [pedidoId, clienteId]);

        if (pedido.length === 0) return res.status(404).json({ success: false });

        const [items] = await pool.execute(`
            SELECT 
                ip.cantidad,
                ip.talla,
                pr.nombre,
                ip.precio_compra
            FROM items_pedido ip
            INNER JOIN productos pr ON ip.producto_id = pr.id
            WHERE ip.pedido_id = ?
        `, [pedidoId]);

        res.json({ success: true, pedido: pedido[0], items });

    } catch (error) {
        console.error('Error al obtener pedido:', error);
        res.status(500).json({ success: false });
    }
});
// -----------------------------------------------------------------------------
// | Rutas para productos                                                      |
// -----------------------------------------------------------------------------

// Filtrar productos por tipo (originales)
app.get('/api/productos/originales', async (req, res) => {
    try {
        const query = `
            SELECT 
                p.id,
                p.codigo,
                p.nombre,
                p.precio,
                p.tipo,
                p.nivel_stock,
                JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'talla', t.talla,
                        'stock', pt.stock,
                        'precio_ajuste', COALESCE(pt.precio_ajuste, 0),
                        'activo', pt.activo
                    )
                ) as tallas_info
            FROM productos p
            LEFT JOIN producto_tallas pt ON p.id = pt.producto_id
            LEFT JOIN tallas t ON pt.talla_id = t.id
            WHERE p.tipo = 'original' AND pt.activo = 1
            GROUP BY p.id, p.codigo, p.nombre, p.precio, p.tipo, p.nivel_stock
            HAVING JSON_LENGTH(tallas_info) > 0
            ORDER BY p.nombre
        `;
        
        const [productos] = await pool.execute(query);
        
        // Procesar tallas_info para cada producto
        const productosConTallas = productos.map(producto => {
            try {
                producto.tallas_info = typeof producto.tallas_info === 'string' 
                    ? JSON.parse(producto.tallas_info) 
                    : producto.tallas_info;
                
                // Filtrar tallas activas con stock > 0
                producto.tallas_info = producto.tallas_info.filter(t => t.activo && t.stock > 0);
                
                // Crear array de tallas disponibles para compatibilidad
                producto.tallas_disponibles = producto.tallas_info.map(t => t.talla);
            } catch (e) {
                console.error('Error procesando tallas para producto:', producto.codigo, e);
                producto.tallas_info = [];
                producto.tallas_disponibles = [];
            }
            return producto;
        });
        
        res.json({
            success: true,
            message: 'Productos originales con información de tallas',
            data: productosConTallas
        });
        
    } catch (error) {
        console.error('Error en productos originales:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor.',
            data: []
        });
    }
});

// Filtrar productos por tipo (falsificaciones)
app.get('/api/productos/falsificaciones', async (req, res) => {
    try {
        const query = `
            SELECT 
                p.id,
                p.codigo,
                p.nombre,
                p.precio,
                p.tipo,
                p.nivel_stock,
                JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'talla', t.talla,
                        'stock', pt.stock,
                        'precio_ajuste', COALESCE(pt.precio_ajuste, 0),
                        'activo', pt.activo
                    )
                ) as tallas_info
            FROM productos p
            LEFT JOIN producto_tallas pt ON p.id = pt.producto_id
            LEFT JOIN tallas t ON pt.talla_id = t.id
            WHERE p.tipo = 'falsificacion' AND pt.activo = 1
            GROUP BY p.id, p.codigo, p.nombre, p.precio, p.tipo, p.nivel_stock
            HAVING JSON_LENGTH(tallas_info) > 0
            ORDER BY p.nombre
        `;
        
        const [productos] = await pool.execute(query);
        
        // Procesar tallas_info para cada producto
        const productosConTallas = productos.map(producto => {
            try {
                producto.tallas_info = typeof producto.tallas_info === 'string' 
                    ? JSON.parse(producto.tallas_info) 
                    : producto.tallas_info;
                
                // Filtrar tallas activas con stock > 0
                producto.tallas_info = producto.tallas_info.filter(t => t.activo && t.stock > 0);
                
                // Crear array de tallas disponibles para compatibilidad
                producto.tallas_disponibles = producto.tallas_info.map(t => t.talla);
            } catch (e) {
                console.error('Error procesando tallas para producto:', producto.codigo, e);
                producto.tallas_info = [];
                producto.tallas_disponibles = [];
            }
            return producto;
        });
        
        res.json({
            success: true,
            message: 'Productos falsificaciones con información de tallas',
            data: productosConTallas
        });
        
    } catch (error) {
        console.error('Error en productos falsificaciones:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor.',
            data: []
        });
    }
});

// Filtrar productos más baratos (precio ascendente)
app.get('/api/productos/mas-baratos', async (req, res) => {
    try {
        const query = 'SELECT codigo, nombre, precio, tallas_disponibles, nivel_stock FROM productos ORDER BY precio ASC';
        const [productos] = await pool.execute(query);
        
        console.log('--- Productos Más Baratos ---');
        console.log(`Productos encontrados: ${productos.length}`);
        console.log('-----------------------------');
        
        res.json({
            success: true,
            message: 'Productos ordenados por precio ascendente',
            data: productos
        });
    } catch (error) {
        console.error('Error en búsqueda de productos más baratos:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor.',
            data: []
        });
    }
});

// Filtrar productos más caros (precio descendente)
app.get('/api/productos/mas-caros', async (req, res) => {
    try {
        const query = 'SELECT codigo, nombre, precio, tallas_disponibles, nivel_stock FROM productos ORDER BY precio DESC';
        const [productos] = await pool.execute(query);
        
        console.log('--- Productos Más Caros ---');
        console.log(`Productos encontrados: ${productos.length}`);
        console.log('--------------------------');
        
        res.json({
            success: true,
            message: 'Productos ordenados por precio descendente',
            data: productos
        });
    } catch (error) {
        console.error('Error en búsqueda de productos más caros:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor.',
            data: []
        });
    }
});

// Filtro combinado: originales más baratos
app.get('/api/productos/originales/mas-baratos', async (req, res) => {
    try {
        const query = 'SELECT codigo, nombre, precio, tallas_disponibles, nivel_stock FROM productos WHERE tipo = "original" ORDER BY precio ASC';
        const [productos] = await pool.execute(query);
        
        res.json({
            success: true,
            message: 'Productos originales ordenados por precio ascendente',
            data: productos
        });
    } catch (error) {
        console.error('Error en búsqueda de productos originales más baratos:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor.',
            data: []
        });
    }
});

// Filtro combinado: falsificaciones más baratas
app.get('/api/productos/falsificaciones/mas-baratas', async (req, res) => {
    try {
        const query = 'SELECT codigo, nombre, precio, tallas_disponibles, nivel_stock FROM productos WHERE tipo = "falsificacion" ORDER BY precio ASC';
        const [productos] = await pool.execute(query);
        
        res.json({
            success: true,
            message: 'Productos falsificaciones ordenados por precio ascendente',
            data: productos
        });
    } catch (error) {
        console.error('Error en búsqueda de falsificaciones más baratas:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor.',
            data: []
        });
    }
});

// Sirve la página de confirmación
app.get('/confirmacion_pago.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'confirmacion_pago.html'));
});

// Servir archivo de restablecimiento de contraseña
app.get('/reset_password.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'reset_password.html'));
});

// -----------------------------------------------------------------------------
// |  PayPal Configuracion                                                  |
// -----------------------------------------------------------------------------

// CONEXION CON PAYPAL
app.get('/api/paypal-config', (req, res) => {
    // Verificar autenticación del usuario si es necesario
if (!req.session.userId) {
    return res.status(401).json({ error: 'No autorizado' });
}
    
    res.json({
        clientId: process.env.PAYPAL_CLIENT_ID // Desde variables de entorno
    });
});

//CREAR ORDEN
app.post('/api/paypal/create-order', requireAuth, async (req, res) => {
    const clienteId = req.session.userId;
    const { items } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ success: false, message: 'El carrito está vacío.' });
    }

    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
            amount: {
                currency_code: 'MXN',
                value: total.toFixed(2),
            },
            description: `Pedido de ${req.session.userName}`,
        }],
    });

    try {
        const response = await paypalClient().execute(request);
        res.json({ success: true, orderID: response.result.id });
    } catch (error) {
        console.error('Error al crear orden PayPal:', error);
        res.status(500).json({ success: false, message: 'Error al crear orden.' });
    }
});

// Crear pedido en BD después del pago
app.post('/api/crear-pedido', requireAuth, async (req, res) => {
    const clienteId = req.session.userId;
    const { items, montoTotal } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'No hay productos' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        // 1. Crear pedido
        const [pedidoResult] = await connection.execute(
            `INSERT INTO pedidos (cliente_id, monto_total, estado, fecha_pedido, creado_en, actualizado_en)
             VALUES (?, ?, 'entregado', NOW(), NOW(), NOW())`,
            [clienteId, montoTotal]
        );

        const pedidoId = pedidoResult.insertId;

        // 2. Crear items del pedido
        for (const item of items) {
            if (!item.size || !item.price || !item.id) {
                throw new Error('Faltan datos en el item');
            }

            // ✅ Buscar ID real del producto por su código
            const [producto] = await connection.execute(
                'SELECT id FROM productos WHERE codigo = ?',
                [item.id.split('_')[0]]
            );

            if (producto.length === 0) {
                throw new Error(`Producto con código ${item.id.split('_')[0]} no encontrado`);
            }

            const productoId = producto[0].id;

            await connection.execute(
                `INSERT INTO items_pedido (pedido_id, producto_id, cantidad, talla, precio_compra, creado_en, actualizado_en)
                VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
                [pedidoId, productoId, item.quantity, item.size, item.price]
            );
        }

        await connection.commit();
        res.json({ success: true, pedidoId });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Error al crear pedido:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        connection.release();
    }
});

// CAPTURA DE ORDEN
app.post('/api/paypal/capture-order', requireAuth, async (req, res) => {
    const { orderID } = req.body;

    const request = new paypal.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});

    try {
        const response = await paypalClient().execute(request);

        const clienteId = req.session.userId;
        const monto = response.result.purchase_units[0].payments.captures[0].amount.value;

        // Guardar transacción
        await pool.execute(
            `INSERT INTO transacciones (cliente_id, monto, metodo_pago, estado, fecha_transaccion)
             VALUES (?, ?, 'paypal', 'completado', NOW())`,
            [clienteId, monto]
        );

        res.json({ success: true, message: 'Pago completado correctamente.' });
    } catch (error) {
        console.error('Error al capturar orden:', error);
        res.status(500).json({ success: false, message: 'Error al procesar pago.' });
    }
});

// -----------------------------------------------------------------------------
// | Rutas para Contraseña perdida                                             |
// -----------------------------------------------------------------------------

// Función para generar token seguro
function generateSecureToken() {
    return crypto.randomBytes(32).toString('hex');
}
    // Ruta para solicitar recuperación de contraseña
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    // Validar que el email esté presente
    if (!email) {
        return res.status(400).json({ 
            success: false, 
            message: 'El correo electrónico es requerido' 
        });
    }

    try {
        // 1. Verificar si el usuario existe
        const [users] = await pool.execute(
            'SELECT id, correo_electronico, is_active FROM clientes WHERE correo_electronico = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'No existe una cuenta con este correo electrónico' 
            });
        }

        const user = users[0];

        // Verificar si la cuenta está activa
        if (!user.is_active) {
            return res.status(401).json({ 
                success: false, 
                message: 'La cuenta está desactivada' 
            });
        }
        
        // 2. Generar token de recuperación
        const resetToken = generateSecureToken();
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hora
        
        // 3. Guardar token en la base de datos
        await pool.execute(
            'UPDATE clientes SET resetPasswordToken = ?, resetPasswordExpires = ? WHERE correo_electronico = ?',
            [resetToken, resetTokenExpiry, email]
        );
        
        // 4. Enviar email con el enlace de recuperación
        const resetUrl = `https://storetenismay-production.up.railway.app/reset_password.html?token=${resetToken}`;
        await sendPasswordResetEmail(email, resetUrl);

        console.log('--- Token de Recuperación Generado ---');
        console.log(`Email: ${email}`);
        console.log(`Token: ${resetToken}`);
        console.log(`Expira: ${resetTokenExpiry}`);
        console.log('------------------------------------');
        
        res.status(200).json({ 
            success: true, 
            message: 'Instrucciones enviadas al correo electrónico' 
        });
        
    } catch (error) {
        console.error('Error en forgot-password:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});

// RESETEA EL PASSOWRD
app.post('/api/auth/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    
    // Validar que el token y la nueva contraseña estén presentes
    if (!token || !newPassword) {
        return res.status(400).json({ 
            success: false, 
            message: 'Token y nueva contraseña son requeridos' 
        });
    }

    try {
        // 1. Verificar si el token existe y no ha expirado
        const [users] = await pool.execute(
            'SELECT id, correo_electronico FROM clientes WHERE resetPasswordToken = ? AND resetPasswordExpires > NOW()',
            [token]
        );

        if (users.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'El token es inválido o ha expirado' 
            });
        }

        const user = users[0];
        
        // 2. Hashear la nueva contraseña (deberías usar bcrypt)
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        // 3. Actualizar la contraseña y limpiar el token
        await pool.execute(
            'UPDATE clientes SET password_hash = ?, resetPasswordToken = NULL, resetPasswordExpires = NULL WHERE id = ?',
            [hashedPassword, user.id]
        );
        
        res.status(200).json({ 
            success: true, 
            message: 'Contraseña actualizada exitosamente' 
        });
        
    } catch (error) {
        console.error('Error en reset-password:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
});
// -----------------------------------------------------------------------------
// | Inicio del Servidor                                                       |
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📦 Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`💳 PayPal configurado: ${!!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)}`);
    
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
        console.warn('⚠️  ADVERTENCIA: Credenciales de PayPal no configuradas');
    }
    
    console.log('Conectando a MySQL...');
});
