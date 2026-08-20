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

// Bodega concentra la mayoría de las compras pero NO todas: en junio 2026 las
// otras cinco sucursales sumaron 54 documentos y $5,949.85 que este sync no
// veía, porque el par (30, 6) estaba escrito a mano y era el único que corría.
// Eso las dejaba fuera del libro de compras.
//
// Las seis sucursales que venden salen de ERP_BRANCH_MAP —la misma fuente que
// usa sync-dte-sales, así que abrir una sucursal se resuelve en un solo lugar—.
// Bodega no está ahí porque no vende, y por eso es el único par que queda
// explícito acá.
const BODEGA_BRANCH_ID = 30;
const BODEGA_ERP_ID    = 6;

function getPurchaseBranches(): { branchId: number; erpId: number }[] {
  const ventas = getErpBranchMap().map(b => ({ branchId: b.branchId, erpId: b.erpId }));
  const todas  = [{ branchId: BODEGA_BRANCH_ID, erpId: BODEGA_ERP_ID }, ...ventas];
  // Dedup por si algún día Bodega entra al mapa de ventas: repetirla haría dos
  // pasadas sobre la misma sucursal y duplicaría las filas del log.
  const vistas = new Set<number>();
  return todas.filter(b => !vistas.has(b.branchId) && vistas.add(b.branchId));
}

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
      supplierMap.set(erpSupplierId, { erp_supplier_id: erpSupplierId, nombre: provNombre, nrc: provNrc });

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
      // Los cuatro campos del libro de compras (Art. 86 RCT). El ERP los manda
      // desde siempre; el mapeo los tiraba, y sin ellos la fila sirve para saber
      // cuánto se compró pero no para declarar. `?? null` y no `?? 0`: NULL
      // significa "el ERP no lo informó", 0 significa "informó cero" — en un
      // libro fiscal no es lo mismo.
      documento_tipo:   c.documento?.tipo   ?? null,
      documento_numero: (c.documento?.numero ?? '').trim() || null,
      percepcion_iva:   c.totales?.percepcion_iva ?? null,
      retencion_iva:    c.totales?.retencion_iva  ?? null,
      // `updated_at` NO viaja en el payload: lo pone la RPC, y sólo cuando
      // escribe de verdad. Mandarlo desde acá era lo que hacía que TODA fila
      // «cambiara» en cada corrida — 14 reescrituras por corrida, 144 veces al
      // día, para no cambiar un dato (medido el 2026-08-20).
    };

    receiptsToUpsert.push(row);
    if (!existingMap.has(erpPurchaseId)) newErpIds.add(erpPurchaseId);

    for (const p of (c.items ?? c.productos ?? c.detalle ?? [])) {
      const pid = p.producto_id ?? p.id ?? p.id_producto;
      if (pid && !productMap.has(Number(pid)))
        productMap.set(Number(pid), { id: Number(pid), nombre: p.nombre ?? p.descripcion });
    }
  }

  // 3a. Upsert proveedores — vía RPC, solo escribe si nombre/nrc cambiaron
  // (antes reescribía las 78 filas en cada corrida por el updated_at del payload).
  // El mapa erp_supplier_id→id se sigue leyendo en un SELECT aparte a propósito:
  // dentro de un mismo statement los CTE ven el snapshot previo, así que un
  // proveedor recién insertado no aparecería en el RETURNING.
  const erpSupplierToId = new Map<number, number>();
  if (supplierMap.size > 0) {
    const { error: suppErr } = await supabase
      .rpc('sync_suppliers_batch', { p_rows: [...supplierMap.values()] });
    if (suppErr) throw new Error(`sync_suppliers_batch: ${suppErr.message}`);

    const { data: suppRows, error: suppSelErr } = await supabase
      .from('suppliers').select('id, erp_supplier_id').in('erp_supplier_id', [...supplierMap.keys()]);
    if (suppSelErr) throw new Error(`suppliers select: ${suppSelErr.message}`);
    for (const s of (suppRows ?? [])) erpSupplierToId.set(s.erp_supplier_id, s.id);
    for (const row of receiptsToUpsert) {
      if (row.erp_supplier_id) row.supplier_id = erpSupplierToId.get(row.erp_supplier_id) ?? null;
    }
  }

  // 3b. Upsert productos — sigue actualizando nombre si cambió en el ERP, pero
  // solo escribe la fila cuando cambió de verdad.
  if (productMap.size > 0) {
    const { error: prodErr } = await supabase
      .rpc('upsert_products_minimal', { p_rows: [...productMap.values()] });
    if (prodErr) throw new Error(`upsert_products_minimal: ${prodErr.message}`);
  }

  // 4. Upsert cabeceras
  let totalItems = 0;
  // Vía RPC, igual que proveedores, productos y renglones: sólo escribe la
  // cabecera cuyo dato real cambió.
  //
  // ⚠️ Y por eso el mapa de ids YA NO puede salir del `RETURNING`: una escritura
  // condicional no devuelve lo que no escribió, así que las cabeceras sin cambios
  // faltarían y sus renglones se quedarían sin `receipt_id` — se saltearían en
  // silencio, que es el peor desenlace posible acá. Las que ya existían vinieron
  // en la consulta del principio; sólo hay que ir a buscar las que ACABAN de
  // nacer, y eso pasa 12 veces al día en vez de 500.
  if (receiptsToUpsert.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < receiptsToUpsert.length; i += CHUNK) {
      const { error } = await supabase
        .rpc('sync_purchase_receipts_batch', { p_rows: receiptsToUpsert.slice(i, i + CHUNK) });
      if (error) throw new Error(`receipts upsert chunk ${i}: ${error.message}`);
    }
    if (newErpIds.size > 0) {
      const nacidas = await selectAllByIn<any>(
        supabase, 'purchase_receipts', 'id, erp_purchase_id',
        'erp_purchase_id', [...newErpIds],
        (q) => q.eq('erp_sucursal_id', erpId),
      );
      for (const r of (nacidas ?? [])) existingMap.set(r.erp_purchase_id, r.id);
    }
  }

  // 5. Items — upsert para todas las recepciones (nuevas y modificadas)
  const itemsToUpsert: any[] = [];
  for (const c of compras) {
    const erpPurchaseId = Number(c.compra_id ?? c.id_compra ?? c.id_factura ?? c.id_orden ?? c.id);
    const receiptId = existingMap.get(erpPurchaseId);
    if (!receiptId) continue;

    /* ── El orden de los renglones lo pone el portal, no el sistema ─────────
     *
     * `linea_num` es la posición en la lista, y **la lista viene barajada**:
     * medido el 2026-08-20 leyendo el mismo rango dos veces seguidas, **13 de
     * 15 compras volvieron con sus renglones en otro orden**. La compra 5619
     * devolvió `4356, 4959` y después `4959, 4356`.
     *
     * Con la posición como número, el renglón 0 es otro producto en cada
     * lectura, así que TODAS las filas «cambian» y se reescriben — 68 de 160
     * cada 10 minutos, con 0% HOT, o sea rehaciendo también los índices. Ningún
     * arreglo de la comparación puede con eso: los datos de verdad son otros.
     *
     * Se ordena por lo que identifica al renglón y no por cómo vino. El orden
     * que se pierde no era información: era el azar de esa lectura. */
    const claveDeOrden = (p: any) => [
      String(p.producto_id ?? p.id ?? p.id_producto ?? '').padStart(10, '0'),
      String((p.trazabilidad?.lote ?? p.lote) ?? ''),
      String(p.trazabilidad?.fecha_vencimiento ?? p.fecha_vencimiento ?? p.vencimiento ?? ''),
      String(p.cantidad ?? ''),
      String(p.precios?.subtotal_linea ?? p.total_linea ?? p.total ?? ''),
    ].join('\u0000');
    const lines = [...(c.items ?? c.productos ?? c.detalle ?? [])]
      .sort((a: any, b: any) => claveDeOrden(a).localeCompare(claveDeOrden(b)));
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

  // Vía RPC: solo escribe las líneas cuyo dato real cambió. Era el peor caso de
  // amplificación de escritura de la base — 185,228 updates sobre 35,840 filas
  // con apenas 29.7% HOT, o sea el 71% reescribía también los índices, aunque el
  // ERP no hubiera tocado una sola línea del rango sincronizado.
  if (itemsToUpsert.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < itemsToUpsert.length; i += CHUNK) {
      const { error } = await supabase
        .rpc('sync_purchase_receipt_items_batch', { p_rows: itemsToUpsert.slice(i, i + CHUNK) });
      if (error) throw new Error(`items upsert chunk ${i}: ${error.message}`);
    }
    totalItems = itemsToUpsert.length;
  }

  return { total: compras.length, new: newErpIds.size, items: totalItems };
}

