// Global değişkenler
let currentUser = null;
let socket = null;
let selectedUser = null;
let allUsers = [];

const SCREEN_STATE_KEY = 'currentScreen';
const USER_DATA_KEY = 'userData';

// Sunucu URL'sini dinamik olarak ayarla
// Dynamically set server URL
const getServerUrl = () => {
    return window.location.origin;
};

const SERVER_URL = getServerUrl();

async function fetchAllUsers() {
    try {
        const response = await fetch(`${SERVER_URL}/api/users`, {  // Fixed template literal
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        if (data.success) {
            allUsers = data.users;
            return allUsers;
        }
        return [];
    } catch (error) {
        console.error('Error fetching users:', error);
        alert('Error fetching user list');
        return [];
    }
}
function updateUsersList(onlineUsers) {
    const usersList = document.getElementById('users-list');
    if (!usersList) return;

    const previousScrollTop = usersList.scrollTop;
    usersList.innerHTML = '';

    allUsers.forEach(user => {
        if (user.userId !== currentUser.id) {
            const isOnline = onlineUsers.some(onlineUser => onlineUser.id === user.userId);
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
                ${user.firstName} ${user.lastName} ${isOnline ? ' (online)' : ' (offline)'}
            `;
            li.onclick = () => selectUser(user);
            li.setAttribute('data-user-id', user.userId);
            if (selectedUser && selectedUser.userId === user.userId) {
                li.classList.add('selected-user');
            }
            usersList.appendChild(li);
        }
    });

    usersList.scrollTop = previousScrollTop;
    
    const currentUserName = document.getElementById('current-user-name');
    if (currentUserName) {
        currentUserName.textContent = `${currentUser.firstName} ${currentUser.lastName}`;
    }
}

// Mesaj yükleme fonksiyonu
async function loadUserMessages(userId) {
    try {
        const response = await fetch(`${SERVER_URL}/api/messages/${userId}`);
        const data = await response.json();
        if (data.success) {
            const messageContainer = document.getElementById('message-container');
            if (!messageContainer) return;

            messageContainer.innerHTML = '';

            data.messages.forEach(msg => {
                if ((msg.sender_id === currentUser.id && msg.receiver_id === selectedUser.userId) ||
                    (msg.sender_id === selectedUser.userId && msg.receiver_id === currentUser.id)) {
                    displayMessage({
                        messageId: msg.id,
                        senderId: msg.sender_id,
                        message: msg.message_content,
                        senderName: `${msg.senderFirstName} ${msg.senderLastName}`,
                        timestamp: new Date(msg.sent_at),
                        status: msg.status
                    });
                }
            });

            scrollToBottom(messageContainer);

            // Mesajları yükledikten sonra delivered olanları read olarak işaretle
            if (socket) {
                socket.emit('chat-room-entered', {
                    senderId: selectedUser.userId,
                    receiverId: currentUser.id
                });
            }
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}
// Update loadBroadcastMessages function
async function loadBroadcastMessages() {
    try {
        const response = await fetch(`${SERVER_URL}/api/broadcast-messages`);
        const data = await response.json();
        if (data.success) {
            const broadcastContainer = document.getElementById('broadcast-container');
            broadcastContainer.innerHTML = '';
            
            data.messages.forEach(msg => {
                displayBroadcastMessage({
                    id: msg.id,
                    senderId: msg.sender_id,
                    message: msg.message_content,
                    senderName: `${msg.firstName} ${msg.lastName}`,
                    timestamp: new Date(msg.sent_at)
                });
            });
        }
    } catch (error) {
        console.error('Error loading broadcast messages:', error);
    }
}
// API çağrıları için fetch fonksiyonunu güncelle
async function fetchWithTimeout(url, options = {}) {
    const timeout = 5000; // 5 saniye timeout
    
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        if (error.name === 'AbortError') {
            throw new Error('Sunucuya bağlanılamıyor: Zaman aşımı');
        }
        throw error;
    }
}
// Socket bağlantısını başlat
function initializeSocket(user) {
    if (socket) {
        socket.disconnect();
    }

    socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });
    
    // Bağlantı hatası durumunda
    socket.on('connect_error', (error) => {
        console.error('Bağlantı hatası:', error);
        alert('Sunucuya bağlanılamıyor. Lütfen ağ bağlantınızı kontrol edin.');
    });

    // Normal socket olayları
    socket.on('connect', () => {
        socket.emit('user-connected', user);
    });


    socket.on('update-online-users', (users) => {
        updateUsersList(users);
    });

    // Socket.io broadcast eventi
socket.on('receive-message', (data) => {
    if ((data.senderId === currentUser.id && data.receiverId === selectedUser?.userId) ||
        (data.senderId === selectedUser?.userId && data.receiverId === currentUser.id)) {
        displayMessage({
            ...data,
            isBroadcast: data.isBroadcast || false
        });
        
        if (data.senderId !== currentUser.id) {
            socket.emit('message-seen', data.messageId);
        }
    }
});

    socket.on('message-status-update', (data) => {
        updateMessageStatus(data);
    });
}
// Mesaj gönderme işlemi
function sendMessage(e) {
    e.preventDefault();
    
    const messageInput = document.getElementById('message-input');
    const message = messageInput.value.trim();
    
    // Kullanıcı seçili değilse ve mesaj boşsa, işlemi durdur
    if (!selectedUser) {
        alert('Lütfen bir kullanıcı seçin.');
        return;
    }
    
    // Boş mesaj kontrolü
    if (!message || message.length === 0) {
        return; // Boş mesajda alert gösterme, sadece göndermeyi engelle
    }

    if (socket) {
        socket.emit('send-message', {
            senderId: currentUser.id,
            receiverId: selectedUser.userId,
            message: message
        });
        messageInput.value = '';
        messageInput.focus();
    } else {
        console.error('Socket bağlantısı bulunamadı.');
        alert('Bağlantı hatası! Lütfen sayfayı yenileyin.');
    }
}
// Yayın mesajı gönderme işlemi
function sendBroadcast(e) {
    e.preventDefault();
    
    const broadcastInput = document.getElementById('broadcast-input');
    const message = broadcastInput.value.trim();

    if (!message) {
        alert('Lütfen bir mesaj yazın.');
        return;
    }

    if (!currentUser) {
        alert('Oturum hatası! Lütfen yeniden giriş yapın.');
        return;
    }

    if (socket) {
        socket.emit('send-broadcast', {
            senderId: currentUser.id,
            message: message
        });
        broadcastInput.value = '';
        broadcastInput.focus();
    } else {
        console.error('Socket bağlantısı bulunamadı.');
        alert('Bağlantı hatası! Lütfen sayfayı yenileyin.');
    }
}

// Çıkış yapma işlemi
function handleLogout() {
    if (currentUser && socket) {
        socket.emit('user-disconnected', currentUser.id);
    }
    
    localStorage.removeItem(USER_DATA_KEY);
    localStorage.setItem(SCREEN_STATE_KEY, 'login');
    
    currentUser = null;
    socket?.disconnect();
    socket = null;
    selectedUser = null;
    
    const broadcastToggle = document.querySelector('.broadcast-toggle');
    const broadcastSection = document.getElementById('broadcastSection');
    
    if (broadcastToggle) broadcastToggle.style.display = 'none';
    if (broadcastSection) broadcastSection.style.display = 'none';
    
    showLoginHandler();
}

function updateMessageStatus(data, isBroadcast) {
    const messageDiv = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageDiv) {
        const statusSpan = messageDiv.querySelector(isBroadcast ? '.broadcast-status' : '.message-status');
        if (statusSpan) {
            statusSpan.textContent = getStatusIcon(data.status);
        }
    }
}

function selectUser(user) {
    selectedUser = user;
    document.querySelectorAll('#users-list li').forEach(li => {
        li.classList.remove('selected-user');
    });
    const selectedLi = document.querySelector(`[data-user-id="${user.userId}"]`);
    if (selectedLi) {
        selectedLi.classList.add('selected-user');
    }

    document.getElementById('message-form').style.display = 'flex';
    document.getElementById('chat-header').innerText = `Chat with ${user.firstName} ${user.lastName}`;
    
    // Sohbet odasına girildiğinde socket'e bildir
    if (socket) {
        socket.emit('chat-room-entered', {
            senderId: selectedUser.userId,
            receiverId: currentUser.id
        });
    }
    
    loadUserMessages(selectedUser.userId);
}

// Mesaj görüntüleme fonksiyonunu güncelle
function displayMessage(data) {
    const messageContainer = document.getElementById('message-container');
    if (!messageContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${data.senderId === currentUser.id ? 'message-sent' : 'message-received'}`;
    if (data.isBroadcast) {
        messageDiv.classList.add('message-broadcast');
    }
    messageDiv.setAttribute('data-message-id', data.messageId);
    
    const time = new Date(data.timestamp).toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit'
    });

    const broadcastBadge = data.isBroadcast ? '<span class="broadcast-badge">Yayın Mesajı</span>' : '';

    messageDiv.innerHTML = `
        <div class="message-content">
            ${broadcastBadge}
            ${data.message}
        </div>
        <div class="message-info">
            ${data.senderName} - ${time}
            ${data.senderId === currentUser.id ? 
                `<span class="message-status">${getStatusIcon(data.status)}</span>` : 
                ''}
        </div>
    `;
    
    messageContainer.appendChild(messageDiv);
    scrollToBottom(messageContainer);
}

function scrollToBottom(container) {
    const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 1;
    
    if (isScrolledToBottom) {
        container.scrollTop = container.scrollHeight;
    }
}
// Add scroll observer
function initializeScrollObserver() {
    const messageContainer = document.getElementById('message-container');
    if (!messageContainer) return;

    const observer = new MutationObserver(() => {
        if (messageContainer.lastElementChild) {
            messageContainer.lastElementChild.scrollIntoView({ behavior: 'smooth' });
        }
    });

    observer.observe(messageContainer, { childList: true });
}



function displayBroadcastMessage(data) {
    const broadcastContainer = document.getElementById('broadcast-container');
    if (!broadcastContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'broadcast-message';
    messageDiv.setAttribute('data-message-id', data.messageId);
    
    const time = new Date(data.timestamp).toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit'
    });

    messageDiv.innerHTML = `
        <div class="broadcast-content">${data.message}</div>
        <div class="broadcast-info">
            ${data.senderName} - ${time}
            ${data.senderId === currentUser.id ? 
                `<span class="broadcast-status">${getStatusIcon(data.status)}</span>` : 
                ''}
        </div>
    `;
    
    broadcastContainer.insertBefore(messageDiv, broadcastContainer.firstChild);
}

function getStatusIcon(status) {
    switch(status) {
        case 'sent': return '✓';
        case 'delivered': return '✓✓';
        case 'read': return '✓✓ read';
        default: return '';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    checkStoredUserAndInitialize();
});

function setupEventListeners() {
    // In setupEventListeners function, replace the existing event listener setup with:
document.getElementById('loginContainer').addEventListener('click', (e) => {
    if (e.target.matches('[data-action="show-register"]')) {
        e.preventDefault();
        showRegisterHandler();
    }
});

document.getElementById('registerContainer').addEventListener('click', (e) => {
    if (e.target.matches('[data-action="show-login"]')) {
        e.preventDefault();
        showLoginHandler();
    }
});
 
        // Login form event listener
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch(`${SERVER_URL}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        const result = await response.json();
        if (result.success) {
            currentUser = result.user;
            localStorage.setItem(USER_DATA_KEY, JSON.stringify(currentUser));
            await fetchAllUsers();
            initializeSocket(currentUser);
            showChatScreen();
            loginForm.reset();
        } else {
            alert(result.message || 'Giriş başarısız!');
        }
    } catch (error) {
        console.error('Giriş hatası:', error);
        alert('Bağlantı hatası. Lütfen tekrar deneyin.');
    }
});


        // Register form event listener
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const firstName = document.getElementById('firstName').value;
    const lastName = document.getElementById('lastName').value;
    const email = document.getElementById('email').value;
    const phone = document.getElementById('phone').value;
    const password = document.getElementById('password').value;
    
    try {
        const response = await fetch(`${SERVER_URL}/api/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                firstName,
                lastName,
                email,
                phone,
                password
            })
        });
        
        const result = await response.json();
        alert(result.message);
        
        if (result.success) {
            showLoginHandler();
            registerForm.reset();
        }
    } catch (error) {
        console.error('Kayıt hatası:', error);
        alert('Kayıt işlemi başarısız. Lütfen tekrar deneyin.');
    }
});
    // Navigation links
    document.querySelectorAll('[data-action="show-register"]').forEach(link => {
        link.addEventListener('click', showRegisterHandler);
    });

    document.querySelectorAll('[data-action="show-login"]').forEach(link => {
        link.addEventListener('click', showLoginHandler);
    });

    // Logout button
    const logoutButton = document.querySelector('.btn-logout');
    if (logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }

    // Message form
    const messageForm = document.getElementById('message-form');
    if (messageForm) {
        messageForm.addEventListener('submit', sendMessage);
    }

    // Broadcast form
    const broadcastForm = document.getElementById('broadcast-form');
    if (broadcastForm) {
        broadcastForm.addEventListener('submit', sendBroadcast);
    }
    // Handle users list scroll
    const usersList = document.getElementById('users-list');
    if (usersList) {
        usersList.removeEventListener('wheel', handleUsersListScroll);
        usersList.addEventListener('wheel', handleUsersListScroll);
    }

    // Handle message container scroll
    const messageContainer = document.getElementById('message-container');
    if (messageContainer) {
        messageContainer.addEventListener('scroll', handleMessageContainerScroll);
    }
}
function handleMessageContainerScroll() {
    const messageContainer = this;
    const isScrolledToBottom = messageContainer.scrollHeight - messageContainer.clientHeight <= messageContainer.scrollTop + 1;
    localStorage.setItem('autoScroll', isScrolledToBottom.toString());
}

