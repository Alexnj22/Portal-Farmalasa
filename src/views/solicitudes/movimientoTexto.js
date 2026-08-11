// Cómo se lee una solicitud que MUEVE PRODUCTO: carga, descarte y traslado.
//
// Aparte del componente porque son funciones puras y ese archivo exporta
// componentes: mezclarlos rompe el fast refresh de Vite. Mismo reparto que
// `traslados/trasladoTexto.js`, que es el hermano mayor de este archivo.
//
// ── Por qué existe ─────────────────────────────────────────────────────────
// Hasta el 2026-08-10 la Bandeja de Aprobaciones no tenía UN SOLO bloque para
// estos tres tipos. La solicitud llegaba con el producto, la cantidad, la
// existencia, el lote, el motivo con nombre y hasta las fotos guardadas — y lo
// único que se pintaba era el texto libre. Quien aprobaba un descarte veía
// «inyectorio» y nada más, así que decidía a ciegas sobre existencias que no se
// pueden devolver con un clic.

/** Los tres tipos que sacan o meten producto de verdad. */
export const TIPOS_MOVIMIENTO = new Set([
    'INVENTORY_LOAD_REQUEST',
    'INVENTORY_DISCARD_REQUEST',
    'INVENTORY_TRANSFER_REQUEST',
]);

export const esMovimiento = (type) => TIPOS_MOVIMIENTO.has(type);

/** Las líneas del movimiento. Nunca devuelve algo que no sea un array. */
export const lineasDe = (meta) => (Array.isArray(meta?.items) ? meta.items : []);

/**
 * Las líneas que el aprobador dejó afuera, por índice.
 *
 * Se guarda el ÍNDICE dentro de `items` y no una copia de la línea: la línea ya
 * está ahí y duplicarla es garantizar que las dos copias se separen. El motivo
 * viaja al lado porque es lo único que la línea original no puede tener.
 */
export const rechazadasDe = (meta) => {
    const lista = Array.isArray(meta?.lineas_rechazadas) ? meta.lineas_rechazadas : [];
    return new Map(lista
        .filter(r => Number.isInteger(r?.i))
        .map(r => [r.i, String(r.motivo ?? '').trim() || 'Sin motivo']));
};

/**
 * Las líneas que entraron con MENOS cantidad de la pedida, por índice → cuánto
 * entró.
 *
 * Es la otra mitad de la decisión por línea: no alcanza con quitar renglones
 * enteros, porque lo normal es que de las 4 unidades pedidas entren 2. Quitar la
 * línea completa por no poder ajustar la cantidad obligaba a rechazar y pedir de
 * nuevo — que es justo lo que esto viene a evitar.
 */
export const ajustadasDe = (meta) => {
    const lista = Array.isArray(meta?.lineas_ajustadas) ? meta.lineas_ajustadas : [];
    return new Map(lista
        .filter(a => Number.isInteger(a?.i) && Number.isFinite(Number(a?.aplicada)))
        .map(a => [a.i, Number(a.aplicada)]));
};

/**
 * Una aprobación PARCIAL — entró parte y el resto quedó rechazado con su motivo.
 *
 * No es un quinto estado: `approval_requests.status` sólo admite cuatro y
 * agregarle uno obligaría a revisar cada consumidor que hoy hace `=== 'APPROVED'`
 * (la Bandeja, Mis Solicitudes, la baldosa del tablero, las tres pestañas de
 * Traslados). La solicitud SÍ quedó aprobada y cerrada; lo parcial es un matiz
 * de esa aprobación y por eso vive en su metadata.
 */
export const esParcial = (req) =>
    req?.status === 'APPROVED'
    && (rechazadasDe(req?.metadata).size > 0 || ajustadasDe(req?.metadata).size > 0);

/** Cuántas unidades suman las líneas dadas. */
export const unidadesDe = (items) =>
    items.reduce((t, i) => t + (Number(i?.cantidad) || 0), 0);

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Lo que se pide, en una línea. Con un solo producto entra el nombre —que es el
 * caso normal— y con varios se dice cuántos, para no cortar tres nombres a la
 * mitad.
 */
export function resumenMovimiento(meta) {
    const items = lineasDe(meta);
    if (items.length === 0) return 'Sin detalle';
    if (items.length === 1) {
        const i = items[0];
        return `${i.cantidad} ${i.presentacion_tipo ?? 'u'} · ${i.descripcion ?? `#${i.erp_product_id}`}`;
    }
    const unidades = Number(meta?.total_unidades) || unidadesDe(items);
    return `${plural(items.length, 'producto', 'productos')} · ${plural(unidades, 'unidad', 'unidades')}`;
}

/**
 * El encabezado del movimiento: por qué y dónde.
 *
 * `motivo_label` es el rótulo legible («Enfermería — inyecciones») y `motivo` el
 * código con el que se agrupa. Se muestra el rótulo y se cae al código sólo si
 * el rótulo no está, que es lo que pasa con las solicitudes viejas.
 */
