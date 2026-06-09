import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOGIN_URL    = 'https://clientesdte3.oss.com.sv/farma_salud/login.php';
const PRODUCTS_URL = 'https://clientesdte3.oss.com.sv/farma_salud/descargar_productos_json.php';
const CREDENTIALS  = { username: 'documento1.supervisor', password: 'documento9999' };
const CHUNK        = 500;


async function getSessionCookie(): Promise<string> {
  const form = new URLSearchParams();
  form.append('username', CREDENTIALS.username);
  form.append('password', CREDENTIALS.password);
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Debug mode: ?debug_product=CETRAM returns raw ERP JSON for matching products
    const url         = new URL(req.url);
    const debugFilter = url.searchParams.get('debug_product')?.toLowerCase() ?? null;

    // 1. Login + fetch products
    const cookie = await getSessionCookie();
    const res = await fetch(PRODUCTS_URL, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`ERP HTTP ${res.status}`);

    const payload = await res.json();
    const productos: any[] = payload?.productos ?? [];
    if (productos.length === 0) throw new Error('Empty products payload');

    if (debugFilter) {
      const matches = productos.filter((p: any) =>
        (p.nombre ?? '').toLowerCase().includes(debugFilter)
      );
      return new Response(JSON.stringify({ debug: true, filter: debugFilter, results: matches }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toISOString();

    // 2. Upsert laboratorios
    const labMap = new Map<number, string>();
    for (const p of productos) {
      if (p.laboratorio?.id) labMap.set(p.laboratorio.id, p.laboratorio.nombre);
    }
    const labRows = [...labMap.entries()].map(([id, nombre]) => ({ id, nombre, updated_at: now }));
    const { error: labErr } = await supabase.from('laboratorios').upsert(labRows, { onConflict: 'id' });
    if (labErr) throw new Error(`Laboratorios upsert: ${labErr.message}`);

    // 3. Upsert presentaciones catalog — tipo only.
    // factor and descripcion are per-product (not per-type): the ERP reuses the same
    // id_presentacion (e.g. id=9 "CAJA") for products with completely different unit
    // counts (3, 10, 50, 200...). Storing factor/descripcion here produces a wrong
    // first-product-wins value. The correct per-product factor lives in product_precios.
    const presMap = new Map<number, any>();
    for (const p of productos) {
      for (const pres of (p.presentaciones ?? [])) {
        if (!presMap.has(pres.id_presentacion)) {
          presMap.set(pres.id_presentacion, {
            id:         pres.id_presentacion,
            tipo:       pres.tipo?.trim() ?? null,
            updated_at: now,
          });
        }
      }
    }
    const { error: presErr } = await supabase.from('presentaciones').upsert([...presMap.values()], { onConflict: 'id' });
    if (presErr) throw new Error(`Presentaciones upsert: ${presErr.message}`);

    // 4. Build product rows
    // activo is derived from whether any presentation is active — the ERP product-level flag
    // is unreliable (ERP UI shows a product as active when it has ≥1 active presentation).
    const productRowsRaw = productos.map((p: any) => {
      const pres: any[] = p.presentaciones ?? [];
      const activo = pres.length > 0
        ? pres.some((pr: any) => pr.activo !== false)
        : (p.activo ?? true);
      return {
        id:             p.id,
        nombre:         p.nombre,
        codigo_barras:  p.codigo_barras ?? null,
        laboratorio_id: p.laboratorio?.id ?? null,
        es_antibiotico: p.es_antibiotico ?? false,
        activo,
        perecedero:     p.perecedero ?? false,
        updated_at:     now,
      };
    });
    const productRowsDeduped = new Map<number, any>();
    for (const p of productRowsRaw) productRowsDeduped.set(p.id, p);
    const productRows = [...productRowsDeduped.values()];

    const existingProductsAll: any[] = [];
    let epFrom = 0;
    while (true) {
      const { data: batch, error: epErr } = await supabase
        .from('products')
        .select('id, nombre, laboratorio_id, activo')
        .order('id')
        .range(epFrom, epFrom + CHUNK - 1);
      if (epErr) throw new Error(`Load products: ${epErr.message}`);
      if (!batch || batch.length === 0) break;
      existingProductsAll.push(...batch);
      if (batch.length < CHUNK) break;
      epFrom += CHUNK;
    }
    const existingProductsMap = new Map(existingProductsAll.map((p: any) => [p.id, p]));

    const productChangelogs: any[] = [];
    for (const np of productRows) {
      const ep = existingProductsMap.get(np.id);
      if (!ep) continue;
      for (const campo of ['nombre', 'laboratorio_id'] as const) {
        if (String(ep[campo] ?? '') !== String(np[campo] ?? '')) {
          productChangelogs.push({
            product_id: np.id, campo,
            valor_anterior: String(ep[campo] ?? ''),
            valor_nuevo:    String(np[campo] ?? ''),
            detected_at:    now,
          });
        }
      }
      // activo change — trigger upsert without logging to changelog
      if ((ep.activo ?? true) !== (np.activo ?? true)) {
        productChangelogs.push({ product_id: np.id, _activoOnly: true });
      }
    }

    const changedProductIds = new Set(productChangelogs.map((c: any) => c.product_id));
    const productRowsToUpsert = productRows.filter((p: any) =>
      !existingProductsMap.has(p.id) || changedProductIds.has(p.id)
    );
    const upsertErrors: string[] = [];
    for (let i = 0; i < productRowsToUpsert.length; i += CHUNK) {
      const { error } = await supabase.from('products').upsert(productRowsToUpsert.slice(i, i + CHUNK), { onConflict: 'id' });
      if (error) upsertErrors.push(`products[${i}]: ${error.message}`);
    }
    const realProductChangelogs = productChangelogs.filter((c: any) => !c._activoOnly);
    if (realProductChangelogs.length > 0) {
      await supabase.from('products_changelog').insert(realProductChangelogs);
    }

    // 5. Build precio rows — descripcion and factor are per product+presentacion
    const precioRowsMap = new Map<string, any>();
    for (const p of productos) {
      for (const pres of (p.presentaciones ?? [])) {
        const key = `${p.id}_${pres.id_presentacion}`;
        const precios = pres.lista_precios?.[0]?.precios?.[0] ?? {};
        precioRowsMap.set(key, {
          product_id:      p.id,
          id_presentacion: pres.id_presentacion,
          descripcion:     pres.descripcion ?? null,
          factor:          pres.factor ?? null,
          activo:          pres.activo ?? true,
          costo:           pres.costo ?? null,
          vineta:          precios.vineta ?? null,
          descuento_1:     precios.descuento_1 ?? null,
          vip:             precios.vip ?? null,
          clinica:         precios.clinica ?? null,
          mayoreo:         precios.mayoreo ?? null,
          premium:         precios.premium ?? null,
          precio_7:        precios.precio_7 ?? null,
          updated_at:      now,
        });
      }
    }
    const precioRows = [...precioRowsMap.values()];

    // 5a. Upsert all precios directly — DB handles conflicts server-side.
    // Avoids loading thousands of rows into memory for in-process comparison.
    for (let i = 0; i < precioRows.length; i += CHUNK) {
      const { error } = await supabase.from('product_precios')
        .upsert(precioRows.slice(i, i + CHUNK), { onConflict: 'product_id,id_presentacion' });
      if (error) upsertErrors.push(`precios[${i}]: ${error.message}`);
    }

    // 5b. Deactivate presentations the ERP no longer includes — batch by product_id chunks
    // to avoid loading all 7k+ rows into memory at once.
    const erpComboSet   = new Set(precioRows.map((r: any) => `${r.product_id}_${r.id_presentacion}`));
    const erpProductIds = [...new Set(precioRows.map((r: any) => r.product_id as number))];
    let deactivatedCount = 0;

    for (let i = 0; i < erpProductIds.length; i += CHUNK) {
      const batchIds = erpProductIds.slice(i, i + CHUNK);
      const { data: activeCombos } = await supabase
        .from('product_precios')
        .select('product_id, id_presentacion')
        .in('product_id', batchIds)
        .eq('activo', true);

      for (const combo of (activeCombos || [])) {
        if (!erpComboSet.has(`${combo.product_id}_${combo.id_presentacion}`)) {
          const { error } = await supabase.from('product_precios')
            .update({ activo: false })
            .eq('product_id', combo.product_id)
            .eq('id_presentacion', combo.id_presentacion);
          if (error) upsertErrors.push(`deactivate[${combo.product_id}_${combo.id_presentacion}]: ${error.message}`);
          else deactivatedCount++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success:          upsertErrors.length === 0,
        laboratorios:     labRows.length,
        presentaciones:   presMap.size,
        products_total:   productRows.length,
        products_written: productRowsToUpsert.length,
        product_changes:  realProductChangelogs.length,
        precios_total:    precioRows.length,
        deactivated:      deactivatedCount,
        errors:           upsertErrors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
