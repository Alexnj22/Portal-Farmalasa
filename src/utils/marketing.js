// ── Planificador de contenido — la lógica que no conoce al navegador ────────
//
// El módulo `marketing` planifica las publicaciones del mes en redes, lleva el
// flujo de cada pieza con el diseñador, la revisión del calendario y la pauta.
// Las reglas que importan (quién aprueba, qué ve quién antes de publicar el
// mes) viven en la base —migración `marketing_planificador`—; esto es sólo lo
// que la pantalla necesita para pintar.
//
// Las listas de abajo NO tienen tabla a propósito: el valor guardado es un
// código (`reel`) y el rótulo es libre. Las marcas y las redes, que sí cambian
// con el negocio, salen de `marketing_marcas` y `marketing_redes`.

/** Los formatos. Deben coincidir con el CHECK de `marketing_piezas.formato`. */
export const FORMATOS = [
    { value: 'post',     label: 'Post',     icono: 'Image' },
    { value: 'carrusel', label: 'Carrusel', icono: 'GalleryHorizontal' },
    { value: 'reel',     label: 'Reel',     icono: 'Clapperboard' },
    { value: 'video',    label: 'Video',    icono: 'Video' },
    { value: 'historia', label: 'Historia', icono: 'CircleDashed' },
];

/**
 * Lo que se pide IMPRESO (solicitudes). No va al calendario de redes: se
 * acepta, se diseña y se entrega. Cada formato trae sus tamaños comunes; el
 * selector deja escribir uno libre. Deben coincidir con el CHECK de
 * `marketing_solicitudes.formato`.
 */
export const FORMATOS_IMPRESOS = [
    { value: 'banner',   label: 'Banner',   tamanos: ['2 × 1 m', '3 × 1 m', '1.5 × 0.5 m', '4 × 1 m'] },
    { value: 'rollup',   label: 'Roll-up',  tamanos: ['0.85 × 2 m', '1 × 2 m'] },
    { value: 'afiche',   label: 'Afiche',   tamanos: ['Carta (8.5 × 11")', 'Tabloide (11 × 17")', 'A3 (29.7 × 42 cm)', 'A2 (42 × 59.4 cm)', '60 × 90 cm'] },
    { value: 'volante',  label: 'Volante',  tamanos: ['Carta (8.5 × 11")', 'Media carta (5.5 × 8.5")', 'Cuarto de carta (4.25 × 5.5")'] },
    { value: 'rotulo',   label: 'Rótulo',   tamanos: ['1 × 0.5 m', '2 × 1 m', '3 × 1 m'] },
    { value: 'etiqueta', label: 'Etiqueta', tamanos: ['5 × 3 cm', '5 × 5 cm', '10 × 5 cm'] },
    { value: 'tarjeta',  label: 'Tarjeta',  tamanos: ['Presentación (3.5 × 2")', 'Postal (6 × 4")'] },
    { value: 'otro',     label: 'Otro',     tamanos: [] },
];

/** Los tamaños sugeridos de un formato impreso. */
export const tamanosDe = (formato) => FORMATOS_IMPRESOS.find((f) => f.value === formato)?.tamanos || [];

/**
 * Los pilares: de qué habla la pieza. Sirven para ver la mezcla del mes —un
 * mes que es todo promoción se nota en el resumen antes de publicarlo.
 */
export const PILARES = [
    { value: 'promocion',       label: 'Promoción',       tono: 'chart-1' },
    { value: 'producto',        label: 'Producto',        tono: 'chart-3' },
    { value: 'educativo',       label: 'Educativo',       tono: 'chart-4' },
    { value: 'institucional',   label: 'Institucional',   tono: 'chart-6' },
    { value: 'fecha_especial',  label: 'Fecha especial',  tono: 'chart-8' },
    { value: 'entretenimiento', label: 'Entretenimiento', tono: 'chart-9' },
];

/**
 * El flujo de una pieza, en el orden en que avanza. `variant` es el de `Badge`.
 * `aprobado` lo pone sólo quien revisa (lo impide un trigger en la base).
 */
