import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, getErpBranchMap, requireInvokeSecret } from "../_shared/security.ts";
import { selectAllByIn } from "../_shared/db.ts";

function getPurchaseCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_PURCHASES_CREDS");
  if (!raw) throw new Error("ERP_PURCHASES_CREDS secret not configured.");
  return JSON.parse(raw);
}

// Sincroniza compras/recepciones del ERP → purchase_receipts + purchase_receipt_items.
// URL: descargar_compras_json.php?fini=YYYY-MM-DD&ffin=YYYY-MM-DD&id_sucursal=N

const LOGIN_URL    = "https://clientesdte3.oss.com.sv/farma_salud/login.php";
const COMPRAS_BASE = "https://clientesdte3.oss.com.sv/farma_salud/descargar_compras_json.php";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function getSessionCookie(username: string, password: string): Promise<string> {
  const form = new URLSearchParams();
  form.append('username', username);
  form.append('password', password);
  form.append('m', '1');

  const res = await fetch(LOGIN_URL, {
    method:   'POST',
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:     form.toString(),
    redirect: 'manual',
    signal:   AbortSignal.timeout(15_000),
  });

  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Login failed: no session cookie');
  return cookie;
}

// Itera días entre start y end inclusive
function* dayRange(start: string, end: string): Generator<string> {
  const cur  = new Date(start + 'T12:00:00Z');
  const last = new Date(end   + 'T12:00:00Z');
  while (cur <= last) {
    yield cur.toISOString().split('T')[0];
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

// ── Discover — devuelve el JSON crudo para mapear campos ─────────────────────

async function discoverBranch(
  erpId: number,
  username: string,
  password: string,
  startDate: string,
  endDate: string,
): Promise<any> {
  const cookie = await withRetry(() => getSessionCookie(username, password));
  const url    = `${COMPRAS_BASE}?fini=${startDate}&ffin=${endDate}&id_sucursal=${erpId}`;
  const res    = await withRetry(() => fetch(url, {
    headers: { Cookie: cookie },
    signal:  AbortSignal.timeout(30_000),
  }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }));

  const payload = await res.json();

  const rootKeys    = Object.keys(payload);
  const rootKey     = rootKeys.find(k => Array.isArray(payload[k])) ?? null;
  const records: any[] = rootKey ? (payload[rootKey] ?? []) : [];
  const firstRecord = records[0] ?? null;
  const firstItem   = firstRecord ? Object.values(firstRecord).find(Array.isArray)?.[0] ?? null : null;

  return {
    root_keys:         rootKeys,
    total_records:     records.length,
    first_record_keys: firstRecord ? Object.keys(firstRecord) : [],
    first_record:      firstRecord,
    first_item_keys:   firstItem ? Object.keys(firstItem) : [],
    first_item:        firstItem,
  };
}

// ── Sync principal ────────────────────────────────────────────────────────────

async function syncBranch(
  supabase: any,
  branchId: number,
  erpId: number,
  username: string,
  password: string,
  startDate: string,
  endDate: string,
): Promise<{ total: number; new: number; items: number }> {

  // 1. Login + fetch — timeout aumentado a 100s para días con muchas compras
  const cookie = await withRetry(() => getSessionCookie(username, password));
  const url    = `${COMPRAS_BASE}?fini=${startDate}&ffin=${endDate}&id_sucursal=${erpId}`;
  const res    = await withRetry(() => fetch(url, {
    headers: { Cookie: cookie },
    signal:  AbortSignal.timeout(100_000),
  }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }));

  const payload = await res.json();

  const compras: any[] = (
    payload?.compras ??
    payload?.recepciones ??
    payload?.data ??
    Object.values(payload).find(Array.isArray) ??
    []
  );

  if (compras.length === 0) return { total: 0, new: 0, items: 0 };

  // 2. IDs existentes
  const erpPurchaseIds = compras
    .map(c => c.compra_id ?? c.id_compra ?? c.id_factura ?? c.id_orden ?? c.id)
    .filter(Boolean)
    .map(Number);

  // Paginado para superar el cap de 1000 filas de PostgREST en rangos amplios.
  const existingRaw = await selectAllByIn<any>(
    supabase, 'purchase_receipts', 'id, erp_purchase_id',
    'erp_purchase_id', erpPurchaseIds,
    (q) => q.eq('erp_sucursal_id', erpId),
  );

  const existingMap = new Map<number, number>(
    (existingRaw ?? []).map((r: any) => [r.erp_purchase_id, r.id])
  );

  const receiptsToUpsert: any[] = [];
  const newErpIds   = new Set<number>();
  const productMap  = new Map<number, any>();
  const supplierMap = new Map<number, any>();

  for (const c of compras) {
    const erpPurchaseId = Number(c.compra_id ?? c.id_compra ?? c.id_factura ?? c.id_orden ?? c.id);
    if (!erpPurchaseId) continue;

    const fecha   = c.documento?.fecha_emision ?? c.fecha ?? c.fecha_emision ?? c.fecha_recepcion ?? null;
    const provObj = c.proveedor;
    let provNombre: string | null = null;
    let erpSupplierId: number | null = null;
    let provNrc: string | null = null;

    if (typeof provObj === 'object' && provObj !== null) {
      provNombre    = provObj.nombre ?? null;
      erpSupplierId = provObj.id ? Number(provObj.id) : null;
      provNrc       = provObj.nrc ?? null;
    } else {
      provNombre = provObj ?? c.supplier ?? c.nombre_proveedor ?? null;
    }

    if (erpSupplierId && !supplierMap.has(erpSupplierId))
      supplierMap.set(erpSupplierId, { erp_supplier_id: erpSupplierId, nombre: provNombre, nrc: provNrc, updated_at: new Date().toISOString() });

    const row = {
      erp_purchase_id: erpPurchaseId,
      branch_id:       branchId,
      erp_sucursal_id: erpId,
      erp_supplier_id: erpSupplierId,
      fecha,
      proveedor:       provNombre,
      estado:          c.anulada === true ? 'anulada' : (c.estado ?? null),
      subtotal:        c.totales?.sumas_gravadas  ?? c.totales?.subtotal ?? c.subtotal ?? 0,
      iva:             c.totales?.iva             ?? c.iva                              ?? 0,
      total:           c.totales?.total_operacion ?? c.totales?.total    ?? c.total     ?? 0,
      updated_at:      new Date().toISOString(),
    };

    receiptsToUpsert.push(row);
    if (!existingMap.has(erpPurchaseId)) newErpIds.add(erpPurchaseId);

    for (const p of (c.items ?? c.productos ?? c.detalle ?? [])) {
      const pid = p.producto_id ?? p.id ?? p.id_producto;
      if (pid && !productMap.has(Number(pid)))
        productMap.set(Number(pid), { id: Number(pid), nombre: p.nombre ?? p.descripcion, updated_at: new Date().toISOString() });
    }
  }

  // 3a. Upsert proveedores
  const erpSupplierToId = new Map<number, number>();
  if (supplierMap.size > 0) {
    await supabase.from('suppliers').upsert([...supplierMap.values()], { onConflict: 'erp_supplier_id', ignoreDuplicates: false });
    const { data: suppRows } = await supabase
      .from('suppliers').select('id, erp_supplier_id').in('erp_supplier_id', [...supplierMap.keys()]);
    for (const s of (suppRows ?? [])) erpSupplierToId.set(s.erp_supplier_id, s.id);
    for (const row of receiptsToUpsert) {
      if (row.erp_supplier_id) row.supplier_id = erpSupplierToId.get(row.erp_supplier_id) ?? null;
    }
  }

  // 3b. Upsert productos — ignoreDuplicates:false para que nombre se actualice si cambia en el ERP
  if (productMap.size > 0)
    await supabase.from('products').upsert([...productMap.values()], { onConflict: 'id', ignoreDuplicates: false });

  // 4. Upsert cabeceras
  let totalItems = 0;
  if (receiptsToUpsert.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < receiptsToUpsert.length; i += CHUNK) {
      const { data: upserted, error } = await supabase
        .from('purchase_receipts')
        .upsert(receiptsToUpsert.slice(i, i + CHUNK), { onConflict: 'erp_purchase_id,erp_sucursal_id' })
        .select('id, erp_purchase_id');
      if (error) throw new Error(`receipts upsert chunk ${i}: ${error.message}`);
      for (const r of (upserted ?? [])) existingMap.set(r.erp_purchase_id, r.id);
    }
  }

  // 5. Items — upsert para todas las recepciones (nuevas y modificadas)
  const itemsToUpsert: any[] = [];
  for (const c of compras) {
    const erpPurchaseId = Number(c.compra_id ?? c.id_compra ?? c.id_factura ?? c.id_orden ?? c.id);
    const receiptId = existingMap.get(erpPurchaseId);
    if (!receiptId) continue;

    const lines = c.items ?? c.productos ?? c.detalle ?? [];
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const p = lines[lineIdx];
      const rawFecha = p.trazabilidad?.fecha_vencimiento ?? p.fecha_vencimiento ?? p.vencimiento ?? null;

      const cantidad    = parseFloat(p.cantidad) || 0;
      const totalLinea  = parseFloat(p.precios?.subtotal_linea ?? p.total_linea ?? p.total ?? 0) || 0;
      // Derive unit price from total_linea/cantidad — more reliable than costo_unitario
      // which the ERP always returns as the current catalog price, overwriting historical prices.
      const precioUnit  = (cantidad > 0 && totalLinea > 0)
        ? totalLinea / cantidad
        : parseFloat(p.precios?.costo_unitario ?? p.precio_unitario ?? p.precio ?? 0) || 0;

      itemsToUpsert.push({
        receipt_id:        receiptId,
        linea_num:         lineIdx,
        erp_product_id:    p.producto_id ?? p.id ?? p.id_producto ?? null,
        descripcion:       p.nombre ?? p.descripcion ?? null,
        cantidad,
        precio_unitario:   precioUnit,
        total_linea:       totalLinea,
        lote:              (p.trazabilidad?.lote ?? p.lote) || null,
        fecha_vencimiento: (rawFecha && rawFecha !== '0000-00-00') ? rawFecha : null,
      });
    }
  }

  if (itemsToUpsert.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < itemsToUpsert.length; i += CHUNK) {
      const { error } = await supabase
        .from('purchase_receipt_items')
        .upsert(itemsToUpsert.slice(i, i + CHUNK), { onConflict: 'receipt_id,linea_num', ignoreDuplicates: false });
      if (error) throw new Error(`items upsert chunk ${i}: ${error.message}`);
    }
    totalItems = itemsToUpsert.length;
  }

  return { total: compras.length, new: newErpIds.size, items: totalItems };
}

