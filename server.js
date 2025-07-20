const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const os = require('os'); // Ağ arayüzlerini algılamak için eklendi

const app = express();
const server = http.createServer(app);

// CORS ayarları
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
    optionsSuccessStatus: 200
}));

// JSON body parser
app.use(express.json());

// Statik dosyaları sunmak için
app.use(express.static(path.join(__dirname, 'public')));

// Ana route için index.html'i sun
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO CORS ayarları
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
    },
    transports: ['websocket', 'polling']
});

// Veritabanı bağlantı ayarları
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'ebra123',
    database: 'kayit',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Veritabanı bağlantı havuzu 
const pool = mysql.createPool(dbConfig);

// Veritabanı bağlantı testi
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('Veritabanı bağlantısı başarılı!');
        connection.release();
        return true;
    } catch (err) {
        console.error('Veritabanı bağlantı hatası:', err);
        return false;
    }
}
// Yerel IP adresi alma fonksiyonu
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const interface of interfaces[name]) {
            if (interface.family === 'IPv4' && !interface.internal) {
                return interface.address;
            }
        }
    }
    return 'localhost';
}

// API Routes
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const [users] = await pool.execute(
            "SELECT * FROM users WHERE email = ?",
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Kullanıcı bulunamadı!'
            });
        }

        const user = users[0];
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Geçersiz parola!'
            });
        }

        await pool.execute(
            "UPDATE users SET isOnline = TRUE WHERE userId = ?",
            [user.userId]
        );

        res.json({
            success: true,
            message: `Hoş geldiniz, ${user.firstName} ${user.lastName}`,
            user: {
                id: user.userId,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email
            }
        });
    } catch (err) {
        console.error('Giriş hatası:', err);
        res.status(500).json({
            success: false,
            message: 'Giriş sırasında bir hata oluştu!'
        });
    }
});

app.post('/api/register', async (req, res) => {
    const { firstName, lastName, email, phone, password } = req.body;

    try {
        const [existingUsers] = await pool.execute(
            "SELECT * FROM users WHERE email = ?",
            [email]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Bu email adresi zaten kayıtlı!'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await pool.execute(
            "INSERT INTO users (firstName, lastName, email, phone, password) VALUES (?, ?, ?, ?, ?)",
            [firstName, lastName, email, phone, hashedPassword]
        );

        res.json({
            success: true,
            message: 'Kayıt başarılı! Giriş ekranına yönlendiriliyorsunuz...',
            userId: result.insertId
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: `Kayıt sırasında bir hata oluştu: ${err.message}`
        });
    }
});

// Kullanıcıları getiren endpoint
app.get('/api/users', async (req, res) => {
    try {
        const [users] = await pool.execute(
            "SELECT userId, firstName, lastName, email, isOnline FROM users"
        );
        res.json({ success: true, users });
    } catch (err) {
        console.error('Kullanıcılar getirilirken hata:', err);
        res.status(500).json({
            success: false,
            message: 'Kullanıcılar getirilirken bir hata oluştu!'
        });
    }
}); 

// Mesajları getiren endpoint'i güncelle
app.get('/api/messages/:userId', async (req, res) => {
    try {
        const [messages] = await pool.execute(
            `SELECT m.*, m.id as id, m.status as status,
             u1.firstName as senderFirstName, u1.lastName as senderLastName,
             u2.firstName as receiverFirstName, u2.lastName as receiverLastName
             FROM messages m
             JOIN users u1 ON m.sender_id = u1.userId
             JOIN users u2 ON m.receiver_id = u2.userId
             WHERE sender_id = ? OR receiver_id = ?
             ORDER BY sent_at ASC`,
            [req.params.userId, req.params.userId]
        );
        res.json({ success: true, messages });
    } catch (err) {
        console.error('Mesajlar getirilirken hata:', err);
        res.status(500).json({
            success: false,
            message: 'Mesajlar getirilirken bir hata oluştu!'
        });
    }
});

// Mesajları okundu olarak işaretleyen yeni endpoint
app.post('/api/messages/mark-as-read', async (req, res) => {
    const { senderId, receiverId } = req.body;
    try {
        await pool.execute(
            `UPDATE messages 
             SET status = 'read' 
             WHERE sender_id = ? AND receiver_id = ? AND status IN ('sent', 'delivered')`,
            [senderId, receiverId]
        );

        // Etkilenen mesajları al
        const [updatedMessages] = await pool.execute(
            `SELECT id FROM messages 
             WHERE sender_id = ? AND receiver_id = ? AND status = 'read'`,
            [senderId, receiverId]
        );

        res.json({ 
            success: true, 
            updatedMessageIds: updatedMessages.map(msg => msg.id)
        });
    } catch (err) {
        console.error('Mesaj durumu güncellenirken hata:', err);
        res.status(500).json({
            success: false,
            message: 'Mesaj durumu güncellenirken bir hata oluştu!'
        });
    }
});

