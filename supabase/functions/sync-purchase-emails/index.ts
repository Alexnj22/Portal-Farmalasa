import { createClient } from "npm:@supabase/supabase-js@2";
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
const TIME_BUDGET_MS  = 100_000; // presupuesto por cuenta/corrida — deja margen bajo el límite de la plataforma (backfills grandes requieren varias llamadas sucesivas, ver hasMore en la respuesta)

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

// ── Procesar una cuenta ────────────────────────────────────────────────────────

interface AccountResult {
  messagesScanned: number;
  documentsInserted: number;
  documentsSkipped: number;
  pdfsUnmatched: number;
  warnings: string[];
  hasMore: boolean;
  remaining: number;
}

// Paginado explícito — PostgREST trunca a 1000 filas por respuesta.
// Fuente única de "ya procesado": purchase_dte_processed_messages, marcado al
// final de CADA mensaje sin importar el resultado (insertado, duplicado vía
// ON CONFLICT, o ignorado por adjunto no soportado como .zip) — antes se
// inferían los "hechos" solo por presencia en purchase_dte_documents/
// purchase_dte_review_queue, lo que dejaba mensajes con DTE duplicado o solo
// adjuntos .zip re-escaneándose desde Gmail en cada corrida, para siempre.
async function selectAllMessageIds(supabase: any, accountId: number): Promise<string[]> {
  const CHUNK = 1000;
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('purchase_dte_processed_messages')
      .select('source_message_id')
      .eq('account_id', accountId)
      .range(from, from + CHUNK - 1);
    if (error) throw new Error(`selectAllMessageIds: ${error.message}`);
    for (const r of (data ?? [])) if (r.source_message_id) out.push(r.source_message_id);
    if (!data || data.length < CHUNK) break;
    from += CHUNK;
  }
  return out;
}

// Si falla, propaga el error en vez de devolver un set vacío en silencio —
// un doneIds vacío hace que TODO el historial se re-escanee desde Gmail como
// si nada estuviera procesado (costoso pero no pierde datos, así que el
// caller decide si reintentar o abortar la corrida de esa cuenta).
async function getDoneMessageIds(supabase: any, accountId: number): Promise<Set<string>> {
  return new Set(await selectAllMessageIds(supabase, accountId));
}

async function markMessageProcessed(supabase: any, accountId: number, messageId: string) {
  const { error } = await supabase.from('purchase_dte_processed_messages')
    .upsert({ account_id: accountId, source_message_id: messageId }, { onConflict: 'account_id,source_message_id', ignoreDuplicates: true });
  if (error) throw new Error(`markMessageProcessed: ${error.message}`);
}

