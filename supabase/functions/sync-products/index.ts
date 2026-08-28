import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";

const LOGIN_URL    = 'https://clientesdte3.oss.com.sv/farma_salud/login.php';
const PRODUCTS_URL = 'https://clientesdte3.oss.com.sv/farma_salud/descargar_productos_json.php';
const CHUNK        = 500;

// Credenciales ERP desde Supabase Secret ERP_PRODUCTS_CREDS (JSON {username,password}).
// Nunca hardcodear credenciales aquí.
function getProductCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_PRODUCTS_CREDS");
  if (!raw) throw new Error("ERP_PRODUCTS_CREDS secret not configured in Supabase.");
  return JSON.parse(raw);
}

async function getSessionCookie(): Promise<string> {
  const { username, password } = getProductCreds();
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

/**
 * Los que salieron del catálogo y NO se avisan, con el motivo de cada uno.
 *
 * Los tres son cobros que se facturan como si fueran artículos, así que su
 * «existencia» no es mercadería que nadie tenga que ir a sacar de una sala.
 * Sin esta lista el primer aviso del control —y el único que saldría hoy— sería
 * por COMISIONES, y un aviso que estrena disparando por algo que no hay que
 * atender enseña a ignorarlo desde el día uno.
 *
 * **Va por id y no por una regla porque la regla no existe**, medido el
 * 2026-08-28: los cuatro que hoy están fuera del catálogo —los tres de acá y un
 * medicamento de verdad— tienen laboratorio, código de barras y categoría en
 * blanco, así que ninguno de esos campos los separa. Y la regla de «esto no es
 * venta de productos» que ya vive en el portal (`ventas_sin_producto`) se define
 * por FACTURA —código de vendedor administrativo cobrado a una ficha marcada—,
 * no por producto: no hay de dónde leer «este artículo es un cobro».
 *
 * Si algún día ese marcador existe a nivel de producto, esta lista se borra y se
 * lee de ahí. Mientras tanto son tres, están nombrados y cada uno dice por qué.
 */
const FUERA_DE_CATALOGO_CALLADOS = new Map<number, string>([
  [4239, 'COMISIONES POR SERVICIO DE CORRESPONSAL: es un cobro, no un artículo. Sus 83 unidades entre Salud 3 y La Popular no son mercadería.'],
  [4466, 'SERVICIO A DOMICILIO: un servicio que se factura como si fuera un artículo.'],
  [4711, 'APOYO PROMOCIONAL MARCA VIRO-GRIP: un apoyo de laboratorio, no un producto de venta.'],
]);

/**
 * Avisa cuando un producto DEJA DE VENIR en el catálogo y una sala todavía lo
 * tiene en existencia.
 *
 * Son dos casos distintos y sólo uno estaba cubierto. El producto que se da de
 * BAJA sigue llegando —con su bandera apagada— y el sincronizador lo apaga acá
 * también. El que DESAPARECE no llega, y el recorrido de arriba sólo camina lo
 * que el catálogo manda: a ése no lo toca nadie nunca, así que se queda como
 * esté para siempre. Medido el 2026-08-28: cuatro productos en esa situación,
 * los cuatro figurando como disponibles, uno de ellos un medicamento real
 * (URELOG X 100 TABLETAS, dado de alta el 29 de julio).
 *
 * **No se lo da de baja solo** —decisión del usuario, 2026-08-28—: entre los que
 * faltan hay tres de comisiones y servicios que TIENEN que seguir vivos.
 * Se avisa a la jefatura de Logística y a Supervisión, y **sólo si alguna sala
 * todavía tiene existencia**: un producto sin existencia que deja de venir no le
 * cuesta nada a nadie, y un aviso que se dispara por algo que no hay que
 * atender es cómo se aprende a ignorar los avisos.
 */
async function avisarFueraDeCatalogo(
  supabase: any,
  delCatalogo: any[],
  enElPortal: any[],
): Promise<{ fuera: number; con_existencia: number; avisados: number; callados?: number; motivo?: string }> {
  const idsDelCatalogo = new Set(delCatalogo.map((p: any) => Number(p.id)));
  const fuera = enElPortal.filter((p: any) => !idsDelCatalogo.has(Number(p.id)));
  if (fuera.length === 0) return { fuera: 0, con_existencia: 0, avisados: 0 };

  // La guarda que hace confiable al aviso. El catálogo a veces contesta a medias,
  // y con una respuesta corta TODO lo que falta parecería haber desaparecido:
  // saldrían cientos de avisos falsos de una sola corrida y nadie volvería a
  // creerle a éste. Con menos del 90% del padrón no se decide nada — el resto
  // del sync ya corrió y eso no cambia.
  const cobertura = idsDelCatalogo.size / Math.max(1, enElPortal.length);
  if (cobertura < 0.9) {
    console.warn(`[fuera-de-catalogo] el catálogo trajo ${idsDelCatalogo.size} de ${enElPortal.length}: no se avisa nada.`);
    return { fuera: fuera.length, con_existencia: 0, avisados: 0, motivo: 'catalogo_corto' };
  }

  // La existencia se pagina a mano: `erp_product_id` se REPITE en `inventory`
  // —una fila por sucursal y por área— así que acotar la entrada no acota la
  // salida, y el corte de 1000 filas de PostgREST no avisa cuando muerde.
  const idsFuera = fuera.map((p: any) => Number(p.id));
  const existencias: any[] = [];
  for (let i = 0; i < idsFuera.length; i += CHUNK) {
    const tanda = idsFuera.slice(i, i + CHUNK);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('inventory')
        .select('erp_product_id, erp_sucursal_id, cantidad')
        .in('erp_product_id', tanda)
        .gt('cantidad', 0)
        .order('erp_product_id')
        .range(from, from + CHUNK - 1);
      if (error) { console.error('[fuera-de-catalogo] inventario:', error.message); return { fuera: fuera.length, con_existencia: 0, avisados: 0, motivo: 'inventario_ilegible' }; }
      if (!data || data.length === 0) break;
      existencias.push(...data);
      if (data.length < CHUNK) break;
      from += CHUNK;
    }
  }

  const porProducto = new Map<number, { unidades: number; salas: Set<number> }>();
  for (const r of existencias) {
    const id = Number(r.erp_product_id);
    const acc = porProducto.get(id) ?? { unidades: 0, salas: new Set<number>() };
    acc.unidades += Number(r.cantidad) || 0;
    acc.salas.add(Number(r.erp_sucursal_id));
    porProducto.set(id, acc);
  }
  // Los callados se descuentan del AVISO, no de la medición: `con_existencia`
  // sigue contándolos, así que la respuesta del sync no esconde que están ahí.
  const todosConExistencia = fuera.filter((p: any) => porProducto.has(Number(p.id)));
  const conExistencia = todosConExistencia.filter((p: any) => !FUERA_DE_CATALOGO_CALLADOS.has(Number(p.id)));
  const callados = todosConExistencia.length - conExistencia.length;
  if (conExistencia.length === 0) {
    return { fuera: fuera.length, con_existencia: todosConExistencia.length, avisados: 0, callados };
  }

  // Se avisa UNA vez por producto. La corrida es cada 10 minutos y la condición
  // dura hasta que alguien la resuelve: sin esto serían 144 avisos por día del
  // mismo producto. El anuncio anterior es el registro de que ya se avisó —por
  // eso la marca va en `metadata` y no en el título, que es texto que alguien
  // puede querer reescribir.
  // El filtro va POR los productos que se van a avisar y no por el tipo a secas:
  // así la consulta queda acotada por lo que se está mirando ahora y no por
  // cuántos avisos se acumularon desde siempre, que es la lista que un día cruza
  // el corte de 1000 filas sin decirlo.
  const { data: yaAvisados, error: avErr } = await supabase
    .from('announcements')
    .select('metadata')
    .eq('metadata->>type', 'PRODUCTO_FUERA_DE_CATALOGO')
    .in('metadata->>product_id', conExistencia.map((p: any) => String(p.id)));
  if (avErr) { console.error('[fuera-de-catalogo] anuncios:', avErr.message); return { fuera: fuera.length, con_existencia: todosConExistencia.length, avisados: 0, callados, motivo: 'anuncios_ilegibles' }; }
  const yaVistos = new Set((yaAvisados ?? []).map((a: any) => Number(a.metadata?.product_id)));
  const nuevos = conExistencia.filter((p: any) => !yaVistos.has(Number(p.id)));
  if (nuevos.length === 0) return { fuera: fuera.length, con_existencia: todosConExistencia.length, avisados: 0, callados };

  // Los destinatarios: la jefatura de Logística —con su suplencia por vacaciones
  // ya resuelta adentro— y Supervisión.
  //
  // ⚠️ Supervisión sale del CARGO, nunca de `system_role`. Esa columna es el
  // NIVEL DE PERMISO, no el puesto, y confundirlos ya mandó este aviso a quien
  // no era: corregido por el usuario el 2026-08-28 —«rutilio no es supervisor,
  // celina no es supervisor»—. Medido, `system_role` decía SUPERVISOR del
  // Gerente General y ADMIN de la jefatura de Talento Humano. Es la misma
  // lección de «admin es un área, no un rol».
  const { data: cargosSup, error: rolErr } = await supabase
    .from('roles').select('id').ilike('name', '%supervis%');
  if (rolErr) console.error('[fuera-de-catalogo] cargos de supervisión:', rolErr.message);
  const idsCargoSup = (cargosSup ?? []).map((r: any) => r.id);
  // Un cargo renombrado dejaría esta lista vacía y el aviso saldría sólo a
  // Logística sin que nadie se entere. Se dice en el registro: un destinatario
  // que falta en silencio es indistinguible de uno que no existe.
  if (idsCargoSup.length === 0) console.warn('[fuera-de-catalogo] ningún cargo de supervisión: sólo se avisa a Logística.');

  // `tipo_ficha = 'empleado'` deja afuera la cuenta técnica: tiene los poderes
  // de un supervisor y no es una persona, así que un aviso dirigido a ella no lo
  // lee nadie.
  const [{ data: jefatura }, { data: supervision }] = await Promise.all([
    supabase.rpc('get_logistics_chief_ids'),
    idsCargoSup.length > 0
      ? supabase.from('employees').select('id')
          .in('role_id', idsCargoSup)
          .eq('status', 'ACTIVO')
          .eq('tipo_ficha', 'empleado')
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const destinatarios = [...new Set([
    ...((jefatura ?? []) as string[]),
    ...((supervision ?? []) as any[]).map((e) => String(e.id)),
  ])];
  if (destinatarios.length === 0) {
    console.warn('[fuera-de-catalogo] sin destinatarios activos.');
    return { fuera: fuera.length, con_existencia: todosConExistencia.length, avisados: 0, callados, motivo: 'sin_destinatarios' };
  }

  const pushUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`;
  let avisados = 0;

  for (const p of nuevos) {
    const acc    = porProducto.get(Number(p.id))!;
    const salas  = acc.salas.size;
    const title  = `${p.nombre} salió del catálogo y todavía hay existencia`;
    // El aviso dice lo que hay que hacer, no sólo lo que pasó. Y no nombra de
    // dónde salió el dato: la pantalla habla del portal.
    const message =
      `${p.nombre} dejó de aparecer en el catálogo, pero ${salas === 1 ? 'una sala tiene' : `${salas} salas tienen`} `
      + `${acc.unidades} unidad${acc.unidades === 1 ? '' : 'es'} en existencia. `
      + `Hay que decidir qué se hace con lo que queda antes de que el producto deje de poder moverse.`;

    try {
      await fetch(pushUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('ADMIN_INVOKE_SECRET') ?? ''}`,
          'x-cron-secret': Deno.env.get('CRON_INVOKE_SECRET') ?? '',
        },
        body: JSON.stringify({
          title, message, url: '/inventario', urgent: false,
          target_type: 'EMPLOYEE', target_value: destinatarios,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      console.error('[fuera-de-catalogo] push:', err);
    }

    const { error: annErr } = await supabase.from('announcements').insert({
      title, message,
      target_type: 'EMPLOYEE', target_value: destinatarios,
      read_by: [], is_archived: false, created_by: null, priority: 'NORMAL',
      metadata: {
        type: 'PRODUCTO_FUERA_DE_CATALOGO',
        product_id: Number(p.id),
        nombre: p.nombre,
        unidades: acc.unidades,
        salas: [...acc.salas],
        url: '/inventario',
      },
    });
    // El anuncio ES la marca de «ya se avisó». Si no entra, el push salió y la
    // próxima corrida volvería a mandarlo: se dice en el log en vez de contarlo
    // como avisado.
    if (annErr) console.error('[fuera-de-catalogo] anuncio:', annErr.message);
    else avisados++;
  }

  return { fuera: fuera.length, con_existencia: todosConExistencia.length, avisados, callados };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
    // Vía RPC condicional: 356 filas acumulaban 442,903 updates porque el payload
    // traía updated_at y las reescribía enteras cada 10 min. `ubicacion` y
    // `ocultar_en_minmax` son del portal y el RPC no las toca.
    const labRows = [...labMap.entries()].map(([id, nombre]) => ({ id, nombre }));
    const { error: labErr } = await supabase.rpc('sync_laboratorios_batch', { p_rows: labRows });
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
            id:   pres.id_presentacion,
            tipo: pres.tipo?.trim() ?? null,
          });
        }
      }
    }
    // Igual que laboratorios: 232 filas con 289,072 updates acumulados.
    const { error: presErr } = await supabase.rpc('sync_presentaciones_batch', { p_rows: [...presMap.values()] });
    if (presErr) throw new Error(`Presentaciones upsert: ${presErr.message}`);

    // 4. Build product rows
    // Activo = la bandera del producto Y al menos una presentación activa.
    //
    // Hasta el 2026-08-28 la bandera del producto se descartaba: bastaba una
    // presentación activa. La mitad de esa regla es correcta —un producto con
    // TODAS sus presentaciones de baja no se puede vender aunque su bandera diga
    // que sí— pero al descartar la bandera el portal daba por activos productos
    // que el catálogo tiene dados de baja. **Y para el inventario esa bandera SÍ
    // manda**: la pantalla de ingreso no los reconoce, contesta «el codigo
    // ingresado no pertenece a ningun producto», y el movimiento falla recién al
    // aprobarlo — con el formulario llenado y la solicitud en la cola de alguien.
    // Reportado el 2026-08-28 con PREDNICORT 15 JARABE X 60 ML (2909), que viene
    // `activo: false` con su única presentación FRASCO activa.
    //
    // Medido sobre el catálogo entero antes de cambiarlo: de 5,214 productos,
    // **13 pasan de activo a inactivo y ninguno al revés** — dos de ellos con
    // «(INACTIVO)» escrito en el propio nombre. Los 13 tienen existencia CERO en
    // las siete salas y CERO ventas en 90 días; la última venta de cualquiera de
    // ellos fue el 26-may-2026. O sea que no desaparece nada que se esté usando.
    const productRowsRaw = productos.map((p: any) => {
      const pres: any[] = p.presentaciones ?? [];
      const activo = (p.activo ?? true) && (pres.length > 0
        ? pres.some((pr: any) => pr.activo !== false)
        : true);
      return {
        id:             p.id,
        nombre:         p.nombre,
        codigo_barras:  p.codigo_barras ?? null,
        laboratorio_id: p.laboratorio?.id ?? null,
        es_antibiotico: p.es_antibiotico ?? false,
        activo,
        perecedero:     p.perecedero ?? false,
        // Si el producto lleva control de lote. Sin este dato el portal no puede
        // exigir el número de lote al cargar, y una carga sin lote la rechaza el
        // sistema — recién al aprobarla, cuando ya nadie la corrige.
        //
        // Se pidió al proveedor y llegó el 2026-08-12 como `es_regulado`.
        // Verificado antes de confiarle la columna: coincide con las 160
        // mediciones que se le habían hecho a las pantallas del sistema una por
        // una, 160 de 160, y resuelve además los 3 que allá no se pudieron leer.
        //
        // `?? null` y no `?? false`: si el campo dejara de venir, «no se sabe»
        // es la respuesta honesta. Con `false` el portal dejaría de pedir el
        // lote y volveríamos al bug — un dato ausente no es un dato negativo.
        regulado:       typeof p.es_regulado === 'boolean' ? p.es_regulado : null,
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
        .select('id, nombre, laboratorio_id, activo, regulado')
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
      // Que un producto se dé de baja SÍ se anota (2026-08-28). Antes iba como
      // `_activoOnly`, o sea que disparaba el upsert y quedaba fuera del
      // historial: el producto desaparecía del portal y no había dónde ver
      // cuándo ni que hubiera pasado. `products.updated_at` no sirve para eso —
      // lo mueve cualquiera de los otros campos, así que dice «algo cambió» y no
      // qué.
      //
      // Los valores se guardan YA LEGIBLES, no como `true`/`false`: la pantalla
      // de Productos imprime `campo`, `valor_anterior` y `valor_nuevo` crudos,
      // sin mapa de rótulos. Escribirlos acá es la única forma de que el
      // renglón se lea como una frase y no como el volcado de una columna — y
      // de que no haya un rótulo en otro archivo que alguien tenga que acordarse
      // de agregar.
      if ((ep.activo ?? true) !== (np.activo ?? true)) {
        productChangelogs.push({
          product_id:     np.id,
          campo:          'disponibilidad',
          valor_anterior: (ep.activo ?? true) ? 'Disponible' : 'Dado de baja',
          valor_nuevo:    (np.activo ?? true) ? 'Disponible' : 'Dado de baja',
          detected_at:    now,
        });
      }
      // Lo mismo para el control de lote: sólo se escriben las filas marcadas
      // como cambiadas, así que sin esta comparación un producto al que le
      // ponen o le quitan el control de lote NO se actualizaría nunca —
      // cambiaría `es_regulado` y ninguno de los otros tres campos, y la fila
      // quedaría fuera del upsert. `!==` sobre `null|true|false` distingue los
      // tres estados, que es justo lo que hace falta acá.
      if ((ep.regulado ?? null) !== (np.regulado ?? null)) {
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

    // El producto que DEJÓ DE VENIR en el catálogo — ver `avisarFueraDeCatalogo`.
    // Va después del upsert a propósito: se compara contra el padrón que acaba
    // de quedar al día, no contra el de hace un momento. Y nunca tumba el sync:
    // si algo de esto falla, lo dice en el log y devuelve su motivo — un aviso
    // que no se pudo mandar no puede costar la sincronización del catálogo.
    let fueraDeCatalogo: Record<string, unknown> = { fuera: 0, con_existencia: 0, avisados: 0 };
    try {
      fueraDeCatalogo = await avisarFueraDeCatalogo(supabase, productos, existingProductsAll);
    } catch (err) {
      console.error('[fuera-de-catalogo] no se pudo revisar:', err);
      fueraDeCatalogo = { fuera: 0, con_existencia: 0, avisados: 0, motivo: 'excepcion' };
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
        });
      }
    }
    const precioRows = [...precioRowsMap.values()];

    // 5a. Upsert condicional vía RPC: solo escribe filas cuyo dato cambió
    // (antes se reescribían las ~8K filas cada 10 min solo por updated_at —
    // 32.7M updates acumulados). updated_at lo pone el RPC solo en cambios reales.
    const { error: preciosErr } = await supabase
      .rpc('upsert_product_precios_batch', { p_rows: precioRows });
    if (preciosErr) upsertErrors.push(`precios(rpc): ${preciosErr.message}`);

    // 5b. Deactivate presentations the ERP no longer includes — batch by product_id chunks
    // to avoid loading all 7k+ rows into memory at once.
    const erpComboSet   = new Set(precioRows.map((r: any) => `${r.product_id}_${r.id_presentacion}`));
    const erpProductIds = [...new Set(precioRows.map((r: any) => r.product_id as number))];
    let deactivatedCount = 0;

    for (let i = 0; i < erpProductIds.length; i += CHUNK) {
      const batchIds = erpProductIds.slice(i, i + CHUNK);
      const { data: activeCombos, error: activeErr } = await supabase
        .from('product_precios')
        .select('id, product_id, id_presentacion')
        .in('product_id', batchIds)
        .eq('activo', true);
      // Un error deja el lote sin nada que desactivar y el contador en cero:
      // presentaciones muertas siguen vivas y el resumen dice que todo salió bien.
      if (activeErr) throw new Error(`product_precios activos (lote ${i}): ${activeErr.message}`);

      // Recolectar los ids a desactivar y hacer UN solo UPDATE en lote
      // (antes era un UPDATE por combo → N+1).
      const idsToDeactivate = (activeCombos || [])
        .filter((c: any) => !erpComboSet.has(`${c.product_id}_${c.id_presentacion}`))
        .map((c: any) => c.id);

      if (idsToDeactivate.length > 0) {
        const { error } = await supabase.from('product_precios')
          .update({ activo: false })
          .in('id', idsToDeactivate);
        if (error) upsertErrors.push(`deactivate[batch ${i}]: ${error.message}`);
        else deactivatedCount += idsToDeactivate.length;
      }
    }

    const syncSuccess = upsertErrors.length === 0;
    await supabase.from('products_sync_log').insert({
      success:          syncSuccess,
      error_msg:        syncSuccess ? null : upsertErrors.join('; ').slice(0, 2000),
      products_written: productRowsToUpsert.length,
      product_changes:  realProductChangelogs.length,
    });

    return new Response(
      JSON.stringify({
        success:          syncSuccess,
        laboratorios:     labRows.length,
        presentaciones:   presMap.size,
        products_total:   productRows.length,
        products_written: productRowsToUpsert.length,
        product_changes:  realProductChangelogs.length,
        precios_total:    precioRows.length,
        deactivated:      deactivatedCount,
        // Lo que dejó de venir en el catálogo va en la respuesta y no sólo en el
        // log: es la única forma de mirar el estado de este control sin buscar
        // en los registros de una corrida vieja.
        fuera_de_catalogo: fueraDeCatalogo,
        errors:           upsertErrors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await supabase.from('products_sync_log').insert({
        success: false,
        error_msg: String(err.message ?? err).slice(0, 2000),
      });
    } catch { /* logging no debe tapar el error original */ }

    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
