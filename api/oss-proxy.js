const TARGET    = 'https://clientesdte3.oss.com.sv';
const PROXY_PFX = '/api/oss-proxy';

const DROP = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'transfer-encoding',
  'content-length',
]);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    return res.status(204).end();
  }

  const url     = new URL(req.url, `https://${req.headers.host}`);
  const subPath = url.pathname.replace(PROXY_PFX, '') || '/';
  const target  = `${TARGET}${subPath}${url.search}`;

  const fwd = {
    'user-agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language':           'es-SV,es;q=0.9,en;q=0.8',
    'upgrade-insecure-requests': '1',
  };

  if (req.headers.cookie)          fwd['cookie']         = req.headers.cookie;
  if (req.headers['content-type']) fwd['content-type']   = req.headers['content-type'];
  if (req.headers.referer)         fwd['referer']        = req.headers.referer.replace(`https://${req.headers.host}${PROXY_PFX}`, TARGET);

  const opts = { method: req.method, headers: fwd, redirect: 'manual' };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    opts.body = Buffer.concat(chunks);
  }

  let ossRes;
  try {
    ossRes = await fetch(target, opts);
  } catch {
    return res.status(502).send('Error connecting to OSS');
  }

  const setCookies = [];

  for (const [k, v] of ossRes.headers.entries()) {
    const lk = k.toLowerCase();
    if (DROP.has(lk)) continue;

    if (lk === 'set-cookie') {
      const rewritten = v
        .replace(/;\s*domain=[^;,]+/gi, '')
        .replace(/;\s*path=\//gi, `; path=${PROXY_PFX}/`)
        .replace(/;\s*samesite=strict/gi, '; SameSite=Lax');
      setCookies.push(rewritten);
      continue;
    }

    if (lk === 'location') {
      const base = `https://${req.headers.host}${PROXY_PFX}`;
      const loc = v.startsWith(TARGET)
        ? v.replace(TARGET, base)
        : v.startsWith('/')
        ? `${base}${v}`
        : v;
      res.setHeader('location', loc);
      continue;
    }

    res.setHeader(k, v);
  }

  if (setCookies.length) res.setHeader('set-cookie', setCookies);
  res.setHeader('access-control-allow-origin', '*');

  res.status(ossRes.status);

  const ct = ossRes.headers.get('content-type') ?? '';

  if (ct.includes('text/html')) {
    let html = await ossRes.text();
    const base = `https://${req.headers.host}${PROXY_PFX}`;
    html = html.replaceAll(TARGET, base);
    html = html.replace(
      /((?:href|src|action|data-href)\s*=\s*["'])(\/(?!\/)[^"']*)(["'])/gi,
      (_, pre, path, post) => `${pre}${base}${path}${post}`,
    );
    html = html.replace(
      /(window\.location(?:\.href)?\s*=\s*["'])(\/[^"']*)(["'])/gi,
      (_, pre, path, post) => `${pre}${base}${path}${post}`,
    );
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.send(html);
  }

  if (ct.includes('text/css')) {
    let css = await ossRes.text();
    const base = `https://${req.headers.host}${PROXY_PFX}`;
    css = css.replaceAll(TARGET, base);
    css = css.replace(/url\((['"]?)(\/(?!\/)[^)'"]*)\1\)/gi, (_, q, p) => `url(${q}${base}${p}${q})`);
    res.setHeader('content-type', ct);
    return res.send(css);
  }

  const buf = await ossRes.arrayBuffer();
  res.send(Buffer.from(buf));
}
