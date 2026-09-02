import { createClient } from "npm:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@1.6.2";
import JSZip from "npm:jszip@3.10.1";
import { getCorsHeaders, checkCronSecret, requireActiveEmployeeUser } from "../_shared/security.ts";
import { extractProveedorFromDte } from "../_shared/proveedorFromDte.ts";
import { extractRelatedDocRef, resolveRelatedDocId } from "../_shared/dteRelatedDoc.ts";

// Sincroniza facturas de compra (DTE JSON + PDF) desde las bandejas Gmail
// conectadas → Storage privado (purchase-dte) + purchase_dte_documents.
// Ver PLAN-FACTURAS-COMPRA-2026-07.md para el diseño completo.

const GMAIL_API      = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL       = "https://oauth2.googleapis.com/token";
const BACKFILL_FROM   = "2026/06/01";
const OVERLAP_DAYS    = 3;
const BUCKET          = "purchase-dte";
// Presupuesto de UNA invocación completa, no de una cuenta. H10
// (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): era por cuenta y las cuentas se
// recorren en serie, así que N cuentas multiplicaban el wall-clock real —
// con 2 cuentas ya daba ~200s, y conectar el tercer correo (pendiente
// conocido) lo llevaba a ~300s contra el límite de la plataforma. Si la
// invocación se corta ahí, la última cuenta pierde su trabajo y se re-escanea
// (no hay pérdida de datos: markMessagesProcessed corre dentro de
// processAccount, sólo con mensajes ya completados). Ahora el deadline es
// absoluto y se reparte entre las cuentas: la que no alcanza devuelve
// hasMore y el caller vuelve a llamar (el botón ya reintenta solo, ver E5).
const TIME_BUDGET_MS  = 100_000;
const ZIP_MAX_ENTRIES     = 50;               // tope de entradas escaneadas por zip — defensa contra zip bombs (miles de archivos diminutos)
const ZIP_MAX_ENTRY_BYTES = 10 * 1024 * 1024; // igual a MAX_REMOTE_BYTES/file_size_limit del bucket — más grande solo generaría un upload fallido

// Palabras que indican que el correo SÍ es una factura/DTE — se usa solo para
// descartar PDFs sueltos (sin JSON en el mismo correo) que no son facturas en
// absoluto (ej. cotizaciones, catálogos, comprobantes de pago de otro tipo).
// Si el correo trae al menos un JSON válido ya sabemos que es un DTE por
// estructura (validateDte), así que este filtro NO aplica en ese caso.
const DTE_EMAIL_KEYWORD_RE = /(factura|comprobante|\bdte\b|ccf|cr[ée]dito\s*fiscal|documento\s*tributario|nota\s*de\s*cr[ée]dito|nota\s*de\s*d[ée]bito|nota\s*de\s*remisi[oó]n|tributari[oa]\s*electr[oó]nic[oa])/i;

// Enlaces en el cuerpo del correo (en vez de adjunto inline) — algunos
// proveedores mandan "descargue su factura aquí" con un link a su portal en
// vez de adjuntar el PDF/JSON directo. Solo seguimos links cuyo URL o texto
// del ancla sugiera que es el documento (evita descargar links de
// unsubscribe, redes sociales, tracking pixels, etc.)
const LINK_KEYWORD_RE   = /(factura|comprobante|\bdte\b|ccf|cr[ée]dito\s*fiscal|documento\s*tributario|descarg|adjunt|\.pdf|\.json)/i;
// Imágenes decorativas de la plantilla (logos, íconos de "descargá tu
// factura aquí") suelen incluir "factura"/"descarg" en el nombre de archivo
// y matchean LINK_KEYWORD_RE, pero nunca son el DTE — content-type ya las
// descarta más abajo, pero AQUÍ importa porque consumían cupo de
// MAX_LINK_CANDIDATES antes de llegar al link real (caso real: plantilla de
// Movistar con varias imágenes "factura-digital-fide_XX.png" que en algunos
// envíos superaban el cupo y tapaban el link real de consultatusdte SIN
// generar ningún warning — el slice() corta antes del loop que loguea).
const IMAGE_EXT_RE      = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(?:$|\?)/i;
const MAX_LINK_CANDIDATES = 10;
const MAX_REMOTE_BYTES    = 10 * 1024 * 1024; // igual al file_size_limit del bucket purchase-dte — más grande solo generaría un upload fallido

// ── Helpers genéricos ─────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 2000): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
}

function base64UrlToBytes(data: string): Uint8Array {
  let b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '='; // JWT/base64url vienen sin padding — atob lo exige
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Algunos proveedores (ej. farmavalue, detectado en correos reenviados por
// arquitecto.aleman9@gmail.com) no mandan el DTE plano en el adjunto .json,
// sino el "sobre" que devuelve el servicio de recepción de Hacienda:
// { selloRecibido, firmaElectronica, dteJson }. `dteJson` ya es el DTE
// decodificado; `firmaElectronica` es el mismo DTE pero como JWS
// (header.payload.firma en base64url) — se usa solo si `dteJson` no vino.
// Sin este unwrap, validateDte() rechazaba estos correos con "sin
// identificacion.codigoGeneracion" aunque el DTE real sí estuviera adentro.
function decodeJwtPayload(jwt: string): any | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
  } catch { return null; }
}

function unwrapDteEnvelope(parsed: any): any {
  if (parsed?.identificacion?.codigoGeneracion) return parsed; // ya es el DTE plano
  if (parsed?.dteJson?.identificacion?.codigoGeneracion) return parsed.dteJson;
  if (typeof parsed?.firmaElectronica === 'string') {
    const decoded = decodeJwtPayload(parsed.firmaElectronica);
    if (decoded?.identificacion?.codigoGeneracion) return decoded;
  }
  return parsed;
}

// Algunos emisores generan el JSON del DTE con un bug de codificación: sus
// propios sistemas re-decodifican los bytes UTF-8 originales como
// Windows-1252 antes de guardar/serializar — el texto legítimo llega mal ya
// desde origen (confirmado con datos reales de facturaelectronica@facturas.
// claro.com.sv: "Ñ" real es UTF-8 C3 91, pero llega literal como "Ã‘" — el
// byte 0x91 bajo Windows-1252 es "‘" U+2018, NO el control C1 U+0091 que
// dará Latin-1 puro, por eso el mapeo cp1252 de abajo es necesario y no basta
// un simple charCodeAt/Latin-1). Reparar = codificar el string de vuelta a
// bytes cp1252 y re-decodificar como UTF-8; si algo no es representable en
// cp1252 o el resultado no es UTF-8 válido, se asume que no era mojibake y
// se deja el texto igual.
const MOJIBAKE_HINT_RE = /[ÃÂ]/;

// Windows-1252 difiere de Latin-1/ISO-8859-1 SOLO en el rango de bytes
// 0x80–0x9F (remapea esos 32 bytes a signos de puntuación/símbolos en vez de
// los controles C1 que da Latin-1 puro). 0x00–0x7F y 0xA0–0xFF son idénticos
// en ambas — por eso solo esta tabla parcial hace falta.
const CP1252_0x80_0x9F: Record<number, number> = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
  0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153,
  0x9E: 0x017E, 0x9F: 0x0178,
};
const CP1252_CODEPOINT_TO_BYTE: Record<number, number> = Object.fromEntries(
  Object.entries(CP1252_0x80_0x9F).map(([byte, cp]) => [cp, Number(byte)])
);

function charToCp1252Byte(codepoint: number): number | null {
  if (codepoint <= 0x7F) return codepoint; // ASCII
  if (codepoint >= 0xA0 && codepoint <= 0xFF) return codepoint; // igual que Latin-1 en este rango
  if (codepoint >= 0x80 && codepoint <= 0x9F) return codepoint; // Latin-1 puro (control C1 literal, menos común)
  if (codepoint in CP1252_CODEPOINT_TO_BYTE) return CP1252_CODEPOINT_TO_BYTE[codepoint];
  return null; // no representable en cp1252 — no es este patrón, no tocar
}

function repairMojibakeText(text: string): string {
  if (!MOJIBAKE_HINT_RE.test(text)) return text;
  const bytes: number[] = [];
  for (const ch of text) {
    const byte = charToCp1252Byte(ch.codePointAt(0)!);
    if (byte === null) return text;
    bytes.push(byte);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return text; // el "arreglo" no da UTF-8 válido — no era mojibake, dejar como está
  }
}

function repairMojibakeDeep(value: any): any {
  if (typeof value === 'string') return repairMojibakeText(value);
  if (Array.isArray(value)) return value.map(repairMojibakeDeep);
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value)) out[k] = repairMojibakeDeep(value[k]);
    return out;
  }
  return value;
}

function gmailDateFormat(d: Date): string {
  const y   = d.getUTCFullYear();
  const m   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').toLowerCase().trim();
}

// Storage keys de Supabase no toleran espacios/acentos/símbolos — los nombres de
// adjunto los pone el proveedor libremente (ej. "FACTURA CRÉDITO FISCAL N°...pdf").
// BD siempre guarda la URL formato-public como identificador (regla del
// proyecto, storageFiles.js firma esa forma) — nunca la ruta cruda, aunque el
// bucket sea privado (mismo patrón que documents/payment-proofs/empleados).
function publicUrl(path: string): string {
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

// Inversa de publicUrl — extrae el path relativo dentro del bucket desde la
// URL formato-public guardada en BD (mismo patrón usado en repair_stored_json/
// backfill_items_text/backfill_detect_codes, factorizado para E8).
function relativeStoragePath(storedUrl: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = storedUrl.indexOf(marker);
  return idx === -1 ? null : storedUrl.slice(idx + marker.length);
}

function sanitizeStorageKey(name: string): string {
  const normalized = name.normalize('NFD').replace(/[̀-ͯ]/g, ''); // quita acentos (á→a, é→e, ...)
  return normalized.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 180);
}

function headerValue(headers: any[], name: string): string | null {
  const h = (headers ?? []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function looksLikeDteEmail(subject: string | null, snippet: string | null): boolean {
  return DTE_EMAIL_KEYWORD_RE.test(`${subject ?? ''} ${snippet ?? ''}`);
}

// ── Enlaces en el cuerpo (en vez de adjunto) ───────────────────────────────────

function collectBodyText(part: any, htmlOut: string[], textOut: string[]) {
  if (!part) return;
  if (part.mimeType === 'text/html' && part.body?.data) {
    htmlOut.push(new TextDecoder().decode(base64UrlToBytes(part.body.data)));
  } else if (part.mimeType === 'text/plain' && part.body?.data) {
    textOut.push(new TextDecoder().decode(base64UrlToBytes(part.body.data)));
  }
  for (const child of (part.parts ?? [])) collectBodyText(child, htmlOut, textOut);
}

function extractCandidateLinks(htmlBodies: string[], textBodies: string[]): { url: string; label: string }[] {
  const out: { url: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const h of htmlBodies) {
    const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(h))) {
      const url = m[1].trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, label: m[2].replace(/<[^>]+>/g, ' ').trim() });
    }
  }
  // Además de <a href>, algunos proveedores (confirmado con Movistar/
  // facturaelectronicamovistarsv@movistar.com.sv, vía SendGrid) escriben la
  // URL real de descarga como TEXTO PLANO VISIBLE dentro del HTML, sin
  // envolverla en un <a> — el único <a> real en el correo es un tracking
  // pixel vacío (href de SendGrid, sin texto) totalmente separado. Por eso
  // el regex de "URL suelta" corre también contra el HTML crudo, no solo
  // contra los sibling text/plain — si solo mirara text/plain, este caso
  // quedaba invisible por completo (el correo era HTML-only).
  const urlRe = /https?:\/\/[^\s"'<>]+/gi;
  for (const t of [...htmlBodies, ...textBodies]) {
    let m: RegExpExecArray | null;
    while ((m = urlRe.exec(t))) {
      const url = m[0].replace(/[.,;)]+$/, '');
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, label: '' });
    }
  }
  return out;
}

// El correo llega de cualquier remitente externo (bandeja de intake de
// facturas) — antes de que la función haga fetch() a una URL tomada del
// cuerpo del correo, descarta hosts obviamente no-públicos (IP literal,
// localhost, *.local/*.internal) para no habilitar SSRF hacia la red interna
// del runtime vía un correo malicioso.
function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literal
    if (host.includes(':')) return false; // IPv6 literal
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return false;
    return true;
  } catch { return false; }
}

function inferExtensionFromContentType(ct: string | null): string | null {
  if (!ct) return null;
  const c = ct.toLowerCase();
  if (c.includes('application/pdf')) return 'pdf';
  if (c.includes('application/json') || c.includes('text/json')) return 'json';
  if (c.includes('application/zip') || c.includes('application/x-zip')) return 'zip';
  return null;
}

// Un proveedor puede devolver HTTP 200 con Content-Type "application/json"
// aunque el body sea en realidad un error HTML (ej. dteqr_json.php de
// farma_salud emite un Warning de PHP cuando el .json no existe en su
// filesystem, pero igual responde 200). Se valida el contenido real, no solo
// el header, antes de aceptarlo como candidato JSON.
function looksLikeJson(buf: ArrayBuffer): boolean {
  const head = new TextDecoder().decode(buf.slice(0, 512)).trimStart();
  return head.startsWith('{') || head.startsWith('[');
}

function filenameFromUrl(url: string): string {
  try {
    const base = new URL(url).pathname.split('/').filter(Boolean).pop() || 'archivo';
    return decodeURIComponent(base);
  } catch { return 'archivo'; }
}

function filenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(cd);
  return m ? decodeURIComponent(m[1].trim().replace(/"$/, '')) : null;
}

// Descarga los enlaces del cuerpo que parezcan apuntar al DTE (filtrados por
// LINK_KEYWORD_RE) y los normaliza como AttachmentPart (remoteBytes ya
// resuelto) para que entren al mismo pipeline de jsonParts/pdfParts de abajo.
// Links que no resuelven a un PDF/JSON/ZIP real (ej. una página de login) se
// descartan en silencio — no todo link con esas palabras es el documento.
async function collectLinkAttachments(htmlBodies: string[], textBodies: string[], warnings: string[], messageId: string): Promise<AttachmentPart[]> {
  const candidates = extractCandidateLinks(htmlBodies, textBodies)
    .filter(c => isSafeExternalUrl(c.url) && !IMAGE_EXT_RE.test(c.url) && (LINK_KEYWORD_RE.test(c.url) || LINK_KEYWORD_RE.test(c.label)))
    .slice(0, MAX_LINK_CANDIDATES);

  const out: AttachmentPart[] = [];
  for (const c of candidates) {
    try {
      const res = await withRetry(() => fetch(c.url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }), 2, 1500);

      const contentType   = res.headers.get('content-type');
      const contentLength = Number(res.headers.get('content-length') ?? '0');
      if (contentLength > MAX_REMOTE_BYTES) {
        warnings.push(`enlace ${c.url} (msg ${messageId}): excede tamaño máximo, omitido`);
        continue;
      }

      const cdFilename = filenameFromContentDisposition(res.headers.get('content-disposition'));
      let filename = cdFilename ?? filenameFromUrl(c.url);
      let ext = inferExtensionFromContentType(contentType);
      if (!ext) {
        const m = /\.(pdf|json|zip)(?:$|\?)/i.exec(filename) ?? /\.(pdf|json|zip)(?:$|\?)/i.exec(c.url);
        ext = m ? m[1].toLowerCase() : null;
      }
      if (!ext) {
        // No es un PDF/JSON/ZIP identificable (probablemente una página web,
        // ej. un login del portal del proveedor) — se omite. Advertencia con
        // el content-type real para poder diagnosticar proveedores nuevos.
        warnings.push(`enlace ${c.url} (msg ${messageId}): content-type "${contentType ?? 'desconocido'}" no es PDF/JSON/ZIP, omitido`);
        continue;
      }

      if (!new RegExp(`\\.${ext}$`, 'i').test(filename)) filename = `${filename}.${ext}`;

      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_REMOTE_BYTES) {
        warnings.push(`enlace ${c.url} (msg ${messageId}): excede tamaño máximo, omitido`);
        continue;
      }

      if (ext === 'json' && !looksLikeJson(buf)) {
        const snippet = new TextDecoder().decode(buf.slice(0, 200)).replace(/\s+/g, ' ').trim();
        warnings.push(`enlace ${c.url} (msg ${messageId}): content-type "${contentType}" dice JSON pero el body no lo es, omitido — body: "${snippet}"`);
        continue;
      }

      out.push({
        filename,
        mimeType: contentType ?? `application/${ext}`,
        attachmentId: null,
        inlineData: null,
        remoteBytes: new Uint8Array(buf),
      });
    } catch (e: any) {
      warnings.push(`enlace ${c.url} (msg ${messageId}): ${e.message}`);
    }
  }
  return out;
}

// ── Gmail API ──────────────────────────────────────────────────────────────────

async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await withRetry(() => fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  }).then(r => { if (!r.ok) throw new Error(`token refresh HTTP ${r.status}`); return r; }));
  const data = await res.json();
  if (!data.access_token) throw new Error('Google no devolvió access_token');
  return data.access_token;
}

async function listMessageIds(accessToken: string, query: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const url = new URL(`${GMAIL_API}/messages`);
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await withRetry(() => fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    }).then(r => { if (!r.ok) throw new Error(`messages.list HTTP ${r.status}`); return r; }));
    const data = await res.json();
    for (const m of (data.messages ?? [])) ids.push(m.id);
    pageToken = data.nextPageToken;
    pages++;
  } while (pageToken && pages < 50); // tope de seguridad: 5000 mensajes por cuenta/corrida
  return ids;
}

async function getMessage(accessToken: string, id: string): Promise<any> {
  const res = await withRetry(() => fetch(`${GMAIL_API}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  }).then(r => { if (!r.ok) throw new Error(`messages.get HTTP ${r.status}`); return r; }));
  return res.json();
}

interface AttachmentPart {
  filename: string;
  mimeType: string;
  attachmentId: string | null;
  inlineData: string | null; // base64url, cuando Gmail lo devuelve inline sin attachmentId
  remoteBytes?: Uint8Array | null; // ya descargado desde un enlace en el cuerpo (no vino como adjunto Gmail)
}

function collectAttachmentParts(part: any, out: AttachmentPart[]) {
  if (!part) return;
  if (part.filename && (part.body?.attachmentId || part.body?.data)) {
    out.push({
      filename: part.filename,
      mimeType: part.mimeType,
      attachmentId: part.body?.attachmentId ?? null,
      inlineData: part.body?.data ?? null,
      remoteBytes: null,
    });
  }
  for (const child of (part.parts ?? [])) collectAttachmentParts(child, out);
}

async function resolveAttachmentBytes(accessToken: string, messageId: string, part: AttachmentPart): Promise<Uint8Array> {
  if (part.remoteBytes) return part.remoteBytes;
  if (part.inlineData) return base64UrlToBytes(part.inlineData);
  if (!part.attachmentId) throw new Error(`adjunto ${part.filename} sin attachmentId ni data inline`);
  const res = await withRetry(() => fetch(`${GMAIL_API}/messages/${messageId}/attachments/${part.attachmentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  }).then(r => { if (!r.ok) throw new Error(`attachments.get HTTP ${r.status}`); return r; }));
  const data = await res.json();
  return base64UrlToBytes(data.data);
}

// Algunos proveedores mandan el DTE (JSON+PDF) empaquetado en un .zip en vez
// de adjuntos sueltos — antes se descartaba el mensaje entero con un warning
// ("no soportado v1"), perdiendo el documento para siempre. Se abre en
// memoria y los .json/.pdf que contenga se inyectan como AttachmentPart
// sintéticos (remoteBytes ya resuelto) al mismo pool que colectAttachmentParts
// arma para adjuntos/enlaces normales — participan de las mismas 3 fases de
// emparejamiento sin código de matching nuevo. Zips anidados y cualquier
// archivo que no sea .json/.pdf se ignoran (no hay evidencia de que sean
// parte de un DTE). Si el zip no se puede abrir (corrupto o con contraseña),
// se devuelve en `failed` para que el llamador lo guarde crudo y lo encole
// en Revisión (kind 'orphan_zip') en vez de perderlo en silencio.
async function expandZipAttachments(
  accessToken: string, messageId: string, zipParts: AttachmentPart[], warnings: string[],
): Promise<{ extracted: AttachmentPart[]; failed: AttachmentPart[] }> {
  const extracted: AttachmentPart[] = [];
  const failed: AttachmentPart[] = [];
  for (const zp of zipParts) {
    try {
      const zipBytes = await resolveAttachmentBytes(accessToken, messageId, zp);
      const zip = await JSZip.loadAsync(zipBytes);
      const entries = Object.values(zip.files).filter((f: any) => !f.dir).slice(0, ZIP_MAX_ENTRIES);
      let anyExtracted = false;
      for (const entry of entries as any[]) {
        const name = entry.name.toLowerCase();
        if (name.endsWith('.zip')) {
          warnings.push(`zip ${zp.filename} (msg ${messageId}): entrada "${entry.name}" es otro zip anidado, ignorada`);
          continue;
        }
        if (!name.endsWith('.json') && !name.endsWith('.pdf')) continue; // ej. logo, léeme — no es evidencia de DTE
        const bytes: Uint8Array = await entry.async('uint8array');
        if (bytes.byteLength > ZIP_MAX_ENTRY_BYTES) {
          warnings.push(`zip ${zp.filename} (msg ${messageId}): entrada "${entry.name}" excede tamaño máximo, omitida`);
          continue;
        }
        extracted.push({
          filename: entry.name.split('/').pop() || entry.name,
          mimeType: name.endsWith('.pdf') ? 'application/pdf' : 'application/json',
          attachmentId: null,
          inlineData: null,
          remoteBytes: bytes,
        });
        anyExtracted = true;
      }
      if (!anyExtracted) warnings.push(`zip ${zp.filename} (msg ${messageId}): no contenía ningún .json/.pdf reconocible`);
    } catch (e: any) {
      warnings.push(`zip ${zp.filename} (msg ${messageId}): no se pudo abrir (¿corrupto o con contraseña?) — ${e.message}`);
      failed.push(zp);
    }
  }
  return { extracted, failed };
}

// ── Validación DTE ────────────────────────────────────────────────────────────

function validateDte(json: any): { valid: boolean; reason?: string } {
  if (!json?.identificacion?.codigoGeneracion) return { valid: false, reason: 'sin identificacion.codigoGeneracion' };
  if (!json?.identificacion?.tipoDte) return { valid: false, reason: 'sin identificacion.tipoDte' };
  if (!json?.emisor?.nit) return { valid: false, reason: 'sin emisor.nit' };
  return { valid: true };
}

// Fase 4 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): concatena las
// descripciones (+ código, si existe) de cuerpoDocumento[] para permitir
// buscar por contenido del ítem (caso real: COFARSAL vende saldo Claro/Tigo
// en sus CCF). Únicas, unidas con " | ", cap defensivo ~8KB por documento.
const ITEMS_TEXT_MAX_BYTES = 8 * 1024;
// Bug real 2026-07-23: total_iva se leía de resumen.totalIva, campo que NO
// existe en el esquema real del Ministerio de Hacienda — confirmado
// inspeccionando un CCF real (657B07BB...): resumen no tiene totalIva, el
// IVA vive dentro de resumen.tributos[] como {codigo: "20", valor: N}
// (código 20 = IVA en el catálogo de tributos de Hacienda). Resultado: 513
// de 516 documentos de julio 2026 tenían total_iva en NULL, incluyendo 415
// CCF con IVA real en su JSON — la card "Crédito Fiscal IVA" del portal
// mostraba $36.82 en vez del monto real. Se prueba resumen.totalIva primero
// por si algún proveedor sí lo trae directo (no cuesta nada, y evita
// re-sumar si ya viene calculado), y se cae a sumar tributos código 20.
function extractTotalIva(json: any): number | null {
  const direct = json?.resumen?.totalIva;
  if (typeof direct === 'number' && direct > 0) return direct;
  const tributos = json?.resumen?.tributos;
  if (!Array.isArray(tributos)) return null;
  const iva = tributos
    .filter((t: any) => t?.codigo === '20')
    .reduce((sum: number, t: any) => sum + (Number(t?.valor) || 0), 0);
  return iva > 0 ? iva : null;
}

function extractItemsText(json: any): string | null {
  const items = json?.cuerpoDocumento;
  if (!Array.isArray(items) || items.length === 0) return null;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const it of items) {
    const desc = String(it?.descripcion ?? '').trim();
    if (!desc || seen.has(desc)) continue;
    seen.add(desc);
    parts.push(it?.codigo ? `${it.codigo} ${desc}` : desc);
  }
  if (parts.length === 0) return null;
  let text = parts.join(' | ');
  if (text.length > ITEMS_TEXT_MAX_BYTES) text = text.slice(0, ITEMS_TEXT_MAX_BYTES);
  return text;
}

// A pedido del usuario (2026-07-22): en vez de depender de un clic manual
// en el portal, el propio sync detecta el Código de Generación (UUID v4,
// dte_guia_tecnica.pdf pág. 7 — obligatorio en toda representación gráfica)
// impreso en un PDF huérfano — así queda guardado desde el momento en que
// entra a Revisión, listo para reconciliar automáticamente cuando el JSON
// llegue (o de inmediato, si el JSON ya estaba). unpdf: extracción de texto
// sin DOM/canvas, compatible con el runtime de Edge Functions (a diferencia
// de pdfjs-dist "completo", pensado para navegador — ese se usa del lado
// del cliente para el botón manual de respaldo).
const UUID_RE = /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/;
// A pedido del usuario (2026-07-22, E8): dos documentos NUNCA deberían
// compartir codigoGeneracion (es un UUID v4 propio de cada DTE) — si un PDF
// huérfano detecta el mismo código que un documento YA sincronizado con su
// propio PDF, hay dos explicaciones: (a) es un reenvío del MISMO archivo
// (duplicado real, seguro descartar en silencio), o (b) es un documento
// DISTINTO que solo referencia ese código en su texto — el caso real
// encontrado 2026-07-22 fue justo este: un aviso de invalidación de Easyfact
// menciona el código del CCF que anula, pero es un PDF propio, no una
// reimpresión del CCF. Distinguirlos por tamaño de bytes es débil (dos PDFs
// del mismo generador pueden variar por metadata/compresión); mejor señal:
// el propio texto del PDF dice qué tipo de documento es. Mismas palabras que
// ya usa el sync para detectar invalidaciones/notas en el JSON (ver
// DTE_EMAIL_KEYWORD_RE), pero centradas en las que indican "esto NO es la
// representación gráfica original".
// Ampliado 2026-07-22 tras verificación en vivo: el primer patrón exigía
// frases completas ("documento anulado", "ha sido anulado") y no capturaba
// el caso más común — un sello/watermark suelto "ANULADO" sobre la misma
// representación gráfica (caso real: Grupo Jamilu). Sin exigir contexto de
// frase, entonces — pero con un límite, y el límite estaba mal elegido:
//
// El `\b` de apertura hacía FALLAR justo el caso más común, y por eso esta
// línea vivió con la forma equivocada desde julio (medido el 2026-09-02 sobre
// los dos avisos de Uniserfa del 14-ago): la marca de agua no trae separador
// propio, así que unpdf la devuelve PEGADA al texto anterior —
// «$ 138.97ANULADO»—. Entre `7` y `A` no hay límite de palabra (los dos son
// \w), o sea que `\banulado` no matchea y el CCF vuelve a Revisión como si su
// PDF no dijera nada. Con pdftotext el mismo archivo sale separado letra por
// letra, así que el defecto tampoco se ve mirándolo con otra herramienta.
//
// Y el `\b` NO se puede quitar a secas: en una farmacéutica «GRANULADO» está
// en las descripciones de producto, y sin el límite marcaría anulado un CCF
// perfectamente vigente. El límite correcto no es «palabra» sino «que no
// venga pegado a otra LETRA» — un dígito o un símbolo delante sí valen.
const LETRA_RE_FRAG = 'A-Za-zÁÉÍÓÚÜÑáéíóúüñ';
const ANULADO_FRAG   = `(?<![${LETRA_RE_FRAG}])anulad[oa](?![${LETRA_RE_FRAG}])`;

