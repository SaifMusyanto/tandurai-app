import { HttpError } from './validate.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_MESSAGES = 30;
const MAX_CONTENT = 6000;
// Model penalaran (gpt-oss, qwen3) diberi effort rendah agar token tidak habis untuk berpikir.
const REASONING_MODEL = /^(openai\/gpt-oss|qwen\/qwen3)/;

/** Batas pesan chat per user (kuota Groq gratis terbatas; cegah satu akun menghabiskannya). */
function createRateLimiter({ max = 20, windowMs = 60 * 1000 } = {}) {
  const hits = new Map();
  return uid => {
    const now = Date.now();
    const entry = hits.get(uid);
    if (!entry || entry.resetAt <= now) return hits.set(uid, { count: 1, resetAt: now + windowMs });
    if (entry.count >= max) throw new HttpError(429, 'too_many_requests', 'Terlalu banyak pesan. Tunggu sebentar lalu coba lagi.');
    entry.count += 1;
  };
}

function validateMessages(input) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_MESSAGES) {
    throw new HttpError(400, 'invalid_input', `messages harus berisi 1–${MAX_MESSAGES} pesan.`);
  }
  return input.map((message, index) => {
    const role = message?.role;
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    if (!['system', 'user', 'assistant'].includes(role) || (role === 'system' && index !== 0)) {
      throw new HttpError(400, 'invalid_input', 'Peran pesan tidak valid.');
    }
    if (!content || content.length > MAX_CONTENT) throw new HttpError(400, 'invalid_input', `Isi pesan harus 1–${MAX_CONTENT} karakter.`);
    return { role, content };
  });
}

/**
 * Proxy chatbot dashboard ke Groq (API kompatibel OpenAI). API key hanya di server;
 * model & batas token ditentukan backend, bukan browser.
 */
export function createChatService({ config, log, fetchImpl = fetch }) {
  const limit = createRateLimiter();

  async function ask(user, body) {
    if (!config.groqApiKey) throw new HttpError(503, 'chat_disabled', 'Chat AI belum dikonfigurasi (GROQ_API_KEY kosong di server).');
    const messages = validateMessages(body?.messages);
    limit(user.uid);
    let response;
    try {
      response = await fetchImpl(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.groqApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.groqModel, messages, max_tokens: 1000, temperature: 0.7,
          ...(REASONING_MODEL.test(config.groqModel) ? { reasoning_effort: 'low' } : {}),
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      log.warn?.(`[chat] Groq tidak dapat dihubungi: ${error.message}`);
      throw new HttpError(502, 'chat_failed', 'Layanan AI tidak dapat dihubungi. Coba lagi nanti.');
    }
    const data = await response.json().catch(() => null);
    if (response.status === 429) throw new HttpError(429, 'chat_quota', 'Kuota AI gratis sedang habis. Coba lagi beberapa saat lagi.');
    if (!response.ok) {
      log.warn?.(`[chat] Groq ${response.status}: ${data?.error?.message || 'tanpa pesan'}`);
      throw new HttpError(502, 'chat_failed', 'Layanan AI sedang bermasalah. Coba lagi nanti.');
    }
    return { reply: data?.choices?.[0]?.message?.content?.trim() || 'Maaf, tidak ada respons.', model: data?.model || config.groqModel };
  }

  return { ask };
}
