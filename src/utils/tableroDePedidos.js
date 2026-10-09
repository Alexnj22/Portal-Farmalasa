// Extracted from TabPedidos.jsx (Bloque 6.C) — shared by the main tab and
// its extracted sub-components, kept here so neither side duplicates it.
import { hora12 } from './hora';
import { diaDe, diaSV } from './fecha';

export function fmtMin(min) {
    if (min == null || isNaN(min) || min < 0) return null;
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60), m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function elapsed(isoFrom, isoTo = null) {
    if (!isoFrom) return null;
    const from = new Date(isoFrom);
    const to   = isoTo ? new Date(isoTo) : new Date();
    if (isNaN(from) || isNaN(to)) return null;
    return Math.floor((to - from) / 60_000);
}

export function fmtEntrega(iso) {
    if (!iso) return null;
    const d   = new Date(iso);
    const hoy = new Date();
    const man = new Date(hoy); man.setDate(hoy.getDate() + 1);
    const time = hora12(d);
    if (d.toDateString() === hoy.toDateString()) return `Hoy ${time}`;
    if (d.toDateString() === man.toDateString()) return `Mañana ${time}`;
    return d.toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' }) + ` ${time}`;
}

// La hora de un momento, del canónico (`hora12`): «10:22 a. m.», con espacios
// que no se cortan.
//
// Vivía dentro de `LifecycleTimeline`. Se mudó acá cuando el carril de pasos de
// una diferencia necesitó la misma hora: dos copias del mismo formato son dos
// horas que pueden verse distintas en la misma tarjeta.
export function fmtHM(iso) {
    if (!iso) return '';
    return hora12(iso);
}

// El día de un momento, corto: «2 sep». Va arriba de la hora en el carril de
// pasos — la hora sola se lee bien el mismo día y deja de decir nada la semana
// siguiente, que es justo cuando alguien viene a ver qué pasó.
export function fmtDia(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' }).replace('.', '');
}

export function fmtRelative(iso) {
    if (!iso) return '—';
    const min = elapsed(iso);
    if (min == null) return '—';
    if (min < 1)  return 'ahora';
    if (min < 60) return `hace ${min}m`;
    const h = Math.floor(min / 60);
    if (h < 24)   return `hace ${h}h`;
    return `hace ${Math.floor(h / 24)}d`;
}

// Reparte las filas visibles en grupos: una caja por ruta con SUS paradas, y
// una última con lo que no va en ninguna ruta.
//
// Vive acá y no dentro del hook para que se pueda probar sin montar la vista —
// era justo lo que no tenía prueba el día que la Ruta #21 se llevó adentro una
// sala que no despachó.
export function agruparPorRuta(filas, mapaDeParadas, uid = '') {
    const grupos = [];
    const rutasPuestas = new Set();
    const sueltas = [];
    for (const fila of filas) {
        const parada = mapaDeParadas.get(claveParada(fila.pedido_id, fila.erp_sucursal_id));
        if (parada) {
            if (!rutasPuestas.has(parada.ruta.id)) {
                rutasPuestas.add(parada.ruta.id);
                const filasDeLaRuta = filas.filter(f =>
                    mapaDeParadas.get(claveParada(f.pedido_id, f.erp_sucursal_id))?.ruta.id === parada.ruta.id);
                grupos.push({ isRuta: true, ruta: parada.ruta, driverOnline: parada.driverOnline, rows: filasDeLaRuta });
            }
        } else {
            sueltas.push(fila);
        }
    }
    if (sueltas.length) grupos.push({ isRuta: false, ruta: null, rows: sueltas });
    // La ruta donde soy conductor va al tope
    const yo = String(uid ?? '');
    grupos.sort((a, b) => {
        if (!a.isRuta || !b.isRuta) return 0;
        const aMio = yo && String(a.ruta?.conductor_id) === yo;
        const bMio = yo && String(b.ruta?.conductor_id) === yo;
        return aMio === bMio ? 0 : aMio ? -1 : 1;
    });
    return grupos;
}