const DOC_TYPE_NOTICE_RE = new RegExp(
  `(invalidaci[oó]n|anulaci[oó]n|${ANULADO_FRAG}|nota\\s+de\\s+cr[ée]dito|nota\\s+de\\s+d[ée]bito|comprobante\\s+de\\s+retenci[oó]n|comprobante\\s+de\\s+liquidaci[oó]n)`, 'i');

// Señal específica de "ANULADO" (vs. el conjunto más amplio de arriba, que
// también incluye invalidación/ND/NC) — se usa para decidir si conviene
// marcar automáticamente invalidado=true en el documento ya capturado con
// el mismo código, además de no descartarlo como duplicado.
const ANULADO_RE = new RegExp(ANULADO_FRAG, 'i');

// El asunto del correo es la ÚNICA señal cuando la marca de anulación es una
// IMAGEN y no texto: los tres avisos de Guardado del 28-ago traen exactamente
// el mismo texto que el CCF original (4,345 caracteres, idénticos) y cuatro
// imágenes de más — el sello está DIBUJADO. No hay nada que leer, y sin esto
// esos avisos se quedan en Revisión para siempre.
//
// Nunca actúa solo: sólo cuenta acompañado de un código de generación que YA
// matchea un documento guardado. Un asunto que dice «anulado» sin un código
// que resuelva no invalida nada.
const ASUNTO_ANULACION_RE = /(anulad[oa]|anulaci[oó]n|invalidad[oa]|invalidaci[oó]n|cancelaci[oó]n|cancelad[oa])/i;

async function detectCodigoGeneracionInPdf(pdfBytes: Uint8Array): Promise<{ codigo: string | null; isNoticeOrRelatedDoc: boolean; isAnulado: boolean }> {
  try {
    const doc = await getDocumentProxy(pdfBytes);
    const { text } = await extractText(doc, { mergePages: true });
    const match = text.match(UUID_RE);
    return {
      codigo: match ? match[0].toUpperCase() : null,
      isNoticeOrRelatedDoc: DOC_TYPE_NOTICE_RE.test(text),
      isAnulado: ANULADO_RE.test(text),
    };
  } catch {
    return { codigo: null, isNoticeOrRelatedDoc: false, isAnulado: false }; // PDF escaneado/sin capa de texto, o corrupto — no bloquea el resto del sync
  }
}

// ── Invalidación: un solo sitio la escribe ────────────────────────────────────

// Cuatro vías distintas descubren que un CCF fue anulado —el JSON del evento,
// el sello impreso en el PDF, el asunto del correo, y la segunda pasada del
// final de la corrida— y las cuatro tienen que hacer lo MISMO: marcar el
// documento, dejar el aviso enlazado y avisar si el mes ya se declaró. Con la
// escritura repartida, la quinta vía que se agregue se va a olvidar de una de
// las tres y nadie lo va a notar, porque un documento marcado «invalidado» se
// ve exactamente igual con o sin su aviso adjunto.
type ResultadoInvalidacion =
  | { estado: 'sin_documento' }
  | { estado: 'ya_invalidado'; doc: any }
  | { estado: 'marcado'; doc: any };

async function marcarInvalidado(
  supabase: any, codigoGeneracion: string, motivo: string | null, warnings: string[],
): Promise<ResultadoInvalidacion> {
  const { data: doc, error: findErr } = await supabase
    .from('purchase_dte_documents')
    .select('id, codigo_generacion, numero_control, emisor_nombre, fecha_emision, monto_total, invalidado')
    .eq('codigo_generacion', codigoGeneracion)
    .maybeSingle();
  if (findErr) throw new Error(`buscar ${codigoGeneracion}: ${findErr.message}`);
  if (!doc) return { estado: 'sin_documento' };
  // "Ya invalidado" NO es lo mismo que "no lo encontré", y la diferencia
  // decide si el aviso vuelve a la cola de Revisión o se cierra: con un solo
  // `update ... select` que devuelve 0 filas, los dos casos se ven iguales.
  if (doc.invalidado === true) return { estado: 'ya_invalidado', doc };

  const { error: updErr } = await supabase
    .from('purchase_dte_documents')
    .update({ invalidado: true, invalidado_motivo: motivo, invalidado_at: new Date().toISOString() })
    .eq('id', doc.id)
    .eq('invalidado', false);
  if (updErr) throw new Error(`marcar invalidado ${codigoGeneracion}: ${updErr.message}`);

  await avisarSiPeriodoCerrado(supabase, doc, motivo, warnings);
  return { estado: 'marcado', doc };
}

// Bajo la normativa DTE 2.0 el plazo del evento de invalidación se cuenta por
// RECEPTOR, no por tipo de documento: para un contribuyente son los 10
// primeros días hábiles del mes SIGUIENTE. O sea que un CCF del 28 de agosto
// se puede anular con septiembre empezado — cuando el libro de agosto ya se
// imprimió y se declaró.
//
// Marcarlo en silencio es el peor modo de falla posible: el libro que muestra
// la pantalla deja de dar el total del papel presentado, y no hay error, ni
// fila de menos, ni nada que falle. Se descubre cuadrando, meses después.
//
// `periodos_fiscales` está VACÍO hoy —nunca se cerró un mes—, así que esto
// nace inerte a propósito y se enciende solo el día que se cierre el primero.
//
// Va a quien LEE los libros (`libros_iva`) y no a quien cierra el período: el
// que declara es el que necesita enterarse, y `cierre_periodo` hoy no incluye
// ni al Contador Externo ni al Gerente General.
async function avisarSiPeriodoCerrado(supabase: any, doc: any, motivo: string | null, warnings: string[]) {
  try {
    if (!doc?.fecha_emision) return;
    const periodo = `${String(doc.fecha_emision).slice(0, 7)}-01`;
    const { data: per, error: perErr } = await supabase
      .from('periodos_fiscales').select('periodo').eq('periodo', periodo).eq('estado', 'cerrado').maybeSingle();
    if (perErr) throw new Error(`periodos_fiscales: ${perErr.message}`);
    if (!per) return; // el mes sigue abierto: la anulación entra al libro sin más

    // Antiduplicado por DOCUMENTO, no por corrida: la anulación de un CCF se
    // avisa una vez aunque el proveedor reenvíe el aviso tres veces (Guardado
    // mandó tres correos idénticos el 28-ago).
    const checkKey = `anulacion_periodo_cerrado:${doc.id}`;
    const { data: yaAvisado, error: nErr } = await supabase
      .from('notifications').select('id').eq('metadata->>check_key', checkKey).limit(1);
    if (nErr) throw new Error(`notifications: ${nErr.message}`);
    if (yaAvisado && yaAvisado.length > 0) return;

    const { data: roles, error: rErr } = await supabase
      .from('role_permissions').select('role_id').eq('module_key', 'libros_iva').eq('can_view', true);
    if (rErr) throw new Error(`role_permissions: ${rErr.message}`);
    const roleIds = (roles ?? []).map((r: any) => r.role_id);

    // La ficha técnica (QA) se filtra ACÁ y no con un `.neq()`: en PostgREST
    // un `tipo_ficha <> 'tecnica'` es NULL para las filas sin tipo, o sea que
    // las descarta también — y descartar destinatarios en silencio es
    // exactamente lo que este aviso existe para no hacer.
    const { data: gente, error: gErr } = roleIds.length === 0
      ? { data: [], error: null }
      : await supabase.from('employees').select('id, tipo_ficha').in('role_id', roleIds).eq('status', 'ACTIVO');
    if (gErr) throw new Error(`employees: ${gErr.message}`);
    const destinatarios = (gente ?? []).filter((g: any) => g.tipo_ficha !== 'tecnica').map((g: any) => String(g.id));

    const mes = String(doc.fecha_emision).slice(0, 7);
    if (destinatarios.length === 0) {
      // Un aviso sin destinatarios es un aviso que no existe. Se dice fuerte
      // en vez de contarlo como enviado.
      warnings.push(`DTE ${doc.codigo_generacion}: anulación sobre ${mes} YA CERRADO y NADIE puede recibir el aviso (nadie con can_view en libros_iva)`);
      return;
    }

    const { error: notiErr } = await supabase.rpc('notify_employees', {
      p_recipients: destinatarios,
      p_type: 'ANULACION_PERIODO_CERRADO',
      p_title: `Anularon un documento de ${mes}, que ya está declarado`,
      // Dice el monto y el proveedor porque es lo único accionable: con eso se
      // sabe de una si mueve la aguja de la declaración o no.
      p_body: `${doc.emisor_nombre ?? 'Un proveedor'} anuló ${doc.numero_control ?? doc.codigo_generacion}`
        + (doc.monto_total != null ? ` por $${Number(doc.monto_total).toFixed(2)}` : '')
        + `. ${motivo ?? 'Sin motivo declarado'}. El libro de ${mes} ya no da el mismo total que se declaró.`,
      p_link: '/libros-iva',
      p_metadata: { check_key: checkKey, documento_id: doc.id, periodo, codigo_generacion: doc.codigo_generacion },
    });
    if (notiErr) throw new Error(`notify_employees: ${notiErr.message}`);
    warnings.push(`DTE ${doc.codigo_generacion}: anulación sobre ${mes} YA CERRADO — avisado a ${destinatarios.length} persona(s)`);
  } catch (e: any) {
    // Que falle el aviso NO puede deshacer la marca de invalidado: el
    // documento anulado tiene que quedar anulado igual. Queda anotado.
    warnings.push(`aviso de período cerrado (doc ${doc?.id}): ${e.message}`);
  }
}

// Deja el aviso ENLAZADO al documento que invalidó, en vez de descartarlo.
// Es la mitad que el camino automático no hacía: `classify_purchase_dte_review`
// (el camino a mano) marca invalidado Y deja `matched_document_id`, y el visor
// lee justo eso para ofrecer «Ver PDF de anulación». El automático marcaba y
// no encolaba nada, así que el documento quedaba anulado sin ninguna prueba
// visible de por qué.
//
// Va con upsert que ACTUALIZA (no `ignoreDuplicates`): la fila puede existir
// ya, pendiente, de una corrida anterior que no supo reconocer el aviso — es
// exactamente el caso de los ocho avisos de agosto.
async function enlazarAvisoDeAnulacion(
  supabase: any, fila: Record<string, unknown>, documentId: number,
) {
  const { error } = await supabase.from('purchase_dte_review_queue').upsert({
    ...fila,
    status: 'emparejado',
    matched_document_id: documentId,
    resolved_at: new Date().toISOString(),
  }, { onConflict: 'account_id,source_message_id,filename' });
  if (error) throw new Error(`enlazar aviso: ${error.message}`);
}


// La segunda pasada — el orden de los correos NO puede decidir si una anulación
// se aplica.
//
// Dos de las cinco anulaciones de agosto se perdieron exactamente por eso, y
// por márgenes que ninguna regla de negocio elegiría: el aviso de Farquisal se
// procesó **0.77 s** antes de que su propio CCF entrara a la base, y el de
// Brandstar **25 s**. Los dos, dentro de la MISMA corrida — el `UPDATE ... WHERE
// codigo_generacion = <original>` no tocó ninguna fila, la anulación se encoló
// como "DTE original aún no capturado", y nada volvió a mirarla nunca.
//
// La primera pasada ya tiene un reintento, pero mira sólo `orphan_pdf` y sólo
// el documento que ACABA de insertar. Ésta cierra el caso general: al terminar
// la cuenta, todo lo que quedó pendiente se vuelve a contrastar contra la base
// completa. Cuesta una consulta y unas pocas filas, y es lo único que hace que
// el resultado no dependa del orden en que Gmail devolvió la lista.
const UUID_G_RE = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/;

