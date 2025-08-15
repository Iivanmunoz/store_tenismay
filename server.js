// server.js
require('dotenv').config();
// -----------------------------------------------------------------------------
// | Requerimientos e Inicialización del Servidor                              |
// -----------------------------------------------------------------------------
const express = require('express');
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

const app = express();
const PORT = process.env.PORT || 3000;

// -----------------------------------------------------------------------------
// | Configuración de la Base de Datos MySQL                                   |
// -----------------------------------------------------------------------------
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Jm2020mx',
    database: process.env.DB_NAME || 'tennis_BD',
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

// // Ruta para obtener todos los productos
// app.get('/api/productos', async (req, res) => {
//     try {
//         const query = 'SELECT codigo, nombre, precio, tallas_disponibles, nivel_stock FROM productos';
//         const [productos] = await pool.execute(query);
        
//         console.log('--- Búsqueda de Productos ---');
//         console.log(`Productos encontrados: ${productos.length}`);
//         console.log('-----------------------------');
        
//         res.json({
//             success: true,
//             message: 'Productos obtenidos exitosamente',
//             data: productos
//         });
//     } catch (error) {
//         console.error('Error en búsqueda de productos:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Error interno del servidor.',
//             data: []
//         });
//     }
// });


// -----------------------------------------------------------------------------
// | Rutas para productos                                                      |
// -----------------------------------------------------------------------------

// Filtrar productos por tipo (originales)
app.get('/api/productos/originales', async (req, res) => {
    try {
        const query = 'SELECT codigo, nombre, precio, tallas_disponibles, nivel_stock FROM productos WHERE tipo = "original"';
        const [productos] = await pool.execute(query);
        
        console.log('--- Productos Originales ---');
        console.log(`Productos encontrados: ${productos.length}`);
        console.log('---------------------------');
        
        res.json({
            success: true,
            message: 'Productos originales obtenidos exitosamente',
            data: productos
        });
    } catch (error) {
        console.error('Error en búsqueda de productos originales:', error);
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
        const query = 'SELECT codigo, nombre, precio, tallas_disponibles, nivel_stock FROM productos WHERE tipo = "falsificacion"';
        const [productos] = await pool.execute(query);
        
        console.log('--- Productos Falsificaciones ---');
        console.log(`Productos encontrados: ${productos.length}`);
        console.log('--------------------------------');
        
        res.json({
            success: true,
            message: 'Productos falsificaciones obtenidos exitosamente',
            data: productos
        });
    } catch (error) {
        console.error('Error en búsqueda de productos falsificaciones:', error);
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
// Ruta PayPal (protegida)
app.post('/api/paypal/create-order', requireAuth, async (req, res) => {
    console.log("Creando orden de PayPal para el usuario:", req.session.userId);
    console.log("Item:", req.body.itemId);
    
    const orderID = `PAYPAL_ORDER_${Date.now()}`;
    res.json({ success: true, orderID: orderID });
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
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
    console.log('Conectando a MySQL...');
});