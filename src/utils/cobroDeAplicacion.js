// Cobrar la aplicación de una inyección: qué se cobra, cuánto, y qué se manda.
// Vivía dentro de `components/caja/DialogoAplicacion.jsx` (el porqué de cada
// regla sigue allá); acá para que el portal y la app cobren con la MISMA cuenta.
// El monto NO se escribe: sale de las aplicaciones por el precio vigente, y el
// servidor lo vuelve a calcular y frena si cambió.
import { esPorMl, saldoDelRenglon } from './inyeccionDosis';
import { hoySV } from './fecha';

/**
 * Lote y vencimiento de la ampolla (PENDIENTES 20, usuario 2026-10-28: obligatorio).
 * Se piden cuando nada más los dice: la inyección que TRAJO el cliente, y la
 * comprada cuyo renglón de la factura dice «GENERICO» o viene vacío (el
 * servidor marca esos renglones con `pide_lote`). Las mismas reglas que
 * `inyeccion_lote_valido` en la base, que es la que decide: acá sólo se avisan
 * antes de apretar «Cobrar». El vencimiento es el MES impreso en la ampolla
 * ('2027-05') y vale hasta su último día.
 */
export const LOTE_VACIO = { lote: '', vence: '' };
/** «05/2027» o «5-2027» (como se lee en la ampolla) → '2027-05'; lo demás, tal cual. */
export function venceNormal(v) {
    const t = String(v || '').trim();
    const m = /^(\d{1,2})[/-](\d{4})$/.exec(t);
    return m ? `${m[2]}-${m[1].padStart(2, '0')}` : t;
}
const LOTES_QUE_NO_SON = ['GENERICO', 'GENÉRICO', 'SIN LOTE', 'N/A', 'NA'];
/** @param {{ lote?: string, vence?: string }} [valor] */
export function motivoDelLote({ lote, vence } = {}, hoy = hoySV()) {
    const l = String(lote || '').trim().toUpperCase();
    if (!l || LOTES_QUE_NO_SON.includes(l)) return 'Falta el lote impreso en la ampolla.';
    if (l.length < 2 || l.length > 30) return 'Ese lote no parece un lote.';
    const v = venceNormal(vence);
    if (!v) return 'Falta el vencimiento de la ampolla.';
    const m = /^(\d{4})-(\d{2})$/.exec(v);
    const fin = m ? `${m[1]}-${m[2]}-31` : v;   // un mes vale hasta su último día
    if (fin < String(hoy)) return 'La ampolla está vencida: no se puede aplicar.';
    return null;
}

/** El nombre de mostrador no sirve para reclamar una pendiente. */
export const esClienteGenerico = (n) => !n || /^(CLIENTES? VARIOS|CLIENTE FRECUENTE|CONSUMIDOR FINAL)/i.test(String(n).trim());

/** Lo que se marca al elegir una venta: una sola inyección con saldo ya va en 1; la dosis conocida se pone. */
export function seleccionDeVenta(v) {
    const conSaldo = (v?.renglones || []).filter((r) => r.disponibles > 0);
    return {
        cuantas: conSaldo.length === 1 ? { [conSaldo[0].linea_num]: 1 } : {},
        dosis: Object.fromEntries((v?.renglones || []).filter(esPorMl).map((r) => [r.linea_num,
            r.dosis_ml != null ? Number(r.dosis_ml) : (r.opciones_ml?.length === 1 ? Number(r.opciones_ml[0]) : null)])),
        enMezcla: new Set(conSaldo.map((r) => r.linea_num)),
        aNombreDe: esClienteGenerico(v?.cliente) ? '' : v.cliente,
    };
}

/** Cuántas veces se puede aplicar la mezcla: lo que alcance del que menos tenga. */
export function topeDeMezcla(enMezcla, renglonDe, dosis) {
    const sal = [...(enMezcla || [])].map((l) => saldoDelRenglon(renglonDe(l) || {}, dosis[l]));
    return sal.length && sal.every(Boolean) ? Math.min(...sal.map((x) => x.disponibles)) : 0;
}

