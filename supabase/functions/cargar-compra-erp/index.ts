// ── Cargar una compra en Bodega desde el portal (2026-10-29) ─────────────────
//
// Plan: docs/PLAN-CARGAR-COMPRAS-EN-BODEGA-2026-10-29.md.
//
// Por omisión, SIMULACRO. Arma el formulario exacto que el sistema de la caja
// recibiría (`_shared/compraSobre.ts`), lo revisa y lo deja escrito en
// `compra_carga` con estado `simulada`. Del sistema sólo LEE: las presentaciones
// de cada producto (`consultar_stock`, `getpresentacion`) y la tasa de
// percepción del proveedor (`datos_proveedores`). Ninguna de las tres escribe.
//
// El envío real (`enviar: true`, POST `compras.php` `process=insert`) es
// irreversible desde acá —sólo se deshace anulando la compra allá—. Está
// detrás del secreto `CARGA_COMPRA_ENVIO=on` y de los frenos de
// `enviarCompra`; sin el secreto contesta 409.
//
// La función confía en el navegador sólo para las DECISIONES (qué producto es
// cada renglón y su lote/vencimiento). Cantidades, costos y totales los vuelve a
// leer del documento guardado: así el formulario no puede llevar un número que
// el documento no dice.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";
import { BASE, login, pedir } from "../_shared/erp-dte.ts";
import { descartarUnaLinea } from "../_shared/erp-descarte.ts";
import { dteDeManual, validarManual } from "../_shared/compraManual.ts";
import {
  sesionEn, existenciasDeUbicacion, estadoDeRecepcion, traerFila, pendientesDeOrigen, identificarTrasladoNuevo, armarConcepto, hoySV,
  TRASLADO, RECIBIR,
} from "../_shared/erp-traslado.ts";
import {
  type Decision, type LineaSobre, type Problema, type ProductoDelSistema, type RenglonDoc,
  lineaDelSobre, tipoDocDe, totalDelDocumento, totalesDelSobre, leerModelo, sobreDeProductoNuevo, repartirRegalos,
} from "../_shared/compraSobre.ts";

const COMPRAS = `${BASE}/compras.php`;
const ERP_BODEGA = 6;
const BODEGA_BRANCH_ID = 30; // la de `sync-erp-purchases`
const TOLERANCIA = 0.05;
/** El genérico con el que entra lo que un proveedor mandó por error y no
 * tenemos en el catálogo. Creado el 2026-10-30 con OK del usuario, una sola
 * vez; lo que era de verdad queda en `compra_renglon_erroneo`. */
const PRODUCTO_ERRONEO = 5307;

/**
 * La UBICACIÓN de Bodega donde entra la compra: el campo `destino` del
 * formulario. En la sesión de Bodega el formulario ofrece «1 BODEGA» y
 * «2 BODEGA DE VENCIDOS».
 *
 * Estuvo escrito a mano como "3", que es la ubicación de SALUD 1 (copiado de
 * una página guardada con la sesión en esa sala). El sistema lo aceptó sin
 * quejarse: la primera compra real (6472, C. Imberton, 29-oct) dejó 150
 * unidades en «sucursal 6 · ubicación 3», un lugar que no es ni el estante de
 * Bodega ni Salud 1 — no se ven en ninguno de los dos inventarios.
 *
 * Por eso sale de `erp_sucursal_map`, la misma tabla que usan los traslados, y
 * si no se encuentra NO se manda.
 */
async function ubicacionDeBodega(admin: any, vencidos = false): Promise<number | null> {
  const { data, error } = await admin.from("erp_sucursal_map")
    .select("inv_ubicaciones").eq("erp_sucursal_id", ERP_BODEGA).maybeSingle();
  if (error) throw error;
  const lista = Array.isArray(data?.inv_ubicaciones) ? data.inv_ubicaciones as { id: number; isVencidos: boolean }[] : [];
  const id = Number(lista.find((u) => Boolean(u.isVencidos) === vencidos)?.id ?? 0);
  return id > 0 ? id : null;
}

// Las dos, iguales a las de `leer-dte-json`.
function desenvolver(j: any): any {
  return j?.dteJson ?? j?.documento ?? j;
}
function pathDeStorage(url: string | null): string | null {
  if (!url) return null;
  const i = url.indexOf("/purchase-dte/");
  return i < 0 ? null : decodeURIComponent(url.slice(i + "/purchase-dte/".length));
}
const normNum = (s: string) => s.replace(/\s/g, "").replace(/\./g, "").replace(/O/gi, "0").toUpperCase();

/** Las presentaciones de un producto en Bodega, con su tamaño. Sólo lectura. */
async function productoDelSistema(cookie: string, id: number): Promise<ProductoDelSistema | null> {
  const t = await pedir(cookie, COMPRAS, new URLSearchParams({
    process: "consultar_stock", tipo: "D", id_producto: String(id),
  }), { extra: { Referer: COMPRAS } });
  let j: any;
  try { j = JSON.parse(t); } catch { return null; }
  if (j?.typeinfo !== "Success") return null;
  // El texto de cada opción es el nombre de la presentación tal como lo ve
  // Bodega («UNIDAD», «CAJA X 30»): la pantalla lo muestra para que se sepa
  // EN QUÉ se carga, no sólo cuántas unidades entran.
  const opciones = [...String(j.select ?? "").matchAll(/<option[^>]*value=['"]?(\d+)['"]?[^>]*>([^<]*)/g)]
    .map((m) => ({ id: m[1], nombre: m[2].replace(/\s+/g, " ").trim() }));
  const presentaciones = [];
  for (const { id: id_presentacion, nombre } of opciones) {
    const p = await pedir(cookie, COMPRAS, new URLSearchParams({ process: "getpresentacion", id_presentacion }),
      { extra: { Referer: COMPRAS } });
    try {
      const jp = JSON.parse(p);
      presentaciones.push({ id: id_presentacion, unidad: Number(jp.unidad), costo: Number(jp.costo), precio: Number(jp.precio), nombre: nombre || undefined });
    } catch { /* una presentación ilegible no tumba las otras */ }
  }
  return {
    id, nombre: String(j.descrip ?? id),
    perecedero: String(j.perecedero) === "1", regulado: String(j.regulado) === "1",
    presentaciones,
  };
}


/** JSON con las claves ordenadas a todo nivel: igual para el mismo contenido. */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort()
      .map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * El envío real. Cinco frenos antes del POST, y ninguno sobra:
 * 1. la revisión de ESTA llamada no tiene problemas;
 * 2. lo que se manda es IDÉNTICO a lo que la persona revisó (`carga_id`): si
 *    entre la revisión y el clic cambió un precio o una presentación, se
 *    revisa de nuevo — nunca se manda algo que nadie vio;
 * 3. la fila pasa de `simulada` a `enviando` con el índice único de
 *    `compra_carga`: un doble clic o dos pestañas no mandan dos compras;
 * 4. el POST va UNA vez, sin reintento — `pedir()` reintenta, y reintentar un
 *    alta que quizá entró es duplicar la compra;
 * 5. si no se sabe qué pasó (se cortó la red), queda `sin_verificar` y no
 *    `fallida`: `fallida` deja volver a mandar, y eso sólo vale si el sistema
 *    DIJO que no.
 */
/** Lo de una revisión que mueve inventario fuera del sobre: reparto y erróneos. */
function loQueSeMueve(rev: any) {
  return {
    reparto: (rev?.reparto ?? []).map((l: any) => [l.renglon, l.branch_id, l.erp_product_id, l.paquetes, l.unidad]),
    erroneos: (rev?.erroneos ?? []).map((e: any) => [e.renglon, e.product_id, e.unidades]),
  };
}

async function enviarCompra(admin: any, x: {
  cookie: string; documentId: number | null; manualId: number | null; cargaId: number; sobre: Record<string, unknown>;
  revision: any; lineas: LineaSobre[]; erpProveedor: number;
  quien: string; emisor: { nit: string | null; nombre: string | null };
  numeroControl: string | null; totalDoc: number | null;
}) {
  if (!x.revision.listo) return { enviada: false, revision: x.revision, error: "La revisión tiene problemas: no se mandó." };
  if (!Number.isFinite(x.cargaId)) return { enviada: false, error: "Falta la revisión que se aprobó." };

  const { data: rev, error: eR } = await admin.from("compra_carga").select("id, document_id, manual_id, estado, sobre, revision, created_at")
    .eq("id", x.cargaId).maybeSingle();
  if (eR) throw eR;
  if (!rev || (rev.document_id ?? null) !== x.documentId || (rev.manual_id ?? null) !== x.manualId || rev.estado !== "simulada") {
    return { enviada: false, error: "Esa revisión ya no vale: revisa la carga de nuevo." };
  }
  if (Date.now() - new Date(rev.created_at).getTime() > 30 * 60_000) {
    return { enviada: false, error: "La revisión tiene más de 30 minutos: revisa la carga de nuevo." };
  }
  // Con las claves ORDENADAS: `jsonb` guarda el objeto con su propio orden
  // (largo de la clave, después alfabético), así que comparar el texto tal
  // cual daba «algo cambió» siempre — pasó en la primera prueba, 29-oct.
  if (canonico(rev.sobre) !== canonico(x.sobre)) {
    return { enviada: false, error: "Algo cambió desde la revisión (un precio, una presentación): revisa la carga de nuevo." };
  }
  // El reparto a salas y lo marcado como error NO van dentro del sobre, y
  // también mueven inventario: tienen que ser los mismos que se revisaron.
  if (canonico(loQueSeMueve(rev.revision)) !== canonico(loQueSeMueve(x.revision))) {
    return { enviada: false, error: "Cambió lo que va a las salas o lo marcado como error: revisa la carga de nuevo." };
  }
  // Freno de la ubicación: una revisión guardada antes del arreglo trae
  // `destino` "3" (Salud 1). Se compara contra la ubicación VIVA de Bodega.
  const estante = await ubicacionDeBodega(admin, false);
  if (!estante) return { enviada: false, error: "No se conoce la ubicación de Bodega: no se mandó." };
  if (String(x.sobre.destino) !== String(estante)) {
    return { enviada: false, error: "La revisión apunta a otra ubicación: revisa la carga de nuevo." };
  }

  // Freno 2b: que Bodega no la tenga YA. `purchase_receipts` (freno de la
  // revisión) es un espejo que va hasta 10 minutos atrás, y Bodega carga con el
  // día de la carga mientras el portal manda la emisión: se mira en vivo, de la
  // emisión a hoy, en la lista liviana. Si no se puede mirar, no se manda.
  const yaEsta = await (x.manualId
    ? papelYaRegistrado(x.cookie, String(x.sobre.numero_doc), String(x.sobre.tipo_doc), x.erpProveedor)
    : yaEnBodega(x.cookie, String(x.sobre.fecha), String(x.sobre.numero_doc),
        { control: x.numeroControl, totales: [x.totalDoc, Number(x.sobre.total)] }))
    .catch((e) => ({ error: String(e?.message ?? e) }));
  if ("error" in yaEsta) return { enviada: false, error: `No se pudo comprobar si Bodega ya la tiene: ${yaEsta.error}` };
  if (yaEsta.compra) return { enviada: false, error: `Bodega ya la tiene cargada (compra ${yaEsta.compra}): no se mandó.` };

  // Freno 2c: la existencia del ESTANTE antes de mandar, para comprobar después
  // que la compra entró AHÍ. El «Success» del sistema y leer la compra de
  // vuelta no lo dicen: la 6472 pasó las dos verificaciones con sus 150
  // unidades en una ubicación que no era la de Bodega. Sin esta lectura no se
  // manda — no habría cómo saber dónde quedó.
  // Lo que entra al estante: sólo productos (una compra para consumo no mueve
  // inventario, y su `id_producto` no es un número).
  const esperado = new Map<number, number>();
  for (const l of JSON.parse(String(x.sobre.json_arr)) as { id_producto: string; cant: string; unidad: string }[]) {
    const id = Number(l.id_producto);
    if (!(id > 0)) continue;
    esperado.set(id, (esperado.get(id) ?? 0) + Number(l.cant) * (Number(l.unidad) || 1));
  }
  const estanteAntes = esperado.size ? await existenciasDeUbicacion(x.cookie, ERP_BODEGA, estante) : new Map<number, number>();
  if (!estanteAntes) return { enviada: false, error: "No se pudo leer la existencia de Bodega para comprobar la carga: no se mandó." };

  const { data: tomada, error: eT } = await admin.from("compra_carga")
    .update({ estado: "enviando", updated_at: new Date().toISOString() })
    .eq("id", x.cargaId).eq("estado", "simulada").select("id");
  if (eT) {
    if (eT.code === "23505") return { enviada: false, error: "Esta compra ya se mandó desde el portal." };
    throw eT;
  }
  if (!tomada?.length) return { enviada: false, error: "Esa revisión ya se usó." };

  // Si anotar falla, al menos queda en el registro con lo que pasó: la fila se
  // queda en `enviando` y el barrido de trabados la pasa a revisar.
  const marcar = async (estado: string, extra: Record<string, unknown> = {}) => {
    const { error } = await admin.from("compra_carga").update({ estado, updated_at: new Date().toISOString(), ...extra }).eq("id", x.cargaId);
    if (error) console.error("[cargar-compra-erp] anotar la carga", x.cargaId, estado, JSON.stringify(extra).slice(0, 300), error.message);
  };

  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(x.sobre)) {
    if (Array.isArray(v)) { if (v.length) form.set(k, JSON.stringify(v)); continue; } // jQuery omite el arreglo vacío
    form.set(k, String(v));
  }

  let texto: string;
  try {
    const res = await fetch(COMPRAS, {
      method: "POST",
      headers: {
        Cookie: x.cookie, "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest",
        Referer: COMPRAS, "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(90_000),
    });
    texto = await res.text();
  } catch (e: any) {
    await marcar("sin_verificar", { error: `Sin respuesta del sistema: ${e?.message ?? e}` });
    return { enviada: null, error: "El sistema no contestó. Puede haber entrado: NO la mandes de nuevo; avisa a Bodega para que la busque." };
  }

  let j: any = null;
  try { j = JSON.parse(texto); } catch { /* abajo */ }
  if (!j) {
    // Entero (hasta 4000): en la primera prueba sólo se guardaron 300
    // caracteres y la parte que decía qué consulta falló quedó afuera.
    await marcar("sin_verificar", { error: `Respuesta ilegible: ${texto.slice(0, 4000)}` });
    return { enviada: null, error: "El sistema contestó algo que no se entiende. Puede haber entrado: NO la mandes de nuevo." };
  }
  if (String(j.typeinfo).toLowerCase() !== "success") {
    await marcar("fallida", { error: String(j.msg ?? "rechazada") });
    return { enviada: false, error: `El sistema no la aceptó: ${j.msg ?? "sin motivo"}` };
  }

  // ── Leerla de vuelta ───────────────────────────────────────────────────────
  const verif = await leerDeVuelta(x.cookie, x.sobre, x.lineas, x.erpProveedor).catch((e) => ({ ok: false, compra: null, notas: [`No se pudo leer de vuelta: ${e?.message ?? e}`] }));
  // ¿Entró al estante? Cada producto tiene que haber subido al menos lo que se
  // cargó (en unidades). Una venta o un traslado en el medio puede dar un
  // falso aviso; preferible a no enterarse de que la mercadería no está.
  const estanteDespues = esperado.size ? await existenciasDeUbicacion(x.cookie, ERP_BODEGA, estante) : new Map<number, number>();
  if (!estanteDespues) {
    verif.ok = false; verif.notas.push("No se pudo leer la existencia de Bodega después de cargar: comprobar que entró al estante.");
  } else {
    const faltan = [...esperado].filter(([id, u]) => (estanteDespues.get(id) ?? 0) - (estanteAntes.get(id) ?? 0) < u);
    if (faltan.length) {
      verif.ok = false;
      verif.notas.push(`No entró al estante de Bodega: ${faltan.map(([id, u]) => `producto ${id} debía subir ${u} y subió ${(estanteDespues.get(id) ?? 0) - (estanteAntes.get(id) ?? 0)}`).join("; ")}.`);
    }
  }
  await marcar(verif.ok ? "verificada" : "sin_verificar", {
    erp_compra_id: verif.compra, error: verif.notas.length ? verif.notas.join(" · ") : null,
  });
  // El papel ya entró: sale de la lista de facturas en papel por cargar.
  if (x.manualId) {
    const { error: eM } = await admin.from("compra_documento_manual")
      .update({ estado: "cargada", updated_at: new Date().toISOString() }).eq("id", x.manualId);
    if (eM) console.error("[cargar-compra-erp] papel cargado:", eM.message);
  }
  // Traerla al portal ya. El cron de compras mira ayer y hoy por la fecha de
  // la compra, y ésta lleva la de EMISIÓN: sin esto entraba recién con el
  // barrido del domingo (10 días) o nunca. Después de responder, sin esperarla.
  EdgeRuntime.waitUntil(fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-erp-purchases`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("ADMIN_INVOKE_SECRET") ?? ""}` },
    body: JSON.stringify({ fini: x.sobre.fecha, ffin: x.sobre.fecha, branchId: BODEGA_BRANCH_ID }),
    signal: AbortSignal.timeout(140_000),
  }).then((r) => { if (!r.ok) console.error("[cargar-compra-erp] traerla al portal:", r.status); })
    .catch((e) => console.error("[cargar-compra-erp] traerla al portal:", e?.message ?? e)));
  // El costo subió y el precio de venta ya no deja margen: avisar a quien ve
  // costos. Sin esperar, y sin que un fallo del aviso toque la carga.
  EdgeRuntime.waitUntil(avisarMargenBajo(admin, x.revision, x.emisor.nombre, verif.compra)
    .catch((e) => console.error("[cargar-compra-erp] aviso de margen:", e?.message ?? e)));

  // Lo marcado como error del proveedor: se anota y, si la compra se
  // comprobó en el estante, se pasa a Bodega de vencidos.
  // En segundo plano, como el reparto: son ~10 viajes al sistema y la
  // respuesta ya va cerca del límite de la función. El resultado queda en
  // `compra_renglon_erroneo` (pestaña «Por error»).
  let vencidos: unknown = null;
  const errs: Erroneo[] = x.revision.erroneos ?? [];
  if (errs.length) {
    vencidos = { en_curso: verif.ok, cuantos: errs.length };
    EdgeRuntime.waitUntil(apartarErroneos(admin, x.cookie, errs, {
      cargaId: x.cargaId, documentId: x.documentId, manualId: x.manualId, quien: x.quien, emisor: x.emisor,
      erpCompra: verif.compra, lineas: x.lineas, mover: verif.ok, estante,
    }).catch((e) => console.error("[cargar-compra-erp] erróneos:", e?.message ?? e)));
  }
  // El reparto a salas, en background: son varios viajes al sistema por sala y
  // la respuesta no los espera. El rastro queda en `compra_reparto`.
  const repartoPedido: LineaReparto[] = x.revision.reparto ?? [];
  if (repartoPedido.length) {
    EdgeRuntime.waitUntil(repartirASalas(admin, x.cookie, repartoPedido, {
      cargaId: x.cargaId, quien: x.quien, emisor: x.emisor.nombre, erpCompra: verif.compra, mover: verif.ok, estante,
    }).catch((e) => console.error("[cargar-compra-erp] reparto:", e?.message ?? e)));
  }
  return {
    enviada: true, verificada: verif.ok, erp_compra_id: verif.compra, notas: verif.notas, msg: j.msg ?? null, vencidos,
    reparto: repartoPedido.length ? { salas: new Set(repartoPedido.map((l) => l.branch_id)).size, enviando: verif.ok } : null,
  };
}

