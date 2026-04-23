const express = require('express');
const router = express.Router();
const { handleIncomingMessage } = require('../handlers/message');

// ─────────────────────────────────────────────
// GET — Verificação do Webhook pela Meta
// A Meta faz este pedido quando você regista o webhook no painel
// ─────────────────────────────────────────────
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado pela Meta');
    return res.status(200).send(challenge);
  }

  console.warn('❌ Falha na verificação do webhook');
  return res.sendStatus(403);
});

// ─────────────────────────────────────────────
// POST — Recebe mensagens do WhatsApp
// ─────────────────────────────────────────────
router.post('/', async (req, res) => {
  // Responde 200 imediatamente para a Meta (obrigatório)
  res.status(200).json({ status: 'ok' });

  try {
    await handleIncomingMessage(req.body);
  } catch (err) {
    console.error('❌ Erro ao processar mensagem:', err.message);
  }
});

module.exports = router;
