import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, getErpBranchMap, requireInvokeSecret } from "../_shared/security.ts";

// Sincroniza compras/recepciones del ERP → purchase_receipts + purchase_receipt_items.
// Mismo patrón de auth que sync-dte-sales (login → cookie → fetch JSON).
// URL: descargar_compras_json.php?fini=YYYY-MM-DD&ffin=YYYY-MM-DD&id_sucursal=N

const LOGIN_URL     = "https://clientesdte3.oss.com.sv/farma_salud/login.php";
const COMPRAS_BASE  = "https://clientesdte3.oss.com.sv/farma_salud/descargar_compras_json.php";

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

  // Devuelve la clave raíz, keys del primer registro y primera línea de productos
  const rootKeys    = Object.keys(payload);
  const rootKey     = rootKeys[0] ?? null;
  const records: any[] = rootKey ? (payload[rootKey] ?? []) : [];
  const firstRecord = records[0] ?? null;
  const firstItem   = firstRecord ? Object.values(firstRecord).find(Array.isArray)?.[0] ?? null : null;

  return {
    root_keys:          rootKeys,
    total_records:      records.length,
    first_record_keys:  firstRecord ? Object.keys(firstRecord) : [],
    first_record:       firstRecord,
    first_item_keys:    firstItem ? Object.keys(firstItem) : [],
    first_item:         firstItem,
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

  // 1. Login + fetch
  const cookie = await withRetry(() => getSessionCookie(username, password));
  const url    = `${COMPRAS_BASE}?fini=${startDate}&ffin=${endDate}&id_sucursal=${erpId}`;
  const res    = await withRetry(() => fetch(url, {
    headers: { Cookie: cookie },
    signal:  AbortSignal.timeout(60_000),
  }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }));

  const payload = await res.json();

  // Clave raíz flexible: "compras", "data", "recepciones", o la primera que sea array
  const compras: any[] = (
    payload?.compras ??
    payload?.recepciones ??
    payload?.data ??
    Object.values(payload).find(Array.isArray) ??
    []
  );

  if (compras.length === 0) return { total: 0, new: 0, items: 0 };

  // 2. IDs existentes para saber cuáles son nuevos
  const erpPurchaseIds = compras
    .map(c => c.id_compra ?? c.id_factura ?? c.id_orden ?? c.id)
    .filter(Boolean)
    .map(Number);

  const { data: existingRaw } = await supabase
    .from('purchase_receipts')
    .select('id, erp_purchase_id')
    .in('erp_purchase_id', erpPurchaseIds)
    .eq('erp_sucursal_id', erpId)
    .limit(10000);

  const existingMap = new Map<number, number>(
    (existingRaw ?? []).map((r: any) => [r.erp_purchase_id, r.id])
  );

  const receiptsToUpsert: any[] = [];
  const newErpIds = new Set<number>();
  const productMap = new Map<number, any>();

  for (const c of compras) {
    // ID flexible
    const erpPurchaseId = Number(c.id_compra ?? c.id_factura ?? c.id_orden ?? c.id);
    if (!erpPurchaseId) continue;

    // Fecha flexible
    const fecha = c.fecha ?? c.fecha_emision ?? c.fecha_recepcion ?? null;

    const row = {
      erp_purchase_id: erpPurchaseId,
      branch_id:       branchId,
      erp_sucursal_id: erpId,
      fecha:           fecha,
      proveedor:       c.proveedor ?? c.supplier ?? c.nombre_proveedor ?? null,
      estado:          c.estado ?? null,
      subtotal:        c.totales?.subtotal ?? c.subtotal ?? 0,
      iva:             c.totales?.iva      ?? c.iva      ?? 0,
      total:           c.totales?.total    ?? c.total    ?? 0,
      updated_at:      new Date().toISOString(),
    };

    receiptsToUpsert.push(row);
    if (!existingMap.has(erpPurchaseId)) newErpIds.add(erpPurchaseId);

    // Productos para upsert de catálogo
    for (const p of (c.productos ?? c.items ?? c.detalle ?? [])) {
      const pid = p.id ?? p.id_producto;
      if (pid && !productMap.has(Number(pid)))
        productMap.set(Number(pid), { id: Number(pid), nombre: p.descripcion ?? p.nombre, updated_at: new Date().toISOString() });
    }
  }

  // 3. Upsert productos al catálogo
  if (productMap.size > 0)
    await supabase.from('products').upsert([...productMap.values()], { onConflict: 'id', ignoreDuplicates: true });

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

      // Actualizar el mapa con IDs recién insertados
      for (const r of (upserted ?? [])) existingMap.set(r.erp_purchase_id, r.id);
    }
  }

  // 5. Items — solo para recepciones nuevas
  const itemsToInsert: any[] = [];
  for (const c of compras) {
    const erpPurchaseId = Number(c.id_compra ?? c.id_factura ?? c.id_orden ?? c.id);
    if (!newErpIds.has(erpPurchaseId)) continue;

    const receiptId = existingMap.get(erpPurchaseId);
    if (!receiptId) continue;

    const lines = c.productos ?? c.items ?? c.detalle ?? [];
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const p = lines[lineIdx];
      const rawFecha = p.fecha_vencimiento ?? p.vencimiento ?? null;

      itemsToInsert.push({
        receipt_id:        receiptId,
        linea_num:         lineIdx,
        erp_product_id:    p.id ?? p.id_producto ?? null,
        descripcion:       p.descripcion ?? p.nombre ?? null,
        cantidad:          parseFloat(p.cantidad) || 0,
        precio_unitario:   parseFloat(p.precio_unitario ?? p.precio ?? 0) || 0,
        total_linea:       parseFloat(p.total_linea ?? p.total ?? 0) || 0,
        lote:              p.lote || null,
        fecha_vencimiento: (rawFecha && rawFecha !== '0000-00-00') ? rawFecha : null,
      });
    }
  }

  if (itemsToInsert.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < itemsToInsert.length; i += CHUNK) {
      const { error } = await supabase
        .from('purchase_receipt_items')
        .upsert(itemsToInsert.slice(i, i + CHUNK), { onConflict: 'receipt_id,linea_num', ignoreDuplicates: true });
      if (error) throw new Error(`items upsert chunk ${i}: ${error.message}`);
    }
    totalItems = itemsToInsert.length;
  }

  return { total: compras.length, new: newErpIds.size, items: totalItems };
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
    const BRANCH_MAP = getErpBranchMap();
    const body = await req.json().catch(() => ({}));
    const {
      fini,
      ffin,
      branchId: onlyBranch,
      discover = false,   // devuelve JSON crudo del primer branch sin insertar nada
    } = body;

    const hoy       = new Date(Date.now() - 6 * 3600_000).toISOString().split('T')[0];
    const startDate = fini || hoy;
    const endDate   = ffin || hoy;

    // ── Modo discover: muestra estructura raw del ERP ─────────────────────────
    if (discover) {
      const target = onlyBranch
        ? BRANCH_MAP.find(b => b.branchId === onlyBranch)
        : BRANCH_MAP[0];
      if (!target) throw new Error('No branch found');
      const info = await discoverBranch(target.erpId, target.username, target.password, startDate, endDate);
      return new Response(JSON.stringify({ discover: true, branchId: target.branchId, erpId: target.erpId, ...info }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Sync normal ───────────────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const branches = onlyBranch
      ? BRANCH_MAP.filter(b => b.branchId === onlyBranch)
      : BRANCH_MAP;

    const results: any[]  = [];
    const logRows: any[]  = [];

    for (const { branchId, erpId, username, password } of branches) {
      let attempts = 0;
      let lastErr: string | null = null;
      let result: any = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        attempts = attempt;
        try {
          result  = await syncBranch(supabase, branchId, erpId, username, password, startDate, endDate);
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
        results.push({ branchId, erpId, error: lastErr, attempts });
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
