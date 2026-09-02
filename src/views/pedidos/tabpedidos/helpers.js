// Extracted from TabPedidos.jsx (Bloque 6.C) — shared by the main tab and
// its extracted sub-components, kept here so neither side duplicates it.

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
    const time = d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (d.toDateString() === hoy.toDateString()) return `Hoy ${time}`;
    if (d.toDateString() === man.toDateString()) return `Mañana ${time}`;
    return d.toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' }) + ` ${time}`;
}

// La hora de un momento. `es-SV` devuelve «10:22 a. m.» —con espacio dentro de
// la abreviatura— y eso son ~62px; se junta a «10:22 a.m.».
//
// Vivía dentro de `LifecycleTimeline`. Se mudó acá cuando el carril de pasos de
// una diferencia necesitó la misma hora: dos copias del mismo formato son dos
// horas que pueden verse distintas en la misma tarjeta.
export function fmtHM(iso) {
    if (!iso) return '';
    return new Date(iso)
        .toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit', hour12: true })
        .replace(/\s*([ap])\.\s*m\./i, ' $1.m.');
}

// Cuándo pasó algo, para leerlo dentro de una secuencia.
//
// La hora sola alcanza mientras todo pasó hoy —que es el caso normal de un
// pedido— y el día se agrega sólo cuando NO fue hoy. Sin eso, un pedido de la
// semana pasada muestra cuatro horas sueltas y parece de esta mañana.
export function fmtMomento(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const hoy = new Date();
    if (d.toDateString() === hoy.toDateString()) return fmtHM(iso);
    return `${d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' })} · ${fmtHM(iso)}`;
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
 * Cuántas diferencias de ESTA sala siguen esperando algo.
 *
 * El chip de la tarjeta se encendía con `pedido_status === 'parcial'`, y eso es
 * del PEDIDO entero — el mismo defecto que ya costó el rótulo de arriba. Medido
 * el 2026-09-02 en el pedido #150: Salud 5 mostraba «Difs. pendientes» con su
 * única diferencia CERRADA (SECUFEM, `confirmada`, el traslado ya entró a la
 * sala); la que seguía viva era el REGUTOL de **La Popular**, la otra sala del
 * mismo pedido.
 *
 * Y aunque el pedido fuera de una sola sala seguiría mintiendo:
 * `pedido_items.status` se queda en `'con_diferencia'` para siempre —es el
 * registro de que hubo una— así que `pedidos.status` no vuelve de `'parcial'`
 * nunca. Lo que dice si falta algo es `resolucion_status`, y su único estado
 * terminal es `'confirmada'`: `'acordada'` todavía tiene un movimiento en vuelo,
 * `'propuesta'`/`'contrapropuesta'`/`'escalada'` esperan a alguien, y `null` es
 * que nadie propuso nada.
 *
 * `undefined` mientras los renglones no llegaron: devuelve 0 y no se pinta nada.
 * Preferible a afirmar sobre lo que todavía no se leyó — el auto-cargado de
 * `usePedidosData` los trae solos en cuanto el pedido está `parcial`.
 */
export function difsSinResolver(itemsDeLaSala) {
    if (!Array.isArray(itemsDeLaSala)) return 0;
    return itemsDeLaSala.filter(
        r => r.status === 'con_diferencia' && r.resolucion_status !== 'confirmada',
    ).length;
}

// solicitado = need in presentation units before dispatch rounding
export function calcSolicitado(row) {
    if (row.max_qty_snapshot == null || row.stock_packs_snapshot == null) return null;
    return Math.max(0, Math.ceil(row.max_qty_snapshot - row.stock_packs_snapshot));
}

export function currentMonthRange() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const pad = n => String(n).padStart(2, '0');
    const fini = `${y}-${pad(m + 1)}-01`;
    const last = new Date(y, m + 1, 0);
    const ffin = `${y}-${pad(m + 1)}-${pad(last.getDate())}`;
    return `${fini}|${ffin}`;
}
