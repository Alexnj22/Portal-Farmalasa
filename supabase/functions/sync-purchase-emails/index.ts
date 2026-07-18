import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, checkCronSecret, requireActiveEmployeeUser } from "../_shared/security.ts";

// Sincroniza facturas de compra (DTE JSON + PDF) desde las bandejas Gmail
// conectadas → Storage privado (purchase-dte) + purchase_dte_documents.
// Ver PLAN-FACTURAS-COMPRA-2026-07.md para el diseño completo.

const GMAIL_API      = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL       = "https://oauth2.googleapis.com/token";
const BACKFILL_FROM   = "2026/06/01";
const OVERLAP_DAYS    = 3;
const BUCKET          = "purchase-dte";
const TIME_BUDGET_MS  = 100_000; // presupuesto por cuenta/corrida — deja margen bajo el límite de la plataforma (backfills grandes requieren varias llamadas sucesivas, ver hasMore en la respuesta)

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
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
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
}

function collectAttachmentParts(part: any, out: AttachmentPart[]) {
  if (!part) return;
  if (part.filename && (part.body?.attachmentId || part.body?.data)) {
    out.push({
      filename: part.filename,
      mimeType: part.mimeType,
      attachmentId: part.body?.attachmentId ?? null,
      inlineData: part.body?.data ?? null,
    });
  }
  for (const child of (part.parts ?? [])) collectAttachmentParts(child, out);
}

async function resolveAttachmentBytes(accessToken: string, messageId: string, part: AttachmentPart): Promise<Uint8Array> {
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
    const { data } = await supabase
      .from('purchase_dte_processed_messages')
      .select('source_message_id')
      .eq('account_id', accountId)
      .range(from, from + CHUNK - 1);
    for (const r of (data ?? [])) if (r.source_message_id) out.push(r.source_message_id);
    if (!data || data.length < CHUNK) break;
    from += CHUNK;
  }
  return out;
}

async function getDoneMessageIds(supabase: any, accountId: number): Promise<Set<string>> {
  return new Set(await selectAllMessageIds(supabase, accountId));
}

async function markMessageProcessed(supabase: any, accountId: number, messageId: string) {
  await supabase.from('purchase_dte_processed_messages')
    .upsert({ account_id: accountId, source_message_id: messageId }, { onConflict: 'account_id,source_message_id', ignoreDuplicates: true });
}

