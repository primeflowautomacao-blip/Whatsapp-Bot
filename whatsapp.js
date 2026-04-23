const axios = require('axios');

const META_URL = `https://graph.facebook.com/v22.0/${process.env.META_PHONE_ID}/messages`;

async function sendMessage(to, text) {
  try {
    await axios.post(
      META_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
  } catch (err) {
    console.error(`[ERROR] Falha ao enviar mensagem para ${to}:`, err.response?.data || err.message);
  }
}

module.exports = { sendMessage };