// El estado de UNA SALA. `row` viene de `get_pedidos_en_curso`, una fila por
// (pedido, sucursal).
//
// «En tránsito» pedía `pedidoStatus === 'enviado'`, y ése es el estado del
// PEDIDO: en uno de varias salas, despachar la primera ponía a TODAS en
// tránsito. Una sala que sigue en Bodega esperando la próxima ruta aparecía
// viajando. Hoy lo decide `row.enviado_at`, que desde la migración
// 20260824211021 es la salida de la parada de ESTA sala — o NULL si no tiene.
// La llave de una PARADA: (pedido, sala). Una parada es de una sala concreta,
// así que indexar por pedido a secas pierde información — y no en silencio a
// medias: `map.set(pedido_id, …)` deja ganar a la última sala que se recorra.
//
// Con eso, en el pedido 137 del 2026-08-24 la parada de Salud 1 quedó como «la
// parada del pedido 137», y la tarjeta de Salud 2 —que nunca estuvo en ninguna
// ruta— se agrupó dentro de la Ruta #21, mostró la cara del conductor en su
// nodo «Entregado» y le ofreció al conductor el botón «Entregué» para una
// parada que no era la suya.
//
// Va acá y no escrita a mano en cada sitio para que el que llena el mapa y los
// que lo leen no puedan divergir.
export function claveParada(pedidoId, sucursalId) {
    return `${pedidoId}__${sucursalId}`;
}

export function getBranchStage(row) {
    if (!row) return 'sin_iniciar';
    if (row.recibido_erp_at)                     return 'erp';
    if (row.llegada_fisica_at)                   return 'contando';
    if (row.finalizado_at && row.enviado_at)     return 'transito';
    if (row.finalizado_at)                       return 'preparado';
    // Usar pauses (historial) como fuente primaria — más confiable que los campos de PSS
    const hasActivePause = (row.pauses ?? []).some(p => !p.reanudado_at);
    if (hasActivePause || (row.pausado_at && !row.reanudado_at)) return 'pausado';
    if (row.iniciado_at)                                 return 'preparando';
    return 'sin_iniciar';
}

// ¿Le queda algo por contar a ESTA sala? Es lo que decide si la tarjeta pinta
// el bloque de Recepción, y por eso no puede colgar sólo de que el pedido esté
// «enviado»: ese estado se cae solo a mitad de la recepción.
// `receive_pedido_sucursal` pasa el pedido a «parcial» apenas UN renglón se
// confirma con diferencia, aunque queden hojas sin contar — y con la condición
// vieja el bloque entero desaparecía. Es lo que pasó el 2026-08-17 en La
// Popular (pedido 116): reportaron «viene 1 más en físico» al cerrar la hoja 1
// y quedaron 139 renglones —4 hojas y 8 cajas especiales— sin forma de
// contarlos.
//
// Y `pedidos.status` es del PEDIDO, no de la sala: en uno de varias sucursales,
// la diferencia que reporta una les quitaba el botón a TODAS. Por eso lo que
// manda es `pendientes`, que viene por (pedido, sucursal) de
// `get_pedido_item_stats` — el mismo número que la tarjeta ya muestra en
// «Paso 2 (N)».
//
// La primera guarda es `enviadoAt`, y es la que faltaba: nada le puede llegar a
// una sala que no salió. Con sólo `pedidoStatus === 'enviado'`, en el pedido
// 137 del 2026-08-24 Salud 2 —sin preparar, sin parada, sin una caja— tenía el
// botón «Confirmar llegada de cajas» activo, y apretarlo escribía
// `llegada_fisica_at` sobre una sala con `total_cajas` en NULL.
export function hayRecepcionPendiente({ enviadoAt = null, pedidoStatus, pendientes = 0, reenviosHistorial = [] }) {
    if (!enviadoAt) return false;
    if (pedidoStatus === 'enviado') return true;
    if (pedidoStatus === 'parcial' && pendientes > 0) return true;
    return (reenviosHistorial ?? []).some(c => c.sent_at && !c.arrived_at);
}

/**
 * Qué le falta todavía a ESTA sala de lo que se le despachó.
 *
 * Tres clases de cosa pueden no llegar —una caja numerada, Electrolit suelto,
 * una caja especial E1…En— y la pregunta estaba respondida en cuatro sitios con
 * cuatro listas distintas: el botón «Reenviar caja» sabía de las tres, las
 * etiquetas de la tarjeta sólo de dos, y la sala, en cuanto terminaba de
 * contar, de ninguna. Pedido #178 de Salud 4 (17-sep-2026): con sólo una caja
 * especial faltando, la tarjeta de bodega tenía el botón rojo y ninguna línea
 * que dijera QUÉ reenviar, y la de la sala decía «Completado» a secas.
 *
 * La caja especial se nombra con su PRODUCTO, que sale de la lista guardada al
 * despachar (`cajas_especiales`), la misma que imprimió la etiqueta. «E2» solo
 * no le dice nada a quien tiene que ir a buscarla al estante.
 *
 * `enCamino` es que bodega ya la reenvió y todavía nadie confirmó la llegada:
 * lo que falta sigue faltando, pero ya no depende de bodega.
 */
