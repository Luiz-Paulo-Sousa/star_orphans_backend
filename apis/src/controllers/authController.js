const db = require('../config/database');
const { Resend } = require('resend');
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const codeService = require('../services/codeService');

const login = async (req, res) => {
    const { username, password_hash } = req.body;
    if (!username || !password_hash) {
        return res.status(400).json({ status: "erro", mensagem: "username e password_hash são obrigatórios." });
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

        if (rows.length === 0 || rows[0].password_hash !== password_hash) {
            return res.status(401).json({ status: "erro", mensagem: "Credenciais inválidas." });
        }

        const user = rows[0];
        if (!user.email_verified || user.email_verified === 0) {
            return res.status(403).json({ status: "erro", mensagem: "E-MAIL NÃO VERIFICADO! DIGITE O CÓDIGO DE ATIVAÇÃO." });
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
};

const register = async (req, res) => {
    const { username, email, password_hash, hash_one, hash_two } = req.body;
    if (!username || !email || !password_hash || !hash_one || !hash_two) {
        return res.status(400).json({ status: "erro", mensagem: "Campos obrigatórios faltando." });
    }

    let conn;
    try {
        conn = await db.getConnection();
        const existingUsers = await conn.query(
            "SELECT account AS username, email FROM accounts WHERE LOWER(account) = LOWER(?) OR LOWER(email) = LOWER(?)",
            [username, email]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({ status: "erro", mensagem: "Operador ou e-mail já registrado." });
        }

        await conn.beginTransaction();

        // 1. Criação da conta
        const resAccount = await conn.query(
            "INSERT INTO accounts (account, email, email_verified) VALUES (?, ?, 0)",
            [username, email]
        );
        const accountId = resAccount.insertId;

        // 2. Inserção das credenciais
        await conn.query(
            "INSERT INTO credentials (uid, password, hash_one, hash_two) VALUES (?, ?, ?, ?)",
            [accountId, password_hash, hash_one, hash_two]
        );

        // 3. Criação do registro na tabela 'pilots' (pilot_uid = accounts.uid, pilot = accounts.account, demais assumem padrões do DB)
        await conn.query(
            "INSERT INTO pilots (pilot_uid, pilot) VALUES (?, ?)",
            [accountId, username]
        );

        // 4. Leitura da tabela 'factions' e criação de registros em 'pilot_prestige' para cada facção
        const factions = await conn.query("SELECT faction_uid FROM factions");
        const factionsList = Array.isArray(factions) && Array.isArray(factions[0]) ? factions[0] : factions;

        for (const faction of factionsList) {
            await conn.query(
                "INSERT INTO pilot_prestige (pilot_uid, faction_uid, percentage) VALUES (?, ?, 0)",
                [accountId, faction.faction_uid]
            );
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        codeService.set(`activation_${username.toLowerCase()}`, { code, expiresAt: Date.now() + 15 * 60 * 1000 });

        await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: email,
            subject: 'Star Orphans - Validação de E-mail',
            html: `<div style="font-family: monospace; background: #12151A; color: #fff; padding: 20px;"><h2>BEM-VINDO, OPERADOR</h2><p>Código: <strong style="color:#00D2FF;">${code}</strong></p></div>`
        });

        await conn.commit();
        return res.status(201).json({ status: "sucesso", mensagem: "Operador cadastrado! Verifique seu e-mail.", account_id: Number(accountId), username });
    } catch (err) {
        if (conn) await conn.rollback();
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const verifyEmail = async (req, res) => {
    const { username, code } = req.body;
    const key = `activation_${username.toLowerCase()}`;
    const record = codeService.get(key);

    if (!record || Date.now() > record.expiresAt || record.code !== code.trim()) {
        return res.status(400).json({ status: "erro", mensagem: "Código inválido ou expirado." });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.query("UPDATE accounts SET email_verified = 1 WHERE LOWER(account) = LOWER(?)", [username]);
        codeService.delete(key);
        return res.json({ status: "sucesso", mensagem: "E-mail verificado com sucesso!" });
    } catch (err) {
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

module.exports = { login, register, verifyEmail };