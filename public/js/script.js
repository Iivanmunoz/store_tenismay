// Variables globales centralizadas
let currentUser = null;
let cart = [];

// Configuración y constantes
const CONFIG = {
    CART_STORAGE_KEY: 'cart',
    USER_STORAGE_KEY: 'currentUser',
    NOTIFICATION_DURATION: 3000,
    ANIMATION_DELAY: 500
};

// Caché de elementos DOM para evitar búsquedas repetidas
const DOM_CACHE = {};

// ========== UTILIDADES Y HELPERS ==========
const Utils = {
    // Formatear precio
    formatPrice(price) {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN',
            minimumFractionDigits: 2
        }).format(price);
    },

    // Debounce para optimizar eventos
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Throttle para scroll y resize
    throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    },

    // Sanitizar strings para nombres de archivo
    sanitizeFilename(str) {
        return str.toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    },

    // Obtener imagen del producto
    getProductImage(productName) {
        const cleanName = this.sanitizeFilename(productName);
        return `./images/${cleanName}.png`;
    },

    // Manejar errores de imagen
    handleImageError(img) {
        if (!img.getAttribute('data-error-handled')) {
            img.setAttribute('data-error-handled', 'true');
            img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDMwMCAzMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xMjUgMTI1SDE3NVYxNzVIMTI1VjEyNVoiIGZpbGw9IiNEMUQ1REIiLz4KPHN2Zz4K';
            img.alt = 'Imagen no disponible';
        }
    }
};

