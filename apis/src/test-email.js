const { Resend } = require('resend');

// Substitua pela sua chave API do Resend
const resend = new Resend(process.env.RESEND_API_KEY || '');

async function sendTestEmail() {
  console.log('Iniciando o envio do e-mail...');
  try {
    const data = await resend.emails.send({
      from: 'Acme <onboarding@resend.dev>',
      to: ['luizpaulofs@gmail.com'], // Coloque seu e-mail aqui
      subject: 'Teste de Redefinição de Senha',
      html: '<strong>Seu código é 123456</strong>',
    });

    console.log('RESPOSTA DO RESEND:', data);
  } catch (error) {
    console.error('ERRO AO ENVIAR:', error);
  }
}

// O await ou a chamada direta da função precisa ser executada:
sendTestEmail().then(() => console.log('Execução finalizada.'));