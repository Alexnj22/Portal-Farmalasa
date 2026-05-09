const TARGET      = "https://clientesdte3.oss.com.sv";
const PROXY_PFX   = "/functions/v1/oss-proxy";

// Headers we never forward to the client
const DROP_RESP = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "transfer-encoding",
  "content-encoding",
  "content-length",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  const url      = new URL(req.url);
  const subPath  = url.pathname.replace(new RegExp(`^${PROXY_PFX}`), "") || "/";
  const targetUrl = `${TARGET}${subPath}${url.search}`;

  // Build forwarded headers — send browser-like headers so OSS doesn't reject
  const fwd = new Headers();
  fwd.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
  fwd.set("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8");
  fwd.set("accept-language", "es-SV,es;q=0.9,en;q=0.8");
  fwd.set("accept-encoding", "gzip, deflate, br");
  fwd.set("upgrade-insecure-requests", "1");

  const cookie = req.headers.get("cookie");
  if (cookie) fwd.set("cookie", cookie);

  const ct = req.headers.get("content-type");
  if (ct) fwd.set("content-type", ct);

  const referer = req.headers.get("referer");
  if (referer) {
    fwd.set("referer", referer.replace(url.origin + PROXY_PFX, TARGET));
  }

  let ossRes: Response;
  try {
    ossRes = await fetch(targetUrl, {
      method:   req.method,
      headers:  fwd,
      body:     req.method !== "GET" && req.method !== "HEAD" ? req.body : null,
      redirect: "manual",
    });
  } catch {
    return new Response("Error connecting to OSS", { status: 502 });
  }

  const out = new Headers();
  out.set("access-control-allow-origin", "*");

  for (const [k, v] of ossRes.headers.entries()) {
    const lk = k.toLowerCase();

    if (DROP_RESP.has(lk)) continue;

    if (lk === "set-cookie") {
      // Remove domain lock, rewrite path so cookie is scoped to our proxy
      const rewritten = v
        .replace(/;\s*domain=[^;,]+/gi, "")
        .replace(/;\s*path=\//gi, `; path=${PROXY_PFX}/`)
        .replace(/;\s*samesite=strict/gi, "; SameSite=Lax");
      out.append("set-cookie", rewritten);
      continue;
    }

    if (lk === "location") {
      const loc = v.startsWith(TARGET)
        ? v.replace(TARGET, `${url.origin}${PROXY_PFX}`)
        : v.startsWith("/")
        ? `${url.origin}${PROXY_PFX}${v}`
        : v;
      out.set("location", loc);
      continue;
    }

    out.set(k, v);
  }

  const respCT = ossRes.headers.get("content-type") ?? "";

  // Rewrite HTML so all URLs point through this proxy
  if (respCT.includes("text/html")) {
    let html = await ossRes.text();
    const base = `${url.origin}${PROXY_PFX}`;

    // Absolute OSS URLs
    html = html.replaceAll(TARGET, base);

    // Root-relative href / src / action / data-href
    html = html.replace(
      /((?:href|src|action|data-href|data-url)\s*=\s*["'])(\/(?!\/)[^"'#?]*(?:[?#][^"']*)?)(["'])/gi,
      (_m, pre, path, post) => `${pre}${base}${path}${post}`,
    );

    // JS window.location = '/path'
    html = html.replace(
      /(window\.location(?:\.href)?\s*=\s*["'])(\/[^"']*)(["'])/gi,
      (_m, pre, path, post) => `${pre}${base}${path}${post}`,
    );

    out.set("content-type", "text/html; charset=utf-8");
    return new Response(html, { status: ossRes.status, headers: out });
  }

  // CSS: rewrite url('/path') references
  if (respCT.includes("text/css")) {
    let css = await ossRes.text();
    const base = `${url.origin}${PROXY_PFX}`;
    css = css.replaceAll(TARGET, base);
    css = css.replace(/url\((['"]?)(\/(?!\/)[^)'"]*)\1\)/gi,
      (_m, q, path) => `url(${q}${base}${path}${q})`);
    out.set("content-type", respCT);
    return new Response(css, { status: ossRes.status, headers: out });
  }

  return new Response(ossRes.body, { status: ossRes.status, headers: out });
});