export function faltantesDeLaSala(row) {
    const cajas = Array.isArray(row?.falta_cajas) ? row.falta_cajas : [];
    const electrolits = (row?.electrolit_faltantes ?? 0) > 0 && row?.electrolit_ok !== true
        ? row.electrolit_faltantes
        : 0;
    //  El default de la columna es `'{}'::jsonb` —un objeto— y el de
    //  `cajas_especiales` también: `Array.isArray` y no `?? []`.
    const llegadas = row?.cajas_especiales_llegadas && typeof row.cajas_especiales_llegadas === 'object'
        && !Array.isArray(row.cajas_especiales_llegadas) ? row.cajas_especiales_llegadas : {};
    const lista = Array.isArray(row?.cajas_especiales) ? row.cajas_especiales : [];
    const especiales = Object.entries(llegadas)
        .filter(([, v]) => v === 'faltante')
        .map(([label]) => ({ label, producto: lista.find(c => c?.label === label)?.product_name ?? null }));

    // Las mismas cajas especiales, agrupadas por PRODUCTO. Es la unidad de
    // «No reenviar»: el sistema hace un traslado por producto, así que uno que
    // viajó en dos cajas se anula entero o no se anula. `parcial` es que alguna
    // de sus cajas sí llegó — anular regresaría también esa, y no se ofrece.
    const porRenglon = new Map();
    for (const e of especiales) {
        const itemId = lista.find(c => c?.label === e.label)?.pedido_item_id ?? `sin-${e.label}`;
        const g = porRenglon.get(itemId) ?? { itemId, producto: e.producto, labels: [], parcial: false };
        g.labels.push(e.label);
        porRenglon.set(itemId, g);
    }
    for (const g of porRenglon.values()) {
        g.parcial = lista.some(c => c?.pedido_item_id === g.itemId && !g.labels.includes(c.label));
    }

    return {
        cajas,
        electrolits,
        especiales,
        productosEspeciales: [...porRenglon.values()],
        hay: cajas.length > 0 || electrolits > 0 || especiales.length > 0,
        enCamino: (row?.reenvios_historial ?? []).some(c => c?.sent_at && !c?.arrived_at),
        // Reenvío pedido y todavía sin ruta (2026-10-07): el ciclo nace sin
        // `sent_at` y lo toma cuando la ruta sale. Ni «hay que reenviar» —ya se
        // pidió— ni «en camino» —sigue en bodega—.
        porDespachar: (row?.reenvios_historial ?? []).some(c => c && !c.sent_at && !c.arrived_at),
    };
}

