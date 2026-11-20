const SYSTEM = `You are Nova AI, a helpful, accurate personal assistant. Always reply in the language the user writes in (Uzbek, English, Russian, etc.). Use Markdown and fenced code blocks. When writing Uzbek, use correct, natural Latin-script Uzbek (o', g', sh, ch) unless the user writes in Cyrillic. Never invent facts: if unsure, say so. Ask a short clarifying question when the request is ambiguous. If the user attaches images or files, analyze them. Be concise unless the user asks for detail.`;
const MODES = { short: ' Answer very briefly: 1-3 sentences unless asked otherwise.', detailed: ' Give thorough, structured, detailed answers with examples.', teacher: ' Act as a patient teacher: explain step by step in simple words, give one example, then ask one short question to check understanding.' };
const hits = new Map();
function limited(ip, max = 20, w = 60000) {
  const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < w);
  a.push(now); hits.set(ip, a); if (hits.size > 5000) hits.clear();
  return a.length > max;
}
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; img-src 'self' data: blob:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'";

async function bump(env, f) {
  if (!env.STATS) return;
  try { const k = 'd:' + new Date().toISOString().slice(0, 10), o = JSON.parse((await env.STATS.get(k)) || '{}');
    for (const x of f) o[x] = (o[x] || 0) + 1; await env.STATS.put(k, JSON.stringify(o), { expirationTtl: 7776000 }); } catch {}
}
async function chat(request, env, url, ctx) {
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== url.host) return J({ error: "Ruxsat yo'q." }, 403);
  if (limited(request.headers.get('CF-Connecting-IP') || 'x')) return J({ error: "Juda ko'p so'rov. Bir daqiqadan keyin urinib ko'ring." }, 429);
  let d; try { d = await request.json(); } catch { return J({ error: "Noto'g'ri so'rov." }, 400); }
  const m = d?.messages, n = m?.length;
  const ok = Array.isArray(m) && n && n <= 40 && m[n - 1].role === 'user' && m.every((x, i) =>
    (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string' && x.content && x.content.length <= 30000 &&
    (!x.images || (i === n - 1 && Array.isArray(x.images) && x.images.length <= 3 &&
      x.images.every(u => typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(u) && u.length < 1500000))));
  if (!ok) return J({ error: "Xabar noto'g'ri yoki juda katta." }, 400);
  if (!env.GROQ_API_KEY) return J({ error: 'Server sozlanmagan.' }, 500);

  const last = m[n - 1], vision = !!last.images?.length;
  ctx.waitUntil(bump(env, ['q', vision && 'i', d.search && !vision && 's'].filter(Boolean)));
  const msgs = m.map(({ role, content }, i) => i === n - 1 && vision
    ? { role, content: [{ type: 'text', text: content }, ...last.images.map(u => ({ type: 'image_url', image_url: { url: u } }))] }
    : { role, content });
  const models = vision ? [env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b']
    : (env.GROQ_MODELS || 'openai/gpt-oss-120b,openai/gpt-oss-20b').split(',').map(s => s.trim());
  let up = null, wait = 0;
  const tries = d.search && !vision ? [[models[0], 1], ...models.map(x => [x, 0])] : models.map(x => [x, 0]);
  for (const [model, srch] of tries) {
    const body = { model, stream: true, messages: [{ role: 'system', content: SYSTEM + (MODES[d.mode] || '') }, ...msgs] };
    if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
    if (srch) { body.tools = [{ type: 'browser_search' }]; body.tool_choice = 'required'; }
    try {
      up = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST',
        headers: { Authorization: 'Bearer ' + env.GROQ_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { up = null; continue; }
    if (up.ok) break;
    if (up.status === 429) wait = Math.max(wait, +up.headers.get('retry-after') || 0);
    else if (up.status < 500 && !srch) break;
  }
  if (!up || !up.ok) ctx.waitUntil(bump(env, ['e']));
  if (!up) return J({ error: "AI xizmatiga ulanib bo'lmadi. Birozdan keyin urinib ko'ring." }, 502);
  if (!up.ok) {
    if (up.status !== 429) return J({ error: `AI xatosi (${up.status}). Qayta urinib ko'ring.` }, 502);
    const t = wait ? ` Taxminan ${wait > 90 ? Math.ceil(wait / 60) + ' daqiqa' : wait + ' soniya'}dan keyin urinib ko'ring.` : " Birozdan keyin urinib ko'ring.";
    return J({ error: 'Bepul limit hozircha tugadi.' + t }, 429);
  }
  const dec = new TextDecoder(), enc = new TextEncoder(); let buf = '';
  const ts = new TransformStream({ transform(c, ctl) {
    buf += dec.decode(c, { stream: true }); const ls = buf.split('\n'); buf = ls.pop();
    for (const l of ls) { if (!l.startsWith('data:')) continue; const s = l.slice(5).trim(); if (!s || s === '[DONE]') continue;
      try { const t = JSON.parse(s).choices?.[0]?.delta?.content; if (t) ctl.enqueue(enc.encode(t)); } catch {} } } });
  return new Response(up.body.pipeThrough(ts), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') return request.method === 'POST' ? chat(request, env, url, ctx) : J({ error: 'Method not allowed' }, 405);
    if (url.pathname === '/api/hit' && request.method === 'POST') { ctx.waitUntil(bump(env, ['v'])); return J({ ok: 1 }); }
    if (url.pathname === '/api/stats') {
      if (limited('s' + (request.headers.get('CF-Connecting-IP') || 'x'), 10)) return J({ error: "Ko'p urinish." }, 429);
      if (!env.ADMIN_KEY || request.headers.get('Authorization') !== 'Bearer ' + env.ADMIN_KEY) return J({ error: "Ruxsat yo'q." }, 401);
      if (!env.STATS) return J({ error: 'KV ulanmagan.' }, 500);
      const l = await env.STATS.list({ prefix: 'd:' }), days = [];
      for (const k of l.keys.slice(-30)) days.push({ d: k.name.slice(2), ...JSON.parse((await env.STATS.get(k.name)) || '{}') });
      return J({ days });
    }
    const r = await env.ASSETS.fetch(request), h = new Headers(r.headers);
    for (const [k, v] of Object.entries(SEC)) h.set(k, v);
    if ((h.get('Content-Type') || '').includes('text/html')) h.set('Content-Security-Policy', CSP);
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
  }
};
