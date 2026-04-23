const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────
// DEDUPLICAÇÃO — processed_messages
// ─────────────────────────────────────────────

async function isDuplicateMessage(messageId) {
  try {
    const { data, error } = await supabase
      .from('processed_messages')
      .insert({ message_id: messageId })
      .select();

    if (error) {
      // Erro de unique constraint = mensagem já existe = duplicata
      if (error.code === '23505') return true;
      // Outro erro: assumir não duplicata para não perder mensagens
      console.warn('[WARN] Erro ao verificar duplicata:', error.message);
      return false;
    }

    return !data || data.length === 0;
  } catch (err) {
    console.warn('[WARN] isDuplicateMessage falhou:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// SESSÕES — sessions
// ─────────────────────────────────────────────

async function getSession(phone) {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('phone', phone)
      .limit(1);

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  } catch (err) {
    console.warn('[WARN] getSession falhou:', err.message);
    return null;
  }
}

async function upsertSession(phone, fields) {
  try {
    const { error } = await supabase
      .from('sessions')
      .upsert({ phone, ...fields }, { onConflict: 'phone' });

    if (error) throw error;
  } catch (err) {
    console.warn('[WARN] upsertSession falhou:', err.message);
  }
}

async function clearPendingAppointment(phone) {
  return upsertSession(phone, { pending_appointment: null });
}

async function savePendingAppointment(phone, appointment) {
  return upsertSession(phone, { pending_appointment: appointment });
}

async function setHumanTakeover(phone, value) {
  return upsertSession(phone, { human_takeover: value, pending_appointment: null });
}

// ─────────────────────────────────────────────
// HISTÓRICO DE CONVERSA — conversation_history
// ─────────────────────────────────────────────

async function getConversationHistory(phone, limit = 20) {
  try {
    const { data, error } = await supabase
      .from('conversation_history')
      .select('role, content')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Retornar em ordem cronológica (mais antigo primeiro)
    return (data || []).reverse();
  } catch (err) {
    console.warn('[WARN] getConversationHistory falhou:', err.message);
    return [];
  }
}

async function saveMessage(phone, role, content, extras = {}) {
  try {
    const { error } = await supabase
      .from('conversation_history')
      .insert({ phone, role, content, ...extras });

    if (error) throw error;
  } catch (err) {
    console.warn('[WARN] saveMessage falhou:', err.message);
  }
}

// ─────────────────────────────────────────────
// AGENDAMENTOS — appointments
// ─────────────────────────────────────────────

async function createAppointment({ nome, telefone, especialidade, data, hora }) {
  try {
    const { data: result, error } = await supabase
      .from('appointments')
      .insert({ nome, telefone, especialidade, data, hora, status: 'agendado' })
      .select();

    if (error) throw error;
    return result ? result[0] : null;
  } catch (err) {
    console.error('[ERROR] createAppointment falhou:', err.message);
    return null;
  }
}

async function findAppointmentByPhone(phone) {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('telefone', phone)
      .eq('status', 'agendado')
      .order('data', { ascending: true })
      .limit(1);

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  } catch (err) {
    console.warn('[WARN] findAppointmentByPhone falhou:', err.message);
    return null;
  }
}

async function findAppointmentByName(nome) {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .ilike('nome', `${nome}%`)
      .eq('status', 'agendado')
      .order('data', { ascending: true })
      .limit(1);

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  } catch (err) {
    console.warn('[WARN] findAppointmentByName falhou:', err.message);
    return null;
  }
}

async function cancelAppointment(id) {
  try {
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'cancelado' })
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[ERROR] cancelAppointment falhou:', err.message);
    return false;
  }
}

module.exports = {
  isDuplicateMessage,
  getSession,
  upsertSession,
  clearPendingAppointment,
  savePendingAppointment,
  setHumanTakeover,
  getConversationHistory,
  saveMessage,
  createAppointment,
  findAppointmentByPhone,
  findAppointmentByName,
  cancelAppointment,
};
