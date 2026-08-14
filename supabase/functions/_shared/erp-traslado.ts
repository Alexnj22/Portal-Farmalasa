// Las pantallas de traslado del sistema de origen, leídas en un solo lugar.
//
// Nacieron dentro de `aplicar-traslado-inventario` y se copiaron acá el
// 2026-08-11, cuando `trasladar-pedido-erp` necesitó exactamente las mismas.
// Son parsers de HTML: el día que el sistema cambie un `<select>`, dos copias
// que se toquen por separado leen la misma pantalla distinto.
//
// **Una sola copia, desde el 2026-08-11.** Nacieron dentro de
// `aplicar-traslado-inventario`; al estrenar `trasladar-pedido-erp` se copiaron
// acá y quedaron duplicadas un rato a propósito —no se refactoriza una función
// que mueve inventario real en el mismo cambio que estrena otra—. Ya se
// consolidó: `aplicar-traslado-inventario` importa de acá y borró las suyas.
//
// Si se toca un parser, se toca para las dos funciones. Es el punto: el día que
// el sistema cambie un `<select>`, no hay una versión que se arregle y otra que
// no.
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

/**
 * El concepto dice SOLO lo que el sistema no sabe.
 *
 * Medido el 2026-08-12 sobre el sistema real:
 *
 * - El detalle del traslado (`ver_traslado.php`) muestra producto,
 *   presentación, unidad, cantidad y destino. **No muestra el concepto.**
 * - El reporte imprimible (`reporte_traslado.php`) contesta **500 en todos** los
 *   traslados, también en los de 2025. Roto de antes.
 * - El listado trae fecha, hora, origen, destino, usuario y estado.
 * - La columna «usuario» es **siempre la misma cuenta** —la del portal—, así que
 *   el concepto es el ÚNICO lugar donde aparece la persona de verdad.
 *
 * De ahí la regla: repetir el destino, la fecha o el producto es gastar el campo
 * en algo que ya está en la pantalla de al lado. Queda:
 *
 *     <clave> <qué pasó> <quién>
 *
 * La clave va primero porque es lo que se busca.
 *
 *   P102-S5-H1-I71445 ENV DOLORES TEJADA          (el pedido sale de bodega)
 *   P102-S5-H1-I71445 REC ADRIANA RAMIREZ         (el pedido entra a la sala)
 *   DEV-P102-S5-H1-I71445 NO LLEGO PIDE ADRIANA RAMIREZ OK DOLORES TEJADA
 *   DEV-P102-S5-H1-I71445 REC DOLORES TEJADA      (la devolución entra a bodega)
 *   PIDE ADRIANA RAMIREZ (S1) ENV DOLORES TEJADA (BO)   (traslado entre salas)
 *
 * El segmento del medio dice POR DÓNDE viaja el renglón: `H<n>` una hoja
 * numerada del despacho, `CE` una caja especial —Electrolit, andaderas, sillas—,
 * que no lleva hoja. La caja especial MANDA sobre la hoja: la clave la arma
 * `planificar_traslado_pedido` mirando la regla del producto, no la foto de las
 * hojas impresas, que se congela al imprimir y puede haber quedado vieja.
 *
 * **La sala del renglón va DENTRO de la clave, no pegada al nombre.** Por eso el
 * pedido y la devolución no repiten `(S5)`: ya está en `P102-S5-…`. El traslado
 * entre salas no tiene clave —no nace de un pedido—, así que ahí la sala sí se
 * escribe, y va junto a cada persona porque son de salas distintas: una pide y
 * la otra suelta.
 *
 * **La devolución lleva la MISMA clave del despacho con `DEV-` adelante**,
 * carácter por carácter, hoja incluida. Buscar `P102-S5-H1-I71445` en el kardex
 * encuentra las dos puntas del mismo renglón: la salida y el retorno. Y la hoja
 * es justo lo que hay que ir a revisar cuando algo no cuadra.
 *
 * Todo en MAYÚSCULAS y en ASCII. ASCII porque el sistema relee los bytes como
 * Latin-1 y un acento sale partido en dos. Mayúsculas porque los nombres salen
 * de `employees` con capitalización dispar —«DOLORES TEJADA» al lado de
 * «Adriana Ramirez»— y dos formatos en la misma columna del kardex se leen como
 * dos sistemas distintos escribiendo ahí.
 */

/**
 * El nombre corto, con la MISMA regla que el portal (`shortEmployeeName`):
 * primer nombre + primer apellido. Se le pasan las columnas estructuradas
 * porque el nombre concatenado no distingue el segundo nombre del apellido —
 * «MARIA JOSE HERNANDEZ» partido a ciegas da «MARIA JOSE», que no identifica a
 * nadie.
 */