function checkStoredUserAndInitialize() {
    const storedUser = localStorage.getItem(USER_DATA_KEY);
    if (storedUser) {
        currentUser = JSON.parse(storedUser);
        fetchAllUsers().then(() => {
            initializeSocket(currentUser);
            showChatScreen();
        });
    } else {
        showLoginHandler();
    }
}

function handleUsersListScroll(e) {
    const container = e.currentTarget;
    const isAtBottom = container.scrollHeight - container.scrollTop === container.clientHeight;
    
    if (!isAtBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

// Login işlemini yönetecek ana fonksiyon
function initializeLoginForm() {
    const loginForm = document.getElementById('loginForm');
    if (!loginForm) return;

    // Mevcut event listener'ları temizle
    const newForm = loginForm.cloneNode(true);
    loginForm.parentNode.replaceChild(newForm, loginForm);

    // Yeni event listener ekle
    newForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        if (!email || !password) {
            alert('Lütfen email ve şifrenizi giriniz.');
            return;
        }

        try {
            const response = await fetch(`${SERVER_URL}/api/login`, {  // Düzeltilen kısım
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const result = await response.json();

            if (result.success) {
                currentUser = result.user;
                localStorage.setItem(USER_DATA_KEY, JSON.stringify(currentUser));
                await fetchAllUsers();
                initializeSocket(currentUser);
                showChatScreen();
                newForm.reset();
            } else {
                alert(result.message || 'Giriş başarısız!');
            }
        } catch (error) {
            console.error('Giriş hatası:', error);
            alert('Bağlantı hatası. Lütfen tekrar deneyin.');
        }
    });
}
    // Register işlemini yönetecek ana fonksiyon
    function initializeRegisterForm() {
        const registerForm = document.getElementById('registerForm');
        if (!registerForm) return;
    
        const newForm = registerForm.cloneNode(true);
        registerForm.parentNode.replaceChild(newForm, registerForm);
    
        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
    
            const firstName = document.getElementById('firstName')?.value;
            const lastName = document.getElementById('lastName')?.value;
            const email = document.getElementById('email')?.value;
            const phone = document.getElementById('phone')?.value;
            const password = document.getElementById('password')?.value;
    
            if (!firstName || !lastName || !email || !password) {
                alert('Lütfen tüm zorunlu alanları doldurunuz.');
                return;
            }
    
            try {
                const response = await fetch(`${SERVER_URL}/api/register`, {  // Düzeltilen kısım
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        firstName,
                        lastName,
                        email,
                        phone,
                        password
                    })
                });
    
                const result = await response.json();
                alert(result.message);
    
                if (result.success) {
                    showLoginHandler();
                    newForm.reset();
                }
            } catch (error) {
                console.error('Registration error:', error);
                alert('Kayıt işlemi başarısız. Lütfen tekrar deneyin.');
            }
        });
    }
    function initializeMessageForm() {
        const messageForm = document.getElementById('message-form');
        if (!messageForm) return;
    
        messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            if (!selectedUser) {
                alert('Lütfen bir kullanıcı seçin.');
                return;
            }
    
            const messageInput = document.getElementById('message-input');
            const message = messageInput.value.trim();
    
            if (!message || message.length === 0) {
                return; // Boş mesajda alert gösterme, sadece göndermeyi engelle
            }
    
            if (socket) {
                socket.emit('send-message', {
                    senderId: currentUser.id,
                    receiverId: selectedUser.userId,
                    message: message
                });
                messageInput.value = '';
                messageInput.focus();
            }
        });
    }

