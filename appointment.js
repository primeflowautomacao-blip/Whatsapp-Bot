const { sendMessage } = require('../services/whatsapp');
const {
  createAppointment,
  findAppointmentByPhone,
  findAppointmentByName,
  cancelAppointment,
  savePendingAppointment,
  clearPendingAppointment,
} = require('../services/supabase');

// ─────────────────────────────────────────────
// VALIDAÇÃO DE DATA E HORA (fuso Luanda UTC+1)
// ─────────────────────────────────────────────
function validateDateTime(data, hora, nome, from) {
  const missing = [];
  if (!nome) missing.push('seu nome completo');
  if (!data) missing.push('a data desejada (ex: 25/03/2025)');
  if (!hora) missing.push('o horário desejado (ex: 14:30)');

  if (missing.length > 0) {
    return {
      valid: false,
      mensagem: `Para agendar sua consulta, ainda preciso de: ${missing.join(', ')}. Por favor, informe esses dados. 😊`,
    };
  }

  // Validar formato DD/MM/AAAA
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data)) {
    return { valid: false, mensagem: '📅 Formato de data inválido. Use DD/MM/AAAA (ex: 25/03/2025).' };
  }

  // Converter para YYYY-MM-DD
  const [dia, mes, ano] = data.split('/');
  const dataFormatada = `${ano}-${mes}-${dia}`;

  // Validar horário 08:00–18:00 (Luanda)
  const [hh, mm] = hora.split(':').map(Number);
  const totalMinutes = hh * 60 + (mm || 0);
  if (isNaN(hh) || isNaN(mm) || totalMinutes < 8 * 60 || totalMinutes > 18 * 60) {
    return {
      valid: false,
      mensagem: '🕐 Nosso horário de atendimento é das *08:00 às 18:00* (hora de Luanda).\n\nPor favor, escolha um horário dentro desse intervalo.',
    };
  }

  // Validar data futura (comparar com hoje em Luanda UTC+1)
  const nowLuanda = new Date(Date.now() + 60 * 60 * 1000);
  const todayLuanda = nowLuanda.toISOString().split('T')[0];
  if (dataFormatada < todayLuanda) {
    return { valid: false, mensagem: '📅 A data informada já passou. Por favor, escolha uma data futura.' };
  }

  return { valid: true, dataFormatada };
}

// ─────────────────────────────────────────────
// FLUXO: AGENDAR CONSULTA
// ─────────────────────────────────────────────
async function handleAgendar(from, aiResult) {
  const { nome, especialidade, data, hora, mensagem } = aiResult;

  // Validar dados
  const validation = validateDateTime(data, hora, nome, from);

  if (!validation.valid) {
    await sendMessage(from, validation.mensagem);
    return;
  }

  if (!especialidade) {
    await sendMessage(from, mensagem || 'Qual especialidade você precisa? (ex: Clínico Geral, Cardiologia, Pediatria...)');
    return;
  }

  // Dados válidos — salvar como pendente e pedir confirmação
  const pending = {
    nome,
    especialidade,
    data: validation.dataFormatada,
    hora,
  };

  await savePendingAppointment(from, pending);

  const confirmMsg =
    `Por favor confirme os detalhes da sua consulta:\n\n` +
    `👤 ${nome}\n` +
    `🏥 ${especialidade}\n` +
    `📅 ${data}\n` +
    `⏰ ${hora}\n\n` +
    `Responda *SIM* para confirmar ou *NÃO* para cancelar. 😊`;

  await sendMessage(from, confirmMsg);
}

