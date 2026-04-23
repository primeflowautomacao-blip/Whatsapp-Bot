const { sendMessage } = require('../services/whatsapp');
const { callGroq } = require('../services/groq');
const {
  isDuplicateMessage,
  getSession,
  upsertSession,
  setHumanTakeover,
  getConversationHistory,
  saveMessage,
} = require('../services/supabase');
const { handleAgendar, handlePendingConfirmation, handleCancelar } = require('./appointment');

// ─────────────────────────────────────────────
// EXTRAI A MENSAGEM DO PAYLOAD DA META
// ─────────────────────────────────────────────
function extractMessage(body) {
  try {
    const entry = body.entry;
    if (!entry || !entry[0]?.changes?.[0]) return null;

    const value = entry[0].changes[0].value;

    // Ignorar notificações de status (delivered, read, etc.)
    if (value.statuses && !value.messages) return null;
    if (!value.messages?.[0]) return null;

    const message = value.messages[0];
    const messageId = message.id;
    const from = message.from;
    const type = message.type;

    let text = '';
    if (type === 'text' && message.text) {
      text = message.text.body || '';
    } else if (type === 'audio') {
      text = '[AUDIO]';
    } else if (type === 'image') {
      text = '[IMAGE]';
    } else {
      text = '[OTHER]';
    }

    return { messageId, from, type, text };
  } catch (err) {
    console.warn('[WARN] extractMessage falhou:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────
async function handleIncomingMessage(body) {
  // 1. Extrair mensagem
  const msg = extractMessage(body);
  if (!msg) return;

  const { messageId, from, type, text } = msg;
  console.log(`[MSG] De: ${from} | Tipo: ${type} | Texto: ${text.substring(0, 80)}`);

  // 2. Deduplicação — ignorar mensagens repetidas
  const duplicate = await isDuplicateMessage(messageId);
  if (duplicate) {
    console.log(`[DEDUP] Mensagem ${messageId} ignorada (duplicata)`);
    return;
  }

  // 3. Ler sessão do paciente
  const session = await getSession(from);
  let humanTakeover = session?.human_takeover || false;
  const pendingAppointment = session?.pending_appointment || null;

  // 4. Comandos especiais #bot / #humano
  const textLower = text.toLowerCase().trim();
  if (textLower === '#bot') {
    humanTakeover = false;
    await upsertSession(from, { human_takeover: false });
    await sendMessage(from, '🤖 Bot reactivado. Como posso ajudá-lo?');
    return;
  }
  if (textLower === '#humano') {
    humanTakeover = true;
    await setHumanTakeover(from, true);
    return; // Silencioso aqui, a resposta vem depois
  }

  // 5. Criar/actualizar sessão
  if (!session) {
    await upsertSession(from, { human_takeover: false, pending_appointment: null });
  } else {
    await upsertSession(from, { human_takeover: humanTakeover, updated_at: new Date().toISOString() });
  }

  // 6. Modo humano — bot fica silencioso
  if (humanTakeover) {
    console.log(`[HUMAN] ${from} está em atendimento humano. Bot silencioso.`);
    return;
  }

  // 7. Tipo de mensagem — áudio/imagem não suportados
  if (type === 'audio') {
    await sendMessage(from, 'Olá! No momento não consigo processar áudios. Por favor, envie sua mensagem em texto. 😊');
    return;
  }
  if (type === 'image') {
    await sendMessage(from, 'Olá! No momento não consigo processar imagens. Por favor, descreva sua solicitação em texto. 😊');
    return;
  }

  // 8. Agendamento pendente de confirmação
  if (pendingAppointment && typeof pendingAppointment === 'object') {
    await handlePendingConfirmation(from, text, pendingAppointment);
    return;
  }

  // 9. Buscar histórico e chamar IA
  const history = await getConversationHistory(from);

  // Salvar mensagem do utilizador
  await saveMessage(from, 'user', text);

  // Chamar Groq
  const aiResult = await callGroq(text, history);
  aiResult.from = from;

  // Salvar resposta da IA
  await saveMessage(from, 'assistant', aiResult.mensagem, {
    intencao: aiResult.intencao,
    nome: aiResult.nome,
    especialidade: aiResult.especialidade,
    data: aiResult.data,
    hora: aiResult.hora,
  });

  // 10. Roteamento por intenção
  console.log(`[INTENT] ${from} → ${aiResult.intencao}`);

  switch (aiResult.intencao) {
    case 'agendar':
      await handleAgendar(from, aiResult);
      break;

    case 'cancelar':
      await handleCancelar(from, aiResult);
      break;

    case 'humano':
      await setHumanTakeover(from, true);
      const nomeHumano = aiResult.nome || 'Paciente';
      await sendMessage(
        from,
        `Entendido, ${nomeHumano}! Vou chamar um de nossos atendentes. Por favor, aguarde um momento. 👨‍⚕️`
      );
      break;

    case 'erro_ia':
      await sendMessage(from, aiResult.mensagem);
      break;

    case 'info':
    case 'outro':
    default:
      await sendMessage(from, aiResult.mensagem);
      break;
  }
}

module.exports = { handleIncomingMessage };