// ── retryFailed: detecta brechas y reintenta día a día ───────────────────────
// Detecta brechas de dos formas:
//   A) días en purchase_sync_log WHERE success=false
//   B) días entre `since` y ayer que NO aparecen cubiertos en el log (timeout sin registro)
// Ambos casos se reintentan uno a uno con el timeout extendido.

async function retryFailed(
  supabase: any,
  username: string,
  password: string,
  since: string,
): Promise<{ retried: number; ok: number; failed: number; details: any[] }> {
  const BODEGA_ERP_ID    = 6;
  const BODEGA_BRANCH_ID = 30;

  const yesterday = new Date(Date.now() - 6 * 3600_000);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const untilDay = yesterday.toISOString().split('T')[0];

  // 1. Leer todo el log exitoso para saber qué días ya están cubiertos
  const { data: successLogs } = await supabase
    .from('purchase_sync_log')
    .select('fini, ffin')
    .eq('success', true)
    .gte('fini', since)
    .order('fini');

  const doneDays = new Set<string>();
  for (const log of (successLogs ?? [])) {
    for (const day of dayRange(log.fini, log.ffin)) doneDays.add(day);
  }

  // 2. Todos los días del rango que NO están cubiertos por un sync exitoso
  const missingDays = new Set<string>();
  for (const day of dayRange(since, untilDay)) {
    if (!doneDays.has(day)) missingDays.add(day);
  }

  // 3. Agregar días explícitamente marcados como fallidos (aunque estén en doneDays,
  //    un registro success=false posterior podría requerir revisión)
  const { data: failedLogs } = await supabase
    .from('purchase_sync_log')
    .select('fini, ffin, synced_at')
    .eq('success', false)
    .gte('fini', since)
    .order('fini');

  for (const log of (failedLogs ?? [])) {
    for (const day of dayRange(log.fini, log.ffin)) {
      if (!doneDays.has(day)) missingDays.add(day);
    }
  }

  const daysToRetry = [...missingDays].sort();

  if (daysToRetry.length === 0)
    return { retried: 0, ok: 0, failed: 0, details: [{ note: 'No hay brechas pendientes.' }] };

  // 4. Reintentar cada día individualmente
  const details: any[] = [];
  let ok = 0, failed = 0;

  for (const day of daysToRetry) {
    try {
      const result = await syncBranch(supabase, BODEGA_BRANCH_ID, BODEGA_ERP_ID, username, password, day, day);
      await supabase.from('purchase_sync_log').insert({
        branch_id: BODEGA_BRANCH_ID, erp_sucursal_id: BODEGA_ERP_ID,
        fini: day, ffin: day,
        receipts_total: result.total, receipts_new: result.new,
        items_inserted: result.items, success: true,
      });
      details.push({ day, ok: true, ...result });
      ok++;
    } catch (e: any) {
      await supabase.from('purchase_sync_log').insert({
        branch_id: BODEGA_BRANCH_ID, erp_sucursal_id: BODEGA_ERP_ID,
        fini: day, ffin: day,
        receipts_total: 0, receipts_new: 0, items_inserted: 0,
        success: false, error_msg: e.message,
      });
      details.push({ day, ok: false, error: e.message });
      failed++;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  return { retried: daysToRetry.length, ok, failed, details };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      fini,
      ffin,
      branchId: onlyBranch,
      discover     = false,
      retryFailed: doRetry = false,
      since        = '2025-05-01',  // fecha mínima para retry
    } = body;

    const hoy       = new Date(Date.now() - 6 * 3600_000).toISOString().split('T')[0];
    const startDate = fini || hoy;
    const endDate   = ffin || hoy;

    const { username, password } = getPurchaseCreds();

    // ── Modo discover ─────────────────────────────────────────────────────────
    if (discover) {
      const erpIdToUse: number = body.erpId ?? 6;
      const info = await discoverBranch(erpIdToUse, username, password, startDate, endDate);
      return new Response(JSON.stringify({ discover: true, erpId: erpIdToUse, ...info }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── Modo retryFailed: reintenta días con error del log ────────────────────
    if (doRetry) {
      const result = await retryFailed(supabase, username, password, since);
      return new Response(JSON.stringify({ retryFailed: true, since, ...result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Sync normal ───────────────────────────────────────────────────────────
    const BODEGA_ERP_ID    = 6;
    const BODEGA_BRANCH_ID = 30;

    const purchaseBranches = onlyBranch
      ? [{ branchId: onlyBranch, erpId: BODEGA_ERP_ID, username, password }]
      : [{ branchId: BODEGA_BRANCH_ID, erpId: BODEGA_ERP_ID, username, password }];

    const results: any[] = [];
    const logRows: any[] = [];

    for (const { branchId, erpId, username: u, password: p } of purchaseBranches) {
      let lastErr: string | null = null;
      let result: any = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          result  = await syncBranch(supabase, branchId, erpId, u, p, startDate, endDate);
          lastErr = null;
          break;
        } catch (e: any) {
          lastErr = e.message;
          if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
        }
      }

      if (result) {
        results.push({ branchId, erpId, ...result });
        logRows.push({
          branch_id: branchId, erp_sucursal_id: erpId,
          fini: startDate, ffin: endDate,
          receipts_total: result.total, receipts_new: result.new,
          items_inserted: result.items, success: true,
        });
      } else {
        results.push({ branchId, erpId, error: lastErr });
        logRows.push({
          branch_id: branchId, erp_sucursal_id: erpId,
          fini: startDate, ffin: endDate,
          receipts_total: 0, receipts_new: 0, items_inserted: 0,
          success: false, error_msg: lastErr,
        });
      }
    }

    if (logRows.length > 0)
      await supabase.from('purchase_sync_log').insert(logRows);

    return new Response(
      JSON.stringify({ success: true, range: { startDate, endDate }, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
    );
  }
});