function initializeBroadcastForm() {
    const broadcastForm = document.getElementById('broadcast-form');
    if (!broadcastForm) return;

    broadcastForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const broadcastInput = document.getElementById('broadcast-input');
        const message = broadcastInput.value.trim();

        if (!message || !currentUser) return;

        if (socket) {
            socket.emit('send-broadcast', {
                senderId: currentUser.id,
                message: message
            });
            broadcastInput.value = '';
        }
    });
}

// Ekranları gösteren fonksiyonlar
function showChatScreen() {
    localStorage.setItem(SCREEN_STATE_KEY, 'chat');
    const registerContainer = document.getElementById('registerContainer');
    const loginContainer = document.getElementById('loginContainer');
    const mainContainer = document.getElementById('main-container');
    
    if (registerContainer) registerContainer.style.display = 'none';
    if (loginContainer) loginContainer.style.display = 'none';
    if (mainContainer) mainContainer.style.display = 'block';
    
    // Update current user display
    const currentUserName = document.getElementById('current-user-name');
    if (currentUserName && currentUser) {
        currentUserName.textContent = `${currentUser.firstName} ${currentUser.lastName}`;
    }
}


function toggleBroadcast() {
    const broadcastSection = document.getElementById('broadcastSection');
    const currentDisplay = broadcastSection.style.display;
    broadcastSection.style.display = currentDisplay === 'none' || !currentDisplay ? 'block' : 'none';
    if (broadcastSection.style.display === 'block') {
        loadBroadcastMessages();
    }
}
// Event handler fonksiyonları
function showRegisterHandler(e) {
    if (e) e.preventDefault();
    const registerContainer = document.getElementById('registerContainer');
    const loginContainer = document.getElementById('loginContainer');
    const mainContainer = document.getElementById('main-container');
    
    if (registerContainer && loginContainer && mainContainer) {
        loginContainer.style.display = 'none';
        mainContainer.style.display = 'none';
        registerContainer.style.display = 'block';
    }
}