// ── Backfill rápido de los campos del libro ──────────────────────────────────
// `descargar_compras_json.php` tarda **167s en un mes de Bodega** porque manda
// cada compra con TODAS sus líneas: 0.9 MB para rescatar cuatro datos de
// cabecera. Para un backfill —donde las líneas ya están sincronizadas— es pagar
// el detalle entero por nada.
//
// El ERP tiene una puerta mucho más barata, la que alimenta la tabla de "Admin
// Compras": `admin_compras_fecha_dt.php` devuelve id_compra, tipo y número sin
// una sola línea de detalle. **Medido: el mismo mes en 6.1s contra 167s — 27×.**
// La percepción no está ahí, pero sí en el CSV del libro, que también baja en
// segundos. Los dos meses completos (749 documentos): 19.6s.
//
// Tres cosas que salieron de medirlo y no de suponerlo:
//
// 1. **La sucursal es estado de sesión** en estos dos endpoints, no parámetro
//    (al revés que `descargar_compras_json.php`, que sí acepta `id_sucursal`).
// 2. **El número viene con espacios distintos en cada fuente**: la tabla da
//    `'72B6EEA1-727E-ACD2- '` y el CSV `'72B6EEA1-727E-ACD2-'`. Sin normalizar,
//    40 de 749 no cruzaban.
// 3. **El número truncado a 20 no siempre es único**: dos casos en junio-julio
//    con percepciones distintas. Para esos —y solo para esos— se cae al JSON
//    pesado del día, que es la fuente autoritativa. Un cruce ambiguo en un libro
//    fiscal no se resuelve eligiendo uno.

