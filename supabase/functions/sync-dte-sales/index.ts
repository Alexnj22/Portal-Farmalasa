import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, getErpBranchMap, getErpInvMap, requireInvokeSecret } from "../_shared/security.ts";
import { selectAllByIn } from "../_shared/db.ts";

// ERP credentials are loaded from Supabase Secret ERP_BRANCH_MAP and ERP_INV_BRANCH_MAP (JSON arrays).
// Never hardcode credentials here — set the secrets in the Supabase Dashboard → Edge Functions → Secrets.

const LOGIN_URL = "https://clientesdte3.oss.com.sv/farma_salud/login.php";
const DTE_BASE  = "https://clientesdte3.oss.com.sv/farma_salud/descarga_dte_emitidos_json.php";
const INV_BASE  = "https://clientesdte3.oss.com.sv/farma_salud/reporte_inventario_json.php";

/**
 * La huella de un inventario: qué hay, en qué cantidad y con qué nombre.
 *
 * Cubre exactamente lo que decide si `sync_inventory_batch` escribe algo —el
 * conjunto de `sync_key` y los tres campos que compara— y nada más. Ordenada,
 * porque el orden en que el sistema entrega sus filas no es estable.
 */
async function huellaDelInventario(productIds: number[], filas: { sync_key: string; cantidad: number; descripcion: string | null; presentacion: string | null }[]): Promise<string> {
  const texto = [...productIds].sort((a, b) => a - b).join(',') + '\n'
    + filas
      .map((r) => `${r.sync_key}|${r.cantidad}|${r.descripcion ?? ''}|${r.presentacion ?? ''}`)
      .sort()
      .join('\n');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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

// Caché de cookie por-invocación, keyed por credenciales. Evita re-login por cada
// sucursal cuando comparten el mismo usuario ERP. El Map se crea por request, así
// que no hay riesgo de cookie vieja entre corridas ni carreras entre invocaciones.
async function getCachedCookie(cache: Map<string, string>, username: string, password: string): Promise<string> {
  const key = `${username}|${password}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cookie = await withRetry(() => getSessionCookie(username, password));
  cache.set(key, cookie);
  return cookie;
}

const REIMPRIMIR = "https://clientesdte3.oss.com.sv/farma_salud/reimprimir_factura.php";

/**
 * A qué cliente pertenece una factura, según el ERP.
 *
 * El JSON de ventas manda el nombre del cliente pero no su id, así que el
 * portal ligaba por nombre — y el nombre es como se escribió en la factura.
 * Esta pantalla sí lo trae, en el `<option selected>` del combo de clientes.
 * Mismo parseo que `aplicar-solicitud-facturacion`.
 *
 * Devuelve null si no se puede leer, y el llamador degrada a ligar por nombre.
 * Timeout corto a propósito: esto corre dentro del sync de cada minuto y no
 * puede colgarlo — más vale un duplicado que un sync que no termina.
 */
async function resolverIdCliente(cookie: string, erpInvoiceId: string): Promise<string | null> {
  const res = await fetch(`${REIMPRIMIR}?id_factura=${encodeURIComponent(erpInvoiceId)}`, {
    headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  return html.match(/id="id_cliente"[\s\S]*?<option value='(\d+)'\s+selected>/)?.[1] ?? null;
}

function parseTipoDoc(correlativo: string): string {
  if (!correlativo) return 'UNKNOWN';
  const parts = correlativo.split('_');
  return parts[parts.length - 1] || 'UNKNOWN';
}

function numEq(a: any, b: any): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(parseFloat(a) - parseFloat(b)) < 0.005;
}

// El sello de recepción de Hacienda son exactamente 40 caracteres.
//
// `venta.recibido_mh ?? …` NO alcanza: el `??` atrapa el valor `undefined`, pero
// no la **cadena** "undefined", que es truthy y pasaba derecho. Llegaron 23 así
// a producción (más una cadena vacía), y como no eran NULL el módulo de
// Facturación las clasificaba como confirmadas por Hacienda en vez de
// pendientes. Se destapó cuadrando contra el libro IVA del ERP (2026-07-31).
//
// Guardar NULL ante cualquier cosa que no sea un sello es lo correcto: la
// factura cae en pendientes, que es donde alguien la mira.
const SELLO_MH_LARGO = 40;

function selloValido(v: unknown): string | null {
  return typeof v === 'string' && v.length === SELLO_MH_LARGO ? v : null;
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
  cookieCache: Map<string, string>,
): Promise<{ total: number; new: number; changes: number; items: number; idMin: number | null; idMax: number | null }> {

  // 1. Login (cacheado por credenciales) + fetch con reintentos
  const cookie = await getCachedCookie(cookieCache, username, password);

  const url = `${DTE_BASE}?fini=${startDate}&ffin=${endDate}&id_sucursal=${erpId}`;
  const res = await withRetry(() => fetch(url, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(30_000),
  }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }));

  const payload = await res.json();
  const ventas: any[] = payload?.ventas ?? [];
  if (ventas.length === 0) return { total: 0, new: 0, changes: 0, items: 0, idMin: null, idMax: null };

  // 2. Fetch facturas existentes — incluye todos los campos comparables
  const erpInvoiceIds = ventas.map(v => String(v.id_factura)).filter(Boolean);

  // Paginado: PostgREST corta en 1000 filas; en rangos amplios eso dejaba el mapa
  // incompleto y re-procesaba facturas como "nuevas" (changelogs falsos).
  // `subtotal`/`iva`/`retencion` entran a la comparación desde el 2026-08-03: el
  // origen empezó a mandar la retención de IVA y, con ella, la base gravada y el
  // débito REALES. Antes repartía el total NETO entre los dos, así que en un
  // documento con retención el libro de contribuyentes salía con la base y el
  // débito por debajo (verificado contra el propio libro del origen: CCF 323659,
  // 356.60/46.36 guardado contra 359.79/46.77). Sin estos tres campos acá, una
  // fila vieja nunca se corregiría sola: `total` no cambió.
  const existingRaw = await selectAllByIn<any>(
    supabase, 'sales_invoices',
    'id, erp_invoice_id, estado, tipo_pago, recibido_mh, cliente, subtotal, iva, retencion, total, customer_id',
    'erp_invoice_id', erpInvoiceIds,
  );

  const existingMap = new Map(
    (existingRaw ?? []).map((inv: any) => [String(inv.erp_invoice_id), inv])
  );

  // Pre-poblar con IDs conocidos; se sobreescribe con nuevos tras el upsert
  const invoiceIdMap = new Map<string, number>(
    (existingRaw ?? []).map((inv: any) => [String(inv.erp_invoice_id), inv.id])
  );

  const invoicesToUpsert: any[] = [];
  const changelogs: any[] = [];
  const newErpIds     = new Set<string>();
  const productMap    = new Map<number, any>();
  // nombre del cliente → una factura suya de este lote. La factura es lo que
  // permite preguntarle al ERP a QUÉ cliente pertenece, cuando el nombre no
  // alcanza para reconocerlo. Ver `resolverIdCliente`.
  const customerNames = new Map<string, string>();

  for (const venta of ventas) {
    if (!venta.id_factura) continue;
    const erpId_s  = String(venta.id_factura);
    const tipoDoc  = parseTipoDoc(venta.correlativo);
    const existing = existingMap.get(erpId_s);
    const clienteName = venta.cliente?.trim() || null;
    const newTotal    = venta.totales?.total ?? 0;
    const newSubtotal = venta.totales?.subtotal ?? 0;
    const newIva      = venta.totales?.iva ?? 0;
    // Redondeada a centavos: el origen manda la retención como flotante
    // (`1.059999942779541`, `3.5999999046325684`) mientras que subtotal, iva y
    // total llegan con dos decimales. El DTE dice `ivaRete1: 3.6`, o sea que el
    // valor real tiene dos decimales y lo demás es basura de coma flotante.
    // Guardarla cruda ensucia la columna y hace que `sum()` devuelva
    // 179.3599987030029290 donde el dato es 179.36.
    const newRetencion = Math.round((Number(venta.totales?.retencion) || 0) * 100) / 100;

    let hasChange = false;

    if (existing) {
      if (existing.estado !== venta.estado) {
        changelogs.push({ invoice_id: existing.id, codigo_generacion: venta.codigo_generacion, branch_id: branchId, tipo_documento: tipoDoc, campo: 'estado',    valor_anterior: existing.estado,    valor_nuevo: venta.estado });
        hasChange = true;
      }
      if (existing.tipo_pago !== venta.tipo_pago) {
        changelogs.push({ invoice_id: existing.id, codigo_generacion: venta.codigo_generacion, branch_id: branchId, tipo_documento: tipoDoc, campo: 'tipo_pago', valor_anterior: existing.tipo_pago, valor_nuevo: venta.tipo_pago });
        hasChange = true;
      }
      // Ojo con el `existing`: si ya tiene basura guardada ('undefined'), el
      // viejo `!existing.recibido_mh` daba false —truthy— y el changelog del
      // sello REAL nunca se habría escrito. Por eso se valida de los dos lados.
      const selloNuevo = selloValido(venta.recibido_mh);
      if (!selloValido(existing.recibido_mh) && selloNuevo) {
        changelogs.push({ invoice_id: existing.id, codigo_generacion: venta.codigo_generacion, branch_id: branchId, tipo_documento: tipoDoc, campo: 'recibido_mh', valor_anterior: existing.recibido_mh, valor_nuevo: selloNuevo });
        hasChange = true;
      }
      if ((existing.cliente ?? null) !== clienteName) {
        changelogs.push({ invoice_id: existing.id, codigo_generacion: venta.codigo_generacion, branch_id: branchId, tipo_documento: tipoDoc, campo: 'cliente',   valor_anterior: existing.cliente,   valor_nuevo: clienteName });
        hasChange = true;
      }
      if (!numEq(existing.total, newTotal)) {
        changelogs.push({ invoice_id: existing.id, codigo_generacion: venta.codigo_generacion, branch_id: branchId, tipo_documento: tipoDoc, campo: 'total',     valor_anterior: existing.total,     valor_nuevo: String(newTotal) });
        hasChange = true;
      }
      // Los tres se mueven juntos —la base y el débito suben lo que sube la
      // retención— pero se anotan por separado: el que lea el historial tiene
      // que poder ver que la base gravada del documento cambió, no deducirlo.
      for (const [campo, viejo, nuevo] of [
        ['subtotal',  existing.subtotal,  newSubtotal],
        ['iva',       existing.iva,       newIva],
        ['retencion', existing.retencion, newRetencion],
      ] as [string, any, number][]) {
        if (!numEq(viejo, nuevo)) {
          changelogs.push({ invoice_id: existing.id, codigo_generacion: venta.codigo_generacion, branch_id: branchId, tipo_documento: tipoDoc, campo, valor_anterior: viejo == null ? null : String(viejo), valor_nuevo: String(nuevo) });
          hasChange = true;
        }
      }
      // También upsertear si falta el customer_id para linkear retroactivamente
      if (!existing.customer_id && clienteName) hasChange = true;
    } else {
      newErpIds.add(erpId_s);
    }

    // Solo agregar a clientes si la factura es nueva o aún no tiene customer_id
    if (clienteName && (!existing || !existing.customer_id)) {
      if (!customerNames.has(clienteName)) customerNames.set(clienteName, erpId_s);
    }

    // Solo agregar al upsert si hay algo que escribir
    if (!existing || hasChange) {
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
        // Validado de los dos lados: si lo que llega no es un sello y lo
        // guardado tampoco, queda NULL y la factura cae en pendientes. Eso
        // además sana sola cualquier fila con basura que el sync vuelva a tocar.
        recibido_mh:       selloValido(venta.recibido_mh) ?? selloValido(existing?.recibido_mh) ?? null,
        subtotal:          newSubtotal,
        iva:               newIva,
        // Retención de IVA del Art. 162 CT: la practica el cliente (un gran
        // contribuyente) y se descuenta del total a cobrar, así que
        // subtotal + iva - retencion = total.
        retencion:         newRetencion,
        total:             newTotal,
        updated_at:        new Date().toISOString(),
      });
    }

    for (const p of (venta.productos ?? [])) {
      if (p.id && !productMap.has(p.id))
        productMap.set(p.id, { id: p.id, nombre: p.descripcion });
    }
  }

  // 3. Productos + clientes
  // Red de seguridad: el dueño del catálogo es sync-products. Acá solo hay que
  // garantizar que la fila exista. Antes era un .upsert() con ON CONFLICT DO
  // NOTHING que sondeaba products_pkey por CADA fila del payload aunque todas
  // existieran — 26.5% del CPU de la base (65 ms × 127K llamadas). El RPC filtra
  // con un anti-join primero: 84 ms → 6 ms medidos.
  if (productMap.size > 0) {
    const { error: prodErr } = await supabase
      .rpc('insert_missing_products', { p_rows: [...productMap.values()] });
    if (prodErr) throw new Error(`insert_missing_products (ventas): ${prodErr.message}`);
  }

  const customerIdMap = new Map<string, number>();
  if (customerNames.size > 0) {
    const nombres = [...customerNames.keys()];

    // ── Los que el portal NO reconoce por nombre ────────────────────────
    // Ligar por nombre es lo que partía a un cliente en dos fichas: el nombre
    // viene de cómo se escribió la factura y cualquier letra distinta abría
    // ficha nueva (68 clientes partidos, 1,127 facturas del lado equivocado).
    // Normalizar el texto no lo arregla — medido contra esos 68, el 96% son
    // nombres genuinamente distintos (VAQUEZ/VASQUEZ, ALVARNEGA/ALVARENGA).
    //
    // Así que para los desconocidos se le pregunta al ERP a qué cliente
    // pertenece SU factura, y se liga por ese número. Son ~22 por día sobre
    // ~1,000 facturas: el resto no paga ninguna petición extra.
    const existentes = await selectAllByIn<any>(
      supabase, 'customers', 'name', 'name', nombres,
    );
    const conocidos = new Set((existentes ?? []).map((c: any) => c.name));
    const filas = nombres.map(n => ({ nombre: n, erp_id: null as string | null }));

    // Tope duro de lecturas al ERP por corrida.
    //
    // En el sync de cada minuto los desconocidos son un goteo (~22 al día
    // repartidos), pero un backfill de un mes puede traer cientos de golpe, y
    // cada uno es una petición secuencial dentro de una función que vive 150 s
    // y vuelve a arrancar al minuto siguiente. Sin tope, un backfill colgaría
    // el sync y las corridas se apilarían.
    //
    // Lo que pasa el tope NO se pierde: degrada a ligar por nombre —el
    // comportamiento de siempre— y la limpieza de duplicados lo levanta después.
    const MAX_LECTURAS_ERP = 25;
    let leidas = 0, omitidas = 0;

    for (const fila of filas) {
      if (conocidos.has(fila.nombre)) continue;
      const facturaEjemplo = customerNames.get(fila.nombre);
      if (!facturaEjemplo) continue;
      if (leidas >= MAX_LECTURAS_ERP) { omitidas++; continue; }
      leidas++;
      // Degradación deliberada: si el ERP no contesta, `erp_id` queda null y el
      // RPC hace exactamente lo de antes (crear por nombre). El peor caso es el
      // comportamiento actual — nunca una factura sin cliente.
      try {
        fila.erp_id = await resolverIdCliente(cookie, facturaEjemplo);
      } catch (e) {
        console.error(`resolverIdCliente(${facturaEjemplo}):`,
                      e instanceof Error ? e.message : String(e));
      }
    }
    // Un tope que no se anuncia se lee como "se resolvieron todos".
    if (omitidas > 0)
      console.warn(`clientes desconocidos sin resolver por tope: ${omitidas} ` +
                   `(se ligan por nombre; los levanta la limpieza de duplicados)`);

    // Sin el mapa, ninguna factura del lote queda ligada a su cliente y el
    // sync termina "bien": el hueco sólo se ve meses después.
    const { data: customerData, error: customerErr } =
      await supabase.rpc('upsert_customers_v2', { p_rows: filas });
    if (customerErr) throw new Error(`upsert_customers_v2: ${customerErr.message}`);
    for (const c of (customerData ?? [])) customerIdMap.set(c.customer_name, c.customer_id);
  }
  for (const inv of invoicesToUpsert) {
    if (inv.cliente) { const cid = customerIdMap.get(inv.cliente.trim().toUpperCase()); if (cid) inv.customer_id = cid; }
  }

  // 4. Upsert solo facturas nuevas o con cambios.
  // Troceado a 500: el .select() de retorno también está sujeto al cap de 1000
  // filas; sin trocear, en upserts grandes faltarían ids en invoiceIdMap y sus
  // items no se insertarían.
  if (invoicesToUpsert.length > 0) {
    const UP_CHUNK = 500;
    for (let i = 0; i < invoicesToUpsert.length; i += UP_CHUNK) {
      const { data: upserted, error: upsertErr } = await supabase
        .from('sales_invoices')
        .upsert(invoicesToUpsert.slice(i, i + UP_CHUNK), { onConflict: 'erp_invoice_id' })
        .select('id, erp_invoice_id');
      if (upsertErr) throw upsertErr;
      for (const inv of (upserted ?? [])) {
        invoiceIdMap.set(String(inv.erp_invoice_id), inv.id);
      }
    }
  }

  // 5. Items
  const itemsToInsert: any[] = [];
  const invoicesWithPuntos = new Set<number>();
  for (const venta of ventas) {
    const erpId_s = String(venta.id_factura);
    const isNew   = newErpIds.has(erpId_s);
    if (!isNew && !forceItems) continue;
    const invoiceId = invoiceIdMap.get(erpId_s);
    if (!invoiceId || !(venta.productos ?? []).length) continue;
    for (let lineIdx = 0; lineIdx < venta.productos.length; lineIdx++) {
      const p = venta.productos[lineIdx];
      if (p.id === 0) invoicesWithPuntos.add(invoiceId);
      itemsToInsert.push({
        invoice_id:        invoiceId,
        linea_num:         lineIdx,
        erp_product_id:    p.id ?? null,
        descripcion:       p.descripcion,
        cantidad:          p.cantidad,
        presentacion:      p.presentacion,
        // id_presentacion es legacy: presentaciones.descripcion se eliminó el
        // 2026-06-08 y el lookup quedó vacío desde entonces (todas las filas NULL).
        // El match de presentación se hace por texto contra product_precios.
        id_presentacion:   null,
        precio_unitario:   p.precio_unitario,
        total_linea:       p.total_linea,
        lote:              p.lote || null,
        fecha_vencimiento: (p.fecha_vencimiento && p.fecha_vencimiento !== '0000-00-00') ? p.fecha_vencimiento : null,
      });
    }
  }

  if (itemsToInsert.length > 0) {
    if (forceItems) {
      // forceItems: borrar y reinsertar limpio desde el ERP.
      //
      // El error NO se puede descartar acá. Éste es el camino de REPARACIÓN de
      // una factura mal cargada, y el upsert que sigue lleva
      // `ignoreDuplicates: true`: si el DELETE falla en silencio, los renglones
      // viejos sobreviven, los nuevos se saltan por duplicado y la reparación
      // "corre bien" sin haber reparado nada. Un renglón fiscal equivocado que
      // se da por corregido es peor que uno que se sabe roto.
      const invoiceIds = [...new Set(itemsToInsert.map(i => i.invoice_id))];
      const { error: delItemsErr } = await supabase
        .from('sales_invoice_items').delete().in('invoice_id', invoiceIds);
      if (delItemsErr) throw new Error(`forceItems delete: ${delItemsErr.message}`);
    }
    const CHUNK = 500;
    for (let i = 0; i < itemsToInsert.length; i += CHUNK) {
      // upsert con ignoreDuplicates: si (invoice_id, linea_num) ya existe → skip
      // Esto hace imposible insertar duplicados incluso con runs concurrentes
      const { error: insertErr } = await supabase
        .from('sales_invoice_items')
        .upsert(itemsToInsert.slice(i, i + CHUNK), {
          onConflict: 'invoice_id,linea_num',
          ignoreDuplicates: true,
        });
      if (insertErr) throw new Error(`items upsert chunk ${i}: ${insertErr.message}`);
    }
    if (invoicesWithPuntos.size > 0) {
      await supabase.from('sales_invoices')
        .update({ has_puntos: true })
        .in('id', [...invoicesWithPuntos]);
    }
  }

  // 6. Changelogs
  // El error de este insert NO se descarta.
  //
  // Se tragó en silencio el historial de toda factura sin `codigo_generacion`
  // —la columna era NOT NULL hasta el 2026-08-21— y, como va en un solo lote,
  // con ella se caían TODOS los cambios de esa sala en ese minuto. Así se perdió
  // el «FINALIZADA → NULA» de 0000061286_COF (La Popular, 21-ago) y con él la
  // única prueba de cuándo se anuló esa venta.
  //
  // No aborta la corrida: las facturas ya se escribieron y volver a bajarlas no
  // arregla el historial. Pero queda en el log, que es lo que faltaba: un cambio
  // que no se registra es indistinguible de un cambio que no pasó.
  if (changelogs.length > 0) {
    const { error: logErr } = await supabase.from('sales_invoice_changelog').insert(changelogs);
    if (logErr) console.error(`[changelog] sucursal ${branchId}: se perdieron ${changelogs.length} cambio(s) — ${logErr.message}`);
  }

  // idMin/idMax calculado sobre todas las ventas del ERP (no solo upserted)
  const allErpNums = ventas.map(v => parseInt(String(v.id_factura))).filter(n => !isNaN(n));
  const idMin = allErpNums.length ? Math.min(...allErpNums) : null;
  const idMax = allErpNums.length ? Math.max(...allErpNums) : null;

  return { total: ventas.length, new: newErpIds.size, changes: changelogs.length, items: itemsToInsert.length, idMin, idMax };
}

async function syncInventoryBranch(
  supabase: any,
  erpId: number,
  username: string,
  password: string,
  ubicacionId: number,
  isVencidos: boolean,
  cookieCache: Map<string, string>,
): Promise<{ items: number; rows: number }> {
  const cookie = await getCachedCookie(cookieCache, username, password);

  const url = `${INV_BASE}?id_ubicacion=${ubicacionId}&id_sucursal=${erpId}`;
  const res = await withRetry(() => fetch(url, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(30_000),
  }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }));

  const payload = await res.json();
  const productos: any[] = payload?.inventario ?? [];
  if (productos.length === 0) return { items: 0, rows: 0 };

  // Solo insertar productos nuevos — sync-products maneja actualizaciones completas cada 10 min.
  // Este es el camino caliente: ~5K filas por sucursal/área, cada minuto. Ver el
  // comentario de insert_missing_products en syncBranch.
  const productUpserts: any[] = productos.map(p => ({
    id:     parseInt(p.id_producto),
    nombre: p.producto,
  })).filter(p => !isNaN(p.id) && p.id > 0);

  // `insert_missing_products` se llama más abajo, junto con la escritura: si el
  // inventario vino igual que la vez anterior tampoco puede haber un producto
  // nuevo, y su lista entra en la huella justamente para asegurarlo.

  // Escritura vía RPC sync_inventory_batch (una llamada por sucursal/área):
  // solo escribe filas cuyo dato real cambió (antes se reescribían las ~24K
  // filas cada minuto solo para bumpear synced_at — 935M updates acumulados)
  // y borra las que ya no existen en el ERP por diferencia de sync_keys.
  const rows: any[] = [];

  for (const p of productos) {
    const productId = parseInt(p.id_producto);
    if (isNaN(productId)) continue;

    for (const det of (p.detalles ?? [])) {
      const rawFecha  = det.fecha_vencimiento;
      const fechaVenc = (rawFecha && rawFecha !== '0000-00-00') ? rawFecha : null;
      const pid       = productId > 0 ? productId : null;

      rows.push({
        erp_product_id:    pid,
        descripcion:       p.producto ?? null,
        presentacion:      det.presentacion ?? null,
        detalle:           det.detalle ?? null,
        lote:              det.lote ?? null,
        fecha_vencimiento: fechaVenc,
        cantidad:          parseInt(det.cantidad) || 0,
        sync_key:          `${erpId}|${isVencidos}|${pid ?? ''}|${det.lote ?? ''}|${det.detalle ?? ''}|${fechaVenc ?? ''}`,
      });
    }
  }

  // Deduplicate by sync_key (ERP occasionally returns duplicate detail rows for the
  // same product+lote+detalle combination). Sum quantities when merging.
  const rowsByKey = new Map<string, any>();
  for (const row of rows) {
    const existing = rowsByKey.get(row.sync_key);
    if (existing) {
      existing.cantidad += row.cantidad;
    } else {
      rowsByKey.set(row.sync_key, { ...row });
    }
  }
  const dedupedRows = Array.from(rowsByKey.values());

  /* ── Si el sistema devolvió lo mismo, no se toca la base ─────────────────
   *
   * La corrida sigue siendo de cada minuto: la sala necesita existencias
   * frescas y eso no se negocia. Lo que se saltea es la ESCRITURA cuando no hay
   * nada que escribir. Medido el 2026-08-20: por hora viajan 844.028 filas y
   * cambian 305 —una de cada 2.767— y cada llamada cuesta 84 ms de base y
   * 204 KB de WAL, que después Realtime relee entero.
   *
   * La huella cubre EXACTAMENTE lo que decide una escritura: el conjunto de
   * `sync_key` (de ahí salen los borrados por diferencia) y los tres campos que
   * la RPC compara para actualizar. Si eso no cambió, la RPC escribiría cero.
   *
   * Va ordenada porque el orden del sistema no es estable —quedó demostrado el
   * mismo día en las compras, donde 13 de 15 documentos volvían barajados—, y
   * una huella que cambia por el orden no serviría para nada.
   *
   * Y la lista de productos entra en la huella para que `insert_missing_products`
   * no se saltee un producto nuevo que todavía no tiene existencias. */
  const huella = await huellaDelInventario(productUpserts.map((p) => p.id), dedupedRows);

  // El error se mira, y su desenlace es SINCRONIZAR.
  //
  // Un `select` que falla en silencio dejaría `previa` en null, que acá se lee
  // como «no hay huella» — o sea que se sincroniza igual. La dirección segura ya
  // era ésa por casualidad; se hace explícita porque la casualidad no es una
  // garantía: si mañana el default fuera saltear, el mismo fallo callado dejaría
  // el inventario congelado sin que nadie se entere.
  const { data: previa, error: huellaLeeErr } = await supabase
    .from('inventory_sync_huella')
    .select('huella, verificado_at')
    .eq('erp_sucursal_id', erpId).eq('is_vencidos', isVencidos)
    .maybeSingle();
  if (huellaLeeErr)
    console.error(`huella de inventario (${erpId}/${isVencidos}) no se pudo leer, se sincroniza igual: ${huellaLeeErr.message}`);

  // La válvula: aunque la huella coincida, cada 30 minutos se escribe igual.
  // Si algún día algo más escribiera `inventory` —hoy nada lo hace—, la deriva
  // se cura sola en media hora en vez de quedarse para siempre.
  const fresca = !huellaLeeErr && previa?.verificado_at
    && (Date.now() - Date.parse(previa.verificado_at)) < 30 * 60_000;

  if (previa?.huella === huella && fresca)
    return { items: productos.length, rows: 0, sinCambios: true };

  if (productUpserts.length > 0) {
    const { error: prodErr } = await supabase
      .rpc('insert_missing_products', { p_rows: productUpserts });
    if (prodErr) throw new Error(`insert_missing_products (inventario): ${prodErr.message}`);
  }

  const { data: result, error: rpcErr } = await supabase.rpc('sync_inventory_batch', {
    p_erp_sucursal_id: erpId,
    p_is_vencidos:     isVencidos,
    p_rows:            dedupedRows,
  });
  if (rpcErr) throw new Error(`sync_inventory_batch: ${rpcErr.message}`);

  // Recién ahora: si la escritura falló, la próxima corrida la rehace.
  const { error: huellaErr } = await supabase.from('inventory_sync_huella').upsert({
    erp_sucursal_id: erpId,
    is_vencidos:     isVencidos,
    huella,
    filas:           dedupedRows.length,
    verificado_at:   new Date().toISOString(),
  }, { onConflict: 'erp_sucursal_id,is_vencidos' });
  // Que no se pueda anotar la huella no invalida el inventario que YA entró:
  // se avisa y la próxima corrida vuelve a escribir, que es lo de antes.
  if (huellaErr) console.error(`huella de inventario (${erpId}/${isVencidos}): ${huellaErr.message}`);

  return { items: productos.length, rows: result?.written ?? 0 };
}

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
    const INV_BRANCH_MAP = getErpInvMap();

    const body = await req.json().catch(() => ({}));
    const { fini, ffin, branchId: onlyBranch, forceItems = false, syncInventory = false, skipDte = false, onlyInvErpId = null, refreshMvOnly = false } = body;

    // Dedicated MV refresh call — runs on its own cron to avoid race conditions
    if (refreshMvOnly) {
      const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
      await supabase.rpc('refresh_inventory_grouped_mv');
      return new Response(JSON.stringify({ ok: true, refreshed: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().split('T')[0];
    const startDate = fini || hoy;
    const endDate   = ffin || hoy;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const results: any[] = [];
    const logRows: any[] = [];

    // Caché de cookies ERP compartido por toda la invocación (DTE + inventario)
    const cookieCache = new Map<string, string>();

    if (!skipDte) {
      const branches = onlyBranch
        ? BRANCH_MAP.filter(b => b.branchId === onlyBranch)
        : BRANCH_MAP;

      for (const { branchId, erpId, username, password } of branches) {
        let attempts = 0;
        let lastErr: string | null = null;
        let branchResult: any = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
          attempts = attempt;
          try {
            branchResult = await syncBranch(supabase, branchId, erpId, username, password, startDate, endDate, forceItems, cookieCache);
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

      /* La bitácora del sync NO se escribe a ciegas.
       *
       * `check-sync-health-alerts` y la vista `v_sync_health` leen justamente
       * `sync_log` para decidir si una sucursal dejó de sincronizar. Si este
       * insert falla en silencio, la corrida que falló no deja rastro y la
       * vigilancia se queda muda sobre el hueco que existe para vigilar — la
       * alarma no suena porque no se enteró, no porque no haya nada.
       *
       * No lanza: el sync YA hizo su trabajo y tirarlo acá perdería un
       * resultado bueno por no poder anotarlo. Se deja en el log de la función,
       * que es donde se puede ver. */
      if (logRows.length > 0) {
        const { error: logErr } = await supabase.from('sync_log').insert(logRows);
        if (logErr) console.error(`[sync-dte-sales] sync_log insert falló (${logRows.length} filas): ${logErr.message}`);
      }
    }

    // Inventory sync (optional, triggered by syncInventory=true in body)
    const invResults: any[] = [];
    if (syncInventory) {
      const INV_MAP_FILTERED = onlyInvErpId != null
        ? INV_BRANCH_MAP.filter((b: any) => Number(b.erpId) === Number(onlyInvErpId))
        : INV_BRANCH_MAP;

      // Ubicaciones por sucursal desde BD (erp_sucursal_map.inv_ubicaciones):
      // ahí es editable sin tocar el secret (que solo aporta credenciales).
      // Bodega usa [{id:1,regular},{id:2,vencidos}] — la ubicación 0 del ERP
      // mezcla el área de vencidos dentro del inventario regular.
      const { data: ubicRows, error: ubicErr } = await supabase
        .from('erp_sucursal_map')
        .select('erp_sucursal_id, inv_ubicaciones');
      // Con el Map vacío cada sucursal cae a su ubicación por defecto: Bodega
      // mezclaría vencidos dentro del inventario regular sin avisar.
      if (ubicErr) throw new Error(`erp_sucursal_map(inv_ubicaciones): ${ubicErr.message}`);
      const ubicByErpId = new Map<number, any>(
        (ubicRows ?? []).map((r: any) => [Number(r.erp_sucursal_id), r.inv_ubicaciones])
      );

      for (const { erpId: invErpId, username, password, ubicaciones: rawUbicaciones } of INV_MAP_FILTERED) {
        // Prioridad: BD → secret → [{id:0, isVencidos:false}]
        const dbUbicaciones = ubicByErpId.get(Number(invErpId));
        const ubicaciones = (Array.isArray(dbUbicaciones) && dbUbicaciones.length > 0)
          ? dbUbicaciones
          : (Array.isArray(rawUbicaciones) && rawUbicaciones.length > 0)
            ? rawUbicaciones
            : [{ id: 0, isVencidos: false }];
        for (const { id: ubicacionId, isVencidos } of ubicaciones) {
          try {
            const result = await syncInventoryBranch(supabase, invErpId, username, password, ubicacionId, isVencidos, cookieCache);
            invResults.push({ erpId: invErpId, ubicacionId, isVencidos, ...result });
            await supabase.from('inventory_sync_log').insert({
              erp_sucursal_id: invErpId,
              is_vencidos:     isVencidos,
              items_count:     result.items,
              rows_upserted:   result.rows,
              success:         true,
            });
          } catch (e: any) {
            invResults.push({ erpId: invErpId, ubicacionId, isVencidos, error: e.message });
            await supabase.from('inventory_sync_log').insert({
              erp_sucursal_id: invErpId,
              is_vencidos:     isVencidos,
              items_count:     0,
              rows_upserted:   0,
              success:         false,
              error_msg:       e.message,
            });
          }
        }
      }

      // MV refresh is handled by a dedicated cron (refresh-inv-mv) to avoid
      // race conditions when multiple per-sucursal syncs run simultaneously.
    }

    return new Response(
      JSON.stringify({ success: true, range: { startDate, endDate }, results, ...(syncInventory && { inventory: invResults }) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