export const ESTADOS_PIEZA = [
    { value: 'pendiente',  label: 'Pendiente',  variant: 'neutral' },
    { value: 'en_proceso', label: 'En proceso', variant: 'info' },
    { value: 'finalizado', label: 'Finalizado', variant: 'chart-3' },
    { value: 'cambios',    label: 'Con cambios', variant: 'warning' },
    { value: 'aprobado',   label: 'Aprobado',   variant: 'success' },
    // Ya agendada en la red: sale sola. El recordatorio de las 8:00 no insiste
    // con ella, y el cron la pasa a publicada cuando su día queda atrás.
    { value: 'programado', label: 'Programado', variant: 'chart-4' },
    { value: 'publicado',  label: 'Publicado',  variant: 'chart-9' },
];

/** Los estados que vienen después de aprobar: los mueve el diseñador. */
export const ESTADOS_DE_SALIDA = ['programado', 'publicado'];

/** Los estados que el diseñador mueve a mano. */
export const ESTADOS_DEL_DISENADOR = ['pendiente', 'en_proceso', 'finalizado'];

export const ESTADOS_MES = {
    planificando: { label: 'Planificando', variant: 'neutral', texto: 'El diseñador está armando el mes. Se ve el avance; los diseños, cuando lo envíe a revisión.' },
    en_revision:  { label: 'En revisión',  variant: 'info',    texto: 'El calendario está listo para revisar: comenta cada pieza, pide cambios o apruébalo.' },
    con_cambios:  { label: 'Con cambios',  variant: 'warning', texto: 'Se pidieron cambios. Cuando estén hechos, el diseñador lo vuelve a enviar.' },
    aprobado:     { label: 'Aprobado',     variant: 'success', texto: 'El calendario está aprobado para publicar.' },
};

export const PRIORIDADES = [
    { value: 'normal',  label: 'Normal',  variant: 'neutral' },
    { value: 'alta',    label: 'Alta',    variant: 'warning' },
    { value: 'urgente', label: 'Urgente', variant: 'danger' },
];

export const ESTADOS_SOLICITUD = [
    { value: 'nueva',     label: 'Nueva',     variant: 'info' },
    { value: 'aceptada',  label: 'Aceptada',  variant: 'chart-3' },
    { value: 'entregada', label: 'Entregada', variant: 'success' },
    { value: 'rechazada', label: 'Rechazada', variant: 'neutral' },
];

/** Objetivos de pauta. Deben coincidir con el CHECK de `marketing_pautas.objetivo`. */
export const OBJETIVOS_PAUTA = [
    { value: 'alcance',     label: 'Alcance' },
    { value: 'interaccion', label: 'Interacción' },
    { value: 'mensajes',    label: 'Mensajes' },
    { value: 'trafico',     label: 'Tráfico' },
    { value: 'ventas',      label: 'Ventas' },
    { value: 'seguidores',  label: 'Seguidores' },
];

const porValor = (lista) => Object.fromEntries(lista.map((x) => [x.value, x]));
const FORMATO = porValor([...FORMATOS, ...FORMATOS_IMPRESOS]);
const PILAR = porValor(PILARES);
const ESTADO = porValor(ESTADOS_PIEZA);
const PRIORIDAD = porValor(PRIORIDADES);
const ESTADO_SOL = porValor(ESTADOS_SOLICITUD);
const OBJETIVO = porValor(OBJETIVOS_PAUTA);

// Un código que la lista no conoce se muestra tal cual y no se cae: es la falla
// segura para un dato escrito por una versión más nueva de la pantalla.
const de = (mapa, v) => mapa[v] || { value: v, label: v || '—', variant: 'neutral' };
export const formatoDe = (v) => de(FORMATO, v);
export const pilarDe = (v) => de(PILAR, v);
export const estadoDe = (v) => de(ESTADO, v);
export const prioridadDe = (v) => de(PRIORIDAD, v);
export const estadoSolicitudDe = (v) => de(ESTADO_SOL, v);
export const objetivoDe = (v) => de(OBJETIVO, v);

/** El primer día del mes `YYYY-MM`, como lo guarda `marketing_meses.mes`. */
export const primerDia = (mes) => `${String(mes).slice(0, 7)}-01`;

/**
 * Las semanas del mes para la grilla, lunes primero. Cada celda es `null`
 * (relleno) o la fecha `YYYY-MM-DD`. Se calcula con fechas UTC para que el
 * huso del navegador no corra un día.
 */