/** Los renglones que viajan al cobro (con su dosis si son por ml). */
export function itemsDelCobro({ mezcla, enMezcla, veces, cuantas, ventaId, dosis, renglonDe, lotes = {} }) {
    const conDosis = (linea, n, extra) => {
        const r = renglonDe(linea);
        return {
            invoice_id: ventaId, linea_num: Number(linea), cantidad: n, ...extra,
            ...(esPorMl(r) ? { dosis_ml: dosis[linea] ?? null } : {}),
            // La factura no identifica la ampolla: viaja lo que escribió la caja.
            ...(r?.pide_lote ? { lote: String(lotes[linea]?.lote || '').trim().toUpperCase(), vence: venceNormal(lotes[linea]?.vence) } : {}),
        };
    };
    if (mezcla) {
        return veces > 0 && enMezcla.size >= 2
            ? [...enMezcla].sort((a, b) => a - b).map((l) => conDosis(l, veces, { mezcla: true })) : [];
    }
    return Object.entries(cuantas || {}).filter(([, n]) => n > 0).map(([linea, n]) => conDosis(linea, n));
}

/**
 * La cuenta del cobro: origen, precio, cuántas aplicaciones, monto, cuántas
 * quedan pendientes a nombre del cliente y si se puede cobrar.
 */
/**
 * La traída exige FICHA (2026-10-28, «unas están sin nombre, eso no puede
 * pasar»): sin ella la aplicación no tiene a quién pertenecer. Si el cliente
 * no tiene, se le crea en el mismo diálogo.
 */
export function cuentaDelCobro({ modo, precios, items, mezcla, veces, cantidad, aplicarAhora, aNombreDe, venta, producto, sala, ficha, loteTraida }) {
    const origen = modo === 'TRAIDA' ? 'TRAIDA' : 'COMPRADA';
    const precio = precios ? (origen === 'TRAIDA' ? precios.TRAIDA : precios.COMPRADA) : null;
    const faltaDosis = (items || []).some((i) => 'dosis_ml' in i && i.dosis_ml == null);
    const faltaLote = origen === 'TRAIDA'
        ? motivoDelLote(loteTraida) !== null
        : (items || []).some((i) => 'lote' in i && motivoDelLote(i) !== null);
    const total = origen === 'COMPRADA'
        ? (mezcla ? ((items || []).length ? veces : 0) : (items || []).reduce((s, i) => s + i.cantidad, 0))
        : cantidad;
    const monto = precio != null ? Math.round(precio * total * 100) / 100 : null;
    const ahora = Math.min(aplicarAhora, total);
    const quedan = total - ahora;
    const valido = precio != null && total > 0 && !!sala && !faltaLote && (
        origen === 'COMPRADA' ? !!venta && (items || []).length > 0 && !faltaDosis
            : String(producto || '').trim().length > 2 && !!ficha?.id
    ) && (quedan === 0 || String(aNombreDe || '').trim().length >= 3);
    const faltaFicha = origen === 'TRAIDA' && !ficha?.id;
    return { origen, precio, faltaDosis, faltaFicha, faltaLote, total, monto, ahora, quedan, valido };
}

/** Lo que se manda a `anotarIngreso` como `aplicacion`. */
export function aplicacionDelCobro({ origen, items, producto, cantidad, ahora, quedan, aNombreDe, ficha, loteTraida }) {
    return {
        origen,
        ...(origen === 'COMPRADA' ? { items } : {
            producto: String(producto).trim(), cantidad,
            lote: String(loteTraida?.lote || '').trim().toUpperCase(), vence: venceNormal(loteTraida?.vence),
        }),
        aplicar_ahora: ahora,
        cliente: quedan > 0 ? String(aNombreDe).trim() : (ficha ? ficha.name : null),
        ...(origen === 'TRAIDA' && ficha ? { customer_id: ficha.id } : {}),
    };
}

/** Las pendientes agrupadas por cobro, producto y dosis: se canjean de a varias. */
export function gruposDePendientes(pendientes) {
    const m = new Map();
    for (const p of pendientes || []) {
        const k = `${p.cobro_id}|${p.producto}|${p.dosis_ml ?? ''}`;
        if (!m.has(k)) m.set(k, { clave: k, muestra: p, ids: [] });
        m.get(k).ids.push(p.id);
    }
    return [...m.values()];
}