// Cada faltante como una línea que se lee sola: «Caja #3», «2 Electrolit»,
// «E2 · ELECTROLIT MANZANA 625ML». La usan el aviso de la tarjeta, la
// confirmación del reenvío y la notificación a la sala, para que las tres
// digan lo mismo.
export function describirFaltantes({ cajas = [], electrolits = 0, especiales = [] } = {}) {
    const lineas = [];
    if (cajas.length > 0) lineas.push(`Caja${cajas.length > 1 ? 's' : ''} ${cajas.map(n => `#${n}`).join(', ')}`);
    if (electrolits > 0)  lineas.push(`${electrolits} Electrolit`);
    for (const e of especiales) lineas.push(e.producto ? `${e.label} · ${e.producto}` : e.label);
    return lineas;
}

// Las dos guardas de preparación de una SALA. Viven acá, exportadas, y no
// escritas dentro del JSX: una prueba que copia la expresión en vez de
// importarla no prueba nada — se escribió así primero y pasaba en verde con el
// defecto puesto.
//
// Piden `estadoDeLaSala` y no `pedido_status`: en un pedido de varias salas, la
// primera que salía ponía el PEDIDO en «enviado» y dejaba a las demás sin
// botón. Salud 2 del pedido 137 (2026-08-24) quedó sin «Iniciar», o sea sin
// forma de empezar a prepararse nunca. La base nunca lo impidió:
// `update_pedido_sucursal_lifecycle` mira la fila de la sala y ni consulta el
// estado del pedido — era una traba puesta sólo en la pantalla.
export function puedePrepararse(row) {
    return getBranchStage(row) === 'sin_iniciar' && estadoDeLaSala(row) === 'confirmado';
}

export function puedeDespacharse(row) {
    return getBranchStage(row) === 'preparado' && estadoDeLaSala(row) === 'confirmado';
}

// Qué rótulo lleva la tarjeta de una sala. La tarjeta es de la SALA, así que no
// puede pintar el estado del PEDIDO: en el pedido 137 del 2026-08-24, con
// Salud 1 despachada y Salud 2 todavía en Bodega, las dos decían «En ruta».
//
// Las claves son las de `PEDIDO_BADGE` — quien pinte esto no inventa rótulos,
// elige cuál de los que ya existen le toca a esta fila.
export function estadoDeLaSala(row) {
    if (!row) return 'confirmado';
    if (row.pedido_status === 'anulado')  return 'anulado';
    if (row.recibido_erp_at)              return 'completado';
    // La diferencia también es por sala: `diferencias_reportadas_at` viene de
    // `pedido_sucursal_status`, mientras que `pedido_status === 'parcial'` se
    // enciende con la primera sala que reporta una y se lo cuelga a todas.
    if (row.diferencias_reportadas_at && !row.confirmado_correccion_at) return 'parcial';
    if (row.enviado_at)                   return 'enviado';
    return 'confirmado';
}

/**
 * ¿Esta tarjeta le pide algo a alguien AHORA?
 *
 * Es la primera clave del orden del tablero: lo que necesita atención va
 * arriba, sin importar la fecha. Pedido del usuario (2026-09-02): *«si hay un
 * pedido pendiente, sea de recibir, o un producto con diferencia, siempre se
 * muestre arriba sin importar la fecha»*.
 *
 * Antes no sólo no subían: una diferencia BAJABA la tarjeta. El orden por etapa
 * mandaba lo que tuviera observación al escalón 6 de 7 —encima de `erp` y
 * debajo de todo lo demás—, así que el pedido con un problema abierto terminaba
 * al fondo de la lista.
 *
 * Dos casos, los dos por SALA y ninguno por fecha:
 *
 *  1. `sinResolver` — diferencias de esta sala que todavía esperan algo. Sale de
 *     `get_pedido_item_stats`, que lo calcula en la base: `con_diferencia` no
 *     sirve porque el status del renglón se queda ahí para siempre.
 *  2. Las cajas están EN la sala y nadie terminó de contarlas
 *     (`llegada_fisica_at` sin `recibido_erp_at`). Un pedido todavía en ruta no
 *     entra: nadie puede hacer nada con él, y subirlo dejaría a media lista
 *     «arriba», que es lo mismo que no ordenar.
 *  3. Algo no llegó y bodega todavía no lo reenvió — `faltantesDeLaSala`. Es
 *     un pendiente aunque la sala ya haya contado todo lo demás: el pedido #178
 *     de Salud 4 quedó «Completado» con una caja sin llegar, abajo de todo. Ya
 *     reenviado, en cambio, no sube: va en camino, igual que el caso 2.
 */
export function necesitaAtencion(row, stats = {}) {
    if (!row) return false;
    if ((stats.sinResolver ?? 0) > 0) return true;
    const faltan = faltantesDeLaSala(row);
    if (faltan.hay && !faltan.enCamino) return true;
    return !!row.llegada_fisica_at && !row.recibido_erp_at;
}

// solicitado = need in presentation units before dispatch rounding
export function calcSolicitado(row) {
    if (row.max_qty_snapshot == null || row.stock_packs_snapshot == null) return null;
    return Math.max(0, Math.ceil(row.max_qty_snapshot - row.stock_packs_snapshot));
}

// El mes de EL SALVADOR, no el del equipo: los dos rangos de abajo se comparan
// contra `created_at` pasado a día de la sala (`diaDe`), así que el mes también
// tiene que ser el de la sala. Con el reloj del equipo, una computadora con
// otra zona veía otro mes en la primera y la última noche.
export function currentMonthRange() {
    return rangoDeMes(0);
}

// ── Lo que el tablero y la app nativa leen IGUAL (2026-10-06) ───────────────
// Vivía repartido en `usePedidosData`, `LifecycleTimeline`, `ItemSections`,
// `PostCompletionSection`, `DifSection` y `TabMetricas`. La app nativa abre el
// mismo pedido en el teléfono: escrito dos veces, un paso nuevo de la línea de
// vida o un estado nuevo del filtro aparecería en una pantalla y no en la otra.

/** El rango de un mes como `desde|hasta` (0 = este mes, -1 = el anterior). */
export function rangoDeMes(desplazamiento = 0, hoy = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    // El mes de hoy EN LA SALA (`diaSV`), y desde ahí aritmética de calendario
    // en UTC, que no depende de la zona del equipo.
    const [y, m] = diaSV(hoy).split('-').map(Number);
    const ini = new Date(Date.UTC(y, m - 1 + desplazamiento, 1));
    const fin = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 0));
    return `${ini.getUTCFullYear()}-${pad(ini.getUTCMonth() + 1)}-01|${fin.getUTCFullYear()}-${pad(fin.getUTCMonth() + 1)}-${pad(fin.getUTCDate())}`;
}

