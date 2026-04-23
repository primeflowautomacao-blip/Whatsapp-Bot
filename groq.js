const axios = require('axios');

// Data actual em Luanda (UTC+1)
function getLuandaDate() {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const d = now.toISOString().split('T')[0];
  const [ano, mes, dia] = d.split('-');
  return `${dia}/${mes}/${ano}`;
}

const SYSTEM_PROMPT = (dataHoje) => `Você é a Esperança, assistente virtual da Clínica Saúde Viva, localizada em Luanda, Angola.

INFORMAÇÕES DA CLÍNICA:
- Nome: Clínica Saúde Viva
- Endereço: Rua Marien Ngouabi, nº 47, Maianga, Luanda
- Telefone: +244 931 087 088
- Horário de atendimento: Segunda a Sexta, das 08:00 às 18:00
- Especialidades disponíveis: Clínico Geral, Cardiologia, Pediatria, Ginecologia, Ortopedia, Dermatologia, Oftalmologia
- Planos aceites: ENSA, AAA Saúde, Médis Angola, particular
- Consultas duram em média 30 minutos
- Agendamentos podem ser feitos com até 30 dias de antecedência

A tua personalidade:
- Chamas-te Esperança
- És muito gentil, calorosa e humana
- Falas português de Angola, de forma natural e acolhedora
- Podes dar explicações, esclarecer dúvidas e conversar naturalmente
- Quando não souberes responder algo, dizes com simpatia que vais verificar

REGRAS DO JSON — NUNCA QUEBRE ESTAS REGRAS:
1. Responde SEMPRE com um JSON válido no final da tua resposta
2. A data DEVE estar SEMPRE no formato DD/MM/AAAA. NUNCA use outro formato
3. A hora DEVE estar SEMPRE no formato HH:MM com zeros à esquerda. Ex: 09:30, 14:00
4. A data actual em Luanda é: ${dataHoje}
5. Se a hora for ambígua (ex: 'de manhã', 'à tarde'), coloca null e pede esclarecimento
6. Se a data for ambígua, coloca null e pede esclarecimento
7. As intenções possíveis são APENAS: agendar, cancelar, info, humano, outro
8. Para dúvidas gerais sobre a clínica, usa a intenção 'outro'

IMPORTANTE:
- O utilizador pode escrever datas de QUALQUER forma (ex: amanhã, next friday, 2 de abril, 02-04, daqui a 3 dias, etc)
- Interpreta corretamente e converte SEMPRE para DD/MM/AAAA
- Faz o mesmo para horas (ex: 7h → 07:00)

FORMATO JSON OBRIGATÓRIO (sempre no final):
{"intencao": "agendar|cancelar|info|humano|outro", "nome": "nome completo ou null", "especialidade": "especialidade ou null", "data": "DD/MM/AAAA ou null", "hora": "HH:MM ou null", "mensagem": "resposta amigável em português"}`;

async function callGroq(userText, historyMessages = []) {
  const dataHoje = getLuandaDate();

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT(dataHoje) },
          ...historyMessages,
          { role: 'user', content: userText },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const raw = response.data.choices[0].message.content || '';
    return parseAIResponse(raw);
  } catch (err) {
    console.error('[ERROR] Groq falhou:', err.response?.data || err.message);
    return {
      intencao: 'erro_ia',
      mensagem: 'Desculpe, estamos com dificuldades técnicas. Por favor, tente novamente em instantes. 🙏',
      nome: null,
      especialidade: null,
      data: null,
      hora: null,
    };
  }
}

function parseAIResponse(raw) {
  // Limpar markdown
  let cleaned = raw.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();

  // Extrair JSON do texto (a IA pode responder com texto + JSON)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Fallback por regex
    const intencaoMatch = raw.match(/"intencao"\s*:\s*"([^"]+)"/);
    const mensagemMatch = raw.match(/"mensagem"\s*:\s*"([^"]+)"/);
    return {
      intencao: intencaoMatch ? intencaoMatch[1] : 'outro',
      mensagem: mensagemMatch ? mensagemMatch[1] : 'Como posso ajudá-lo? 😊',
      nome: null,
      especialidade: null,
      data: null,
      hora: null,
    };
  }

  // Normalizar intenção
  parsed.intencao = (parsed.intencao || 'outro').toLowerCase().trim();
  parsed.nome = parsed.nome || null;
  parsed.especialidade = parsed.especialidade || null;
  parsed.mensagem = parsed.mensagem || 'Como posso ajudá-lo? 😊';

  // Normalizar data — aceita DD/MM/AAAA ou YYYY-MM-DD
  if (parsed.data) {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(parsed.data)) {
      // Formato correcto — mantém
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(parsed.data)) {
      const [ano, mes, dia] = parsed.data.split('-');
      parsed.data = `${dia}/${mes}/${ano}`;
    } else {
      parsed.data = null;
    }
  }

  // Normalizar hora — forçar HH:MM
  if (parsed.hora) {
    const horaMatch = parsed.hora.match(/^(\d{1,2}):(\d{2})$/);
    if (horaMatch) {
      const hh = String(horaMatch[1]).padStart(2, '0');
      parsed.hora = `${hh}:${horaMatch[2]}`;
    } else {
      parsed.hora = null;
    }
  }

  return parsed;
}

module.exports = { callGroq };
