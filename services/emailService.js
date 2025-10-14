const nodemailer = require('nodemailer');

// Crear transportador SMTP
const createTransporter = () => {
return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // true para puerto 465, false para otros puertos
        auth: {
            user: 'tennismay19@gmail.com',
            pass: 'uwnn yaix pouv fqyz'
        },
    });
};

// Función para enviar email de recuperación
const sendPasswordResetEmail = async (email, resetUrl) => {
    const transporter = createTransporter();
    
    const mailOptions = {
        from: {
            name: 'TennisMay',
            address: 'tennismay19@gmail.com'
        },
        to: email,
        subject: 'Recuperación de Contraseña',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    .container { 
                        max-width: 600px; 
                        margin: 0 auto; 
                        font-family: Arial, sans-serif; 
                        line-height: 1.6;
                        color: #333;
                    }
                    .header { 
                        background: #00a650; 
                        color: white; 
                        padding: 20px; 
                        text-align: center; 
                    }
                    .content { 
                        padding: 30px; 
                        background: #f9f9f9; 
                    }
                    .button { 
                        display: inline-block; 
                        background: #00a650; 
                        color: white; 
                        padding: 12px 30px; 
                        text-decoration: none; 
                        border-radius: 5px; 
                        margin: 20px 0;
                    }
                    .footer { 
                        text-align: center; 
                        padding: 20px; 
                        font-size: 12px; 
                        color: #666; 
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Recuperación de Contraseña</h1>
                    </div>
                    <div class="content">
                        <h2>¡Hola!</h2>
                        <p>Has solicitado restablecer tu contraseña. Haz clic en el siguiente botón para crear una nueva contraseña:</p>
                        
                        <div style="text-align: center;">
                            <a href="${resetUrl}" class="button">Restablecer Contraseña</a>
                        </div>
                        
                        <p>Si no puedes hacer clic en el botón, copia y pega este enlace en tu navegador:</p>
                        <p style="word-break: break-all; background: #eee; padding: 10px; border-radius: 3px;">
                            ${resetUrl}
                        </p>
                        
                        <p><strong>Este enlace expirará en 1 hora por seguridad.</strong></p>
                        
                        <p>Si no solicitaste este cambio, puedes ignorar este correo de forma segura.</p>
                    </div>
                    <div class="footer">
                        <p>© 2025 Tu Tienda. Todos los derechos reservados.</p>
                    </div>
                </div>
            </body>
            </html>
        `
    };
    
    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email enviado:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error enviando email:', error);
        throw error;
    }
};

// Función para verificar conexión SMTP
const verifyConnection = async () => {
    const transporter = createTransporter();
    try {
        await transporter.verify();
        console.log('✅ Conexión SMTP verificada correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error en conexión SMTP:', error);
        return false;
    }
};

module.exports = {
    sendPasswordResetEmail,
    verifyConnection
};
