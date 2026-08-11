// Las pantallas de traslado del sistema de origen, leídas en un solo lugar.
//
// Nacieron dentro de `aplicar-traslado-inventario` y se copiaron acá el
// 2026-08-11, cuando `trasladar-pedido-erp` necesitó exactamente las mismas.
// Son parsers de HTML: el día que el sistema cambie un `<select>`, dos copias
// que se toquen por separado leen la misma pantalla distinto.
//
// ⚠️ **HOY HAY DOS COPIAS, a propósito y por un rato.** Este módulo es el que
// manda de acá en adelante, pero `aplicar-traslado-inventario` sigue con las
// suyas adentro: es una función que mueve inventario real y está en uso, y
// refactorizarla en el mismo cambio que estrena `trasladar-pedido-erp` —que
// justamente salió en modo simulacro para no escribir todavía— es meter riesgo
// donde se acordó no meterlo. **Pendiente: pasarla a importar de acá**, y ahí
// desaparece la copia. Mientras tanto, un arreglo a cualquiera de estos parsers
// va a los DOS archivos.
//
// Todo lo que vive acá es puro o depende solo de la cookie de sesión. Lo que
// decide QUÉ trasladar —permisos, cantidades, candados— se queda en cada
// función, porque ahí sí son distintas: una despacha lo que una sala le pidió a
// otra, la otra despacha un pedido de reposición entero.

import { BASE, pedir } from "./erp-dte.ts";

export const TRASLADO = `${BASE}/traslado_producto.php`;
export const RECIBIR = `${BASE}/recibir_traslado.php`;
export const SESION = `${BASE}/cambio_sesion.php`;
export const LISTADO = `${BASE}/admin_traslados_dt.php`;
export const VER = `${BASE}/ver_traslado.php`;

// El sistema no declara cuánto aguanta el `concepto` y no hay forma de leerlo
// sin escribir. Se recorta a un largo conservador y se AVISA cuando pasa: un
// tope callado se lee como que entró completo.
export const CONCEPTO_MAX = 200;

export const norm = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * El concepto, en ASCII puro.
 *
 * El sistema sirve sus páginas en UTF-8 pero vuelve a leer los bytes como
 * Latin-1 al guardarlos y al imprimir el kardex. Se transcribe en vez de
 * borrarse: «Nuñez» queda «Nunez» y no «Nuez».
 */
