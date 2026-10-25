const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Resend } = require('resend');

// Inicialize o serviço de e-mail com sua API Key
const resend = new Resend('re_SUA_CHAVE_API_AQUI');

// Armazenamento temporário em memória para os códigos de redefinição
// Estrutura: { username: { code: '123456', expiresAt: Timestamp } }
const resetCodes = new Map();

// Helper: Calcula o hash SHA256 usando o username como SALT
function generatePasswordHash(password, username) {
  return crypto
    .createHash('sha256')
    .update(password + username)
    .digest('hex');
}

// --------------------------------------------------------------------------
// 1. SOLICITAR CÓDIGO DE REDEFINIÇÃO
// --------------------------------------------------------------------------
router.post('/request-reset', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ message: 'Username é obrigatório.' });
  }

  try {
    // A) Busca o e-mail na tabela 'Account'
    // Adapte a consulta abaixo para o driver do seu banco (ex: db.query, knex, sequelize)
    const account = await db.query(
      'SELECT id, email FROM Account WHERE username = ?',
      [username]
    );

    if (!account || account.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    const userEmail = account[0].email;

    // B) Gera um código aleatório de 6 dígitos
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // C) Define o tempo de expiração para exatamente 2 minutos (120.000 ms)
    const expiresAt = Date.now() + 2 * 60 * 1000;

    // D) Salva em memória vinculando ao username
    resetCodes.set(username, { code, expiresAt });

    // E) Dispara o e-mail
    await resend.emails.send({
      from: 'Jogo <onboarding@resend.dev>', // Ou seu domínio verificado
      to: [userEmail],
      subject: 'Código de Redefinição de Senha',
      html: `
        <h3>Redefinição de Senha</h3>
        <p>Seu código de validação é: <strong style="font-size: 20px;">${code}</strong></p>
        <p>Atenção: Este código expira em <strong>2 minutos</strong>.</p>
      `,
    });

    return res.status(200).json({ message: 'Código enviado com sucesso!' });
  } catch (error) {
    console.error('Erro ao solicitar código:', error);
    return res.status(500).json({ message: 'Erro interno no servidor.' });
  }
});

// --------------------------------------------------------------------------
// 2. VALIDAR O CÓDIGO
// --------------------------------------------------------------------------
router.post('/verify-code', (req, res) => {
  const { username, code } = req.body;

  const record = resetCodes.get(username);

  if (!record) {
    return res.status(400).json({ message: 'Nenhuma solicitação encontrada para este usuário.' });
  }

  // Verifica se expirou os 2 minutos
  if (Date.now() > record.expiresAt) {
    resetCodes.delete(username); // Limpa o código expirado
    return res.status(400).json({ message: 'O código de 2 minutos expirou. Solicite novamente.' });
  }

  // Verifica se o código bate
  if (record.code !== code) {
    return res.status(400).json({ message: 'Código incorreto.' });
  }

  return res.status(200).json({ message: 'Código validado com sucesso.' });
});

// --------------------------------------------------------------------------
// 3. SOBREPOR A NOVA SENHA
// --------------------------------------------------------------------------
router.post('/reset-password', async (req, res) => {
  const { username, code, new_password } = req.body;

  const record = resetCodes.get(username);

  // Revalidação de segurança antes de alterar no banco
  if (!record || record.code !== code || Date.now() > record.expiresAt) {
    return res.status(400).json({ message: 'Sessão inválida ou tempo expirado.' });
  }

  try {
    // A) Busca o ID na tabela 'Account' pelo username
    const account = await db.query(
      'SELECT id FROM Account WHERE username = ?',
      [username]
    );

    if (!account || account.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    const accountId = account[0].id;

    // B) Calcula o novo hash SHA256 usando 'username' como salt
    const newPasswordHash = generatePasswordHash(new_password, username);

    // C) Atualiza o campo 'password_hash' na tabela 'Credentials' pelo ID relacionado
    await db.query(
      'UPDATE Credentials SET password_hash = ? WHERE id = ?',
      [newPasswordHash, accountId]
    );

    // D) Limpa o código da memória já que foi consumido com sucesso
    resetCodes.delete(username);

    return res.status(200).json({ message: 'Senha atualizada com sucesso!' });
  } catch (error) {
    console.error('Erro ao atualizar senha:', error);
    return res.status(500).json({ message: 'Erro ao sobrepor a senha no banco de dados.' });
  }
});

module.exports = router;