async function reintentarAnulacionesPendientes(
  supabase: any, accountId: number, warnings: string[],
): Promise<number> {
  const { data: filas, error } = await supabase
    .from('purchase_dte_review_queue')
    .select('id, kind, filename, reason, ai_suggested, file_path, account_id, source_message_id, from_email, subject, received_at')
    .eq('account_id', accountId)
    .eq('status', 'pendiente')
    .or('kind.eq.invalidacion_pendiente,ai_suggested->>es_anulacion.eq.true');
  if (error) { warnings.push(`segunda pasada: no se pudo leer la cola — ${error.message}`); return 0; }

  let aplicadas = 0;
  for (const f of (filas ?? [])) {
    const ai = (f.ai_suggested ?? {}) as Record<string, any>;
    // El orden importa: en un aviso de invalidación el código del EVENTO
    // (`detected_codigo_generacion`, sacado del PDF) NO es el del documento
    // anulado. `invalida_codigo_generacion` sale del JSON y es el bueno.
    const codigo: string | null =
      ai.invalida_codigo_generacion
      ?? (f.kind === 'invalidacion_pendiente'
            // Las filas encoladas ANTES de que existiera `ai_suggested` acá
            // sólo tienen el código dentro de la frase de `reason`. Es un
            // rescate para lo ya acumulado, no la vía normal.
            ? (String(f.reason ?? '').match(UUID_G_RE)?.[0] ?? null)
            : ai.detected_codigo_generacion ?? null);
    if (!codigo) continue;

    try {
      const res = await marcarInvalidado(
        supabase, String(codigo).toUpperCase(),
        ai.motivo_anulacion ?? 'Anulado: aviso del proveedor recibido por correo',
        warnings,
      );
      if (res.estado === 'sin_documento') continue; // el original sigue sin llegar; queda pendiente
      const { error: linkErr } = await supabase.from('purchase_dte_review_queue')
        .update({ status: 'emparejado', matched_document_id: res.doc.id, resolved_at: new Date().toISOString() })
        .eq('id', f.id);
      if (linkErr) { warnings.push(`segunda pasada: revisión ${f.id} — ${linkErr.message}`); continue; }
      aplicadas++;
      warnings.push(res.estado === 'marcado'
        ? `segunda pasada: ${f.filename} → doc ${res.doc.id} (${codigo}) marcado invalidado`
        : `segunda pasada: ${f.filename} → doc ${res.doc.id} (${codigo}) ya estaba invalidado, aviso enlazado`);
    } catch (e: any) {
      warnings.push(`segunda pasada: revisión ${f.id} (${codigo}) — ${e.message}`);
    }
  }

  // Un aviso de invalidación llega como TRES archivos bajo la norma DTE 2.0: el
  // JSON del evento, la representación gráfica del evento y la del documento
  // anulado. Sólo el JSON sabe a qué documento apunta — el código impreso en el
  // PDF del evento es el del EVENTO, no el del CCF (Brandstar, 27-ago: el PDF
  // dice 122A62A7… y el anulado es 9F53BF27…). O sea que ese PDF NO se puede
  // resolver por sí mismo, y se quedaba pendiente para siempre aunque su propio
  // JSON, en el mismo correo, ya hubiera aplicado la anulación.
  //
  // El vínculo es el correo: llegaron juntos, hablan del mismo evento.
  const { data: resueltas, error: rErr } = await supabase
    .from('purchase_dte_review_queue')
    .select('source_message_id, matched_document_id')
    .eq('account_id', accountId)
    .eq('kind', 'invalidacion_pendiente')
    .eq('status', 'emparejado')
    .not('matched_document_id', 'is', null);
  if (rErr) { warnings.push(`segunda pasada (hermanos): ${rErr.message}`); return aplicadas; }

  const docPorMensaje = new Map<string, number>();
  for (const r of (resueltas ?? [])) {
    if (r.source_message_id) docPorMensaje.set(r.source_message_id, r.matched_document_id);
  }
  if (docPorMensaje.size === 0) return aplicadas;

  const { data: sueltos, error: sErr } = await supabase
    .from('purchase_dte_review_queue')
    .select('id, filename, source_message_id')
    .eq('account_id', accountId)
    .eq('kind', 'orphan_pdf')
    .eq('status', 'pendiente')
    .in('source_message_id', [...docPorMensaje.keys()]);
  if (sErr) { warnings.push(`segunda pasada (hermanos): ${sErr.message}`); return aplicadas; }

  for (const h of (sueltos ?? [])) {
    const docId = docPorMensaje.get(h.source_message_id);
    if (!docId) continue;
    const { error: linkErr } = await supabase.from('purchase_dte_review_queue')
      .update({ status: 'emparejado', matched_document_id: docId, resolved_at: new Date().toISOString() })
      .eq('id', h.id);
    if (linkErr) { warnings.push(`segunda pasada (hermanos): revisión ${h.id} — ${linkErr.message}`); continue; }
    warnings.push(`segunda pasada: ${h.filename} llegó en el mismo correo que la invalidación → enlazado al doc ${docId}`);
  }

  return aplicadas;
}

// ── Procesar una cuenta ────────────────────────────────────────────────────────

interface AccountResult {
  messagesScanned: number;
  documentsInserted: number;
  documentsSkipped: number;
  pdfsUnmatched: number;
  // Anulaciones que la segunda pasada aplicó al cierre de la cuenta. Se
  // reporta aparte de documentsInserted porque no es un documento nuevo: es un
  // documento viejo que dejó de valer, y ese número tiene que poder mirarse.
  anulacionesAplicadas: number;
  warnings: string[];
  hasMore: boolean;
  remaining: number;
}

// Fase 5 E1 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): antes esto cargaba
// TODA purchase_dte_processed_messages de la cuenta (crece sin tope, +cada
// correo para siempre) solo para filtrar un puñado de candidateIds de la
// corrida actual (la ventana de Gmail del query — normalmente días, no
// meses). Invertido: consulta SOLO los candidateIds de ESTA corrida, en
// chunks de 500 (límite de tamaño de URL/IN de PostgREST), en vez de bajar
// el historial completo. Pasa de O(historial) a O(ventana) por corrida.
async function selectDoneMessageIds(supabase: any, accountId: number, candidateIds: string[]): Promise<Set<string>> {
  const CHUNK = 500;
  const out = new Set<string>();
  for (let i = 0; i < candidateIds.length; i += CHUNK) {
    const chunk = candidateIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('purchase_dte_processed_messages')
      .select('source_message_id')
      .eq('account_id', accountId)
      .in('source_message_id', chunk);
    // Si falla, propaga el error en vez de devolver un set vacío en
    // silencio — un doneIds vacío hace que ESE chunk se re-escanee desde
    // Gmail como si nada estuviera procesado (costoso pero no pierde
    // datos), así que el caller decide si reintentar o abortar la corrida.
    if (error) throw new Error(`selectDoneMessageIds: ${error.message}`);
    for (const r of (data ?? [])) if (r.source_message_id) out.add(r.source_message_id);
  }
  return out;
}

// Fase 5 E2 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): 1 upsert en lote al
// final de la corrida en vez de 1 upsert por mensaje — el caller acumula en
// messagesToMarkProcessed y llama esto una sola vez. Chunks de 500 (mismo
// límite práctico usado en selectDoneMessageIds).
async function markMessagesProcessed(supabase: any, accountId: number, messageIds: string[]) {
  const CHUNK = 500;
  for (let i = 0; i < messageIds.length; i += CHUNK) {
    const chunk = messageIds.slice(i, i + CHUNK).map(id => ({ account_id: accountId, source_message_id: id }));
    const { error } = await supabase.from('purchase_dte_processed_messages')
      .upsert(chunk, { onConflict: 'account_id,source_message_id', ignoreDuplicates: true });
    if (error) throw new Error(`markMessagesProcessed: ${error.message}`);
  }
}

