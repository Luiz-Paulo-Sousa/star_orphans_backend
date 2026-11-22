require('dotenv').config();
const Express = require('express');
const Helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Errors = require('./errors');
const db = require('./config/database');

// Importação das Rotas Modularizadas
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const recoveryRoutes = require('./routes/recoveryRoutes');
const messageRoutes = require('./routes/messageRoutes');
const hangarRoutes = require('./routes/hangarRoutes');
const marketRoutes = require('./routes/marketRoutes');
const factoryRoutes = require('./routes/factoryRoutes');
const corporationRoutes = require('./routes/corporationRoutes');
const contractRoutes = require('./routes/contractRoutes');
const messageController = require('./controllers/messageController');

const app = Express();

// Configurações de segurança e CORS (contentSecurityPolicy: false permite carregamento do Flutter Web/Wasm/CanvasKit)
app.use(Helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.options('*', cors());
app.use(Express.json());

// Servir arquivos estáticos da aplicação Companion Web (PWA)
const webPath = path.resolve(__dirname, 'public');
app.use(Express.static(webPath));

// Servir arquivos estáticos de uploads, hologramas das naves e ícones dos itens (com resolução case-insensitive para Linux)
const serveCaseInsensitive = (baseDir) => {
    return (req, res, next) => {
        try {
            const reqPath = decodeURIComponent(req.path).replace(/^\/+/, '');
            if (!reqPath) return next();

            const directPath = path.join(baseDir, reqPath);
            if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
                return res.sendFile(directPath);
            }

            const segments = reqPath.split(/[\\/]/);
            let currentDir = baseDir;
            let found = true;

            for (const segment of segments) {
                if (!fs.existsSync(currentDir) || !fs.statSync(currentDir).isDirectory()) {
                    found = false;
                    break;
                }
                const entries = fs.readdirSync(currentDir);
                const match = entries.find(e => e.toLowerCase() === segment.toLowerCase());
                if (match) {
                    currentDir = path.join(currentDir, match);
                } else {
                    found = false;
                    break;
                }
            }

            if (found && fs.existsSync(currentDir) && fs.statSync(currentDir).isFile()) {
                return res.sendFile(currentDir);
            }
        } catch (e) {
            // Ignora e passa adiante
        }
        next();
    };
};

const storagePath = path.resolve(__dirname, 'storage');
const itemsStorageDir = path.resolve(storagePath, 'items');
const hologramsStorageDir = fs.existsSync(path.resolve(storagePath, 'hologramas'))
    ? path.resolve(storagePath, 'hologramas')
    : path.resolve(storagePath, 'holograms');

app.use('/items', serveCaseInsensitive(itemsStorageDir));
app.use('/item-icons', serveCaseInsensitive(itemsStorageDir));
if (fs.existsSync(path.resolve(storagePath, 'items_128x'))) {
    app.use('/item-icons', serveCaseInsensitive(path.resolve(storagePath, 'items_128x')));
}
app.use('/hologramas', serveCaseInsensitive(hologramsStorageDir));
app.use('/holograms', serveCaseInsensitive(hologramsStorageDir));
app.use('/uploads', Express.static(path.resolve(storagePath, 'uploads')));
app.use('/storage', Express.static(storagePath));

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
app.use('/', hangarRoutes);
app.use('/api', hangarRoutes);
app.use('/', marketRoutes);
app.use('/api', marketRoutes);
app.use('/', factoryRoutes);
app.use('/api', factoryRoutes);
app.use('/', corporationRoutes);
app.use('/api', corporationRoutes);
app.use('/', contractRoutes);
app.use('/api', contractRoutes);

// Rota para listar estações da tabela orbit_stations
app.get(['/api/stations', '/stations', '/api/orbit-stations'], async (req, res) => {
    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query("SELECT id, orbit_id, name, station_type FROM orbit_stations ORDER BY name ASC");
        const sanitized = rows.map(r => ({
            id: Number(r.id),
            orbit_id: Number(r.orbit_id),
            name: r.name,
            station_type: r.station_type
        }));
        res.json({ status: "sucesso", stations: sanitized });
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
        req.path.startsWith('/hangar') ||
        req.path.startsWith('/market') ||
        req.path.startsWith('/factory') ||
        req.path.startsWith('/stations') ||
        req.path.startsWith('/hologramas') ||
        req.path.startsWith('/items') ||
        req.path.startsWith('/item-icons') ||
        req.path.startsWith('/messages') ||
        req.path.startsWith('/login') ||
        req.path.startsWith('/register') ||
        req.path.startsWith('/verify-email') ||
        req.path.startsWith('/player-profile') ||
        req.path.startsWith('/upload-avatar') ||
        req.path.startsWith('/uploads') ||
        req.path.startsWith('/item-icons') ||
        req.path.startsWith('/holograms') ||
        req.path.startsWith('/hologramas') ||
        req.path.startsWith('/storage') ||
        req.path.startsWith('/hangar') ||
        req.path.startsWith('/market') ||
        req.path.startsWith('/factory') ||
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