// ========== GESTIÓN DEL CARRITO  ==========
const CartManager = {
    // Inicializar carrito
    init() {
        this.cacheElements();
        this.loadFromStorage();
        this.bindEvents();
        this.updateDisplay();
    },

    // Cachear elementos del DOM 
    cacheElements() {
        DOM_CACHE.cartOverlay = document.getElementById('cartOverlay');
        DOM_CACHE.cartClose = document.getElementById('cartClose');
        DOM_CACHE.cartItems = document.getElementById('cartItems');
        DOM_CACHE.cartEmpty = document.getElementById('cartEmpty');
        DOM_CACHE.cartTotal = document.getElementById('cartTotal');
        DOM_CACHE.cartCount = document.getElementById('CartCount');
        DOM_CACHE.clearCartBtn = document.getElementById('clearCart');
        DOM_CACHE.cartToggle = document.querySelector('.cart-toggle');
        DOM_CACHE.cartActions = document.querySelector('.cart-actions');
        DOM_CACHE.authCloseBtn = document.getElementById('authCloseBtn');
    },

    // Actualizar contenido del carrito
    updateCartContent() {
        if (!DOM_CACHE.cartItems || !DOM_CACHE.cartEmpty) return;

        if (cart.length === 0) {
            DOM_CACHE.cartItems.innerHTML = '';
            DOM_CACHE.cartEmpty.style.display = 'block';
            this.toggleCartActions(false);

            return;
        }

        DOM_CACHE.cartEmpty.style.display = 'none';
        this.toggleCartActions(true);
        this.renderCartItems();
        
        const paypalContainer = document.getElementById('paypal-button-container');
        if (cart.length > 0 && currentUser) {
            paypalContainer.style.display = 'block';
            this.renderPayPalButton();
        } else {
            paypalContainer.style.display = 'none';
        }

    },

    // Alternar acciones del carrito 
    toggleCartActions(show) {
        if (DOM_CACHE.cartActions) {
            DOM_CACHE.cartActions.style.display = show ? 'flex' : 'none';
        }
    },

    // Actualizar display del carrito 
    updateDisplay() {
        this.updateCounter();
        this.updateCartContent();
        this.updateTotal();
        
       
    },
    
    bindEvents() {
        // Abrir carrito
        if (DOM_CACHE.cartToggle) {
            DOM_CACHE.cartToggle.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleCartToggle();
            });
        }

        // Cerrar carrito
        if (DOM_CACHE.cartClose) {
            DOM_CACHE.cartClose.addEventListener('click', () => this.closeCart());
        }

        // Cerrar con overlay
        if (DOM_CACHE.cartOverlay) {
            DOM_CACHE.cartOverlay.addEventListener('click', (e) => {
                if (e.target === DOM_CACHE.cartOverlay) {
                    this.closeCart();
                }
            });
        }
        // Cerrar con ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && DOM_CACHE.cartOverlay?.classList.contains('active')) {
                this.closeCart();
            }
        });

        // Vaciar carrito
        if (DOM_CACHE.clearCartBtn) {
            DOM_CACHE.clearCartBtn.addEventListener('click', () => this.clearCart());
        }

        // Guardar carrito antes de cerrar página
        window.addEventListener('beforeunload', () => this.saveToStorage());

        // ==== CIERRE UNIVERSAL DE MODALES ====
        // Botón X del modal auth
        const authCloseBtn = document.getElementById('authCloseBtn');
        if (authCloseBtn) {
            authCloseBtn.addEventListener('click', () => {
                document.getElementById('authModal')?.classList.remove('active');
                document.body.style.overflow = '';
            });
        }

        // Cerrar #premiumAlert (click fuera o ESC)
        const premiumAlert = document.getElementById('premiumAlert');
        if (premiumAlert) {
            // Click en el backdrop
            premiumAlert.addEventListener('click', e => {
                if (e.target === premiumAlert) {
                    premiumAlert.classList.remove('active');
                }
            });
            // ESC
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape') {
                    premiumAlert.classList.remove('active');
                }
            });
        }
    },

    
    // Abrir carrito
    openCart() {
        if (DOM_CACHE.cartOverlay) {
            DOM_CACHE.cartOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
            this.updateDisplay();
            
        }
    },
    
    handleCartToggle() {
        if (!currentUser) {
            NotificationManager.showPremiumAlert();
            return;
        }
        this.openCart();
    },

    closeCart() {
        if (DOM_CACHE.cartOverlay) {
            DOM_CACHE.cartOverlay.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    },

    addProduct(productData) {
        if (!currentUser) {
            NotificationManager.showPremiumAlert();
            return false;
        }

        if (!productData.selectedSize) {
            NotificationManager.showError('Por favor selecciona una talla');
            return false;
        }

        const product = {
            id: `${productData.id}_${productData.selectedSize}`,
            name: productData.name,
            price: parseFloat(productData.price),
            image: productData.image || Utils.getProductImage(productData.name),
            size: productData.selectedSize,
            quantity: 1
        };

        const existingItemIndex = cart.findIndex(item => item.id === product.id);

        if (existingItemIndex > -1) {
            cart[existingItemIndex].quantity += 1;
        } else {
            cart.push(product);
        }

        this.updateDisplay();
        this.saveToStorage();
        NotificationManager.showSuccess(`${product.name} agregado al carrito`);
        return true;
    },

    updateQuantity(itemId, change) {
        const itemIndex = cart.findIndex(item => item.id === itemId);
        if (itemIndex > -1) {
            cart[itemIndex].quantity += change;
            
            if (cart[itemIndex].quantity <= 0) {
                cart.splice(itemIndex, 1);
            }
            
            this.updateDisplay();
            this.saveToStorage();
        }
    },

    removeProduct(itemId) {
        const itemIndex = cart.findIndex(item => item.id === itemId);
        if (itemIndex > -1) {
            cart.splice(itemIndex, 1);
            this.updateDisplay();
            this.saveToStorage();
        }
    },

    clearCart() {
        if (cart.length === 0) return;
        
        if (confirm('¿Estás seguro de que quieres vaciar tu carrito?')) {
            cart = [];
            this.updateDisplay();
            this.saveToStorage();
            NotificationManager.showSuccess('Carrito vaciado');
        }
    },

    updateCounter() {
        const totalCount = cart.reduce((total, item) => total + item.quantity, 0);
        if (DOM_CACHE.cartCount) {
            DOM_CACHE.cartCount.textContent = totalCount;
            DOM_CACHE.cartCount.classList.toggle('active', totalCount > 0);
        }
    },

    renderCartItems() {
        const fragment = document.createDocumentFragment();

        cart.forEach(item => {
            const itemElement = this.createCartItemElement(item);
            fragment.appendChild(itemElement);
        });

        DOM_CACHE.cartItems.innerHTML = '';
        DOM_CACHE.cartItems.appendChild(fragment);
    },

    createCartItemElement(item) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'cart-item';
        itemDiv.innerHTML = `
            <img src="${item.image}" alt="${item.name}" class="cart-item-image">
            <div class="cart-item-info">
                <h3 class="cart-item-name">${item.name}</h3>
                <p class="cart-item-size">Talla: ${item.size}</p>
                <p class="cart-item-price">${Utils.formatPrice(item.price)}</p>
                <div class="cart-item-controls">
                    <button class="quantity-btn decrease-btn" data-id="${item.id}">-</button>
                    <span class="quantity-display">${item.quantity}</span>
                    <button class="quantity-btn increase-btn" data-id="${item.id}">+</button>
                    <button class="remove-item-btn" data-id="${item.id}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        this.bindCartItemEvents(itemDiv);
        return itemDiv;
    },

    bindCartItemEvents(itemElement) {
        const decreaseBtn = itemElement.querySelector('.decrease-btn');
        const increaseBtn = itemElement.querySelector('.increase-btn');
        const removeBtn = itemElement.querySelector('.remove-item-btn');

        if (decreaseBtn) {
            decreaseBtn.addEventListener('click', (e) => {
                this.updateQuantity(e.target.dataset.id, -1);
            });
        }

        if (increaseBtn) {
            increaseBtn.addEventListener('click', (e) => {
                this.updateQuantity(e.target.dataset.id, 1);
            });
        }

        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                this.removeProduct(e.target.dataset.id);
            });
        }
    },

    updateTotal() {
        const totalPrice = cart.reduce((total, item) => total + (item.price * item.quantity), 0);
        if (DOM_CACHE.cartTotal) {
            DOM_CACHE.cartTotal.textContent = Utils.formatPrice(totalPrice);
        }
    },

    saveToStorage() {
        try {
            localStorage.setItem(CONFIG.CART_STORAGE_KEY, JSON.stringify(cart));
        } catch (error) {
            console.error('Error al guardar carrito:', error);
        }
    },

    loadFromStorage() {
        try {
            const savedCart = localStorage.getItem(CONFIG.CART_STORAGE_KEY);
            if (savedCart) {
                cart = JSON.parse(savedCart);
            }
        } catch (error) {
            console.error('Error al cargar carrito:', error);
            cart = [];
        }
    },

    getCart() {
        return [...cart];
    },

    setCart(newCart) {
        cart = Array.isArray(newCart) ? newCart : [];
        this.updateDisplay();
        this.saveToStorage();
    },

    renderPayPalButton() {
        const paypalContainer = document.getElementById('paypal-button-container');
        if (!paypalContainer) return;

        paypalContainer.style.display = 'block';
        paypalContainer.innerHTML = ''; // Limpiar previos

        PayPalManager.renderButtons(
            '#paypal-button-container',
            cart,
            (result) => {
                NotificationManager.showSuccess('Pago completado correctamente');
                this.clearCart();
                this.closeCart();
            },
            (errorMessage) => {
                NotificationManager.showError(errorMessage);
            }
        );
    }
    
};

// ========== GESTIÓN DE NOTIFICACIONES ==========
const NotificationManager = {
    // Mostrar alerta premium
    showPremiumAlert() {
        const alert = document.getElementById('premiumAlert');
        if (alert) {
            alert.classList.add('active');
            setTimeout(() => {
                document.getElementById('loginBtn')?.focus();
            }, CONFIG.ANIMATION_DELAY);
        }
    },

    // Mostrar notificación de éxito
    showSuccess(message) {
        this.showNotification(message, 'success');
    },

    // Mostrar notificación de error
    showError(message) {
        this.showNotification(message, 'error');
    },

    // Mostrar notificación genérica
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `cart-notification ${type}`;
        notification.textContent = message;
        
        const bgColors = {
            success: '#4CAF50',
            error: '#f44336',
            info: '#2196F3'
        };

        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${bgColors[type] || bgColors.info};
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 10000;
            font-family: Arial, sans-serif;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            transform: translateX(300px);
            transition: transform 0.3s ease;
            max-width: 300px;
        `;

        document.body.appendChild(notification);

        // Animar entrada
        requestAnimationFrame(() => {
            notification.style.transform = 'translateX(0)';
        });

        // Eliminar después del tiempo configurado
        setTimeout(() => {
            notification.style.transform = 'translateX(300px)';
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, CONFIG.NOTIFICATION_DURATION);
    }
};

