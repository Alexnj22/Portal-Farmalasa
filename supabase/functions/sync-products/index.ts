import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOGIN_URL    = 'https://clientesdte3.oss.com.sv/farma_salud/login.php';
const PRODUCTS_URL = 'https://clientesdte3.oss.com.sv/farma_salud/descargar_productos_json.php';

// Use first branch credentials — products are company-wide
const CREDENTIALS = { username: 'documento1.supervisor', password: 'documento9999' };

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

    // 2. Upsert laboratorios
    const labMap = new Map<number, string>();
    for (const p of productos) {
      if (p.laboratorio?.id) labMap.set(p.laboratorio.id, p.laboratorio.nombre);
    }
    const labRows = [...labMap.entries()].map(([id, nombre]) => ({
      id, nombre, updated_at: new Date().toISOString(),
    }));
    await supabase.from('laboratorios').upsert(labRows, { onConflict: 'id' });

    // 3. Upsert presentaciones catalog (pure lookup: tipo, descripcion, factor)
    const presMap = new Map<number, any>();
    for (const p of productos) {
      for (const pres of (p.presentaciones ?? [])) {
        if (!presMap.has(pres.id_presentacion)) {
          presMap.set(pres.id_presentacion, {
            id:          pres.id_presentacion,
            tipo:        pres.tipo?.trim() ?? null,
            descripcion: pres.descripcion ?? null,
            factor:      pres.factor ?? 1,
            updated_at:  new Date().toISOString(),
          });
        }
      }
    }
    await supabase.from('presentaciones').upsert([...presMap.values()], { onConflict: 'id' });

    // 4. Upsert products (core fields only — no prices)
    const productRows = productos.map(p => ({
      id:             p.id,
      nombre:         p.nombre,
      codigo_barras:  p.codigo_barras ?? null,
      laboratorio_id: p.laboratorio?.id ?? null,
      es_antibiotico: p.es_antibiotico ?? false,
      activo:         p.activo ?? true,
      perecedero:     p.perecedero ?? false,
      updated_at:     new Date().toISOString(),
    }));

    const CHUNK = 500;
    for (let i = 0; i < productRows.length; i += CHUNK) {
      await supabase.from('products').upsert(productRows.slice(i, i + CHUNK), { onConflict: 'id' });
    }

    // 5. Upsert product_precios: (product_id, id_presentacion) → prices
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
          updated_at:      new Date().toISOString(),
        });
      }
    }

    for (let i = 0; i < precioRows.length; i += CHUNK) {
      await supabase
        .from('product_precios')
        .upsert(precioRows.slice(i, i + CHUNK), { onConflict: 'product_id,id_presentacion' });
    }

    return new Response(
      JSON.stringify({
        success: true,
        laboratorios: labRows.length,
        presentaciones: presMap.size,
        products: productRows.length,
        product_precios: precioRows.length,
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
