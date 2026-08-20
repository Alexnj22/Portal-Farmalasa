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
// El mismo reporte del que el portal arma su inventario. Ver `existenciasDeUbicacion`.
export const INVENTARIO = `${BASE}/reporte_inventario_json.php`;

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

// El cuerpo ya contempla el nulo (`s ?? ""`); la firma decía otra cosa.
export const norm = (s: string | null | undefined) =>
  String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

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
  f: Fila, unidad: number, enLaUbicacion?: number | null,
): { paquetes: number; unidades: number; lotes: number } {
  const u = Number(unidad) || 1;
  if (f.regulado && f.lotes.length) {
    return {
      paquetes: f.lotes.reduce((n, l) => n + Math.floor(l.stock / u), 0),
      unidades: f.lotes.reduce((n, l) => n + l.stock, 0),
      lotes: f.lotes.length,
    };
  }
  // Sin control de lote NO se puede usar la casilla: el sistema la rotula
  // «TOTAL STOCK» y es el total de la SUCURSAL —las dos ubicaciones sumadas—,
  // ignorando por completo la que se le pide. Medido el 2026-08-19 pidiendo la
  // misma fila para el área de trabajo y para la de vencidos: contesta idéntico.
  //
  //   BRONCOLEXIL JBE   3 en trabajo + 6 en vencidos → la casilla dice 9
  //   ALCOHOL 90        25          + 5             → dice 30
  //   TERMOMETRO        26          + 1             → dice 27
  //
  // O sea que el freno aprobaba despachar mercadería que está en el área de
  // vencidos y NO se puede descargar de la de trabajo. El sistema lo rechaza
  // después con «No hay suficiente stock en las ubicaciones», el renglón queda
  // en error y alguien lo tiene que resolver a mano.
  //
  // `enLaUbicacion` es ese número bien leído (`existenciasDeUbicacion`). Cuando
  // no se pudo leer llega `null` y se cae a la casilla: peor freno, pero el
  // sistema sigue siendo la puerta de verdad y un freno que se cierra por una
  // consulta secundaria dejaría de despachar por algo que no es del pedido.
  const existencia = enLaUbicacion == null ? f.existencia : enLaUbicacion;
  return { paquetes: Math.floor(existencia / u), unidades: existencia, lotes: 0 };
}

/**
 * Cuánto hay de cada producto EN ESA UBICACIÓN, en unidades base.
 *
 * Sale del MISMO reporte del que el portal arma su inventario
 * (`reporte_inventario_json.php`), así que no hay una segunda verdad: si la
 * pantalla de existencias dice una cosa, el freno del despacho dice la misma.
 *
 * ── Las dos escalas, que es donde está la trampa ────────────────────────────
 * El reporte da una fila **por lote y por presentación**, y su `cantidad` va en
 * PAQUETES de esa presentación, no en unidades base. El factor lo trae la
 * columna `detalle` con la forma «1x5». Sumar las cantidades a secas mezcla
 * escalas y da un número que no es nada — me pasó al medirlo.
 *
 *   TRAMAL 100MG (1275) en el área de trabajo:
 *     CAJA 1x5 lote 00341X  = 5   → 25 unidades
 *     CAJA 1x5 lote L00246X = 2   → 10
 *     CAJA 1x5 lote 00246X  = 11  → 55
 *     UNIDAD 1x1 (los tres) = 0   →  0
 *                                   ── 90, que es exactamente lo que suman sus
 *                                      lotes en la pantalla de traslado.
 *
 * Comprobado así contra los lotes de 5 productos regulados —los únicos donde
 * hay con qué contrastar—: 5 de 5 iguales, incluido el ORTODEL con 340.
 *
 * `detalle` es «1xN» en 4,838 de 4,848 filas; las 10 restantes («1», «BOTE»,
 * «2X1») se leen como factor 1, que es quedarse corto y no de más.
 *
 * Devuelve `null` cuando no se pudo leer. Es a propósito: quien llama tiene que
 * poder distinguir «no hay» de «no pregunté», y un producto que NO aparece en
 * el reporte sí tiene 0 en esa ubicación.
 */
