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



// -----------------------------------------------------------------------------
// | Requerimientos e Inicialización del servidor de correos                    |
// -----------------------------------------------------------------------------
const { verifyConnection } = require('./services/emailService');
const { sendPasswordResetEmail } = require('./services/emailService');
const { PayPalService } = require('./services/paypalService');

const app = express();
const PORT = process.env.PORT || 3000;

// -----------------------------------------------------------------------------
// | Configuración de la Base de Datos MySQL                                   |
// -----------------------------------------------------------------------------
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
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

testConnection();

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
    const { nombre, email, password, confirmPassword } = req.body;

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
            INSERT INTO clientes (
                nombre, 
                correo_electronico, 
                password_hash,
                gasto_total,
                creado_en,
                actualizado_en
            ) 
            VALUES (?, ?, ?, 0.00, NOW(), NOW())
        `;

        const [result] = await pool.execute(query, [nombre, email, hashedPassword]);
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

// Ruta original de contacto (mantener como está)
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
        const query = 'INSERT INTO contactos (nombre, email, mensaje) VALUES (?, ?, ?)';
        const [result] = await pool.execute(query, [nombre, email, mensaje]);
        
        console.log('--- Contacto Guardado ---');
        console.log(`ID: ${result.insertId}`);
        console.log(`Nombre: ${nombre}`);
        console.log(`Email: ${email}`);
        console.log('------------------------');
        
        res.status(200).json({ 
            success: true, 
            message: '¡Gracias por tu mensaje! Nos pondremos en contacto pronto.',
            id: result.insertId 
        });
        
    } catch (error) {
        console.error('Error al insertar contacto:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
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
        // Por ahora, devolvemos JSON o redirigimos al inicio con mensaje
        res.send(`
            <html>
                <head><title>Pedido Confirmado</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>¡Pedido Confirmado!</h1>
                    <h2>Pedido #${pedidoId}</h2>
                    <p><strong>Cliente:</strong> ${pedidoInfo[0].cliente_nombre}</p>
                    <p><strong>Total:</strong> ${pedidoInfo[0].monto_total} MXN</p>
                    <p><strong>Estado:</strong> ${pedidoInfo[0].estado}</p>
                    <p><strong>Productos:</strong></p>
                    <div style="text-align: left; max-width: 500px; margin: 0 auto;">
                        ${pedidoInfo[0].productos_detalle}
                    </div>
                    <br>
                    <a href="/" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                        Volver al Inicio
                    </a>
                </body>
            </html>
        `);
        
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

// Ruta para crear orden de PayPal con integración completa
app.post('/api/paypal/create-order', requireAuth, async (req, res) => {
    const { cart, productId, talla } = req.body;
    const clienteId = req.session.userId;
    
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        let items = [];
        let montoTotal = 0;
        let pedidoId = null;
        
        // Crear el pedido principal
        const [pedidoResult] = await connection.execute(
            'INSERT INTO pedidos (cliente_id, monto_total, estado, fecha_pedido) VALUES (?, ?, ?, NOW())',
            [clienteId, 0, 'PENDIENTE'] // Monto temporal, se actualizará después
        );
        
        pedidoId = pedidoResult.insertId;
        
        if (cart && Array.isArray(cart)) {
            // Compra desde el carrito (múltiples productos)
            for (const item of cart) {
                // Verificar producto y talla
                const [productoCheck] = await connection.execute(
                    'SELECT p.id, p.codigo, p.nombre, p.precio, pt.stock, pt.precio_ajuste FROM productos p ' +
                    'INNER JOIN producto_tallas pt ON p.id = pt.producto_id ' +
                    'INNER JOIN tallas t ON pt.talla_id = t.id ' +
                    'WHERE p.codigo = ? AND t.talla = ? AND pt.activo = 1',
                    [item.id.split('_')[0], item.size]
                );
                
                if (productoCheck.length === 0) {
                    throw new Error(`Producto ${item.name} talla ${item.size} no disponible`);
                }
                
                const producto = productoCheck[0];
                const precioFinal = producto.precio + (producto.precio_ajuste || 0);
                const subtotal = precioFinal * item.quantity;
                
                // Verificar stock
                if (producto.stock < item.quantity) {
                    throw new Error(`Stock insuficiente para ${item.name} talla ${item.size}. Stock disponible: ${producto.stock}`);
                }
                
                // Insertar item del pedido
                await connection.execute(
                    'INSERT INTO items_pedido (pedido_id, producto_id, cantidad, talla, precio_compra) VALUES (?, ?, ?, ?, ?)',
                    [pedidoId, producto.id, item.quantity, item.size, precioFinal]
                );
                
                // Actualizar stock (reservar)
                await connection.execute(
                    'UPDATE producto_tallas SET stock = stock - ? WHERE producto_id = ? AND talla_id = (SELECT id FROM tallas WHERE talla = ?)',
                    [item.quantity, producto.id, item.size]
                );
                
                montoTotal += subtotal;
                
                items.push({
                    name: producto.nombre,
                    unit_amount: {
                        currency_code: 'MXN',
                        value: precioFinal.toFixed(2)
                    },
                    quantity: item.quantity.toString(),
                    description: `Talla: ${item.size}`,
                    sku: producto.codigo
                });
            }
            
        } else if (productId && talla) {
            // Compra individual
            const [productoData] = await connection.execute(
                'SELECT p.id, p.codigo, p.nombre, p.precio, pt.stock, pt.precio_ajuste FROM productos p ' +
                'INNER JOIN producto_tallas pt ON p.id = pt.producto_id ' +
                'INNER JOIN tallas t ON pt.talla_id = t.id ' +
                'WHERE p.codigo = ? AND t.talla = ? AND pt.activo = 1',
                [productId, talla]
            );
            
            if (productoData.length === 0) {
                throw new Error('Producto no encontrado o no disponible');
            }
            
            const producto = productoData[0];
            const precioFinal = producto.precio + (producto.precio_ajuste || 0);
            
            if (producto.stock < 1) {
                throw new Error(`Producto sin stock disponible`);
            }
            
            // Insertar item del pedido
            await connection.execute(
                'INSERT INTO items_pedido (pedido_id, producto_id, cantidad, talla, precio_compra) VALUES (?, ?, ?, ?, ?)',
                [pedidoId, producto.id, 1, talla, precioFinal]
            );
            
            // Reservar stock
            await connection.execute(
                'UPDATE producto_tallas SET stock = stock - 1 WHERE producto_id = ? AND talla_id = (SELECT id FROM tallas WHERE talla = ?)',
                [producto.id, talla]
            );
            
            montoTotal = precioFinal;
            
            items = [{
                name: producto.nombre,
                unit_amount: {
                    currency_code: 'MXN',
                    value: precioFinal.toFixed(2)
                },
                quantity: '1',
                description: `Talla: ${talla}`,
                sku: producto.codigo
            }];
        } else {
            throw new Error('Datos de compra inválidos');
        }
        
        // Actualizar monto total del pedido
        await connection.execute(
            'UPDATE pedidos SET monto_total = ? WHERE id = ?',
            [montoTotal, pedidoId]
        );
        
        // Crear orden PayPal
        const orderResult = await PayPalService.createOrder(items, montoTotal);
        
        if (orderResult.success) {
            // Insertar transacción
            await connection.execute(
                'INSERT INTO transacciones (pedido_id, cliente_id, monto, metodo_pago, estado, fecha_transaccion) VALUES (?, ?, ?, ?, ?, NOW())',
                [pedidoId, clienteId, montoTotal, 'PAYPAL', 'PENDIENTE']
            );
            
            await connection.commit();
            
            console.log('--- Orden PayPal Creada ---');
            console.log(`Cliente ID: ${clienteId}`);
            console.log(`Pedido ID: ${pedidoId}`);
            console.log(`PayPal Order ID: ${orderResult.orderID}`);
            console.log(`Total: ${montoTotal} MXN`);
            console.log('---------------------------');
            
            res.json({
                success: true,
                orderID: orderResult.orderID,
                pedidoId: pedidoId,
                total: montoTotal
            });
        } else {
            throw new Error(orderResult.error);
        }
        
    } catch (error) {
        await connection.rollback();
        console.error('Error en create-order:', error);
        
        // Si hay un pedido creado, marcarlo como cancelado
        if (pedidoId) {
            try {
                await connection.execute(
                    'UPDATE pedidos SET estado = ? WHERE id = ?',
                    ['CANCELADO', pedidoId]
                );
            } catch (updateError) {
                console.error('Error actualizando pedido cancelado:', updateError);
            }
        }
        
        res.status(500).json({
            success: false,
            message: error.message || 'Error interno del servidor'
        });
    } finally {
        connection.release();
    }
});

// Ruta para capturar el pago
app.post('/api/paypal/capture-order', requireAuth, async (req, res) => {
    const { orderID } = req.body;
    const clienteId = req.session.userId;
    
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const captureResult = await PayPalService.captureOrder(orderID);
        
        if (captureResult.success) {
            // Buscar el pedido asociado a esta transacción
            const [transaccionData] = await connection.execute(
                'SELECT t.*, p.id as pedido_id FROM transacciones t ' +
                'INNER JOIN pedidos p ON t.pedido_id = p.id ' +
                'WHERE t.cliente_id = ? AND t.estado = "PENDIENTE" ' +
                'ORDER BY t.fecha_transaccion DESC LIMIT 1',
                [clienteId]
            );
            
            if (transaccionData.length === 0) {
                throw new Error('Transacción no encontrada');
            }
            
            const transaccion = transaccionData[0];
            
            // Actualizar transacción como completada
            await connection.execute(
                'UPDATE transacciones SET estado = ?, creado_en = NOW(), actualizado_en = NOW() WHERE id = ?',
                ['COMPLETADO', transaccion.id]
            );
            
            // Actualizar pedido como completado
            await connection.execute(
                'UPDATE pedidos SET estado = ?, actualizado_en = NOW() WHERE id = ?',
                ['COMPLETADO', transaccion.pedido_id]
            );
            
            // Actualizar gasto total del cliente
            await connection.execute(
                'UPDATE clientes SET gasto_total = gasto_total + ?, actualizado_en = NOW() WHERE id = ?',
                [transaccion.monto, clienteId]
            );
            
            await connection.commit();
            
            console.log('--- Pago Capturado y Procesado ---');
            console.log(`PayPal Order ID: ${orderID}`);
            console.log(`Capture ID: ${captureResult.captureID}`);
            console.log(`Pedido ID: ${transaccion.pedido_id}`);
            console.log(`Cliente ID: ${clienteId}`);
            console.log(`Monto: ${transaccion.monto} MXN`);
            console.log('--------------------------------');
            
            res.json({
                success: true,
                captureID: captureResult.captureID,
                pedidoId: transaccion.pedido_id,
                details: captureResult.details
            });
        } else {
            throw new Error(captureResult.error);
        }
        
    } catch (error) {
        await connection.rollback();
        console.error('Error en capture-order:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error interno del servidor'
        });
    } finally {
        connection.release();
    }
});

// -----------------------------------------------------------------------------
// | Rutas PayPal adicionales                                                  |
// -----------------------------------------------------------------------------

// Importar rutas de PayPal
const paypalRoutes = require('./services/paypalRoutes');

// Usar las rutas de PayPal
app.use('/api/paypal', paypalRoutes);

// Rutas de checkout
app.get('/checkout', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/checkout.html'));
});

// Páginas de resultado de pago
app.get('/payment-success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Pago Exitoso - TENIS2_SHOP</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .success { color: green; font-size: 24px; margin-bottom: 20px; }
        .details { background: #f0f8f0; padding: 20px; border-radius: 8px; margin: 20px auto; max-width: 500px; }
      </style>
    </head>
    <body>
      <div class="success">¡Pago completado exitosamente! ✓</div>
      <div class="details">
        <h3>Detalles del pago:</h3>
        <p><strong>ID de Orden:</strong> ${req.query.orderId || 'N/A'}</p>
        <p><strong>ID de Captura:</strong> ${req.query.captureId || 'N/A'}</p>
        <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES')}</p>
      </div>
      <a href="/">Volver al inicio</a>
    </body>
    </html>
  `);
});

