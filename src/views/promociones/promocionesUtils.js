import { formatMoney, formatQty } from '../../utils/formatNumber';

/**
 * Promociones — lo que comparten las pestañas.
 *
 * Vive acá y no repartido en cada archivo porque la misma pregunta contestada
 * en dos sitios termina dando dos respuestas: es la lección de `turnoDelDia`.
 */

/** Hoy en El Salvador. A las 9 pm no dice que ya es mañana. */
export const hoySV = () =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/El_Salvador',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

// El formateador del portal, no `toLocaleString` a mano: un locale escrito en
// cada archivo es cómo dos pantallas terminan mostrando el mismo número con
// separadores distintos.
export const fmtMoneda   = (n) => formatMoney(Number(n) || 0);
export const fmtUnidades = (n) => formatQty(Number(n) || 0);

/** «1 sep – 30 sep 2026». Sin hora: son fechas, no instantes. */
export function fmtVigencia(inicio, fin) {
    if (!inicio || !fin) return '—';
    const d = (s) => {
        const [y, m, dd] = String(s).split('-').map(Number);
        // Se construye con componentes y no con `new Date(s)`: una fecha sin
        // hora leída como UTC retrocede un día en El Salvador.
        return new Date(y, m - 1, dd);
    };
    const f = (dt, conAnio) => new Intl.DateTimeFormat('es-SV', {
        day: 'numeric', month: 'short', ...(conAnio ? { year: 'numeric' } : {}),
    }).format(dt);
    const a = d(inicio), b = d(fin);
    return `${f(a, a.getFullYear() !== b.getFullYear())} – ${f(b, true)}`;
}

/** Cuántos días le quedan a una vigencia. Negativo si ya venció. */
export function diasRestantes(fin) {
    if (!fin) return null;
    const [y, m, d] = String(fin).split('-').map(Number);
    const [hy, hm, hd] = hoySV().split('-').map(Number);
    return Math.round((new Date(y, m - 1, d) - new Date(hy, hm - 1, hd)) / 86400000);
}

/**
 * El estado que se PINTA, que no es siempre el que guarda la base: «por vencer»
 * no es un estado almacenado, es una lectura de la fecha. Guardarlo obligaría a
 * un proceso que lo mantenga al día y a que alguien lo mire cuando se atrase.
 */
export function estadoVisible(promo) {
    if (promo?.estado === 'finalizada') return { clave: 'finalizada', rotulo: 'Terminada', variant: 'neutral' };
    if (promo?.estado === 'borrador')   return { clave: 'borrador',   rotulo: 'Borrador',  variant: 'neutral' };
    const dias = diasRestantes(promo?.fin);
    if (dias !== null && dias < 0)  return { clave: 'vencida',    rotulo: 'Vencida',    variant: 'warning' };
    if (dias !== null && dias <= 7) return { clave: 'por_vencer', rotulo: 'Por vencer', variant: 'warning' };
    return { clave: 'activa', rotulo: 'Activa', variant: 'success' };
}

/** El rótulo de la presentación de un renglón. NULL = cualquiera. */
export const rotuloPresentacion = (factor, etiqueta) =>
    factor == null
        ? 'Cualquier presentación'
        : (etiqueta || `×${factor}`);

/**
 * El motivo del cierre, en palabras del negocio. La base guarda la clave; la
 * pantalla nunca la muestra cruda.
 */
export const MOTIVO_CIERRE = {
    lote_agotado:     'Se vendió el lote',
    fin_de_vigencia:  'Se cumplió la fecha',
};

/** Agrupa los renglones por laboratorio, que es como se leen. */
export function porLaboratorio(renglones = []) {
    const mapa = new Map();
    for (const r of renglones) {
        const k = r.laboratorio || 'Sin laboratorio';
        if (!mapa.has(k)) mapa.set(k, []);
        mapa.get(k).push(r);
    }
    return [...mapa.entries()]
        .map(([laboratorio, items]) => ({ laboratorio, items }))
        .sort((a, b) => a.laboratorio.localeCompare(b.laboratorio, 'es'));
}

/** El texto que busca la barra: nombre, laboratorio y productos. */
export const textoBuscable = (p) => [
    p.nombre, p.nota,
    ...(Array.isArray(p.laboratorios) ? p.laboratorios : []),
].filter(Boolean).join(' ').toLowerCase();