export async function existenciasDeUbicacion(
  cookie: string, erpSucursal: number, ubicacion: number,
): Promise<Map<number, number> | null> {
  try {
    const cuerpo = await pedir(
      cookie,
      `${INVENTARIO}?id_ubicacion=${encodeURIComponent(String(ubicacion))}`
        + `&id_sucursal=${encodeURIComponent(String(erpSucursal))}`,
      undefined,
      { extra: { Referer: `${BASE}/dashboard.php` }, timeoutMs: 60_000 },
    );
    return existenciasDelReporte(JSON.parse(cuerpo));
  } catch {
    return null;
  }
}

/**
 * La cuenta sola, separada del viaje a la red para poder anclarla en las
 * pruebas contra un payload REAL del sistema. Ver `existenciasDeUbicacion`.
 */
export function existenciasDelReporte(payload: unknown): Map<number, number> | null {
  const factorDe = (detalle: unknown): number => {
    const n = Number(String(detalle ?? "").match(/^\s*1\s*[xX]\s*(\d+)\s*$/)?.[1] ?? 1);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };
  const filas = (payload as { inventario?: unknown })?.inventario;
  // Una lista vacía se trata como «no se pudo leer»: una ubicación de verdad
  // vacía no existe en la práctica, y dar 0 a todo frenaría el pedido entero.
  if (!Array.isArray(filas) || filas.length === 0) return null;
  const mapa = new Map<number, number>();
  for (const p of filas as Record<string, unknown>[]) {
    const id = Number(p?.id_producto);
    if (!Number.isFinite(id) || id <= 0) continue;
    const det = Array.isArray(p?.detalles) ? p.detalles as Record<string, unknown>[] : [];
    const base = det.reduce((n, d) => n + Number(d?.cantidad ?? 0) * factorDe(d?.detalle), 0);
    mapa.set(id, (mapa.get(id) ?? 0) + base);
  }
  return mapa;
}

/**
 * «en bodega hay 5 unidades en 2 lotes» — la mitad de la frase que es igual en
 * todos lados. La otra mitad (qué se pedía) la pone quien avisa, porque no es lo
 * mismo un pedido que una devolución.
 *
 * Existe para no repetir el singular en tres archivos: la primera versión decía
 * «1 unidades» y eso lo lee Bodega.
 */
export function hayEnTexto(
  hay: { unidades: number; lotes: number }, lugar = "bodega",
): string {
  return `en ${lugar} hay ${hay.unidades} ${hay.unidades === 1 ? "unidad" : "unidades"}`
    + (hay.lotes > 1 ? ` repartidas en ${hay.lotes} lotes` : "");
}

/** Un lote tal como lo ofrece el <select> del sistema. */
export type LoteErp = { id: string; numero: string; vence: string; stock: number };

