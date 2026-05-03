import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOGIN_URL    = 'https://clientesdte3.oss.com.sv/farma_salud/login.php';
const PRODUCTS_URL = 'https://clientesdte3.oss.com.sv/farma_salud/descargar_productos_json.php';
const CREDENTIALS  = { username: 'documento1.supervisor', password: 'documento9999' };
const CHUNK        = 500;

const PRICE_FIELDS = ['vineta', 'descuento_1', 'vip', 'clinica', 'mayoreo', 'premium', 'precio_7'] as const;

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

    const now = new Date().toISOString();

    // 2. Upsert laboratorios
    const labMap = new Map<number, string>();
    for (const p of productos) {
      if (p.laboratorio?.id) labMap.set(p.laboratorio.id, p.laboratorio.nombre);
    }
    const labRows = [...labMap.entries()].map(([id, nombre]) => ({ id, nombre, updated_at: now }));
    await supabase.from('laboratorios').upsert(labRows, { onConflict: 'id' });

    // 3. Upsert presentaciones catalog
    const presMap = new Map<number, any>();
    for (const p of productos) {
      for (const pres of (p.presentaciones ?? [])) {
        if (!presMap.has(pres.id_presentacion)) {
          presMap.set(pres.id_presentacion, {
            id:          pres.id_presentacion,
            tipo:        pres.tipo?.trim() ?? null,
            descripcion: pres.descripcion ?? null,
            factor:      pres.factor ?? 1,
            updated_at:  now,
          });
        }
      }
    }
    await supabase.from('presentaciones').upsert([...presMap.values()], { onConflict: 'id' });

    // 4. Detect product name / lab changes, then upsert
    const productRows = productos.map((p: any) => ({
      id:             p.id,
      nombre:         p.nombre,
      codigo_barras:  p.codigo_barras ?? null,
      laboratorio_id: p.laboratorio?.id ?? null,
      es_antibiotico: p.es_antibiotico ?? false,
      activo:         p.activo ?? true,
      perecedero:     p.perecedero ?? false,
      updated_at:     now,
    }));

    const { data: existingProducts } = await supabase
      .from('products')
      .select('id, nombre, laboratorio_id')
      .in('id', productRows.map((p: any) => p.id));

    const existingProductsMap = new Map(
      (existingProducts ?? []).map((p: any) => [p.id, p])
    );

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
    }

    // Solo upsertear productos nuevos o con cambios detectados
    const changedProductIds = new Set(productChangelogs.map((c: any) => c.product_id));
    const productRowsToUpsert = productRows.filter((p: any) =>
      !existingProductsMap.has(p.id) || changedProductIds.has(p.id)
    );
    for (let i = 0; i < productRowsToUpsert.length; i += CHUNK) {
      await supabase.from('products').upsert(productRowsToUpsert.slice(i, i + CHUNK), { onConflict: 'id' });
    }
    if (productChangelogs.length > 0) {
      await supabase.from('products_changelog').insert(productChangelogs);
    }

    // 5. Build precio rows
    const precioRows: any[] = [];
    for (const p of productos) {
      for (const pres of (p.presentaciones ?? [])) {
        const precios = pres.lista_precios?.[0]?.precios?.[0] ?? {};
        precioRows.push({
          product_id:      p.id,
          id_presentacion: pres.id_presentacion,
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

    // 5a. Detect price changes vs current product_precios
    const { data: existingPrecios } = await supabase
      .from('product_precios')
      .select('product_id, id_presentacion, vineta, descuento_1, vip, clinica, mayoreo, premium, precio_7');

    const existingPreciosMap = new Map(
      (existingPrecios ?? []).map((p: any) => [`${p.product_id}_${p.id_presentacion}`, p])
    );

    const precioChangelogs: any[] = [];
    const changedKeys  = new Set<string>();
    const newCombos: any[] = [];

    for (const nr of precioRows) {
      const key = `${nr.product_id}_${nr.id_presentacion}`;
      const er  = existingPreciosMap.get(key);

      if (!er) {
        // Brand-new product+presentacion: seed into history
        newCombos.push(nr);
        continue;
      }

      let hasChange = false;
      for (const campo of PRICE_FIELDS) {
        const oldVal = er[campo];
        const newVal = nr[campo];
        const same = (oldVal == null && newVal == null) ||
                     (oldVal != null && newVal != null && Math.abs(Number(oldVal) - Number(newVal)) < 0.005);
        if (!same) {
          precioChangelogs.push({
            product_id:      nr.product_id,
            id_presentacion: nr.id_presentacion,
            campo,
            valor_anterior:  oldVal,
            valor_nuevo:     newVal,
            detected_at:     now,
          });
          hasChange = true;
        }
      }
      if (hasChange) changedKeys.add(key);
    }

    // 5b. Close active history entries for changed prices & open new ones
    if (changedKeys.size > 0) {
      for (const key of changedKeys) {
        const [pid, presId] = key.split('_').map(Number);
        await supabase.from('product_precios_history')
          .update({ valid_until: now })
          .eq('product_id', pid)
          .eq('id_presentacion', presId)
          .is('valid_until', null);
      }

      const newHistoryRows = [...changedKeys].map(key => {
        const r = precioRows.find((x: any) => `${x.product_id}_${x.id_presentacion}` === key)!;
        return {
          product_id: r.product_id, id_presentacion: r.id_presentacion,
          vineta: r.vineta, descuento_1: r.descuento_1, vip: r.vip,
          clinica: r.clinica, mayoreo: r.mayoreo, premium: r.premium, precio_7: r.precio_7,
          valid_from: now,
        };
      });
      await supabase.from('product_precios_history').insert(newHistoryRows);
    }

    // 5c. Seed history for brand-new combos
    if (newCombos.length > 0) {
      const seedRows = newCombos.map((r: any) => ({
        product_id: r.product_id, id_presentacion: r.id_presentacion,
        vineta: r.vineta, descuento_1: r.descuento_1, vip: r.vip,
        clinica: r.clinica, mayoreo: r.mayoreo, premium: r.premium, precio_7: r.precio_7,
        valid_from: now,
      }));
      for (let i = 0; i < seedRows.length; i += CHUNK) {
        await supabase.from('product_precios_history').insert(seedRows.slice(i, i + CHUNK));
      }
    }

    if (precioChangelogs.length > 0) {
      await supabase.from('product_precios_changelog').insert(precioChangelogs);
    }

    // 5d. Upsert solo precios nuevos o con cambios detectados
    const newComboKeys = new Set(newCombos.map((r: any) => `${r.product_id}_${r.id_presentacion}`));
    const precioRowsToUpsert = precioRows.filter((r: any) => {
      const key = `${r.product_id}_${r.id_presentacion}`;
      return changedKeys.has(key) || newComboKeys.has(key);
    });
    for (let i = 0; i < precioRowsToUpsert.length; i += CHUNK) {
      await supabase.from('product_precios').upsert(precioRowsToUpsert.slice(i, i + CHUNK), { onConflict: 'product_id,id_presentacion' });
    }

    return new Response(
      JSON.stringify({
        success:         true,
        laboratorios:    labRows.length,
        presentaciones:  presMap.size,
        products_total:   productRows.length,
        products_written: productRowsToUpsert.length,
        precios_total:    precioRows.length,
        precios_written:  precioRowsToUpsert.length,
        price_changes:   precioChangelogs.length,
        product_changes: productChangelogs.length,
        new_combos:      newCombos.length,
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
