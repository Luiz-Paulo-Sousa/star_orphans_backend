const db = require('../config/database');
const codeService = require('../services/codeService');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY || process.env.RESEND_API_KEY || '');

const requestReset = async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ status: "erro", mensagem: "Informe o username do jogador." });
    }

    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query("SELECT email FROM accounts WHERE LOWER(account) = LOWER(?)", [username]);

        if (rows.length === 0 || !rows[0].email) {
            return res.status(404).json({ status: "erro", mensagem: "Usuário não encontrado ou sem e-mail cadastrado." });
        }

        const userEmail = rows[0].email;
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        codeService.set(username.toLowerCase(), { code, expiresAt: Date.now() + 15 * 60 * 1000 });

        await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: userEmail,
            subject: 'Star Orphans - Código de Redefinição',
            html: `<div style="font-family: monospace; background: #12151A; color: #fff; padding: 20px;"><h2>REDEFINIÇÃO DE CHAVE</h2><p>Código: <strong style="color:#00D2FF;">${code}</strong></p></div>`
        });

        return res.json({ status: "sucesso", mensagem: "Código enviado com sucesso!" });
    } catch (err) {
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const validateCode = async (req, res) => {
    const { username, code } = req.body;
    const record = codeService.get(username?.toLowerCase());

    if (!record || Date.now() > record.expiresAt || record.code !== code?.trim()) {
        return res.status(400).json({ status: "erro", mensagem: "Código inválido ou expirado." });
    }

    return res.json({ status: "sucesso", mensagem: "Código validado!" });
};

const resetPassword = async (req, res) => {
    const { username, code, new_password_hash } = req.body;
    const record = codeService.get(username?.toLowerCase());

    if (!record || record.code !== code?.trim()) {
        return res.status(400).json({ status: "erro", mensagem: "Sessão inválida ou expirada." });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.query(
            `UPDATE credentials c INNER JOIN accounts a ON c.uid = a.uid SET c.password = ? WHERE LOWER(a.account) = LOWER(?)`,
            [new_password_hash, username]
        );
        codeService.delete(username.toLowerCase());
        return res.json({ status: "sucesso", mensagem: "Chave alterada com sucesso!" });
    } catch (err) {
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

module.exports = { requestReset, validateCode, resetPassword };