export function soloAscii(s: string): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[·•]/g, "-")
    .replace(/[—–]/g, "-")
    .replace(/[«»“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** La fecha de El Salvador (UTC-6 todo el año), en yyyy-mm-dd. */
export function hoySV(): string {
  return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Lo que `traerdatos` contesta, ya sin el HTML. */
export interface Fila {
  encontrado: boolean;
  presentaciones: { id: string; tipo: string }[];
  existencia: number; // en unidades base
  vence: string;
  regulado: boolean;
  lotes: { id: string; numero: string; vence: string; stock: number }[];
}

/** Los lotes que el sistema ofrece, con su número y su fecha. */
export function leerLotes(html: string) {
  return [...html.matchAll(/<option([^>]*)>([^<]*)</g)].map((m) => {
    const attrs = m[1];
    const etiqueta = m[2].trim();
    return {
      id: attrs.match(/value=['"](\d+)['"]/)?.[1] ?? "",
      numero: etiqueta.split(" - ")[0].trim(),
      vence: attrs.match(/data-vencimiento=['"]([^'"]*)['"]/)?.[1] ?? "",
      stock: Number(attrs.match(/data-stock=['"]([^'"]*)['"]/)?.[1] ?? 0),
    };
  }).filter((l) => l.id);
}

/**
 * La fila HTML que devuelve `traerdatos`.
 *
 * Un producto que no está en esa ubicación NO da error: da la misma fila con
 * «TOTAL STOCK: 0» y el <select> de presentaciones vacío. Por eso el criterio de
 * «encontrado» es que haya al menos una presentación, y no el status.
 */
export function leerFila(html: string): Fila {
  const loteSel = html.match(/<select[^>]*class=['"][^'"]*lote-select[^'"]*['"][^>]*>([\s\S]*?)<\/select>/)?.[0] ?? "";
  const presSel = html.match(/<select[^>]*class=["'][^"']*\bsel\b[^"']*["'][^>]*>([\s\S]*?)<\/select>/)?.[1] ?? "";
  const presentaciones = [...presSel.matchAll(/<option[^>]*value=["'](\d+)["'][^>]*>([^<]*)</g)]
    .map((m) => ({ id: m[1], tipo: norm(m[2]) }));
  return {
    encontrado: presentaciones.length > 0,
    presentaciones,
    // `.exis` viene en unidades base: el propio JS del sistema lo compara contra
    // `cantidad × unidad`, así que es la referencia correcta para el tope.
    existencia: Number(html.match(/class=['"][^'"]*\bexis\b[^'"]*['"][^>]*>([\d.]+)/)?.[1] ?? 0),
    vence: html.match(/class=['"][^'"]*\bvence\b[^'"]*['"][^>]*value=['"]([^'"]*)['"]/)?.[1] ?? "",
    regulado: /data-regulado=['"]1['"]/.test(loteSel),
    lotes: leerLotes(loteSel),
  };
}

/**
 * Abre la sesión del sistema en una sucursal. Devuelve la cookie o lanza.
 *
 * La sucursal es estado GLOBAL de la sesión: `traslado_producto.php` y
 * `recibir_traslado.php` siguen a la sesión y su <select> de ubicación solo
 * ofrece la de esa sucursal. Por eso cada invocación abre su PROPIO `login()`
 * — enviar corre en la sesión de ORIGEN y recibir en la de DESTINO, y compartir
 * una cookie entre dos aplicaciones simultáneas haría que una escriba en la
 * sucursal de la otra.
 */
export async function sesionEn(erpSucursal: number, login: () => Promise<string>): Promise<string> {
  const cookie = await login();
  const r = await pedir(cookie, SESION, new URLSearchParams({
    process: "set_sucursal",
    id_sucursal: String(erpSucursal),
  }), { extra: { Referer: `${BASE}/dashboard.php` } });
  let ok = false;
  try {
    ok = Boolean(JSON.parse(r)?.success);
  } catch {
    ok = false;
  }
  if (!ok) throw new Error(`No se pudo abrir la sucursal ${erpSucursal}: ${r.slice(0, 120)}`);
  return cookie;
}

/** Pide una fila de `traerdatos` para un producto en una ubicación. */
export async function traerFila(
  cookie: string, erpProductId: number, ubicacionOrigen: number,
): Promise<Fila> {
  const html = await pedir(cookie, TRASLADO, new URLSearchParams({
    process: "traerdatos",
    page: "1",
    producto_buscar: String(erpProductId),
    origen: String(ubicacionOrigen),
    sortBy: "asc",
    records: "50",
  }), { extra: { Referer: TRASLADO } });
  return leerFila(html);
}

/**
 * La presentación, resuelta en dos tiempos.
 *
 * Esta pantalla rotula sus opciones solo con el TIPO —«UNIDAD», «CAJA»— y no
 * con «TIPO (FACTOR)» como las de carga y descarte, así que puede haber varias
 * «UNIDAD» y la etiqueta no las distingue. Se filtra por tipo y se le pregunta
 * al sistema el factor de cada candidata: la buena es la que trae el factor que
 * se despachó. Elegir la primera movería una cantidad distinta de la pedida sin
 * que nada proteste.
 *
 * Devuelve null si ninguna candidata trae ese factor.
 */
export async function resolverPresentacion(
  cookie: string, fila: Fila, tipoBuscado: string, factor: number,
): Promise<{ id: string; costo: string; precio: string; unidad: string } | null> {
  const candidatas = fila.presentaciones.filter((p) => p.tipo === norm(tipoBuscado));
  for (const c of candidatas) {
    const p = await pedir(cookie, TRASLADO, new URLSearchParams({
      process: "getpresentacion",
      id_presentacion: c.id,
    }), { extra: { Referer: TRASLADO } });
    try {
      const jp = JSON.parse(p);
      if (Number(jp?.unidad) === Number(factor)) {
        return { id: c.id, costo: String(jp.costo), precio: String(jp.precio), unidad: String(jp.unidad) };
      }
    } catch { /* la siguiente candidata */ }
  }
  return null;
}

/**
 * Los traslados de esta ubicación despachados y todavía sin recibir.
 *
 * ⚠️ **El listado ignora el orden que se le pide.** Se le manda
 * `order[0][dir]=desc` y contesta ascendente igual — medido el 2026-08-06. Por
 * eso esta función devuelve el CONJUNTO de ids y no «el primero»: pedirle el
 * más nuevo y quedarse con `data[0]` devuelve el más VIEJO, que en la primera
 * prueba real fue el traslado de otra persona, de otro día y a otra sucursal.
 * El sistema lo habría aceptado sin protestar.
 *
 * Y los filtros con un valor que no entiende no fallan: devuelven las 27,000
 * filas con cara de éxito. `recordsFiltered === recordsTotal` es la señal de
 * que el filtro no se aplicó.
 */
export async function pendientesDeOrigen(
  cookie: string, ubicacionOrigen: number,
): Promise<Map<string, string>> {
  try {
    const cuerpo = await pedir(cookie, LISTADO, new URLSearchParams({
      draw: "0", start: "0", length: "200",
      origen: String(ubicacionOrigen), pro: "env", estado: "pe",
    }), { extra: { Referer: `${BASE}/admin_traslados.php` } });
    const j = JSON.parse(cuerpo);
    if (!Array.isArray(j?.data) || j.recordsFiltered === j.recordsTotal) return new Map();
    // id → destino. El destino es la quinta columna y viene como la dirección
    // completa de la sucursal, que es lo que después permite desempatar.
    return new Map(
      (j.data as unknown[][])
        .map((f) => [String(f?.[0] ?? ""), String(f?.[4] ?? "")] as [string, string])
        .filter(([id]) => id),
    );
  } catch {
    return new Map();
  }
}

/**
 * La dirección de cada sucursal, según el propio sistema.
 *
 * El `<select id="id_sucursal">` de la pantalla de traslado es el único lugar
 * que liga el id de sucursal con la dirección larga que después muestra el
 * listado — y sin esa liga, dos traslados despachados a la vez desde la misma
 * sala no se pueden distinguir. Los `value` vienen con un espacio adelante
 * (`value=' 1'`), así que hay que recortarlos.
 */
export function direccionesPorSucursal(html: string): Map<string, string> {
  const sel = html.match(/<select[^>]*id="id_sucursal"[\s\S]*?<\/select>/)?.[0] ?? "";
  return new Map(
    [...sel.matchAll(/<option value=['"]\s*(\d+)\s*['"][^>]*>([^<]*)</g)]
      .map((m) => [m[1], norm(m[2])] as [string, string]),
  );
}

/**
 * El contenido de un traslado, para desempatar cuando el destino no alcanza.
 *
 * `ver_traslado.php` da descripción, presentación, unidad y cantidad por línea.
 * Es el último recurso: dos traslados de la misma sala a la misma sala, en el
 * mismo instante, se distinguen por lo que llevan adentro.
 */
export async function contenidoDeTraslado(cookie: string, id: string): Promise<string> {
  try {
    const h = await pedir(cookie, `${VER}?id_traslado=${encodeURIComponent(id)}`, undefined, {
      extra: { Referer: `${BASE}/admin_traslados.php` },
    });
    return norm(h.replace(/<[^>]+>/g, " "));
  } catch {
    return "";
  }
}

/**
 * Cuál de los traslados nuevos es el propio.
 *
 * El `insert` no devuelve el id y el listado no respeta el orden, así que el
 * propio es «el que aparece y antes no estaba». Si en el medio otra persona
 * despachó desde la misma sala aparecen dos, y ahí desempata el DESTINO; si ni
 * así queda uno solo, se mira lo que llevan adentro.
 *
 * Devuelve null cuando no se puede desempatar. El traslado ENTRÓ igual: lo
 * único que se pierde es poder recibirlo sin buscarlo a mano.
 */
export async function identificarTrasladoNuevo(
  cookie: string,
  antes: Map<string, string>,
  despues: Map<string, string>,
  htmlPagina: string,
  erpDestino: number,
  descripciones: string[],
): Promise<{ id: string | null; candidatos: string[] }> {
  let nuevos = [...despues.keys()].filter((id) => !antes.has(id));

  if (nuevos.length > 1) {
    const dirDestino = direccionesPorSucursal(htmlPagina).get(String(erpDestino));
    if (dirDestino) {
      const mismos = nuevos.filter((id) => {
        const d = norm(despues.get(id) ?? "");
        return d && (d === dirDestino || d.includes(dirDestino) || dirDestino.includes(d));
      });
      if (mismos.length > 0) nuevos = mismos;
    }
  }

  if (nuevos.length > 1) {
    const buscado = descripciones.map((d) => norm(d)).filter(Boolean);
    if (buscado.length > 0) {
      const coinciden: string[] = [];
      for (const id of nuevos) {
        const c = await contenidoDeTraslado(cookie, id);
        if (c && buscado.every((d) => c.includes(d))) coinciden.push(id);
      }
      if (coinciden.length > 0) nuevos = coinciden;
    }
  }

  return { id: nuevos.length === 1 ? nuevos[0] : null, candidatos: nuevos };
}
