import { createClient } from "npm:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@1.6.2";
import { requireInvokeSecret, requireActiveEmployeeUser, getCorsHeaders } from "../_shared/security.ts";
import { loteYVence, nombreLimpio } from "../_shared/loteVencimiento.ts";
import { elegirFactor, esFleteOServicio, factorEnLaDescripcion, factorDebilEnLaDescripcion, tamanosEnLaDescripcion, empaqueEnLaDescripcion, envaseUnitarioEnLaDescripcion, factorDescuentoDeFactura } from "../_shared/compraSobre.ts";
import { dteDeManual } from "../_shared/compraManual.ts";
import { diferenciasDeNumeros } from "../_shared/numerosDelNombre.ts";

// Leer el JSON de un DTE de compra — la pieza que le faltaba a todo lo demás.
//
// POR QUÉ EXISTE. El portal guarda el JSON de cada documento en el bucket
// PRIVADO `purchase-dte`, y hasta hoy nadie lo leía: lo único que se consultaba
// era `purchase_dte_documents.items_text`, que es el mismo JSON **aplanado en
// una sola cadena** por `extractItemsText` — sólo `codigo + descripcion`, unidos
// con ` | `, y **descartando la descripción repetida**.
//
// Esa pérdida está medida (`docs/AUDITORIA-MATCH-DTE-PRODUCTOS-2026-08-16.md`):
// sólo COFARSAL pierde 177 renglones, y le falta alguno a 81 de sus 209
// compras. Y peor: al quedarse con dos campos, el texto **no puede mostrar** lo
// que el proveedor manda en los demás. La factura de GAMMA lo dejó a la vista —
// su representación gráfica trae columnas `Lote` y `Vence` que en `items_text`
// no aparecen por ningún lado.
//
// La lectura de lote y vencimiento vive en `_shared/loteVencimiento.ts`, que es
// puro y tiene pruebas con cadenas reales (`tests/unit/loteVencimiento.test.js`).
// Acá NO se duplica: una copia con pruebas al lado prueba la copia.
//
// AUTENTICACIÓN. Secreto de invocación (`ADMIN_INVOKE_SECRET`), no JWT: la
// llama Postgres con `net.http_post` leyendo el secreto de Vault, igual que los
// crons. Por eso se despliega con `--no-verify-jwt` — sin el flag, la
// plataforma rechaza la llamada antes de ejecutar una línea.
//
// NO ESCRIBE NADA. Lee de Storage y de la base, y devuelve.

const MAX_DOCS  = 40;   // el cuerpo de la respuesta viaja por net._http_response
const MAX_ITEMS = 10;

/** El sobre viejo: `{selloRecibido, firmaElectronica, dteJson}`. */
function desenvolver(j: any): any {
  return j?.dteJson ?? j?.documento ?? j;
}

/** El path dentro del bucket, sacado de la URL formato-public que se guarda. */
function pathDeStorage(url: string | null): string | null {
  if (!url) return null;
  const i = url.indexOf("/purchase-dte/");
  return i < 0 ? null : decodeURIComponent(url.slice(i + "/purchase-dte/".length));
}

// `unpdf` extrae texto sin DOM ni canvas — el mismo paquete con el que
// `sync-purchase-emails` detecta el código de generación de un PDF huérfano.
async function textoDelPdf(bytes: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return text;
}

/**
 * ¿El rol de esta persona puede ver facturas de compra?
 *
 * Se resuelve contra `role_permissions` con la llave de servicio y NO con
 * `auth_has_module_permission`, porque esa función saca al empleado del JWT y
 * acá la conexión es de servicio: no hay JWT que resolver y devolvería falso
 * para todos.
 */
async function tienePermiso(admin: any, emp: any): Promise<boolean> {
  // `requireActiveEmployeeUser` devuelve sólo id/status/code/name — el rol NO
  // viene, así que hay que ir por él. Sin este paso `roles` quedaba vacío y la
  // función negaba el paso a todo el mundo con un 401 que parecía de sesión.
  // Una lectura caída lanza: devolver `false` sería un «no tenés permiso» falso.
  const { data: ficha, error: errFicha } = await admin
    .from("employees").select("role_id, secondary_role_id").eq("id", emp?.id).maybeSingle();
  if (errFicha) throw errFicha;
  const roles = [ficha?.role_id, ficha?.secondary_role_id].filter(Boolean);
  if (!roles.length) return false;
  const { data, error } = await admin
    .from("role_permissions")
    .select("module_key, can_view")
    .in("role_id", roles)
    .in("module_key", ["compras", "facturas_compra", "cuentas_por_pagar"])
    .eq("can_view", true);
  if (error) throw error;
  return (data ?? []).length > 0;
}

const norm20 = (s: string) =>
  s.replace(/\s/g, "").replace(/\./g, "").replace(/O/gi, "0").toUpperCase();

