import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mapping: internal branch_id → ERP id_sucursal + credentials
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { fini, ffin, branchId: onlyBranch } = body;

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

    for (const { branchId, erpId, username, password } of branches) {
      try {
        // 1. Login
        const cookie = await getSessionCookie(username, password);

        // 2. Fetch DTE JSON
        const url = `${DTE_BASE}?id_sucursal=${erpId}&fini=${startDate}&ffin=${endDate}`;
        const res = await fetch(url, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          results.push({ branchId, erpId, error: `HTTP ${res.status}` });
          continue;
        }

        const payload = await res.json();
        const ventas: any[] = payload?.ventas ?? [];
        if (ventas.length === 0) {
          results.push({ branchId, processed: 0 });
          continue;
        }

        // 3. Fetch existing invoices for change detection
        const codigos = ventas
          .map(v => v.codigo_generacion?.toLowerCase())
          .filter(Boolean);

        const { data: existingRaw } = await supabase
          .from('sales_invoices')
          .select('id, codigo_generacion, estado, tipo_pago, recibido_mh')
          .in('codigo_generacion', codigos);

        const existingMap = new Map(
          (existingRaw ?? []).map(inv => [inv.codigo_generacion.toLowerCase(), inv])
        );

        const invoicesToUpsert: any[] = [];
        const changelogs: any[] = [];
        const newCodigos = new Set<string>();
        const productMap = new Map<number, any>();
        const customerNames = new Set<string>();

        for (const venta of ventas) {
          const codigoLower = venta.codigo_generacion?.toLowerCase();
          if (!codigoLower) continue;

          const tipoDoc  = parseTipoDoc(venta.correlativo);
          const existing = existingMap.get(codigoLower);

          if (existing) {
            // Detect estado change
            if (existing.estado !== venta.estado) {
              changelogs.push({
                invoice_id:        existing.id,
                codigo_generacion:  venta.codigo_generacion,
                branch_id:         branchId,
                tipo_documento:    tipoDoc,
                campo:             'estado',
                valor_anterior:    existing.estado,
                valor_nuevo:       venta.estado,
              });
            }
            // Detect tipo_pago change
            if (existing.tipo_pago !== venta.tipo_pago) {
              changelogs.push({
                invoice_id:        existing.id,
                codigo_generacion:  venta.codigo_generacion,
                branch_id:         branchId,
                tipo_documento:    tipoDoc,
                campo:             'tipo_pago',
                valor_anterior:    existing.tipo_pago,
                valor_nuevo:       venta.tipo_pago,
              });
            }
            // Detect recibido_mh change (null → value means MH confirmed)
            if (!existing.recibido_mh && venta.recibido_mh) {
              changelogs.push({
                invoice_id:        existing.id,
                codigo_generacion:  venta.codigo_generacion,
                branch_id:         branchId,
                tipo_documento:    tipoDoc,
                campo:             'recibido_mh',
                valor_anterior:    null,
                valor_nuevo:       venta.recibido_mh,
              });
            }
          } else {
            newCodigos.add(codigoLower);
          }

          const clienteName = venta.cliente?.trim() || null;
          if (clienteName) customerNames.add(clienteName);

          invoicesToUpsert.push({
            branch_id:         branchId,
            erp_invoice_id:    venta.id_factura,
            codigo_generacion:  venta.codigo_generacion,
            correlativo:       venta.correlativo,
            tipo_documento:    tipoDoc,
            fecha:             venta.fecha,
            hora:              venta.hora,
            cliente:           clienteName,
            cod_vendedor:      venta.cod_vendedor,
            tipo_pago:         venta.tipo_pago,
            estado:            venta.estado,
            recibido_mh:       venta.recibido_mh ?? null,
            subtotal:          venta.totales?.subtotal ?? 0,
            iva:               venta.totales?.iva ?? 0,
            total:             venta.totales?.total ?? 0,
            updated_at:        new Date().toISOString(),
          });

          for (const p of (venta.productos ?? [])) {
            if (p.id && !productMap.has(p.id)) {
              productMap.set(p.id, {
                id:           p.id,
                descripcion:  p.descripcion,
                presentacion: p.presentacion,
                updated_at:   new Date().toISOString(),
              });
            }
          }
        }

        // 4. Upsert product catalog
        if (productMap.size > 0) {
          await supabase.from('products').upsert([...productMap.values()], { onConflict: 'id' });
        }

        // 4b. Upsert customers via RPC and build name→id map
        const customerIdMap = new Map<string, number>();
        if (customerNames.size > 0) {
          const { data: customerData } = await supabase.rpc('upsert_customers', {
            names: [...customerNames],
          });
          for (const c of (customerData ?? [])) {
            customerIdMap.set(c.customer_name, c.customer_id);
          }
        }

        // Attach customer_id to each invoice
        for (const inv of invoicesToUpsert) {
          if (inv.cliente) {
            const cid = customerIdMap.get(inv.cliente.trim().toUpperCase());
            if (cid) inv.customer_id = cid;
          }
        }

        // 5. Upsert invoices
        const { data: upserted, error: upsertErr } = await supabase
          .from('sales_invoices')
          .upsert(invoicesToUpsert, { onConflict: 'codigo_generacion' })
          .select('id, codigo_generacion');

        if (upsertErr) throw upsertErr;

        const invoiceIdMap = new Map(
          (upserted ?? []).map(inv => [inv.codigo_generacion.toLowerCase(), inv.id])
        );

        // 6. Insert items only for new invoices
        const itemsToInsert: any[] = [];
        for (const venta of ventas) {
          const codigoLower = venta.codigo_generacion?.toLowerCase();
          if (!newCodigos.has(codigoLower)) continue;
          const invoiceId = invoiceIdMap.get(codigoLower);
          if (!invoiceId) continue;
          for (const p of (venta.productos ?? [])) {
            itemsToInsert.push({
              invoice_id:      invoiceId,
              erp_product_id:  p.id || null,
              descripcion:     p.descripcion,
              cantidad:        p.cantidad,
              presentacion:    p.presentacion,
              precio_unitario: p.precio_unitario,
              total_linea:     p.total_linea,
            });
          }
        }

        if (itemsToInsert.length > 0) {
          await supabase.from('sales_invoice_items').insert(itemsToInsert);
        }

        // 7. Insert changelogs
        if (changelogs.length > 0) {
          await supabase.from('sales_invoice_changelog').insert(changelogs);
        }

        results.push({
          branchId,
          erpId,
          total:   invoicesToUpsert.length,
          new:     newCodigos.size,
          changes: changelogs.length,
          items:   itemsToInsert.length,
        });

      } catch (branchErr: any) {
        results.push({ branchId, erpId, error: branchErr.message });
      }
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
