const TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}

function cleanQuery(value, max = 240) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function wikiSearch(query) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query', list: 'search', srsearch: query, srlimit: '4', format: 'json', origin: '*'
  }).toString();
  const r = await fetch(url, { headers: { 'User-Agent': 'FuturePowerAIPlus/3.0 (+https://futurepoweraiplus.pro15.workers.dev)' } });
  if (!r.ok) throw new Error(`Wikipedia search HTTP ${r.status}`);
  const data = await r.json();
  return (data?.query?.search || []).map(x => ({ title: x.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}`, snippet: String(x.snippet || '').replace(/<[^>]+>/g, '') }));
}

async function ddgInstantAnswer(query) {
  const url = new URL('https://api.duckduckgo.com/');
  url.search = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' }).toString();
  const r = await fetch(url);
  if (!r.ok) throw new Error(`DuckDuckGo HTTP ${r.status}`);
  const data = await r.json();
  const out = [];
  if (data?.AbstractText) out.push({ title: data.Heading || 'Instant Answer', url: data.AbstractURL || '', snippet: data.AbstractText });
  for (const item of (data?.RelatedTopics || []).slice(0, 4)) {
    if (item?.Text) out.push({ title: item.Text.slice(0, 90), url: item.FirstURL || '', snippet: item.Text });
  }
  return out;
}

async function onlineContext(query) {
  const q = cleanQuery(query);
  if (!q) return { query: '', sources: [] };

  const results = await Promise.allSettled([wikiSearch(q), ddgInstantAnswer(q)]);
  const sources = [];
  for (const result of results) {
    if (result.status === 'fulfilled') sources.push(...result.value);
  }

  const seen = new Set();
  const unique = sources.filter(s => {
    const k = `${s.title}|${s.url}|${s.snippet}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 8);

  return { query: q, sources: unique };
}

async function handleChat(request, env) {
  if (!env.AI) return json({ success: false, error: 'Cloudflare AI binding is not configured.' }, 503);
  const body = await request.json().catch(() => ({}));
  const prompt = cleanQuery(body?.prompt, 4000);
  if (!prompt) return json({ success: false, error: 'Prompt is required.' }, 400);

  let webContext = '';
  if (body?.online === true) {
    try {
      const data = await onlineContext(prompt);
      webContext = data.sources.map((s, i) => `[Web source ${i + 1}] ${s.title}\n${s.snippet}\n${s.url}`).join('\n\n');
    } catch (_) {}
  }

  const system = [
    'You are FuturePowerAIPlus online assistant.',
    'Answer directly, accurately and concisely.',
    'When web sources are supplied, use them as current reference material and do not invent unsupported current facts.',
    'If the supplied sources are insufficient, say that the online information was limited.',
    webContext ? `ONLINE REFERENCE MATERIAL:\n${webContext}` : ''
  ].filter(Boolean).join('\n\n');

  const result = await env.AI.run(TEXT_MODEL, {
    prompt: `${system}\n\nUSER:\n${prompt}`,
    max_tokens: 768,
    temperature: 0.2
  });

  const answer = String(result?.response || result?.text || '').trim();
  return json({ success: true, answer, model: TEXT_MODEL, onlineSourcesUsed: Boolean(webContext) });
}

async function handleWeb(request) {
  const body = await request.json().catch(() => ({}));
  const query = cleanQuery(body?.query);
  if (!query) return json({ success: false, error: 'Query is required.' }, 400);
  try {
    return json({ success: true, ...(await onlineContext(query)) });
  } catch (error) {
    return json({ success: false, error: String(error?.message || error) }, 502);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);

    if (url.pathname === '/api/health') return json({ success: true, online: true, version: '3.0' });
    if (url.pathname === '/api/chat' && request.method === 'POST') return handleChat(request, env);
    if (url.pathname === '/api/web' && request.method === 'POST') return handleWeb(request);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return json({ success: false, error: 'Not found.' }, 404);
  }
};