app.get('/payment-cancelled', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Pago Cancelado - TENIS2_SHOP</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .cancelled { color: orange; font-size: 24px; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="cancelled">Pago cancelado</div>
      <p>Has cancelado el proceso de pago. Puedes intentarlo de nuevo cuando gustes.</p>
      <a href="/checkout">Volver al checkout</a> | 
      <a href="/">Ir al inicio</a>
    </body>
    </html>
  `);
});

app.get('/payment-error', (req, res) => {
  const message = req.query.message || 'error-desconocido';
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Error en el Pago - TENIS2_SHOP</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .error { color: red; font-size: 24px; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="error">Error en el pago ✗</div>
      <p>Ocurrió un error procesando tu pago: ${message.replace(/-/g, ' ')}</p>
      <a href="/checkout">Intentar de nuevo</a> | 
      <a href="/">Ir al inicio</a>
    </body>
    </html>
  `);
});

// API de prueba para verificar configuración
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'API funcionando correctamente',
    environment: process.env.NODE_ENV,
    paypal_configured: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    timestamp: new Date().toISOString()
  });
});

// Manejo de cierre graceful
process.on('SIGTERM', async () => {
    console.log('Cerrando conexiones...');
    await pool.end();
    process.exit(0);
});    

process.on('SIGINT', async () => {
    console.log('Cerrando conexiones...');
    await pool.end();
    process.exit(0);
});    
// -----------------------------------------------------------------------------
// | Rutas para Contraseña perdida                                             |
// -----------------------------------------------------------------------------

// Función para generar token seguro
function generateSecureToken() {
    const timestamp = Date.now().toString(36);
    const randomPart1 = Math.random().toString(36).substring(2, 15);
    const randomPart2 = Math.random().toString(36).substring(2, 15);
    const randomPart3 = Math.random().toString(36).substring(2, 15);
    
    return timestamp + randomPart1 + randomPart2 + randomPart3;
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
        const resetUrl = `http://localhost:3000/views/reset_password.html?token=${resetToken}`;
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