/**
 * ¿Bodega ya tiene este documento? Lista liviana de Admin Compras
 * (`admin_compras_fecha_dt.php`: id, tipo, número, … fecha) de la emisión a
 * hoy. La sucursal es estado de la sesión, y la de `sesionEn` ya es Bodega.
 * El número guardado son 20 caracteres del código de generación: con eso se
 * compara. Una anulada también frena — en la duda, no se manda.
 */
async function yaEnBodega(cookie: string, desde: string, numero: string,
  alt: { control: string | null; totales: (number | null)[] } = { control: null, totales: [] },
): Promise<{ compra: number | null }> {
  const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
  const qs = `fechai=${desde}&fechaf=${hoy < desde ? desde : hoy}&draw=1&start=0&length=5000`;
  const t = await pedir(cookie, `${BASE}/admin_compras_fecha_dt.php?${qs}`, undefined, { timeoutMs: 60_000 });
  const lista = JSON.parse(t);
  const filas: any[][] = lista?.data;
  if (!Array.isArray(filas)) throw new Error("la lista de compras no vino");
  // Una lista recortada diría «no está» de una que sí está: mejor no mandar.
  if (Number(lista?.recordsFiltered ?? 0) > filas.length) throw new Error("la lista de compras vino incompleta");
  const buscado = numero.toUpperCase();
  // Bodega a veces la carga con el NÚMERO DE CONTROL (65 de 1,013 desde
  // agosto). Sus 20 caracteres se repiten entre facturas del mismo emisor
  // («DTE-03-M001P001-0000»), así que ahí manda además el total.
  const control = String(alt.control ?? "").toUpperCase();
  const totales = alt.totales.filter((t): t is number => t != null && Number.isFinite(t));
  const f = filas.find((r) => {
    const n = String(r[2] ?? "").replace(/<[^>]*>/g, "").trim().toUpperCase();
    if (n.length >= 8 && buscado.startsWith(n)) return true;
    return n.length >= 15 && control.startsWith(n) && totales.some((t) => Math.abs(Number(r[5]) - t) <= 0.05);
  });
  return { compra: f ? Number(f[0]) || -1 : null };
}

/**
 * ¿Ese papel ya está registrado para ese proveedor? Es la MISMA pregunta que
 * hace el formulario del sistema antes de guardar (`validarNumdoc`, sólo
 * lectura): un número impreso es corto («005342») y sólo es único dentro de
 * su proveedor, así que la lista por fecha que sirve para el DTE no alcanza.
 */
async function papelYaRegistrado(cookie: string, numero: string, tipo: string, proveedor: number): Promise<{ compra: number | null }> {
  const t = await pedir(cookie, COMPRAS, new URLSearchParams({
    process: "validarNumdoc", numeroDocImpreso: numero, tipo_impresion: tipo, id_proveedor: String(proveedor),
  }), { extra: { Referer: COMPRAS } });
  const j = JSON.parse(t);
  if (typeof j?.valido !== "boolean") throw new Error("el sistema no dijo si el número está libre");
  return { compra: j.valido ? null : -1 };
}

/** Los proveedores que se pueden elegir para un papel: los que el sistema conoce. */
async function proveedoresParaPapel(admin: any) {
  const { data, error } = await admin.from("proveedores_maestro")
    .select("nit, nombre, dias_credito, suppliers!inner(erp_supplier_id)")
    .not("suppliers.erp_supplier_id", "is", null).order("nombre");
  if (error) throw error;
  return {
    proveedores: (data ?? []).map((p: any) => ({
      nit: p.nit, nombre: p.nombre, dias_credito: p.dias_credito ?? null, erp_supplier_id: p.suppliers?.erp_supplier_id,
    })),
  };
}

/**
 * Guarda (o corrige, mientras sea borrador) una factura en papel. Antes le
 * pregunta al sistema si ese número ya está registrado para ese proveedor —
 * escribir el papel entero para enterarse en el envío sería tiempo perdido.
 */
async function guardarPapel(admin: any, x: any, quien: string) {
  const v = validarManual(x);
  if (!v.ok) return { error: v.error };
  const { data: pm, error: eP } = await admin.from("proveedores_maestro")
    .select("nit, nombre, suppliers!inner(erp_supplier_id)").eq("nit", String(x?.proveedor_nit ?? "")).maybeSingle();
  if (eP) throw eP;
  const erp = pm?.suppliers?.erp_supplier_id;
  if (!erp) return { error: "Elige el proveedor." };
  const fila = { ...v.fila, proveedor_nit: pm.nit, proveedor_nombre: pm.nombre, erp_supplier_id: erp };

  const cookie = await sesionEn(ERP_BODEGA, login);
  const ya = await papelYaRegistrado(cookie, String(fila.numero), String(fila.tipo_doc), erp).catch(() => null);
  if (ya?.compra) return { error: `Esa factura de ${pm.nombre} ya está registrada en Bodega.` };

  const id = Number(x?.id) > 0 ? Number(x.id) : null;
  const q = id
    ? admin.from("compra_documento_manual").update({ ...fila, updated_at: new Date().toISOString() }).eq("id", id).eq("estado", "borrador")
    : admin.from("compra_documento_manual").insert({ ...fila, creado_por: quien });
  const { data, error } = await q.select("id");
  if (error) {
    if (error.code === "23505") return { error: "Esa factura ya está escrita en el portal: búscala en «Facturas en papel»." };
    throw error;
  }
  if (!data?.length) return { error: "Esa factura ya no se puede cambiar." };
  return { manual_id: data[0].id, comprobado: ya != null };
}

/** Busca la compra recién hecha en la lista de su fecha y compara renglón por renglón. */
async function leerDeVuelta(cookie: string, sobre: Record<string, unknown>, lineas: LineaSobre[], erpProveedor: number) {
  const dia = String(sobre.fecha);
  const t = await pedir(cookie, `${BASE}/descargar_compras_json.php?fini=${dia}&ffin=${dia}&id_sucursal=${ERP_BODEGA}`,
    undefined, { timeoutMs: 90_000 });
  const compras: any[] = JSON.parse(t)?.compras ?? [];
  const numero = String(sobre.numero_doc).toUpperCase();
  // Un papel (clase 1) lleva su número entero y corto: igualdad. Un DTE, el
  // código recortado a 20: por el comienzo.
  const papel = String(sobre.clase_documento_tributario) === "1";
  const c = compras.find((k) => {
    const n = String(k.documento?.numero ?? "").trim().toUpperCase();
    return !k.anulada && Number(k.proveedor?.id) === erpProveedor
      && (papel ? n === numero : n.length >= 8 && numero.startsWith(n));
  });
  if (!c) return { ok: false, compra: null, notas: ["Entró, pero no aparece en la lista de compras de la fecha de la factura."] };

  const notas: string[] = [];
  const total = Number(c.totales?.total_operacion);
  if (!(Math.abs(total - Number(sobre.total)) <= TOLERANCIA)) notas.push(`Total en el sistema $${total} contra $${sobre.total}.`);
  const items: any[] = c.items ?? [];
  const productos = lineas.filter((l) => l.bandera === "PRODUCTO");
  // Los servicios (consumo) no se sabe todavía si salen en esta lista: el
  // conteo sólo se exige cuando la compra es toda de productos.
  if (productos.length === lineas.length && items.length !== lineas.length) {
    notas.push(`El sistema tiene ${items.length} renglones y se mandaron ${lineas.length}.`);
  }
  // Agrupado por producto (uno puede venir en dos renglones). Se acepta la
  // cantidad en unidades o en la presentación: la lista no dice en cuál está,
  // y las compras medidas eran todas de 1 unidad.
  const porProducto = new Map<string, { cant: number; unidades: number }>();
  for (const l of productos) {
    const a = porProducto.get(l.id_producto) ?? { cant: 0, unidades: 0 };
    a.cant += Number(l.cant); a.unidades += Number(l.cant) * Number(l.unidad);
    porProducto.set(l.id_producto, a);
  }
  for (const [id, e] of porProducto) {
    const delSistema = items.filter((it) => String(it.producto_id) === id).reduce((a, it) => a + Number(it.cantidad), 0);
    if (Math.abs(delSistema - e.unidades) > 0.001 && Math.abs(delSistema - e.cant) > 0.001) {
      notas.push(`Producto ${id}: ${delSistema} en el sistema, se esperaban ${e.unidades} unidades.`);
    }
  }
  return { ok: notas.length === 0, compra: Number(c.compra_id) || null, notas };
}

/** El texto de la opción elegida de un `<select>` de la pantalla del sistema. */

/**
 * Producto nuevo copiando a uno parecido — SIMULACRO. Lee la pantalla de
 * edición del modelo (un GET) y arma el alta tal como la mandaría el
 * formulario del sistema, sin mandarla.
 */
/**
 * Da de alta el producto en el sistema, con el MISMO sobre que se acaba de
 * revisar (se rearma en el servidor; nada viene del navegador).
 *
 * 1. Toma la fila en `producto_alta_portal` (nombre y código únicos): un doble
 *    clic o un reintento chocan ahí y no crean dos productos.
 * 2. Manda `agregar_producto.php` como lo hace su formulario.
 * 3. Lo LEE de vuelta en su ficha: el «Success» no alcanza (ver la compra
 *    6472, que dijo «Hecho» con la mercadería en otra ubicación).
 * 4. Lo agrega al catálogo del portal para poder elegirlo en la carga ya.
 */
async function crearProducto(
  admin: any, cookie: string, sobre: Record<string, string>,
  x: { nombre: string; barcode: string; modeloId: number; costo: number; precio: number; quien: string },
) {
  const { data: fila, error: eF } = await admin.from("producto_alta_portal").insert({
    nombre: x.nombre, barcode: x.barcode || null, modelo_id: x.modeloId,
    costo: x.costo, precio: x.precio, creado_por: x.quien,
  }).select("id").single();
  if (eF) {
    if (eF.code === "23505") return { error: "Ese producto ya se dio de alta desde el portal (o se está dando ahora)." };
    throw eF;
  }
  const marcar = (estado: string, extra: Record<string, unknown> = {}) =>
    admin.from("producto_alta_portal").update({ estado, updated_at: new Date().toISOString(), ...extra }).eq("id", fila.id);

  let texto: string;
  try {
    texto = await pedir(cookie, `${BASE}/agregar_producto.php`, new URLSearchParams(sobre),
      { extra: { Referer: `${BASE}/agregar_producto.php` }, reintentos: 1 });
  } catch (e) {
    // No se sabe si llegó: la fila queda tomada para que no se mande a ciegas.
    await marcar("sin_verificar", { error: `Sin respuesta: ${(e as Error)?.message ?? e}` });
    return { error: "El sistema no contestó. Puede haberse creado: NO lo vuelvas a crear; búscalo primero." };
  }
  let j: any = null;
  try { j = JSON.parse(texto); } catch { /* abajo */ }
  if (!j) {
    await marcar("sin_verificar", { error: `Respuesta ilegible: ${texto.slice(0, 4000)}` });
    return { error: "El sistema contestó algo que no se entiende. Puede haberse creado: NO lo vuelvas a crear; búscalo primero." };
  }
  if (String(j.typeinfo).toLowerCase() !== "success") {
    await marcar("fallido", { error: String(j.msg ?? "rechazado") });
    return { error: `El sistema no lo aceptó: ${j.msg ?? "sin motivo"}` };
  }
  const id = Number(j.id_producto);
  if (!(id > 0)) {
    await marcar("sin_verificar", { error: `Sin número de producto: ${texto.slice(0, 500)}` });
    return { error: "Se creó pero el sistema no dijo con qué número. Búscalo por nombre antes de volver a crearlo." };
  }

  // Leerlo de vuelta: que exista con ese nombre y tenga su presentación. Si
  // la lectura falla, el producto YA existe: se anota su número igual.
  let html: string;
  try {
    html = await pedir(cookie, `${BASE}/editar_producto.php?id_producto=${id}`, undefined, { extra: { Referer: `${BASE}/admin_producto.php` } });
  } catch (e) {
    await marcar("sin_verificar", { erp_product_id: id, error: `Creado, sin poder leerlo: ${(e as Error)?.message ?? e}` });
    const { error: eP0 } = await admin.rpc("upsert_products_minimal", { p_rows: [{ id, nombre: x.nombre }] });
    if (eP0) throw eP0;
    return { creado: true, verificado: false, producto: { id, nombre: x.nombre }, notas: ["no se pudo leer la ficha recién creada"] };
  }
  const leido = leerModelo(id, html);
  const notas: string[] = [];
  if (leido.nombre.toUpperCase() !== x.nombre) notas.push(`la ficha dice «${leido.nombre}»`);
  if (!leido.precios) notas.push("no tiene presentación de 1 unidad activa");
  else if (Math.abs(leido.precios[0] - x.precio) > 0.005) notas.push(`el precio quedó en $${leido.precios[0].toFixed(2)}`);
  await marcar(notas.length ? "sin_verificar" : "creado", { erp_product_id: id, error: notas.length ? notas.join(" · ") : null });

  const { error: eP } = await admin.rpc("upsert_products_minimal", { p_rows: [{ id, nombre: leido.nombre || x.nombre }] });
  if (eP) throw eP;
  return { creado: true, verificado: notas.length === 0, producto: { id, nombre: leido.nombre || x.nombre }, notas };
}