async function processAccount(supabase: any, account: any, dryRun: boolean): Promise<AccountResult> {
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
  const query = `has:attachment after:${sinceDate ? gmailDateFormat(sinceDate) : BACKFILL_FROM}`;

  const allMessageIds = await listMessageIds(accessToken, query);
  const doneIds = await getDoneMessageIds(supabase, account.id);
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

    const jsonParts = attachmentParts.filter(p => p.filename.toLowerCase().endsWith('.json'));
    const pdfParts  = attachmentParts.filter(p => p.filename.toLowerCase().endsWith('.pdf'));
    const zipParts  = attachmentParts.filter(p => p.filename.toLowerCase().endsWith('.zip'));

    if (zipParts.length > 0) {
      warnings.push(`mensaje ${id} (${fromEmail}): adjunto ZIP no soportado v1 (${zipParts.map(z => z.filename).join(', ')})`);
    }

    const usedPdfFilenames = new Set<string>();
    const validDtes: { json: any; jsonPart: AttachmentPart; pdfPart: AttachmentPart | null }[] = [];
    const invalidJsons: { part: AttachmentPart; reason: string }[] = [];

    for (const jp of jsonParts) {
      let bytes: Uint8Array;
      try {
        bytes = await resolveAttachmentBytes(accessToken, id, jp);
      } catch (e: any) {
        warnings.push(`adjunto ${jp.filename} (msg ${id}): ${e.message}`);
        documentsSkipped++;
        continue;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        warnings.push(`adjunto ${jp.filename} (msg ${id}): JSON inválido`);
        documentsSkipped++;
        invalidJsons.push({ part: jp, reason: 'JSON inválido (no parsea)' });
        continue;
      }
      const check = validateDte(parsed);
      if (!check.valid) {
        warnings.push(`adjunto ${jp.filename} (msg ${id}): ${check.reason}`);
        documentsSkipped++;
        invalidJsons.push({ part: jp, reason: check.reason ?? 'inválido' });
        continue;
      }
      const matchedPdf = pdfParts.find(pp => baseName(pp.filename) === baseName(jp.filename) && !usedPdfFilenames.has(pp.filename)) ?? null;
      if (matchedPdf) usedPdfFilenames.add(matchedPdf.filename);
      validDtes.push({ json: parsed, jsonPart: jp, pdfPart: matchedPdf });
    }

    // PDFs del mensaje que no se pudieron asociar a ningún JSON válido (huérfanos)
    const orphanPdfs = pdfParts.filter(pp => !usedPdfFilenames.has(pp.filename));

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
        const jsonBytes = await resolveAttachmentBytes(accessToken, id, jsonPart);
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

        let supplierId: number | null = null;
        if (emisorNrc) {
          const { data: sup } = await supabase.from('suppliers').select('id').eq('nrc', emisorNrc).limit(1).maybeSingle();
          supplierId = sup?.id ?? null;
        }

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
          supplier_id:         supplierId,
        };

        // ON CONFLICT (codigo_generacion) DO NOTHING — un DTE emitido nunca cambia.
        const { error: insErr, data: insData } = await supabase
          .from('purchase_dte_documents')
          .upsert(row, { onConflict: 'codigo_generacion', ignoreDuplicates: true })
          .select('id');
        if (insErr) throw new Error(`insert ${codigoGeneracion}: ${insErr.message}`);
        if (insData && insData.length > 0) documentsInserted++;
        else documentsSkipped++; // ya existía (duplicado entre correos/reenvíos)
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
        await supabase.from('purchase_dte_review_queue').upsert({
          kind:        'orphan_pdf',
          file_path:    publicUrl(path),
          filename:    op.filename,
          account_id:  account.id,
          source_message_id: id,
          from_email:  fromEmail,
          subject,
          received_at: receivedAt,
        }, { onConflict: 'account_id,source_message_id,filename', ignoreDuplicates: true });
        pdfsUnmatched++;
      } catch (e: any) {
        warnings.push(`PDF huérfano ${op.filename} (msg ${id}): ${e.message}`);
      }
    }

    for (const { part, reason } of invalidJsons) {
      try {
        const jsonBytes = await resolveAttachmentBytes(accessToken, id, part);
        const path = `review/${id}-${sanitizeStorageKey(part.filename)}`;
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(path, jsonBytes, { contentType: 'application/json', upsert: false });
        if (upErr && !String(upErr.message).toLowerCase().includes('already exists')) throw new Error(upErr.message);
        await supabase.from('purchase_dte_review_queue').upsert({
          kind:        'invalid_json',
          file_path:    publicUrl(path),
          filename:    part.filename,
          reason,
          account_id:  account.id,
          source_message_id: id,
          from_email:  fromEmail,
          subject,
          received_at: receivedAt,
        }, { onConflict: 'account_id,source_message_id,filename', ignoreDuplicates: true });
      } catch (e: any) {
        warnings.push(`JSON inválido ${part.filename} (msg ${id}): no se pudo encolar para revisión — ${e.message}`);
      }
    }

    // Marca el mensaje como procesado SIEMPRE, sin importar el resultado —
    // incluye DTE duplicado (ON CONFLICT DO NOTHING, sin fila propia) y
    // mensajes con solo adjuntos no soportados (.zip): antes ninguno de esos
    // casos dejaba rastro y se re-escaneaban desde Gmail en cada corrida.
    try {
      await markMessageProcessed(supabase, account.id, id);
    } catch (e: any) {
      warnings.push(`mensaje ${id}: no se pudo marcar como procesado — ${e.message}`);
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
    const { dry_run = false, account_id = null } = body;

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
        const r = await processAccount(admin, account, dry_run);
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