// ─────────────────────────────────────────────
// FLUXO: CONFIRMAR/REJEITAR AGENDAMENTO PENDENTE
// ─────────────────────────────────────────────
async function handlePendingConfirmation(from, text, pending) {
  const textLower = text.toLowerCase().trim();

  const confirmWords = ['sim', 's', 'yes', 'confirmar', 'confirmo', 'ok', 'pode', '1', 'claro', 'certo'];
  const rejectWords = ['não', 'nao', 'no', 'cancelar', 'cancelo', 'cancela', 'desistir', '2', 'nope'];

  const isConfirmed = confirmWords.some(w => textLower === w || textLower.startsWith(w + ' ') || textLower.includes(w));
  const isRejected = rejectWords.some(w => textLower === w || textLower.startsWith(w + ' ') || textLower.includes(w));

  if (isConfirmed) {
    // Criar agendamento no Supabase
    const created = await createAppointment({
      nome: pending.nome,
      telefone: from,
      especialidade: pending.especialidade,
      data: pending.data,
      hora: pending.hora,
    });

    await clearPendingAppointment(from);

    if (created) {
      // Formatar data para exibição DD/MM/AAAA
      const [ano, mes, dia] = pending.data.split('-');
      const dataDisplay = `${dia}/${mes}/${ano}`;

      await sendMessage(
        from,
        `✅ Consulta confirmada!\n\n👤 ${pending.nome}\n🏥 ${pending.especialidade}\n📅 ${dataDisplay}\n⏰ ${pending.hora}\n\nAté breve! 😊`
      );

      // Agendar lembrete 24h antes (não bloqueia o fluxo)
      scheduleReminder(from, pending).catch(() => {});
    } else {
      await sendMessage(from, 'Desculpe, ocorreu um erro ao salvar o agendamento. Por favor, tente novamente. 🙏');
    }
    return;
  }

  if (isRejected) {
    await clearPendingAppointment(from);
    await sendMessage(from, `Ok ${pending.nome}, o agendamento pendente foi cancelado. Se precisar agendar novamente, é só me dizer! 😊`);
    return;
  }

  // Resposta ambígua — re-perguntar
  const [ano, mes, dia] = pending.data.split('-');
  const dataDisplay = `${dia}/${mes}/${ano}`;
  await sendMessage(
    from,
    `Por favor, responda *SIM* para confirmar ou *NÃO* para cancelar o agendamento:\n\n👤 ${pending.nome}\n🏥 ${pending.especialidade}\n📅 ${dataDisplay}\n⏰ ${pending.hora}`
  );
}

// ─────────────────────────────────────────────
// FLUXO: CANCELAR CONSULTA
// ─────────────────────────────────────────────
async function handleCancelar(from, aiResult) {
  const { nome } = aiResult;

  // Tentar encontrar pelo telefone primeiro
  let consulta = await findAppointmentByPhone(from);

  // Se não encontrar, tentar pelo nome
  if (!consulta && nome) {
    consulta = await findAppointmentByName(nome);
  }

  if (!consulta) {
    const nomeDisplay = nome || 'você';
    await sendMessage(from, `Não encontrei nenhuma consulta agendada para ${nomeDisplay}. Se precisar agendar, é só me dizer! 😊`);
    return;
  }

  const success = await cancelAppointment(consulta.id);

  if (success) {
    const [ano, mes, dia] = consulta.data.split('-');
    const dataDisplay = `${dia}/${mes}/${ano}`;
    await sendMessage(
      from,
      `✅ Consulta cancelada com sucesso!\n\n👤 ${consulta.nome}\n🏥 ${consulta.especialidade}\n📅 ${dataDisplay}\n⏰ ${consulta.hora ? consulta.hora.substring(0, 5) : ''}\n\nSe precisar reagendar, é só me dizer! 😊`
    );
  } else {
    await sendMessage(from, 'Desculpe, ocorreu um erro ao cancelar. Por favor, tente novamente ou contacte-nos pelo telefone. 🙏');
  }
}

// ─────────────────────────────────────────────
// LEMBRETE 24H ANTES (via setTimeout)
// ─────────────────────────────────────────────
async function scheduleReminder(from, pending) {
  try {
    const { nome, especialidade, data, hora } = pending;
    const appointmentDate = new Date(`${data}T${hora}:00+01:00`); // Luanda UTC+1
    const reminderDate = new Date(appointmentDate.getTime() - 24 * 60 * 60 * 1000);
    const delay = reminderDate.getTime() - Date.now();

    if (delay > 0 && delay < 7 * 24 * 60 * 60 * 1000) { // Máx 7 dias (segurança do servidor)
      setTimeout(async () => {
        const [ano, mes, dia] = data.split('-');
        const dataDisplay = `${dia}/${mes}/${ano}`;
        await sendMessage(
          from,
          `⏰ Lembrete: você tem uma consulta amanhã!\n\n👤 ${nome}\n🏥 ${especialidade}\n📅 ${dataDisplay}\n⏰ ${hora}\n\nAté amanhã! 😊`
        );
      }, delay);
      console.log(`[INFO] Lembrete agendado para ${from} em ${reminderDate.toISOString()}`);
    }
  } catch (err) {
    console.warn('[WARN] Falha ao agendar lembrete:', err.message);
  }
}

module.exports = {
  handleAgendar,
  handlePendingConfirmation,
  handleCancelar,
};