export function contextoMovimiento(meta) {
    return {
        motivo:  meta?.motivo_label || meta?.motivo || meta?.subtipo || null,
        sala:    meta?.branch_name || null,
        origen:  meta?.origen_branch_name || null,
        unidades: Number(meta?.total_unidades) || unidadesDe(lineasDe(meta)),
    };
}

/** El texto sobre el que se busca una solicitud de movimiento. */
export function textoBuscableMovimiento(req) {
    const m = req?.metadata ?? {};
    return [
        ...lineasDe(m).map(i => i.descripcion ?? ''),
        m.branch_name ?? '', m.origen_branch_name ?? '',
        m.motivo_label ?? '', m.subtipo ?? '', req?.note ?? '',
    ].join(' ');
}

/* ── Fechas, para las tres pantallas de solicitudes ───────────────────────── */
// Viven acá y no junto a la tarjeta porque son puras: un archivo que exporta
// componentes Y funciones rompe el fast refresh de Vite, que es la misma razón
// por la que este archivo existe.
export const fmtDiaMes = (iso) => !iso ? '—'
    : new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });

export const fmtDateFull = (iso) => !iso ? '—'
    : new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });

/* ── La hora ──────────────────────────────────────────────────────────────
 *
 * Faltaba en las tres pantallas, y es la mitad del dato: una solicitud de
 * descarte de las 8 de la mañana y una de las 9 de la noche no se leen igual, y
 * «11 ago 2026» en las dos las hacía indistinguibles. La base la guarda desde
 * siempre (`created_at` es timestamptz); nadie la mostraba.
 */
export const fmtHora = (iso) => !iso ? ''
    : new Date(iso).toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit', hour12: true });

export const fmtFechaHora = (iso) => !iso ? '—' : `${fmtDateFull(iso)}, ${fmtHora(iso)}`;

/**
 * «hace 5 min» / «hace 3 h» / «hace 2 d».
 *
 * `ahora` es OBLIGATORIO y no un `Date.now()` por defecto: leer el reloj durante
 * el render es una llamada impura que el compilador de React rechaza, y además
 * congelaría el valor hasta el siguiente re-render. Quien la llama lo saca de
 * `useNowTick`, que es el que hace latir el número.
 */
export const desdeHace = (iso, ahora) => {
    if (!iso || !ahora) return '';
    const ms = ahora - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '';
    const min = Math.floor(ms / 60000);
    if (min < 1)  return 'recién';
    if (min < 60) return `hace ${min} min`;
    const horas = Math.floor(min / 60);
    if (horas < 24) return `hace ${horas} h`;
    const dias = Math.floor(horas / 24);
    if (dias < 30) return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
    const meses = Math.floor(dias / 30);
    return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
};

/** Cuánto tardó en resolverse, para ponerlo al lado de la hora de la decisión. */
export const cuantoTardo = (desde, hasta) => {
    if (!desde || !hasta) return '';
    const ms = new Date(hasta).getTime() - new Date(desde).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const min = Math.floor(ms / 60000);
    if (min < 1)  return 'al momento';
    if (min < 60) return `en ${min} min`;
    const horas = Math.floor(min / 60);
    if (horas < 24) return `en ${horas} h`;
    const dias = Math.floor(horas / 24);
    return `en ${dias} ${dias === 1 ? 'día' : 'días'}`;
};

/* ── Quién es quién ────────────────────────────────────────────────────────
 *
 * Las dos personas de una solicitud llegan de dos fuentes que no siempre traen
 * lo mismo: `fetchRequests` las hidrata con foto y cargo, pero la campana abre
 * el detalle desde una lectura suelta que sólo tiene los ids. Por eso se cae al
 * maestro de personal antes de rendirse — y por eso esto está escrito UNA vez.
 */
export const personasDe = (req, empleadosPorId) => {
    const buscar = (obj, id) => {
        const delMaestro = id ? empleadosPorId?.get(String(id)) : null;
        // El maestro gana cuando el objeto de la solicitud no trae foto: son la
        // misma persona y ahí está la cara.
        if (delMaestro && (!obj || (!obj.photo && !obj.photo_url))) return delMaestro;
        return obj ?? delMaestro ?? null;
    };
    return {
        solicitante: buscar(req?.employee, req?.employee_id ?? req?.employee?.id),
        aprobador:   buscar(req?.approver, req?.approver_id ?? req?.approver?.id),
    };
};

/**
 * Cuándo se resolvió.
 *
 * `approvals` es la fuente buena cuando existe —guarda el instante de cada
 * nivel— y `updated_at` el respaldo, que es lo único que queda en un rechazo o
 * en una cancelación. Mientras está pendiente no hay nada que decir: devolver
 * `updated_at` ahí sería llamar «decisión» a cualquier retoque de la fila.
 */
export const cuandoSeDecidio = (req) => {
    if (!req || req.status === 'PENDING') return null;
    const ultima = Array.isArray(req.approvals) && req.approvals.length
        ? req.approvals[req.approvals.length - 1]?.approvedAt
        : null;
    return ultima ?? req.decided_at ?? req.updated_at ?? null;
};