// Online durumunu güncelleme endpoint'i
app.post('/api/users/status', async (req, res) => {
    const { userId, isOnline } = req.body;
    try {
        await pool.execute(
            "UPDATE users SET isOnline = ? WHERE userId = ?",
            [isOnline, userId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Kullanıcı durumu güncellenirken hata:', err);
        res.status(500).json({
            success: false,
            message: 'Kullanıcı durumu güncellenirken bir hata oluştu!'
        });
    }
});

//Broadcast mesajları için endpoint ekle
app.get('/api/broadcast-messages', async (req, res) => {
    try {
        const [messages] = await pool.execute(
            `SELECT bm.*, u.firstName, u.lastName
             FROM broadcast_messages bm
             JOIN users u ON bm.sender_id = u.userId
             ORDER BY sent_at DESC`
        );
        res.json({ success: true, messages });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Broadcast mesajları getirilirken bir hata oluştu!'
        });
    }
});

// Hata yakalama middleware'i
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Sunucu hatası oluştu!'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Sayfa bulunamadı'
    });
});

const LOCAL_IP = getLocalIP();
const PORT = process.env.PORT || 5500;

// Sunucuyu başlatma fonksiyonu
async function startServer() {
    try {
        const dbConnected = await testConnection();
        if (!dbConnected) {
            throw new Error('Veritabanı bağlantısı kurulamadı');
        }

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`Sunucu çalışıyor:`);
            console.log(`- Yerel: http://localhost:${PORT}`);
            console.log(`- Ağ: http://${LOCAL_IP}:${PORT}`);
        });
    } catch (err) {
        console.error('Sunucu başlatılamadı:', err);
        process.exit(1);
    }
}

// Sadece burada başlat
startServer();

// Mevcut saveMessage fonksiyonunu güncelle
async function saveMessage(senderId, receiverId, messageContent) {
    try {
        const [result] = await pool.execute(
            "INSERT INTO messages (sender_id, receiver_id, message_content, status) VALUES (?, ?, ?, 'sent')",
            [senderId, receiverId, messageContent]
        );
        
        // Mesajı ve ilgili kullanıcı bilgilerini al
        const [savedMessage] = await pool.execute(
            `SELECT m.*, 
             u1.firstName as senderFirstName, u1.lastName as senderLastName,
             u2.firstName as receiverFirstName, u2.lastName as receiverLastName,
             u2.isOnline as receiverIsOnline
             FROM messages m
             JOIN users u1 ON m.sender_id = u1.userId
             JOIN users u2 ON m.receiver_id = u2.userId
             WHERE m.id = ?`,
            [result.insertId]
        );

        // Alıcı çevrimiçiyse mesaj durumunu 'delivered' olarak güncelle
        if (savedMessage[0].receiverIsOnline) {
            await pool.execute(
                "UPDATE messages SET status = 'delivered' WHERE id = ?",
                [result.insertId]
            );
            savedMessage[0].status = 'delivered';
        }

        return {
            success: true,
            message: {
                ...savedMessage[0],
                messageId: result.insertId
            }
        };
    } catch (err) {
        console.error('Mesaj kaydedilirken hata:', err);
        return { success: false, error: err.message };
    }
}

// Broadcast mesajı kaydetme fonksiyonu
async function saveBroadcastMessage(senderId, messageContent) {
    try {
        const [result] = await pool.execute(
            "INSERT INTO broadcast_messages (sender_id, message_content) VALUES (?, ?)",
            [senderId, messageContent]
        );
        
        // Get saved message with sender details
        const [savedMessage] = await pool.execute(
            `SELECT bm.*, u.firstName, u.lastName
             FROM broadcast_messages bm
             JOIN users u ON bm.sender_id = u.userId
             WHERE bm.id = ?`,
            [result.insertId]
        );

        if (savedMessage.length === 0) {
            throw new Error('Broadcast mesajı kaydedilemedi');
        }

        return {
            success: true,
            message: savedMessage[0]
        };
    } catch (err) {
        console.error('Broadcast mesajı kaydedilirken hata:', err);
        return { success: false, error: err.message };
    }
}
// Mesajları toplu olarak okundu olarak işaretleyen fonksiyon
async function markMessagesAsRead(senderId, receiverId) {
    try {
        await pool.execute(
            `UPDATE messages 
             SET status = 'read' 
             WHERE sender_id = ? AND receiver_id = ? 
             AND status IN ('sent', 'delivered')`,
            [senderId, receiverId]
        );

        // Güncellenen mesajları al
        const [updatedMessages] = await pool.execute(
            `SELECT id FROM messages 
             WHERE sender_id = ? AND receiver_id = ? 
             AND status = 'read'`,
            [senderId, receiverId]
        );

        return updatedMessages.map(msg => msg.id);
    } catch (err) {
        console.error('Mesaj durumu güncellenirken hata:', err);
        throw err;
    }
}

async function updateUserOnlineStatus(userId, isOnline) {
    try {
        await pool.execute(
            "UPDATE users SET isOnline = ? WHERE userId = ?",
            [isOnline, userId]
        );
    } catch (err) {
        console.error('Kullanıcı durumu güncellenirken hata:', err);
    }
}

const onlineUsers = new Map();