/**
 * ¿Cae este pedido dentro de `desde|hasta`? El día es el de EL SALVADOR
 * (`diaDe`), no el de UTC: `created_at.slice(0, 10)` leía el día en Greenwich,
 * así que un pedido creado el 31 a las 7 pm de la sala ya «era» del 1 del mes
 * siguiente — salía del tablero de su mes y entraba en el del otro.
 */
export function enRangoDeDias(iso, rango) {
    if (!rango) return true;
    const [desde, hasta] = rango.split('|');
    const d = diaDe(iso);
    if (!d) return !desde && !hasta;
    return (!desde || d >= desde) && (!hasta || d <= hasta);
}

/** Los filtros de estado del tablero — los de `FilterPill`. */
export const ESTADOS_DEL_TABLERO = [
    { value: 'all',         label: 'Todos los estados' },
    { value: 'confirmado',  label: 'Pendientes' },
    { value: 'enviado',     label: 'En ruta' },
    { value: 'observacion', label: 'Con observación' },
    { value: 'completado',  label: 'Completados' },
];

/** El rótulo del estado de la sala (`estadoDeLaSala`) — `PEDIDO_BADGE`. */
export const ROTULO_DE_ESTADO = {
    confirmado: 'Por despachar', enviado: 'En ruta', parcial: 'Con diferencias',
    completado: 'Completado', anulado: 'Anulado',
};

/**
 * ¿Esta sala tiene algo que mirar? Una diferencia abierta, una llegada que no
 * fue completa, cajas que faltaron o llegaron dañadas, el Electrolit o una caja
 * especial que no vino, o renglones que no entraron al inventario. Es lo que
 * hace que un pedido completado NO se esconda del filtro por defecto. El
 * porqué de cada término está en `usePedidosData` (`hasObservacion`).
 */
export function tieneObservacion(r, sinIngresar = 0) {
    if (!r) return false;
    return (!!r.diferencias_reportadas_at && !r.confirmado_correccion_at) ||
        (!!r.llegada_tipo && r.llegada_tipo !== 'completa') ||
        (r.falta_cajas?.length > 0) ||
        (r.cajas_danadas?.length > 0) ||
        (r.electrolit_ok === false) ||
        Object.values(r.cajas_especiales_llegadas ?? {}).some(v => v === 'faltante') ||
        (sinIngresar ?? 0) > 0;
}

/**
 * El filtro de estado y de período del tablero. `observado(r)` dice si la sala
 * tiene observación (el tablero le suma lo que quedó sin ingresar).
 * `'all'` esconde los completados SIN observación: el que tiene algo abierto
 * sigue a la vista aunque diga «completado».
 */
//
// Las cuatro ramas preguntan por el estado de la SALA (`estadoDeLaSala`), no
// por `pedido_status` (2026-10-08). Tres de ellas todavía miraban el del
// PEDIDO, que es el defecto que ya costó el rótulo de la tarjeta: en un pedido
// de varias salas, una sala ya completada seguía en «Todos» y fuera de
// «Completados» mientras otra del mismo pedido no terminara, y una sala con
// observación cuyo pedido ya se había cerrado salía de «Con observación».
export function filtrarPedidos(rows, { estado = 'all', rango = null, observado = r => tieneObservacion(r) } = {}) {
    let filas = rows ?? [];
    const completada = r => estadoDeLaSala(r) === 'completado';
    if (estado === 'completado') {
        filas = filas.filter(completada);
    } else if (estado === 'observacion') {
        // «Con observación» = la regla de siempre (algo observado en un pedido
        // que no está cerrado) MÁS lo que sigue abierto aunque el pedido se
        // haya cerrado: una caja que falta o una diferencia sin resolver.
        // Medirlo contra la sala «completada» (como quedó un rato el
        // 2026-10-08) sacaba del filtro justo a las salas recibidas con
        // diferencias pendientes — lo cazó la prueba de paridad con producción.
        // Y no se suma toda observación de un pedido cerrado: `llegada_tipo`
        // queda escrito para siempre aunque el faltante ya se haya resuelto.
        filas = filas.filter(r => (observado(r) && r.pedido_status !== 'completado')
            || faltantesDeLaSala(r).hay
            || (!!r.diferencias_reportadas_at && !r.confirmado_correccion_at));
    } else if (estado !== 'all') {
        filas = filas.filter(r => estadoDeLaSala(r) === estado);
    } else {
        filas = filas.filter(r => !completada(r) || observado(r));
    }
    if (rango) filas = filas.filter(r => enRangoDeDias(r.created_at, rango));
    return filas;
}

