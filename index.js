require('dotenv').config();
const express = require('express');
const webhookRouter = require('./routes/webhook');

const app = express();
app.use(express.json());

// Rota principal do webhook WhatsApp
app.use('/webhook', webhookRouter);

// Health check (útil para o Render/Uptime Robot)
app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: 'Clínica Saúde Viva', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Bot iniciado na porta ${PORT}`);
});