// `deadline` es el instante absoluto en que esta INVOCACIÓN debe haber
// terminado — compartido por todas las cuentas de la corrida (H10).
async function processAccount(supabase: any, account: any, dryRun: boolean, debugQuery: string | null | undefined, deadline: number): Promise<AccountResult> {
  const clientId     = Deno.env.get(account.client_id_secret_name ?? '') ?? '';
  const clientSecret  = Deno.env.get(account.client_secret_secret_name ?? '') ?? '';
  const refreshToken  = Deno.env.get(account.vault_secret_name ?? '') ?? '';
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      `Credenciales incompletas para ${account.email} (revisar secrets ` +
      `${account.client_id_secret_name}/${account.client_secret_secret_name}/${account.vault_secret_name})`
    );
  }

  const accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);

  const sinceDate = account.last_synced_date
    ? new Date(new Date(account.last_synced_date).getTime() - OVERLAP_DAYS * 86_400_000)
    : null;
  // -in:sent -in:drafts -in:chats: sin esto, la búsqueda de Gmail (que por
  // defecto cubre "Todos los mensajes", no solo bandeja de entrada) también
  // trae correos que la propia cuenta ENVIÓ (respuestas/reenvíos con el
  // mismo adjunto) — un DTE no puede ser "recibido" desde algo que nosotros
  // mandamos. No se usa in:inbox a secas para no perder facturas legítimas
  // que alguien archivó (sacó de la bandeja) después de procesarlas.
  //
  // -from:{account.email}: -in:sent NO alcanza — caso real encontrado
  // 2026-07-22: 3 correos "Comprobantes COF + JSON" con PDFs de VENTAS
  // (no de compra) que la propia cuenta se manda a sí misma (probable
  // relay/SMTP directo desde un sistema interno, nunca pasan por el
  // "Enviados" de Gmail así que -in:sent no los agarra) terminaron en
  // Revisión como huérfanos. Un DTE de compra real NUNCA puede venir del
  // From de nuestra propia cuenta — se excluye directo por remitente,
  // señal más confiable que la etiqueta de Gmail.
  //
  // has:attachment YA NO es el único criterio (caso real: Movistar manda
  // "Factura Electrónica Movistar" con el PDF Y el JSON como links en el
  // cuerpo, cero adjuntos reales — Gmail nunca la devolvía con has:attachment
  // a secas, así que el mensaje era invisible desde el paso 1, sin dejar
  // ningún rastro en documents/review_queue/warnings). Se amplía a
  // has:attachment OR una señal de asunto/cuerpo de que es factura/DTE, para
  // no perder proveedores que solo mandan enlaces.
  const query = debugQuery || (`after:${sinceDate ? gmailDateFormat(sinceDate) : BACKFILL_FROM} -in:sent -in:drafts -in:chats -from:${account.email} `
    + `(has:attachment OR subject:(factura OR facturas OR comprobante OR CCF OR DTE) OR "factura electronica" OR "documento tributario")`);

  const allMessageIds = await listMessageIds(accessToken, query);
  // debugQuery: diagnóstico puntual (ej. una franja de fechas específica) —
  // ignora processed_messages para poder re-inspeccionar mensajes ya
  // marcados como procesados sin necesidad de borrar esa tabla.
  const doneIds = debugQuery ? new Set<string>() : await selectDoneMessageIds(supabase, account.id, allMessageIds);
  const pendingIds = allMessageIds.filter(id => !doneIds.has(id));

  let messagesScanned    = 0;
  let documentsInserted  = 0;
  let documentsSkipped   = 0;
  let pdfsUnmatched       = 0;
  const warnings: string[] = [];
  let cutOff = false;
  const messagesToMarkProcessed: string[] = [];

  for (const id of pendingIds) {
    // H10: contra el deadline de la invocación, no contra un reloj propio.
    if (Date.now() > deadline) { cutOff = true; break; }
    messagesScanned++;
    // Si algo con pérdida de datos real falla para este mensaje (marcar
    // invalidado, encolar a revisión), NO se marca como procesado al final —
    // se reintenta en la próxima corrida en vez de perderse para siempre.
    let messageHadFailedReviewOp = false;
    let msg: any;
    try {
      msg = await getMessage(accessToken, id);
    } catch (e: any) {
      warnings.push(`mensaje ${id}: ${e.message}`);
      continue;
    }

    const headers    = msg.payload?.headers ?? [];
    const fromEmail  = headerValue(headers, 'From');
    const subject    = headerValue(headers, 'Subject');
    const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null;

    // Respaldo del -from:{account.email} en el query de arriba — un DTE de
    // COMPRA nunca puede venir del From de nuestra propia cuenta. Chequeo
    // extra por si el operador de Gmail no cubre algún formato de header
    // (ver caso real "Comprobantes COF + JSON" arriba).
    if (fromEmail && fromEmail.toLowerCase().includes(account.email.toLowerCase())) {
      warnings.push(`mensaje ${id}: descartado — From coincide con la propia cuenta (${fromEmail})`);
      messagesToMarkProcessed.push(id);
      continue;
    }

    const attachmentParts: AttachmentPart[] = [];
    collectAttachmentParts(msg.payload, attachmentParts);

    // Proveedores que mandan el DTE como enlace a su portal en vez de adjunto
    // inline (ej. "descargue su factura aquí") — se resuelven como si fueran
    // adjuntos normales y entran al mismo pipeline de abajo.
    const htmlBodies: string[] = [];
    const textBodies: string[] = [];
    collectBodyText(msg.payload, htmlBodies, textBodies);
    const linkParts = await collectLinkAttachments(htmlBodies, textBodies, warnings, id);
    attachmentParts.push(...linkParts);

    const zipParts = attachmentParts.filter(p => p.filename.toLowerCase().endsWith('.zip'));
    const zipFailedParts: AttachmentPart[] = [];
    if (zipParts.length > 0) {
      const { extracted, failed } = await expandZipAttachments(accessToken, id, zipParts, warnings);
      attachmentParts.push(...extracted);
      zipFailedParts.push(...failed);
    }

    const jsonParts = attachmentParts.filter(p => p.filename.toLowerCase().endsWith('.json'));
    const pdfParts  = attachmentParts.filter(p => p.filename.toLowerCase().endsWith('.pdf'));

    const usedPdfFilenames = new Set<string>();
    const validDtes: { json: any; jsonPart: AttachmentPart; pdfPart: AttachmentPart | null; rawBytes: Uint8Array; selloRecibido: string | null }[] = [];
    const invalidJsons: { part: AttachmentPart; reason: string; kind?: string; aiSuggested?: Record<string, unknown>; matchedDocumentId?: number }[] = [];

    for (const jp of jsonParts) {
      let bytes: Uint8Array;
      try {
        bytes = await resolveAttachmentBytes(accessToken, id, jp);
      } catch (e: any) {
        warnings.push(`adjunto ${jp.filename} (msg ${id}): ${e.message}`);
        documentsSkipped++;
        continue;
      }
      // JSON inválido/no-DTE sin ninguna señal de que el correo sea una
      // factura (ni el asunto/snippet ni el propio nombre del adjunto
      // mencionan factura/DTE/comprobante) → se descarta directo, no se
      // sube a Storage ni se encola en Revisión. Evita acumular ahí
      // adjuntos JSON de otro tipo de correo que nada tiene que ver con
      // facturación.
      const looksFacturaRelated = looksLikeDteEmail(subject, msg.snippet ?? null) || DTE_EMAIL_KEYWORD_RE.test(jp.filename);

      let parsed: any;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        warnings.push(`adjunto ${jp.filename} (msg ${id}): JSON inválido`);
        documentsSkipped++;
        if (looksFacturaRelated) invalidJsons.push({ part: jp, reason: 'JSON inválido (no parsea)' });
        continue;
      }
      // Fase 3.1: capturar selloRecibido del sobre ANTES de unwrapDteEnvelope
      // (que reemplaza `parsed` por el dteJson interno y lo perdería) — es
      // la evidencia de recepción del MH, se guarda como columna aparte.
      const selloRecibido: string | null = typeof parsed?.selloRecibido === 'string' ? parsed.selloRecibido : null;
      parsed = repairMojibakeDeep(unwrapDteEnvelope(parsed));

      // Acuse/Resp de recepción del MH (ej. "*-Resp.json", "Acuse_Electronico*.json"):
      // NO es el DTE — es la confirmación de que Hacienda ya lo recibió,
      // mismo codigoGeneracion pero esquema propio (top-level selloRecibido/
      // estado/descripcionMsg, sin identificacion/cuerpoDocumento). El DTE
      // real llega en su propio adjunto/link del mismo correo o de otro ya
      // procesado — esto es ruido esperado, se descarta sin pasar por
      // Revisión (antes acumulaba ahí como "sin identificacion.codigoGeneracion").
      if (parsed?.selloRecibido && parsed?.estado && parsed?.codigoGeneracion && !parsed?.identificacion) {
        documentsSkipped++;
        continue;
      }

      // Invalidación: el proveedor anuló un DTE ya emitido (esquema propio:
      // identificacion/emisor/documento/motivo, sin cuerpoDocumento/resumen).
      // No es una factura nueva — se conecta al documento original por
      // documento.codigoGeneracion marcándolo invalidado, en vez de
      // acumularse en Revisión mezclado con JSON genuinamente roto.
      if (parsed?.documento?.codigoGeneracion && parsed?.motivo) {
        const originalCodigo = String(parsed.documento.codigoGeneracion).toUpperCase();
        const motivo = parsed.motivo.motivoAnulacion ?? null;
        const fecAnula = parsed?.identificacion?.fecAnula ?? null;
        // El código del EVENTO no es el del documento que anula, y confundirlos
        // manda el aviso a un documento inexistente: en el aviso de Brandstar
        // del 27-ago el PDF imprime `122A62A7…` (el evento) y el CCF anulado es
        // `9F53BF27…`. El único sitio donde está el vínculo bueno es este
        // `documento.codigoGeneracion` del JSON.
        const aiSuggested = {
          invalida_codigo_generacion: originalCodigo,
          motivo_anulacion: motivo,
          fec_anula: fecAnula,
          es_anulacion: true,
        };
        try {
          const res = await marcarInvalidado(supabase, originalCodigo, motivo, warnings);
          if (res.estado === 'sin_documento') {
            // El original todavía no está en la base. Puede que llegue en esta
            // MISMA corrida —los dos correos entran juntos y el orden lo decide
            // Gmail—, así que la segunda pasada del final lo reintenta.
            if (looksFacturaRelated) {
              invalidJsons.push({
                part: jp,
                reason: `invalidación de ${originalCodigo} — DTE original aún no capturado`,
                kind: 'invalidacion_pendiente',
                aiSuggested,
              });
            }
          } else {
            // Se guarda IGUAL, enlazado al documento: el JSON del evento trae su
            // propio sello del MH («Invalidación Recibida y Procesada») y es la
            // prueba de que la anulación existe. Antes se descartaba en cuanto
            // el UPDATE tocaba una fila, así que el documento quedaba anulado
            // sin ningún respaldo que mirar.
            invalidJsons.push({
              part: jp,
              reason: `invalidación de ${originalCodigo} (${motivo ?? 'sin motivo'})`,
              kind: 'invalidacion_pendiente',
              aiSuggested,
              matchedDocumentId: res.doc.id,
            });
            warnings.push(res.estado === 'marcado'
              ? `DTE ${originalCodigo}: marcado invalidado (${motivo ?? 'sin motivo'})`
              : `DTE ${originalCodigo}: ya estaba invalidado — se enlaza el JSON del evento`);
          }
        } catch (e: any) {
          warnings.push(`DTE ${originalCodigo}: no se pudo marcar invalidado — ${e.message}`);
          messageHadFailedReviewOp = true;
        }
        documentsSkipped++;
        continue;
      }

      const check = validateDte(parsed);
      if (!check.valid) {
        warnings.push(`adjunto ${jp.filename} (msg ${id}): ${check.reason}`);
        documentsSkipped++;
        if (looksFacturaRelated) invalidJsons.push({ part: jp, reason: check.reason ?? 'inválido' });
        continue;
      }
      validDtes.push({ json: parsed, jsonPart: jp, pdfPart: null, rawBytes: bytes, selloRecibido });
    }

    // Emparejar JSON↔PDF en 3 fases (algunos proveedores, ej.
    // cimberton.fe@avdinternacional.com, nombran el PDF sin relación al
    // nombre del JSON, así que la comparación exacta de fase 1 nunca matchea):
    //
    // Fase 1: mismo nombre de archivo (caso normal, la mayoría de proveedores)
    for (const dte of validDtes) {
      const match = pdfParts.find(pp => baseName(pp.filename) === baseName(dte.jsonPart.filename) && !usedPdfFilenames.has(pp.filename));
      if (match) { dte.pdfPart = match; usedPdfFilenames.add(match.filename); }
    }
    // Fase 2: código de generación o número de control del DTE aparece dentro
    // del nombre del PDF (algunos proveedores sí lo embeben aunque el nombre
    // completo no coincida)
    for (const dte of validDtes) {
      if (dte.pdfPart) continue;
      const codigoGeneracion = String(dte.json?.identificacion?.codigoGeneracion ?? '').toLowerCase();
      const numeroControl    = String(dte.json?.identificacion?.numeroControl ?? '').toLowerCase();
      const match = pdfParts.find(pp => {
        if (usedPdfFilenames.has(pp.filename)) return false;
        const name = pp.filename.toLowerCase();
        return (codigoGeneracion.length > 8 && name.includes(codigoGeneracion)) ||
               (numeroControl.length > 8 && name.includes(numeroControl));
      });
      if (match) { dte.pdfPart = match; usedPdfFilenames.add(match.filename); }
    }
    // Fase 3: si queda exactamente un DTE sin PDF y exactamente un PDF sin
    // usar en el mismo correo, se asume que son el par (cubre nombres de PDF
    // totalmente humanos/arbitrarios sin ninguna referencia al DTE)
    const stillUnmatchedDtes = validDtes.filter(d => !d.pdfPart);
    const stillUnusedPdfs    = pdfParts.filter(pp => !usedPdfFilenames.has(pp.filename));
    if (stillUnmatchedDtes.length === 1 && stillUnusedPdfs.length === 1) {
      stillUnmatchedDtes[0].pdfPart = stillUnusedPdfs[0];
      usedPdfFilenames.add(stillUnusedPdfs[0].filename);
    }

    // PDFs del mensaje que no se pudieron asociar a ningún JSON válido (huérfanos).
    // Si el correo no trae ningún JSON, no hay evidencia estructural de que sea
    // un DTE — antes de guardar/encolar el PDF para revisión, exigimos que el
    // asunto o el preview del correo mencione algo tipo factura/DTE/comprobante,
    // para no acumular PDFs de correos que no son facturas en absoluto.
    const orphanPdfsAll = pdfParts.filter(pp => !usedPdfFilenames.has(pp.filename));
    const emailLooksLikeDte = jsonParts.length > 0 || looksLikeDteEmail(subject, msg.snippet ?? null);
    const orphanPdfs = emailLooksLikeDte ? orphanPdfsAll : [];
    if (!emailLooksLikeDte && orphanPdfsAll.length > 0) {
      documentsSkipped += orphanPdfsAll.length;
      warnings.push(`mensaje ${id} (${fromEmail}): ${orphanPdfsAll.length} adjunto(s) PDF ignorado(s) — el correo no parece ser factura/DTE (asunto: "${subject ?? ''}")`);
    }

    if (dryRun) {
      documentsInserted += validDtes.length; // conteo estimado, no se escribe nada
      pdfsUnmatched += orphanPdfs.length;
      continue;
    }

    for (const { json, jsonPart, pdfPart, rawBytes, selloRecibido } of validDtes) {
      const codigoGeneracion = json.identificacion.codigoGeneracion;
      const tipoDte = String(json.identificacion.tipoDte);
      const fecEmi: string | null = json.identificacion?.fecEmi ?? null;
      const now = new Date();
      const [yyyy, mm] = fecEmi
        ? fecEmi.split('-')
        : [String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0')];
      const basePath = `${yyyy}/${mm}/${codigoGeneracion}`;
      const jsonPath = `${basePath}.json`;
      const origJsonPath = `${basePath}.orig.json`;
      const pdfPath  = pdfPart ? `${basePath}.pdf` : null;

      try {
        // Se sube el objeto `json` YA desenvuelto/reparado (unwrapDteEnvelope +
        // repairMojibakeDeep), no los bytes crudos del adjunto — si el
        // proveedor mandó el sobre { selloRecibido, firmaElectronica, dteJson }
        // (ej. farmavalue), subir el crudo dejaría cuerpoDocumento/items
        // anidados en dteJson.* y el modal del portal (que espera el DTE
        // plano) los mostraría como "sin items".
        const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(jsonPath, jsonBytes, { contentType: 'application/json', upsert: false });
        if (upErr && !String(upErr.message).toLowerCase().includes('already exists')) {
          throw new Error(`upload json ${jsonPath}: ${upErr.message}`);
        }

        // Fase 3.1: respaldo de integridad (Decreto 487 Art. 3) — los bytes
        // EXACTOS del adjunto/link, sin ningún procesamiento. Best-effort: si
        // falla, se loguea pero NO aborta el documento — el normalizado de
        // arriba es la fuente que necesita el portal para funcionar; este
        // respaldo es adicional, no debe bloquear la ingesta.
        const { error: origUpErr } = await supabase.storage.from(BUCKET)
          .upload(origJsonPath, rawBytes, { contentType: 'application/json', upsert: false });
        if (origUpErr && !String(origUpErr.message).toLowerCase().includes('already exists')) {
          warnings.push(`DTE ${codigoGeneracion}: no se pudo subir respaldo .orig.json — ${origUpErr.message}`);
        }

        if (pdfPart && pdfPath) {
          const pdfBytes = await resolveAttachmentBytes(accessToken, id, pdfPart);
          const { error: pdfUpErr } = await supabase.storage.from(BUCKET)
            .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: false });
          if (pdfUpErr && !String(pdfUpErr.message).toLowerCase().includes('already exists')) {
            throw new Error(`upload pdf ${pdfPath}: ${pdfUpErr.message}`);
          }
        }

        const emisorNit    = json.emisor?.nit ?? null;
        const emisorNrc     = json.emisor?.nrc ?? null;
        const emisorNombre  = json.emisor?.nombre ?? null;

        const row = {
          codigo_generacion: codigoGeneracion,
          tipo_dte:           tipoDte,
          numero_control:      json.identificacion?.numeroControl ?? null,
          emisor_nit:          emisorNit,
          emisor_nrc:          emisorNrc,
          emisor_nombre:       emisorNombre,
          fecha_emision:       fecEmi,
          monto_total:         json.resumen?.totalPagar ?? json.resumen?.montoTotalOperacion ?? null,
          total_iva:            extractTotalIva(json),
          json_path:           publicUrl(jsonPath),
          orig_json_path:      origUpErr && !String(origUpErr.message).toLowerCase().includes('already exists') ? null : publicUrl(origJsonPath),
          sello_recibido:      selloRecibido,
          pdf_path:             pdfPath ? publicUrl(pdfPath) : null,
          account_id:          account.id,
          from_email:          fromEmail,
          source_message_id:   id,
          received_at:         receivedAt,
          // H7: '' y no NULL cuando el DTE no trae cuerpoDocumento (tipo 09,
          // FSE tipo 14). El backfill ya usaba '' a propósito — el insert no,
          // así que cada corrida futura del backfill re-descargaba de Storage
          // todos los tipo 09 acumulados desde la anterior (~2/día) para
          // volver a concluir lo mismo. Mismo criterio en los dos caminos.
          items_text:          extractItemsText(json) ?? '',
          // supplier_id se llena DESPUÉS del insert, derivado del maestro
          // (ver 2.2 más abajo) — no acá con un lookup propio por nrc exacto,
          // que ignoraba el match normalizado (nrc con/sin guión) que ya
          // resuelve upsert_proveedor_from_dte.
        };

        // ON CONFLICT (codigo_generacion) DO NOTHING — un DTE emitido nunca cambia.
        const { error: insErr, data: insData } = await supabase
          .from('purchase_dte_documents')
          .upsert(row, { onConflict: 'codigo_generacion', ignoreDuplicates: true })
          .select('id');
        if (insErr) throw new Error(`insert ${codigoGeneracion}: ${insErr.message}`);
        if (insData && insData.length > 0) {
          documentsInserted++;
          // Maestro de Proveedores (PLAN-PROVEEDORES-2026-07.md Fase 3.1): un
          // documento nuevo de verdad → intenta registrar/actualizar el
          // proveedor. 2.2 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): el
          // match ERP (supplier_id) se deriva del maestro después del upsert
          // — una sola fuente de verdad del match normalizado, en vez de un
          // lookup propio acá con .eq('nrc', ...) exacto que se desincronizaba
          // del RPC (nrc con/sin guión). E3 (Fase 5): el RPC ya devuelve
          // {id, supplier_id} en la misma llamada — sin el SELECT extra a
          // proveedores_maestro que hacía antes solo para leer ese dato.
          const dte = extractProveedorFromDte(json);
          if (dte) {
            const { data: proveedorResult, error: provErr } = await supabase.rpc('upsert_proveedor_from_dte', { p_data: dte });
            if (provErr) {
              warnings.push(`DTE ${codigoGeneracion}: upsert_proveedor_from_dte — ${provErr.message}`);
            } else {
              const { error: setErr } = await supabase.from('purchase_dte_documents')
                .update({ proveedor_id: proveedorResult?.id ?? null, supplier_id: proveedorResult?.supplier_id ?? null })
                .eq('id', insData[0].id);
              if (setErr) warnings.push(`DTE ${codigoGeneracion}: set proveedor_id/supplier_id — ${setErr.message}`);
            }
          }
          // Fase 3.2 automática: si había un PDF huérfano en Revisión cuyo
          // código detectado (ai_suggested, ver detectCodigoGeneracionInPdf)
          // coincide con este DTE recién insertado, se adjunta el PDF
          // directo — cierra el círculo sin ningún clic manual, aunque el
          // JSON haya llegado DESPUÉS del PDF (orden invertido de correos).
          const { data: pendingReview, error: pendingErr } = await supabase
            .from('purchase_dte_review_queue')
            .select('id, file_path')
            .eq('kind', 'orphan_pdf')
            .eq('status', 'pendiente')
            .eq('ai_suggested->>detected_codigo_generacion', codigoGeneracion.toUpperCase())
            .limit(1)
            .maybeSingle();
          if (!pendingErr && pendingReview) {
            const { data: attachData, error: attachErr } = await supabase
              .from('purchase_dte_documents')
              .update({ pdf_path: pendingReview.file_path })
              .eq('id', insData[0].id)
              .is('pdf_path', null)
              .select('id');
            if (attachErr) {
              warnings.push(`DTE ${codigoGeneracion}: no se pudo adjuntar PDF detectado previamente — ${attachErr.message}`);
            } else if (attachData && attachData.length > 0) {
              const { error: resolveErr } = await supabase.from('purchase_dte_review_queue')
                .update({ status: 'emparejado', matched_document_id: insData[0].id, resolved_at: new Date().toISOString() })
                .eq('id', pendingReview.id);
              if (resolveErr) warnings.push(`DTE ${codigoGeneracion}: no se pudo cerrar la fila de revisión ${pendingReview.id} — ${resolveErr.message}`);
              else warnings.push(`DTE ${codigoGeneracion}: emparejado automáticamente con PDF detectado previamente (revisión ${pendingReview.id})`);
            }
          }

          // Match CCF↔Nota de Crédito/Débito: si esta NC/ND trae
          // documentoRelacionado y el original ya está guardado, empareja.
          // Si el original llega DESPUÉS (orden invertido de correos), queda
          // sin emparejar hasta la próxima corrida de backfill-dte-related-docs.
          if (tipoDte === '05' || tipoDte === '06') {
            const ref = extractRelatedDocRef(json);
            if (ref) {
              const relatedId = await resolveRelatedDocId(supabase, ref);
              if (relatedId) {
                const { error: relErr } = await supabase.from('purchase_dte_documents').update({ documento_relacionado_id: relatedId }).eq('id', insData[0].id);
                if (relErr) warnings.push(`DTE ${codigoGeneracion}: set documento_relacionado_id — ${relErr.message}`);
              }
            }
          }
        } else {
          documentsSkipped++; // ya existía (duplicado entre correos/reenvíos)
        }
      } catch (e: any) {
        warnings.push(`DTE ${codigoGeneracion}: ${e.message}`);
        documentsSkipped++;
      }
    }

    // El asunto se lee UNA vez por mensaje, no por PDF: es la señal del correo,
    // no del archivo.
    const asuntoAnula = ASUNTO_ANULACION_RE.test(subject ?? '');

    for (const op of orphanPdfs) {
      try {
        const pdfBytes = await resolveAttachmentBytes(accessToken, id, op);
        const path = `review/${id}-${sanitizeStorageKey(op.filename)}`;
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: false });
        if (upErr && !String(upErr.message).toLowerCase().includes('already exists')) throw new Error(upErr.message);

        const { codigo: detectedCodigo, isNoticeOrRelatedDoc, isAnulado } = await detectCodigoGeneracionInPdf(pdfBytes);
        // Dos señales independientes, y hacen falta las dos porque cada
        // proveedor esconde la anulación en un sitio distinto: Uniserfa la
        // escribe en el PDF (`isAnulado`), Guardado la DIBUJA y sólo la dice
        // en el asunto (`asuntoAnula`). Ninguna de las dos sola cubría agosto.
        const esAvisoDeAnulacion = isAnulado || asuntoAnula;

        const fila = {
          kind:        'orphan_pdf',
          file_path:    publicUrl(path),
          filename:    op.filename,
          account_id:  account.id,
          source_message_id: id,
          from_email:  fromEmail,
          subject,
          received_at: receivedAt,
          ai_suggested: detectedCodigo
            ? { detected_codigo_generacion: detectedCodigo, es_anulacion: esAvisoDeAnulacion }
            : null,
        };

        // Si el código detectado ya tiene un DTE sincronizado SIN su propio
        // PDF, se adjunta directo — sin pasar por Revisión en absoluto.
        let autoMatched = false;
        // E8 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md, a pedido del usuario,
        // endurecido 2026-07-22 tras un falso negativo real: el filtro de
        // palabras clave solo no bastó — descartó por error el aviso de
        // "Comprobante Anulado" de Grupo Jamilu porque su texto no usaba
        // ninguna de las frases contempladas). Ahora exige DOS señales de
        // acuerdo antes de descartar en silencio: (1) mismo codigoGeneracion
        // Y (2) tamaño casi idéntico al PDF YA guardado para ese documento
        // (±2%) — un reenvío del MISMO archivo pesa prácticamente igual; un
        // documento distinto que solo comparte el código (aviso de
        // invalidación, nota relacionada) casi nunca coincide en tamaño. El
        // filtro de palabras clave queda como veto adicional: si el texto SÍ
        // suena a un aviso/nota, nunca se descarta aunque el tamaño
        // coincida.
        let isDuplicateResend = false;
        let autoInvalidated = false;
        if (detectedCodigo) {
          // El error del select NO se traga: con `!findErr && existing` un
          // fallo de red se leía igual que "no existe ese documento", y el
          // aviso se iba a Revisión como huérfano sin que nada lo dijera.
          const { data: existing, error: findErr } = await supabase
            .from('purchase_dte_documents')
            .select('id, pdf_path, invalidado')
            .eq('codigo_generacion', detectedCodigo)
            .maybeSingle();
          if (findErr) throw new Error(`buscar ${detectedCodigo}: ${findErr.message}`);

          if (existing && esAvisoDeAnulacion) {
            // La anulación se resuelve ANTES que "adjuntar el PDF que falta".
            // Con el orden viejo, un documento todavía sin PDF propio se
            // quedaba con el aviso colgado COMO SI fuera su representación
            // gráfica, y sin marcar: el archivo puesto y el CCF vigente.
            const res = await marcarInvalidado(
              supabase, detectedCodigo,
              isAnulado
                ? 'Anulado: el PDF del proveedor trae el sello ANULADO'
                : `Anulado: el proveedor lo avisó por correo («${(subject ?? '').slice(0, 80)}»)`,
              warnings,
            );
            if (res.estado !== 'sin_documento') {
              await enlazarAvisoDeAnulacion(supabase, fila, res.doc.id);
              autoInvalidated = true;
              warnings.push(res.estado === 'marcado'
                ? `PDF ${op.filename}: código ${detectedCodigo} — doc ${res.doc.id} marcado invalidado y aviso enlazado`
                : `PDF ${op.filename}: código ${detectedCodigo} — doc ${res.doc.id} ya estaba invalidado, aviso enlazado`);
            }
          } else if (existing && !existing.pdf_path) {
            const { data: attachData, error: attachErr } = await supabase
              .from('purchase_dte_documents')
              .update({ pdf_path: publicUrl(path) })
              .eq('id', existing.id)
              .is('pdf_path', null)
              .select('id');
            if (!attachErr && attachData && attachData.length > 0) {
              autoMatched = true;
              warnings.push(`PDF ${op.filename}: código ${detectedCodigo} detectado — emparejado automáticamente con doc ${existing.id}`);
            }
          } else if (existing && existing.pdf_path && existing.invalidado) {
            // Bug real 2026-07-22 (doc 1281, aviso de Easyfact): el documento
            // ya estaba invalidado por OTRA vía antes de que este PDF
            // llegara — mandarlo a Revisión le pide a un humano confirmar
            // algo que ya está aplicado, y se queda pendiente para siempre.
            // Se enlaza en vez de descartarse: es evidencia de ESE documento
            // venga de donde venga, y descartarla dejaba al CCF anulado sin
            // nada que mirar.
            await enlazarAvisoDeAnulacion(supabase, fila, existing.id);
            autoInvalidated = true;
            warnings.push(`PDF ${op.filename}: código ${detectedCodigo} — doc ${existing.id} ya estaba invalidado, aviso enlazado`);
          } else if (existing && existing.pdf_path && !isNoticeOrRelatedDoc) {
            const existingRel = relativeStoragePath(existing.pdf_path);
            if (existingRel) {
              const { data: existingBlob } = await supabase.storage.from(BUCKET).download(existingRel);
              if (existingBlob) {
                const existingSize = existingBlob.size;
                const newSize = pdfBytes.byteLength;
                const sizesMatch = existingSize > 0 && Math.abs(newSize - existingSize) / existingSize <= 0.02;
                if (sizesMatch) {
                  isDuplicateResend = true;
                  warnings.push(`PDF ${op.filename}: mismo código ${detectedCodigo} y tamaño casi idéntico (${newSize}B vs ${existingSize}B) al doc ${existing.id} — descartado como reenvío duplicado, no se manda a Revisión`);
                }
              }
            }
          }
        }

        if (!autoMatched && !isDuplicateResend && !autoInvalidated) {
          // Sin `ignoreDuplicates`, por lo mismo que el JSON del evento: la
          // fila puede existir ya, pendiente y sin `ai_suggested.es_anulacion`,
          // de una corrida anterior que no supo reconocer el aviso.
          const { error: rqErr } = await supabase.from('purchase_dte_review_queue')
            .upsert(fila, { onConflict: 'account_id,source_message_id,filename' });
          if (rqErr) throw new Error(rqErr.message);
          pdfsUnmatched++;
        }
      } catch (e: any) {
        warnings.push(`PDF huérfano ${op.filename} (msg ${id}): ${e.message}`);
        messageHadFailedReviewOp = true;
      }
    }

    // Zips que expandZipAttachments no pudo abrir (corrupto o con
    // contraseña) — se guarda el .zip crudo y se encola para revisión
    // humana en vez de perderlo en silencio (antes ESTE era el destino de
    // TODO adjunto .zip, sin siquiera intentar abrirlo).
    for (const zf of zipFailedParts) {
      try {
        const zipBytes = await resolveAttachmentBytes(accessToken, id, zf);
        const path = `review/${id}-${sanitizeStorageKey(zf.filename)}`;
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(path, zipBytes, { contentType: 'application/zip', upsert: false });
        if (upErr && !String(upErr.message).toLowerCase().includes('already exists')) throw new Error(upErr.message);
        const { error: rqErr } = await supabase.from('purchase_dte_review_queue').upsert({
          kind:        'orphan_zip',
          file_path:    publicUrl(path),
          filename:    zf.filename,
          reason:      'ZIP no se pudo abrir automáticamente (¿corrupto o con contraseña?)',
          account_id:  account.id,
          source_message_id: id,
          from_email:  fromEmail,
          subject,
          received_at: receivedAt,
        }, { onConflict: 'account_id,source_message_id,filename', ignoreDuplicates: true });
        if (rqErr) throw new Error(rqErr.message);
      } catch (e: any) {
        warnings.push(`zip huérfano ${zf.filename} (msg ${id}): no se pudo encolar para revisión — ${e.message}`);
        messageHadFailedReviewOp = true;
      }
    }

    for (const { part, reason, kind, aiSuggested, matchedDocumentId } of invalidJsons) {
      try {
        const jsonBytes = await resolveAttachmentBytes(accessToken, id, part);
        const path = `review/${id}-${sanitizeStorageKey(part.filename)}`;
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(path, jsonBytes, { contentType: 'application/json', upsert: false });
        if (upErr && !String(upErr.message).toLowerCase().includes('already exists')) throw new Error(upErr.message);
        const fila = {
          kind:        kind ?? 'invalid_json',
          file_path:    publicUrl(path),
          filename:    part.filename,
          reason,
          account_id:  account.id,
          source_message_id: id,
          from_email:  fromEmail,
          subject,
          received_at: receivedAt,
          // El código del documento anulado va en `ai_suggested`, no sólo dentro
          // del texto de `reason`: la segunda pasada lo necesita como DATO, y
          // sacarlo de una frase en prosa es la clase de acoplamiento que se
          // rompe el día que alguien reescribe el mensaje.
          ai_suggested: aiSuggested ?? null,
        };
        if (matchedDocumentId) {
          await enlazarAvisoDeAnulacion(supabase, fila, matchedDocumentId);
        } else {
          // Sin `ignoreDuplicates`: la fila puede existir ya, pendiente, de una
          // corrida vieja que la encoló sin `ai_suggested`. Si no se actualiza,
          // la segunda pasada no tiene con qué reintentarla y queda pendiente
          // para siempre — que es exactamente cómo llegaron acá las de agosto.
          const { error: rqErr } = await supabase.from('purchase_dte_review_queue')
            .upsert(fila, { onConflict: 'account_id,source_message_id,filename' });
          if (rqErr) throw new Error(rqErr.message);
        }
      } catch (e: any) {
        warnings.push(`JSON inválido ${part.filename} (msg ${id}): no se pudo encolar para revisión — ${e.message}`);
        messageHadFailedReviewOp = true;
      }
    }

    // Marca el mensaje como procesado, salvo que algo con pérdida de datos
    // real haya fallado arriba (invalidado, encolar a revisión) — en ese
    // caso queda pendiente para reintentar en la próxima corrida en vez de
    // perderse para siempre (exactamente el bug que originó esta regla).
    // Cubre igualmente el caso normal: DTE duplicado (ON CONFLICT DO
    // NOTHING) y mensajes con solo adjuntos no soportados (.zip).
    if (!messageHadFailedReviewOp) {
      messagesToMarkProcessed.push(id);
    } else {
      warnings.push(`mensaje ${id}: no se marca como procesado (falló una operación de revisión/invalidado) — se reintentará`);
    }
  }

  // Corre SIEMPRE, aunque la corrida se haya cortado por presupuesto: lo que
  // reintenta es trabajo ya guardado en la cola, no depende de haber terminado
  // de escanear Gmail. En dry_run no, que es de sólo lectura por contrato.
  let anulacionesAplicadas = 0;
  if (!dryRun) anulacionesAplicadas = await reintentarAnulacionesPendientes(supabase, account.id, warnings);

  if (messagesToMarkProcessed.length > 0) {
    try {
      await markMessagesProcessed(supabase, account.id, messagesToMarkProcessed);
    } catch (e: any) {
      // Best-effort: si el upsert en lote falla, esos mensajes se
      // re-escanean en la próxima corrida (más caro, pero ON CONFLICT DO
      // NOTHING en purchase_dte_documents evita duplicados reales) — no
      // debe abortar el resto de la respuesta de esta cuenta.
      warnings.push(`no se pudieron marcar ${messagesToMarkProcessed.length} mensajes como procesados — ${e.message}`);
    }
  }

  const hasMore = cutOff && messagesScanned < pendingIds.length;
  if (!dryRun && !hasMore) {
    await supabase.from('email_sync_accounts').update({ last_synced_date: new Date().toISOString() }).eq('id', account.id);
  }

  return {
    messagesScanned, documentsInserted, documentsSkipped, pdfsUnmatched, warnings,
    anulacionesAplicadas,
    hasMore, remaining: Math.max(0, pendingIds.length - messagesScanned),
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Doble vía de invocación: pg_cron (x-cron-secret) o botón "Sincronizar ahora"
  // del portal (JWT de empleado activo + permiso can_edit en facturas_compra).
  let authorized = checkCronSecret(req);
  if (!authorized) {
    const employee = await requireActiveEmployeeUser(req, admin);
    if (employee) {
      const { data: empRole } = await admin.from('employees').select('role_id').eq('id', employee.id).single();
      const { data: perm } = await admin.from('role_permissions').select('can_edit')
        .eq('role_id', empRole?.role_id ?? -1).eq('module_key', 'facturas_compra').single();
      authorized = perm?.can_edit === true;
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { dry_run = false, account_id = null, repair_stored_json = false, debug_query = null, backfill_items_text = false, backfill_detect_codes = false, backfill_total_iva = false, backfill_orig_json = false, after_id = 0, limit: p_limit = null } = body;

    // Mantenimiento puntual: re-normaliza los archivos .json YA guardados en
    // Storage con unwrapDteEnvelope + repairMojibakeDeep. Necesario porque
    // esas dos correcciones (v2.23.4) solo se aplicaban al insertar la fila
    // en purchase_dte_documents — el archivo subido a Storage seguía siendo
    // los bytes crudos del adjunto (el sobre {selloRecibido,firmaElectronica,
    // dteJson} sin desenvolver, o el nombre del emisor con mojibake), que es
    // lo que el modal de detalle del portal lee directo. No necesita Gmail —
    // solo re-descarga y re-sube el archivo si algo cambió.
    if (repair_stored_json === true) {
      const CHUNK = 1000;
      const startOffset: number = Number(body.repair_offset ?? 0);
      let offset = startOffset;
      let checked = 0, repaired = 0, unchanged = 0;
      const errors: string[] = [];
      const startTime = Date.now();
      let cutOff = false;

      outer: for (;;) {
        const { data: docs, error: docsErr } = await admin
          .from('purchase_dte_documents')
          .select('id, json_path')
          .not('json_path', 'is', null)
          .order('id', { ascending: true })
          .range(offset, offset + CHUNK - 1);
        if (docsErr) throw new Error(`purchase_dte_documents: ${docsErr.message}`);
        if (!docs || docs.length === 0) break;

        for (let i = 0; i < docs.length; i++) {
          if (Date.now() - startTime > TIME_BUDGET_MS) { cutOff = true; offset += i; break outer; }
          const doc = docs[i];
          checked++;
          try {
            const marker = `/storage/v1/object/public/${BUCKET}/`;
            const idx = (doc.json_path as string).indexOf(marker);
            if (idx === -1) { errors.push(`doc ${doc.id}: json_path con formato inesperado`); continue; }
            const path = (doc.json_path as string).slice(idx + marker.length);

            const { data: fileData, error: dlErr } = await admin.storage.from(BUCKET).download(path);
            if (dlErr) { errors.push(`doc ${doc.id}: download — ${dlErr.message}`); continue; }
            const rawText = await fileData.text();

            let parsed: any;
            try { parsed = JSON.parse(rawText); } catch { errors.push(`doc ${doc.id}: JSON crudo inválido en Storage`); continue; }
            const fixedText = JSON.stringify(repairMojibakeDeep(unwrapDteEnvelope(parsed)));
            if (fixedText === rawText) { unchanged++; continue; }

            const { error: upErr } = await admin.storage.from(BUCKET)
              .upload(path, new TextEncoder().encode(fixedText), { contentType: 'application/json', upsert: true });
            if (upErr) { errors.push(`doc ${doc.id}: upload — ${upErr.message}`); continue; }
            repaired++;
          } catch (e: any) {
            errors.push(`doc ${doc.id}: ${e.message}`);
          }
        }

        if (cutOff) break;
        if (docs.length < CHUNK) break;
        offset += CHUNK;
      }
      return new Response(JSON.stringify({
        repair_stored_json: true, checked, repaired, unchanged,
        hasMore: cutOff, nextOffset: cutOff ? offset : null,
        errors: errors.slice(0, 50),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Fase 4 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): puebla items_text
    // para documentos ya sincronizados antes de este cambio — baja el JSON
    // ya guardado en Storage (no necesita Gmail), extrae cuerpoDocumento y
    // hace UPDATE. Mismo patrón exacto que repair_stored_json de arriba:
    // pagina por id con items_text IS NULL, hasMore por presupuesto de
    // tiempo, idempotente.
    if (backfill_items_text === true) {
      const CHUNK = 1000;
      let checked = 0, updated = 0, skipped = 0;
      const errors: string[] = [];
      const startTime = Date.now();
      let cutOff = false;

      for (;;) {
        if (Date.now() - startTime > TIME_BUDGET_MS) { cutOff = true; break; }
        const { data: docs, error: docsErr } = await admin
          .from('purchase_dte_documents')
          .select('id, json_path')
          .not('json_path', 'is', null)
          .is('items_text', null)
          .order('id', { ascending: true })
          .limit(CHUNK);
        if (docsErr) throw new Error(`purchase_dte_documents: ${docsErr.message}`);
        if (!docs || docs.length === 0) break;

        for (const doc of docs) {
          if (Date.now() - startTime > TIME_BUDGET_MS) { cutOff = true; break; }
          checked++;
          try {
            const marker = `/storage/v1/object/public/${BUCKET}/`;
            const idx = (doc.json_path as string).indexOf(marker);
            if (idx === -1) { errors.push(`doc ${doc.id}: json_path con formato inesperado`); continue; }
            const path = (doc.json_path as string).slice(idx + marker.length);

            const { data: fileData, error: dlErr } = await admin.storage.from(BUCKET).download(path);
            if (dlErr) { errors.push(`doc ${doc.id}: download — ${dlErr.message}`); continue; }
            const parsed = JSON.parse(await fileData.text());
            const itemsText = extractItemsText(parsed);
            // '' en vez de dejar NULL cuando no hay cuerpoDocumento (ej. FSE
            // tipo 14) — si no, la fila sigue matcheando items_text IS NULL
            // y este backfill la re-procesa (re-descarga) en cada corrida,
            // para siempre, sin converger nunca (mismo riesgo que E6).
            if (!itemsText) skipped++;

            const { error: upErr } = await admin.from('purchase_dte_documents').update({ items_text: itemsText ?? '' }).eq('id', doc.id);
            if (upErr) { errors.push(`doc ${doc.id}: update — ${upErr.message}`); continue; }
            updated++;
          } catch (e: any) {
            errors.push(`doc ${doc.id}: ${e.message}`);
          }
        }
        if (cutOff) break;
        if (docs.length < CHUNK) break;
      }
      return new Response(JSON.stringify({
        backfill_items_text: true, checked, updated, skipped,
        hasMore: cutOff, errors: errors.slice(0, 50),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Backfill puntual 2026-07-23: recalcula total_iva para documentos ya
    // sincronizados ANTES del fix de extractTotalIva (ver comentario ahí —
    // resumen.totalIva no existe en el esquema real, el IVA vive en
    // resumen.tributos[]). Re-lee el JSON YA guardado en Storage, no hace
    // falta Gmail. Escribe 0 (no deja NULL) cuando el documento
    // efectivamente no tiene tributo código 20 (ej. FSE) — así
    // `total_iva IS NULL` converge como marcador de "no procesado" en vez
    // de reprocesar esas filas para siempre (mismo riesgo que E6/items_text).
    if (backfill_total_iva === true) {
      const CHUNK = 1000;
      let checked = 0, updated = 0, foundIva = 0;
      const errors: string[] = [];
      const startTime = Date.now();
      let cutOff = false;

      for (;;) {
        if (Date.now() - startTime > TIME_BUDGET_MS) { cutOff = true; break; }
        const { data: docs, error: docsErr } = await admin
          .from('purchase_dte_documents')
          .select('id, json_path')
          .not('json_path', 'is', null)
          .is('total_iva', null)
          .order('id', { ascending: true })
          .limit(CHUNK);
        if (docsErr) throw new Error(`purchase_dte_documents: ${docsErr.message}`);
        if (!docs || docs.length === 0) break;

        for (const doc of docs) {
          if (Date.now() - startTime > TIME_BUDGET_MS) { cutOff = true; break; }
          checked++;
          try {
            const marker = `/storage/v1/object/public/${BUCKET}/`;
            const idx = (doc.json_path as string).indexOf(marker);
            if (idx === -1) { errors.push(`doc ${doc.id}: json_path con formato inesperado`); continue; }
            const path = (doc.json_path as string).slice(idx + marker.length);

            const { data: fileData, error: dlErr } = await admin.storage.from(BUCKET).download(path);
            if (dlErr) { errors.push(`doc ${doc.id}: download — ${dlErr.message}`); continue; }
            const parsed = JSON.parse(await fileData.text());
            const iva = extractTotalIva(parsed);
            if (iva) foundIva++;

            const { error: upErr } = await admin.from('purchase_dte_documents').update({ total_iva: iva ?? 0 }).eq('id', doc.id);
            if (upErr) { errors.push(`doc ${doc.id}: update — ${upErr.message}`); continue; }
            updated++;
          } catch (e: any) {
            errors.push(`doc ${doc.id}: ${e.message}`);
          }
        }
        if (cutOff) break;
        if (docs.length < CHUNK) break;
      }
      return new Response(JSON.stringify({
        backfill_total_iva: true, checked, updated, foundIva,
        hasMore: cutOff, errors: errors.slice(0, 50),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Recuperación del JSON ORIGINAL para los documentos anteriores a Fase 3.1
    // (2026-07-22), que se guardaron solo normalizados. Los bytes crudos nunca
    // se perdieron: siguen en Gmail, y cada documento conserva su
    // `source_message_id`. Decreto 487 Art. 3 — la conservación del DTE
    // electrónico "garantizando su consulta e integridad" es responsabilidad
    // EXCLUSIVA del contribuyente; sin el original no se puede demostrar
    // integridad byte-a-byte contra la firma del emisor.
    //
    // `p_limit` existe para poder correr una muestra chica y revisarla ANTES
    // de tocar los 1,169 (se usó con 8 la primera vez).
    //
    // Cursor `after_id` obligatorio, no filtro por "sigue en NULL": un
    // documento que llegó por link o dentro de un ZIP no tiene un adjunto
    // JSON suelto que recuperar, así que fallaría para siempre y bloquearía
    // la cola en su cabeza — es exactamente el bug E6/H7 que ya mordió dos
    // veces en este archivo.
    if (backfill_orig_json === true) {
      const CHUNK = 50;
      let checked = 0, recovered = 0, sinAdjunto = 0;
      let lastId: number = after_id;
      const errors: string[] = [];
      const startTime = Date.now();
      let cutOff = false;

      // Un access token por cuenta, reutilizado toda la corrida (refrescarlo
      // por documento sería una llamada a Google por fila).
      const tokenPorCuenta = new Map<number, string>();
      const { data: cuentas, error: cuentasErr } = await admin
        .from('email_sync_accounts').select('*').eq('active', true);
      if (cuentasErr) throw new Error(`email_sync_accounts: ${cuentasErr.message}`);
      for (const acc of (cuentas ?? [])) {
        try {
          tokenPorCuenta.set(acc.id, await refreshAccessToken(
            Deno.env.get(acc.client_id_secret_name ?? '') ?? '',
            Deno.env.get(acc.client_secret_secret_name ?? '') ?? '',
            Deno.env.get(acc.vault_secret_name ?? '') ?? '',
          ));
        } catch (e: any) {
          errors.push(`cuenta ${acc.email}: no se pudo autenticar — ${e.message}`);
        }
      }

      outerOrig:
      for (;;) {
        if (Date.now() - startTime > TIME_BUDGET_MS) { cutOff = true; break; }
        const { data: docs, error: docsErr } = await admin
          .from('purchase_dte_documents')
          .select('id, account_id, source_message_id, codigo_generacion, fecha_emision, created_at')
          .is('orig_json_path', null)
          .not('source_message_id', 'is', null)
          .not('json_path', 'is', null)
          .gt('id', lastId)
          .order('id', { ascending: true })
          .limit(CHUNK);
        if (docsErr) throw new Error(`purchase_dte_documents: ${docsErr.message}`);
        if (!docs || docs.length === 0) break;

        for (const doc of docs) {
          if (Date.now() - startTime > TIME_BUDGET_MS) { cutOff = true; break outerOrig; }
          if (p_limit !== null && checked >= p_limit) { break outerOrig; }
          checked++;
          lastId = doc.id; // avanza SIEMPRE, incluso si esta fila no se puede recuperar
          try {
            const token = tokenPorCuenta.get(doc.account_id);
            if (!token) { errors.push(`doc ${doc.id}: sin token para la cuenta ${doc.account_id}`); continue; }

            const msg = await getMessage(token, doc.source_message_id);
            const parts: AttachmentPart[] = [];
            collectAttachmentParts(msg.payload, parts);
            const jsonParts = parts.filter(p => p.filename.toLowerCase().endsWith('.json'));

            // Se busca el adjunto cuyo codigoGeneracion COINCIDE, no "el
            // primer .json": un mismo correo puede traer varios DTE.
            let bytes: Uint8Array | null = null;
            for (const jp of jsonParts) {
              try {
                const b = await resolveAttachmentBytes(token, doc.source_message_id, jp);
                const parsed = JSON.parse(new TextDecoder().decode(b));
                const cod = parsed?.identificacion?.codigoGeneracion
                  ?? parsed?.dteJson?.identificacion?.codigoGeneracion
                  ?? parsed?.codigoGeneracion;
                if (cod && String(cod) === String(doc.codigo_generacion)) { bytes = b; break; }
              } catch { /* adjunto ilegible: probar el siguiente */ }
            }

            if (!bytes) {
              // Llegó por link o dentro de un ZIP: no hay adjunto JSON suelto
              // que recuperar. No es un error, es un caso que no aplica.
              sinAdjunto++;
              continue;
            }

            const fecEmi: string | null = doc.fecha_emision ?? null;
            const now = new Date(doc.created_at);
            const [yyyy, mm] = fecEmi
              ? String(fecEmi).split('-')
              : [String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0')];
            const origJsonPath = `${yyyy}/${mm}/${doc.codigo_generacion}.orig.json`;

            const { error: upErr } = await admin.storage.from(BUCKET)
              .upload(origJsonPath, bytes, { contentType: 'application/json', upsert: false });
            if (upErr && !String(upErr.message).toLowerCase().includes('already exists')) {
              errors.push(`doc ${doc.id}: upload — ${upErr.message}`); continue;
            }
            const { error: setErr } = await admin.from('purchase_dte_documents')
              .update({ orig_json_path: publicUrl(origJsonPath) }).eq('id', doc.id);
            if (setErr) { errors.push(`doc ${doc.id}: update — ${setErr.message}`); continue; }
            recovered++;
          } catch (e: any) {
            errors.push(`doc ${doc.id}: ${e.message}`);
          }
        }
        if (cutOff) break;
        if (docs.length < CHUNK) break;
      }

      return new Response(JSON.stringify({
        backfill_orig_json: true, checked, recovered, sinAdjunto,
        nextAfterId: lastId, hasMore: cutOff, errors: errors.slice(0, 50),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Fase 3.2 (a pedido del usuario, 2026-07-22): backfill de detección de
    // código para los PDF huérfanos que ya estaban en Revisión ANTES de
    // este cambio (nunca pasaron por detectCodigoGeneracionInPdf). Mismo
    // patrón que repair_stored_json/backfill_items_text — pagina por
    // ai_suggested IS NULL, descarga el PDF de Storage (no necesita Gmail),
    // extrae el código y: si hay match sin PDF propio, empareja directo; si
    // no, guarda el código detectado en ai_suggested (o '{}' si no se
    // detectó nada, para no re-procesar la fila para siempre).
    if (backfill_detect_codes === true) {
      const CHUNK = 200; // más caro que los otros backfills (descarga+parsea PDF completo)
      let checked = 0, autoMatched = 0, codeDetected = 0, noCode = 0, discardedDuplicate = 0, autoInvalidated = 0;
      const errors: string[] = [];
      const startTime = Date.now();
      let cutOff = false;

      for (;;) {
        if (Date.now() - startTime > TIME_BUDGET_MS) { cutOff = true; break; }
        const { data: rows, error: rowsErr } = await admin
          .from('purchase_dte_review_queue')
          .select('id, file_path')
          .eq('kind', 'orphan_pdf')
          .eq('status', 'pendiente')
          .is('ai_suggested', null)
          .order('id', { ascending: true })
          .limit(CHUNK);
        if (rowsErr) throw new Error(`purchase_dte_review_queue: ${rowsErr.message}`);
        if (!rows || rows.length === 0) break;

        for (const rq of rows) {
          if (Date.now() - startTime > TIME_BUDGET_MS) { cutOff = true; break; }
          checked++;
          try {
            const marker = `/storage/v1/object/public/${BUCKET}/`;
            const idx = (rq.file_path as string).indexOf(marker);
            if (idx === -1) { errors.push(`revisión ${rq.id}: file_path con formato inesperado`); continue; }
            const path = (rq.file_path as string).slice(idx + marker.length);

            const { data: fileData, error: dlErr } = await admin.storage.from(BUCKET).download(path);
            if (dlErr) { errors.push(`revisión ${rq.id}: download — ${dlErr.message}`); continue; }
            const pdfBytes = new Uint8Array(await fileData.arrayBuffer());
            const { codigo: detectedCodigo, isNoticeOrRelatedDoc, isAnulado } = await detectCodigoGeneracionInPdf(pdfBytes);

            if (!detectedCodigo) {
              noCode++;
              const { error: upErr } = await admin.from('purchase_dte_review_queue').update({ ai_suggested: {} }).eq('id', rq.id);
              if (upErr) errors.push(`revisión ${rq.id}: update ai_suggested vacío — ${upErr.message}`);
              continue;
            }
            codeDetected++;

            const { data: existing, error: findErr } = await admin
              .from('purchase_dte_documents')
              .select('id, pdf_path, invalidado')
              .eq('codigo_generacion', detectedCodigo)
              .maybeSingle();
            if (findErr) { errors.push(`revisión ${rq.id}: lookup codigo — ${findErr.message}`); continue; }

            if (existing && !existing.pdf_path) {
              const { data: attachData, error: attachErr } = await admin
                .from('purchase_dte_documents')
                .update({ pdf_path: rq.file_path })
                .eq('id', existing.id)
                .is('pdf_path', null)
                .select('id');
              if (attachErr) { errors.push(`revisión ${rq.id}: attach pdf_path — ${attachErr.message}`); continue; }
              if (attachData && attachData.length > 0) {
                const { error: resolveErr } = await admin.from('purchase_dte_review_queue')
                  .update({ status: 'emparejado', matched_document_id: existing.id, resolved_at: new Date().toISOString(), ai_suggested: { detected_codigo_generacion: detectedCodigo } })
                  .eq('id', rq.id);
                if (resolveErr) errors.push(`revisión ${rq.id}: no se pudo cerrar tras emparejar — ${resolveErr.message}`);
                else autoMatched++;
                continue;
              }
            }

            // Bug real 2026-07-22 (doc 1281): ya invalidado por otra vía
            // (flujo JSON oficial) antes de que este PDF llegara — no hace
            // falta que un humano lo confirme en Revisión. Mismo fix que el
            // loop de orphanPdfs, ver ese comentario para el porqué.
            if (existing && existing.pdf_path && existing.invalidado) {
              autoInvalidated++;
              const { error: resolveErr } = await admin.from('purchase_dte_review_queue')
                .update({ status: 'emparejado', matched_document_id: existing.id, resolved_at: new Date().toISOString(), ai_suggested: { detected_codigo_generacion: detectedCodigo } })
                .eq('id', rq.id);
              if (resolveErr) errors.push(`revisión ${rq.id}: no se pudo cerrar (ya invalidado) — ${resolveErr.message}`);
              continue;
            }

            // Marca automática de invalidado (mismo mecanismo que el loop de
            // orphanPdfs) — verificado en vivo contra el caso real de Grupo
            // Jamilu antes de dejarlo sin confirmación manual.
            if (existing && existing.pdf_path && isAnulado) {
              const { data: invData, error: invErr } = await admin
                .from('purchase_dte_documents')
                .update({ invalidado: true, invalidado_motivo: 'Detectado automáticamente: PDF con sello/mención ANULADO', invalidado_at: new Date().toISOString() })
                .eq('id', existing.id)
                .eq('invalidado', false)
                .select('id');
              if (invErr) {
                errors.push(`revisión ${rq.id}: no se pudo marcar invalidado en doc ${existing.id} — ${invErr.message}`);
              } else {
                autoInvalidated++;
                const { error: resolveErr } = await admin.from('purchase_dte_review_queue')
                  .update({ status: 'emparejado', matched_document_id: existing.id, resolved_at: new Date().toISOString(), ai_suggested: { detected_codigo_generacion: detectedCodigo } })
                  .eq('id', rq.id);
                if (resolveErr) errors.push(`revisión ${rq.id}: no se pudo cerrar tras marcar invalidado — ${resolveErr.message}`);
              }
              continue;
            }

            // E8 (endurecido tras falso negativo real, ver comentario en el
            // loop de orphanPdfs): exige código + tamaño casi idéntico al
            // PDF ya guardado, no solo la ausencia de palabras clave.
            if (existing && existing.pdf_path && !isNoticeOrRelatedDoc) {
              const existingRel = relativeStoragePath(existing.pdf_path);
              if (existingRel) {
                const { data: existingBlob } = await admin.storage.from(BUCKET).download(existingRel);
                const existingSize = existingBlob?.size ?? 0;
                const sizesMatch = existingSize > 0 && Math.abs(pdfBytes.byteLength - existingSize) / existingSize <= 0.02;
                if (sizesMatch) {
                  discardedDuplicate++;
                  const { error: discErr } = await admin.from('purchase_dte_review_queue')
                    .update({ status: 'descartado', resolved_at: new Date().toISOString(), ai_suggested: { detected_codigo_generacion: detectedCodigo } })
                    .eq('id', rq.id);
                  if (discErr) errors.push(`revisión ${rq.id}: no se pudo descartar como duplicado — ${discErr.message}`);
                  continue;
                }
              }
            }

            // Sin match automático (no existe aún, o el doc ya tiene su
            // propio PDF pero ESTE PDF sí suena a un aviso/nota distinta,
            // ej. invalidación) — se guarda el código para que Revisión
            // pueda emparejar a mano o para que la reconciliación del
            // próximo sync lo encuentre solo.
            const { error: upErr } = await admin.from('purchase_dte_review_queue')
              .update({ ai_suggested: { detected_codigo_generacion: detectedCodigo } })
              .eq('id', rq.id);
            if (upErr) errors.push(`revisión ${rq.id}: update ai_suggested — ${upErr.message}`);
          } catch (e: any) {
            errors.push(`revisión ${rq.id}: ${e.message}`);
          }
        }
        if (cutOff) break;
        if (rows.length < CHUNK) break;
      }
      return new Response(JSON.stringify({
        backfill_detect_codes: true, checked, codeDetected, autoMatched, autoInvalidated, discardedDuplicate, noCode,
        hasMore: cutOff, errors: errors.slice(0, 50),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let accountsQuery = admin.from('email_sync_accounts').select('*').eq('active', true);
    if (account_id) accountsQuery = accountsQuery.eq('id', account_id);
    const { data: accounts, error: accErr } = await accountsQuery;
    if (accErr) throw new Error(`email_sync_accounts: ${accErr.message}`);

    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ success: true, accounts: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // H10: un solo deadline para toda la invocación. Las cuentas se recorren
    // en serie, así que con un presupuesto por cuenta el wall-clock real era
    // N × TIME_BUDGET_MS. La cuenta que llega sin tiempo devuelve hasMore y
    // el caller vuelve a llamar; las cuentas que ya corrieron dejaron sus
    // mensajes marcados, así que la próxima tanda arranca donde quedó.
    const deadline = Date.now() + TIME_BUDGET_MS;

    const results: any[] = [];
    for (const account of accounts) {
      try {
        const r = await processAccount(admin, account, dry_run, debug_query, deadline);
        results.push({ account: account.email, ...r });
        if (!dry_run) {
          await admin.from('email_sync_log').insert({
            account_id:          account.id,
            source:              account.email,
            success:             true,
            error_msg:           r.warnings.length ? r.warnings.slice(0, 20).join(' | ').slice(0, 2000) : null,
            messages_scanned:    r.messagesScanned,
            documents_inserted:  r.documentsInserted,
            documents_skipped:   r.documentsSkipped,
            pdfs_unmatched:      r.pdfsUnmatched,
          });
        }
      } catch (e: any) {
        results.push({ account: account.email, error: e.message });
        if (!dry_run) {
          await admin.from('email_sync_log').insert({
            account_id: account.id,
            source:     account.email,
            success:    false,
            error_msg:  (e.message ?? 'error desconocido').slice(0, 2000),
          });
        }
      }
    }

    const hasMore = results.some((r: any) => r.hasMore === true);
    return new Response(JSON.stringify({ success: true, dry_run, hasMore, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
