require('dotenv').config();

const Express = require('express');
const Helmet  = require('helmet');
const Http    = require('http');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');

const db     = require('./db');
const Errors = require('./errors');

// Configuração do Resend
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY || process.env.RESEND_API_KEY || '');

// Mapa para guardar os códigos de redefinição e ativação na memória
const recoveryCodes = new Map();

const app = Express();

// Middlewares de Segurança e CORS
app.use(Helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" } // Permite carregar imagens estáticas sem bloqueio do navegador
}));

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With']
}));

app.options('*', cors());
app.use(Express.json());

// =======================================================
// SERVIR ARQUIVOS ESTÁTICOS E CONFIGURAÇÃO DE DIRETÓRIOS
// =======================================================
const uploadsDir = path.resolve(__dirname, 'storage', 'uploads');
const avatarsDir = path.resolve(uploadsDir, 'avatars');

// Garante que as pastas de storage/uploads/avatars existam no disco
if (!fs.existsSync(avatarsDir)) {
    fs.mkdirSync(avatarsDir, { recursive: true });
}

// Serve a pasta de uploads estaticamente de forma correta
app.use('/uploads', Express.static(uploadsDir));

// Configuração do Multer para Upload de Avatares
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, avatarsDir);
    },
    filename: (req, file, cb) => {
        const accountId = req.body.account_id || Date.now();
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${accountId}${ext}`);
    }
});

const upload = multer({ storage });

// =======================================================
// ROTAS DA APLICAÇÃO
// =======================================================

// Rota de teste da conexão com o MariaDB
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

// Endpoint de Autenticação / Login por Username
app.post('/login', async (req, res) => {
    const { username, password_hash } = req.body;

    if (!username || !password_hash) {
        return res.status(400).json({ 
            status: "erro", 
            mensagem: "username e password_hash são obrigatórios." 
        });
    }

    let conn;
    try {
        conn = await db.getConnection();
        
        const rows = await conn.query(
            `SELECT a.uid AS account_id, a.account AS username, a.email_verified, c.password AS password_hash 
             FROM accounts a 
             INNER JOIN credentials c ON a.uid = c.uid 
             WHERE LOWER(a.account) = LOWER(?)`,
            [username]
        );

        if (rows.length === 0) {
            return res.status(401).json({ status: "erro", mensagem: "Usuário não encontrado." });
        }

        const user = rows[0];

        if (user.password_hash !== password_hash) {
            return res.status(401).json({ status: "erro", mensagem: "Senha inválida." });
        }

        if (!user.email_verified || user.email_verified === 0) {
            return res.status(403).json({ 
                status: "erro", 
                mensagem: "E-MAIL NÃO VERIFICADO! DIGITE O CÓDIGO DE ATIVAÇÃO." 
            });
        }

        return res.json({
            status: "sucesso",
            mensagem: "Login efetuado com sucesso!",
            account_id: Number(user.account_id),
            username: user.username
        });

    } catch (err) {
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// Endpoint de Perfil do Jogador
app.get('/player-profile', async (req, res) => {
    const accountId = req.query.account_id;

    if (!accountId) {
        return res.status(400).json({
            status: "erro",
            mensagem: "Parâmetro account_id é obrigatório."
        });
    }

    let conn;
    try {
        conn = await db.getConnection();

        const playerRows = await conn.query(
            `SELECT 
                a.uid AS account_id,
                a.account AS operator_name,
                a.avatar_url,
                COALESCE(c.name, 'Freelancer') AS corporation_name,
                s.name AS sector_name,
                st.name AS station_name,
                COALESCE(w.credits, 0) AS credits,
                COALESCE(ps.kills, 0) AS kills,
                COALESCE(ps.deaths, 0) AS deaths,
                COALESCE(ps.assists, 0) AS assists,
                COALESCE(ps.explorer, 0) AS explorer,
                COALESCE(ps.extractor, 0) AS extractor,
                COALESCE(ps.merchant, 0) AS merchant,
                COALESCE(ps.engineer, 0) AS engineer,
                COALESCE(ps.mercenary, 0) AS mercenary
            FROM accounts a
            LEFT JOIN pilots p ON p.pilot_uid = a.uid
            LEFT JOIN corporation_members cm ON cm.pilot_uid = p.pilot_uid
            LEFT JOIN corporations c ON c.corporation_uid = cm.corporation_uid
            LEFT JOIN sectors s ON s.id = p.orbit
            LEFT JOIN sector_stations st ON st.id = p.station
            LEFT JOIN wallets w ON w.wallet_uid = a.uid
            LEFT JOIN pilot_stats ps ON ps.pilot_uid = a.uid
            WHERE a.uid = ?
            LIMIT 1`,
            [accountId]
        );

        if (playerRows.length === 0) {
            return res.status(404).json({
                status: "erro",
                mensagem: "Jogador não encontrado."
            });
        }

        const playerData = playerRows[0];

        const sectorStr = playerData.sector_name || 'DESCONHECIDO';
        const stationStr = playerData.station_name || 'DESCONHECIDO';
        const locationFormatted = `KALI – ${sectorStr.toUpperCase()} – ${stationStr.toUpperCase()}`;

        const reputationRows = await conn.query(
            `SELECT 
                f.name AS faction_name,
                COALESCE(pp.percentage, 0) AS percentage
            FROM factions f
            LEFT JOIN pilot_prestige pp ON pp.faction_uid = f.faction_uid AND pp.pilot_uid = ?
            ORDER BY f.faction_uid ASC`,
            [accountId]
        );

        const reputations = reputationRows.map(row => ({
            faction_name: row.faction_name,
            percentage: Number(row.percentage)
        }));

        return res.json({
            status: "sucesso",
            data: {
                operator: {
                    account_id: Number(playerData.account_id),
                    name: playerData.operator_name,
                    corporation: playerData.corporation_name,
                    location: locationFormatted,
                    credits: Number(playerData.credits),
                    avatar_url: playerData.avatar_url || null
                },
                stats: {
                    kills: Number(playerData.kills),
                    deaths: Number(playerData.deaths),
                    assists: Number(playerData.assists)
                },
                reputations: reputations,
                skills: {
                    explorer: Number(playerData.explorer),
                    extractor: Number(playerData.extractor),
                    merchant: Number(playerData.merchant),
                    engineer: Number(playerData.engineer),
                    mercenary: Number(playerData.mercenary)
                }
            }
        });

    } catch (err) {
        console.error("[Player Profile Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// Endpoint para Atualizar o Avatar do Operador
app.post('/upload-avatar', upload.single('avatar'), async (req, res) => {
    const { account_id } = req.body;

    if (!account_id || !req.file) {
        return res.status(400).json({
            status: "erro",
            mensagem: "account_id e o arquivo de imagem são obrigatórios."
        });
    }

    let conn;
    try {
        // Apaga avatares antigos associados ao mesmo account_id
        if (fs.existsSync(avatarsDir)) {
            const files = fs.readdirSync(avatarsDir);
            files.forEach(file => {
                if (file.startsWith(`${account_id}.`) && file !== req.file.filename) {
                    try {
                        fs.unlinkSync(path.join(avatarsDir, file));
                    } catch (e) {
                        // Ignora se não conseguir apagar o arquivo
                    }
                }
            });
        }

        // Caminho relativo gravado no BD
        const avatarUrl = `/uploads/avatars/${req.file.filename}`;

        conn = await db.getConnection();
        await conn.query(
            "UPDATE accounts SET avatar_url = ? WHERE uid = ?",
            [avatarUrl, account_id]
        );

        return res.json({
            status: "sucesso",
            mensagem: "Avatar atualizado com sucesso!",
            avatar_url: avatarUrl
        });

    } catch (err) {
        console.error("[Upload Avatar Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// =======================================================
// ROTAS DE MENSAGENS (CHAT E E-MAIL)
// =======================================================

// Endpoint para verificar mensagens não lidas (is_read = 0)
app.get('/messages/unread-status/:accountId', async (req, res) => {
    const { accountId } = req.params;

    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query(
            `SELECT 
               SUM(CASE WHEN type = 'chat' AND is_read = 0 THEN 1 ELSE 0 END) AS unread_chat,
               SUM(CASE WHEN type = 'email' AND is_read = 0 THEN 1 ELSE 0 END) AS unread_email
             FROM messages
             WHERE account_id = ?`,
            [accountId]
        );

        const result = rows[0] || {};

        return res.json({
            has_unread_chat: (result.unread_chat || 0) > 0,
            has_unread_email: (result.unread_email || 0) > 0
        });
    } catch (err) {
        console.error("[Unread Status Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// =======================================================
// ROTAS DE REDEFINIÇÃO DE CHAVE / SENHA
// =======================================================

app.post('/request-reset', async (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ status: "erro", mensagem: "Informe o username do jogador." });
    }

    let conn;
    try {
        conn = await db.getConnection();

        const rows = await conn.query(
            "SELECT email FROM accounts WHERE LOWER(account) = LOWER(?)", 
            [username]
        );

        if (rows.length === 0) {
            return res.status(404).json({ status: "erro", mensagem: "Usuário não encontrado no banco de dados." });
        }

        const userEmail = rows[0].email;

        if (!userEmail) {
            return res.status(400).json({ status: "erro", mensagem: "Usuário não possui um e-mail cadastrado." });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();

        recoveryCodes.set(username.toLowerCase(), {
            code: code,
            expiresAt: Date.now() + 15 * 60 * 1000
        });

        const resendResponse = await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: userEmail,
            subject: 'Star Orphans - Código de Redefinição',
            html: `
                <div style="font-family: monospace; background: #12151A; color: #fff; padding: 20px; border-radius: 8px;">
                    <h2 style="color: #00D2FF;">REDEFINIÇÃO DE CHAVE</h2>
                    <p>Operador: <strong>${username}</strong></p>
                    <p>Seu código de validação é:</p>
                    <h1 style="color: #00D2FF; letter-spacing: 5px;">${code}</h1>
                    <p style="font-size: 12px; color: #888;">Este código expira em 15 minutos.</p>
                </div>
            `
        });

        console.log(`[Resend] E-mail enviado para ${userEmail}:`, resendResponse);

        return res.json({ status: "sucesso", mensagem: "Código enviado com sucesso!" });

    } catch (err) {
        console.error('[Resend Error]:', err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
});

app.post('/validate-code', async (req, res) => {
    const { username, code } = req.body;

    if (!username || !code) {
        return res.status(400).json({ status: "erro", mensagem: "Username e código são obrigatórios." });
    }

    const record = recoveryCodes.get(username.toLowerCase());

    if (!record) {
        return res.status(400).json({ status: "erro", mensagem: "Nenhum código solicitado para este usuário." });
    }

    if (Date.now() > record.expiresAt) {
        recoveryCodes.delete(username.toLowerCase());
        return res.status(400).json({ status: "erro", mensagem: "Código expirado. Solicite um novo." });
    }

    if (record.code !== code.trim()) {
        return res.status(400).json({ status: "erro", mensagem: "Código incorreto." });
    }

    return res.json({ status: "sucesso", mensagem: "Código validado!" });
});

app.post('/reset-password', async (req, res) => {
    const { username, code, new_password_hash } = req.body;

    if (!username || !code || !new_password_hash) {
        return res.status(400).json({ status: "erro", mensagem: "Dados incompletos." });
    }

    const record = recoveryCodes.get(username.toLowerCase());

    if (!record || record.code !== code.trim()) {
        return res.status(400).json({ status: "erro", mensagem: "Sessão inválida ou expirada." });
    }

    let conn;
    try {
        conn = await db.getConnection();

        await conn.query(
            `UPDATE credentials c 
             INNER JOIN accounts a ON c.uid = a.uid 
             SET c.password = ? 
             WHERE LOWER(a.account) = LOWER(?)`,
            [new_password_hash, username]
        );

        recoveryCodes.delete(username.toLowerCase());

        return res.json({ status: "sucesso", mensagem: "Chave alterada com sucesso!" });

    } catch (err) {
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// =======================================================
// ROTAS DE CADASTRO E VERIFICAÇÃO DE E-MAIL
// =======================================================

app.post('/register', async (req, res) => {
    const { username, email, password_hash, hash_one, hash_two } = req.body;

    if (!username || !email || !password_hash || !hash_one || !hash_two) {
        return res.status(400).json({
            status: "erro",
            mensagem: "username, email, password_hash, hash_one e hash_two são obrigatórios."
        });
    }

    let conn;
    try {
        conn = await db.getConnection();

        const existingUsers = await conn.query(
            "SELECT account AS username, email FROM accounts WHERE LOWER(account) = LOWER(?) OR LOWER(email) = LOWER(?)",
            [username, email]
        );

        if (existingUsers.length > 0) {
            const userExists = existingUsers.some(u => u.username.toLowerCase() === username.toLowerCase());
            if (userExists) {
                return res.status(400).json({
                    status: "erro",
                    mensagem: "ID de operador (username) já registrado."
                });
            }
            return res.status(400).json({
                status: "erro",
                mensagem: "E-mail já cadastrado na rede."
            });
        }

        await conn.beginTransaction();

        const resAccount = await conn.query(
            "INSERT INTO accounts (account, email, email_verified) VALUES (?, ?, 0)",
            [username, email]
        );

        const accountId = resAccount.insertId;

        await conn.query(
            "INSERT INTO credentials (uid, password, hash_one, hash_two) VALUES (?, ?, ?, ?)",
            [accountId, password_hash, hash_one, hash_two]
        );

        const code = Math.floor(100000 + Math.random() * 900000).toString();

        recoveryCodes.set(`activation_${username.toLowerCase()}`, {
            code: code,
            expiresAt: Date.now() + 15 * 60 * 1000
        });

        await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: email,
            subject: 'Star Orphans - Validação de E-mail',
            html: `
                <div style="font-family: monospace; background: #12151A; color: #fff; padding: 20px; border-radius: 8px;">
                    <h2 style="color: #00D2FF;">BEM-VINDO, OPERADOR</h2>
                    <p>Seu código de ativação de conta é:</p>
                    <h1 style="color: #00D2FF; letter-spacing: 5px;">${code}</h1>
                    <p style="font-size: 12px; color: #888;">Válido por 15 minutos.</p>
                </div>
            `
        });

        await conn.commit();

        return res.status(201).json({
            status: "sucesso",
            mensagem: "Operador cadastrado! Verifique seu e-mail para ativar a conta.",
            account_id: Number(accountId),
            username: username
        });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error("[Register Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
});

app.post('/verify-email', async (req, res) => {
    const { username, code } = req.body;

    if (!username || !code) {
        return res.status(400).json({ status: "erro", mensagem: "Username e código são obrigatórios." });
    }

    const key = `activation_${username.toLowerCase()}`;
    const record = recoveryCodes.get(key);

    if (!record) {
        return res.status(400).json({ status: "erro", mensagem: "Nenhum código pendente para este operador." });
    }

    if (Date.now() > record.expiresAt) {
        recoveryCodes.delete(key);
        return res.status(400).json({ status: "erro", mensagem: "Código expirado." });
    }

    if (record.code !== code.trim()) {
        return res.status(400).json({ status: "erro", mensagem: "Código incorreto." });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.query(
            "UPDATE accounts SET email_verified = 1 WHERE LOWER(account) = LOWER(?)",
            [username]
        );
        recoveryCodes.delete(key);

        return res.json({ status: "sucesso", mensagem: "E-mail verificado com sucesso! Você já pode autenticar." });
    } catch (err) {
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// Fallback para rotas não encontradas
app.use((req, res) => {
    Errors.notImplemented(res);
});

// Inicialização do Servidor HTTP ouvindo em '0.0.0.0'
const httpServer = Http.createServer(app);

httpServer.listen(8020, '0.0.0.0', () => {
    console.log("Servidor online na porta 8020 e escutando em todas as interfaces de rede (0.0.0.0)");
    console.log("");
});