/**
 * De qué lotes sale lo que se despacha, y en qué cantidad cada uno.
 *
 * **La otra mitad de `disponibleEnBodega`.** Ese cuenta lote por lote —suma
 * `floor(stock/unidad)` de cada uno— y por eso dice que alcanza cuando la
 * cantidad está repartida. Si el reparto después exige que UN lote cubra todo,
 * el tope promete lo que el reparto no entrega, y la mercadería se queda en el
 * estante con el portal diciendo que no hay.
 *
 * Costó un traslado real: el 2026-08-18 Bodega no pudo mandar 6 cajas de
 * ALOPURINOL 300 que tenía en dos lotes —6A096 con 1 caja y 6F125 con 5—, y la
 * pantalla contestó «ningún lote tiene las 60 unidades juntas» sobre existencia
 * suficiente. Quien despachaba terminó rechazando la solicitud a mano.
 *
 * El sistema acepta varios renglones del mismo producto: `datos` es una lista y
 * nada obliga a que el producto no se repita. Es lo que `trasladar-pedido-erp`
 * manda para los pedidos desde el 2026-08-11 — esa función conserva su propia
 * copia de esta regla porque además arrastra la reserva del pedido y su tabla
 * de estados; si se toca el criterio, se tocan las dos.
 *
 * ── Las dos escalas ────────────────────────────────────────────────────────
 * `pedido` y lo que se devuelve van en PAQUETES de la presentación; `stock` y
 * `reservados[].unidades` en unidades BASE. `unidad` es el factor que las une, y
 * confundirlas mueve `factor` veces lo que se pedía.
 *
 * ── El orden ───────────────────────────────────────────────────────────────
 * 1. Lo que la solicitud RESERVÓ, si reservó. La pantalla que pide reparte por
 *    lote y quien despacha ve ese reparto: «los lotes MANDAN» (decisión del
 *    usuario, 2026-08-07).
 * 2. Lo que quede, del que VENCE PRIMERO. Es lo que corresponde despachar, y es
 *    el único criterio cuando no hubo reserva —el caso normal, porque la
 *    pantalla manda `lotes: null` cuando no conoce los lotes de esa sala—.
 *
 * Un lote reservado que ya no está NO corta el reparto: se anota en `avisos` y
 * lo cubre el paso 2. Frenar ahí sería frenar mercadería que sigue en el
 * estante (mismo criterio que el pedido, decisión del usuario 2026-08-11).
 *
 * ── La reserva ORDENA, no LIMITA ───────────────────────────────────────────
 * El paso 2 vuelve sobre TODOS los lotes, incluidos los que el paso 1 ya tocó.
 * Un lote del que salió menos de lo que tiene sigue teniendo lo que le sobra, y
 * cerrarlo por haberlo usado deja mercadería inalcanzable con el tope diciendo
 * que alcanza.
 *
 * No es un caso raro: el redondeo lo fabrica. La reserva llega en unidades y se
 * convierte a paquetes lote por lote —39 unidades en presentación de 10 son 3
 * blísteres y sobran 9—, mientras que `disponibleEnBodega` cuenta sobre el stock
 * del sistema, que decía 40, o sea 4. Uno prometía 4 y el otro entregaba 3.
 *
 * Es el mismo desacuerdo que motivó esta función, entrando por la otra puerta, y
 * volvió a costar dos traslados reales el 2026-08-18 —los dos de DOLO APRANAX en
 * BLÍSTER X 10, los dos con «faltan 1» sobre existencia suficiente—. Por eso el
 * invariante se prueba contra `disponibleEnBodega` y no contra un número
 * escrito a mano: **lo que el tope promete, el reparto lo entrega.**
 *
 * `sujeto` es sólo cómo se nombra a quien reservó dentro de los avisos («la
 * solicitud», «el pedido»): esos textos los lee quien despacha.
 *
 * `faltan > 0` es lo único que sí corta, y lo decide quien llama.
 */