async function processAccount(supabase: any, account: any, dryRun: boolean, debugQuery?: string | null): Promise<AccountResult> {
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
  // has:attachment YA NO es el único criterio (caso real: Movistar manda
  // "Factura Electrónica Movistar" con el PDF Y el JSON como links en el
  // cuerpo, cero adjuntos reales — Gmail nunca la devolvía con has:attachment
  // a secas, así que el mensaje era invisible desde el paso 1, sin dejar
  // ningún rastro en documents/review_queue/warnings). Se amplía a
  // has:attachment OR una señal de asunto/cuerpo de que es factura/DTE, para
  // no perder proveedores que solo mandan enlaces.
  const query = debugQuery || (`after:${sinceDate ? gmailDateFormat(sinceDate) : BACKFILL_FROM} -in:sent -in:drafts -in:chats `
    + `(has:attachment OR subject:(factura OR facturas OR comprobante OR CCF OR DTE) OR "factura electronica" OR "documento tributario")`);

  const allMessageIds = await listMessageIds(accessToken, query);
  // debugQuery: diagnóstico puntual (ej. una franja de fechas específica) —
  // ignora processed_messages para poder re-inspeccionar mensajes ya
  // marcados como procesados sin necesidad de borrar esa tabla.
  const doneIds = debugQuery ? new Set<string>() : await getDoneMessageIds(supabase, account.id);
  const pendingIds = allMessageIds.filter(id => !doneIds.has(id));

  let messagesScanned    = 0;
  let documentsInserted  = 0;
  let documentsSkipped   = 0;
  let pdfsUnmatched       = 0;
  const warnings: string[] = [];
  const startTime = Date.now();
  let cutOff = false;

  for (const id of pendingIds) {
    if (Date.now() - startTime > TIME_BUDGET_MS) { cutOff = true; break; }
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

    const jsonParts = attachmentParts.filter(p => p.filename.toLowerCase().endsWith('.json'));
    const pdfParts  = attachmentParts.filter(p => p.filename.toLowerCase().endsWith('.pdf'));
    const zipParts  = attachmentParts.filter(p => p.filename.toLowerCase().endsWith('.zip'));

    if (zipParts.length > 0) {
      warnings.push(`mensaje ${id} (${fromEmail}): adjunto ZIP no soportado v1 (${zipParts.map(z => z.filename).join(', ')})`);
    }

    const usedPdfFilenames = new Set<string>();
    const validDtes: { json: any; jsonPart: AttachmentPart; pdfPart: AttachmentPart | null }[] = [];
    const invalidJsons: { part: AttachmentPart; reason: string; kind?: string }[] = [];

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
        const originalCodigo = parsed.documento.codigoGeneracion;
        const motivo = parsed.motivo.motivoAnulacion ?? null;
        const { data: updated, error: invalidadoErr } = await supabase
          .from('purchase_dte_documents')
          .update({ invalidado: true, invalidado_motivo: motivo, invalidado_at: new Date().toISOString() })
          .eq('codigo_generacion', originalCodigo)
          .select('id');
        if (invalidadoErr) {
          warnings.push(`DTE ${originalCodigo}: no se pudo marcar invalidado — ${invalidadoErr.message}`);
          messageHadFailedReviewOp = true;
        } else if (updated && updated.length > 0) {
          warnings.push(`DTE ${originalCodigo}: marcado invalidado (${motivo ?? 'sin motivo'})`);
        } else if (looksFacturaRelated) {
          invalidJsons.push({ part: jp, reason: `invalidación de ${originalCodigo} — DTE original aún no capturado`, kind: 'invalidacion_pendiente' });
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
      validDtes.push({ json: parsed, jsonPart: jp, pdfPart: null });
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

    for (const { json, jsonPart, pdfPart } of validDtes) {
      const codigoGeneracion = json.identificacion.codigoGeneracion;
      const tipoDte = String(json.identificacion.tipoDte);
      const fecEmi: string | null = json.identificacion?.fecEmi ?? null;
      const now = new Date();
      const [yyyy, mm] = fecEmi
        ? fecEmi.split('-')
        : [String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0')];
      const basePath = `${yyyy}/${mm}/${codigoGeneracion}`;
      const jsonPath = `${basePath}.json`;
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
          total_iva:            json.resumen?.totalIva ?? null,
          json_path:           publicUrl(jsonPath),
          pdf_path:             pdfPath ? publicUrl(pdfPath) : null,
          account_id:          account.id,
          from_email:          fromEmail,
          source_message_id:   id,
          received_at:         receivedAt,
          items_text:          extractItemsText(json),
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
          // del RPC (nrc con/sin guión).
          const dte = extractProveedorFromDte(json);
          if (dte) {
            const { data: proveedorId, error: provErr } = await supabase.rpc('upsert_proveedor_from_dte', { p_data: dte });
            if (provErr) {
              warnings.push(`DTE ${codigoGeneracion}: upsert_proveedor_from_dte — ${provErr.message}`);
            } else {
              const { data: proveedor, error: provSelErr } = await supabase.from('proveedores_maestro').select('supplier_id').eq('id', proveedorId).maybeSingle();
              if (provSelErr) warnings.push(`DTE ${codigoGeneracion}: lookup supplier_id del maestro — ${provSelErr.message}`);
              const { error: setErr } = await supabase.from('purchase_dte_documents')
                .update({ proveedor_id: proveedorId, supplier_id: proveedor?.supplier_id ?? null })
                .eq('id', insData[0].id);
              if (setErr) warnings.push(`DTE ${codigoGeneracion}: set proveedor_id/supplier_id — ${setErr.message}`);
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

    for (const op of orphanPdfs) {
      try {
        const pdfBytes = await resolveAttachmentBytes(accessToken, id, op);
        const path = `review/${id}-${sanitizeStorageKey(op.filename)}`;
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: false });
        if (upErr && !String(upErr.message).toLowerCase().includes('already exists')) throw new Error(upErr.message);
        const { error: rqErr } = await supabase.from('purchase_dte_review_queue').upsert({
          kind:        'orphan_pdf',
          file_path:    publicUrl(path),
          filename:    op.filename,
          account_id:  account.id,
          source_message_id: id,
          from_email:  fromEmail,
          subject,
          received_at: receivedAt,
        }, { onConflict: 'account_id,source_message_id,filename', ignoreDuplicates: true });
        if (rqErr) throw new Error(rqErr.message);
        pdfsUnmatched++;
      } catch (e: any) {
        warnings.push(`PDF huérfano ${op.filename} (msg ${id}): ${e.message}`);
        messageHadFailedReviewOp = true;
      }
    }

    for (const { part, reason, kind } of invalidJsons) {
      try {
        const jsonBytes = await resolveAttachmentBytes(accessToken, id, part);
        const path = `review/${id}-${sanitizeStorageKey(part.filename)}`;
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(path, jsonBytes, { contentType: 'application/json', upsert: false });
        if (upErr && !String(upErr.message).toLowerCase().includes('already exists')) throw new Error(upErr.message);
        const { error: rqErr } = await supabase.from('purchase_dte_review_queue').upsert({
          kind:        kind ?? 'invalid_json',
          file_path:    publicUrl(path),
          filename:    part.filename,
          reason,
          account_id:  account.id,
          source_message_id: id,
          from_email:  fromEmail,
          subject,
          received_at: receivedAt,
        }, { onConflict: 'account_id,source_message_id,filename', ignoreDuplicates: true });
        if (rqErr) throw new Error(rqErr.message);
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
      try {
        await markMessageProcessed(supabase, account.id, id);
      } catch (e: any) {
        warnings.push(`mensaje ${id}: no se pudo marcar como procesado — ${e.message}`);
      }
    } else {
      warnings.push(`mensaje ${id}: no se marca como procesado (falló una operación de revisión/invalidado) — se reintentará`);
    }
  }

  const hasMore = cutOff && messagesScanned < pendingIds.length;
  if (!dryRun && !hasMore) {
    await supabase.from('email_sync_accounts').update({ last_synced_date: new Date().toISOString() }).eq('id', account.id);
  }

  return {
    messagesScanned, documentsInserted, documentsSkipped, pdfsUnmatched, warnings,
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
    const { dry_run = false, account_id = null, repair_stored_json = false, debug_query = null, backfill_items_text = false } = body;

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

    let accountsQuery = admin.from('email_sync_accounts').select('*').eq('active', true);
    if (account_id) accountsQuery = accountsQuery.eq('id', account_id);
    const { data: accounts, error: accErr } = await accountsQuery;
    if (accErr) throw new Error(`email_sync_accounts: ${accErr.message}`);

    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ success: true, accounts: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: any[] = [];
    for (const account of accounts) {
      try {
        const r = await processAccount(admin, account, dry_run, debug_query);
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