// ========== GESTIÓN DE AUTENTICACIÓN ==========
const AuthManager = {
    init() {
        this.cacheElements();
        this.bindEvents();
        this.loadUserFromStorage();
    },

    cacheElements() {
        DOM_CACHE.authModal = document.getElementById('authModal');
        DOM_CACHE.userIcon = document.getElementById('userIcon');
        DOM_CACHE.userMenu = document.getElementById('userMenu');
        DOM_CACHE.logoutBtn = document.getElementById('logoutBtn');
        DOM_CACHE.loginForm = document.getElementById('loginForm');
        DOM_CACHE.registerForm = document.getElementById('registerForm');
        DOM_CACHE.passwordRecoveryModal = document.getElementById('passwordRecoveryModal');
        DOM_CACHE.recoveryForm = document.getElementById('recoveryForm');
    },

    bindEvents() {
        // Abrir modal de auth
        DOM_CACHE.userIcon?.addEventListener('click', () => {
            if (!currentUser && DOM_CACHE.authModal) {
                document.getElementById('authModal').classList.add('active');
            }
        });

        // Cerrar modales con click fuera
        window.addEventListener('click', (e) => {
            if (e.target.id === 'authBackdrop') {
                document.getElementById('authModal').classList.remove('active');
            }
            if (e.target === DOM_CACHE.passwordRecoveryModal) {
                DOM_CACHE.passwordRecoveryModal.style.display = 'none';
            }
        });

        // Cerrar modal de recuperación con ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (DOM_CACHE.passwordRecoveryModal?.style.display === 'flex') {
                    DOM_CACHE.passwordRecoveryModal.style.display = 'none';
                }
                if (DOM_CACHE.authModal?.style.display === 'flex') {
                    DOM_CACHE.authModal.style.display = 'none';
                }
            }
        });

        //Tabs premium
        document.querySelectorAll('.auth-tab-premium').forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchTab(tab.dataset.tab);
            });
        });

        // Enlaces premium
        document.querySelectorAll('.switch-tab-premium').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchTab(link.dataset.tab);
            });
        });

        // Formularios
        DOM_CACHE.loginForm?.addEventListener('submit', (e) => this.handleLogin(e));
        DOM_CACHE.registerForm?.addEventListener('submit', (e) => this.handleRegister(e));
        DOM_CACHE.recoveryForm?.addEventListener('submit', (e) => this.handlePasswordRecovery(e));

        // Logout
        DOM_CACHE.logoutBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.logout();
        });

        // Enlace de contraseña olvidada
        const forgotLink = document.querySelector('.forgot-password');
        forgotLink?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showPasswordRecoveryModal();
        });

        // Enlaces "switch-tab" en el modal de recuperación
        document.querySelectorAll('#passwordRecoveryModal .switch-tab').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const tabName = link.getAttribute('data-tab');
                
                this.closePasswordRecoveryModal();
                
                // Abrir modal de autenticación y cambiar al tab correcto
                if (DOM_CACHE.authModal) {
                        document.getElementById('authModal').classList.add('active');
                    this.switchTab(tabName);
                }
            });
        });

        // Agregar botón de cerrar al modal de recuperación si no existe
        this.addCloseButtonToRecoveryModal();

        // Botón de login en alerta premium
        document.getElementById('loginBtn')?.addEventListener('click', () => {
            document.getElementById('premiumAlert')?.classList.remove('active');
                document.getElementById('authModal').classList.add('active');
        });
    },

    async handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const remember = document.getElementById('remember-me')?.checked || false;
        
        if (!email || !password) {
            NotificationManager.showError('Por favor completa todos los campos');
            return;
        }
        
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                 credentials: 'include', 
                body: JSON.stringify({ email, password, remember })
            });
            
            const data = await response.json();
            
            if (data.success) {
                currentUser = {
                    id: data.user.id,
                    name: data.user.nombre,
                    email: data.user.email
                };
                
                this.saveUserToStorage();
                this.updateUserUI();
                DOM_CACHE.authModal.style.display = 'none';
                NotificationManager.showSuccess('¡Bienvenido de vuelta!');
                location.reload();
            } else {
                NotificationManager.showError(data.message);
            }
        } catch (error) {
            console.error('Error en login:', error);
            NotificationManager.showError('Error de conexión. Inténtalo de nuevo.');
        }
    },

    async handleRegister(e) {
        e.preventDefault();
        
        const nombre = document.getElementById('register-name').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-confirm').value;
        const telefono = document.getElementById('register-telefono').value;
        const direccion = document.getElementById('register-direccion').value;
        const colonia = document.getElementById('register-colonia').value;
        const codigoPostal = document.getElementById('register-codigo-postal').value;
        const ciudad = document.getElementById('register-ciudad').value;
        const fechaNacimiento = document.getElementById('register-fecha-nacimiento').value;
        const genero = document.getElementById('register-genero').value;
        const preferenciaMarca = document.getElementById('register-preferencia-marca').value;
        const puntoEntrega = document.getElementById('register-punto-entrega').value;

        if (password !== confirmPassword) {
            NotificationManager.showError('Las contraseñas no coinciden');
            return;
        }

        try {
            const response = await fetch('/registernew', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nombre,
                    email,
                    password,
                    confirmPassword,
                    telefono,
                    direccion,
                    colonia,
                    codigoPostal,
                    ciudad,
                    fechaNacimiento,
                    genero,
                    preferenciaMarca,
                    puntoEntrega
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                NotificationManager.showSuccess('¡Registro exitoso! Ahora puedes iniciar sesión.');
                this.switchTab('login');
                DOM_CACHE.registerForm.reset();
            } else {
                NotificationManager.showError(data.message || 'Error en el registro');
            }
        } catch (error) {
            console.error('Error en el registro:', error);
            NotificationManager.showError('Error de conexión: ' + error.message);
        }
    },

    async handlePasswordRecovery(e) {
        e.preventDefault();
        const email = document.getElementById('recovery-email')?.value?.trim();
        
        if (!email) {
            NotificationManager.showError('Por favor ingresa tu correo electrónico');
            return;
        }

        // Validar formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            NotificationManager.showError('Por favor ingresa un correo electrónico válido');
            return;
        }
        
        const submitBtn = DOM_CACHE.recoveryForm?.querySelector('.auth-btn');
        if (!submitBtn) {
            console.error('Botón de envío no encontrado');
            return;
        }

        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Enviando...';
        submitBtn.disabled = true;
        
        try {
            const response = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            
            const data = await response.json();
            
            if (data.success) {
                NotificationManager.showSuccess('Se han enviado las instrucciones a tu correo electrónico');
                if (DOM_CACHE.passwordRecoveryModal) {
                    DOM_CACHE.passwordRecoveryModal.style.display = 'none';
                }
                if (DOM_CACHE.recoveryForm) {
                    DOM_CACHE.recoveryForm.reset();
                }
            } else {
                NotificationManager.showError(data.message || 'Error al enviar las instrucciones');
            }
        } catch (error) {
            console.error('Error en recuperación:', error);
            NotificationManager.showError('Error de conexión. Inténtalo de nuevo.');
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    },

    switchTab(tabType) {
        const authTabs = document.querySelectorAll('.auth-tab-premium');
        const authForms = document.querySelectorAll('.auth-form-premium');
        
        authTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabType);
        });

        authForms.forEach(form => {
            form.classList.remove('active');
        });

        const targetForm = document.getElementById(`${tabType}Form`);
        if (targetForm) {
            targetForm.classList.add('active');
        }

        const authHeader = document.querySelector('.auth-header h2');
        if (authHeader) {
            authHeader.textContent = tabType === 'login' ? 'Iniciar Sesión' : 'Registrarse';
        }
        // Animar entrada del formulario
        const activeForm = document.querySelector('.auth-form-premium.active');
        if (activeForm) {
            activeForm.style.opacity = '0';
            activeForm.style.transform = 'translateY(10px)';
            setTimeout(() => {
                activeForm.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                activeForm.style.opacity = '1';
                activeForm.style.transform = 'translateY(0)';
            }, 50);
        }
    },
    

    logout() {
        currentUser = null;
        localStorage.removeItem(CONFIG.USER_STORAGE_KEY);
        this.updateUserUI();
        CartManager.clearCart();
        NotificationManager.showSuccess('Sesión cerrada correctamente');
    },

    updateUserUI() {
        if (!DOM_CACHE.userIcon) return;

        if (currentUser) {
            DOM_CACHE.userIcon.innerHTML = currentUser.name.charAt(0).toUpperCase();
            DOM_CACHE.userIcon.style.cssText = `
                background-color: #00a650;
                color: white;
                font-weight: bold;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
        } else {
            DOM_CACHE.userIcon.innerHTML = '<i class="fas fa-user"></i>';
            DOM_CACHE.userIcon.style.cssText = `
                background-color: transparent;
                color: #333;
            `;
            if (DOM_CACHE.userMenu) {
                DOM_CACHE.userMenu.style.display = 'none';
            }
        }
    },

    saveUserToStorage() {
        try {
            localStorage.setItem(CONFIG.USER_STORAGE_KEY, JSON.stringify(currentUser));
        } catch (error) {
            console.error('Error al guardar usuario:', error);
        }
    },

    loadUserFromStorage() {
        try {
            const savedUser = localStorage.getItem(CONFIG.USER_STORAGE_KEY);
            if (savedUser) {
                currentUser = JSON.parse(savedUser);
                this.updateUserUI();
            }
        } catch (error) {
            console.error('Error al cargar usuario:', error);
        }
    },

    // Función para mostrar modal de recuperación
    showPasswordRecoveryModal() {
        if (DOM_CACHE.authModal) {
            DOM_CACHE.authModal.style.display = 'none';
        }
        if (DOM_CACHE.passwordRecoveryModal) {
            DOM_CACHE.passwordRecoveryModal.style.display = 'flex';
            
            // Enfocar el campo de email después de la animación
            setTimeout(() => {
                const emailInput = document.getElementById('recovery-email');
                if (emailInput) {
                    emailInput.focus();
                }
            }, 300);
        }
    },

    // Función para cerrar modal de recuperación
    closePasswordRecoveryModal() {
        if (DOM_CACHE.passwordRecoveryModal) {
            DOM_CACHE.passwordRecoveryModal.style.display = 'none';
        }
        if (DOM_CACHE.recoveryForm) {
            DOM_CACHE.recoveryForm.reset();
        }
    },

    // Agregar botón de cerrar al modal de recuperación
    addCloseButtonToRecoveryModal() {
        if (!DOM_CACHE.passwordRecoveryModal) return;
        
        // Verificar si ya existe un botón de cerrar
        const existingCloseBtn = DOM_CACHE.passwordRecoveryModal.querySelector('.close-recovery-btn');
        if (existingCloseBtn) return;
        
        const authHeader = DOM_CACHE.passwordRecoveryModal.querySelector('.auth-header');
        if (authHeader && !authHeader.querySelector('.close-recovery-btn')) {
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'close-recovery-btn';
            closeBtn.innerHTML = '✕';
            closeBtn.style.cssText = `
                position: absolute;
                top: 15px;
                right: 20px;
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #666;
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: all 0.2s ease;
            `;
            
            closeBtn.addEventListener('mouseenter', () => {
                closeBtn.style.backgroundColor = '#f0f0f0';
                closeBtn.style.color = '#333';
            });
            
            closeBtn.addEventListener('mouseleave', () => {
                closeBtn.style.backgroundColor = 'transparent';
                closeBtn.style.color = '#666';
            });
            
            closeBtn.addEventListener('click', () => {
                this.closePasswordRecoveryModal();
            });
            
            // Hacer el header relativo para posicionar el botón
            authHeader.style.position = 'relative';
            authHeader.appendChild(closeBtn);
        }
    }
};

// ========== GESTIÓN DE ZOOM EN IMÁGENES ==========
const ZoomManager = {
    // Inicializar zoom para todos los productos
    initZoomForProducts() {
        const imageContainers = document.querySelectorAll('.product-image-container');
        
        imageContainers.forEach(container => {
            const image = container.querySelector('.product-image');
            const lens = container.querySelector('.zoom-lens');
            if (image && lens) {
                this.initZoomForProduct(container, image, lens);
            }
        });
    },

    // Inicializar zoom para un producto específico
    initZoomForProduct(container, image, lens) {
    if (!container || !image || !lens) return;

    // Crear una imagen de alta resolución para el zoom
    const zoomImg = new Image();
    zoomImg.src = image.src;

    // Configurar estilos base del lente
    lens.style.display = 'none';
    lens.style.position = 'absolute';
    lens.style.width = '100px';
    lens.style.height = '100px';
    lens.style.border = '2px solid #fff';
    lens.style.borderRadius = '50%';
    lens.style.pointerEvents = 'none';
    lens.style.backgroundImage = `url(${image.src})`;
    lens.style.backgroundRepeat = 'no-repeat';
    lens.style.backgroundSize = `${container.offsetWidth * 2}px ${container.offsetHeight * 2}px`; // 2x zoom

    // Mostrar/ocultar lente
    container.addEventListener('mouseenter', () => {
        lens.style.display = 'block';
        container.querySelector('.zoom-indicator')?.classList.add('active');
    });

    container.addEventListener('mouseleave', () => {
        lens.style.display = 'none';
        container.querySelector('.zoom-indicator')?.classList.remove('active');
    });

    // Movimiento del lente
    container.addEventListener('mousemove', (e) => {
        const rect = container.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;

        const lensSize = 100;
        const bgSize = 2; // 2x zoom

        // Limitar lente dentro del contenedor
        const lensX = Math.max(0, Math.min(x - lensSize / 2, container.offsetWidth - lensSize));
        const lensY = Math.max(0, Math.min(y - lensSize / 2, container.offsetHeight - lensSize));

        lens.style.left = lensX + 'px';
        lens.style.top = lensY + 'px';

        // Mover fondo en proporción inversa
        const bgX = -lensX * bgSize;
        const bgY = -lensY * bgSize;
        lens.style.backgroundPosition = `${bgX}px ${bgY}px`;
    });

    // Soporte táctil
    container.addEventListener('touchstart', (e) => {
        e.preventDefault();
        lens.style.display = 'block';
        container.querySelector('.zoom-indicator')?.classList.add('active');
    });

    container.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = container.getBoundingClientRect();
        let x = touch.clientX - rect.left;
        let y = touch.clientY - rect.top;

        const lensSize = 100;
        const bgSize = 2;

        const lensX = Math.max(0, Math.min(x - lensSize / 2, container.offsetWidth - lensSize));
        const lensY = Math.max(0, Math.min(y - lensSize / 2, container.offsetHeight - lensSize));

        lens.style.left = lensX + 'px';
        lens.style.top = lensY + 'px';

        const bgX = -lensX * bgSize;
        const bgY = -lensY * bgSize;
        lens.style.backgroundPosition = `${bgX}px ${bgY}px`;
    });

    container.addEventListener('touchend', () => {
        lens.style.display = 'none';
        container.querySelector('.zoom-indicator')?.classList.remove('active');
    });
}
};

// ========== GESTIÓN DE PRODUCTOS ==========
const ProductManager = {
    init() {
        this.loadProducts();
    },

    async loadProducts() {
        try {
            await Promise.all([
                this.loadProductsWithTallas('originales'),
                this.loadProductsWithTallas('falsificaciones')
            ]);
            // Inicializar zoom después de cargar productos
            setTimeout(() => {
                ZoomManager.initZoomForProducts();
            }, 100);
        } catch (error) {
            console.error('Error al cargar productos:', error);
            NotificationManager.showError('Error al cargar productos');
        }
    },

    async loadProductsWithTallas(tipo) {
        try {
            const response = await fetch(`/api/productos/${tipo}`);
            const data = await response.json();
            
            if (data.success) {
                const containerId = tipo === 'originales' ? 'products-container-originales' : 'products-container-fake';
                this.renderProductsWithStock(data.data, containerId);
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            console.error(`Error al cargar productos ${tipo}:`, error);
        }
    },

    renderProductsWithStock(products, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const fragment = document.createDocumentFragment();

        products.forEach(product => {
            const productElement = this.createProductElementWithStock(product);
            fragment.appendChild(productElement);
        });

        container.innerHTML = '';
        container.appendChild(fragment);
        this.initZoomForProducts();
    },

    createProductElementWithStock(product) {
        const productDiv = document.createElement('div');
        productDiv.className = 'product-card-fake';
        
        // Crear HTML de tallas con stock
        const tallasHTML = this.createTallasWithStock(product.tallas_info || []);
        const productImage = Utils.getProductImage(product.nombre);
        
        // Determinar si el producto tiene stock
        const hasStock = product.tallas_info && product.tallas_info.some(t => t.stock > 0);
            
        productDiv.innerHTML = `
            <div class="product-image-container">
                ${!hasStock ? '<div class="out-of-stock-overlay">SIN STOCK</div>' : ''}
                <img src="${product.imagen_url || productImage}" 
                    alt="${product.nombre}"
                    class="product-image ${!hasStock ? 'out-of-stock' : ''}"
                    onerror="Utils.handleImageError(this)">
                <div class="zoom-lens"></div>
                <div class="zoom-indicator">Mueve el cursor para explorar</div>
            </div>
            <div class="product-info">
                <h3 class="product-name">${product.nombre}</h3>
                <p class="product-description">${product.descripcion || ''}</p>
                
                <div class="product-price-section">
                    <div class="current-price-container">
                        <span class="product-price">${Utils.formatPrice(product.precio)}</span>
                        <span class="original-price">${(product.precio * 1.25).toFixed(2)} MXN</span>
                        <span class="discount-badge">20% OFF</span>
                    </div>
                </div>
                
                <div class="product-features">
                    <span class="feature-tag material">🔥 Materiales de Calidad</span>
                    <span class="feature-tag boost">👟 Imagenes Reales</span>
                </div>

                <div class="rating">
                    <span class="stars">⭐⭐⭐⭐⭐</span>
                </div>
            
                <div class="product-details">
                    <div class="tallas-container">
                        <strong>Tallas disponibles:</strong>
                        <div class="tallas-list">${tallasHTML}</div>
                       
                    </div>
                </div>
                
                <button class="add-to-cart-btn" 
                    data-id="${product.codigo}"
                    data-name="${product.nombre}"
                    data-price="${product.precio}"
                    data-image="${productImage}"
                    ${!hasStock ? 'disabled' : ''}
                    disabled>
                    <i class="fas fa-shopping-cart"></i> 
                    ${!hasStock ? 'Sin Stock' : 'Selecciona una talla'}
                </button>
            </div>
            <div class="delivery-info">
                <span class="delivery-icon">🚚</span>
                <div class="delivery-text">
                    <span>Entregas: Miercoles y Sabado</span>
                </div>
            </div>
        `;

        this.bindProductEventsWithStock(productDiv, product);
        return productDiv;
    },

    createTallasWithStock(tallasInfo) {
        if (!Array.isArray(tallasInfo)) return '';
        
        return tallasInfo.map(tallaInfo => {
            const isAvailable = tallaInfo.stock > 0 && tallaInfo.activo;
            const stockText = tallaInfo.stock <= 5 ? ` (${tallaInfo.stock})` : '';
            
            return `<button class="talla-btn ${!isAvailable ? 'no-stock' : ''}" 
                        data-talla="${tallaInfo.talla}"
                        data-stock="${tallaInfo.stock}"
                        ${!isAvailable ? 'disabled' : ''}>
                        ${tallaInfo.talla}${stockText}
                    </button>`;
        }).join('');
    },

    bindProductEventsWithStock(productElement, product) {
        const tallaBtns = productElement.querySelectorAll('.talla-btn:not(.no-stock)');
        const addToCartBtn = productElement.querySelector('.add-to-cart-btn');
        let selectedTalla = null;
        let selectedStock = 0;
        
        // Inicializar zoom
        const imageContainer = productElement.querySelector('.product-image-container');
        const image = productElement.querySelector('.product-image');
        const lens = productElement.querySelector('.zoom-lens');

        // Inicializar zoom para este producto específico
        if (imageContainer && image && lens) {
            ZoomManager.initZoomForProduct(imageContainer, image, lens);
        }

        // Manejar selección de tallas
        tallaBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                tallaBtns.forEach(b => b.classList.remove('selected'));
                this.classList.add('selected');
                
                selectedTalla = this.dataset.talla;
                selectedStock = parseInt(this.dataset.stock);
                
                if (addToCartBtn) {
                    addToCartBtn.disabled = false;
                    addToCartBtn.innerHTML = '<i class="fas fa-shopping-cart"></i> Agregar al Carrito';
                    addToCartBtn.dataset.selectedTalla = selectedTalla;
                }                
            });
        });

        // Manejar agregar al carrito
        addToCartBtn?.addEventListener('click', (e) => {
            const button = e.target;
            
            if (!selectedTalla) {
                NotificationManager.showError('Por favor selecciona una talla');
                return;
            }
            
            const productData = {
                id: button.dataset.id,
                name: button.dataset.name,
                price: parseFloat(button.dataset.price),
                image: button.dataset.image,
                selectedSize: selectedTalla,
                stock: selectedStock
            };

            const success = CartManager.addProduct(productData);
            
            if (success) {
                // Feedback visual
                const originalText = button.innerHTML;
                button.innerHTML = '✓ Agregado';
                button.style.backgroundColor = '#4CAF50';
                
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.style.backgroundColor = '';
                }, 2000);
                
                // Actualizar display de stock
                const tallaBtn = productElement.querySelector(`[data-talla="${selectedTalla}"]`);
                if (tallaBtn && selectedStock > 0) {
                    const newStock = selectedStock - 1;
                    tallaBtn.dataset.stock = newStock;
                    if (newStock <= 5) {
                        tallaBtn.textContent = `${selectedTalla} (${newStock})`;
                    }
                    if (newStock === 0) {
                        tallaBtn.classList.add('no-stock');
                        tallaBtn.disabled = true;
                    }
                }
            }
        });
    }
};

// ========== GESTIÓN DE NAVEGACIÓN MÓVIL ==========
const NavigationManager = {
    init() {
        this.bindEvents();
    },

    bindEvents() {
        const mobileNavToggle = document.querySelector('.mobile-nav-toggle');
        const mainNav = document.querySelector('.main-nav');
        const navLinks = document.querySelectorAll('.nav-links a');

        if (mobileNavToggle && mainNav) {
            mobileNavToggle.addEventListener('click', () => {
                mainNav.classList.toggle('active');
                mobileNavToggle.classList.toggle('active');
                document.body.style.overflow = mainNav.classList.contains('active') ? 'hidden' : '';
            });
        }

        // Cerrar menú al hacer clic en enlaces
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                if (link.getAttribute('href').startsWith('#')) {
                    e.preventDefault();
                    this.closeMenu(mainNav, mobileNavToggle);
                    this.scrollToSection(link.getAttribute('href'));
                } else {
                    this.closeMenu(mainNav, mobileNavToggle);
                }
            });
        });
    },

    closeMenu(mainNav, mobileNavToggle) {
        if (mainNav && mobileNavToggle) {
            mainNav.classList.remove('active');
            mobileNavToggle.classList.remove('active');
            document.body.style.overflow = '';
        }
    },

    scrollToSection(targetId) {
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
            window.scrollTo({
                top: targetElement.offsetTop - 80,
                behavior: 'smooth'
            });
        }
    }
};

// ========== GESTIÓN DE FORMULARIOS ==========
const FormManager = {
    init() {
        this.initContactForm();
    },

    initContactForm() {
        const contactForm = document.getElementById('contact-form');
        const formResponse = document.getElementById('form-response');

        if (!contactForm) return;

        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (formResponse) {
                formResponse.textContent = 'Enviando...';
                formResponse.className = 'form-response';
            }

            const formData = {
                nombre: contactForm.nombre.value,
                email: contactForm.email.value,
                mensaje: contactForm.mensaje.value
            };

            try {
                const response = await fetch('/registrar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                const result = await response.json();

                if (result.success) {
                    if (formResponse) {
                        formResponse.textContent = result.message;
                        formResponse.classList.add('success');
                    }
                    contactForm.reset();
                    NotificationManager.showSuccess('Mensaje enviado correctamente');
                } else {
                    throw new Error(result.message);
                }

            } catch (error) {
                const errorMessage = `Error: ${error.message || 'No se pudo enviar el mensaje.'}`;
                if (formResponse) {
                    formResponse.textContent = errorMessage;
                    formResponse.classList.add('error');
                }
                NotificationManager.showError(errorMessage);
            }
        });
    }
};

// ========== GESTIÓN DE PAYPAL ==========
const PayPalManager = {
    isLoaded: false,
    clientId: null,

    async init() {
        try {
            const response = await fetch('/api/paypal-config', {
                credentials: 'include'
            });

            if (!response.ok) throw new Error('No autorizado');

            const data = await response.json();
            this.clientId = data.clientId;

            if (!this.clientId) throw new Error('Client ID no disponible');

            await this.loadPayPalSDK();
            this.isLoaded = true;
            console.log('✅ PayPal SDK cargado correctamente');
        } catch (error) {
            console.error('❌ Error al cargar PayPal:', error);
        }
    },

    async loadPayPalSDK() {
        return new Promise((resolve, reject) => {
            if (window.paypal) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = `https://www.paypal.com/sdk/js?client-id=${this.clientId}&currency=MXN&locale=es_MX`;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Error al cargar SDK de PayPal'));
            document.head.appendChild(script);
        });
    },

    renderButtons(containerId, cartItems, onSuccess, onError) {
        if (!this.isLoaded || !window.paypal) {
            console.warn('PayPal SDK no está listo');
            return;
        }

        const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

        window.paypal.Buttons({
            createOrder: async () => {
                const response = await fetch('/api/paypal/create-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ items: cartItems })
                });

                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.message || 'Error al crear orden');
                return data.orderID;
            },

            onApprove: async (data) => {
                // 1. Capturar el pago
                const captureResponse = await fetch('/api/paypal/capture-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ orderID: data.orderID })
                });

                const captureResult = await captureResponse.json();

                if (!captureResponse.ok || !captureResult.success) {
                    onError(captureResult.message || 'Error al capturar pago');
                    return;
                }

                // 2. Crear pedido en BD
                const crearPedidoResponse = await fetch('/api/crear-pedido', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        items: cartItems,
                        montoTotal: cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
                    })
                });

                const pedidoData = await crearPedidoResponse.json();

                if (!crearPedidoResponse.ok || !pedidoData.success) {
                    NotificationManager.showError('Error al crear pedido en base de datos');
                    return;
                }

                // 3. Todo OK → redirigir
                NotificationManager.showSuccess('✅ Pago realizado con éxito');
                CartManager.closeCart();
                const customerName = encodeURIComponent(currentUser?.name || 'Cliente');
                window.location.href = `/confirmacion_pago.html?pedido=${pedidoData.pedidoId}&nombre=${customerName}`;
            },

            onError: (err) => {
                console.error('Error en PayPal:', err);
                onError('Error al procesar el pago');
            }
        }).render(containerId);
    }
};