/**
 * Los pasos de la vida de un pedido en una sala, en orden, con su hora y quién
 * lo hizo: Confirmado → Inicio → Listo → En ruta → Entregado → Llegada →
 * Finalizado, y después los extras (la caja que faltó, cada reenvío y su
 * llegada, la diferencia y su corrección).
 *
 * `quien(id)` resuelve una persona por id (o null). `entrega` es la parada de
 * esta sala en una ruta (`{ entregado_at, entregado_por }`) y `conductor` la
 * persona que manejaba: quien entregó es `entregado_por` y, sin él, el
 * conductor.
 *
 * Cada paso trae `extra: true` cuando no es de los siete fijos; los fijos se
 * marcan hechos por posición contra la etapa (`PASO_DE_LA_ETAPA`).
 */
export const PASO_DE_LA_ETAPA = { sin_iniciar: 0, preparando: 1, pausado: 1, preparado: 2, transito: 3, contando: 5, erp: 6 };

export function pasosDelPedido(row, { quien = () => null, entrega = null, conductor = null } = {}) {
    if (!row) return [];
    const p = id => (id ? quien(id) ?? null : null);
    const entregador = entrega?.entregado_por ? (p(entrega.entregado_por) ?? conductor) : conductor;
    const pasos = [
        { key: 'confirmado',     label: 'Confirmado', time: row.created_at,          emp: p(row.created_by) },
        { key: 'iniciado',       label: 'Inicio',     time: row.iniciado_at,         emp: p(row.iniciado_por) },
        { key: 'preparado',      label: 'Listo',      time: row.finalizado_at,       emp: p(row.finalizado_por) },
        { key: 'enviado',        label: 'En ruta',    time: row.enviado_at,          emp: p(row.enviado_por) },
        { key: 'ruta_entregado', label: 'Entregado',  time: entrega?.entregado_at ?? null, emp: entregador, isRutaNode: true },
        { key: 'llegada',        label: 'Llegada',    time: row.llegada_fisica_at,   emp: p(row.llegada_fisica_por) },
        { key: 'erp',            label: 'Finalizado', time: row.recibido_erp_at,     emp: p(row.recibido_erp_por) },
    ];
    if (row.falta_caja_at) {
        const problema = row.llegada_tipo === 'mixto' ? 'Dañada + Falta'
            : row.llegada_tipo === 'caja_danada' ? 'Caja dañada' : 'Falta caja';
        pasos.push({ key: 'falta_caja', label: problema, time: row.falta_caja_at, emp: p(row.llegada_fisica_por), extra: true });
        const historial = row.reenvios_historial ?? [];
        if (historial.length > 0) {
            historial.forEach((ciclo, i) => {
                const n = historial.length > 1 ? ` ${ciclo.ciclo}` : '';
                // Pedido y salida son dos momentos (2026-10-08): el ciclo nace
                // pendiente y toma `sent_at` cuando sale su ruta. Quien lo pidió
                // es `solicitado_por`; los ciclos viejos sólo tienen `reenvio_por`.
                const pidio = p(ciclo.solicitado_por ?? row.reenvio_por);
                if (!ciclo.sent_at) {
                    pasos.push({ key: `reenvio_${i}`, label: `Reenvío${n} pedido`, time: ciclo.solicitado_at ?? null, emp: pidio, extra: true });
                } else {
                    pasos.push({ key: `reenvio_${i}`, label: `Reenvío${n} salió`, time: ciclo.sent_at, emp: p(ciclo.sent_by) ?? pidio, extra: true });
                }
                if (ciclo.arrived_at) {
                    pasos.push({ key: `seg_llegada_${i}`, label: historial.length > 1 ? `Llegada R.${ciclo.ciclo}` : '2ª Llegada', time: ciclo.arrived_at, emp: p(ciclo.arrived_por), extra: true });
                }
            });
        } else {
            if (row.reenvio_bodega_at) pasos.push({ key: 'reenvio', label: 'Reenvío', time: row.reenvio_bodega_at, emp: p(row.reenvio_por), extra: true });
            if (row.segunda_llegada_at) pasos.push({ key: 'seg_llegada', label: '2ª Llegada', time: row.segunda_llegada_at, emp: null, extra: true });
        }
    }
    if (row.diferencias_reportadas_at) {
        pasos.push({ key: 'diferencias', label: 'Diferencias', time: row.diferencias_reportadas_at, emp: p(row.diferencias_reportadas_por), extra: true });
        pasos.push({ key: 'corregido',   label: 'Corregido',   time: row.confirmado_correccion_at,  emp: p(row.confirmado_correccion_por), extra: true });
    }
    return pasos;
}

