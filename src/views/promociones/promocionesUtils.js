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

// ─────────────────────────────────────────────────────────────────────────────
// El tipo LABORATORIO — el mes es su unidad
// ─────────────────────────────────────────────────────────────────────────────

/**
 * «agosto de 2026» a partir de «2026-08». Sin día: el programa es del mes entero.
 *
 * El patrón es el MISMO que el CHECK de la base (`(0[1-9]|1[0-2])`) y no un
 * `\d{2}` suelto: con el suelto, «2026-13» pasaba y `new Date(2026, 12, 1)`
 * rueda a enero de 2027. O sea que la pantalla nombraba con toda confianza un
 * mes que nadie había pedido, y del año siguiente.
 */
export function rotuloMes(ym) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || ''))) return '—';
    const [y, m] = String(ym).split('-').map(Number);
    // Con componentes y no con `new Date('2026-08')`, que se lee como UTC y en
    // El Salvador retrocede al mes anterior.
    return new Intl.DateTimeFormat('es-SV', { month: 'long', year: 'numeric' })
        .format(new Date(y, m - 1, 1));
}

/**
 * Los meses que se pueden elegir: el siguiente, el actual y los anteriores.
 *
 * El siguiente entra porque un programa se negocia ANTES de que empiece el mes;
 * los anteriores, porque esto es retroactivo — cargar agosto en septiembre
 * calcula agosto completo con las ventas que ya están.
 *
 * ⚠️ El signo del paso importa y ya se equivocó una vez: con `i--` la lista
 * arrancaba en el mes anterior y seguía hacia ADELANTE, ofreciendo doce meses
 * que todavía no existen. No falla nada —son cadenas AAAA-MM válidas— y el
 * único síntoma fue que la liquidación se armó del mes que no era. Por eso lo
 * fija `tests/unit/promocionesUtils.test.js` con una fecha congelada.
 */
export function mesesRecientes(cuantos = 13) {
    const [y, m] = hoySV().split('-').map(Number);
    const out = [];
    for (let i = -1; i < cuantos - 1; i++) {
        const d = new Date(y, m - 1 - i, 1);
        const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        out.push({ value, label: rotuloMes(value) });
    }
    return out;
}

/**
 * El mes anterior al de hoy, en AAAA-MM.
 *
 * Existe para que nadie lo saque de una POSICIÓN de `mesesRecientes`: un
 * `meses[1]` se lee como «el anterior» y deja de serlo el día que la lista
 * cambia de orden, que es exactamente lo que pasó.
 */
export function mesAnterior() {
    const [y, m] = hoySV().split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** El resumen de una promoción de laboratorio para la tarjeta. */
export const esLaboratorio = (p) => p?.tipo === 'laboratorio';

/**
 * En cuánto queda UNA unidad con un descuento aplicado.
 *
 * ⚠️ Esta fórmula está dicha DOS veces —acá y en la edge function
 * `descuentos-erp`, que la vuelve a aplicar al guardar— y se mueven juntas. La
 * de acá es para VER mientras se arma el descuento; la del servidor es la que
 * decide, porque un formulario se saltea cambiando el cuerpo de la petición.
 *
 * Y es la del sistema de la caja, medida, no una interpretación: el porcentaje
 * se aplica al renglón y el monto se descuenta **por cada unidad**
 * (`subtotal -= monto × cantidad`). Por eso acá se razona sobre UNA unidad —
 * multiplicar por la cantidad es exactamente lo que hace la venta.
 */
export function precioConDescuento(precio, tipo, monto) {
    const p = Number(precio) || 0;
    const m = Number(monto) || 0;
    return tipo === '%' ? p * (1 - m / 100) : p - m;
}

/**
 * Lo que hay que mandarle a `guardarDescuento`, derivado de la promoción.
 *
 * Vive acá y no en el modal para que el cálculo de la ventana —el `min` de los
 * inicios y el `max` de los fines— esté escrito UNA vez: dicho dos veces, el
 * día que se cambie una de las dos el descuento cubriría un tramo distinto que
 * la promoción y nadie lo vería, porque ninguna de las dos pantallas muestra la
 * otra.
 */
export function descuentoDesdeLaPromocion(renglones, valor) {
    const productos = [...new Set(renglones.map((r) => r.erp_product_id))];
    const inicios = renglones.map((r) => r.inicio).filter(Boolean).sort();
    const fines = renglones.map((r) => r.fin).filter(Boolean).sort();
    return {
        id: 0,
        tipo: valor.tipo || '%',
        monto: Number(valor.monto),
        inicio: inicios[0] || '',
        fin: fines[fines.length - 1] || valor.finPropio || '',
        /* La SALA la decide quien llama, no esto: una promoción marcada en tres
           salas manda tres veces con distinta sala. Ver `mandarDescuento`. */
        productos,
    };
}

/** Lo que impide guardar el descuento, dicho antes de intentarlo. */
export function problemasDelDescuento(renglones, valor, alcanceTodo) {
    if (!valor.activo) return [];
    const l = [];
    const monto = Number(valor.monto);
    const hayFin = renglones.some((r) => r.fin);
    if (!renglones.length) l.push('Agrega los productos antes de ponerle descuento.');
    if (!Number.isFinite(monto) || monto <= 0) l.push('El descuento tiene que ser mayor que cero.');
    if (valor.tipo === '%' && monto > 100) l.push('Un porcentaje no puede pasar de 100.');
    if (!hayFin && !valor.finPropio) l.push('Dile hasta cuándo descuenta.');
    if (alcanceTodo && !valor.todas && !valor.branchId) l.push('Elige la sala del descuento.');
    return l;
}