// ── Saldo de recargas: cuántos dólares trae ─────────────────────────────
//
// Bodega carga el saldo en unidades de $1 (Movistar: 210 a $0.8428).
// Movistar factura «RECARGA ELECTRONICA» 1 × $176.99 y BOXFUL «SERVICIO DE
// RECARGA» 1 × $30: el papel no dice cuántos dólares son. Lo que sí se sabe es
// el costo por dólar de la última compra, así que se SUGIERE pagado ÷ ese
// costo — medido: $176.99 ÷ $0.8428 = 210.0, lo que Bodega cargó a mano las
// últimas cuatro veces. Es una sugerencia y la pantalla lo dice: el descuento
// del proveedor puede cambiar. Un saldo es un producto cuyas presentaciones
// valen 0 en el catálogo (Tigo, Movistar, Digicel) o se llama RECARGA SALDO
// (Claro). Si ya viene en dólares (Claro: 300 × $0.81), no sugiere nada.
async function saldoSugerido(admin: any, x: {
  productId: number; nombre: string | null; factores: number[]; pagado: number; cantidad: number; entra: number; emisor: string;
}) {
  const esSaldo = /^RECARGA\s+SALDO/i.test(String(x.nombre ?? "")) || (x.factores.length > 0 && x.factores.every((f) => !(f > 0)));
  if (!esSaldo || !(x.pagado > 0)) return null;
  const { data: hist, error } = await admin.from("purchase_receipt_items")
    .select("precio_unitario, cantidad, purchase_receipts!inner(fecha, proveedor)")
    .eq("erp_product_id", x.productId).gt("cantidad", 1)
    .order("receipt_id", { ascending: false }).limit(30);
  if (error) { console.error("[leer-dte-json] saldo:", error.message); return null; }
  const filas = ((hist ?? []) as any[]).filter((h) => Number(h.precio_unitario) > 0 && Number(h.precio_unitario) < 1.5)
    .sort((a, b) => String(b.purchase_receipts.fecha).localeCompare(String(a.purchase_receipts.fecha)));
  const palabra = (t: string) => String(t ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").trim().split(/\s+/)[0] ?? "";
  const delMismo = filas.find((h) => palabra(h.purchase_receipts.proveedor) === palabra(x.emisor));
  const ref = delMismo ?? filas[0];
  if (!ref) return null;
  const costo = Number(ref.precio_unitario);
  const n = x.pagado / costo;
  // Ya viene en dólares (Claro: 300 × $0.81) → nada que sugerir. Se mide
  // contra la CANTIDAD del papel, no contra el tamaño estimado: al elegir
  // Movistar a mano, el tamaño «por costo» salía 195 y tapaba la sugerencia.
  if (n < x.cantidad * 2) return null;
  // Lo que ya se va a cargar coincide (Tigo con su 25 aprendido): no repetir.
  if (Math.abs(x.entra - n) / n < 0.03) return null;
  return {
    unidades: Math.round(n), pagado: Math.round(x.pagado * 100) / 100, costo_referencia: costo,
    de: { proveedor: ref.purchase_receipts.proveedor, fecha: ref.purchase_receipts.fecha, mismo_proveedor: !!delMismo },
    exacto: Math.abs(n - Math.round(n)) < 0.05,
  };
}

Deno.serve(async (req: Request) => {
  const cors = { ...getCorsHeaders(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // DOS puertas, porque son dos llamadores distintos:
  //   · Postgres, con el secreto de Vault (los barridos y las mediciones).
  //   · El navegador, con la sesión de quien mira la pantalla de carga — y ahí
  //     además se le exige el permiso del módulo, porque esto lee facturas de
  //     compra con su detalle completo.
  let autorizado = requireInvokeSecret(req);
  if (!autorizado) {
    const emp = await requireActiveEmployeeUser(req, admin);
    if (emp) autorizado = await tienePermiso(admin, emp);
  }
  if (!autorizado) {
    return new Response(JSON.stringify({ error: "no autorizado" }), { status: 401, headers: cors });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      document_ids = null, emisor_nit = null, emisor_like = null,
      limit = 3, max_items = MAX_ITEMS, modo = "items",
      desde = null,
    } = body ?? {};

    // ── `refrescar_catalogo`: traer los productos del sistema AHORA ─────────
    //
    // Bodega corrige una ficha en el sistema (un costo, una presentación) y la
    // carga la juzgaba con la copia de hasta 10 minutos atrás: NOR-CLAMIDA
    // seguía con costo de tableta después de corregirlo (2026-11-05). Corre la
    // MISMA sincronización del cron —una sola petición al sistema, ~5 s—, y no
    // más de una vez por minuto aunque varias pantallas la pidan.
    if (modo === "refrescar_catalogo") {
      const { data: ult, error: errU } = await admin.from("products_sync_log")
        .select("checked_at").eq("success", true).order("checked_at", { ascending: false }).limit(1).maybeSingle();
      if (errU) throw errU;
      const hace = ult ? (Date.now() - new Date(ult.checked_at).getTime()) / 1000 : Infinity;
      if (hace < 60) {
        return new Response(JSON.stringify({ refrescado: false, hace_segundos: Math.round(hace) }), { headers: cors });
      }
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-products`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("ADMIN_INVOKE_SECRET")}` },
        body: "{}", signal: AbortSignal.timeout(90_000),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        return new Response(JSON.stringify({ refrescado: false, error: j?.error ?? `HTTP ${r.status}` }), { status: 502, headers: cors });
      }
      return new Response(JSON.stringify({ refrescado: true, cambios: j.product_changes ?? 0 }), { headers: cors });
    }

    // ── `factor`: el tamaño contra el producto que Bodega eligió a mano ─────
    //
    // La propuesta lo calcula sólo contra el producto que ELLA encontró. Un
    // renglón sin candidato (GRIPE-MED de MONTREAL, 2026-11-05) quedaba en 1
    // al elegirlo a mano: «1 SOBRE X 2» por una caja de 50 a $10.91. Acá se
    // corre la MISMA regla contra el elegido. Devuelve sólo el número: el costo
    // del catálogo no se le muestra al navegador (no tiene permiso de columna).
    if (modo === "factor") {
      const pid = Number(body?.product_id);
      if (!Number.isInteger(pid) || pid <= 0) {
        return new Response(JSON.stringify({ error: "product_id inválido" }), { status: 400, headers: cors });
      }
      const { data: pp, error: errF } = await admin.from("product_precios")
        .select("factor, costo, vineta, presentaciones(tipo)").eq("product_id", pid).eq("activo", true);
      if (errF) throw errF;
      const desc = String(body?.descripcion ?? "");
      const uno = (pp ?? []).find((x) => Number(x.factor) === 1 && Number(x.costo) > 0);
      const otra = (pp ?? []).find((x) => Number(x.factor) > 1 && Number(x.costo) > 0);
      const cu = uno ? Number(uno.costo) : otra ? Number(otra.costo) / Number(otra.factor) : null;
      const f = elegirFactor({
        delDoc: factorEnLaDescripcion(desc), debil: factorDebilEnLaDescripcion(desc), pistas: tamanosEnLaDescripcion(desc), empaque: empaqueEnLaDescripcion(desc), unitario: envaseUnitarioEnLaDescripcion(desc), aprendido: null,
        vinetaUno: Number((pp ?? []).find((x) => Number(x.factor) === 1)?.vineta) || null,
        costoNeto: Number(body?.costo_neto) || 0, costoUnidad: cu != null ? Number(cu) : null,
        presentaciones: (pp ?? []).map((x) => Number(x.factor)),
      });
      // Las presentaciones van con su viñeta y su nombre —lo mismo que la
      // propuesta trae del producto propuesto— para que la pantalla pinte
      // «Se carga como» y el precio Regular del ELEGIDO. Sin el costo.
      const presentaciones = (pp ?? []).map((x) => ({
        factor: Number(x.factor), vineta: Number(x.vineta), nombre: (x as any).presentaciones?.tipo ?? null,
      }));
      const { data: prod, error: errProd } = await admin.from("products").select("nombre").eq("id", pid).maybeSingle();
      if (errProd) console.error("[leer-dte-json] producto:", errProd.message);
      const cant = Number(body?.cantidad) || 0;
      const saldo = cant > 0 ? await saldoSugerido(admin, {
        productId: pid, nombre: prod?.nombre ?? null, factores: presentaciones.map((x) => x.factor),
        pagado: (Number(body?.costo_neto) || 0) * cant, cantidad: cant, entra: cant * f.factor, emisor: String(body?.emisor ?? ""),
      }) : null;
      const numeros = prod?.nombre ? diferenciasDeNumeros(nombreLimpio(desc), prod.nombre) : [];
      return new Response(JSON.stringify({ factor: f.factor, origen: f.origen, presentaciones, saldo_sugerido: saldo, numeros_distintos: numeros }), { headers: cors });
    }

    // ── `barrido`: armar la lista de preguntas distintas ────────────────────
    //
    // Lee los documentos que todavía no se leyeron y acumula sus renglones en
    // `compra_renglon_pendiente`, agrupados por `(proveedor, código)`. Es lo
    // que hace que la pantalla «Por confirmar» abra al instante: el parecido
    // de nombre se calcula UNA vez por llave, acá, y no en cada carga.
    //
    // Va de a tandas y devuelve cuánto queda, para que la pantalla vuelva a
    // llamar. Trocearlo no es prolijidad: son 615 documentos y una Edge
    // Function vive 150 segundos.
    if (modo === "barrido") {
      const dias  = Math.min(Math.max(Number(body?.dias)  || 90, 1), 400);
      const tanda = Math.min(Math.max(Number(body?.tanda) || 40, 1), 120);

      const { data: pend, error: errP } = await admin.rpc("get_documentos_por_barrer", {
        p_dias: dias, p_limite: tanda,
      });
      if (errP) throw new Error(`get_documentos_por_barrer: ${errP.message}`);

      const lista = pend ?? [];
      const quedaba = Number(lista[0]?.restantes ?? 0);
      let leidos = 0, nuevas = 0, fallados = 0;

      // De a 8 en paralelo. Las 40 descargas de golpe saturan el runtime y no
      // van más rápido: el cuello es Storage, no el CPU.
      const CONC = 8;
      for (let i = 0; i < lista.length; i += CONC) {
        const res = await Promise.all(lista.slice(i, i + CONC).map(async (d: any) => {
          try {
            const path = pathDeStorage(d.json_path);
            if (!path) return { ok: false };
            const { data: blob, error: errBlob } = await admin.storage.from("purchase-dte").download(path);
            if (errBlob) console.error("[leer-dte-json] json:", errBlob.message);
            if (!blob) return { ok: false };
            const dte = desenvolver(JSON.parse(await blob.text()));
            const items: any[] = Array.isArray(dte?.cuerpoDocumento) ? dte.cuerpoDocumento : [];
            const filas = items.map((it) => ({
              codigo: it?.codigo ?? null,
              descripcion: String(it?.descripcion ?? ""),
              // El mismo nombre limpio que usa la propuesta. Tiene que ser el
              // mismo: es lo que arma la llave sintética de los renglones sin
              // código, y dos limpiezas distintas darían dos llaves distintas
              // para el mismo producto.
              limpio: nombreLimpio(String(it?.descripcion ?? "")),
              cantidad: Number(it?.cantidad ?? 0) || 0,
            }));
            const { data: n, error } = await admin.rpc("registrar_renglones_pendientes", {
              p_document_id: d.document_id, p_emisor_nit: d.emisor_nit,
              p_fecha: d.fecha_emision, p_filas: filas,
            });
            if (error) return { ok: false };
            return { ok: true, nuevas: Number(n ?? 0) };
          } catch { return { ok: false }; }
        }));
        for (const r of res) { if (r.ok) { leidos++; nuevas += r.nuevas ?? 0; } else fallados++; }
      }

      // `restantes` es lo que queda DESPUÉS de esta tanda. Un documento que
      // falló no se marca leído, así que sigue contando: la pantalla corta
      // cuando una tanda no avanza (`leidos === 0`), no cuando llega a cero.
      return new Response(JSON.stringify({
        leidos, nuevas, fallados, quedaba, restantes: Math.max(0, quedaba - leidos),
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // Una factura en PAPEL vestida de DTE (`compraManual.ts`): sólo para la
    // propuesta, que es lo que necesita la carga.
    let manual: { d: any; dte: any } | null = null;
    if (Number(body?.manual_id) > 0) {
      const { data: m, error: errM } = await admin.from("compra_documento_manual").select("*").eq("id", Number(body.manual_id)).maybeSingle();
      if (errM) throw new Error(`compra_documento_manual: ${errM.message}`);
      if (!m) throw new Error("Esa factura no existe.");
      manual = dteDeManual(m);
    }

    let q = admin
      .from("purchase_dte_documents")
      .select("id, emisor_nombre, emisor_nit, codigo_generacion, fecha_emision, json_path, pdf_path, sello_recibido")
      .not("json_path", "is", null)
      .order("id", { ascending: false })
      .limit(Math.min(Number(limit) || 3, MAX_DOCS));

    if (Array.isArray(document_ids) && document_ids.length > 0) q = q.in("id", document_ids.slice(0, MAX_DOCS));
    if (emisor_nit)  q = q.eq("emisor_nit", emisor_nit);
    if (emisor_like) q = q.ilike("emisor_nombre", `%${emisor_like}%`);
    if (desde)       q = q.gte("fecha_emision", desde);

    const { data: docsDte, error } = manual ? { data: [manual.d], error: null } : await q;
    if (error) throw new Error(`purchase_dte_documents: ${error.message}`);
    const docs: any[] = docsDte ?? [];

    const salida: any[] = [];

    for (const d of docs ?? []) {
      // El PDF se baja y se lee MIENTRAS se baja el JSON y se emparejan los
      // renglones: en serie era la mitad del tiempo de abrir una compra.
      const pdfP: Promise<string> = (async () => {
        if (!(modo === "pdf" || modo === "lotes" || modo === "verificar" || modo === "propuesta")) return "";
        const pPdf = pathDeStorage(d.pdf_path);
        if (!pPdf) return "";
        const { data: pdfBlob, error: errPdf } = await admin.storage.from("purchase-dte").download(pPdf);
        if (errPdf) console.error("[leer-dte-json] pdf:", errPdf.message);
        if (!pdfBlob) return "";
        try { return await textoDelPdf(new Uint8Array(await pdfBlob.arrayBuffer())); }
        catch { return ""; /* PDF escaneado o sin capa de texto: se sigue sin él */ }
      })();
      let dte: any = manual?.dte ?? null;
      if (!dte) {
        const path = pathDeStorage(d.json_path);
        if (!path) { salida.push({ id: d.id, error: "json_path sin ruta de bucket" }); continue; }

        const { data: blob, error: dlErr } = await admin.storage.from("purchase-dte").download(path);
        if (dlErr || !blob) { salida.push({ id: d.id, error: `descarga: ${dlErr?.message}` }); continue; }

        try { dte = desenvolver(JSON.parse(await blob.text())); }
        catch (e: any) { salida.push({ id: d.id, error: `json ilegible: ${e.message}` }); continue; }
      }

      const items: any[] = Array.isArray(dte?.cuerpoDocumento) ? dte.cuerpoDocumento : [];
      const claves = [...new Set(items.flatMap((it) => Object.keys(it ?? {})))].sort();

      const base = {
        id: d.id, emisor: d.emisor_nombre, emisor_nit: d.emisor_nit,
        fecha: d.fecha_emision, renglones: items.length,
        claves_del_renglon: claves,
        tiene_extension: !!dte?.extension,
        extension: dte?.extension ?? null,
        apendice: dte?.apendice ?? null,
        otros_documentos: dte?.otrosDocumentos ?? null,
        claves_raiz: Object.keys(dte ?? {}).sort(),
        // El encabezado de la compra: condición de operación (1 contado /
        // 2 crédito / 3 otro) y el plazo, que el estándar pone en
        // `resumen.pagos[].plazo` (catálogo: 01 días, 02 meses, 03 años) con
        // `periodo` como número.
        condicion_operacion: dte?.resumen?.condicionOperacion ?? null,
        pagos: dte?.resumen?.pagos ?? null,
        numero_control: dte?.identificacion?.numeroControl ?? null,
        sello: dte?.selloRecibido ?? null,
      };

      if (modo === "claves") { salida.push(base); continue; }

      // ── Modos que necesitan el PDF ──────────────────────────────────────
      // La propuesta lo espera recién al armar cada renglón.
      const txtPdf = modo === "propuesta" ? "" : await pdfP;

      if (modo === "pdf") {
        const desdeC = Number(body?.pdf_desde ?? 0);
        salida.push({ ...base, pdf_caracteres: txtPdf.length,
          pdf_texto: txtPdf.slice(desdeC, desdeC + Number(body?.pdf_largo ?? 2500)) });
        continue;
      }

      const leidos = items.map((it) => {
        const r = loteYVence(txtPdf, it, undefined, items.map((x: any) => String(x?.descripcion ?? "")));
        return {
          codigo: it?.codigo ?? null, descripcion: it?.descripcion ?? null,
          cantidad: it?.cantidad ?? null, precioUni: it?.precioUni ?? null,
          lote: r.lote, vence: r.vence, de: r.de,
        };
      });

      if (modo === "lotes") {
        salida.push({
          ...base,
          con_lote: leidos.filter((x) => x.lote).length,
          con_vence: leidos.filter((x) => x.vence).length,
          renglones_leidos: leidos.slice(0, Math.min(Number(max_items) || MAX_ITEMS, 25)),
        });
        continue;
      }

      // ── `verificar`: contra lo que una persona escribió ────────────────
      //
      // La prueba de fuego. Cada compra ya registrada tiene sus renglones con
      // el vencimiento que alguien tecleó mirando la caja. Se compara el
      // CONJUNTO de fechas leídas contra el conjunto tecleado — así no hace
      // falta emparejar renglón con renglón (que metería el error del matcher
      // de productos en una medición que es sólo del extractor de fechas).
      if (modo === "verificar") {
        const norm = norm20(String(d.codigo_generacion ?? ""));
        const variantes = [norm, norm.replace(/-/g, "").slice(0, 20), norm.slice(0, 20)];
        let recibo: any = null;

        if (d.sello_recibido) {
          // Un error leído como «sin compra» mandaría a registrarla otra vez.
          const { data, error } = await admin.from("purchase_receipts")
            .select("id").eq("sello_recibido", d.sello_recibido).limit(1);
          if (error) throw error;
          recibo = data?.[0] ?? null;
        }
        if (!recibo) {
          const { data, error } = await admin.from("purchase_receipts")
            .select("id, documento_numero")
            .in("documento_numero", variantes).limit(1);
          if (error) throw error;
          recibo = data?.[0] ?? null;
        }
        if (!recibo) { salida.push({ id: d.id, emisor: d.emisor_nombre, sin_compra: true }); continue; }

        const { data: reng, error: errReng } = await admin.from("purchase_receipt_items")
          .select("fecha_vencimiento, lote").eq("receipt_id", recibo.id);
        if (errReng) throw errReng;

        const mias = leidos.map((x) => x.vence).filter((v): v is string => Boolean(v)).sort();
        const suyas = (reng ?? []).map((x: any) => x.fecha_vencimiento).filter(Boolean).sort();
        const cuenta = (a: string[]) => a.reduce((m: any, v) => (m[v] = (m[v] ?? 0) + 1, m), {});
        const ca = cuenta(mias), cb = cuenta(suyas);
        const claves2 = [...new Set([...Object.keys(ca), ...Object.keys(cb)])];
        const iguales = claves2.filter((k) => (ca[k] ?? 0) === (cb[k] ?? 0));
        const difieren = claves2.filter((k) => (ca[k] ?? 0) !== (cb[k] ?? 0))
          .map((k) => ({ fecha: k, leidas: ca[k] ?? 0, tecleadas: cb[k] ?? 0 }));

        salida.push({
          id: d.id, emisor: d.emisor_nombre, fecha: d.fecha_emision,
          renglones_dte: items.length, renglones_compra: (reng ?? []).length,
          fechas_leidas: mias.length, fechas_tecleadas: suyas.length,
          fechas_que_coinciden: iguales.length,
          difieren,
        });
        continue;
      }

      // ── `propuesta`: la compra armada, SIN escribir en ningún lado ─────
      //
      // Es la pantalla antes de la pantalla: dice qué se cargaría y de dónde
      // salió cada dato, para que una persona lo mire. No toca el sistema de
      // origen ni la base — sólo lee.
      if (modo === "propuesta") {
        const [{ data: prov, error: errProv }, { data: alias, error: errA }] = await Promise.all([
          admin.from("proveedores_maestro")
            .select("nombre, supplier_id, f07_tipo_operacion, f07_clasificacion, f07_tipo_costo_gasto, clasificacion_estado, iva_deducible")
            .eq("nit", d.emisor_nit).maybeSingle(),
          // Cuántas unidades trae cada una del proveedor, aprendido con el
          // producto. Una lectura por documento, no una por renglón.
          admin.from("compra_producto_alias")
            .select("codigo_proveedor, product_id, factor_proveedor").eq("emisor_nit", d.emisor_nit),
        ]);
        if (errProv) throw errProv;

        // El plazo: el estándar lo pone en `resumen.pagos[].periodo` con
        // `plazo` del catálogo (01 días, 02 meses, 03 años). Cuando el emisor
        // no lo manda —la mitad no lo hace— queda nulo y lo pone la persona.
        const pago = (dte?.resumen?.pagos ?? [])[0] ?? null;
        let diasCredito: number | null = null;
        if (pago?.periodo != null) {
          const n = Number(pago.periodo);
          if (Number.isFinite(n) && n > 0) {
            diasCredito = pago.plazo === "02" ? n * 30 : pago.plazo === "03" ? n * 365 : n;
            // Un plazo de más de un año no es un plazo: es un código mal
            // puesto. DROGUERÍA AMERICANA manda `plazo:02, periodo:75` —
            // 75 meses son seis años—. Se devuelve el número crudo y se marca.
            if (diasCredito > 365) diasCredito = n;
          }
        }

        if (errA) throw errA;
        // Lo que alguien ya apartó como «no es un producto» de este proveedor
        // (flete, servicio): se propone como servicio en la carga.
        const { data: aparts, error: errAp } = await admin.from("compra_renglon_pendiente")
          .select("llave").eq("emisor_nit", d.emisor_nit).eq("ignorado", true);
        if (errAp) throw errAp;
        const apartados = new Set((aparts ?? []).map((a: any) => a.llave));
        // Por código del proveedor; si no manda código, la llave es `#`+nombre
        // normalizado en SQL (`norm_search`), que acá no se reproduce: se va
        // por el producto, que es lo que el diccionario ya resolvió.
        const factorDe = new Map((alias ?? []).map((a: any) => [a.codigo_proveedor, Number(a.factor_proveedor) || 1]));
        const factorDelProducto = new Map((alias ?? []).map((a: any) => [a.product_id, Number(a.factor_proveedor) || 1]));

        // Cada renglón se empareja por su lado: de a 8 a la vez, en el orden
        // del documento. Uno tras otro, una factura de 40 renglones eran 40
        // idas y vueltas a la base antes de poder mostrar nada.
        const emparejar = async (it: any) => {
          // Al emparejador va el NOMBRE LIMPIO, no la descripción cruda: el
          // lote y la fecha metidos adentro son ruido distinto en cada renglón
          // y hunden el parecido. Medido: con la cruda, 28% de los renglones
          // quedan sin ningún candidato; con el nombre limpio, 9%.
          const limpio = nombreLimpio(String(it?.descripcion ?? ""));
          // Sin código del proveedor, la llave del diccionario es `#`+nombre
          // limpio — la de «Por confirmar». Se arma acá y viaja con el renglón
          // para que confirmarlo en la carga también quede aprendido.
          let llave: string | null = String(it?.codigo ?? "").trim() || null;
          if (!llave && limpio) {
            const { data: k, error: errK } = await admin.rpc("compra_llave_de_renglon", { p_codigo: null, p_texto: limpio });
            if (errK) throw errK;
            llave = k ?? null;
          }
          const { data: m, error: errM } = await admin.rpc("emparejar_producto_dte", {
            p_emisor_nit: d.emisor_nit, p_codigo_prov: llave,
            // El código de barras vive en la descripción CRUDA de algunos
            // proveedores, así que se manda entera cuando trae dígitos largos.
            p_texto: /\d{12,14}/.test(String(it?.descripcion ?? "")) ? String(it?.descripcion) : limpio,
          });
          if (errM) throw errM;
          return { it, llave, match: Array.isArray(m) ? m[0] : m };
        };
        const pares: { it: any; llave: string | null; match: any }[] = [];
        for (let i = 0; i < items.length; i += 8) pares.push(...await Promise.all(items.slice(i, i + 8).map(emparejar)));
        const txtPdfP = await pdfP;
        const renglones = [];
        for (const { it, llave, match } of pares) {
          const lv = loteYVence(txtPdfP, it, undefined, items.map((x: any) => String(x?.descripcion ?? "")));
          const sim = Number(match?.similitud ?? 0);
          const seguro = match?.origen === "codigo_barras" || match?.origen === "aprendido" || sim >= 0.75;

          renglones.push({
            codigo_proveedor: it?.codigo ?? null,
            llave,
            descripcion: it?.descripcion ?? null,
            cantidad: it?.cantidad ?? null,
            costo: it?.precioUni ?? null,
            descuento: it?.montoDescu ?? 0,
            total_linea: it?.ventaGravada ?? it?.ventaExenta ?? it?.ventaNoSuj ?? null,
            exento: Number(it?.ventaExenta ?? 0) > 0,
            producto_id: match?.product_id ?? null,
            // El factor se completa después del bucle (necesita el costo del
            // catálogo de todos los productos a la vez).
            factor_aprendido: match?.origen === "aprendido"
              ? (factorDe.get(llave ?? "") ?? factorDelProducto.get(match?.product_id) ?? null) : null,
            factor_proveedor: 1, factor_origen: null as string | null,
            producto: match?.nombre ?? null,
            match_origen: match?.origen ?? "sin candidato",
            match_similitud: match?.similitud ?? null,
            lote: lv.lote, vence: lv.vence, lote_origen: lv.de,
            servicio_sugerido: esFleteOServicio(String(it?.descripcion ?? "")) || (llave != null && apartados.has(llave)),
            // `seguro` es sobre el PRODUCTO y nada más. Va aparte de `listo`
            // porque son dos preguntas distintas y confundirlas hacía que el
            // aviso dijera «a confirmar» de un renglón cuyo producto estaba
            // resuelto y lo único que faltaba era el lote.
            seguro,
            listo: !!(seguro && lv.vence && lv.lote),
            falta: [
              !match?.product_id ? "producto" : (!seguro ? "confirmar producto" : null),
              !lv.lote ? "lote" : null,
              !lv.vence ? "vencimiento" : null,
            ].filter(Boolean),
          });
        }

        // ── Cuántas unidades trae cada una del proveedor ──────────────────
        //
        // En este orden, y el documento PRIMERO: Sarita escribe la caja en la
        // descripción («…|25.000 |Caja») y la MISMA caja cambia de tamaño entre
        // facturas (Choco Cono: 15 en una, 30 en otra), así que lo aprendido no
        // puede pisar lo que el papel dice. Después lo aprendido, y al final el
        // costo: si el precio es un múltiplo entero del costo unitario del
        // catálogo (±8 %), ése es el tamaño — medido: $5.81 ÷ 25 = $0.2324, el
        // costo exacto de la barrita. Es una SUGERENCIA y se dice de dónde salió.
        const ids = [...new Set(renglones.map((r) => r.producto_id).filter(Boolean))];
        const costoUnidad = new Map<number, number>();
        // La viñeta (precio de venta) de cada presentación: la pantalla la
        // muestra para que Bodega la compare con la caja. De a 200 productos:
        // con varias presentaciones cada uno, la lista entera pasaría de 1000.
        const vinetas = new Map<number, { factor: number; vineta: number; nombre: string | null }[]>();
        for (let k = 0; k < ids.length; k += 200) {
          const { data: pp, error: errPP } = await admin.from("product_precios")
            .select("product_id, factor, costo, vineta, presentaciones(tipo)").in("product_id", ids.slice(k, k + 200)).eq("activo", true);
          if (errPP) throw errPP;
          for (const x of pp ?? []) {
            // El costo de UNA unidad: el de la presentación de 1 si existe; si
            // no (NOR-CLAMIDA X 30 sólo tiene la caja de 30), el de cualquier
            // presentación dividido entre su tamaño. Sin esto el precio no
            // podía juzgar y la caja quedaba en 1.
            const f = Number(x.factor), c = Number(x.costo);
            if (f === 1 && c > 0) costoUnidad.set(x.product_id, c);
            else if (f > 1 && c > 0 && !costoUnidad.has(x.product_id)) costoUnidad.set(x.product_id, c / f);
            const l = vinetas.get(x.product_id) ?? [];
            l.push({ factor: Number(x.factor), vineta: Number(x.vineta), nombre: (x as any).presentaciones?.tipo ?? null });
            vinetas.set(x.product_id, l);
          }
        }
        // El descuento al pie también baja el costo que se compara (RONASA 35 %).
        const dsc = factorDescuentoDeFactura(dte?.resumen);
        for (const r of renglones) {
          (r as any).vinetas = r.producto_id ? (vinetas.get(r.producto_id) ?? []) : [];
          const cant = Number(r.cantidad);
          const descUnidad = cant > 0 ? Number(r.descuento ?? 0) / cant : 0;
          const neto = (Number(r.costo) - descUnidad) * (r.exento ? dsc.exenta : dsc.gravada);
          const f = elegirFactor({
            delDoc: factorEnLaDescripcion(String(r.descripcion ?? "")),
            debil: factorDebilEnLaDescripcion(String(r.descripcion ?? "")),
            pistas: tamanosEnLaDescripcion(String(r.descripcion ?? "")),
            empaque: empaqueEnLaDescripcion(String(r.descripcion ?? "")),
            unitario: envaseUnitarioEnLaDescripcion(String(r.descripcion ?? "")),
            vinetaUno: ((r as any).vinetas ?? []).find((v: { factor: number }) => v.factor === 1)?.vineta ?? null,
            aprendido: r.factor_aprendido ? Number(r.factor_aprendido) : null,
            costoNeto: neto,
            costoUnidad: r.producto_id ? costoUnidad.get(r.producto_id) : null,
            presentaciones: ((r as any).vinetas ?? []).map((v: { factor: number }) => v.factor),
          });
          r.factor_proveedor = f.factor; r.factor_origen = f.origen;
          // La pantalla lo manda de vuelta cuando Bodega elige otro producto
          // (modo «factor»): el tamaño se recalcula contra ESE producto.
          (r as any).costo_neto = Math.round(neto * 10000) / 10000;
          if (f.corrige) (r as any).factor_corrige = f.corrige;
        }

        for (const r of renglones as any[]) {
          if (!r.producto_id) continue;
          const sug = await saldoSugerido(admin, {
            productId: r.producto_id, nombre: r.producto, factores: ((r.vinetas ?? []) as { factor: number }[]).map((v) => v.factor),
            pagado: Number(r.costo_neto) * (Number(r.cantidad) || 0),
            cantidad: Number(r.cantidad) || 0,
            entra: (Number(r.cantidad) || 0) * (Number(r.factor_proveedor) || 1), emisor: d.emisor_nombre,
          });
          if (sug) r.saldo_sugerido = sug;
        }

        // ── Concentración y tamaño: ¿la factura y el producto dicen lo mismo?
        //
        // «Olexa 10 mg» emparejado (y dado por seguro) con OLEXA 5 MG; ALGODÓN
        // 10 g con el de 100 g (cruce de octubre, 2026-11-05). Si los números
        // no coinciden, el producto deja de ser «seguro» y hay que confirmarlo.
        // El código de barras no se discute: ahí lo que miente es el nombre.
        for (const r of renglones as any[]) {
          if (!r.producto_id || !r.producto || r.match_origen === "codigo_barras") continue;
          const d = diferenciasDeNumeros(nombreLimpio(String(r.descripcion ?? "")), String(r.producto));
          if (!d.length) continue;
          r.numeros_distintos = d;
          r.seguro = false; r.listo = false;
          r.falta = ["confirmar producto", ...(r.falta as string[]).filter((f) => f !== "confirmar producto")];
        }

        salida.push({
          documento: {
            id: d.id, manual_id: d.manual_id ?? null, codigo_generacion: d.codigo_generacion,
            numero_control: dte?.identificacion?.numeroControl ?? null,
            sello: d.sello_recibido ?? dte?.selloRecibido ?? null,
            fecha: d.fecha_emision, emisor: d.emisor_nombre, emisor_nit: d.emisor_nit,
            // Para la pestaña «Documento» de la carga: el mismo visor de Facturas
            // de compra, que firma estas rutas al abrirlas.
            json_path: d.json_path, pdf_path: d.pdf_path ?? null,
            tipo_dte: dte?.identificacion?.tipoDte ?? null,
            total: dte?.resumen?.montoTotalOperacion ?? dte?.resumen?.totalPagar ?? null,
          },
          encabezado: {
            proveedor: prov?.nombre ?? d.emisor_nombre,
            erp_supplier_id: prov?.supplier_id ?? null,
            dias_credito: diasCredito,
            dias_credito_origen: pago ? `resumen.pagos (plazo ${pago.plazo}, periodo ${pago.periodo})` : "el documento no lo trae",
            condicion_operacion: dte?.resumen?.condicionOperacion ?? null,
            tipo_operacion: prov?.f07_tipo_operacion ?? null,
            clasificacion: prov?.f07_clasificacion ?? null,
            tipo_costo_gasto: prov?.f07_tipo_costo_gasto ?? null,
            proveedor_clasificado: prov?.clasificacion_estado ?? "sin ficha",
          },
          resumen: {
            renglones: renglones.length,
            listos: renglones.filter((r) => r.listo).length,
            sin_producto: renglones.filter((r) => !r.producto_id).length,
            // Cuenta el producto que es una ADIVINANZA, no el renglón al que
            // le falta algo: el lote y el vencimiento ya se informan aparte, y
            // contarlos acá hacía que una factura sin lote —SUIZOS no lo
            // manda— dijera «6 a confirmar» con los 6 productos resueltos.
            a_confirmar: renglones.filter((r) => r.producto_id && !r.seguro).length,
            sin_lote: renglones.filter((r) => !r.lote).length,
            sin_vencimiento: renglones.filter((r) => !r.vence).length,
          },
          renglones: renglones.slice(0, Math.min(Number(max_items) || MAX_ITEMS, 300)),
        });
        continue;
      }

      salida.push({ ...base, items: items.slice(0, Math.min(Number(max_items) || MAX_ITEMS, 25)) });
    }

    return new Response(JSON.stringify({ documentos: salida }, null, 1), { headers: cors });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: cors,
    });
  }
});
