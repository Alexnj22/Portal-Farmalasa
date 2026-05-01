import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BRANCH_MAP = [
  { branchId: 4,  erpId: 1, username: 'documento1.supervisor', password: 'documento9999' }, // Salud 1
  { branchId: 25, erpId: 2, username: 'documento2.supervisor', password: 'documento9999' }, // Salud 2
  { branchId: 27, erpId: 3, username: 'documento3.supervisor', password: 'documento9999' }, // Salud 3
  { branchId: 28, erpId: 4, username: 'documento4.supervisor', password: 'documento9999' }, // Salud 4
  { branchId: 29, erpId: 7, username: 'documento5.supervisor', password: 'documento9999' }, // Salud 5
  { branchId: 2,  erpId: 5, username: 'documentop.supervisor', password: 'documento9999' }, // La Popular
];

const LOGIN_URL = 'https://clientesdte3.oss.com.sv/farma_salud/login.php';
const DTE_BASE  = 'https://clientesdte3.oss.com.sv/farma_salud/descarga_dte_emitidos_json.php';

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 2000): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
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
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });

  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Login failed: no session cookie');
  return cookie;
}

function parseTipoDoc(correlativo: string): string {
  if (!correlativo) return 'UNKNOWN';
  const parts = correlativo.split('_');
  return parts[parts.length - 1] || 'UNKNOWN';
}