export function semanasDelMes(mes) {
    const [a, m] = String(mes).slice(0, 7).split('-').map(Number);
    const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const desfase = (new Date(Date.UTC(a, m - 1, 1)).getUTCDay() + 6) % 7;
    const celdas = Array(desfase).fill(null);
    for (let d = 1; d <= dias; d++) celdas.push(`${String(mes).slice(0, 7)}-${String(d).padStart(2, '0')}`);
    while (celdas.length % 7) celdas.push(null);
    const semanas = [];
    for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
    return semanas;
}

export const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Las piezas agrupadas por fecha, en orden de hora. */
export function piezasPorDia(piezas) {
    const mapa = {};
    for (const p of piezas || []) (mapa[p.fecha] ||= []).push(p);
    for (const k of Object.keys(mapa)) {
        mapa[k].sort((x, y) => String(x.hora || '99').localeCompare(String(y.hora || '99')));
    }
    return mapa;
}

/** El avance del mes: cuántas piezas hay en cada estado y qué falta. */
export function resumenDelMes(piezas) {
    const lista = piezas || [];
    const por = Object.fromEntries(ESTADOS_PIEZA.map((e) => [e.value, 0]));
    for (const p of lista) por[p.estado] = (por[p.estado] || 0) + 1;
    const total = lista.length;
    const listas = por.finalizado + por.aprobado + por.programado + por.publicado;
    return {
        total,
        por,
        listas,
        avance: total ? listas / total : 0,
        abiertas: por.pendiente + por.en_proceso + por.cambios,
        pautadas: lista.filter((p) => p.pautar).length,
    };
}

/** Cuántas piezas hay por formato y por pilar: la mezcla del mes. */
export function mezclaDelMes(piezas) {
    const formatos = {};
    const pilares = {};
    for (const p of piezas || []) {
        formatos[p.formato] = (formatos[p.formato] || 0) + 1;
        if (p.pilar) pilares[p.pilar] = (pilares[p.pilar] || 0) + 1;
    }
    return { formatos, pilares };
}

const n = (v) => (v == null || v === '' ? 0 : Number(v) || 0);

/**
 * Los totales de la pauta. El costo por resultado sólo se calcula con algo
 * gastado Y algún resultado: dividir por cero, o un gasto sin resultados
 * anotados todavía, daría un número que parece una medición y no lo es.
 */
export function totalesDePauta(pautas, presupuestoMes = 0) {
    const t = { presupuesto: 0, gastado: 0, alcance: 0, impresiones: 0, interacciones: 0, mensajes: 0, clics: 0, conResultado: 0 };
    for (const p of pautas || []) {
        t.presupuesto += n(p.presupuesto);
        t.gastado += n(p.gastado);
        t.alcance += n(p.alcance);
        t.impresiones += n(p.impresiones);
        t.interacciones += n(p.interacciones);
        t.mensajes += n(p.mensajes);
        t.clics += n(p.clics);
        if (p.gastado != null) t.conResultado += 1;
    }
    t.presupuestoMes = n(presupuestoMes);
    t.disponible = t.presupuestoMes - t.presupuesto;
    t.costoPorMensaje = t.gastado > 0 && t.mensajes > 0 ? t.gastado / t.mensajes : null;
    t.costoPorClic = t.gastado > 0 && t.clics > 0 ? t.gastado / t.clics : null;
    t.cpm = t.gastado > 0 && t.impresiones > 0 ? (t.gastado / t.impresiones) * 1000 : null;
    return t;
}

/** ¿Es imagen o video? Decide cómo se muestra la vista previa. */
export function tipoDeArchivo(archivo) {
    const mime = String(archivo?.mime || '');
    if (mime.startsWith('image/')) return 'imagen';
    if (mime.startsWith('video/')) return 'video';
    if (mime === 'application/pdf') return 'pdf';
    return archivo?.enlace ? 'enlace' : 'otro';
}

/** Texto para buscar una pieza por lo que dice. */
export function textoDePieza(p, marcas = {}) {
    return [p.titulo, p.copy, p.hashtags, p.notas, formatoDe(p.formato).label,
        pilarDe(p.pilar).label, marcas[p.marca_id]?.nombre].filter(Boolean).join(' ');
}

// ── Fechas especiales ───────────────────────────────────────────────────────
// Las fijas traen mes y día; las que se mueven, una regla que se calcula acá.