/** Los renglones de un pedido partidos como los muestra el tablero. */
export function seccionesDeRenglones(items) {
    const todos = items ?? [];
    return {
        enviados:    todos.filter(i => i.cantidad_asignada > 0),
        agotamiento: todos.filter(i => i.agotamiento),
        sinStock:    todos.filter(i => i.sin_stock),
        porRegla:    todos.filter(i => i.revision_minmax),
        total:       todos.length,
    };
}

/** Los renglones con diferencia de una sala (los que lee `DifSection`). */
export const renglonesConDiferencia = items => (items ?? []).filter(r => r.status === 'con_diferencia' || r.error_tipo);

/** Cómo llegó el pedido a la sala — `PostCompletionSection`. */
export const LLEGADA_TIPO = {
    completa:    'Recibido sin novedad',
    caja_danada: 'Caja dañada',
    falta_caja:  'Caja faltante',
    mixto:       'Daños y faltantes',
};

export function resumenDeRecepcion(row, difItems = []) {
    return {
        llegada:       row?.llegada_tipo ? (LLEGADA_TIPO[row.llegada_tipo] ?? null) : null,
        cajasDanadas:  row?.cajas_danadas ?? [],
        reenvios:      (row?.reenvios_historial ?? []).length,
        difResueltas:  difItems.filter(d => d.resolucion_status === 'confirmada').length,
        difPendientes: difItems.filter(d => d.resolucion_status !== 'confirmada').length,
    };
}

/** Qué clase de diferencia es un renglón (`error_tipo`). */
export const TIPO_DE_DIFERENCIA = {
    faltante:     { label: 'Faltante',       variante: 'danger'  },
    sobrante:     { label: 'Sobrante',       variante: 'success' },
    danado:       { label: 'Dañado',         variante: 'neutral' },
    vencido:      { label: 'Vencido',        variante: 'neutral' },
    presentacion: { label: 'Pres. distinta', variante: 'neutral' },
    otro:         { label: 'Otro',           variante: 'neutral' },
    diferencia:   { label: 'Diferencia',     variante: 'warning' },
};

/** En qué punto está la conversación de una diferencia (`resolucion_status`). */
export function estadoDeDiferencia(item) {
    const s = item?.resolucion_status;
    if (s === 'confirmada')      return 'Resuelta';
    if (s === 'propuesta')       return 'Contesta bodega';
    if (s === 'contrapropuesta') return 'Contesta la sala';
    if (s === 'escalada')        return 'Lo ve supervisión';
    return 'Sin resolver';
}

/** Solicitado → enviado → contado de un renglón, y cuánto falta o sobra. */
export function cifrasDelRenglon(item) {
    const solicitado = calcSolicitado(item);
    const enviado = item?.cantidad_enviada ?? item?.cantidad_asignada ?? null;
    const contado = item?.cantidad_recibida ?? null;
    const delta = contado == null || enviado == null ? null : contado - enviado;
    return { solicitado, enviado, contado, delta };
}

/**
 * Los tiempos del despacho en un rango — `TabMetricas`. Entra la respuesta de
 * `get_pedido_kpis` (una fila por pedido y sala, en minutos) y sale el
 * promedio general y por sucursal. `nombre(id)` rotula la sucursal.
 */
const promedio = arr => {
    const v = arr.filter(x => x != null && x >= 0);
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
};
export function indicadoresDePedidos(kpis, nombre = id => `Suc. ${id}`) {
    const filas = kpis ?? [];
    const grupos = filas.reduce((acc, k) => { (acc[k.erp_sucursal_id] ??= []).push(k); return acc; }, {});
    return {
        pedidos:     new Set(filas.map(k => k.pedido_id)).size,
        prep:        promedio(filas.map(k => k.tiempo_prep_neto_min)),
        transito:    promedio(filas.map(k => k.tiempo_transito_min)),
        recuento:    promedio(filas.map(k => k.tiempo_recuento_min)),
        pausado:     promedio(filas.map(k => k.tiempo_pausado_min)),
        pausas:      filas.reduce((s, k) => s + (k.num_pausas ?? 0), 0),
        porSucursal: Object.entries(grupos).map(([id, rows]) => ({
            id:        Number(id),
            nombre:    nombre(Number(id)),
            pedidos:   new Set(rows.map(r => r.pedido_id)).size,
            prep:      promedio(rows.map(r => r.tiempo_prep_neto_min)),
            pausado:   promedio(rows.map(r => r.tiempo_pausado_min)),
            transito:  promedio(rows.map(r => r.tiempo_transito_min)),
            recuento:  promedio(rows.map(r => r.tiempo_recuento_min)),
            pausas:    rows.reduce((s, r) => s + (r.num_pausas ?? 0), 0),
        })).sort((a, b) => b.pedidos - a.pedidos),
    };
}