export function nombreCorto(
  emp: { first_names?: string | null; last_names?: string | null; name?: string | null } | null,
): string {
  const primero = (s?: string | null) => String(s ?? "").trim().split(/\s+/)[0] ?? "";
  const nom = primero(emp?.first_names);
  const ape = primero(emp?.last_names);
  if (nom || ape) return soloAscii(`${nom} ${ape}`.trim());
  // Sin las columnas estructuradas: el mismo respaldo que el portal.
  const partes = String(emp?.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "-";
  if (partes.length <= 2) return soloAscii(partes.join(" "));
  return soloAscii(`${partes[0]} ${partes[2]}`);
}

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

/**
 * El concepto tal como entra al sistema: ASCII, MAYÚSCULAS y con el tope puesto.
 *
 * Una sola puerta para las cinco escrituras. Antes cada una hacía su
 * `soloAscii(...).slice(0, CONCEPTO_MAX)` y **sólo una avisaba del recorte**,
 * justo lo que el comentario de `CONCEPTO_MAX` promete que no pase: un tope
 * callado se lee como que entró completo. Ahora el aviso viene con el valor y
 * quien lo ignore lo está ignorando a la vista.
 */
export function armarConcepto(
  texto: string,
): { concepto: string; recortado: boolean; completo: string } {
  const completo = soloAscii(texto).toUpperCase();
  return {
    concepto: completo.slice(0, CONCEPTO_MAX),
    recortado: completo.length > CONCEPTO_MAX,
    completo,
  };
}

/**
 * El nombre corto con su sala: «ADRIANA RAMIREZ (S1)».
 *
 * El código sale del registro (`erp_sucursal_map.codigo`) y NUNCA del
 * `erp_sucursal_id`: la numeración del sistema de origen no coincide con el
 * nombre de la sala en las tres últimas —5 es La Popular, 6 Bodega, 7 Salud 5—,
 * así que construirlo con el id da «S7» para Salud 5 y, peor, «S5» para La
 * Popular, que se lee como otra sala que sí existe.
 *
 * Sin código no se inventa uno: se escribe el nombre solo. Un paréntesis
 * equivocado es peor que ninguno.
 */
export function conSala(
  emp: { first_names?: string | null; last_names?: string | null; name?: string | null } | null,
  codigo?: string | null,
): string {
  const quien = nombreCorto(emp);
  return codigo ? `${quien} (${codigo})` : quien;
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
 * Cuánto puede cubrir bodega HOY para ese producto, en paquetes de `unidad`.
 *
 * **`existencia` NO es la existencia del producto: es la del PRIMER lote de la
 * lista.** Medido contra el sistema el 2026-08-14, leyendo `traerdatos` de
 * bodega:
 *
 *   BETALOC ZOK 100MG → casilla: 2   ·   lotes: 80931 (2), 81411 (3)   → hay 5
 *   GAMMACORT JARABE  → casilla: 42  ·   lotes: F26031 (42), F26030 (4) → hay 46
 *   NERVIFLORA (sin control de lote) → casilla: 150 = todo. Ahí sí es el total.
 *
 * Y no es sólo parcial: es INESTABLE. Los dos lotes del GAMMACORT vencen el
 * mismo día, así que el orden de la lista no está determinado — la misma
 * pantalla contestó 5 a las 18:24 y 42 a las 19:10 del mismo día, según cuál
 * lote saliera primero. Un tope que cambia solo no es un tope.
 *
 * El costo real de leerlo mal: el 2026-08-14 el pedido #114 marcó «no hay
 * existencia» para 3 BETALOC que sí estaban —2 de un lote y 1 del otro— y
 * Bodega los puso en cero. La mercadería viajó en la caja igual.
 *
 * Se cuenta por lote y NO sobre la suma cruda: con presentación ×30 y dos lotes
 * de 20, la suma diría «alcanza para 1» y ningún lote completa una caja. Es
 * exactamente lo que puede entregar el reparto, que toma `floor(stock/unidad)`
 * de cada lote — el tope y el reparto tienen que decir lo mismo o el tope frena
 * mercadería que el reparto sí sabía armar.
 */
export function disponibleEnBodega(
  f: Fila, unidad: number,
): { paquetes: number; unidades: number; lotes: number } {
  const u = Number(unidad) || 1;
  if (f.regulado && f.lotes.length) {
    return {
      paquetes: f.lotes.reduce((n, l) => n + Math.floor(l.stock / u), 0),
      unidades: f.lotes.reduce((n, l) => n + l.stock, 0),
      lotes: f.lotes.length,
    };
  }
  return { paquetes: Math.floor(f.existencia / u), unidades: f.existencia, lotes: 0 };
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