// ========== OPTIMIZACIONES DE RENDIMIENTO ==========
const PerformanceOptimizer = {
    init() {
        this.setupLazyLoading();
        this.setupIntersectionObserver();
        this.preloadCriticalResources();
    },

    setupLazyLoading() {
        // Lazy loading para imágenes
        const images = document.querySelectorAll('img[data-src]');
        
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                        observer.unobserve(img);
                    }
                });
            }, {
                rootMargin: '50px'
            });

            images.forEach(img => imageObserver.observe(img));
        }
    },

    setupIntersectionObserver() {
        // Observer para animaciones al hacer scroll
        const animatedElements = document.querySelectorAll('.animate-on-scroll');
        
        if ('IntersectionObserver' in window && animatedElements.length > 0) {
            const animationObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('animated');
                    }
                });
            }, {
                threshold: 0.1
            });

            animatedElements.forEach(el => animationObserver.observe(el));
        }
    },

    preloadCriticalResources() {
        // Precargar recursos críticos
        const criticalImages = [
            './images/logo.png',
            './images/hero-banner.jpg'
        ];

        criticalImages.forEach(src => {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.href = src;
            document.head.appendChild(link);
        });
    }
};

// ========== GESTIÓN DE ERRORES GLOBAL ==========
const ErrorHandler = {
    init() {
        window.addEventListener('error', this.handleError.bind(this));
        window.addEventListener('unhandledrejection', this.handlePromiseRejection.bind(this));
    },

    handleError(event) {
        console.error('Error capturado:', event.error);
        // Puedes enviar el error a un servicio de logging aquí
        this.logError(event.error);
    },

    handlePromiseRejection(event) {
        console.error('Promise rechazada:', event.reason);
        this.logError(event.reason);
        event.preventDefault();
    },

    logError(error) {
        // Aquí puedes implementar logging a servicios externos
        // Como Sentry, LogRocket, etc.
        if (typeof error === 'object' && error.message) {
            console.error(`Error: ${error.message}`, error.stack);
        }
    }
};