function showLoginHandler(e) {
    if (e) e.preventDefault();
    const registerContainer = document.getElementById('registerContainer');
    const loginContainer = document.getElementById('loginContainer');
    const mainContainer = document.getElementById('main-container');
    
    if (registerContainer && loginContainer && mainContainer) {
        registerContainer.style.display = 'none';
        mainContainer.style.display = 'none';
        loginContainer.style.display = 'block';
    }
}

// Uygulamayı başlatan fonksiyon
function initializeApp() {
    // Sayfa yüklendiğinde
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupInitialState);
    } else {
        setupInitialState();
    }
}

// Başlangıç durumunu ayarlayan fonksiyon
function setupInitialState() { 
    initializeLoginForm();
    initializeRegisterForm();
    initializeMessageForm();
    initializeBroadcastForm();

    // Kayıtlı kullanıcı kontrolü
    const storedUser = localStorage.getItem(USER_DATA_KEY);
    if (storedUser) {
        currentUser = JSON.parse(storedUser);
        fetchAllUsers().then(() => {
            initializeSocket(currentUser);
            showChatScreen();
        });
    } else {
        showLoginHandler();
    }
    // Add at the end of setupInitialState function
document.getElementById('loginContainer').style.display = 'block';
document.getElementById('registerContainer').style.display = 'none';
document.getElementById('main-container').style.display = 'none';

// Replace lines around 594-602 that have:
document.querySelectorAll('[data-action="show-register"]').forEach(link => {
    link.addEventListener('click', showRegisterHandler);
});

document.querySelectorAll('[data-action="show-login"]').forEach(link => {
    link.addEventListener('click', showLoginHandler);
});
}

// Uygulamayı başlat
initializeApp();

// Çıkış yap
function logout() {
    localStorage.removeItem(USER_DATA_KEY);
    localStorage.setItem(SCREEN_STATE_KEY, 'login');
    
    currentUser = null;
    socket?.disconnect();
    socket = null;
    selectedUser = null;

    // Safely access and hide elements
    const broadcastToggle = document.querySelector('.broadcast-toggle');
    const broadcastSection = document.getElementById('broadcastSection');
    const mainContainer = document.getElementById('main-container');
    const loginContainer = document.getElementById('loginContainer');

    if (broadcastToggle) broadcastToggle.style.display = 'none';
    if (broadcastSection) broadcastSection.style.display = 'none';
    if (mainContainer) mainContainer.style.display = 'none';
    if (loginContainer) loginContainer.style.display = 'block';

    // Reset forms if they exist
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.reset();

    initializeLoginForm(); // Reinitialize login form handlers
}