/** «45 min», «2h 5m», «—» — el formato de los promedios de `TabMetricas`. */
export function minutosLegibles(min) {
    if (min == null || min < 0) return '—';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Cuántos pedidos tiene cada sala en un rango `desde|hasta` (las tarjetas del tablero). */
export function pedidosPorSala(rows, rango = null) {
    const cuenta = new Map();
    (rows ?? []).forEach(r => {
        if (!enRangoDeDias(r.created_at, rango)) return;
        cuenta.set(r.erp_sucursal_id, (cuenta.get(r.erp_sucursal_id) ?? 0) + 1);
    });
    return cuenta;
}

/** Cómo se despacha un renglón: «Caja ×12», «Blíster ×10», «Unid ×3», «Unidad». */
const TIPO_DE_DESPACHO = { caja: 'Caja', blister: 'Blíster', multiplo: 'Unid', multiplo_unidades: 'Unid', solo_cajas: 'Caja' };
export function rotuloDePresentacion(row) {
    const tipo = row?.dispatch_tipo;
    const factor = row?.dispatch_factor || row?.factor || 1;
    if (!tipo) return factor > 1 ? `×${factor} unid` : 'Unidad';
    const conFactor = factor > 1 && ['caja', 'blister', 'solo_cajas'].includes(tipo);
    const multiplo = ['multiplo', 'multiplo_unidades'].includes(tipo);
    return `${TIPO_DE_DESPACHO[tipo] ?? tipo}${conFactor ? ` ×${factor}` : ''}${multiplo ? ` ×${factor}` : ''}`;
}

// Los rótulos de la conversación de una diferencia — vivían en `DifSection`.
// Las resoluciones nuevas traen su rótulo desde `diferencia_opcion`; éstas son
// las VIEJAS, para poder leer lo que ya está guardado. Un rótulo que falta no
// da error: imprime la clave interna y parece un dato.
export const RESOLUCION_DE_DIFERENCIA = {
    envio_fisico:        'Enviar producto',
    ajuste_sistema:      'Ajuste en sistema',
    aceptar_sobrante:    'Sucursal queda con sobrante',
    devolver_bodega:     'Devolver a bodega',
    devolucion_aceptada: 'Devolución aceptada',
    devolucion_negada:   'Devolución negada',
    aceptar_dif_pres:    'Dif. presentación aceptada',
    resuelto:            'Resuelto',
    no_aplica:           'Sin solución',
};

export const EVENTO_DE_DIFERENCIA = {
    resolucion_propuesta:    'propuso resolución',
    resolucion_confirmada:   'confirmó resolución',
    resolucion_rechazada:    'rechazó resolución',
    // Cortos, pero que digan qué pasó. «propuso cómo se arregla» y «estuvo de
    // acuerdo» no decían con QUÉ, y el paso siguiente quedaba colgado del
    // anterior para entenderse.
    diferencia_proponer:     'propuso qué hacer',
    diferencia_contraproponer:'propuso la otra salida',
    diferencia_aceptar:      'aceptó la propuesta',
    diferencia_escalada:     'no estuvo de acuerdo — pasó a supervisión',
    diferencia_supervisar:   'lo decidió supervisión',
    diferencia_llegada:      'confirmó que lo tiene',
    devolucion_solicitada:   'pidió la devolución',
    devolucion_aceptada:     'aceptó la devolución',
    devolucion_rechazada:    'no aceptó la devolución',
    devolucion_recibida:     'recibió la devolución en bodega',
    correccion_conteo:       'corrigió lo contado',
    // Los tres de abajo faltaban y salían CRUDOS a la pantalla: la actividad
    // del pedido #150 mostraba «traslado_recibido» tal cual, que además nombra
    // la tubería y no el negocio. Un rótulo que falta no da error: imprime la
    // clave interna y parece un dato.
    traslado_recibido:       'confirmó la entrada al inventario',
    extra_anotado:           'anotó un producto que llegó de más',
    extra_quitado:           'quitó lo que había anotado de más',
    no_reenviado:            'decidió no reenviar la caja que no llegó',
};