export function repartirEnLotes(
  lotes: LoteErp[],
  pedido: number,
  unidad: number,
  reservados: { numero: string; vence?: string; paquetes: number }[] = [],
  sujeto = "la solicitud",
): {
  renglones: { cantidad: number; idLote: string; lote: string }[];
  faltan: number;
  avisos: string[];
} {
  const u = Number(unidad) || 1;
  const avisos: string[] = [];
  let resto = Math.max(0, Number(pedido) || 0);

  // ── Dos registros distintos, y confundirlos fue el bug ──────────────────
  // `asignados` es «este lote ya lo reclamó una reserva» y evita que dos
  // renglones de la reserva caigan sobre el mismo lote. `tomado` es «cuántos
  // paquetes le saqué», que es lo único que dice si al lote todavía le queda
  // algo. Hasta el 2026-08-18 había un solo Set haciendo las dos cosas: un lote
  // tocado quedaba CERRADO aunque le sobrara mercadería.
  const asignados = new Set<string>();
  const tomado = new Map<string, number>();
  /** Lo que le queda al lote, en paquetes, descontando lo ya tomado. */
  const cabeEn = (l: LoteErp) => Math.floor(l.stock / u) - (tomado.get(l.id) ?? 0);

  // Un lote = UN renglón. Si se vuelve al mismo lote a completar, se le suma:
  // dos renglones del mismo lote son la misma existencia contada dos veces.
  const renglones: { cantidad: number; idLote: string; lote: string }[] = [];
  const anotar = (l: LoteErp, n: number) => {
    const ya = renglones.find((r) => r.idLote === l.id);
    if (ya) ya.cantidad += n;
    else renglones.push({ cantidad: n, idLote: l.id, lote: l.numero });
    tomado.set(l.id, (tomado.get(l.id) ?? 0) + n);
    resto -= n;
  };

  const pedidos = reservados.filter((r) => norm(r.numero) && Number(r.paquetes) > 0);

  for (const r of pedidos) {
    if (resto <= 0) break;
    // ── El NÚMERO identifica el lote; la fecha sólo DESEMPATA ──────────────
    // Las dos puntas no leen la misma pantalla: quien pide ve la fecha que
    // guardó el inventario del portal y quien despacha la que trae el <select>
    // de traslados. Exigir que las dos coincidan hace que un formato distinto
    // —o un día 31 contra un día 1— tire abajo una reserva que estaba bien, y
    // el lote elegido se pierde sin que nadie lo note.
    //
    // Sólo hay que desempatar cuando el mismo número aparece dos veces, que es
    // el caso real que documenta `lotesEnUnidades`: dos lotes de igual número y
    // vencimientos distintos son existencias separadas.
    const buscadoVen = String(r.vence ?? "").slice(0, 10);
    const mismos = lotes.filter((x) => !asignados.has(x.id) && norm(x.numero) === norm(r.numero));
    const lote = mismos.length <= 1
      ? mismos[0]
      : (mismos.find((x) => buscadoVen && x.vence.slice(0, 10) === buscadoVen)
        // Mismo número dos veces y ninguna fecha que coincida: se toma el que
        // vence primero, que es el que corresponde sacar, y se avisa.
        ?? [...mismos].sort((a, b) =>
             (a.vence || "9999-99-99").localeCompare(b.vence || "9999-99-99"))[0]);
    if (lote && mismos.length > 1 && buscadoVen && lote.vence.slice(0, 10) !== buscadoVen)
      avisos.push(
        `hay dos lotes ${lote.numero} y ninguno vence el ${buscadoVen}: `
        + `salió el que vence ${lote.vence || "sin fecha"}`,
      );
    if (!lote) {
      avisos.push(`el lote ${r.numero} que reservó ${sujeto} ya no está`);
      continue;
    }
    const quiere = Math.min(Number(r.paquetes), resto);
    const toma = Math.min(quiere, cabeEn(lote));
    if (toma <= 0) {
      avisos.push(`el lote ${lote.numero} quedó sin existencia suficiente`);
      continue;
    }
    if (toma < quiere) avisos.push(`del lote ${lote.numero} solo alcanzaban ${toma}`);
    anotar(lote, toma);
    asignados.add(lote.id);
  }

  if (resto > 0) {
    // ── Se vuelve a TODOS los lotes, incluidos los que ya dieron algo ──────
    // La reserva es un ORDEN de preferencia, no un tope. Filtrar acá los lotes
    // ya tocados dejaba mercadería inalcanzable, y el redondeo garantiza que
    // pase: la reserva se convierte a paquetes lote por lote —39 unidades de
    // una presentación de 10 son 3 blísteres y sobran 9— mientras que el tope
    // (`disponibleEnBodega`) mira el stock del sistema, que ese día decía 40, o
    // sea 4. El tope prometía 4 y el reparto entregaba 3.
    //
    // Costó dos traslados reales el 2026-08-18, los dos de DOLO APRANAX en
    // BLÍSTER X 10 y los dos con el mismo «faltan 1» sobre existencia
    // suficiente: Salud 5 → Salud 2 (reserva 5+20+15, sistema 5+20+20) y
    // Salud 2 → Salud 3 (reserva 1+39, sistema 1+40).
    const disponibles = [...lotes]
      // Sin fecha va al final y no al principio: un lote sin vencimiento no es
      // el más urgente, es el que no se sabe.
      .sort((a, b) => (a.vence || "9999-99-99").localeCompare(b.vence || "9999-99-99"));
    for (const lote of disponibles) {
      if (resto <= 0) break;
      const cabe = cabeEn(lote);
      if (cabe <= 0) continue;
      const toma = Math.min(cabe, resto);
      if (pedidos.length > 0)
        avisos.push(
          asignados.has(lote.id)
            // Del lote que sí se había reservado, pero por menos de lo que hacía
            // falta. Decirlo «no es el que reservó» sería mentira.
            ? `del lote ${lote.numero} salieron ${toma} más de lo que ${sujeto} había reservado`
            : `se despacharon ${toma} del lote ${lote.numero} (vence ${lote.vence || "sin fecha"}), `
              + `que no es el que ${sujeto} había reservado`,
        );
      anotar(lote, toma);
    }
  }

  return { renglones, faltan: resto, avisos };
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
 *
 * ⚠️ **Una lista recortada es peor que ninguna.** Quien llama compara esta foto
 * contra la de después para saber cuál traslado es el suyo; si faltan filas, el
 * suyo puede no aparecer —o puede aparecer uno viejo que entró al recorte
 * porque otro salió—. Medido el 2026-08-19: había **448 pendientes** desde
 * Bodega y el listado devolvió las 448 con `length` en 200 y en 500, o sea que
 * hoy **ignora `length`**. Que hoy lo ignore no es una garantía: se pide un
 * techo alto y se comprueba que vinieron todas. Si no vinieron, se devuelve
 * vacío —que deja el traslado sin número— en vez de una foto incompleta, que
 * deja el número de otro.
 */
export async function pendientesDeOrigen(
  cookie: string, ubicacionOrigen: number,
): Promise<Map<string, string>> {
  try {
    const cuerpo = await pedir(cookie, LISTADO, new URLSearchParams({
      draw: "0", start: "0", length: "5000",
      origen: String(ubicacionOrigen), pro: "env", estado: "pe",
    }), { extra: { Referer: `${BASE}/admin_traslados.php` } });
    const j = JSON.parse(cuerpo);
    if (!Array.isArray(j?.data) || j.recordsFiltered === j.recordsTotal) return new Map();
    if (j.data.length < Number(j.recordsFiltered ?? 0)) return new Map();
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
 * Si un traslado sigue esperando entrar a la sala en la que está la sesión.
 *
 * ── Por qué hace falta preguntarlo, y por qué no se puede leer de la pantalla ─
 * `recibir_traslado.php` **sigue pintando las líneas de un traslado que YA se
 * recibió**, con las mismas cantidades y el mismo botón. Medido el 2026-08-17
 * sobre el 29445 (recibido a la 1:50 PM) y el 29444 (recibido más tarde): los
 * dos devuelven una fila con `class="id_p"` igual que uno en tránsito. O sea
 * que la pantalla NO distingue, y apretar «ya llegó» dos veces cargaría el
 * producto dos veces. El código de `aplicar-traslado-inventario` daba por hecho
 * lo contrario —«un traslado recibido deja de mostrar líneas»— y esa frase era
 * falsa desde el día uno.
 *
 * Quien sí lo sabe es el listado: con la sesión puesta en la sala que recibe,
 * `pro=rec` + `estado=pe` devuelve exactamente lo que le falta entrar. Medido:
 * 142 filas para La Popular, 5 para Salud 2, 3 para Salud 3, y entre 90 y 200
 * ms. `origen=gen` porque la ubicación ya la fija la sesión — pasarle una que
 * la sesión no tiene devuelve cero y parecería que ya entró.
 *
 * Devuelve `"desconocido"` cuando no se pudo preguntar. Es a propósito: quien
 * llama tiene que seguir haciendo lo de siempre, no dar por buena una respuesta
 * que no tuvo. Es la misma falla segura que `pendientesDeOrigen`.
 */
export type EstadoDeRecepcion = "pendiente" | "recibido" | "anulado" | "desconocido";

/**
 * Los traslados que le faltan ENTRAR a la sala de la sesión.
 *
 * Un filtro con un valor que el listado no entiende NO falla: contesta las
 * 28,000 filas con cara de éxito. `recordsFiltered === recordsTotal` es la
 * señal de que no se aplicó, y entonces la respuesta no dice nada — igual que
 * una lista recortada. En los dos casos devuelve `null`, que quien llama lee
 * como «no se pudo preguntar», nunca como «no hay».
 */
async function idsDeRecepcion(cookie: string, estado: string): Promise<Set<string> | null> {
  try {
    const cuerpo = await pedir(cookie, LISTADO, new URLSearchParams({
      draw: "0", start: "0", length: "5000",
      origen: "gen", pro: "rec", estado,
    }), { extra: { Referer: `${BASE}/admin_traslados.php` } });
    const j = JSON.parse(cuerpo);
    if (!Array.isArray(j?.data) || j.recordsFiltered === j.recordsTotal) return null;
    if (j.data.length < Number(j.recordsFiltered ?? 0)) return null;
    return new Set((j.data as unknown[][]).map((f) => String(f?.[0] ?? "")).filter(Boolean));
  } catch {
    return null;
  }
}

export const pendientesDeRecepcion = (cookie: string) => idsDeRecepcion(cookie, "pe");

export async function estadoDeRecepcion(
  cookie: string, idTraslado: string,
): Promise<EstadoDeRecepcion> {
  const idsCon = (estado: string) => idsDeRecepcion(cookie, estado);

  const pendientes = await idsCon("pe");
  if (!pendientes) return "desconocido";
  if (pendientes.has(String(idTraslado))) return "pendiente";
  // Ya no está en la cola de entrada. Falta separar las dos formas de salir de
  // ella: entró, o lo anularon. Se pregunta recién acá —y no siempre— porque en
  // el camino normal el traslado SÍ está pendiente y esta segunda vuelta no se
  // gasta nunca.
  const anulados = await idsCon("an");
  if (!anulados) return "desconocido";
  return anulados.has(String(idTraslado)) ? "anulado" : "recibido";
}

/**
 * El mismo estado, pero para un LOTE de renglones, sin pagar la consulta en
 * cada uno.
 *
 * Preguntar por renglón cuesta **250 a 880 ms** (medido el 2026-08-19: 253 ms
 * en Salud 3, con pocos pendientes; 878 ms en Salud 2, con más de cien). Una
 * hoja son ~35 renglones y se recibe en 18-45 s, así que preguntar de a uno la
 * duplicaría — y una guarda que hace lenta la operación termina siendo una
 * guarda que alguien quita.
 *
 * Así que la cola se lee UNA vez y se reusa mientras esté fresca. Lo que se
 * pierde es acotado y explícito: si alguien recibe por el sistema el MISMO
 * traslado que el portal está por recibir, la respuesta cachada puede tener
 * hasta `ttlMs` de atraso. Antes de esto la ventana no era de 20 segundos: era
 * infinita, porque no se preguntaba nunca.
 *
 * Y el caso que decide —«no está en la cola»— NO se contesta con la caché: se
 * vuelve a preguntar fresco. Es el único en que la respuesta cambia lo que se
 * hace (no cargar), y es raro, así que pagarlo no cuesta nada.
 */
export function lectorDeRecepcion(
  cookie: string,
  ttlMs = 20_000,
  leerPendientes: (c: string) => Promise<Set<string> | null> = pendientesDeRecepcion,
  leerEstado: (c: string, id: string) => Promise<EstadoDeRecepcion> = estadoDeRecepcion,
): (idTraslado: string) => Promise<EstadoDeRecepcion> {
  let cola: Set<string> | null = null;
  let leidaEn = 0;
  return async (idTraslado: string) => {
    const id = String(idTraslado);
    // `>=` y no `>`: así un `ttlMs` de 0 significa «no cachear», que es lo que
    // cualquiera espera al pasar 0. Con `>` dos llamadas en el mismo
    // milisegundo reusaban la cola aunque el plazo fuera cero.
    if (!cola || Date.now() - leidaEn >= ttlMs) {
      cola = await leerPendientes(cookie);
      leidaEn = Date.now();
    }
    if (!cola) return "desconocido";
    if (cola.has(id)) return "pendiente";
    return await leerEstado(cookie, id);
  };
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
    return textoDeTraslado(h);
  } catch {
    return "";
  }
}

/**
 * El texto de esa pantalla, sin etiquetas y normalizado.
 *
 * Separado del viaje a la red para poder anclarlo contra páginas REALES en las
 * pruebas — que es donde se ve que el nombre del producto sobrevive al
 * recorte de etiquetas. Devuelve `""` para un HTML vacío, que es lo que
 * `identificarTrasladoNuevo` lee como «no se pudo leer».
 */
export function textoDeTraslado(html: string): string {
  return norm(String(html ?? "").replace(/<[^>]+>/g, " "));
}

/**
 * ¿Ese traslado lleva DE VERDAD el producto de la solicitud?
 *
 * Es la guarda del barrido que apaga las tarjetas «Ya llegó, recibir». Saber
 * que el traslado N ya no está pendiente NO alcanza para cerrar una tarjeta:
 * hay que saber que el traslado N es el de ESA tarjeta. Si el número guardado
 * fuera el de otro —el defecto que dejó nueve renglones sin número en los
 * pedidos 119, 120 y 121, cerrado en v2.666.1— se estaría dando por llegado un
 * producto que nunca salió.
 *
 * `contenido` es lo que devuelve `contenidoDeTraslado`, ya normalizado; el
 * producto se normaliza acá para que los dos lados se comparen igual. Sin
 * contenido devuelve `false` a propósito: no se pudo leer, así que no se sabe,
 * y no saber nunca alcanza para cerrar.
 */
export function trasladoLlevaProducto(
  contenido: string, producto: string | null | undefined,
): boolean {
  const buscado = norm(producto ?? "");
  if (!contenido || !buscado) return false;
  return contenido.includes(buscado);
}

/**
 * Cuál de los traslados nuevos es el propio.
 *
 * El `insert` no devuelve el id y el listado no respeta el orden, así que el
 * propio es «el que aparece y antes no estaba». Si en el medio otra persona
 * despachó desde la misma ubicación aparecen dos, y ahí desempata el DESTINO;
 * si ni así queda uno solo, se mira lo que llevan adentro.
 *
 * Devuelve null cuando no se puede desempatar. El traslado ENTRÓ igual: lo
 * único que se pierde es poder recibirlo sin buscarlo a mano.
 *
 * ── Por qué las dos vueltas hacen falta, medido ───────────────────────────
 * El 2026-08-18 nueve renglones de los pedidos 119, 120 y 121 quedaron sin
 * número. Los nueve por lo mismo: Bodega despachó una solicitud a mano —63 ese
 * día, desde la MISMA ubicación— dentro de la ventana de 0,7 a 4,8 segundos
 * que separa las dos fotos. Reconstruidos contra el sistema real:
 *
 * - Con el destino alcanza en 5 de 9 (la solicitud a mano iba a otra sala).
 * - Los otros 4 iban a la misma sala y sólo los separa el contenido: el
 *   BEBELAC 3 X 900 (30350) del PEDIASURE FRESA (30349) que salió 2,9 s antes.
 *
 * Con las dos vueltas, 9 de 9 quedan identificados sin ambigüedad. La prueba
 * corre sobre esas mismas páginas: `tests/unit/identificarTraslado.test.js`.
 *
 * `leerContenido` se inyecta SÓLO para eso — para poder anclar el desempate
 * contra páginas reales sin salir a la red. En producción nadie lo pasa.
 */
export async function identificarTrasladoNuevo(
  cookie: string,
  antes: Map<string, string>,
  despues: Map<string, string>,
  htmlPagina: string,
  erpDestino: number,
  descripciones: string[],
  leerContenido: (cookie: string, id: string) => Promise<string> = contenidoDeTraslado,
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
      const contenidos = new Map<string, string>();
      for (const id of nuevos) contenidos.set(id, await leerContenido(cookie, id));
      // Una página que no se pudo leer NO descarta a su traslado. Darla por
      // «no coincide» dejaría ganar al único que sí se leyó — y ése bien puede
      // ser el de otra persona. Sin todas las páginas no se elimina a nadie:
      // quedarse sin número obliga a buscarlo a mano, recibir el de otro mueve
      // inventario ajeno y no se deshace solo.
      if ([...contenidos.values()].every((c) => c)) {
        const coinciden = nuevos.filter((id) =>
          buscado.every((d) => (contenidos.get(id) ?? "").includes(d))
        );
        if (coinciden.length > 0) nuevos = coinciden;
      }
    }
  }

  return { id: nuevos.length === 1 ? nuevos[0] : null, candidatos: nuevos };
}
