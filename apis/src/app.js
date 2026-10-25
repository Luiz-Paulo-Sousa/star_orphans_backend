require('dotenv').config();
const Express = require('express');
const Helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Errors = require('./errors');

// Importação das Rotas Modularizadas
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const recoveryRoutes = require('./routes/recoveryRoutes');
const messageRoutes = require('./routes/messageRoutes');
const messageController = require('./controllers/messageController');

const app = Express();

// Configurações de segurança e CORS (contentSecurityPolicy: false permite carregamento do Flutter Web/Wasm/CanvasKit)
app.use(Helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.options('*', cors());
app.use(Express.json());

// Servir arquivos estáticos da aplicação Companion Web (PWA)
const webPath = path.resolve(__dirname, 'public');
app.use(Express.static(webPath));

// Servir arquivos estáticos de uploads
app.use('/uploads', Express.static(path.resolve(__dirname, 'storage', 'uploads')));

// Rotas de prioridade máxima para mensagens não lidas e marcação de leitura
app.get('/api/messages/unread-status/:pilotUid', messageController.checkUnreadStatus);
app.get('/messages/unread-status/:pilotUid', messageController.checkUnreadStatus);
app.put('/api/messages/mark-all-read/:destinationUid', messageController.markAllMessagesAsRead);
app.put('/messages/mark-all-read/:destinationUid', messageController.markAllMessagesAsRead);
app.put('/api/messages/mark-read/:channelUid/:subchannelUid', messageController.markMessagesAsRead);
app.put('/messages/mark-read/:channelUid/:subchannelUid', messageController.markMessagesAsRead);

// Registro dos Endpoints com prefixo /api e raiz para máxima compatibilidade
app.use('/', authRoutes);
app.use('/', profileRoutes);
app.use('/', recoveryRoutes);
app.use('/', messageRoutes);
app.use('/api', messageRoutes);

// Teste de DB global
const db = require('./config/database');
app.get('/test-db', async (req, res) => {
    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query("SELECT 1 + 1 AS resultado");
        res.json({ status: "sucesso", resposta: rows });
    } catch (err) {
        res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// SPA Fallback para rotas do Flutter Web (PWA)
app.get('*', (req, res, next) => {
    if (
        req.path.startsWith('/api') ||
        req.path.startsWith('/messages') ||
        req.path.startsWith('/login') ||
        req.path.startsWith('/register') ||
        req.path.startsWith('/verify-email') ||
        req.path.startsWith('/player-profile') ||
        req.path.startsWith('/upload-avatar') ||
        req.path.startsWith('/uploads') ||
        req.path.startsWith('/test-db')
    ) {
        return next();
    }
    const indexPath = path.join(webPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }
    next();
});

// Fallback de erro
app.use((req, res) => Errors.notImplemented(res));

module.exports = app;