/** Domingo de Pascua (algoritmo anónimo gregoriano), como `YYYY-MM-DD`. */
export function domingoDePascua(anio) {
    const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

const masDias = (iso, n) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};

/** El viernes después del cuarto jueves de noviembre. */
function blackFriday(anio) {
    const primero = new Date(Date.UTC(anio, 10, 1)).getUTCDay();   // 0 = domingo
    const primerJueves = 1 + ((4 - primero + 7) % 7);
    return `${anio}-11-${String(primerJueves + 21 + 1).padStart(2, '0')}`;
}

const POR_REGLA = {
    jueves_santo:  (a) => masDias(domingoDePascua(a), -3),
    viernes_santo: (a) => masDias(domingoDePascua(a), -2),
    black_friday:  blackFriday,
};

/** La fecha (`YYYY-MM-DD`) de una fecha especial en un año, o `null`. */
export function fechaEspecialEn(f, anio) {
    if (f.regla) return POR_REGLA[f.regla]?.(anio) || null;
    if (!f.mes || !f.dia) return null;
    const ultimo = new Date(Date.UTC(anio, f.mes, 0)).getUTCDate();
    if (f.dia > ultimo) return null;
    return `${anio}-${String(f.mes).padStart(2, '0')}-${String(f.dia).padStart(2, '0')}`;
}

/** Las fechas especiales activas que caen en el mes `YYYY-MM`, por día. */
export function fechasEspecialesDelMes(lista, mes) {
    const anio = Number(String(mes).slice(0, 4));
    const porDia = {};
    for (const f of lista || []) {
        if (!f.activo) continue;
        const d = fechaEspecialEn(f, anio);
        if (d && d.slice(0, 7) === String(mes).slice(0, 7)) (porDia[d] ||= []).push({ ...f, fecha: d });
    }
    return porDia;
}

// ── El efecto en ventas ─────────────────────────────────────────────────────

/**
 * La variación entre «durante» y «antes» de `marketing_efecto_en_ventas`.
 * Sin ventas antes no hay porcentaje honesto (dividir por cero): se dice
 * «sin ventas antes» y la pantalla muestra sólo lo vendido.
 */
export function variacionDeVentas(efecto) {
    if (!efecto?.durante || !efecto?.antes) return null;
    const antes = Number(efecto.antes.monto) || 0;
    const durante = Number(efecto.durante.monto) || 0;
    return {
        antes, durante,
        unidadesAntes: Number(efecto.antes.unidades) || 0,
        unidadesDurante: Number(efecto.durante.unidades) || 0,
        pct: antes > 0 ? ((durante - antes) / antes) * 100 : null,
    };
}

// ── El historial de una pieza ───────────────────────────────────────────────

/** La frase de un evento de `marketing_historial`, sin el nombre de quién. */
export function fraseDeHistorial(h) {
    switch (h.evento) {
        case 'creada':          return 'creó la pieza';
        case 'estado':          return `la pasó a ${estadoDe(h.a).label}`;
        case 'fecha':           return `la movió del ${String(h.de).slice(8, 10)}/${String(h.de).slice(5, 7)} al ${String(h.a).slice(8, 10)}/${String(h.a).slice(5, 7)}`;
        case 'archivo':         return `subió ${h.a ? `«${h.a}»` : 'un diseño'}`;
        case 'archivo_quitado': return `quitó ${h.a ? `«${h.a}»` : 'un diseño'}`;
        case 'quitada':         return `quitó «${h.titulo}» del calendario`;
        default:                return h.evento;
    }
}

/** El último cambio de cada pieza, por id. `historial` viene del más nuevo al más viejo. */
export function ultimoCambioPorPieza(historial) {
    const m = {};
    for (const h of historial || []) if (h.pieza_id && !m[h.pieza_id]) m[h.pieza_id] = h;
    return m;
}

/** ¿Es de esta marca? Una pieza puede ser de varias (`marcas`). */
export const esDeMarca = (pieza, marcaId) =>
    (pieza.marcas?.length ? pieza.marcas : [pieza.marca_id]).some((m) => String(m) === String(marcaId));

/** Lo asignado en pauta en el mes, sin contar una pieza (la que se edita). */
export function asignadoEnPauta(piezas, exceptoId = null) {
    return (piezas || []).reduce((t, p) => (p.id !== exceptoId && p.pauta ? t + (Number(p.pauta.presupuesto) || 0) : t), 0);
}