// Güncellenmiş socket bağlantı olayları
io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    socket.on('user-connected', async (user) => {
        onlineUsers.set(socket.id, user);
        await updateUserOnlineStatus(user.id, true);
        io.emit('update-online-users', Array.from(onlineUsers.values()));

        // Kullanıcı çevrimiçi olduğunda, ona gelen tüm mesajları 'delivered' olarak işaretle
        try {
            const [messages] = await pool.execute(
                `UPDATE messages 
                 SET status = 'delivered' 
                 WHERE receiver_id = ? AND status = 'sent'`,
                [user.id]
            );

            // Güncellenen mesajları al ve bildir
            const [updatedMessages] = await pool.execute(
                `SELECT id FROM messages 
                 WHERE receiver_id = ? AND status = 'delivered'`,
                [user.id]
            );

            updatedMessages.forEach(msg => {
                io.emit('message-status-update', {
                    messageId: msg.id,
                    status: 'delivered'
                });
            });
        } catch (err) {
            console.error('Mesaj durumu güncellenirken hata:', err);
        }
    });

    socket.on('chat-room-entered', async (data) => {
        try {
            // Delivered olan tüm mesajları okundu olarak işaretle
            const [updatedMessages] = await pool.execute(
                `UPDATE messages 
                 SET status = 'read' 
                 WHERE sender_id = ? AND receiver_id = ? 
                 AND status = 'delivered'`,
                [data.senderId, data.receiverId]
            );
    
            // Güncellenen mesajları al
            const [messages] = await pool.execute(
                `SELECT id FROM messages 
                 WHERE sender_id = ? AND receiver_id = ? 
                 AND status = 'read'`,
                [data.senderId, data.receiverId]
            );
    
            // Her güncellenmiş mesaj için durum güncellemesi yayınla
            messages.forEach(msg => {
                io.emit('message-status-update', {
                    messageId: msg.id,
                    status: 'read'
                });
            });
        } catch (err) {
            console.error('Mesaj durumu güncellenirken hata:', err);
        }
    });
    


    socket.on('send-message', async (data) => {
        const result = await saveMessage(data.senderId, data.receiverId, data.message);
        if (result.success) {
            // Alıcı çevrimiçiyse mesajı otomatik olarak 'delivered' olarak işaretle
            const receiver = Array.from(onlineUsers.values()).find(user => user.id === data.receiverId);
            const initialStatus = receiver ? 'delivered' : 'sent';

            io.emit('receive-message', {
                messageId: result.message.messageId,
                senderId: data.senderId,
                receiverId: data.receiverId,
                message: data.message,
                senderName: `${result.message.senderFirstName} ${result.message.senderLastName}`,
                timestamp: new Date(),
                status: initialStatus
            });

            // Alıcı mesaj odasındaysa mesajı otomatik olarak 'read' olarak işaretle
            if (receiver) {
                await pool.execute(
                    "UPDATE messages SET status = ? WHERE id = ?",
                    [initialStatus, result.message.messageId]
                );
            }
        }
    });
    
// Socket.io broadcast eventi güncellendi
socket.on('send-broadcast', async (data) => {
    try {
        // Tüm online kullanıcıları Array'e çevir ve gönderen hariç filtrele
        const onlineReceivers = Array.from(onlineUsers.entries())
            .map(([_, user]) => user)
            .filter(user => user.id !== data.senderId);

        // Her çevrimiçi kullanıcı için mesaj oluştur
        for (const receiver of onlineReceivers) {
            const messageResult = await saveMessage(data.senderId, receiver.id, data.message);
            
            if (messageResult.success) {
                io.emit('receive-message', {
                    messageId: messageResult.message.messageId,
                    senderId: data.senderId,
                    receiverId: receiver.id,
                    message: data.message,
                    senderName: `${messageResult.message.senderFirstName} ${messageResult.message.senderLastName}`,
                    timestamp: new Date(),
                    status: 'delivered',
                    isBroadcast: true
                });
            }
        }
    } catch (error) {
        console.error('Broadcast error:', error);
    }
});
socket.on('broadcast-seen', async (messageId) => {
    try {
        await pool.execute(
            "UPDATE broadcast_messages SET status = 'read' WHERE id = ?",
            [messageId]
        );
        io.emit('broadcast-status-update', { messageId, status: 'read' });
    } catch (err) {
        console.error('Broadcast status update error:', err);
    }
});

    socket.on('message-seen', async (messageId) => {
        try {
            await pool.execute(
                "UPDATE messages SET status = 'read' WHERE id = ?",
                [messageId]
            );
            io.emit('message-status-update', { messageId, status: 'read' });
        } catch (err) {
            console.error('Mesaj durumu güncellenirken hata:', err);
        }
    });

    socket.on('disconnect', async () => {
        const user = onlineUsers.get(socket.id);
        if (user) {
            await updateUserOnlineStatus(user.id, false);
            onlineUsers.delete(socket.id);
            io.emit('update-online-users', Array.from(onlineUsers.values()));
        }
        console.log('Kullanıcı ayrıldı:', socket.id);
    });
});