/** Las opciones de un <select> del formulario del sistema, sin «Seleccione». */
function opcionesDe(html: string, id: string): { value: string; label: string }[] {
  const m = new RegExp(`<select[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</select>`).exec(html);
  return [...(m?.[1] ?? "").matchAll(/<option[^>]*value=["']([^"']+)["'][^>]*>([^<]*)</g)]
    .map((o) => ({ value: o[1], label: o[2].trim() })).filter((o) => o.value);
}

/**
 * El alta de un producto que la compra trae y Bodega no tiene.
 *
 * Pide lo MISMO que `agregar_producto.php` —proveedor, categoría,
 * laboratorio, marca, si vence, si es exento, si se vende por fracción, y la
 * presentación de 1 unidad con su costo y precio— pero llega prellenado:
 * - el proveedor es el de la factura;
 * - si el renglón se parece a un producto que ya existe, se copian de él la
 *   categoría, el laboratorio, la marca y las casillas, y el precio sugerido
 *   guarda su mismo margen;
 * - nombre y código de barras salen del renglón.
 * Todo se puede cambiar. Con `crear` lo da de alta; sin él sólo revisa.
 * Un producto regulado o antibiótico no se da de alta desde acá.
 */
/** Margen bajo: la MISMA regla del catálogo (`marginLabel`): menos de 15 %. */
const MARGEN_MINIMO = 15;

/**
 * Los renglones de la compra recién cargada cuyo costo SUBIÓ y cuyo precio de
 * venta actual deja menos de 15 % de margen (o pérdida). Se avisa a quien
 * tiene el permiso de ver costos —que es quien puede decidir un precio—, con
 * la lista: producto, costo de antes y de ahora, precio y margen.
 */
async function avisarMargenBajo(admin: any, revision: any, proveedor: string | null, compra: number | null) {
  const malos: { producto: string; antes: number; ahora: number; venta: number; margen: number }[] = [];
  for (const x of revision?.renglones ?? []) {
    const l = x?.linea;
    if (!l || l.bandera !== "PRODUCTO" || Number(l.id_producto) === PRODUCTO_ERRONEO) continue;
    const ahora = Number(l.compra), venta = Number(l.venta), antes = Number(x.costo_anterior);
    if (!(ahora > 0) || !(venta > 0) || !(antes > 0)) continue;
    if ((ahora - antes) / antes * 100 < 0.5) continue;
    const margen = (venta - ahora) / venta * 100;
    if (margen >= MARGEN_MINIMO) continue;
    malos.push({ producto: String(x.descripcion ?? l.id_producto), antes, ahora, venta, margen: Math.round(margen * 10) / 10 });
  }
  if (!malos.length) return;

  const { data: perm, error: eP } = await admin.from("role_permissions").select("role_id")
    .eq("module_key", "productos_ver_costos").eq("can_view", true);
  if (eP) throw eP;
  const { data: roles, error: eR } = await admin.from("roles").select("id, name").in("id", (perm ?? []).map((p: any) => p.role_id));
  if (eR) throw eR;
  const ids = (roles ?? []).filter((r: any) => !/^QA\b/i.test(r.name)).map((r: any) => r.id);
  if (!ids.length) return;
  const { data: gente, error: eG } = await admin.from("employees").select("id")
    .eq("status", "ACTIVO").or(`role_id.in.(${ids.join(",")}),secondary_role_id.in.(${ids.join(",")})`)
    .or("tipo_ficha.is.null,tipo_ficha.eq.empleado");
  if (eG) throw eG;
  if (!gente?.length) return;

  const m = (n: number) => `$${n.toFixed(2)}`;
  const lista = malos.slice(0, 8).map((x) =>
    `${x.producto}: costo ${m(x.antes)} → ${m(x.ahora)}, precio ${m(x.venta)}, margen ${x.margen} %`).join("; ");
  const { error } = await admin.rpc("notify_employees", {
    p_recipients: gente.map((e: any) => e.id), p_type: "COMPRA_MARGEN_BAJO",
    p_title: malos.length === 1 ? `Subió un costo y el margen quedó bajo` : `Subieron ${malos.length} costos y el margen quedó bajo`,
    p_body: `En la compra${compra ? ` ${compra}` : ""} de ${proveedor ?? "un proveedor"}: ${lista}`
      + (malos.length > 8 ? ` y ${malos.length - 8} más` : "") + ". Revisa el precio de venta.",
    p_link: "/compras?tab=productos", p_metadata: { origen: "cargar-compra", compra, productos: malos },
    p_push: true, p_branch_id: BODEGA_BRANCH_ID,
  });
  if (error) throw error;
}

/* ── Reparto a salas ─────────────────────────────────────────────────────────
 *
 * Al cargar, Bodega dice cuánto de cada renglón va a cada sala (usuario,
 * 2026-10-30: «al cargar pregunta si se enviará a otra sucursal, y ahí se pone
 * la cantidad … si se envía menos, que avise que quedará tanto en Bodega»).
 * La compra entra ENTERA al estante de Bodega —es lo que dice la factura— y
 * después sale un traslado por sala. La sala lo recibe desde Traslados, y si
 * la factura no traía vencimiento lo pone ahí: es quien tiene la caja enfrente.
 * El rastro es `compra_reparto`, una fila por sala.
 */
type Sala = { branch_id: number; erp: number; nombre: string; ubic: number };
type LineaReparto = {
  linea_idx?: number; renglon: number; descripcion: string; branch_id: number; erp_product_id: number;
  id_presentacion: string; unidad: number; paquetes: number; compra: string; venta: string;
  vence: string; vence_pendiente: boolean; numero_lote: string | null;
};

async function salasDeReparto(admin: any): Promise<Map<number, Sala>> {
  const { data, error } = await admin.from("erp_sucursal_map")
    .select("erp_sucursal_id, branch_id, nombre, es_bodega, inv_ubicaciones").eq("es_bodega", false);
  if (error) throw error;
  const m = new Map<number, Sala>();
  for (const r of data ?? []) {
    const ubic = Number((r.inv_ubicaciones ?? []).find((u: any) => !u.isVencidos)?.id ?? 0);
    if (r.branch_id && ubic > 0) m.set(Number(r.branch_id), { branch_id: Number(r.branch_id), erp: Number(r.erp_sucursal_id), nombre: String(r.nombre), ubic });
  }
  return m;
}