async function syncBranch(
  supabase: any,
  branchId: number,
  erpId: number,
  username: string,
  password: string,
  startDate: string,
  endDate: string,
  forceItems: boolean,
): Promise<{ total: number; new: number; changes: number; items: number; idMin: number | null; idMax: number | null }> {

  // 1. Login + fetch con reintentos
  const cookie = await withRetry(() => getSessionCookie(username, password));

  const url = `${DTE_BASE}?id_sucursal=${erpId}&fini=${startDate}&ffin=${endDate}`;
  const res = await withRetry(() => fetch(url, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(30_000),
  }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }));

  const payload = await res.json();
  const ventas: any[] = payload?.ventas ?? [];
  if (ventas.length === 0) return { total: 0, new: 0, changes: 0, items: 0, idMin: null, idMax: null };

  // 2. Fetch facturas existentes por erp_invoice_id (clave única global del ERP)
  const erpInvoiceIds = ventas.map(v => String(v.id_factura)).filter(Boolean);

  const { data: existingRaw } = await supabase
    .from('sales_invoices')
    .select('id, erp_invoice_id, codigo_generacion, estado, tipo_pago, recibido_mh')
    .in('erp_invoice_id', erpInvoiceIds)
    .limit(10000);

  const existingMap = new Map(
    (existingRaw ?? []).map((inv: any) => [String(inv.erp_invoice_id), inv])
  );

  const invoicesToUpsert: any[] = [];
  const changelogs: any[] = [];
  const newErpIds = new Set<string>();
  const productMap = new Map<number, any>();
  const customerNames = new Set<string>();

  for (const venta of ventas) {
    if (!venta.id_factura) continue;
    const erpId   = String(venta.id_factura);
    const tipoDoc = parseTipoDoc(venta.correlativo);
    const existing = existingMap.get(erpId);

    if (existing) {
      if (existing.estado !== venta.estado)
        changelogs.push({ invoice_id: existing.id, codigo_generacion: venta.codigo_generacion, branch_id: branchId, tipo_documento: tipoDoc, campo: 'estado', valor_anterior: existing.estado, valor_nuevo: venta.estado });
      if (existing.tipo_pago !== venta.tipo_pago)
        changelogs.push({ invoice_id: existing.id, codigo_generacion: venta.codigo_generacion, branch_id: branchId, tipo_documento: tipoDoc, campo: 'tipo_pago', valor_anterior: existing.tipo_pago, valor_nuevo: venta.tipo_pago });
      if (!existing.recibido_mh && venta.recibido_mh)
        changelogs.push({ invoice_id: existing.id, codigo_generacion: venta.codigo_generacion, branch_id: branchId, tipo_documento: tipoDoc, campo: 'recibido_mh', valor_anterior: null, valor_nuevo: venta.recibido_mh });
    } else {
      newErpIds.add(erpId);
    }

    const clienteName = venta.cliente?.trim() || null;
    if (clienteName) customerNames.add(clienteName);

    invoicesToUpsert.push({
      branch_id:         branchId,
      erp_invoice_id:    venta.id_factura,
      codigo_generacion: venta.codigo_generacion,
      correlativo:       venta.correlativo,
      tipo_documento:    tipoDoc,
      fecha:             venta.fecha,
      hora:              venta.hora,
      cliente:           clienteName,
      cod_vendedor:      venta.cod_vendedor,
      tipo_pago:         venta.tipo_pago,
      estado:            venta.estado,
      recibido_mh:       venta.recibido_mh ?? existing?.recibido_mh ?? null,
      subtotal:          venta.totales?.subtotal ?? 0,
      iva:               venta.totales?.iva ?? 0,
      total:             venta.totales?.total ?? 0,
      updated_at:        new Date().toISOString(),
    });

    for (const p of (venta.productos ?? [])) {
      if (p.id && !productMap.has(p.id))
        productMap.set(p.id, { id: p.id, nombre: p.descripcion, updated_at: new Date().toISOString() });
    }
  }

  // 3. Productos + clientes
  if (productMap.size > 0)
    await supabase.from('products').upsert([...productMap.values()], { onConflict: 'id', ignoreDuplicates: true });

  const customerIdMap = new Map<string, number>();
  if (customerNames.size > 0) {
    const { data: customerData } = await supabase.rpc('upsert_customers', { names: [...customerNames] });
    for (const c of (customerData ?? [])) customerIdMap.set(c.customer_name, c.customer_id);
  }
  for (const inv of invoicesToUpsert) {
    if (inv.cliente) { const cid = customerIdMap.get(inv.cliente.trim().toUpperCase()); if (cid) inv.customer_id = cid; }
  }

  // 4. Upsert facturas — clave: erp_invoice_id (único global en el ERP)
  const { data: upserted, error: upsertErr } = await supabase
    .from('sales_invoices')
    .upsert(invoicesToUpsert, { onConflict: 'erp_invoice_id' })
    .select('id, erp_invoice_id')
    .limit(10000);
  if (upsertErr) throw upsertErr;

  const invoiceIdMap = new Map(
    (upserted ?? []).map((inv: any) => [String(inv.erp_invoice_id), inv.id])
  );

  // 5. Items
  const itemsToInsert: any[] = [];
  for (const venta of ventas) {
    const erpId = String(venta.id_factura);
    const isNew = newErpIds.has(erpId);
    if (!isNew && !forceItems) continue;
    const invoiceId = invoiceIdMap.get(erpId) ?? existingMap.get(erpId)?.id;
    if (!invoiceId || !(venta.productos ?? []).length) continue;
    for (const p of venta.productos) {
      itemsToInsert.push({
        invoice_id: invoiceId, erp_product_id: p.id || null,
        descripcion: p.descripcion, cantidad: p.cantidad,
        presentacion: p.presentacion, precio_unitario: p.precio_unitario, total_linea: p.total_linea,
      });
    }
  }

  if (itemsToInsert.length > 0) {
    if (forceItems) {
      const invoiceIds = [...new Set(itemsToInsert.map(i => i.invoice_id))];
      await supabase.from('sales_invoice_items').delete().in('invoice_id', invoiceIds);
    }
    const CHUNK = 500;
    for (let i = 0; i < itemsToInsert.length; i += CHUNK) {
      const { error: insertErr } = await supabase.from('sales_invoice_items').insert(itemsToInsert.slice(i, i + CHUNK));
      if (insertErr) throw new Error(`items insert chunk ${i}: ${insertErr.message}`);
    }
  }

  // 6. Changelogs
  if (changelogs.length > 0) await supabase.from('sales_invoice_changelog').insert(changelogs);

  // Calcular min/max IDs de las facturas procesadas
  const erpIds = invoicesToUpsert.map(v => parseInt(v.erp_invoice_id)).filter(n => !isNaN(n));
  const idMin = erpIds.length ? Math.min(...erpIds) : null;
  const idMax = erpIds.length ? Math.max(...erpIds) : null;

  return { total: invoicesToUpsert.length, new: newErpIds.size, changes: changelogs.length, items: itemsToInsert.length, idMin, idMax };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { fini, ffin, branchId: onlyBranch, forceItems = false } = body;

    const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().split('T')[0];
    const startDate = fini || hoy;
    const endDate   = ffin || hoy;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const branches = onlyBranch
      ? BRANCH_MAP.filter(b => b.branchId === onlyBranch)
      : BRANCH_MAP;

    const results: any[] = [];
    const logRows: any[] = [];

    for (const { branchId, erpId, username, password } of branches) {
      let attempts = 0;
      let lastErr: string | null = null;
      let branchResult: any = null;

      // Reintentos a nivel de sucursal completa
      for (let attempt = 1; attempt <= 3; attempt++) {
        attempts = attempt;
        try {
          branchResult = await syncBranch(supabase, branchId, erpId, username, password, startDate, endDate, forceItems);
          lastErr = null;
          break;
        } catch (e: any) {
          lastErr = e.message;
          if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
        }
      }

      if (branchResult) {
        results.push({ branchId, erpId, ...branchResult });
        logRows.push({
          branch_id: branchId, fini: startDate, ffin: endDate,
          invoices_total: branchResult.total, invoices_new: branchResult.new,
          items_inserted: branchResult.items, success: true,
          attempts, id_min: branchResult.idMin, id_max: branchResult.idMax,
        });
      } else {
        results.push({ branchId, erpId, error: lastErr, attempts });
        logRows.push({
          branch_id: branchId, fini: startDate, ffin: endDate,
          invoices_total: 0, invoices_new: 0, items_inserted: 0,
          success: false, attempts, error_msg: lastErr,
        });
      }
    }

    // Guardar log de sync
    if (logRows.length > 0) {
      await supabase.from('sync_log').insert(logRows);
    }

    return new Response(
      JSON.stringify({ success: true, range: { startDate, endDate }, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
