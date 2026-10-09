// Cobrar la aplicación de una inyección: qué se cobra, cuánto, y qué se manda.
// Vivía dentro de `components/caja/DialogoAplicacion.jsx` (el porqué de cada
// regla sigue allá); acá para que el portal y la app cobren con la MISMA cuenta.
// El monto NO se escribe: sale de las aplicaciones por el precio vigente, y el
// servidor lo vuelve a calcular y frena si cambió.
import { esPorMl, saldoDelRenglon } from './inyeccionDosis';

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
export function itemsDelCobro({ mezcla, enMezcla, veces, cuantas, ventaId, dosis, renglonDe }) {
    const conDosis = (linea, n, extra) => {
        const r = renglonDe(linea);
        return {
            invoice_id: ventaId, linea_num: Number(linea), cantidad: n, ...extra,
            ...(esPorMl(r) ? { dosis_ml: dosis[linea] ?? null } : {}),
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
export function cuentaDelCobro({ modo, precios, items, mezcla, veces, cantidad, aplicarAhora, aNombreDe, venta, producto, sala }) {
    const origen = modo === 'TRAIDA' ? 'TRAIDA' : 'COMPRADA';
    const precio = precios ? (origen === 'TRAIDA' ? precios.TRAIDA : precios.COMPRADA) : null;
    const faltaDosis = (items || []).some((i) => 'dosis_ml' in i && i.dosis_ml == null);
    const total = origen === 'COMPRADA'
        ? (mezcla ? ((items || []).length ? veces : 0) : (items || []).reduce((s, i) => s + i.cantidad, 0))
        : cantidad;
    const monto = precio != null ? Math.round(precio * total * 100) / 100 : null;
    const ahora = Math.min(aplicarAhora, total);
    const quedan = total - ahora;
    const valido = precio != null && total > 0 && !!sala && (
        origen === 'COMPRADA' ? !!venta && (items || []).length > 0 && !faltaDosis : String(producto || '').trim().length > 2
    ) && (quedan === 0 || String(aNombreDe || '').trim().length >= 3);
    return { origen, precio, faltaDosis, total, monto, ahora, quedan, valido };
}

/** Lo que se manda a `anotarIngreso` como `aplicacion`. */
export function aplicacionDelCobro({ origen, items, producto, cantidad, ahora, quedan, aNombreDe, ficha }) {
    return {
        origen,
        ...(origen === 'COMPRADA' ? { items } : { producto: String(producto).trim(), cantidad }),
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