// ========== FUNCIONES GLOBALES PARA COMPATIBILIDAD ==========
window.handleImageError = Utils.handleImageError;
window.formatPrice = Utils.formatPrice;
window.showPremiumAlert = NotificationManager.showPremiumAlert;

// ========== INICIALIZACIÓN PRINCIPAL ==========
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Inicializando aplicación...');
    try {

        // Inicializar todos los managers en orden
        ErrorHandler.init();
        AuthManager.init();
        PayPalManager.init();
        CartManager.init();
        NavigationManager.init();
        FormManager.init();
        ProductManager.init();
        PerformanceOptimizer.init();
        
        console.log('✅');
        
        
    } catch (error) {
        console.error('❌ Error durante la inicialización:', error);
        NotificationManager.showError('Error al cargar la aplicación');
    }
});

// ========== CLEANUP AL DESCARGAR LA PÁGINA ==========
window.addEventListener('beforeunload', () => {
    // Guardar estado antes de cerrar
    CartManager.saveToStorage();
    AuthManager.saveUserToStorage();
});

// ========== EXPORTAR PARA DEBUGGING ==========
if (window.location.hostname === 'localhost') {
    window.DEBUG = {
        CartManager,
        AuthManager,
        ProductManager,
        NotificationManager,
        Utils,
        currentUser: () => currentUser,
        cart: () => cart,
        config: CONFIG
    };
    console.log('🔧 Modo debug habilitado. Usa window.DEBUG para acceder a los managers.');
}