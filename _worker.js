// Nova AI backend (Cloudflare Pages Function). API keys live ONLY in env vars.
const SYSTEM = `You are Nova AI, a helpful, accurate personal assistant. Always reply in the language the user writes in (Uzbek, English, Russian, etc.). Use Markdown and fenced code blocks. Never invent facts: if unsure, say so. Ask a short clarifying question when the request is ambiguous. Be concise unless the user asks for detail.`;

const hits = new Map(); // best-effort per-isolate rate limit
function limited(ip, max = 20, windowMs = 60000) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

const providers = {
  gemini: (env, msgs) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || 'gemini-2.5-flash'}:streamGenerateContent?alt=sse`,
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: { systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) },
    extract: d => (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
  }),
  groq: (env, msgs) => ({
    url: 'https://api.groq.com/openai/v1/chat/completions',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: { model: env.GROQ_MODEL || 'openai/gpt-oss-120b', stream: true,
      messages: [{ role: 'system', content: SYSTEM }, ...msgs] },
    extract: d => d.choices?.[0]?.delta?.content || ''
  })
};

async function handle({ request, env }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (limited(ip)) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429);

  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const msgs = data?.messages;
  if (!Array.isArray(msgs) || !msgs.length || msgs.length > 40 ||
      !msgs.every(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length > 0 && m.content.length <= 8000) ||
      msgs[msgs.length - 1].role !== 'user')
    return json({ error: 'Invalid messages.' }, 400);

  const name = (env.PROVIDER || 'gemini').toLowerCase();
  const key = name === 'groq' ? env.GROQ_API_KEY : env.GEMINI_API_KEY;
  if (!providers[name] || !key) return json({ error: 'The AI provider is not configured on the server.' }, 500);

  const p = providers[name](env, msgs.map(({ role, content }) => ({ role, content })));
  let up;
  try { up = await fetch(p.url, { method: 'POST', headers: p.headers, body: JSON.stringify(p.body) }); }
  catch { return json({ error: 'Could not reach the AI provider. Try again shortly.' }, 502); }
  if (!up.ok) {
    if (up.status === 429) return json({ error: 'The free daily AI quota is used up. Please try again later (quotas reset daily).' }, 429);
    return json({ error: `AI provider error (${up.status}). Please try again.` }, 502);
  }

  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = '';
  const ts = new TransformStream({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) {
        if (!l.startsWith('data:')) continue;
        const s = l.slice(5).trim();
        if (!s || s === '[DONE]') continue;
        try { const t = p.extract(JSON.parse(s)); if (t) ctl.enqueue(enc.encode(t)); } catch {}
      }
    }
  });
  return new Response(up.body.pipeThrough(ts), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      return handle({ request, env });
    }
    return env.ASSETS.fetch(request);
  }
};