const ADMIN_DT_URL = "https://clientesdte3.oss.com.sv/farma_salud/admin_compras_fecha_dt.php";
const LIBRO_CSV    = "https://clientesdte3.oss.com.sv/farma_salud/libro_compras_iva_csv.php";
const RETEN_CSV    = "https://clientesdte3.oss.com.sv/farma_salud/libro_retencion_iva_csv.php";
const SESION_URL   = "https://clientesdte3.oss.com.sv/farma_salud/cambio_sesion.php";

const normNum = (s: string) => (s ?? '').replace(/\s+/g, '').toUpperCase();

async function traer(url: string, cookie: string, ms = 60_000): Promise<string> {
  const res = await withRetry(() => fetch(url, {
    headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' },
    signal: AbortSignal.timeout(ms),
  }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`); return r; }));
  return await res.text();
}

// El sello de recepción de Hacienda son exactamente 40 caracteres alfanuméricos.
//
// H19: la columna del origen viene CONTAMINADA — de 331 sellos, 6 no miden 40:
// un código de generación (36), uno con un espacio adentro (41) y tres con texto
// pegado a mano (`…FFEFGbenicar`, `…RVBD C-2274298`). Un sello con `benicar`
// atrás no es un sello, y guardarlo sería peor que no tenerlo: el día que se use
// para cruzar documentos, cruzaría mal en silencio.
function selloValido(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[0-9A-Za-z]{40}$/.test(s) ? s : null;
}

// Devuelve numeroNormalizado → conjunto de valores distintos de la columna. El
// conjunto y no el valor: si trae más de uno, ese número es ambiguo.
function columnaPorNumero(csv: string, colNumero: number, colValor: number): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const linea of csv.split('\n')) {
    if (!linea.trim()) continue;
    const c = linea.split(';');
    if (c.length <= Math.max(colNumero, colValor)) continue;
    const k = normNum(c[colNumero]);
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add((c[colValor] ?? '0').trim() || '0');
  }
  return m;
}

async function fastBackfill(
  supabase: any, branchId: number, erpId: number,
  username: string, password: string, startDate: string, endDate: string,
): Promise<{ documentos: number; actualizados: number; ambiguos: number }> {

  const cookie = await withRetry(() => getSessionCookie(username, password));

  // La sucursal es estado de sesión en estos endpoints — sin esto se traería la
  // sucursal por defecto del usuario y se guardaría como si fuera esta.
  await withRetry(() => fetch(SESION_URL, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ process: 'set_sucursal', id_sucursal: String(erpId) }).toString(),
    signal: AbortSignal.timeout(20_000),
  }).then(r => { if (!r.ok) throw new Error(`cambio_sesion HTTP ${r.status}`); return r; }));

  const qs   = `fechai=${startDate}&fechaf=${endDate}&draw=1&start=0&length=5000`;
  const dt   = JSON.parse(await traer(`${ADMIN_DT_URL}?${qs}`, cookie));
  const filas: any[][] = dt?.data ?? [];
  if (filas.length === 0) return { documentos: 0, actualizados: 0, ambiguos: 0 };

  const rango   = `fechaInicio=${startDate}&fechaFin=${endDate}`;
  // C1 (H13): el archivo se baja UNA vez y se leen las dos columnas. El sello
  // estaba a un índice de la percepción y nadie lo miraba — es la única columna
  // donde el libro del portal perdía contra su origen.
  const libroCsv = await traer(`${LIBRO_CSV}?${rango}`, cookie);
  const percMap  = columnaPorNumero(libroCsv, 3, 21);
  const selloMap = columnaPorNumero(libroCsv, 3, 22);
  // C1b (H22): la columna 4 es el NIT del emisor y la 5 su nombre. Mismo
  // archivo, dos índices más — sirven para completar la ficha del proveedor
  // cuando no lo tiene, o crearla cuando ni existe (C8).
  const nitMap    = columnaPorNumero(libroCsv, 3, 4);
  const nombreMap = columnaPorNumero(libroCsv, 3, 5);
  // La retención NO tiene columna en el libro: sale de su propio anexo. Se pide
  // igual aunque hoy salga vacío en toda la historia — asumir cero por
  // costumbre es exactamente cómo un dato real pasa desapercibido el día que
  // aparece.
  const retenCsv = await traer(`${RETEN_CSV}?${rango}`, cookie);
  const retenMap = columnaPorNumero(retenCsv, 5, 8);

  // Solo los días con un número ambiguo pagan el JSON pesado.
  const ambiguo = (n: string) => (percMap.get(n)?.size ?? 0) > 1 || (retenMap.get(n)?.size ?? 0) > 1;
  const diasTurbios = [...new Set(filas.filter(f => ambiguo(normNum(f[2]))).map(f => String(f[6])))];
  const oro = new Map<string, { p: number; r: number }>();
  for (const dia of diasTurbios) {
    const url = `${COMPRAS_BASE}?fini=${dia}&ffin=${dia}&id_sucursal=${erpId}`;
    const j   = JSON.parse(await traer(url, cookie, 120_000));
    for (const c of (j?.compras ?? [])) {
      oro.set(String(c.compra_id), {
        p: Number(c.totales?.percepcion_iva ?? 0),
        r: Number(c.totales?.retencion_iva  ?? 0),
      });
    }
  }

  const ids = filas.map(f => Number(f[0])).filter(Boolean);
  // Solo se tocan filas que YA existen: este modo completa columnas, no crea
  // compras. Un id sin fila acá significa que falta correr el sync normal.
  const existentes = await selectAllByIn<any>(
    supabase, 'purchase_receipts', 'erp_purchase_id, branch_id',
    'erp_purchase_id', ids, (q) => q.eq('erp_sucursal_id', erpId),
  );
  const vivos = new Map<number, number>((existentes ?? []).map((r: any) => [r.erp_purchase_id, r.branch_id]));

  const rows: any[] = [];
  for (const f of filas) {
    const cid = Number(f[0]);
    if (!vivos.has(cid)) continue;
    const numero = String(f[2] ?? '').trim();
    const n      = normNum(numero);
    const fino   = oro.get(String(f[0]));
    rows.push({
      erp_purchase_id:  cid,
      erp_sucursal_id:  erpId,
      branch_id:        vivos.get(cid),
      // `fecha` va aunque no se quiera cambiar: PostgREST arma un
      // `INSERT ... ON CONFLICT DO UPDATE`, y Postgres valida los NOT NULL de la
      // tupla ANTES de resolver el conflicto. Sin esto el lote entero falla con
      // "null value in column fecha", aunque las 200 filas ya existan. Es la
      // misma fecha del documento que informa este endpoint, así que no puede
      // pisar nada con otro valor.
      fecha:            String(f[6] ?? '').trim() || null,
      documento_tipo:   String(f[1] ?? '').trim() || null,
      documento_numero: numero || null,
      percepcion_iva:   fino ? fino.p : Number([...(percMap.get(n)  ?? ['0'])][0] || 0),
      retencion_iva:    fino ? fino.r : Number([...(retenMap.get(n) ?? ['0'])][0] || 0),
      // Ambiguo = ese número de documento trae más de un sello en el archivo, y
      // entonces no se sabe cuál es de esta compra. Se deja NULL: un sello
      // equivocado es peor que ninguno.
      sello_recibido:   (selloMap.get(n)?.size ?? 0) === 1
                          ? selloValido([...(selloMap.get(n) ?? [])][0])
                          : null,
      updated_at:       new Date().toISOString(),
    });
  }

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('purchase_receipts')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'erp_purchase_id,erp_sucursal_id' });
    if (error) throw new Error(`fastBackfill upsert ${i}: ${error.message}`);
  }

  await completarFichasDeProveedor(supabase, rows, nitMap, nombreMap);

  return { documentos: filas.length, actualizados: rows.length, ambiguos: diasTurbios.length };
}

// ── C1b + C8 (H22): el NIT del libro completa —o crea— la ficha del proveedor ──
//
// Va DESPUÉS del upsert porque el `supplier_id` no está en el archivo: lo
// resuelve el sync principal y queda en la fila. Acá se lee de vuelta.
//
// Nunca tumba el sync. Si esto falla, las compras ya se guardaron y lo único
// que se pierde es una ficha completada — el sync es el trabajo, esto es el
// extra. Un throw acá haría fallar un backfill entero por un NIT.
async function completarFichasDeProveedor(
  supabase: any,
  rows: any[],
  nitMap: Map<string, Set<string>>,
  nombreMap: Map<string, Set<string>>,
): Promise<void> {
  try {
    const ids = rows.map(r => r.erp_purchase_id).filter(Boolean);
    if (ids.length === 0) return;

    // El cap de 1000 de PostgREST aplica al INPUT del `.in()` igual que al
    // output, así que se chunkea (regla del proyecto, patrón A).
    const CHUNK = 1000;
    const compras: any[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase.from('purchase_receipts')
        .select('supplier_id, documento_numero')
        .in('erp_purchase_id', ids.slice(i, i + CHUNK))
        .not('supplier_id', 'is', null);
      if (error) throw new Error(error.message);
      compras.push(...(data ?? []));
    }

    // Un valor por proveedor. Si el archivo le da DOS NIT distintos al mismo
    // proveedor, no se manda ninguno: no sabríamos cuál, y la función de abajo
    // no puede desempatar lo que acá ya llega mezclado.
    const porProveedor = new Map<number, { nit: string; nombre: string | null } | null>();
    for (const c of compras) {
      const n = normNum(c.documento_numero ?? '');
      if ((nitMap.get(n)?.size ?? 0) !== 1) continue;
      const nit = [...(nitMap.get(n) ?? [])][0].replace(/[^0-9]/g, '');
      if (!nit) continue;
      const nombre = (nombreMap.get(n)?.size ?? 0) === 1
        ? ([...(nombreMap.get(n) ?? [])][0] || '').trim() || null
        : null;
      const previo = porProveedor.get(c.supplier_id);
      if (previo === undefined)          porProveedor.set(c.supplier_id, { nit, nombre });
      else if (previo && previo.nit !== nit) porProveedor.set(c.supplier_id, null);
    }

    const pares = [...porProveedor.entries()]
      .filter(([, v]) => v !== null)
      .map(([supplier_id, v]) => ({ supplier_id, nit: v!.nit, nombre: v!.nombre }));
    if (pares.length === 0) return;

    const { data: res, error } = await supabase.rpc('completar_nit_proveedores', { p_pares: pares });
    if (error) throw new Error(error.message);

    // Solo se reporta lo que CAMBIÓ algo o lo que hay que mirar. `ya_tenia` es
    // el caso normal de todas las corridas y llenaría el log de ruido.
    const interesa = (res ?? []).filter((x: any) => x.resultado !== 'ya_tenia');
    if (interesa.length) console.log('C1b/C8 fichas de proveedor:', JSON.stringify(interesa));
  } catch (e) {
    console.error('C1b/C8: no se pudieron completar fichas de proveedor —', String(e));
  }
}

// ── retryFailed: detecta brechas y reintenta día a día ───────────────────────
// Una brecha es un par (sucursal, día) sin un registro de éxito que lo cubra —
// da igual si falló o si nunca se intentó, porque en los dos casos no hay dato.
// Se reintenta uno a uno con el timeout extendido.

async function retryFailed(
  supabase: any,
  username: string,
  password: string,
  since: string,
  onlyBranch?: number | null,
): Promise<{ retried: number; ok: number; failed: number; details: any[] }> {
  // La cobertura se calcula POR SUCURSAL. Con un solo conjunto de días, un día
  // en que Bodega sincronizó y Salud 3 no quedaba marcado como cubierto: la
  // brecha de la sucursal chica se escondía detrás del éxito de la grande.
  const todas    = getPurchaseBranches();
  const branches = onlyBranch ? todas.filter(b => b.branchId === onlyBranch) : todas;

  const yesterday = new Date(Date.now() - 6 * 3600_000);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const untilDay = yesterday.toISOString().split('T')[0];

  // 1. Leer el log completo (éxitos y fallos) del rango, con su sucursal
  const { data: logs, error: logErr } = await supabase
    .from('purchase_sync_log')
    .select('branch_id, fini, ffin, success')
    .gte('fini', since)
    .order('fini');
  if (logErr) throw new Error(`purchase_sync_log select: ${logErr.message}`);

  const doneByBranch = new Map<number, Set<string>>();
  for (const log of (logs ?? [])) {
    if (!log.success) continue;
    let set = doneByBranch.get(log.branch_id);
    if (!set) doneByBranch.set(log.branch_id, set = new Set<string>());
    for (const day of dayRange(log.fini, log.ffin)) set.add(day);
  }

  // 2. Los pares (sucursal, día) sin un sync exitoso que los cubra. Un día que
  //    nunca se intentó cuenta igual que uno que falló: en ambos casos no hay
  //    dato, y el silencio no es éxito.
  const pending: { branchId: number; erpId: number; day: string }[] = [];
  for (const { branchId, erpId } of branches) {
    const done = doneByBranch.get(branchId) ?? new Set<string>();
    for (const day of dayRange(since, untilDay)) {
      if (!done.has(day)) pending.push({ branchId, erpId, day });
    }
  }

  if (pending.length === 0)
    return { retried: 0, ok: 0, failed: 0, details: [{ note: 'No hay brechas pendientes.' }] };

  // 3. Reintentar cada par individualmente
  const details: any[] = [];
  let ok = 0, failed = 0;

  for (const { branchId, erpId, day } of pending) {
    try {
      const result = await syncBranch(supabase, branchId, erpId, username, password, day, day);
      await supabase.from('purchase_sync_log').insert({
        branch_id: branchId, erp_sucursal_id: erpId,
        fini: day, ffin: day,
        receipts_total: result.total, receipts_new: result.new,
        items_inserted: result.items, success: true,
      });
      details.push({ branchId, day, ok: true, ...result });
      ok++;
    } catch (e: any) {
      await supabase.from('purchase_sync_log').insert({
        branch_id: branchId, erp_sucursal_id: erpId,
        fini: day, ffin: day,
        receipts_total: 0, receipts_new: 0, items_inserted: 0,
        success: false, error_msg: e.message,
      });
      details.push({ branchId, day, ok: false, error: e.message });
      failed++;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  return { retried: pending.length, ok, failed, details };
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
      background   = false,         // ver "Modo background" más abajo
      fastBackfill: doFast = false, // ver "Backfill rápido" más arriba
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
      const result = await retryFailed(supabase, username, password, since, onlyBranch);
      return new Response(JSON.stringify({ retryFailed: true, since, ...result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Modo fastBackfill ─────────────────────────────────────────────────────
    // Completa los cuatro campos del libro en filas que YA existen, sin bajar el
    // detalle de líneas. 27× más rápido que el sync normal para ese fin.
    if (doFast) {
      const objetivo = getPurchaseBranches().filter(b => !onlyBranch || b.branchId === onlyBranch);
      if (objetivo.length === 0)
        throw new Error(`branchId ${onlyBranch} no está en el mapa de sucursales de compras.`);

      const salida: any[] = [];
      for (const { branchId, erpId } of objetivo) {
        try {
          salida.push({ branchId, ...await fastBackfill(supabase, branchId, erpId, username, password, startDate, endDate) });
        } catch (e: any) {
          salida.push({ branchId, error: e.message });
        }
      }
      return new Response(
        JSON.stringify({ fastBackfill: true, range: { startDate, endDate }, results: salida }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Sync normal ───────────────────────────────────────────────────────────
    // Un `branchId` en el body ahora filtra el mapa en vez de reasignarle el
    // erpId de Bodega: antes, pedir la sucursal 4 traía las compras de Bodega y
    // las guardaba como si fueran de la 4.
    const todas = getPurchaseBranches();
    const purchaseBranches = onlyBranch
      ? todas.filter(b => b.branchId === onlyBranch)
      : todas;

    if (purchaseBranches.length === 0)
      throw new Error(`branchId ${onlyBranch} no está en el mapa de sucursales de compras.`);

    const correr = async () => {
      const results: any[] = [];
      const logRows: any[] = [];

      for (const { branchId, erpId } of purchaseBranches) {
        let lastErr: string | null = null;
        let result: any = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
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

      return results;
    };

    // ── Modo background ───────────────────────────────────────────────────────
    // El ERP tarda **167s en devolver un mes de Bodega** (medido), y la respuesta
    // de una Edge Function muere a los 150s: un backfill por mes daba 504 aunque
    // el trabajo estuviera bien. Con `waitUntil` la respuesta sale ya y el sync
    // sigue corriendo, que es lo que un backfill necesita.
    //
    // Es opt-in y no lo usa el cron a propósito: el cron pide 2 días, termina en
    // segundos, y quiere el resultado en la respuesta para que un fallo se vea.
    // En background el único rastro es `purchase_sync_log` — suficiente para un
    // backfill que uno mira después, insuficiente para el camino de todos los
    // días.
    if (background) {
      // @ts-ignore — EdgeRuntime es global del runtime de Supabase
      EdgeRuntime.waitUntil(correr().catch(async (e: any) => {
        // Un error acá no tiene a quién contarle: la respuesta ya salió. Que
        // quede en el log o el backfill falla en silencio.
        await supabase.from('purchase_sync_log').insert({
          branch_id: onlyBranch ?? null, erp_sucursal_id: null,
          fini: startDate, ffin: endDate,
          receipts_total: 0, receipts_new: 0, items_inserted: 0,
          success: false, error_msg: `background: ${e?.message ?? e}`,
        });
      }));
      return new Response(
        JSON.stringify({ accepted: true, background: true, range: { startDate, endDate },
                         branches: purchaseBranches.map(b => b.branchId) }),
        { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, range: { startDate, endDate }, results: await correr() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
    );
  }
});
