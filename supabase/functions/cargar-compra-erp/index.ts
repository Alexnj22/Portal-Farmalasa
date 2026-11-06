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

// Global del runtime de Supabase: termina un trabajo después de responder.
// Declarado acá para que `deno check` lo conozca (antes, `Cannot find name`).
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
import {
  sesionEn, existenciasDeUbicacion, estadoDeRecepcion, traerFila, resolverPresentacion, pendientesDeOrigen, pendientesDeOrigenONulo, contenidoDeTraslado, norm, identificarTrasladoNuevo, armarConcepto, hoySV,
  TRASLADO, RECIBIR, VER, buscarTrasladoHuerfano, direccionesPorSucursal,
} from "../_shared/erp-traslado.ts";
import {
  type Decision, type LineaSobre, type Problema, type ProductoDelSistema, type RenglonDoc,
  lineaDelSobre, pistasDeDiferencia, tipoDocDe, totalDelDocumento, totalesDelSobre, encabezadoDelDocumento, leerModelo, sobreDeProductoNuevo, repartirRegalos, factorDescuentoDeFactura,
} from "../_shared/compraSobre.ts";
import { coincideConControl, fechaCercana } from "../_shared/numeroDeControl.ts";
import { presupuestoDelWorker } from "../_shared/relojDelWorker.ts";
import {
  devolverFichasHuerfanas, filasDeRecibir, MARGEN_DESTRABE_MS, recibirConDestrabe, trabasEnDetalle,
} from "../_shared/erp-destrabe.ts";

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
  // A la vez: la sesión del sistema NO serializa estas lecturas (medido el
  // 2026-11-05 en Bodega: 10 productos, 24 pedidos, 2,316 ms en serie contra
  // 402 ms en paralelo con la misma cookie). El orden se conserva.
  const leidas = await Promise.all(opciones.map(async ({ id: id_presentacion, nombre }) => {
    const p = await pedir(cookie, COMPRAS, new URLSearchParams({ process: "getpresentacion", id_presentacion }),
      { extra: { Referer: COMPRAS } });
    try {
      const jp = JSON.parse(p);
      return { id: id_presentacion, unidad: Number(jp.unidad), costo: Number(jp.costo), precio: Number(jp.precio), nombre: nombre || undefined };
    } catch { return null; /* una presentación ilegible no tumba las otras */ }
  }));
  const presentaciones = leidas.filter((x): x is NonNullable<typeof x> => x !== null);
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
  // Las dos lecturas previas (2b y 2c) van A LA VEZ (2026-11-05): son
  // independientes y la sesión del sistema no las serializa. Los frenos siguen
  // siendo los mismos y en el mismo orden: si cualquiera falla, no se manda.
  const yaEstaP = (x.manualId
    ? papelYaRegistrado(x.cookie, String(x.sobre.numero_doc), String(x.sobre.tipo_doc), x.erpProveedor)
    : yaEnBodega(x.cookie, String(x.sobre.fecha), String(x.sobre.numero_doc),
        { control: x.numeroControl, totales: [x.totalDoc, Number(x.sobre.total)] }))
    .catch((e) => ({ error: String(e?.message ?? e) }));

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
  const [yaEsta, estanteAntes] = await Promise.all([
    yaEstaP,
    esperado.size ? existenciasDeUbicacion(x.cookie, ERP_BODEGA, estante).catch(() => null) : Promise.resolve(new Map<number, number>()),
  ]);
  if ("error" in yaEsta) return { enviada: false, error: `No se pudo comprobar si Bodega ya la tiene: ${yaEsta.error}` };
  if (yaEsta.compra) return { enviada: false, error: `Bodega ya la tiene cargada (compra ${yaEsta.compra}): no se mandó.` };
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
  // ¿Entró al estante? Cada producto tiene que haber subido al menos lo que se
  // cargó (en unidades). Una venta o un traslado en el medio puede dar un
  // falso aviso; preferible a no enterarse de que la mercadería no está.
  // Las dos lecturas posteriores, a la vez: ninguna depende de la otra.
  const [verif, estanteDespues] = await Promise.all([
    leerDeVuelta(x.cookie, x.sobre, x.lineas, x.erpProveedor).catch((e) => ({ ok: false, compra: null, notas: [`No se pudo leer de vuelta: ${e?.message ?? e}`] })),
    esperado.size ? existenciasDeUbicacion(x.cookie, ERP_BODEGA, estante).catch(() => null) : Promise.resolve(new Map<number, number>()),
  ]);
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
  const repartoPedido: LineaReparto[] = x.revision.reparto ?? [];
  if (errs.length) vencidos = { en_curso: verif.ok, cuantos: errs.length };
  // Vencidos y salas salen del MISMO estante, y cada uno reconoce su traslado
  // comparando los pendientes de ese origen antes y después: a la vez, uno
  // podía tomar el traslado del otro. Desde «A vencidos» (2026-11-05) un mismo
  // producto puede ir a las dos cosas, así que van uno detrás del otro.
  if (errs.length || repartoPedido.length) {
    EdgeRuntime.waitUntil((async () => {
      if (errs.length) {
        await apartarErroneos(admin, x.cookie, errs, {
          cargaId: x.cargaId, documentId: x.documentId, manualId: x.manualId, quien: x.quien, emisor: x.emisor,
          erpCompra: verif.compra, lineas: x.lineas, mover: verif.ok, estante,
        }).catch((e) => console.error("[cargar-compra-erp] erróneos:", e?.message ?? e));
      }
      if (repartoPedido.length) {
        await repartirASalas(admin, x.cookie, repartoPedido, {
          cargaId: x.cargaId, quien: x.quien, emisor: x.emisor.nombre, erpCompra: verif.compra, mover: verif.ok, estante,
        }).catch((e) => console.error("[cargar-compra-erp] reparto:", e?.message ?? e));
      }
    })());
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
  // Agrupado por producto (uno puede venir en dos renglones). Se acepta la
  // cantidad en unidades o en la presentación: la lista no dice en cuál está,
  // y las compras medidas eran todas de 1 unidad.
  const porProducto = new Map<string, { cant: number; unidades: number; renglones: number }>();
  for (const l of productos) {
    const a = porProducto.get(l.id_producto) ?? { cant: 0, unidades: 0, renglones: 0 };
    a.cant += Number(l.cant); a.unidades += Number(l.cant) * Number(l.unidad); a.renglones += 1;
    porProducto.set(l.id_producto, a);
  }
  // La lista del sistema REPITE los renglones de un producto que viene en
  // varios: con k renglones devuelve k×k (cada uno k veces). Medido en la
  // compra 6483 (2026-11-03): 6 renglones mandados, 10 en la lista, y la
  // existencia de Bodega subió lo justo — y en la copia del portal hay 441
  // grupos así desde may-2025, o sea que es de la lista y no de la carga.
  // Se aceptan las dos formas: la real y la repetida.
  const repetidos = [...porProducto.values()].reduce((a, e) => a + e.renglones * e.renglones, 0)
    + (lineas.length - productos.length);
  // Los servicios (consumo) no se sabe todavía si salen en esta lista: el
  // conteo sólo se exige cuando la compra es toda de productos.
  if (productos.length === lineas.length && items.length !== lineas.length && items.length !== repetidos) {
    notas.push(`El sistema tiene ${items.length} renglones y se mandaron ${lineas.length}.`);
  }
  const cerca = (a: number, b: number) => Math.abs(a - b) <= 0.001;
  for (const [id, e] of porProducto) {
    const delSistema = items.filter((it) => String(it.producto_id) === id).reduce((a, it) => a + Number(it.cantidad), 0);
    const k = e.renglones;
    if (![e.unidades, e.cant, e.unidades * k, e.cant * k].some((v) => cerca(delSistema, v))) {
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
 * Un antibiótico no se da de alta desde acá (un regulado sí: ver abajo).
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
  // Destrabar una ficha sólo se empieza si alcanza para terminar y devolverla
  // (ver `_shared/erp-destrabe.ts`). Esta acción no tenía reloj propio.
  const inicio = Date.now();
  const presupuesto = presupuestoDelWorker(inicio, 100_000, 100_000).ms;
  const hayTiempoParaDestrabar = () => Date.now() - inicio < presupuesto - MARGEN_DESTRABE_MS;
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
    // Fichas que una llamada muerta dejó destrabadas: se devuelven primero.
    await devolverFichasHuerfanas(admin, "compra_reparto", cookie);
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
    /* Si la ficha cambió después del despacho (control de lote activado,
     * presentación oculta), se destraba, se recibe y se deja como estaba: ver
     * `_shared/erp-destrabe.ts`. Este camino no lo tenía (2026-11-06). El sobre
     * es el que ya se armó y validó arriba, salvo que haya habido que mostrar
     * una presentación: entonces se rearma con los renglones nuevos. */
    const filasHtml = filasDeRecibir(html);
    const concepto = armarConcepto(`PORTAL REC ${quien.name} COMPRA ${r.erp_compra_id ?? ""} ${r.emisor_nombre ?? ""}`).concepto;
    const { resp: rr } = await recibirConDestrabe({
      cookie, idMov: String(r.erp_traslado_id), filas: filasHtml,
      trabas: trabasEnDetalle(admin, "compra_reparto", r, hayTiempoParaDestrabar),
      recibir: async (fs) => {
        let ps = partes, tot = total;
        if (fs !== filasHtml) {
          const nuevas = filasDeRecepcion(fs.join(""));
          if (nuevas.length !== filas.length) return { ok: false, enviado: false, msg: "La recepción cambió al mostrar la presentación." };
          tot = 0;
          ps = nuevas.map((f) => {
            tot += Number(f.compra) * Number(f.esp);
            return [f.idProd, f.compra, f.venta, f.esp, f.unidad, fechas[f.idProd] ?? f.vence, f.idPres, f.esp].join("|");
          });
        }
        const texto = await pedir(cookie, RECIBIR, new URLSearchParams({
          process: "insert", datos: ps.join("#") + "#", cuantos: String(ps.length), total: tot.toFixed(4), fecha: hoySV(),
          concepto, destino: String(sala.ubic), id_traslado: String(r.erp_traslado_id),
        }), { extra: { Referer: RECIBIR }, reintentos: 1 });
        let ok = false, msg = texto.slice(0, 200);
        try { const j = JSON.parse(texto); ok = String(j?.typeinfo).toLowerCase() === "success"; msg = String(j?.msg ?? msg); } catch { /* abajo */ }
        return { ok, msg };
      },
    });
    const ok = rr.ok;
    const resp = rr.msg;
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
 * El número del traslado de un envío que se cortó antes de anotarlo.
 *
 * Mismo método que el despacho de pedidos (`buscarTrasladoHuerfano`): los
 * números son correlativos, así que se recorre desde el último conocido ANTES
 * de que se armara el envío y se busca el que va a esa sala con TODOS sus
 * productos. Lo que no se puede decidir con certeza se dice, no se adivina.
 */
async function trasladoDelEnvioCortado(admin: any, r: any, salaErp: number):
  Promise<{ id: string; no_salio?: false } | { no_salio: true } | { error: string }> {
  const lineas: LineaReparto[] = Array.isArray(r.lineas) ? r.lineas : [];
  const ids = [...new Set(lineas.map((l) => Number(l.erp_product_id)).filter((n) => n > 0))];
  if (!ids.length) return { error: "Ese envío no tiene productos." };
  const { data: prods, error: eP } = await admin.from("products").select("id, nombre").in("id", ids);
  if (eP) throw eP;
  const nombres = (prods ?? []).map((p: any) => String(p.nombre ?? "")).filter(Boolean);
  if (nombres.length !== ids.length) return { error: "No se conocen todos los productos del envío: que Bodega lo busque en el sistema." };

  // El último número anotado antes de armar el envío: el de despacho de
  // pedidos o el de otro envío de compras, el que sea mayor.
  const antes = r.created_at;
  const [{ data: a1, error: e1 }, { data: a2, error: e2 }] = await Promise.all([
    admin.from("pedido_traslado_linea").select("id_traslado").not("id_traslado", "is", null)
      .lte("enviado_at", antes).order("enviado_at", { ascending: false }).limit(1),
    admin.from("compra_reparto").select("erp_traslado_id").not("erp_traslado_id", "is", null)
      .lte("enviado_at", antes).order("enviado_at", { ascending: false }).limit(1),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const desde = Math.max(Number(a1?.[0]?.id_traslado ?? 0), Number(a2?.[0]?.erp_traslado_id ?? 0));
  if (!desde) return { error: "No hay un traslado anterior de referencia: que Bodega lo busque en el sistema." };

  // La sesión de Bodega es la que lista la dirección de todas las salas.
  const cookie = await sesionEn(ERP_BODEGA, login);
  const pagina = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
  const dirDestino = direccionesPorSucursal(pagina).get(String(salaErp));
  if (!dirDestino) return { error: "No se pudo leer la dirección de la sala en el sistema: intenta en un momento." };

  const res = await buscarTrasladoHuerfano({
    desde, producto: nombres, dirDestino,
    yaUsados: async (cands) => {
      const usados = new Set<string>();
      for (const c of cands) {
        const [{ data: u1, error: f1 }, { data: u2, error: f2 }] = await Promise.all([
          admin.from("pedido_traslado_linea").select("id").eq("id_traslado", c).limit(1),
          admin.from("compra_reparto").select("id").eq("erp_traslado_id", c).limit(1),
        ]);
        if (f1 || f2) throw new Error((f1 ?? f2).message);
        if (u1?.length || u2?.length) usados.add(c);
      }
      return usados;
    },
    leer: (n) => pedir(cookie, `${VER}?id_traslado=${n}`, undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } }),
  });
  console.log(`[cargar-compra-erp] envío cortado ${r.id}: ${JSON.stringify(res)}`);
  if (res.estado === "encontrado") return { id: res.id };
  if (res.estado === "no_salio") return { no_salio: true };
  return { error: `No se pudo comprobar solo (${res.motivo}): que Bodega lo busque en el sistema antes de volver a enviar.` };
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
  const sala = (await salasDeReparto(admin)).get(Number(r.branch_id));
  if (!sala) return { error: "No se conoce la ubicación de esa sala." };
  if (!r.erp_traslado_id) {
    // El envío se cortó antes de anotar su número (lo dejó así el barrido de
    // trabados). Antes la respuesta era «que Bodega lo busque en el sistema»,
    // que nadie puede hacer: ninguna pantalla muestra el concepto. Se busca acá.
    const h = await trasladoDelEnvioCortado(admin, r, sala.erp);
    if ("error" in h) return h;
    if (h.no_salio) {
      const { error: eF } = await admin.from("compra_reparto").update({
        estado: "fallido", nota: "Se comprobó en el sistema: el envío no llegó a salir de Bodega. Se puede reintentar.",
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("estado", "sin_verificar");
      if (eF) throw eF;
      return { ok: true, estado: "fallido" };
    }
    const { error: eN } = await admin.from("compra_reparto")
      .update({ erp_traslado_id: h.id, updated_at: new Date().toISOString() }).eq("id", id).eq("estado", "sin_verificar");
    if (eN) throw eN;
    r.erp_traslado_id = h.id;
  }
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
  /** Producto BUENO que se manda a vencidos al cargar (devolución, corto
   *  vencimiento, dañado…), con su motivo. Null en un erróneo. */
  motivo?: string | null;
};

/** Motivos de «A vencidos». La pantalla los ofrece; «otro» exige texto. */
const MOTIVOS_VENCIDOS: Record<string, string> = {
  devolucion: "Se devuelve al proveedor", corto_vencimiento: "Corto vencimiento", danado: "Dañado", otro: "Otro",
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
/**
 * Recibe un traslado de Bodega a Bodega en la ubicación `destino` con lo que
 * la propia pantalla de recepción muestra, y lo comprueba leyendo esa
 * ubicación: cada producto tiene que haber subido lo esperado respecto de
 * `antesDestino`. La otra mitad de `moverAlAreaDeVencidos`, aparte para poder
 * terminar un traslado que salió y quedó sin recibir.
 */
async function recibirYComprobar(cookie: string, x: {
  idT: string; renglones: number; destino: number; concepto: string;
  esperado: Map<number, number>; antesDestino: Map<number, number> | null;
}): Promise<{ ok: true } | { ok: false; error: string; nota: string }> {
  const idT = x.idT;
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
  if (filas.length !== x.renglones) {
    return { ok: false, error: "No se pudo leer la recepción.", nota: `El traslado ${idT} quedó sin recibir: recibirlo a mano.` };
  }
  const r2 = await pedir(cookie, RECIBIR, new URLSearchParams({
    process: "insert", datos: filas.join("#") + "#", cuantos: String(filas.length), total: tot.toFixed(4),
    fecha: hoySV(), concepto: x.concepto, destino: String(x.destino), id_traslado: idT,
  }), { extra: { Referer: RECIBIR }, reintentos: 1 });
  let ok2 = false;
  try { ok2 = String(JSON.parse(r2)?.typeinfo).toLowerCase() === "success"; } catch { /* abajo */ }

  const despues = await existenciasDeUbicacion(cookie, ERP_BODEGA, x.destino);
  const antes = x.antesDestino;
  const entro = ok2 && antes && despues && [...x.esperado].every(([id, u]) =>
    (despues.get(id) ?? 0) - (antes.get(id) ?? 0) >= u - 1e-6);
  if (!entro) return { ok: false, error: "No se comprobó en el destino.", nota: `El traslado ${idT} no se pudo comprobar donde se recibió: revisarlo.` };
  return { ok: true };
}

/**
 * Pasa renglones del estante de Bodega a su área de vencidos y lo COMPRUEBA:
 * un traslado de Bodega a Bodega (sale del estante) que se recibe en la
 * ubicación de vencidos, y después se lee la existencia de vencidos antes y
 * después. Lo usan los erróneos de una compra (`apartarErroneos`) y el paso a
 * vencidos de lo que ya estaba en el estante (`estanteAVencidos`).
 *
 * `partes` va en el formato del formulario de traslado:
 * `producto|compra|venta|paquetes|unidad|vence|presentación|lote`.
 * `esperado` son las UNIDADES que tiene que subir cada producto en vencidos.
 *
 * Nunca reintenta: un traslado que salió y no se pudo identificar o recibir
 * se devuelve con su `traslado` (si se supo) y `salio: true`, para que nadie lo
 * mande otra vez.
 */
async function moverAlAreaDeVencidos(cookie: string, x: {
  partes: string[]; total: number; esperado: Map<number, number>; estante: number; vencidosUbic: number;
  concepto: string; conceptoRecibir: (idTraslado: string) => string;
}): Promise<{ ok: true; traslado: string } | { ok: false; traslado: string | null; salio: boolean; error: string; nota: string }> {
  const falla = (salio: boolean, traslado: string | null, error: string, nota: string) =>
    ({ ok: false as const, salio, traslado, error, nota });
  const pagina = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
  const vale = pagina.match(/numero_vale["'][^>]*value=["']([^"']+)["']/)?.[1] ?? "";
  if (!vale) return falla(false, null, "Sin vale.", "El sistema no entregó el número de vale.");
  const antesVenc = await existenciasDeUbicacion(cookie, ERP_BODEGA, x.vencidosUbic);
  const antes = await pendientesDeOrigenONulo(cookie, x.estante);
  const r = await pedir(cookie, TRASLADO, new URLSearchParams({
    process: "insert", datos: x.partes.join("#") + "#", id_traslado_guardado: "0", cuantos: String(x.partes.length),
    total: x.total.toFixed(4), fecha: hoySV(), concepto: x.concepto,
    origen: String(x.estante), id_suc_destino: String(ERP_BODEGA), id_ubicacion_destino: "0", numero_vale: vale,
  }), { extra: { Referer: TRASLADO }, reintentos: 1 });
  let ok = false;
  try { ok = String(JSON.parse(r)?.typeinfo).toLowerCase() === "success"; } catch { /* abajo */ }
  if (!ok) return falla(false, null, "El traslado a vencidos no entró.", `El sistema no aceptó el traslado: ${r.slice(0, 300)}`);
  const despues = await pendientesDeOrigenONulo(cookie, x.estante);
  // Sin la foto de antes, cualquier traslado viejo a Bodega parecería el nuevo.
  // Un ANTES vacío vale (el área de vencidos casi nunca tiene pendientes); uno
  // que no se pudo leer, no.
  const idT = antes && despues ? (await identificarTrasladoNuevo(cookie, antes, despues, pagina, ERP_BODEGA, [])).id : null;
  if (!idT) {
    return falla(true, null, "Traslado sin identificar: recibirlo a mano.",
      "Salió el traslado a vencidos pero no se pudo identificar su número: recibirlo a mano en vencidos.");
  }

  const rec = await recibirYComprobar(cookie, { idT, renglones: x.partes.length, destino: x.vencidosUbic,
    concepto: x.conceptoRecibir(idT), esperado: x.esperado, antesDestino: antesVenc });
  if (!rec.ok) return falla(true, idT, rec.error, rec.nota);
  return { ok: true, traslado: idT };
}

async function apartarErroneos(admin: any, cookie: string, errs: Erroneo[], x: {
  cargaId: number; documentId: number | null; manualId: number | null; quien: string; emisor: { nit: string | null; nombre: string | null };
  erpCompra: number | null; lineas: LineaSobre[]; mover: boolean; estante: number;
}) {
  const { error: eI } = await admin.from("compra_renglon_erroneo").upsert(errs.map((e) => ({
    compra_carga_id: x.cargaId, document_id: x.documentId, manual_id: x.manualId, renglon: e.renglon,
    emisor_nit: x.emisor.nit, emisor_nombre: x.emisor.nombre, descripcion: e.descripcion,
    codigo_proveedor: e.codigo_proveedor, product_id: e.product_id, es_generico: e.es_generico,
    unidades: e.unidades, costo_unitario: e.costo_unitario, erp_compra_id: x.erpCompra, numero_lote: e.numero_lote ?? null,
    motivo: e.motivo ?? null,
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
    // Se mueven las unidades MARCADAS, no la línea entera: en «A vencidos»
    // pueden ser sólo algunas. En la presentación con que entró (la revisión
    // ya exigió paquetes completos).
    const paquetes = Math.round((e.unidades / (Number(l.unidad) || 1)) * 1e6) / 1e6;
    partes.push([e.product_id, l.compra, l.venta, paquetes, l.unidad, l.vence === "NULL" ? (f.vence || "") : l.vence, l.id_presentacion, idLote].join("|"));
    total += Number(l.compra) * paquetes;
    esperado.set(e.product_id, (esperado.get(e.product_id) ?? 0) + e.unidades);
  }

  const conceptoT = armarConcepto(`PORTAL ${errs.every((e) => e.motivo) ? "" : "ERROR DEL PROVEEDOR "}COMPRA ${x.erpCompra ?? ""} ${x.emisor.nombre ?? ""} A VENCIDOS`).concepto;
  const mov = await moverAlAreaDeVencidos(cookie, {
    partes, total, esperado, estante: x.estante, vencidosUbic, concepto: conceptoT,
    conceptoRecibir: (idT) => `PORTAL ERROR DEL PROVEEDOR (TRASLADO ${idT})`,
  });
  if (mov.traslado) {
    const { error: eTr } = await admin.from("compra_renglon_erroneo").update({ erp_traslado_id: mov.traslado, updated_at: new Date().toISOString() })
      .eq("compra_carga_id", x.cargaId);
    if (eTr) throw eTr;
  }
  if (!mov.ok) { await nota(mov.nota); return { movidos: 0, traslado: mov.traslado ?? undefined, error: mov.error }; }
  const idT = mov.traslado;
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

/* ── Del estante de Bodega a su área de vencidos (2026-11-06) ────────────────
 *
 * Usuario: «creemos algo para bodega que lo pueda hacer, con motivo, foto».
 * Bodega lo hace directo, sin aprobación; por daño exige foto (la tabla lo
 * vuelve a exigir con un CHECK). Hasta hoy sólo se podía al CARGAR una compra;
 * lo que ya estaba en el estante se movía a mano en el sistema y sin rastro.
 *
 * Un solo traslado para todos los renglones, recibido en vencidos y comprobado
 * leyendo vencidos antes y después (`moverAlAreaDeVencidos`). Las filas se
 * escriben ANTES de mandar (`enviando`): un corte a medio camino queda escrito.
 */
const MOTIVOS_A_VENCIDOS = ["proximo_a_vencer", "vencido", "danado", "devolucion", "retiro", "otro"] as const;
// El camino inverso (2026-11-06): lo que está en vencidos y se puede vender
// vuelve al estante. Mismo mecanismo con origen y destino cambiados.
const MOTIVOS_AL_ESTANTE = ["error", "buen_estado", "otro"] as const;
const ROTULO_MOTIVO: Record<string, string> = {
  proximo_a_vencer: "PROXIMO A VENCER", vencido: "VENCIDO", danado: "DANADO",
  devolucion: "DEVOLUCION", retiro: "RETIRO DEL MERCADO", otro: "OTRO",
  error: "ENVIADO POR ERROR", buen_estado: "REVISADO EN BUEN ESTADO",
};

async function estanteAVencidos(admin: any, body: any, quien: string) {
  const alEstante = body?.sentido === "al_estante";
  const motivo = String(body?.motivo ?? "");
  const validos: readonly string[] = alEstante ? MOTIVOS_AL_ESTANTE : MOTIVOS_A_VENCIDOS;
  if (!validos.includes(motivo)) return { error: "Elige el motivo." };
  const detalle = String(body?.detalle ?? "").trim() || null;
  const fotos = (Array.isArray(body?.fotos) ? body.fotos : []).map(String).filter(Boolean).slice(0, 3);
  if (motivo === "danado" && !fotos.length) return { error: "Por daño hace falta al menos una foto." };
  if (motivo === "otro" && (detalle ?? "").length < 4) return { error: alEstante ? "Escribe por qué vuelve al estante." : "Escribe por qué va a vencidos." };
  type Pedido = {
    erp_product_id: number; descripcion: string; presentacion: string; factor: number; cantidad: number;
    lote: string | null; vence: string | null;
  };
  const pedidos: Pedido[] = (Array.isArray(body?.renglones) ? body.renglones : []).map((r: any) => ({
    erp_product_id: Math.trunc(Number(r?.erp_product_id)),
    descripcion: String(r?.descripcion ?? "").trim(),
    presentacion: String(r?.presentacion ?? "").trim(),
    factor: Number(r?.factor),
    cantidad: Number(r?.cantidad),
    lote: r?.lote && String(r.lote).trim().toUpperCase() !== "GENERICO" ? String(r.lote).trim() : null,
    vence: /^\d{4}-\d{2}-\d{2}$/.test(String(r?.vence ?? "")) ? String(r.vence) : null,
  }));
  if (!pedidos.length || pedidos.length > 30) return { error: "Agrega entre 1 y 30 productos." };
  for (const r of pedidos) {
    if (!(r.erp_product_id > 0) || !r.presentacion || !(r.factor > 0) || !(r.cantidad > 0) || !Number.isInteger(r.cantidad)) {
      return { error: `Revisa la cantidad de ${r.descripcion || r.erp_product_id}.` };
    }
  }

  const estante = await ubicacionDeBodega(admin, false);
  const vencidosUbic = await ubicacionDeBodega(admin, true);
  if (!estante || !vencidosUbic) return { error: "No se conoce el estante o el área de vencidos de Bodega." };
  const origen = alEstante ? vencidosUbic : estante;
  const destino = alEstante ? estante : vencidosUbic;
  const dondeSale = alEstante ? "el área de vencidos" : "el estante";

  const cookie = await sesionEn(ERP_BODEGA, login);
  // Todo se valida contra lo que el sistema ofrece AHORA, antes de escribir
  // nada: presentación con ese tamaño, lote y existencia suficiente.
  const partes: string[] = [];
  let total = 0;
  const esperado = new Map<number, number>();
  for (const r of pedidos) {
    const f = await traerFila(cookie, r.erp_product_id, origen);
    if (!f.encontrado) return { error: `${r.descripcion} no está en ${dondeSale} de Bodega.` };
    const pres = await resolverPresentacion(cookie, f, r.presentacion, r.factor, { porFactor: true });
    if (!pres) return { error: `${r.descripcion}: su presentación ya no está en ${dondeSale}.` };
    const unidades = r.cantidad * r.factor;
    let idLote = "0";
    let vence = r.vence ?? f.vence ?? "";
    if (f.regulado) {
      const lote = f.lotes.find((z) => z.numero === r.lote);
      if (!lote) return { error: `${r.descripcion}: el lote ${r.lote ?? "(sin lote)"} ya no está en ${dondeSale}.` };
      if (lote.stock < unidades - 1e-6) return { error: `${r.descripcion}: del lote ${lote.numero} quedan ${lote.stock} unidades.` };
      idLote = lote.id;
      vence = lote.vence || vence;
    } else if (f.existencia < unidades - 1e-6) {
      return { error: `${r.descripcion}: quedan ${f.existencia} unidades en ${dondeSale}.` };
    }
    partes.push([r.erp_product_id, pres.costo, pres.precio, r.cantidad, pres.unidad, vence, pres.id, idLote].join("|"));
    total += Number(pres.costo) * r.cantidad;
    esperado.set(r.erp_product_id, (esperado.get(r.erp_product_id) ?? 0) + unidades);
  }

  const { data: filas, error: eI } = await admin.from("bodega_a_vencidos").insert(pedidos.map((r) => ({
    erp_product_id: r.erp_product_id, descripcion: r.descripcion || String(r.erp_product_id), presentacion: r.presentacion,
    factor: r.factor, cantidad: r.cantidad, unidades: r.cantidad * r.factor, lote: r.lote, vence: r.vence,
    motivo, detalle, fotos, hecho_por: quien, sentido: alEstante ? "al_estante" : "a_vencidos",
  }))).select("id");
  if (eI) throw eI;
  const ids = (filas ?? []).map((f: any) => f.id);
  const cerrar = async (cambios: Record<string, unknown>) => {
    const { error } = await admin.from("bodega_a_vencidos").update({ ...cambios, updated_at: new Date().toISOString() }).in("id", ids);
    if (error) throw error;
  };

  let mov;
  try {
    // El ayudante lleva los nombres del camino de ida; al estante van al revés.
    const rumbo = alEstante ? "AL ESTANTE" : "A VENCIDOS";
    mov = await moverAlAreaDeVencidos(cookie, {
      partes, total, esperado, estante: origen, vencidosUbic: destino,
      concepto: armarConcepto(`PORTAL ${rumbo} ${ROTULO_MOTIVO[motivo]}${detalle ? ` ${detalle}` : ""}`).concepto,
      conceptoRecibir: (idT) => `PORTAL ${rumbo} (TRASLADO ${idT})`,
    });
  } catch (e: any) {
    // No se sabe si salió: queda para revisar, nunca para reintentar a ciegas.
    await cerrar({ estado: "sin_verificar", nota: `Se cortó a medio camino: ${e?.message ?? e}` });
    return { error: "Se cortó a medio camino. Quedó anotado para revisarlo; no lo vuelvas a mandar." };
  }
  if (!mov.ok) {
    await cerrar({ estado: mov.salio ? "sin_verificar" : "fallido", erp_traslado_id: mov.traslado,
      nota: alEstante ? mov.nota.replaceAll("en vencidos", "en el estante") : mov.nota });
    const nota = alEstante ? mov.nota.replaceAll("en vencidos", "en el estante") : mov.nota;
    return { error: mov.salio ? `${nota} No lo vuelvas a mandar.` : mov.error, traslado: mov.traslado };
  }
  // La vuelta al estante termina «devuelto» (con su traslado en los dos
  // campos): así no se ofrece «Devolver» sobre algo que ya está en el estante.
  await cerrar(alEstante
    ? { estado: "devuelto", erp_traslado_id: mov.traslado, devuelto_traslado_id: mov.traslado,
        devuelto_at: new Date().toISOString(), devuelto_por: quien, nota: null }
    : { estado: "en_vencidos", erp_traslado_id: mov.traslado, nota: null });
  if (alEstante) await cerrarEnviosDevueltos(admin, pedidos, mov.traslado, quien);
  return { ok: true, traslado: mov.traslado, renglones: ids.length };
}

// Lo que vuelve a bodega cierra el envío que lo había mandado a vencidos
// (usuario, 2026-11-06: un solo camino de vuelta): mismo producto y lote, el
// más viejo primero, y sólo si lo que volvió lo cubre entero. Si no se puede
// escribir no frena la devolución — el producto ya está en bodega.
async function cerrarEnviosDevueltos(admin: any, pedidos: any[], traslado: string, quien: string) {
  for (const r of pedidos) {
    let q = admin.from("bodega_a_vencidos").select("id, unidades")
      .eq("sentido", "a_vencidos").eq("estado", "en_vencidos").eq("erp_product_id", r.erp_product_id)
      .order("created_at", { ascending: true });
    q = r.lote ? q.eq("lote", r.lote) : q.is("lote", null);
    const { data, error } = await q;
    if (error) { console.error("cerrarEnviosDevueltos", error.message); continue; }
    let quedan = r.cantidad * r.factor;
    const cerrar: number[] = [];
    for (const f of data ?? []) {
      if (Number(f.unidades) > quedan + 1e-6) break;
      quedan -= Number(f.unidades);
      cerrar.push(f.id);
    }
    if (!cerrar.length) continue;
    const { error: eU } = await admin.from("bodega_a_vencidos").update({
      estado: "devuelto", devuelto_traslado_id: traslado, devuelto_at: new Date().toISOString(),
      devuelto_por: quien, updated_at: new Date().toISOString(),
    }).in("id", cerrar).eq("estado", "en_vencidos");
    if (eU) console.error("cerrarEnviosDevueltos", eU.message);
  }
}

async function terminarDevolucion(admin: any, filas: any[], quien: string) {
  const ids = filas.map((f: any) => f.id);
  const estante = await ubicacionDeBodega(admin, false);
  const vencidosUbic = await ubicacionDeBodega(admin, true);
  if (!estante || !vencidosUbic) return { error: "No se conoce el estante o el área de vencidos." };
  const cookie = await sesionEn(ERP_BODEGA, login);
  const pendientes = await pendientesDeOrigenONulo(cookie, vencidosUbic);
  if (!pendientes) return { error: "No se pudieron leer los traslados pendientes de vencidos." };
  const buscados = filas.map((f: any) => norm(f.descripcion));
  const candidatos: string[] = [];
  for (const id of pendientes.keys()) {
    const texto = await contenidoDeTraslado(cookie, id);
    if (texto && buscados.every((d) => texto.includes(d))) candidatos.push(id);
  }
  if (candidatos.length !== 1) {
    return { error: candidatos.length ? `Hay ${candidatos.length} traslados pendientes con esos productos: recibirlo a mano.` : "No hay ningún traslado pendiente con esos productos desde vencidos." };
  }
  const idT = candidatos[0];
  const esperado = new Map<number, number>();
  for (const f of filas) esperado.set(f.erp_product_id, (esperado.get(f.erp_product_id) ?? 0) + Number(f.unidades));
  const antes = await existenciasDeUbicacion(cookie, ERP_BODEGA, estante);
  const rec = await recibirYComprobar(cookie, { idT, renglones: filas.length, destino: estante,
    concepto: `PORTAL DEVUELVE AL ESTANTE (TRASLADO ${idT})`, esperado, antesDestino: antes });
  const ahora = new Date().toISOString();
  if (!rec.ok) {
    const { error } = await admin.from("bodega_a_vencidos").update({ devuelto_traslado_id: idT, nota: `Devolución: ${rec.nota}`, updated_at: ahora }).in("id", ids);
    if (error) throw error;
    return { error: rec.error, traslado: idT };
  }
  const { error } = await admin.from("bodega_a_vencidos").update({
    estado: "devuelto", devuelto_at: ahora, devuelto_por: quien, devuelto_traslado_id: idT, nota: null, updated_at: ahora,
  }).in("id", ids);
  if (error) throw error;
  return { ok: true, traslado: idT, renglones: ids.length, terminada: true };
}

/**
 * Deshace un paso a vencidos: lo que entró a vencidos con el traslado
 * `traslado` vuelve al estante, con el mismo mecanismo al revés (origen =
 * vencidos, destino = estante) y comprobado en el estante. Sirve para un
 * error de Bodega y para probar el circuito sin dejar rastro en la existencia.
 * Se «toma» la fila (`devolviendo`) antes de mandar: dos clics no devuelven
 * dos veces.
 */
async function vencidosAEstante(admin: any, traslado: string, quien: string) {
  if (!traslado) return { error: "Falta el traslado." };
  // Una devolución que SALIÓ y quedó sin número (sin recibir): se termina, no
  // se manda otra. Se busca entre los pendientes que salen de vencidos el que
  // lleva estos productos, y tiene que ser uno solo.
  const { data: atascadas, error: eA } = await admin.from("bodega_a_vencidos").select("*")
    .eq("erp_traslado_id", traslado).eq("estado", "devolviendo").is("devuelto_traslado_id", null);
  if (eA) throw eA;
  if (atascadas?.length) return await terminarDevolucion(admin, atascadas, quien);
  const { data: filas, error: eT } = await admin.from("bodega_a_vencidos")
    .update({ estado: "devolviendo", updated_at: new Date().toISOString() })
    .eq("erp_traslado_id", traslado).eq("estado", "en_vencidos").select("*");
  if (eT) throw eT;
  if (!filas?.length) return { error: "Ese paso a vencidos no está comprobado en vencidos (o ya se devolvió)." };
  const ids = filas.map((f: any) => f.id);
  const cerrar = async (cambios: Record<string, unknown>) => {
    const { error } = await admin.from("bodega_a_vencidos").update({ ...cambios, updated_at: new Date().toISOString() }).in("id", ids);
    if (error) throw error;
  };
  const estante = await ubicacionDeBodega(admin, false);
  const vencidosUbic = await ubicacionDeBodega(admin, true);
  if (!estante || !vencidosUbic) { await cerrar({ estado: "en_vencidos" }); return { error: "No se conoce el estante o el área de vencidos." }; }

  const cookie = await sesionEn(ERP_BODEGA, login);
  const partes: string[] = [];
  let total = 0;
  const esperado = new Map<number, number>();
  for (const r of filas) {
    const f = await traerFila(cookie, r.erp_product_id, vencidosUbic);
    const pres = f.encontrado ? await resolverPresentacion(cookie, f, r.presentacion, Number(r.factor), { porFactor: true }) : null;
    let idLote = "0";
    let vence = r.vence ?? f.vence ?? "";
    if (pres && f.regulado) {
      const lote = f.lotes.find((z) => z.numero === r.lote);
      if (!lote || lote.stock < Number(r.unidades) - 1e-6) { await cerrar({ estado: "en_vencidos" }); return { error: `${r.descripcion}: ya no está completo en vencidos.` }; }
      idLote = lote.id; vence = lote.vence || vence;
    } else if (!pres || f.existencia < Number(r.unidades) - 1e-6) {
      await cerrar({ estado: "en_vencidos" }); return { error: `${r.descripcion}: ya no está completo en vencidos.` };
    }
    partes.push([r.erp_product_id, pres.costo, pres.precio, Number(r.cantidad), pres.unidad, vence, pres.id, idLote].join("|"));
    total += Number(pres.costo) * Number(r.cantidad);
    esperado.set(r.erp_product_id, (esperado.get(r.erp_product_id) ?? 0) + Number(r.unidades));
  }
  let mov;
  try {
    // El ayudante lleva los nombres del camino de ida; acá van al revés.
    mov = await moverAlAreaDeVencidos(cookie, {
      partes, total, esperado, estante: vencidosUbic, vencidosUbic: estante,
      concepto: armarConcepto(`PORTAL DEVUELVE DE VENCIDOS AL ESTANTE (TRASLADO ${traslado})`).concepto,
      conceptoRecibir: (idT) => `PORTAL DEVUELVE AL ESTANTE (TRASLADO ${idT})`,
    });
  } catch (e: any) {
    await cerrar({ nota: `La devolución se cortó a medio camino: ${e?.message ?? e}` });
    return { error: "La devolución se cortó a medio camino. Quedó anotado; no la vuelvas a mandar." };
  }
  if (!mov.ok) {
    if (!mov.salio) { await cerrar({ estado: "en_vencidos", nota: mov.nota }); return { error: mov.error }; }
    await cerrar({ devuelto_traslado_id: mov.traslado, nota: `Devolución: ${mov.nota.replaceAll("en vencidos", "en el estante")}` });
    return { error: "La devolución salió pero no se comprobó en el estante. No la vuelvas a mandar.", traslado: mov.traslado };
  }
  await cerrar({ estado: "devuelto", devuelto_at: new Date().toISOString(), devuelto_por: quien, devuelto_traslado_id: mov.traslado, nota: null });
  return { ok: true, traslado: mov.traslado, renglones: ids.length };
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

/**
 * Faltante con nota de crédito (2026-11-04). «Llegaron menos» deja la factura
 * entrar COMPLETA, así que Bodega quedó con unidades que nunca llegaron. Cuando
 * el proveedor manda la nota por lo que faltó, se hace lo mismo que con un
 * erróneo —MISMO registro en el libro—, pero lo que se descarga sale del
 * ESTANTE de Bodega: ahí entró y de ahí nunca salió (a las salas no se manda
 * lo que no llegó: lo frena la carga).
 *
 * Antes de mandar nada se mira que el estante tenga al menos lo que falta: si
 * ya no lo tiene, alguien lo ajustó a mano y descargarlo otra vez dejaría la
 * existencia corta.
 */
async function faltanteDeBodega(admin: any, id: number) {
  const { data: f, error: eF } = await admin.from("compra_por_llegar").select("*").eq("id", id).maybeSingle();
  if (eF) throw eF;
  if (!f) return null;
  const { data: g, error: eG } = await admin.from("compra_registro")
    .select("erp_product_id, producto, descripcion_proveedor, lote, erp_compra_id, document_id, manual_id, proveedor_nombre, numero_documento")
    .eq("id", f.registro_id).maybeSingle();
  if (eG) throw eG;
  return g ? { f, g } : null;
}

async function anotarFaltante(admin: any, id: number, estado: string, cambios: Record<string, unknown>, quien: string | null, nota: string | null) {
  const t = new Date().toISOString();
  const { error } = await admin.from("compra_por_llegar").update({ estado, ...cambios, updated_at: t, cambiado_at: t, ...(quien ? { cambiado_por: quien } : {}) }).eq("id", id);
  if (error) { console.error("[cargar-compra-erp] anotar el faltante", id, estado, error.message); return; }
  const { error: eL } = await admin.from("compra_por_llegar_log").insert({ por_llegar_id: id, estado, nota, por: quien });
  if (eL) console.error("[cargar-compra-erp] historial del faltante", id, eL.message);
}

async function darSalidaFaltante(admin: any, id: number, quien: string) {
  if (!Number.isFinite(id)) return { error: "Falta el faltante." };
  const { data: tomadas, error: eT } = await admin.from("compra_por_llegar")
    .update({ estado: "saliendo", updated_at: new Date().toISOString() })
    .eq("id", id).eq("estado", "con_nota").select("id");
  if (eT) throw eT;
  if (!tomadas?.length) return { error: "Ese faltante no está listo para salir (tiene que tener su nota de crédito adjunta)." };
  const x = await faltanteDeBodega(admin, id);
  if (!x) return { error: "No se encontró el renglón de la compra." };
  const { f, g } = x;
  const faltan = Number(f.faltan);
  const volver = (nota: string) => anotarFaltante(admin, id, "con_nota", { nota }, null, nota);
  let mandado = false;
  try {
    const cookie = await sesionEn(ERP_BODEGA, login);
    const libro = f.nota_papel_id
      ? await registrarNotaPapelEnLibro(admin, cookie,
          { nota_papel_id: f.nota_papel_id, erp_compra_id: g.erp_compra_id, manual_id: g.manual_id, document_id: g.document_id }, quien)
      : await registrarNotaEnLibro(admin, cookie, Number(f.nota_credito_document_id), quien);
    if (!libro.ok) { await volver(libro.error ?? "No se pudo registrar la nota."); return { error: libro.error }; }

    const estante = await ubicacionDeBodega(admin, false);
    if (!estante) { await volver("No se conoce el estante de Bodega."); return { error: "No se conoce el estante de Bodega." }; }
    const antes = await existenciasDeUbicacion(cookie, ERP_BODEGA, estante);
    if (!antes) { await volver("No se pudo leer la existencia de Bodega."); return { error: "No se pudo leer la existencia de Bodega: intenta de nuevo." }; }
    const stockAntes = antes.get(Number(g.erp_product_id)) ?? 0;
    if (stockAntes < faltan - 1e-6) {
      const nota = `En Bodega hay ${stockAntes} y salen ${faltan}: alguien ya lo ajustó. La nota quedó en el libro; revisa la existencia antes de seguir.`;
      await volver(nota); return { error: nota };
    }
    await anotarFaltante(admin, id, "saliendo", { salida: { antes: stockAntes } }, null, null);
    const { data: nc, error: eNc } = f.nota_papel_id
      ? await admin.from("compra_nota_credito_papel").select("numero_control:numero").eq("id", f.nota_papel_id).maybeSingle()
      : await admin.from("purchase_dte_documents").select("numero_control").eq("id", f.nota_credito_document_id).maybeSingle();
    if (eNc) { await volver(`No se pudo leer la nota: ${eNc.message}`); return { error: "No se pudo leer la nota de crédito: intenta de nuevo." }; }
    const descripcion = String(g.producto ?? g.descripcion_proveedor ?? "");
    const concepto = armarConcepto(
      `FALTANTE DE ${g.proveedor_nombre ?? "PROVEEDOR"} - NOTA DE CREDITO ${nc?.numero_control ?? ""} - COMPRA ${g.erp_compra_id ?? ""} - ${descripcion}`,
    ).concepto;
    mandado = true;
    const r = await descartarUnaLinea({
      erpSucursal: ERP_BODEGA, erpUbicacion: estante, concepto, iden: "DESCARTE",
      linea: { erp_product_id: Number(g.erp_product_id), presentacion_tipo: "", factor: 1, cantidad: faltan, descripcion, lote: g.lote ?? null },
    });
    if (!r.ok) {
      if (r.codigo === "INCIERTO") {
        const c = await comprobarSalidaDeFaltante(admin, cookie, id, Number(g.erp_product_id), faltan, estante, stockAntes, quien);
        return c.salio ? { ok: true, comprobado: true } : { error: "No se sabe si salió: NO le des salida de nuevo; toca «Comprobar» en un momento." };
      }
      await anotarFaltante(admin, id, "con_nota", { nota: r.error, salida: null }, null, r.error ?? null);
      return { error: r.error };
    }
    const despues = await existenciasDeUbicacion(cookie, ERP_BODEGA, estante);
    const bajo = despues ? stockAntes - (despues.get(Number(g.erp_product_id)) ?? 0) : null;
    const comprobado = bajo != null && bajo >= faltan - 1e-6;
    await anotarFaltante(admin, id, "nota_credito", {
      salida: { ...r.aplicado, antes: stockAntes, comprobado, bajo },
      nota: comprobado ? null : "Se descargó, pero la existencia de Bodega no bajó lo esperado: revisarlo.",
    }, quien, `salió de Bodega (${faltan})`);
    return { ok: true, comprobado };
  } catch (err) {
    if (mandado) await anotarFaltante(admin, id, "sin_verificar", { nota: `Se cortó al descargarlo: ${(err as Error)?.message ?? err}. Comprobar antes de seguir.` }, null, "se cortó al descargar");
    else await volver(`Falló: ${(err as Error)?.message ?? err}`);
    throw err;
  }
}

/** ¿Salió del estante? La misma regla que `comprobarSalida` de los erróneos. Sólo lectura. */
async function comprobarSalidaDeFaltante(admin: any, cookie: string, id: number, producto: number, faltan: number,
  estante: number, antes: number, quien: string | null) {
  const ahora = await existenciasDeUbicacion(cookie, ERP_BODEGA, estante);
  const bajo = ahora ? antes - (ahora.get(producto) ?? 0) : null;
  const salio = bajo != null && bajo >= faltan - 1e-6;
  const nada = bajo != null && Math.abs(bajo) < 1e-6;
  if (salio) await anotarFaltante(admin, id, "nota_credito", { nota: null, salida: { antes, bajo, comprobado: true } }, quien, `salió de Bodega (${faltan}), comprobado`);
  else if (nada) await anotarFaltante(admin, id, "con_nota", { nota: "No había salido: se puede dar salida de nuevo." }, null, "no había salido");
  else await anotarFaltante(admin, id, "sin_verificar", {
    nota: bajo == null ? "No se pudo leer Bodega para comprobar." : `Bodega bajó ${bajo} y salían ${faltan}: revisarlo en el sistema.`,
  }, null, null);
  return { salio };
}

async function comprobarFaltante(admin: any, id: number, quien: string) {
  const x = await faltanteDeBodega(admin, id);
  if (!x) return { error: "Ese faltante no existe." };
  if (x.f.estado !== "sin_verificar") return { error: "Ese faltante no está por comprobar." };
  const antes = Number(x.f.salida?.antes);
  if (!Number.isFinite(antes)) return { error: "No quedó la existencia de antes: revisarlo en el sistema." };
  const estante = await ubicacionDeBodega(admin, false);
  if (!estante) return { error: "No se conoce el estante de Bodega." };
  const cookie = await sesionEn(ERP_BODEGA, login);
  return await comprobarSalidaDeFaltante(admin, cookie, id, Number(x.g.erp_product_id), Number(x.f.faltan), estante, antes, quien);
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
  // Un antibiótico no se da de alta copiando: lo que lo hace controlado es
  // justo lo que hay que decidir con cuidado. «Regulado» YA NO frena
  // (2026-11-05): desde ese día significa «lleva lote» —lo tienen todos los
  // medicamentos, para trazabilidad— y no «controlado». Frenarlo dejaba sin
  // alta desde la compra a cualquier medicamento nuevo. El nuevo HEREDA la
  // casilla del modelo (`sobreDeProductoNuevo`), así que nace con lote.
  if (m && m.antibiotico) problemas.push(`«${m.nombre}» es antibiótico: un producto así se da de alta a mano.`);

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

// El interruptor de Cargar compra (`compra_pausa`, lo cambian Gerencia y
// Administración desde la pantalla). Frena TODA escritura al sistema; las
// lecturas y los «Comprobar» siguen. Si no se puede leer, frena: escribir sin
// saber si alguien pausó es justo lo que el interruptor existe para impedir.
async function pausa(admin: any): Promise<string | null> {
  const { data, error } = await admin.from("compra_pausa").select("pausada, motivo").order("id", { ascending: false }).limit(1);
  if (error) return "No se pudo comprobar si las escrituras están pausadas. Intenta de nuevo.";
  const u = data?.[0];
  return u?.pausada ? `Las escrituras al sistema están pausadas${u.motivo ? `: ${u.motivo}` : "."}` : null;
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
  const escribe = cuerpo?.enviar === true || cuerpo?.accion === "reparto_recibir" || cuerpo?.accion === "reparto_reintentar"
    || cuerpo?.accion === "erroneo_salida" || cuerpo?.accion === "faltante_salida" || cuerpo?.accion === "estante_a_vencidos" || cuerpo?.accion === "vencidos_a_estante" || (cuerpo?.accion === "producto_nuevo" && cuerpo?.crear === true);
  if (escribe) {
    const p = await pausa(admin);
    if (p) return responder({ error: p, pausada: true }, 409);
  }
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
    if (body?.accion === "vencidos_a_estante") {
      const r = await vencidosAEstante(admin, String(body?.traslado ?? ""), quien.id);
      return responder(r, "error" in r ? 409 : 200);
    }
    if (body?.accion === "estante_a_vencidos") {
      const r = await estanteAVencidos(admin, body, quien.id);
      return responder(r, "error" in r ? 409 : 200);
    }
    if (body?.accion === "erroneo_comprobar") return responder(await comprobarErroneo(admin, Number(body?.id)));
    if (body?.accion === "faltante_salida") return responder(await darSalidaFaltante(admin, Number(body?.id), quien.id));
    if (body?.accion === "faltante_comprobar") return responder(await comprobarFaltante(admin, Number(body?.id), quien.id));
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
    const deLinea: { renglon: number; descripcion: string }[] = [];   // qué renglón es cada línea
    const erroneos: Erroneo[] = [];
    const reparto: LineaReparto[] = [];
    const salas = uso === "venta" ? await salasDeReparto(admin) : new Map<number, Sala>();
    // Las fichas de todos los productos elegidos, de a 6 a la vez, ANTES del
    // bucle: leerlas una por una dentro de él era lo que hacía tardar
    // «Revisar carga» (Bodega, 2026-11-05). El bucle después sólo lee la caché.
    if (uso !== "consumo") {
      const pids = [...new Set(items.map((_, i) => {
        const x = (decisiones[String(i)] ?? {}) as any;
        if (x.servicio === true) return 0;
        const n = Number(x.product_id);
        return x.erroneo === true && !(n > 0) ? PRODUCTO_ERRONEO : n;
      }).filter((n) => Number.isFinite(n) && n > 0))];
      for (let k = 0; k < pids.length; k += 6) {
        await Promise.all(pids.slice(k, k + 6).map(async (pid) => cache.set(pid, await productoDelSistema(cookie, pid))));
      }
    }
    // El descuento al pie de la factura se reparte en el costo de cada renglón.
    const dsc = factorDescuentoDeFactura(dte?.resumen);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const r: RenglonDoc = {
        descripcion: String(it?.descripcion ?? ""),
        cantidad: Number(it?.cantidad), precio: Number(it?.precioUni),
        descuento: Number(it?.montoDescu ?? 0),
        exento: Number(it?.ventaExenta ?? 0) > 0,
        subtotal: Number(it?.ventaGravada ?? 0) * dsc.gravada + Number(it?.ventaExenta ?? 0) * dsc.exenta + Number(it?.ventaNoSuj ?? 0),
      };
      let dec: Decision;
      if (uso === "consumo") dec = { tipo: "consumo" };
      else if ((decisiones[String(i)] as any)?.servicio === true) {
        // Flete / servicio: entra en la misma compra como SERVICIO, sin producto.
        if ((decisiones[String(i)] as any)?.erroneo === true) {
          problemas.push({ renglon: i, texto: `«${r.descripcion}» no puede ser servicio y producto erróneo a la vez.` });
        }
        dec = { tipo: "servicio" };
      } else {
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
          venta: pid === PRODUCTO_ERRONEO ? null : (Number((x as any).venta) > 0 ? Number((x as any).venta) : null),
        };
      }
      const res = lineaDelSobre(i, r, dec);
      problemas.push(...res.problemas);
      // «Llegaron menos»: la factura entra COMPLETA (la cobraron entera y el
      // libro la lleva así) y lo que falta queda «por llegar». Sólo se anota:
      // lo único que cambia acá es que a las salas no se manda lo que no está.
      const pideLlegaron = (decisiones[String(i)] as any)?.llegaron;
      let llegaron: number | null = null;
      if (res.linea && dec.tipo === "producto" && pideLlegaron != null && pideLlegaron !== "") {
        const entranTodas = Number(res.linea.cant) * (Number(res.linea.unidad) || 1);
        const n = Number(pideLlegaron);
        if ((decisiones[String(i)] as any)?.erroneo === true) {
          problemas.push({ renglon: i, texto: `«${r.descripcion}» es un producto erróneo: no lleva «llegaron menos».` });
        } else if (!Number.isInteger(n) || n < 0 || n >= entranTodas) {
          problemas.push({ renglon: i, texto: `«${r.descripcion}»: llegaron ${pideLlegaron}, y tiene que ser un número entero menor que las ${entranTodas} facturadas.` });
        } else llegaron = n;
      }
      if (res.linea && dec.tipo === "producto" && (decisiones[String(i)] as any)?.erroneo === true) {
        const u = Number(res.linea.unidad) || 1;
        erroneos.push({
          renglon: i, descripcion: r.descripcion, codigo_proveedor: String(it?.codigo ?? "") || null,
          product_id: Number(res.linea.id_producto), es_generico: Number(res.linea.id_producto) === PRODUCTO_ERRONEO,
          unidades: Number(res.linea.cant) * u, costo_unitario: 0,   // después de prorratear los regalos
          linea_idx: lineas.length, numero_lote: res.linea.numero_lote || null,
        });
      }
      // «A vencidos»: el producto BUENO entra con su nombre y algunas o todas
      // sus unidades pasan al área de vencidos (devolución, corto vencimiento,
      // dañado). Mismo camino que el erróneo — `apartarErroneos` — con motivo.
      const pideVencidos = (decisiones[String(i)] as any)?.vencidos;
      let aVencidos = 0;
      if (res.linea && dec.tipo === "producto" && pideVencidos && typeof pideVencidos === "object") {
        const unidad = Number(res.linea.unidad) || 1;
        const entran = Number(res.linea.cant) * unidad;
        const tope = llegaron ?? entran;
        const n = pideVencidos.unidades == null || pideVencidos.unidades === "" ? tope : Number(pideVencidos.unidades);
        const motivo = String(pideVencidos.motivo ?? "");
        const detalleMotivo = String(pideVencidos.detalle ?? "").trim();
        if ((decisiones[String(i)] as any)?.erroneo === true) {
          problemas.push({ renglon: i, texto: `«${r.descripcion}» ya es un producto erróneo: va a vencidos entero, no lleva «A vencidos».` });
        } else if (!MOTIVOS_VENCIDOS[motivo]) {
          problemas.push({ renglon: i, texto: `«${r.descripcion}»: falta el motivo por el que va a vencidos.` });
        } else if (motivo === "otro" && !detalleMotivo) {
          problemas.push({ renglon: i, texto: `«${r.descripcion}»: escribe el motivo por el que va a vencidos.` });
        } else if (!Number.isInteger(n) || n <= 0 || n > tope) {
          problemas.push({ renglon: i, texto: `«${r.descripcion}»: a vencidos van ${pideVencidos.unidades}, y tiene que ser un número entero entre 1 y ${tope}${llegaron != null ? " (las que llegaron)" : ""}.` });
        } else if (Math.abs(n / unidad - Math.round(n / unidad)) > 1e-9) {
          problemas.push({ renglon: i, texto: `«${r.descripcion}»: entra en paquetes de ${unidad}; a vencidos tienen que ir ${unidad}, ${unidad * 2}… (van ${n}).` });
        } else {
          aVencidos = n;
          erroneos.push({
            renglon: i, descripcion: r.descripcion, codigo_proveedor: String(it?.codigo ?? "") || null,
            product_id: Number(res.linea.id_producto), es_generico: false, unidades: n, costo_unitario: 0,
            linea_idx: lineas.length, numero_lote: res.linea.numero_lote || null,
            motivo: motivo === "otro" ? `Otro: ${detalleMotivo.slice(0, 200)}` : MOTIVOS_VENCIDOS[motivo],
          });
        }
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
          const extra = aVencidos ? ` y ${aVencidos} a vencidos` : "";
          if (suma + aVencidos > entran + 1e-9) problemas.push({ renglon: i, texto: `«${r.descripcion}»: se envían ${suma} a salas${extra}, y entran ${entran}.` });
          else if (llegaron != null && suma + aVencidos > llegaron + 1e-9) {
            problemas.push({ renglon: i, texto: `«${r.descripcion}»: se envían ${suma} a salas${extra}, y sólo llegaron ${llegaron}.` });
          }
        }
      }
      if (res.linea) { lineas.push(res.linea); cobrado.push(Number(r.subtotal) || 0); deLinea.push({ renglon: i, descripcion: r.descripcion }); }
      // Lo que el registro de compras necesita y la línea del sistema no dice:
      // el precio de lista, los dos descuentos y si el renglón venía de regalo
      // (se mira ANTES de repartirle costo, que es cuando todavía vale $0).
      detalle.push({
        renglon: i, descripcion: r.descripcion, linea: res.linea, ...(res.detalle ?? {}),
        codigo_proveedor: String(it?.codigo ?? "").trim() || null,
        precio_lista: Number.isFinite(r.precio) ? r.precio : null,
        descuento_renglon: r.descuento || 0,
        descuento_pie_pct: Math.round((1 - (r.exento ? dsc.exenta : dsc.gravada)) * 1e4) / 100,
        regalo: !!res.linea && res.linea.bandera === "PRODUCTO" && Number(res.linea.compra) === 0,
        llegaron,
        // El sistema sólo recibe el lote de un regulado; el registro lo guarda siempre.
        lote_leido: dec.tipo === "producto" ? (String(dec.lote ?? "").trim() || null) : null,
      });
    }

    const regalos = repartirRegalos(lineas, cobrado);
    // El costo que viaja a la sala y el del erróneo, ya con los regalos
    // prorrateados: capturado antes, un promocional iba a $0 y los pagados caros.
    for (const e of erroneos) {
      const l = lineas[e.linea_idx!];
      e.costo_unitario = Math.round((Number(l.compra) / (Number(l.unidad) || 1)) * 1e4) / 1e4;
    }
    for (const rp of reparto) rp.compra = String(lineas[rp.linea_idx!].compra);
    const armado = totalesDelSobre(lineas, tipoDoc, tasa);
    const totalDoc = totalDelDocumento(dte?.resumen);
    const diferencia = totalDoc == null ? null : Math.round((Number(armado.total) - totalDoc) * 100) / 100;
    // Lo que viaja en el encabezado: los montos del documento cuando la
    // diferencia es de redondeo y todos los renglones están armados (ver
    // `encabezadoDelDocumento`). Con una diferencia de verdad queda lo armado
    // y la revisión de abajo frena.
    const tot = lineas.length === items.length ? encabezadoDelDocumento(armado, dte?.resumen, totalDoc, TOLERANCIA) : armado;
    if (diferencia == null) problemas.push({ renglon: null, texto: "El documento no trae su total." });
    // Sólo con TODOS los renglones armados: con uno sin producto el total
    // sale corto por construcción, y decirlo repite el problema de arriba.
    else if (lineas.length === items.length && Math.abs(diferencia) > TOLERANCIA) {
      problemas.push({
        renglon: null,
        texto: `El total armado ($${tot.total}) no cuadra con el de la factura ($${totalDoc!.toFixed(2)}): ${diferencia > 0 ? "sobran" : "faltan"} $${Math.abs(diferencia).toFixed(2)}.`,
        // Qué puede ser: la persona no tiene cómo saberlo mirando dos totales.
        pistas: pistasDeDiferencia({
          diferencia, tasaPercepcion: tasa, tipoDoc, resumen: dte?.resumen,
          hayRegalos: regalos > 0,
          carga: {
            gravada: Number(tot.sumas_sin_iva), exenta: Number(tot.venta_exenta),
            iva: Number(tot.iva), percepcion: Number(tot.total_percepcion),
          },
          renglones: lineas.map((l, k) => ({
            ...deLinea[k],
            armado: Math.round(Number(l.compra_fin) * Number(l.cant) * 100) / 100,
            cobrado: Math.round((cobrado[k] ?? 0) * 100) / 100,
          })),
        }),
      });
    }

    // Cargada a mano con el NÚMERO DE CONTROL (65 de 1,013 desde agosto) o
    // con su correlativo solo: además mismo proveedor y mismo total. Qué
    // número identifica y cuál es el prefijo común del emisor lo decide
    // `coincideConControl` (2026-11-04: el prefijo de puros ceros daba por
    // registrada una factura en 14 compras y no veía la verdadera).
    if (!manual && d.numero_control && erpProveedor && totalDoc != null) {
      const { data: pc, error: ePc } = await admin.from("purchase_receipts")
        .select("erp_purchase_id, documento_numero, total, estado, fecha")
        .eq("erp_supplier_id", erpProveedor).gte("total", totalDoc - 0.05).lte("total", totalDoc + 0.05);
      if (ePc) throw ePc;
      const ya = (pc ?? []).filter((r: any) => {
        if ((r.estado ?? "") === "anulada") return false;
        const como = coincideConControl(String(d.numero_control), String(r.documento_numero ?? ""));
        return como === "control" || como === "correlativo"
          || (como === "prefijo" && fechaCercana(String(d.fecha_emision ?? ""), String(r.fecha ?? "")));
      });
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
      // Un papel es DOCUMENTO IMPRESO (1) y lleva su serie; un DTE, 4, y su
      // «número de serie» es el SELLO DE RECEPCIÓN de Hacienda (lo mismo que
      // pide el anexo). Iba vacío: las 70 compras cargadas desde el portal hasta
      // el 6-nov quedaron sin sello en el sistema, mientras que las cargadas a
      // mano lo llevan (215 de 247, todas iguales al del documento).
      clase_documento_tributario: manual ? "1" : "4",
      numero_serie: manual ? (manual.serie ?? "") : String(d.sello_recibido ?? ""),
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
      total_documento: totalDoc, total_armado: Number(tot.total),
      diferencia: totalDoc == null ? null : Math.round((Number(tot.total) - totalDoc) * 100) / 100,
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
    // Un envío que falla ANTES de tomar la carga (típico: el inicio de sesión
    // del sistema se corta, 2026-11-06 doc 7364) no mandó nada. Decirlo como
    // «no se sabe si entró» asustaba sin motivo y además pintaba la dirección
    // del sistema en pantalla. Lo que decide es la fila: si sigue `simulada`,
    // nadie la tomó y no salió nada.
    if (cuerpo?.enviar === true && Number(cuerpo?.carga_id) > 0) {
      const { data: c, error: eC } = await admin.from("compra_carga").select("estado").eq("id", Number(cuerpo.carga_id)).maybeSingle();
      if (eC) console.error("[cargar-compra-erp] leer la carga tras el fallo:", eC.message);
      if (!eC && c?.estado === "simulada") {
        return responder({ enviada: false, error: "No se pudo conectar con Bodega y no se mandó nada. Inténtalo de nuevo en un momento." });
      }
      return responder({ enviada: null, error: "Se cortó la conexión con Bodega a medio envío." }, 500);
    }
    return responder({ error: e?.message ?? String(e) }, 500);
  }
});