/** Las filas de `recibir_traslado.php` tal como la pantalla las manda. */
function filasDeRecepcion(html: string) {
  const out: { idProd: string; compra: string; venta: string; esp: string; unidad: string; vence: string; idPres: string }[] = [];
  for (const tr of [...html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]).filter((t) => /class="id_p"/.test(t))) {
    const idProd = tr.match(/class="id_p">\s*(\d+)/)?.[1] ?? "";
    const idPres = tr.match(/<select[^>]*class=['"]sel['"][^>]*>\s*<option[^>]*value=['"](\d+)['"]/)?.[1] ?? "";
    if (!idProd || !idPres) continue;
    out.push({
      idProd, idPres,
      compra: tr.match(/class=['"][^'"]*precio_compra[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0",
      venta: tr.match(/class=['"][^'"]*precio_venta[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0",
      unidad: tr.match(/class=['"]unidad['"][^>]*value=['"](\d+)/)?.[1] ?? "1",
      esp: tr.match(/class=['"][^'"]*\besp\b[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0",
      vence: tr.match(/class=['"][^'"]*\bvence\b[^'"]*['"][^>]*value=['"]([^'"]*)['"]/)?.[1] ?? "",
    });
  }
  return out;
}

/** Avisa a la gente activa de una sala (campana y push). */
async function avisarSala(admin: any, branchId: number, titulo: string, cuerpo: string, meta: Record<string, unknown>) {
  const { data: gente, error } = await admin.from("employees").select("id")
    .eq("status", "ACTIVO").eq("branch_id", branchId).or("tipo_ficha.is.null,tipo_ficha.eq.empleado");
  if (error) throw error;
  if (!gente?.length) return;
  const { error: eN } = await admin.rpc("notify_employees", {
    p_recipients: gente.map((e: any) => e.id), p_type: "COMPRA_REPARTO", p_title: titulo, p_body: cuerpo,
    p_link: "/traslados?tab=recibir", p_metadata: { origen: "cargar-compra", ...meta }, p_push: true, p_branch_id: branchId,
  });
  if (eN) throw eN;
}

/**
 * Manda a cada sala lo que se le repartió: un traslado del estante de Bodega
 * por sala. Corre en background después de la carga; lo que no sale queda en
 * `compra_reparto` como `fallido` con su nota, a la vista de Bodega.
 */
async function repartirASalas(admin: any, cookie: string, lineas: LineaReparto[], x: {
  cargaId: number; quien: string; emisor: string | null; erpCompra: number | null; mover: boolean; estante: number;
}) {
  const salas = await salasDeReparto(admin);
  const porSala = new Map<number, LineaReparto[]>();
  for (const l of lineas) porSala.set(l.branch_id, [...(porSala.get(l.branch_id) ?? []), l]);
  const { error: eI } = await admin.from("compra_reparto").upsert([...porSala].map(([b, ls]) => ({
    compra_carga_id: x.cargaId, branch_id: b, erp_sucursal_id: salas.get(b)?.erp ?? 0, erp_compra_id: x.erpCompra,
    emisor_nombre: x.emisor, lineas: ls, estado: "por_enviar", enviado_por: x.quien,
    nota: x.mover ? null : "La compra no se pudo comprobar en el estante: no se envió. Enviarlo a mano.",
  })), { onConflict: "compra_carga_id,branch_id", ignoreDuplicates: true });
  if (eI) throw eI;
  if (!x.mover) return;

  // La fila de un producto en el estante es la misma para todas las salas.
  const filas = new Map<number, Awaited<ReturnType<typeof traerFila>>>();
  for (const [branchId, ls] of porSala) {
    const sala = salas.get(branchId);
    const fila = async (cambios: Record<string, unknown>) => {
      const { error } = await admin.from("compra_reparto")
        .update({ ...cambios, updated_at: new Date().toISOString() }).eq("compra_carga_id", x.cargaId).eq("branch_id", branchId);
      if (error) console.error("[cargar-compra-erp] anotar el reparto", x.cargaId, branchId, JSON.stringify(cambios).slice(0, 300), error.message);
    };
    if (!sala) continue;   // antes de tomarla: si no, quedaba «saliendo» sin haber mandado nada
    const { data: tomada, error: eT } = await admin.from("compra_reparto").update({ estado: "enviando", updated_at: new Date().toISOString() })
      .eq("compra_carga_id", x.cargaId).eq("branch_id", branchId).eq("estado", "por_enviar").select("id");
    if (eT) throw eT;
    if (!tomada?.length) continue;
    let mandado = false;
    try {
      const partes: string[] = [];
      let total = 0;
      for (const l of ls) {
        if (!filas.has(l.erp_product_id)) filas.set(l.erp_product_id, await traerFila(cookie, l.erp_product_id, x.estante));
        const f = filas.get(l.erp_product_id)!;
        if (!f.presentaciones.some((p) => p.id === String(l.id_presentacion))) throw new Error(`«${l.descripcion}»: su presentación no aparece en el estante.`);
        let idLote = "0";
        if (f.regulado) {
          const lote = f.lotes.find((z) => z.numero === String(l.numero_lote ?? ""));
          if (!lote) throw new Error(`«${l.descripcion}»: el lote ${l.numero_lote} no aparece en el estante.`);
          idLote = lote.id;
        }
        partes.push([l.erp_product_id, l.compra, l.venta, l.paquetes, l.unidad, l.vence || f.vence || "", l.id_presentacion, idLote].join("|"));
        total += Number(l.compra) * l.paquetes;
      }
      const pagina = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
      const vale = pagina.match(/numero_vale["'][^>]*value=["']([^"']+)["']/)?.[1] ?? "";
      if (!vale) throw new Error("El sistema no entregó el número de vale.");
      const antes = await pendientesDeOrigen(cookie, x.estante);
      mandado = true;
      const r = await pedir(cookie, TRASLADO, new URLSearchParams({
        process: "insert", datos: partes.join("#") + "#", id_traslado_guardado: "0", cuantos: String(partes.length),
        total: total.toFixed(4), fecha: hoySV(),
        concepto: armarConcepto(`PORTAL COMPRA ${x.erpCompra ?? ""} ${x.emisor ?? ""} A ${sala.nombre}`).concepto,
        origen: String(x.estante), id_suc_destino: String(sala.erp), id_ubicacion_destino: "0", numero_vale: vale,
      }), { extra: { Referer: TRASLADO }, reintentos: 1 });
      let ok = false;
      try { ok = String(JSON.parse(r)?.typeinfo).toLowerCase() === "success"; } catch { /* abajo */ }
      const despues = await pendientesDeOrigen(cookie, x.estante);
      // Sin la foto de ANTES («vacía» es también lo que devuelve cuando el
      // listado falla) cualquier traslado viejo a esa sala parecería nuevo: el
      // número no se confía.
      const { id: idT0 } = await identificarTrasladoNuevo(cookie, antes, despues, pagina, sala.erp, []);
      const idT = antes.size > 0 ? idT0 : null;
      if (!ok && !idT) {
        let legible = true;
        try { JSON.parse(r); } catch { legible = false; }
        if (legible) { await fila({ estado: "fallido", nota: `El sistema no aceptó el traslado: ${r.slice(0, 300)}` }); continue; }
        await fila({ estado: "sin_verificar", nota: "El sistema contestó algo que no se entiende: buscar el traslado en el sistema antes de volver a enviar." });
        continue;
      }
      if (!idT) {
        await fila({ estado: "sin_verificar", nota: "El traslado salió pero no se pudo identificar su número: buscarlo en el sistema antes de volver a enviar." });
        continue;
      }
      await fila({ estado: "enviado", erp_traslado_id: idT, enviado_at: new Date().toISOString(), nota: null });
      const conVence = ls.filter((l) => l.vence_pendiente).length;
      await avisarSala(admin, branchId, `Bodega te envió producto de ${x.emisor ?? "una compra"}`,
        `${ls.length === 1 ? "1 producto" : `${ls.length} productos`} de la compra ${x.erpCompra ?? ""}. Recíbelo en Traslados → En camino`
          + (conVence ? ` y pon la fecha de vencimiento de ${conVence === 1 ? "1 producto" : `${conVence} productos`}.` : "."),
        { compra: x.erpCompra, traslado: idT },
      ).catch((e) => console.error("[cargar-compra-erp] aviso a la sala:", e?.message ?? e));
    } catch (e: any) {
      // Después de mandar, un error no dice que no salió.
      await fila({ estado: mandado ? "sin_verificar" : "fallido", nota: (mandado ? "Se cortó después de mandar el traslado: buscarlo en el sistema. " : "") + String(e?.message ?? e).slice(0, 450) });
    }
  }
}

/**
 * La sala recibe lo que Bodega le repartió. Si la factura no traía
 * vencimiento, la sala lo pone acá (mes y año: se guarda el día 1). Se recibe
 * completo —como el resto de traslados del portal— y se comprueba que la
 * existencia de la sala subió.
 */
async function recibirReparto(admin: any, id: number, vences: Record<string, string>, quien: { id: string; name: string }) {
  if (!Number.isFinite(id)) return { error: "Falta el envío." };
  const permiso = await permisoDeModulo(admin, quien.id, "traslados", "can_edit");
  if (permiso.roto) return { error: permiso.roto };
  const { data: r, error: eR } = await admin.from("compra_reparto").select("*").eq("id", id).maybeSingle();
  if (eR) throw eR;
  if (!r) return { error: "Ese envío no existe." };
  if (!permiso.puede || (!permiso.alcanceTodo && permiso.emp?.branch_id !== r.branch_id)) {
    return { error: "Sólo lo puede recibir alguien de esa sala." };
  }
  if (r.estado === "recibido") return { recibido: true, ya: true };
  if (r.estado !== "enviado" || !r.erp_traslado_id) return { error: "Ese envío no está en camino." };

  const lineas = r.lineas as LineaReparto[];
  const fechas: Record<string, string> = {};
  for (const l of lineas.filter((z) => z.vence_pendiente)) {
    const m = /^(\d{4})-(\d{2})/.exec(String(vences?.[String(l.renglon)] ?? ""));
    if (!m) return { error: `Falta la fecha de vencimiento de «${l.descripcion}».` };
    const f = `${m[1]}-${m[2]}-01`;
    if (f < hoySV().slice(0, 7) + "-01") return { error: `«${l.descripcion}»: la fecha de vencimiento ya pasó.` };
    fechas[String(l.erp_product_id)] = f;
  }
  const salas = await salasDeReparto(admin);
  const sala = salas.get(Number(r.branch_id));
  if (!sala) return { error: "No se conoce la ubicación de esa sala." };

  const { data: tomada, error: eT } = await admin.from("compra_reparto").update({ estado: "recibiendo", updated_at: new Date().toISOString() })
    .eq("id", id).eq("estado", "enviado").select("id");
  if (eT) throw eT;
  if (!tomada?.length) return { error: "Otra persona lo está recibiendo." };
  const anotar = async (estado: string, nota: string) => {
    const { error } = await admin.from("compra_reparto").update({ estado, nota, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) console.error("[cargar-compra-erp] anotar la recepción", id, estado, error.message);
  };
  const volver = (nota: string) => anotar("enviado", nota);
  let mandado = false;

  try {
    const cookie = await sesionEn(sala.erp, login);
    const estado = await estadoDeRecepcion(cookie, String(r.erp_traslado_id));
    // La pantalla de recepción sigue pintando un traslado ya recibido: sin
    // saber en qué está, no se recibe (sería recibirlo dos veces).
    if (estado === "desconocido") { await volver("No se pudo comprobar si ya se recibió."); return { error: "No se pudo comprobar en el sistema si ya se recibió: intenta en un momento." }; }
    if (estado === "anulado") { await volver("El traslado está anulado en el sistema."); return { error: "El traslado está anulado en el sistema: avisa a Bodega." }; }
    if (estado === "recibido") {
      const { error: eY } = await admin.from("compra_reparto").update({ estado: "recibido", recibido_por: quien.id, recibido_at: new Date().toISOString(), vences: fechas, nota: "Ya estaba recibido en el sistema.", updated_at: new Date().toISOString() }).eq("id", id);
      if (eY) throw eY;
      return { recibido: true, ya: true };
    }
    const html = await pedir(cookie, `${RECIBIR}?id_movimiento=${encodeURIComponent(r.erp_traslado_id)}`, undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } });
    const filas = filasDeRecepcion(html);
    if (!filas.length) { await volver("No se pudo leer la recepción."); return { error: "No se pudo leer el traslado en el sistema: intenta de nuevo." }; }
    const esperado = new Map<number, number>();
    for (const l of lineas) esperado.set(l.erp_product_id, (esperado.get(l.erp_product_id) ?? 0) + l.paquetes * l.unidad);
    let total = 0;
    const partes = filas.map((f) => {
      const vence = fechas[f.idProd] ?? f.vence;
      total += Number(f.compra) * Number(f.esp);
      return [f.idProd, f.compra, f.venta, f.esp, f.unidad, vence, f.idPres, f.esp].join("|");
    });
    if (filas.some((f) => !(fechas[f.idProd] ?? f.vence))) { await volver("Un renglón no tiene vencimiento."); return { error: "Un producto no tiene fecha de vencimiento." }; }
    // Que el traslado del sistema sea ESTE envío: mismos productos y unidades.
    // Por producto, en unidades. La cantidad de la página va en paquetes de su
    // presentación; si alguna vez viniera ya en unidades, también se acepta.
    const sumar = (porUnidad: boolean) => {
      const m = new Map<number, number>();
      for (const f of filas) m.set(Number(f.idProd), (m.get(Number(f.idProd)) ?? 0) + Number(f.esp) * (porUnidad ? (Number(f.unidad) || 1) : 1));
      return m;
    };
    const igual = (m: Map<number, number>) => m.size === esperado.size && [...esperado].every(([pid, u]) => Math.abs((m.get(pid) ?? -1) - u) < 1e-6);
    const coincide = igual(sumar(true)) || igual(sumar(false));
    if (!coincide) {
      await anotar("sin_verificar", `El traslado ${r.erp_traslado_id} del sistema no trae lo mismo que este envío: revisarlo antes de recibir.`);
      return { error: "El traslado del sistema no coincide con lo enviado: avisa a Bodega." };
    }
    const antes = await existenciasDeUbicacion(cookie, sala.erp, sala.ubic);
    mandado = true;
    const resp = await pedir(cookie, RECIBIR, new URLSearchParams({
      process: "insert", datos: partes.join("#") + "#", cuantos: String(partes.length), total: total.toFixed(4), fecha: hoySV(),
      concepto: armarConcepto(`PORTAL REC ${quien.name} COMPRA ${r.erp_compra_id ?? ""} ${r.emisor_nombre ?? ""}`).concepto,
      destino: String(sala.ubic), id_traslado: String(r.erp_traslado_id),
    }), { extra: { Referer: RECIBIR }, reintentos: 1 });
    let ok = false;
    try { ok = String(JSON.parse(resp)?.typeinfo).toLowerCase() === "success"; } catch { /* abajo */ }
    if (!ok) {
      const despuesEstado = await estadoDeRecepcion(cookie, String(r.erp_traslado_id));
      if (despuesEstado === "pendiente") {
        await volver(`El sistema no aceptó la recepción: ${resp.slice(0, 200)}`);
        return { error: "El sistema no aceptó la recepción: intenta de nuevo." };
      }
      if (despuesEstado !== "recibido") {
        await anotar("sin_verificar", `No se sabe si la recepción entró: ${resp.slice(0, 200)}`);
        return { error: "No se sabe si entró: NO lo recibas de nuevo, toca «Comprobar» en un momento." };
      }
    }
    const despues = await existenciasDeUbicacion(cookie, sala.erp, sala.ubic);
    const comprobado = Boolean(antes && despues && [...esperado].every(([pid, u]) => (despues.get(pid) ?? 0) - (antes.get(pid) ?? 0) >= u - 1e-6));
    const { error: eU } = await admin.from("compra_reparto").update({
      estado: "recibido", recibido_por: quien.id, recibido_at: new Date().toISOString(), vences: fechas,
      nota: comprobado ? null : "Recibido, pero la existencia de la sala no subió lo esperado: revisarlo.", updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (eU) throw eU;
    return { recibido: true, comprobado };
  } catch (e: any) {
    if (mandado) await anotar("sin_verificar", `Se cortó después de mandar la recepción: ${String(e?.message ?? e).slice(0, 250)}`);
    else await volver(String(e?.message ?? e).slice(0, 300));
    throw e;
  }
}

/**
 * Un envío que quedó «sin verificar» se comprueba preguntándole al sistema si
 * el traslado ya entró a la sala. Sólo lectura.
 */
async function comprobarReparto(admin: any, id: number, quien: { id: string }) {
  const permiso = await permisoDeModulo(admin, quien.id, "traslados", "can_edit");
  if (permiso.roto) return { error: permiso.roto };
  const { data: r, error: eR } = await admin.from("compra_reparto").select("*").eq("id", id).maybeSingle();
  if (eR) throw eR;
  if (!r) return { error: "Ese envío no existe." };
  if (!permiso.puede || (!permiso.alcanceTodo && permiso.emp?.branch_id !== r.branch_id)) return { error: "Sólo lo puede comprobar alguien de esa sala." };
  if (r.estado !== "sin_verificar") return { error: "Ese envío no está por comprobar." };
  if (!r.erp_traslado_id) return { error: "No se sabe con qué número salió de Bodega: que Bodega lo busque en el sistema." };
  const sala = (await salasDeReparto(admin)).get(Number(r.branch_id));
  if (!sala) return { error: "No se conoce la ubicación de esa sala." };
  const cookie = await sesionEn(sala.erp, login);
  const estado = await estadoDeRecepcion(cookie, String(r.erp_traslado_id));
  if (estado === "desconocido") return { error: "No se pudo consultar el sistema: intenta en un momento." };
  const ahora = new Date().toISOString();
  const cambios = estado === "recibido"
    ? { estado: "recibido", recibido_por: r.recibido_por ?? quien.id, recibido_at: r.recibido_at ?? ahora, nota: "Comprobado: ya estaba recibido." }
    : estado === "anulado" ? { estado: "fallido", nota: "El traslado está anulado en el sistema." }
    : { estado: "enviado", nota: null };
  const { error: eU } = await admin.from("compra_reparto").update({ ...cambios, updated_at: ahora }).eq("id", id).eq("estado", "sin_verificar");
  if (eU) throw eU;
  return { ok: true, estado: cambios.estado };
}

/**
 * Vuelve a mandar a la sala un envío que NO salió de Bodega (`fallido`, o
 * `por_enviar` que quedó quieto porque la compra no estaba comprobada). Sólo
 * esos: uno «sin verificar» puede haber salido y se comprueba, no se reenvía.
 * Usa el mismo camino que el reparto de la carga, con su candado de estado.
 */
async function reintentarReparto(admin: any, id: number, quien: string) {
  const { data: r, error: eR } = await admin.from("compra_reparto").select("*").eq("id", id).maybeSingle();
  if (eR) throw eR;
  if (!r) return { error: "Ese envío no existe." };
  const quieto = r.estado === "por_enviar" && Date.parse(r.updated_at ?? r.created_at) < Date.now() - 15 * 60_000;
  if (r.estado !== "fallido" && !quieto) {
    return { error: r.estado === "sin_verificar"
      ? "Ese envío puede haber salido: primero hay que comprobarlo."
      : "Sólo se reintenta un envío que no salió de Bodega." };
  }
  const { data: c, error: eC } = await admin.from("compra_carga").select("estado").eq("id", r.compra_carga_id).maybeSingle();
  if (eC) throw eC;
  if (c?.estado !== "verificada") return { error: "La compra todavía no está comprobada en Bodega: no se puede enviar a la sala." };
  const lineas: LineaReparto[] = Array.isArray(r.lineas) ? r.lineas : [];
  if (!lineas.length) return { error: "Ese envío no tiene productos." };

  // El candado: sólo pasa quien lo saca del estado en que lo vio.
  const { data: tomada, error: eT } = await admin.from("compra_reparto")
    .update({ estado: "por_enviar", nota: null, enviado_por: quien, updated_at: new Date().toISOString() })
    .eq("id", id).eq("estado", r.estado).select("id");
  if (eT) throw eT;
  if (!tomada?.length) return { error: "Alguien más lo está reintentando." };

  const cookie = await sesionEn(ERP_BODEGA, login);
  const estante = await ubicacionDeBodega(admin, false);
  if (!estante) {
    const { error: eV } = await admin.from("compra_reparto").update({ estado: r.estado, nota: r.nota, updated_at: new Date().toISOString() }).eq("id", id).eq("estado", "por_enviar");
    if (eV) throw eV;
    return { error: "No se conoce el estante de Bodega." };
  }
  await repartirASalas(admin, cookie, lineas, {
    cargaId: r.compra_carga_id, quien, emisor: r.emisor_nombre, erpCompra: r.erp_compra_id, mover: true, estante,
  });
  const { data: f, error: eF } = await admin.from("compra_reparto").select("estado, nota, erp_traslado_id").eq("id", id).maybeSingle();
  if (eF) throw eF;
  return { ok: f?.estado === "enviado", estado: f?.estado ?? null, nota: f?.nota ?? null, traslado: f?.erp_traslado_id ?? null, antes: r.nota ?? null };
}

type Erroneo = {
  renglon: number; descripcion: string; codigo_proveedor: string | null;
  product_id: number; es_generico: boolean; unidades: number; costo_unitario: number;
  /** Posición de su línea en el sobre: el renglón exacto, no «el primero con ese producto». */
  linea_idx?: number; numero_lote?: string | null;
};

/**
 * Anota cada renglón erróneo y lo pasa del estante de Bodega al área de
 * vencidos con un traslado dentro de Bodega (origen = estante, destino =
 * Bodega, recibido en vencidos). Es el mismo movimiento con el que se reparó
 * la compra 6472 el 2026-10-30, que se midió unidad por unidad.
 *
 * Sólo se mueve si la compra se COMPROBÓ en el estante; si no, las filas
 * quedan `por_mover` con la razón, y nadie mueve a ciegas. La recepción se
 * comprueba leyendo la existencia de vencidos antes y después.
 */
async function apartarErroneos(admin: any, cookie: string, errs: Erroneo[], x: {
  cargaId: number; documentId: number | null; manualId: number | null; quien: string; emisor: { nit: string | null; nombre: string | null };
  erpCompra: number | null; lineas: LineaSobre[]; mover: boolean; estante: number;
}) {
  const { error: eI } = await admin.from("compra_renglon_erroneo").upsert(errs.map((e) => ({
    compra_carga_id: x.cargaId, document_id: x.documentId, manual_id: x.manualId, renglon: e.renglon,
    emisor_nit: x.emisor.nit, emisor_nombre: x.emisor.nombre, descripcion: e.descripcion,
    codigo_proveedor: e.codigo_proveedor, product_id: e.product_id, es_generico: e.es_generico,
    unidades: e.unidades, costo_unitario: e.costo_unitario, erp_compra_id: x.erpCompra, numero_lote: e.numero_lote ?? null,
    marcado_por: x.quien, estado: "por_mover",
    nota: x.mover ? null : "La compra no se pudo comprobar en el estante: pasarlo a vencidos a mano.",
  })), { onConflict: "compra_carga_id,renglon" });
  if (eI) throw eI;
  if (!x.mover) return { movidos: 0, error: "La compra no se comprobó: los erróneos quedan por mover." };

  const nota = async (texto: string) => {
    const { error } = await admin.from("compra_renglon_erroneo")
      .update({ nota: texto, updated_at: new Date().toISOString() }).eq("compra_carga_id", x.cargaId).eq("estado", "por_mover");
    if (error) console.error("[cargar-compra-erp] anotar erróneos", x.cargaId, texto, error.message);
  };
  const vencidosUbic = await ubicacionDeBodega(admin, true);
  if (!vencidosUbic) { await nota("No se conoce el área de vencidos de Bodega."); return { movidos: 0, error: "No se conoce el área de vencidos." }; }

  // Un renglón por producto, con la presentación y el lote con que entró.
  const partes: string[] = [];
  let total = 0;
  const esperado = new Map<number, number>();
  for (const e of errs) {
    const l = e.linea_idx != null ? x.lineas[e.linea_idx]
      : x.lineas.find((y) => Number(y.id_producto) === e.product_id && Math.abs(Number(y.cant) * (Number(y.unidad) || 1) - e.unidades) < 1e-6);
    if (!l) { await nota("No se encontró su renglón en la compra."); return { movidos: 0, error: "No se encontró el renglón en la compra." }; }
    const f = await traerFila(cookie, e.product_id, x.estante);
    if (!f.presentaciones.some((p) => p.id === String(l.id_presentacion))) {
      await nota("Su presentación no aparece en el estante."); return { movidos: 0, error: "Presentación no encontrada en el estante." };
    }
    let idLote = "0";
    if (f.regulado) {
      const lote = f.lotes.find((z) => z.numero === String(l.numero_lote));
      if (!lote) { await nota(`Lote ${l.numero_lote} no encontrado en el estante.`); return { movidos: 0, error: "Lote no encontrado." }; }
      idLote = lote.id;
    }
    partes.push([e.product_id, l.compra, l.venta, l.cant, l.unidad, l.vence === "NULL" ? (f.vence || "") : l.vence, l.id_presentacion, idLote].join("|"));
    total += Number(l.compra) * Number(l.cant);
    esperado.set(e.product_id, (esperado.get(e.product_id) ?? 0) + e.unidades);
  }

  const pagina = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
  const vale = pagina.match(/numero_vale["'][^>]*value=["']([^"']+)["']/)?.[1] ?? "";
  if (!vale) { await nota("El sistema no entregó el número de vale."); return { movidos: 0, error: "Sin vale." }; }
  const antesVenc = await existenciasDeUbicacion(cookie, ERP_BODEGA, vencidosUbic);
  const antes = await pendientesDeOrigen(cookie, x.estante);
  const r = await pedir(cookie, TRASLADO, new URLSearchParams({
    process: "insert", datos: partes.join("#") + "#", id_traslado_guardado: "0", cuantos: String(partes.length),
    total: total.toFixed(4), fecha: hoySV(),
    concepto: armarConcepto(`PORTAL ERROR DEL PROVEEDOR COMPRA ${x.erpCompra ?? ""} ${x.emisor.nombre ?? ""} A VENCIDOS`).concepto,
    origen: String(x.estante), id_suc_destino: String(ERP_BODEGA), id_ubicacion_destino: "0", numero_vale: vale,
  }), { extra: { Referer: TRASLADO }, reintentos: 1 });
  let ok = false;
  try { ok = String(JSON.parse(r)?.typeinfo).toLowerCase() === "success"; } catch { /* abajo */ }
  if (!ok) { await nota(`El sistema no aceptó el traslado: ${r.slice(0, 300)}`); return { movidos: 0, error: "El traslado a vencidos no entró." }; }
  const despues = await pendientesDeOrigen(cookie, x.estante);
  // Sin la foto de antes, cualquier traslado viejo a Bodega parecería el nuevo.
  const idT = antes.size > 0 ? (await identificarTrasladoNuevo(cookie, antes, despues, pagina, ERP_BODEGA, [])).id : null;
  if (!idT) {
    await nota("Salió el traslado a vencidos pero no se pudo identificar su número: recibirlo a mano en vencidos.");
    return { movidos: 0, error: "Traslado sin identificar: recibirlo a mano." };
  }
  const { error: eTr } = await admin.from("compra_renglon_erroneo").update({ erp_traslado_id: idT, updated_at: new Date().toISOString() })
    .eq("compra_carga_id", x.cargaId);
  if (eTr) throw eTr;

  // Recibirlo en vencidos, con lo que la propia pantalla de recepción muestra.
  const rec = await pedir(cookie, `${RECIBIR}?id_movimiento=${idT}`, undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } });
  const filas: string[] = []; let tot = 0;
  for (const tr of [...rec.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]).filter((t) => /class="id_p"/.test(t))) {
    const idProd = tr.match(/class="id_p">\s*(\d+)/)?.[1] ?? "";
    const idPres = tr.match(/<select[^>]*class=['"]sel['"][^>]*>\s*<option[^>]*value=['"](\d+)['"]/)?.[1] ?? "";
    const compra = tr.match(/class=['"][^'"]*precio_compra[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
    const venta = tr.match(/class=['"][^'"]*precio_venta[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
    const unidad = tr.match(/class=['"]unidad['"][^>]*value=['"](\d+)/)?.[1] ?? "1";
    const esp = tr.match(/class=['"][^'"]*\besp\b[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
    const vence = tr.match(/class=['"][^'"]*\bvence\b[^'"]*['"][^>]*value=['"]([^'"]*)['"]/)?.[1] ?? "";
    if (!idProd || !idPres) continue;
    filas.push([idProd, compra, venta, esp, unidad, vence, idPres, esp].join("|"));
    tot += Number(compra) * Number(esp);
  }
  if (filas.length !== partes.length) {
    await nota(`El traslado ${idT} quedó sin recibir: recibirlo a mano en vencidos.`);
    return { movidos: 0, traslado: idT, error: "No se pudo leer la recepción." };
  }
  const r2 = await pedir(cookie, RECIBIR, new URLSearchParams({
    process: "insert", datos: filas.join("#") + "#", cuantos: String(filas.length), total: tot.toFixed(4),
    fecha: hoySV(), concepto: `PORTAL ERROR DEL PROVEEDOR (TRASLADO ${idT})`, destino: String(vencidosUbic), id_traslado: idT,
  }), { extra: { Referer: RECIBIR }, reintentos: 1 });
  let ok2 = false;
  try { ok2 = String(JSON.parse(r2)?.typeinfo).toLowerCase() === "success"; } catch { /* abajo */ }

  // Comprobarlo en vencidos: cada producto tiene que haber subido lo marcado.
  const despuesVenc = await existenciasDeUbicacion(cookie, ERP_BODEGA, vencidosUbic);
  const entro = ok2 && antesVenc && despuesVenc && [...esperado].every(([id, u]) =>
    (despuesVenc.get(id) ?? 0) - (antesVenc.get(id) ?? 0) >= u - 1e-6);
  if (!entro) {
    await nota(`El traslado ${idT} no se pudo comprobar en vencidos: revisarlo.`);
    return { movidos: 0, traslado: idT, error: "No se comprobó en vencidos." };
  }
  // Comprobado en vencidos: recién ahora se puede dar salida. Un renglón al
  // que ya le adjuntaron la nota conserva `con_nota`.
  const ahora = new Date().toISOString();
  const { error: eU } = await admin.from("compra_renglon_erroneo")
    .update({ en_vencidos_at: ahora, nota: null, updated_at: ahora }).eq("compra_carga_id", x.cargaId);
  if (eU) throw eU;
  const { error: eU2 } = await admin.from("compra_renglon_erroneo")
    .update({ estado: "en_vencidos" }).eq("compra_carga_id", x.cargaId).eq("estado", "por_mover");
  if (eU2) throw eU2;
  return { movidos: errs.length, traslado: idT };
}

const NOTA_CREDITO = `${BASE}/nota_credito_compras.php`;

/**
 * Registra una nota de crédito de compra en el libro de compras del sistema,
 * como su pantalla «Nota crédito compras»: primero sube el JSON del documento
 * (`process=automatic`), que el propio sistema lee y devuelve campo por campo;
 * después manda `process=insertar` con lo que devolvió. Así los números salen
 * del lector del sistema y no de uno escrito acá.
 *
 * Se reproduce el envío del formulario TAL CUAL, defectos incluidos: su JS arma
 * `&numDocRelacionado` SIN «=» (la clave queda pegada al valor) y
 * `clase_documento_tributario ` con un espacio. Así queda igual que si la
 * cargara una persona.
 *
 * Se comprueba leyendo el libro (CSV) del mes de la nota y buscando su número.
 */
async function registrarNotaEnLibro(admin: any, cookie: string, notaId: number, quien: string) {
  const { data: previa, error: eP } = await admin.from("compra_nota_credito_libro").select("estado").eq("document_id", notaId).maybeSingle();
  if (eP) throw eP;
  if (previa?.estado === "registrada") return { ok: true, ya: true };
  if (previa && previa.estado !== "fallida") return { ok: false, error: "La nota quedó a medio registrar en el libro: revisarla a mano antes de seguir." };

  const { data: n, error: eN } = await admin.from("purchase_dte_documents")
    .select("id, tipo_dte, numero_control, codigo_generacion, fecha_emision, json_path").eq("id", notaId).maybeSingle();
  if (eN) throw eN;
  if (!n || n.tipo_dte !== "05") return { ok: false, error: "Eso no es una nota de crédito." };
  const path = pathDeStorage(n.json_path);
  if (!path) return { ok: false, error: "La nota no tiene su archivo." };
  const { data: blob, error: eB } = await admin.storage.from("purchase-dte").download(path);
  if (eB || !blob) throw new Error(`No se pudo leer el archivo de la nota: ${eB?.message}`);
  const dte = desenvolver(JSON.parse(await blob.text()));

  // ¿Ya está en el libro? (el contador la pudo registrar a mano). Si no se
  // puede mirar, no se manda: un crédito fiscal doble no se nota solo.
  const mes = String(n.fecha_emision).slice(0, 7);
  const fin = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const clave = String(n.codigo_generacion ?? "").replace(/-/g, "").toUpperCase().slice(0, 16);
  const enElLibro = async () => {
    const csv = await pedir(cookie, `${BASE}/libro_compras_iva_csv.php?fechaInicio=${mes}-01&fechaFin=${fin}`, undefined, { timeoutMs: 90_000 });
    return { csv, esta: (num: string) => csv.split(/\r?\n/).some((l) => l.replace(/-/g, "").toUpperCase().includes(num)) };
  };
  if (clave.length >= 16) {
    let previo: Awaited<ReturnType<typeof enElLibro>>;
    try { previo = await enElLibro(); } catch (err) {
      return { ok: false, error: `No se pudo mirar el libro antes de registrar: ${(err as Error)?.message ?? err}` };
    }
    if (previo.esta(clave)) {
      const { error: eY } = await admin.from("compra_nota_credito_libro").upsert({
        document_id: notaId, erp_sucursal_id: ERP_BODEGA, estado: "registrada", registrada_por: quien, error: null, datos: { ya_estaba: true },
      }, { onConflict: "document_id" });
      if (eY) throw eY;
      return { ok: true, ya: true };
    }
  }

  const fila = { document_id: notaId, erp_sucursal_id: ERP_BODEGA, estado: "enviando", registrada_por: quien, error: null, datos: null };
  const { data: tomada, error: eT } = previa
    ? await admin.from("compra_nota_credito_libro").update({ ...fila, updated_at: new Date().toISOString() }).eq("document_id", notaId).eq("estado", "fallida").select("document_id")
    : await admin.from("compra_nota_credito_libro").insert(fila).select("document_id");
  if (eT) {
    if (eT.code === "23505") return { ok: false, error: "Otra persona está registrando esta nota." };
    throw eT;
  }
  if (!tomada?.length) return { ok: false, error: "Otra persona está registrando esta nota." };
  const marcar = (estado: string, extra: Record<string, unknown> = {}) =>
    admin.from("compra_nota_credito_libro").update({ estado, updated_at: new Date().toISOString(), ...extra }).eq("document_id", notaId);

  // 1. El sistema lee el JSON.
  const fd = new FormData();
  fd.set("json_ret", new Blob([JSON.stringify(dte)], { type: "application/json" }), `${n.codigo_generacion ?? notaId}.json`);
  fd.set("process", "automatic");
  fd.set("id_sucursal2", String(ERP_BODEGA));
  let leido: any;
  try {
    const r = await fetch(NOTA_CREDITO, {
      method: "POST", body: fd,
      headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest", Referer: NOTA_CREDITO },
      signal: AbortSignal.timeout(60_000),
    });
    const t = await r.text();
    try { leido = JSON.parse(t); } catch { leido = null; }
    if (!leido?.numero_documento) {
      await marcar("fallida", { error: `El sistema no leyó la nota: ${t.slice(0, 1000)}` });
      return { ok: false, error: `El sistema no leyó la nota: ${String(leido?.msg ?? t.slice(0, 200))}` };
    }
  } catch (e) {
    await marcar("fallida", { error: `Sin respuesta al leerla: ${(e as Error)?.message ?? e}` });
    return { ok: false, error: "El sistema no contestó al leer la nota." };
  }
  if (!String(leido.numControl_DocRelacionado ?? "").trim()) {
    await marcar("fallida", { error: "La nota no trae el documento que corrige.", datos: leido });
    return { ok: false, error: "La nota no dice qué factura corrige: el sistema no la acepta así." };
  }

  // 2. Insertar con lo que el sistema leyó, como su formulario.
  const v = (x: unknown) => encodeURIComponent(String(x ?? ""));
  let cuerpo = "process=insertar" + "&fecha=" + v(leido.fecha_retencion);
  cuerpo += "&agente=" + v(leido.agente) + "&numero_doc=" + v(leido.numero_documento);
  cuerpo += "&numero_serie=" + v(leido.serie_documento);
  cuerpo += "&tipo_doc=" + v(leido.tipo_documento) + "&nit=" + v(leido.nit_agente) + "&nrc=" + v(leido.nrc);
  cuerpo += "&numDocRelacionado" + v(leido.numControl_DocRelacionado);
  cuerpo += "&subtotal=" + v(leido.subTotal);
  cuerpo += "&monto_total=" + v(leido.montoTotalOperacion);
  cuerpo += "&total_impuestos=" + v(leido.total_impuestos);
  cuerpo += "&tipo_operacion=1&clasificacion=1&tipo_costo_gasto=5";
  cuerpo += "&clase_documento_tributario%20=4";
  let resp = "";
  try {
    const r = await fetch(NOTA_CREDITO, {
      method: "POST", body: cuerpo,
      headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest", Referer: NOTA_CREDITO,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      signal: AbortSignal.timeout(60_000),
    });
    resp = await r.text();
  } catch (e) {
    await marcar("sin_verificar", { datos: leido, error: `Sin respuesta al registrar: ${(e as Error)?.message ?? e}` });
    return { ok: false, error: "El sistema no contestó al registrar la nota: puede haber entrado, revisar el libro antes de reintentar." };
  }
  let j: any = null;
  try { j = JSON.parse(resp); } catch { /* abajo */ }
  if (j && String(j.typeinfo).toLowerCase() !== "success") {
    await marcar("fallida", { datos: leido, error: String(j.msg ?? resp.slice(0, 500)) });
    return { ok: false, error: `El sistema no aceptó la nota: ${j.msg ?? "sin motivo"}` };
  }

  // 3. Comprobarla en el libro del mes.
  let enLibro = false;
  try {
    const numero = String(leido.numero_documento).replace(/-/g, "").toUpperCase().slice(0, 16);
    enLibro = (await enElLibro()).esta(numero);
  } catch { /* abajo */ }
  await marcar(enLibro ? "registrada" : "sin_verificar", { datos: leido, error: enLibro ? null : `No apareció en el libro de ${mes}: ${resp.slice(0, 300)}` });
  return enLibro ? { ok: true } : { ok: false, error: "Se mandó la nota pero no aparece en el libro: revisarla antes de reintentar." };
}

/**
 * La misma nota, pero en PAPEL (2026-10-30): no hay JSON que el sistema lea,
 * así que se manda lo escrito en `compra_nota_credito_papel` con el MISMO envío
 * del formulario —`process=insertar`, con sus defectos—, como documento
 * impreso (clase 1). Lo que en la nota electrónica sale del lector del sistema
 * acá sale de la ficha del proveedor (NIT, NRC) y de la compra (el número del
 * documento que corrige). Medido el 30-oct con una lectura de prueba: para una
 * nota electrónica el lector no devuelve `tipo_documento`, así que `tipo_doc`
 * viaja vacío en los dos casos.
 *
 * Antes de mandar se mira el libro del mes: si la nota ya está (otra persona la
 * registró a mano), se da por registrada sin mandar nada. Se reconoce por
 * número Y NIT: un número impreso es corto y sólo es único en su proveedor.
 */
async function registrarNotaPapelEnLibro(admin: any, cookie: string, e: any, quien: string) {
  const { data: n, error: eN } = await admin.from("compra_nota_credito_papel").select("*").eq("id", e.nota_papel_id).maybeSingle();
  if (eN) throw eN;
  if (!n) return { ok: false, error: "La nota en papel no existe." };
  if (n.estado === "registrada") return { ok: true, ya: true };
  if (n.estado === "enviando" || n.estado === "sin_verificar") {
    return { ok: false, error: "La nota quedó a medio registrar en el libro: revisarla a mano antes de seguir." };
  }
  const { data: pm, error: eP } = await admin.from("proveedores_maestro").select("nit, nrc, nombre").eq("nit", n.proveedor_nit).maybeSingle();
  if (eP) throw eP;
  if (!pm?.nrc) return { ok: false, error: "Al proveedor le falta el NRC en su ficha: sin eso el libro no la acepta." };

  // El documento que corrige: el número con que la compra quedó registrada.
  let relacionado = "";
  if (e.erp_compra_id) {
    const { data: rc, error: eRc } = await admin.from("purchase_receipts").select("documento_numero").eq("erp_purchase_id", e.erp_compra_id).maybeSingle();
    if (eRc) throw eRc;
    relacionado = String(rc?.documento_numero ?? "");
  }
  if (!relacionado && e.manual_id) {
    const { data: m, error: eM } = await admin.from("compra_documento_manual").select("numero").eq("id", e.manual_id).maybeSingle();
    if (eM) throw eM;
    relacionado = String(m?.numero ?? "");
  }
  if (!relacionado && e.document_id) {
    const { data: f, error: eF } = await admin.from("purchase_dte_documents").select("codigo_generacion").eq("id", e.document_id).maybeSingle();
    if (eF) throw eF;
    relacionado = String(f?.codigo_generacion ?? "");
  }
  if (!relacionado) return { ok: false, error: "No se sabe qué factura corrige la nota." };

  const marcar = async (estado: string, extra: Record<string, unknown> = {}) => {
    const { error } = await admin.from("compra_nota_credito_papel")
      .update({ estado, registrada_por: quien, updated_at: new Date().toISOString(), ...extra }).eq("id", n.id);
    if (error) console.error("[cargar-compra-erp] nota en papel:", error.message);
  };
  const enElLibro = async () => {
    const mes = String(n.fecha).slice(0, 7);
    const fin = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const csv = await pedir(cookie, `${BASE}/libro_compras_iva_csv.php?fechaInicio=${mes}-01&fechaFin=${fin}`, undefined, { timeoutMs: 90_000 });
    // Sin guiones ni ceros a la izquierda: «005342» y «5342» son la misma.
    const limpio = (x: unknown) => String(x ?? "").replace(/-/g, "").toUpperCase().replace(/^0+/, "");
    const num = limpio(n.numero);
    const nit = String(n.proveedor_nit).replace(/\D/g, "");
    return csv.split(/\r?\n/).some((l) => {
      const c = l.split(";");
      return limpio(c[3]) === num && String(c[4] ?? "").replace(/\D/g, "") === nit;
    });
  };

  // ¿Ya estaba? Si no se puede mirar, no se manda.
  let ya: boolean;
  try { ya = await enElLibro(); } catch (err) {
    return { ok: false, error: `No se pudo mirar el libro antes de registrar: ${(err as Error)?.message ?? err}` };
  }
  if (ya) { await marcar("registrada", { error: null, datos: { ya_estaba: true } }); return { ok: true, ya: true }; }

  // Tomar la nota: dos salidas a la vez no la registran dos veces.
  const { data: tomada, error: eT } = await admin.from("compra_nota_credito_papel")
    .update({ estado: "enviando", updated_at: new Date().toISOString() })
    .eq("id", n.id).in("estado", ["pendiente", "fallida"]).select("id");
  if (eT) throw eT;
  if (!tomada?.length) return { ok: false, error: "Otra persona está registrando esta nota." };

  const v = (x: unknown) => encodeURIComponent(String(x ?? ""));
  const datos = {
    fecha: n.fecha, agente: pm.nombre ?? n.proveedor_nombre, numero_doc: n.numero, numero_serie: n.serie,
    nit: pm.nit, nrc: pm.nrc, relacionado, subtotal: Number(n.subtotal).toFixed(2),
    monto_total: Number(n.total).toFixed(2), total_impuestos: Number(n.iva).toFixed(2),
  };
  let cuerpo = "process=insertar" + "&fecha=" + v(datos.fecha);
  cuerpo += "&agente=" + v(datos.agente) + "&numero_doc=" + v(datos.numero_doc);
  cuerpo += "&numero_serie=" + v(datos.numero_serie);
  cuerpo += "&tipo_doc=" + "&nit=" + v(datos.nit) + "&nrc=" + v(datos.nrc);
  cuerpo += "&numDocRelacionado" + v(datos.relacionado);
  cuerpo += "&subtotal=" + v(datos.subtotal);
  cuerpo += "&monto_total=" + v(datos.monto_total);
  cuerpo += "&total_impuestos=" + v(datos.total_impuestos);
  cuerpo += "&tipo_operacion=1&clasificacion=1&tipo_costo_gasto=5";
  cuerpo += "&clase_documento_tributario%20=1";
  let resp = "";
  try {
    const r = await fetch(NOTA_CREDITO, {
      method: "POST", body: cuerpo,
      headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest", Referer: NOTA_CREDITO,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      signal: AbortSignal.timeout(60_000),
    });
    resp = await r.text();
  } catch (err) {
    await marcar("sin_verificar", { datos, error: `Sin respuesta al registrar: ${(err as Error)?.message ?? err}` });
    return { ok: false, error: "El sistema no contestó al registrar la nota: puede haber entrado, revisar el libro antes de reintentar." };
  }
  let j: any = null;
  try { j = JSON.parse(resp); } catch { /* abajo */ }
  if (j && String(j.typeinfo).toLowerCase() !== "success") {
    await marcar("fallida", { datos, error: String(j.msg ?? resp.slice(0, 500)) });
    return { ok: false, error: `El sistema no aceptó la nota: ${j.msg ?? "sin motivo"}` };
  }
  let entro = false;
  try { entro = await enElLibro(); } catch { /* abajo */ }
  await marcar(entro ? "registrada" : "sin_verificar", { datos, error: entro ? null : `No apareció en el libro: ${resp.slice(0, 300)}` });
  return entro ? { ok: true } : { ok: false, error: "Se mandó la nota pero no aparece en el libro: revisarla antes de reintentar." };
}

/**
 * Le da salida a un producto erróneo cuando su nota de crédito ya está:
 * 1. registra la nota en el libro de compras (si no estaba);
 * 2. lo descarga de Bodega de vencidos como DESCARTE (usuario, 2026-10-30),
 *    con un concepto que dice proveedor, nota y compra;
 * 3. lo comprueba leyendo la existencia de vencidos antes y después.
 */
async function darSalidaErroneo(admin: any, id: number, quien: string) {
  if (!Number.isFinite(id)) return { error: "Falta el renglón." };
  const { data: tomadas, error: eT } = await admin.from("compra_renglon_erroneo")
    .update({ estado: "saliendo", updated_at: new Date().toISOString() })
    .eq("id", id).eq("estado", "con_nota").not("en_vencidos_at", "is", null).select("*");
  if (eT) throw eT;
  const e = tomadas?.[0];
  if (!e) return { error: "Ese producto no está listo para salir (tiene que estar comprobado en vencidos y con su nota de crédito)." };
  const anotar = async (estado: string, cambios: Record<string, unknown>) => {
    const { error } = await admin.from("compra_renglon_erroneo").update({ estado, ...cambios, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) console.error("[cargar-compra-erp] anotar la salida", id, estado, error.message);
  };
  const volver = (nota: string) => anotar("con_nota", { nota });
  let mandado = false;

  try {
    const cookie = await sesionEn(ERP_BODEGA, login);
    const libro = e.nota_papel_id
      ? await registrarNotaPapelEnLibro(admin, cookie, e, quien)
      : await registrarNotaEnLibro(admin, cookie, Number(e.nota_credito_document_id), quien);
    if (!libro.ok) { await volver(libro.error ?? "No se pudo registrar la nota."); return { error: libro.error }; }

    const vencidos = await ubicacionDeBodega(admin, true);
    if (!vencidos) { await volver("No se conoce el área de vencidos."); return { error: "No se conoce el área de vencidos." }; }
    const antes = await existenciasDeUbicacion(cookie, ERP_BODEGA, vencidos);
    if (!antes) { await volver("No se pudo leer la existencia de vencidos."); return { error: "No se pudo leer la existencia de vencidos: intenta de nuevo." }; }
    // Lo que había ANTES, guardado: si la salida se corta, se compara contra esto.
    const stockAntes = antes.get(Number(e.product_id)) ?? 0;
    await anotar("saliendo", { salida: { antes: stockAntes } });
    const { data: nc, error: eNc } = e.nota_papel_id
      ? await admin.from("compra_nota_credito_papel").select("numero_control:numero").eq("id", e.nota_papel_id).maybeSingle()
      : await admin.from("purchase_dte_documents").select("numero_control").eq("id", e.nota_credito_document_id).maybeSingle();
    if (eNc) { await volver(`No se pudo leer la nota: ${eNc.message}`); return { error: "No se pudo leer la nota de crédito: intenta de nuevo." }; }
    const concepto = armarConcepto(
      `DEVOLUCION A ${e.emisor_nombre ?? "PROVEEDOR"} - NOTA DE CREDITO ${nc?.numero_control ?? ""} - COMPRA ${e.erp_compra_id ?? ""} - ${e.descripcion}`,
    ).concepto;
    mandado = true;
    const r = await descartarUnaLinea({
      erpSucursal: ERP_BODEGA, erpUbicacion: vencidos, concepto, iden: "DESCARTE",
      linea: { erp_product_id: Number(e.product_id), presentacion_tipo: "", factor: 1, cantidad: Number(e.unidades), descripcion: e.descripcion, lote: e.numero_lote ?? null },
    });
    if (!r.ok) {
      if (r.codigo === "INCIERTO") {
        const c = await comprobarSalida(admin, cookie, e, vencidos, stockAntes);
        return c.salio ? { ok: true, comprobado: true } : { error: "No se sabe si salió: NO le des salida de nuevo; toca «Comprobar» en un momento." };
      }
      await anotar("con_nota", { nota: r.error, salida: null }); return { error: r.error };
    }
    const despues = await existenciasDeUbicacion(cookie, ERP_BODEGA, vencidos);
    const bajo = despues ? stockAntes - (despues.get(Number(e.product_id)) ?? 0) : null;
    const comprobado = bajo != null && bajo >= Number(e.unidades) - 1e-6;
    const { error: eU } = await admin.from("compra_renglon_erroneo").update({
      estado: "salio", salida: { ...r.aplicado, antes: stockAntes, comprobado, bajo },
      nota: comprobado ? null : "Se descargó, pero la existencia de vencidos no bajó lo esperado: revisarlo.",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (eU) throw eU;
    return { ok: true, comprobado };
  } catch (err) {
    // Un descarte mandado y sin respuesta puede haber entrado: no vuelve a
    // «con nota» (eso invitaría a descargarlo dos veces).
    if (mandado) await anotar("sin_verificar", { nota: `Se cortó al descargarlo: ${(err as Error)?.message ?? err}. Comprobar antes de seguir.` });
    else await volver(`Falló: ${(err as Error)?.message ?? err}`);
    throw err;
  }
}

/**
 * ¿Salió de vencidos? Compara la existencia de ahora con la que se guardó
 * ANTES de mandar el descarte. Bajó lo que salía → «salió»; no bajó nada →
 * vuelve a «con nota»; otra cosa → sigue por comprobar. Sólo lectura.
 */
async function comprobarSalida(admin: any, cookie: string, e: any, vencidos: number, antes: number) {
  const ahora = await existenciasDeUbicacion(cookie, ERP_BODEGA, vencidos);
  const bajo = ahora ? antes - (ahora.get(Number(e.product_id)) ?? 0) : null;
  const t = new Date().toISOString();
  const salio = bajo != null && bajo >= Number(e.unidades) - 1e-6;
  const nada = bajo != null && Math.abs(bajo) < 1e-6;
  const cambios = salio ? { estado: "salio", nota: null, salida: { ...(e.salida ?? {}), antes, bajo, comprobado: true } }
    : nada ? { estado: "con_nota", nota: "No había salido: se puede dar salida de nuevo." }
    : { estado: "sin_verificar", nota: bajo == null ? "No se pudo leer vencidos para comprobar." : `Vencidos bajó ${bajo} y salían ${Number(e.unidades)}: revisarlo en el sistema.` };
  const { error } = await admin.from("compra_renglon_erroneo").update({ ...cambios, updated_at: t }).eq("id", e.id);
  if (error) throw error;
  return { salio, estado: cambios.estado };
}

/** «Comprobar» de un erróneo que quedó sin verificar (la salida se cortó). */
async function comprobarErroneo(admin: any, id: number) {
  const { data: e, error: eE } = await admin.from("compra_renglon_erroneo").select("*").eq("id", id).maybeSingle();
  if (eE) throw eE;
  if (!e) return { error: "Ese renglón no existe." };
  if (e.estado !== "sin_verificar") return { error: "Ese producto no está por comprobar." };
  const antes = Number(e.salida?.antes);
  if (!Number.isFinite(antes)) return { error: "No quedó la existencia de antes: revisarlo en el sistema." };
  const vencidos = await ubicacionDeBodega(admin, true);
  if (!vencidos) return { error: "No se conoce el área de vencidos." };
  const cookie = await sesionEn(ERP_BODEGA, login);
  return await comprobarSalida(admin, cookie, e, vencidos, antes);
}

/**
 * Un erróneo cuyo traslado a vencidos se recibió A MANO: se pregunta al
 * sistema si ese traslado ya entró y, si sí, queda comprobado en vencidos.
 */
async function erroneoYaEnVencidos(admin: any, id: number) {
  const { data: e, error: eE } = await admin.from("compra_renglon_erroneo").select("id, erp_traslado_id, en_vencidos_at, estado").eq("id", id).maybeSingle();
  if (eE) throw eE;
  if (!e) return { error: "Ese renglón no existe." };
  if (e.en_vencidos_at) return { ok: true, ya: true };
  if (!e.erp_traslado_id) return { error: "No se sabe con qué traslado salió a vencidos: hay que pasarlo de nuevo." };
  const cookie = await sesionEn(ERP_BODEGA, login);
  const estado = await estadoDeRecepcion(cookie, String(e.erp_traslado_id));
  if (estado === "desconocido") return { error: "No se pudo consultar el sistema: intenta en un momento." };
  if (estado !== "recibido") return { error: `El traslado ${e.erp_traslado_id} todavía no se recibió en vencidos.` };
  const t = new Date().toISOString();
  const { error: eU } = await admin.from("compra_renglon_erroneo")
    .update({ en_vencidos_at: t, nota: null, estado: e.estado === "por_mover" ? "en_vencidos" : e.estado, updated_at: t }).eq("id", id);
  if (eU) throw eU;
  return { ok: true };
}

async function productoNuevo(admin: any, body: any, creaQuien: string | null = null) {
  const problemas: string[] = [];
  const nombre = String(body?.nombre ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  const barcode = String(body?.barcode ?? "").trim();
  const modeloId = Number(body?.modelo_id) || null;
  const costo = Number(body?.costo);
  const precioPedido = Number(body?.precio);

  const cookie = await sesionEn(ERP_BODEGA, login);
  const form = await pedir(cookie, `${BASE}/agregar_producto.php`, undefined, { extra: { Referer: `${BASE}/admin_producto.php` } });
  const catalogos = {
    proveedores: opcionesDe(form, "proveedor"),
    categorias: opcionesDe(form, "id_categoria"),
    laboratorios: opcionesDe(form, "id_laboratorio"),
  };
  if (!catalogos.categorias.length) return { error: "No se pudo leer el formulario de productos del sistema." };

  // Lo que se sugiere: el parecido, y el proveedor de la factura.
  let m: any = null, html = "";
  if (modeloId) {
    html = await pedir(cookie, `${BASE}/editar_producto.php?id_producto=${modeloId}`, undefined, { extra: { Referer: `${BASE}/admin_producto.php` } });
    m = leerModelo(modeloId, html);
    if (!m.nombre) m = null;
  }
  let provFactura: string | null = null;
  if (body?.manual_id) {
    const { data: mp, error: eM } = await admin.from("compra_documento_manual").select("erp_supplier_id").eq("id", Number(body.manual_id)).maybeSingle();
    if (eM) throw eM;
    if (mp?.erp_supplier_id) provFactura = String(mp.erp_supplier_id);
  } else if (body?.document_id) {
    const { data: d, error: eD } = await admin.from("purchase_dte_documents").select("emisor_nit").eq("id", Number(body.document_id)).maybeSingle();
    if (eD) throw eD;
    if (d?.emisor_nit) {
      const { data: pm, error: eP } = await admin.from("proveedores_maestro").select("supplier_id").eq("nit", d.emisor_nit).maybeSingle();
      if (eP) throw eP;
      if (pm?.supplier_id) {
        const { data: su, error: eS } = await admin.from("suppliers").select("erp_supplier_id").eq("id", pm.supplier_id).maybeSingle();
        if (eS) throw eS;
        if (su?.erp_supplier_id) provFactura = String(su.erp_supplier_id);
      }
    }
  }
  const sugerido = {
    proveedor: provFactura ?? m?.proveedor ?? "",
    categoria: m?.categoria ?? "",
    laboratorio: m?.laboratorio ?? "",
    marca: m?.marca ?? "",
    perecedero: m?.perecedero ?? true,
    exento: m?.exento ?? false,
    decimal: m?.decimal ?? false,
  };
  // El precio que guarda el margen del parecido (sólo si hay costo y precio leídos).
  const margenModelo = m?.precios?.[0] > 0 && m?.costo > 0 ? 1 - m.costo / m.precios[0] : null;
  const precioSugerido = costo > 0 && margenModelo != null && margenModelo > 0 && margenModelo < 0.9
    ? Math.round((costo / (1 - margenModelo)) * 100) / 100 : null;

  const dato = (k: keyof typeof sugerido) => (body?.[k] !== undefined && body?.[k] !== null ? body[k] : sugerido[k]);
  const valores = {
    proveedor: String(dato("proveedor") ?? ""), categoria: String(dato("categoria") ?? ""),
    laboratorio: String(dato("laboratorio") ?? ""), marca: String(dato("marca") ?? "").trim().toUpperCase(),
    perecedero: Boolean(dato("perecedero")), exento: Boolean(dato("exento")), decimal: Boolean(dato("decimal")),
  };
  const precio = precioPedido > 0 ? precioPedido : (precioSugerido ?? 0);

  if (nombre.length < 4 || nombre.length > 120) problemas.push("El nombre tiene que tener entre 4 y 120 letras.");
  if (barcode && !/^\d{8,14}$/.test(barcode)) problemas.push("El código de barras son de 8 a 14 dígitos.");
  if (!(costo > 0)) problemas.push("Falta el costo por unidad.");
  if (!(precio > 0)) problemas.push("Falta el precio de venta.");
  else if (costo > 0 && precio <= costo) problemas.push(`El precio ($${precio.toFixed(2)}) no es mayor que el costo ($${costo.toFixed(4)}).`);
  const en = (lista: { value: string }[], v: string) => lista.some((o) => o.value === v);
  if (!en(catalogos.proveedores, valores.proveedor)) problemas.push("Elige el proveedor.");
  if (!en(catalogos.categorias, valores.categoria)) problemas.push("Elige la categoría.");
  if (!en(catalogos.laboratorios, valores.laboratorio)) problemas.push("Elige el laboratorio.");
  // Un producto controlado no se da de alta copiando: lo que lo hace
  // controlado es justo lo que hay que decidir con cuidado.
  if (m && (m.regulado || m.antibiotico)) problemas.push(`«${m.nombre}» es regulado o antibiótico: un producto así se da de alta a mano.`);

  // Al CREAR (no al revisar): traer el catálogo del sistema al día antes de
  // comparar. La copia del portal se refresca cada 10 min, y un producto que
  // Bodega creó allá en ese rato no se vería como repetido. Cuesta ~5 s (máx.
  // medido 13 s) y sólo en el clic de «Crear»; si no se puede, no se crea: se
  // estaría comparando contra una lista que se sabe vieja.
  if (creaQuien) {
    const ok = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-products`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("ADMIN_INVOKE_SECRET") ?? ""}` },
      body: "{}", signal: AbortSignal.timeout(60_000),
    }).then(async (r) => r.ok && (await r.json().catch(() => ({})))?.ok !== false)
      .catch((e) => { console.error("[cargar-compra-erp] catálogo al día:", e?.message ?? e); return false; });
    if (!ok) return { error: "No se pudo revisar el catálogo del sistema al día, y sin eso no se sabe si el producto ya existe. Intenta en un momento." };
  }

  // Que no exista ya. La base compara sin tildes, signos ni espacios («OREO X 12»
  // = «OREO X12»), mira también las altas del portal que el catálogo todavía no
  // copió, y aparte devuelve los PARECIDOS — ésos sólo avisan.
  const { data: cmp, error: eI } = await admin.rpc("producto_alta_iguales", { p_nombre: nombre, p_barcode: barcode || null });
  if (eI) throw eI;
  const existentes = (cmp?.iguales ?? []).map((x: any) => ({ id: x.id, nombre: x.nombre, activo: x.activo !== false, por: x.por }));
  const parecidos = (cmp?.parecidos ?? []).map((x: any) => ({ id: x.id, nombre: x.nombre, activo: x.activo !== false }));
  for (const x of existentes) {
    const como = x.por === "codigo" ? "con ese código de barras" : "con ese nombre";
    problemas.push(x.activo
      ? `Ya existe ${como}: ${x.nombre} (${x.id}). Úsalo en vez de crear otro.`
      : `Ya existe ${como}, pero está desactivado: ${x.nombre} (${x.id}). Hay que reactivarlo, no crear otro.`);
  }

  const base = {
    id: 0, nombre: "", regulado: false, antibiotico: false, precios: m?.precios ?? null,
    proveedor: valores.proveedor, categoria: valores.categoria, laboratorio: valores.laboratorio,
    marca: valores.marca, perecedero: valores.perecedero, exento: valores.exento, decimal: valores.decimal,
  };
  const sobre = sobreDeProductoNuevo(base as any, { nombre, barcode, costo: costo > 0 ? costo : 0, precio: precio > 0 ? precio : 0 });
  if (creaQuien) {
    if (problemas.length) return { error: problemas.join(" ") };
    return await crearProducto(admin, cookie, sobre, { nombre, barcode, modeloId: modeloId ?? 0, costo, precio, quien: creaQuien });
  }
  return {
    simulacro: true,
    catalogos: body?.catalogos ? catalogos : undefined,
    revision: {
      problemas, listo: problemas.length === 0, existentes, parecidos,
      nombre, barcode: barcode || null, valores, sugerido, precio, precio_sugerido: precioSugerido,
      modelo: m ? { id: m.id, nombre: m.nombre } : null,
      precios: sobre.lista.split(",").slice(7).join(",").replace(/;$/, "").split("#").filter(Boolean).map(Number),
    },
  };
}

Deno.serve(async (req: Request) => {
  const cors = { ...getCorsHeaders(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });
  const responder = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const quien = await requireActiveEmployeeUser(req, admin);
  if (!quien) return responder({ error: "Sesión no válida." }, 401);
  // La sala recibe lo que Bodega le repartió: su permiso es el de Traslados,
  // no el de cargar compras, así que va antes de ese freno.
  const cuerpo = await req.clone().json().catch(() => ({}));
  if (cuerpo?.accion === "reparto_recibir" || cuerpo?.accion === "reparto_comprobar") {
    try {
      const r = cuerpo.accion === "reparto_comprobar"
        ? await comprobarReparto(admin, Number(cuerpo?.id), quien)
        : await recibirReparto(admin, Number(cuerpo?.id), cuerpo?.vences ?? {}, quien);
      return responder(r, r && "error" in r ? 409 : 200);
    } catch (e: any) {
      console.error("[cargar-compra-erp] recibir reparto:", e?.message ?? e);
      return responder({ error: e?.message ?? String(e) }, 500);
    }
  }
  const permiso = await permisoDeModulo(admin, quien.id, "cargar_compra", "can_edit");
  if (permiso.roto) return responder({ error: permiso.roto }, 500);
  if (!permiso.puede) return responder({ error: "No tienes permiso para cargar compras." }, 403);
  if (cuerpo?.accion === "reparto_reintentar") {
    try {
      const r = await reintentarReparto(admin, Number(cuerpo?.id), quien.id);
      return responder(r, "error" in r ? 409 : 200);
    } catch (e: any) {
      console.error("[cargar-compra-erp] reintentar reparto:", e?.message ?? e);
      return responder({ error: e?.message ?? String(e) }, 500);
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const manualId = Number(body?.manual_id) > 0 ? Number(body.manual_id) : null;
    const documentId = manualId ? null : Number(body?.document_id);
    const uso = body?.uso === "consumo" ? "consumo" : "venta";
    const decisiones: Record<string, { product_id?: number; factor?: number; lote?: string; vence?: string }> =
      body?.renglones ?? {};
    const diasCredito = Number.isFinite(Number(body?.dias_credito)) ? Math.max(0, Math.trunc(Number(body.dias_credito))) : null;
    const enviar = body?.enviar === true;
    if (enviar && Deno.env.get("CARGA_COMPRA_ENVIO") !== "on") {
      return responder({ error: "El envío a Bodega todavía no está encendido." }, 409);
    }
    if (body?.accion === "erroneo_salida") return responder(await darSalidaErroneo(admin, Number(body?.id), quien.id));
    if (body?.accion === "erroneo_comprobar") return responder(await comprobarErroneo(admin, Number(body?.id)));
    if (body?.accion === "erroneo_ya_en_vencidos") return responder(await erroneoYaEnVencidos(admin, Number(body?.id)));
    if (body?.accion === "producto_nuevo") return responder(await productoNuevo(admin, body, body?.crear === true ? quien.id : null));
    if (body?.accion === "manual_proveedores") return responder(await proveedoresParaPapel(admin));
    if (body?.accion === "manual_guardar") return responder(await guardarPapel(admin, body?.manual ?? {}, quien.id));
    if (body?.accion === "manual_descartar") {
      // Un papel con un envío en curso o sin comprobar no se descarta: si
      // entró, descartarlo permitiría escribirlo y cargarlo otra vez.
      const { data: viva, error: eVv } = await admin.from("compra_carga").select("id")
        .eq("manual_id", Number(body?.id)).in("estado", ["enviando", "verificada", "sin_verificar"]).limit(1);
      if (eVv) throw eVv;
      if (viva?.length) return responder({ error: "Esa factura ya se mandó a Bodega: no se puede descartar." });
      const { data: q, error: eQ } = await admin.from("compra_documento_manual")
        .update({ estado: "descartada", updated_at: new Date().toISOString() })
        .eq("id", Number(body?.id)).eq("estado", "borrador").select("id");
      if (eQ) throw eQ;
      return responder(q?.length ? { ok: true } : { error: "Esa factura ya no se puede descartar." });
    }
    if (!manualId && !Number.isFinite(documentId)) return responder({ error: "Falta el documento." }, 400);

    // ── El documento y su proveedor ──────────────────────────────────────────
    // Un papel se viste de DTE (`dteDeManual`) y sigue el mismo camino.
    let d: any, dte: any = null, manual: any = null;
    if (manualId) {
      const { data: m, error: eM } = await admin.from("compra_documento_manual").select("*").eq("id", manualId).maybeSingle();
      if (eM) throw eM;
      if (!m) return responder({ error: "Esa factura no existe." }, 404);
      if (m.estado !== "borrador") return responder({ error: m.estado === "cargada" ? "Esa factura ya se cargó." : "Esa factura se descartó." }, 409);
      manual = m;
      ({ d, dte } = dteDeManual(m));
    } else {
      const { data: dd, error: eD } = await admin.from("purchase_dte_documents")
        .select("id, codigo_generacion, numero_control, tipo_dte, emisor_nit, emisor_nombre, fecha_emision, json_path, sello_recibido, invalidado")
        .eq("id", documentId).maybeSingle();
      if (eD) throw eD;
      if (!dd) return responder({ error: "Ese documento no existe." }, 404);
      d = dd;
    }

    const problemas: Problema[] = [];
    if (d.invalidado) problemas.push({ renglon: null, texto: "El emisor invalidó este documento." });
    const tipoDoc = tipoDocDe(d.tipo_dte);
    if (!tipoDoc) return responder({ error: `Tipo de documento ${d.tipo_dte} no se carga como compra.` }, 400);

    // ¿Ya está cargado? Las mismas cuatro igualdades de `get_documentos_sin_cargar`.
    // Un papel: su número exacto, dentro de su proveedor.
    const cod = String(d.codigo_generacion ?? "").toUpperCase();
    if (manual) {
      const { data: rp, error: eRp } = await admin.from("purchase_receipts").select("erp_purchase_id, documento_numero, estado")
        .eq("erp_supplier_id", manual.erp_supplier_id).eq("documento_tipo", manual.tipo_doc).ilike("documento_numero", cod);
      if (eRp) throw eRp;
      const ya = (rp ?? []).filter((r: any) => (r.estado ?? "") !== "anulada");
      if (ya.length) problemas.push({ renglon: null, texto: `Ya está registrada (compra ${ya.map((r: any) => r.erp_purchase_id).join(", ")}).` });
    }
    if (!manual) {
      const candidatos = [...new Set([cod, cod.slice(0, 20), cod.replace(/-/g, "").slice(0, 20)])];
      const { data: recibos, error: eR } = await admin.from("purchase_receipts")
        .select("id, erp_purchase_id, documento_numero, sello_recibido, estado")
        .or([
          d.sello_recibido ? `sello_recibido.eq.${d.sello_recibido}` : null,
          ...candidatos.map((c) => `documento_numero.ilike.${c}`),
        ].filter(Boolean).join(","));
      if (eR) throw eR;
      const yaCargada = (recibos ?? []).filter((r: any) => (r.estado ?? "") !== "anulada"
        && ((d.sello_recibido && r.sello_recibido === d.sello_recibido) || candidatos.includes(normNum(r.documento_numero ?? ""))));
      if (yaCargada.length) {
        problemas.push({ renglon: null, texto: `Ya está registrada (compra ${yaCargada.map((r: any) => r.erp_purchase_id).join(", ")}).` });
      }
    }
    const { data: viva, error: eV } = await admin.from("compra_carga").select("id, estado")
      .eq(manual ? "manual_id" : "document_id", manual ? manualId : documentId).in("estado", ["enviando", "verificada", "sin_verificar"]).maybeSingle();
    if (eV) throw eV;
    if (viva) problemas.push({ renglon: null, texto: "Ya se mandó desde el portal." });

    const { data: prov, error: eP } = await admin.from("proveedores_maestro")
      .select("nombre, supplier_id").eq("nit", d.emisor_nit).maybeSingle();
    if (eP) throw eP;
    let erpProveedor: number | null = manual?.erp_supplier_id ?? null;
    if (!erpProveedor && prov?.supplier_id) {
      const { data: s, error: eS } = await admin.from("suppliers").select("erp_supplier_id").eq("id", prov.supplier_id).maybeSingle();
      if (eS) throw eS;
      erpProveedor = s?.erp_supplier_id ?? null;
    }
    if (!erpProveedor) problemas.push({ renglon: null, texto: "El proveedor no está registrado en el catálogo de proveedores." });

    if (!dte) {
      const path = pathDeStorage(d.json_path);
      if (!path) return responder({ error: "El documento no tiene su archivo." }, 400);
      const { data: blob, error: eB } = await admin.storage.from("purchase-dte").download(path);
      if (eB || !blob) throw new Error(`No se pudo leer el archivo: ${eB?.message}`);
      dte = desenvolver(JSON.parse(await blob.text()));
    }
    const items: any[] = Array.isArray(dte?.cuerpoDocumento) ? dte.cuerpoDocumento : [];
    if (!items.length) return responder({ error: "El documento no trae renglones." }, 400);

    // ── El sistema: sólo lecturas ────────────────────────────────────────────
    const cookie = await sesionEn(ERP_BODEGA, login);
    let tasa = 0;
    if (erpProveedor) {
      const t = await pedir(cookie, COMPRAS, new URLSearchParams({ process: "datos_proveedores", id_proveedor: String(erpProveedor) }),
        { extra: { Referer: COMPRAS } });
      try { tasa = Number(JSON.parse(t)?.percepcion) || 0; } catch { problemas.push({ renglon: null, texto: "No se pudo leer la percepción del proveedor." }); }
    }

    const cache = new Map<number, ProductoDelSistema | null>();
    const lineas: LineaSobre[] = [];
    const detalle: unknown[] = [];
    const cobrado: number[] = [];
    const erroneos: Erroneo[] = [];
    const reparto: LineaReparto[] = [];
    const salas = uso === "venta" ? await salasDeReparto(admin) : new Map<number, Sala>();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const r: RenglonDoc = {
        descripcion: String(it?.descripcion ?? ""),
        cantidad: Number(it?.cantidad), precio: Number(it?.precioUni),
        descuento: Number(it?.montoDescu ?? 0),
        exento: Number(it?.ventaExenta ?? 0) > 0,
        subtotal: Number(it?.ventaGravada ?? 0) + Number(it?.ventaExenta ?? 0) + Number(it?.ventaNoSuj ?? 0),
      };
      let dec: Decision;
      if (uso === "consumo") dec = { tipo: "consumo" };
      else {
        const x = decisiones[String(i)] ?? {};
        // Error del proveedor: entra igual (la factura lo cobra) y después se
        // pasa a vencidos. Sin producto propio, como el genérico.
        const erroneo = (x as any).erroneo === true;
        const elegido = Number(x.product_id);
        const pid = erroneo && !(elegido > 0) ? PRODUCTO_ERRONEO : elegido;
        if (!Number.isFinite(pid) || pid <= 0) {
          problemas.push({ renglon: i, texto: `«${r.descripcion}» no tiene producto elegido.` });
          detalle.push({ renglon: i, descripcion: r.descripcion, error: "sin producto" });
          continue;
        }
        if (!cache.has(pid)) cache.set(pid, await productoDelSistema(cookie, pid));
        const producto = cache.get(pid);
        if (!producto) {
          problemas.push({ renglon: i, texto: `El producto ${pid} no existe en Bodega.` });
          detalle.push({ renglon: i, descripcion: r.descripcion, error: "producto inexistente" });
          continue;
        }
        dec = {
          tipo: "producto", producto, factor: pid === PRODUCTO_ERRONEO ? 1 : (Number(x.factor) || 1),
          lote: x.lote ?? null, vence: x.vence ?? null,
        };
      }
      const res = lineaDelSobre(i, r, dec);
      problemas.push(...res.problemas);
      if (res.linea && dec.tipo === "producto" && (decisiones[String(i)] as any)?.erroneo === true) {
        const u = Number(res.linea.unidad) || 1;
        erroneos.push({
          renglon: i, descripcion: r.descripcion, codigo_proveedor: String(it?.codigo ?? "") || null,
          product_id: Number(res.linea.id_producto), es_generico: Number(res.linea.id_producto) === PRODUCTO_ERRONEO,
          unidades: Number(res.linea.cant) * u, costo_unitario: 0,   // después de prorratear los regalos
          linea_idx: lineas.length, numero_lote: res.linea.numero_lote || null,
        });
      }
      // Lo que va a cada sala: en paquetes de la presentación con que entra, y
      // nunca más de lo que entra. Lo que sobra queda en Bodega.
      const pedidoReparto = (decisiones[String(i)] as any)?.reparto;
      if (res.linea && dec.tipo === "producto" && pedidoReparto && typeof pedidoReparto === "object") {
        if ((decisiones[String(i)] as any)?.erroneo === true) {
          problemas.push({ renglon: i, texto: `«${r.descripcion}» es un producto erróneo: no se envía a salas.` });
        } else {
          // La pantalla manda UNIDADES (lo mismo que «Cantidad a cargar»); se
          // traslada en la presentación con que entra, así que tienen que ser
          // paquetes completos.
          const unidad = Number(res.linea.unidad) || 1;
          const entran = Number(res.linea.cant) * unidad;
          let suma = 0;
          for (const [b, v] of Object.entries(pedidoReparto)) {
            const u = Number(v);
            if (!(u > 0)) continue;
            const sala = salas.get(Number(b));
            if (!sala) { problemas.push({ renglon: i, texto: `«${r.descripcion}»: la sala ${b} no recibe envíos.` }); continue; }
            const n = u / unidad;
            if (Math.abs(n - Math.round(n)) > 1e-9) {
              problemas.push({ renglon: i, texto: `«${r.descripcion}»: a ${sala.nombre} van ${u} unidades y entra en paquetes de ${unidad}.` });
              continue;
            }
            suma += u;
            reparto.push({
              linea_idx: lineas.length, renglon: i, descripcion: r.descripcion, branch_id: sala.branch_id, erp_product_id: Number(res.linea.id_producto),
              id_presentacion: String(res.linea.id_presentacion), unidad, paquetes: Math.round(n),
              compra: String(res.linea.compra), venta: String(res.linea.venta), vence: res.linea.vence === "NULL" ? "" : String(res.linea.vence ?? ""),
              vence_pendiente: Boolean((res.detalle as any)?.vence_pendiente), numero_lote: res.linea.numero_lote || null,
            });
          }
          if (suma > entran + 1e-9) problemas.push({ renglon: i, texto: `«${r.descripcion}»: se envían ${suma} a salas y entran ${entran}.` });
        }
      }
      if (res.linea) { lineas.push(res.linea); cobrado.push(Number(r.subtotal) || 0); }
      detalle.push({ renglon: i, descripcion: r.descripcion, linea: res.linea, ...(res.detalle ?? {}) });
    }

    const regalos = repartirRegalos(lineas, cobrado);
    // El costo que viaja a la sala y el del erróneo, ya con los regalos
    // prorrateados: capturado antes, un promocional iba a $0 y los pagados caros.
    for (const e of erroneos) {
      const l = lineas[e.linea_idx!];
      e.costo_unitario = Math.round((Number(l.compra) / (Number(l.unidad) || 1)) * 1e4) / 1e4;
    }
    for (const rp of reparto) rp.compra = String(lineas[rp.linea_idx!].compra);
    const tot = totalesDelSobre(lineas, tipoDoc, tasa);
    const totalDoc = totalDelDocumento(dte?.resumen);
    const diferencia = totalDoc == null ? null : Math.round((Number(tot.total) - totalDoc) * 100) / 100;
    if (diferencia == null) problemas.push({ renglon: null, texto: "El documento no trae su total." });
    // Sólo con TODOS los renglones armados: con uno sin producto el total
    // sale corto por construcción, y decirlo repite el problema de arriba.
    else if (lineas.length === items.length && Math.abs(diferencia) > TOLERANCIA) {
      problemas.push({ renglon: null, texto: `El total armado ($${tot.total}) no cuadra con el del documento ($${totalDoc.toFixed(2)}).` });
    }

    // Cargada a mano con el NÚMERO DE CONTROL (65 de 1,013 desde agosto): sus
    // 20 caracteres se repiten entre facturas del emisor, así que además mismo
    // proveedor y mismo total.
    if (!manual && d.numero_control && erpProveedor && totalDoc != null) {
      const control = normNum(String(d.numero_control));
      const { data: pc, error: ePc } = await admin.from("purchase_receipts")
        .select("erp_purchase_id, documento_numero, total, estado")
        .eq("erp_supplier_id", erpProveedor).gte("total", totalDoc - 0.05).lte("total", totalDoc + 0.05);
      if (ePc) throw ePc;
      const ya = (pc ?? []).filter((r: any) => (r.estado ?? "") !== "anulada"
        && normNum(r.documento_numero ?? "").length >= 15 && control.startsWith(normNum(r.documento_numero ?? "")));
      if (ya.length) problemas.push({ renglon: null, texto: `Ya está registrada con su número de control (compra ${ya.map((r: any) => r.erp_purchase_id).join(", ")}).` });
    }

    const estanteBodega = await ubicacionDeBodega(admin, false);
    if (!estanteBodega) problemas.push({ renglon: null, texto: "No se conoce la ubicación de Bodega donde entra la compra." });
    const sobre = {
      process: "insert", datos: "", json_arr: JSON.stringify(lineas), cuantos: 0,
      // La fecha de EMISIÓN del documento (usuario, 2026-10-29). El sistema
      // la devuelve como `documento.fecha_emision` y el libro de compras va
      // por ella. Bodega venía poniendo el día de la carga —el default del
      // formulario: 688 de 710 compras desde agosto, 1 a 7 días después—, lo
      // que corre la factura de mes cuando llega a fin de mes.
      total: tot.total, fecha: String(d.fecha_emision).slice(0, 10),
      concepto: uso === "consumo" ? "COMPRA PARA CONSUMO" : "COMPRA DE PRODUCTO",
      destino: String(estanteBodega ?? ""), proveedor: String(erpProveedor ?? ""),
      // El código COMPLETO (usuario, 2026-10-29). Ojo: el sistema hoy guarda
      // 20 caracteres —616 de 710 compras desde septiembre miden exactamente
      // 20, ninguna más—, o sea que probablemente lo recorte; por eso la
      // verificación compara por el comienzo y no por igualdad.
      tipo_doc: tipoDoc, numero_doc: cod,
      // `subtotal` viaja VACÍO: el formulario lo lee de `#subtotal`, que no
      // existe en la página, y jQuery lo manda como cadena vacía.
      sumas_sin_iva: tot.sumas_sin_iva, subtotal: "", iva: tot.iva,
      venta_exenta: tot.venta_exenta, total_percepcion: tot.total_percepcion,
      // `id_compra` va en "0", como el campo oculto `id_compra_g` del
      // formulario. Vacío, el sistema arma consultas que terminan en `=` y
      // revienta con «error in your SQL syntax near ''» — fue la primera
      // prueba real (29-oct, C. Imberton): no se creó ninguna compra.
      dias_credito: diasCredito ?? 0, id_compra: "0", total_renta_retenida: "0.00",
      json_imp_arr: [],
      // Consumo: Gasto de administración. Venta: Costo, costo interno — lo que
      // el propio formulario pone solo al elegir «Gravada».
      tipo_operacion: "1",
      clasificacion: uso === "consumo" ? "2" : "1",
      tipo_costo_gasto: uso === "consumo" ? "2" : "5",
      total_fovial: 0, total_cotrans: 0,
      // Un papel es DOCUMENTO IMPRESO (1) y lleva su serie; un DTE, 4.
      clase_documento_tributario: manual ? "1" : "4", numero_serie: manual?.serie ?? "",
    };

    // Los totales lado a lado, para que la persona los compare con la factura
    // y no sólo vea «cuadra»: lo que dice el documento contra lo que se carga.
    const res = dte?.resumen ?? {};
    const n2 = (v: unknown) => (v == null || v === "" ? null : Math.round(Number(v) * 100) / 100);
    const ivaDoc = Array.isArray(res.tributos)
      ? res.tributos.filter((t: any) => String(t?.codigo) === "20").reduce((a: number, t: any) => a + Number(t?.valor ?? 0), 0)
      : null;
    const totales = {
      documento: {
        gravada: n2(res.totalGravada), exenta: n2(Number(res.totalExenta ?? 0) + Number(res.totalNoSuj ?? 0)),
        descuento: n2(res.totalDescu), iva: n2(ivaDoc ?? res.totalIva),
        percepcion: n2(res.ivaPerci1 ?? 0), retencion: n2(Number(res.ivaRete1 ?? 0) + Number(res.reteRenta ?? 0)),
        total: totalDoc,
      },
      carga: {
        gravada: n2(tot.sumas_sin_iva), exenta: n2(tot.venta_exenta), descuento: null,
        iva: n2(tot.iva), percepcion: n2(tot.total_percepcion), retencion: null,
        total: n2(tot.total),
      },
    };

    const revision = { regalos, totales,
      problemas, listo: problemas.length === 0,
      total_documento: totalDoc, total_armado: Number(tot.total), diferencia,
      percepcion_proveedor: tasa, renglones: detalle, erroneos, reparto,
    };
    if (enviar) return responder(await enviarCompra(admin, {
      cookie, documentId, manualId, cargaId: Number(body?.carga_id), sobre, revision, lineas, erpProveedor: erpProveedor!,
      quien: quien.id, emisor: { nit: d.emisor_nit, nombre: d.emisor_nombre },
      numeroControl: d.numero_control ?? null, totalDoc,
    }));

    const { data: fila, error: eI } = await admin.from("compra_carga").insert({
      document_id: documentId, manual_id: manualId, estado: "simulada", uso, sobre, revision, creado_por: quien.id,
    }).select("id").single();
    if (eI) throw eI;

    return responder({ simulacro: true, carga_id: fila.id, sobre, revision });
  } catch (e: any) {
    console.error("[cargar-compra-erp]", e?.message ?? e);
    return responder({ error: e?.message ?? String(e) }, 500);
  }
});
