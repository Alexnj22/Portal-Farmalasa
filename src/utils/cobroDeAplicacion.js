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
/**
 * «05/2027», «5-2027» o «05/27» (como se lee en la ampolla) → '2027-05'; lo
 * demás, tal cual. El año de dos dígitos es el que más se imprime: sin
 * reconocerlo, «02/28» se comparaba como texto contra la fecha de hoy y salía
 * VENCIDA una ampolla que vence en 2028.
 */
export function venceNormal(v) {
    const t = String(v || '').trim();
    const m = /^(\d{1,2})\s*[/-]\s*(\d{2}|\d{4})$/.exec(t);
    if (!m) return t;
    const anio = m[2].length === 2 ? `20${m[2]}` : m[2];
    return `${anio}-${m[1].padStart(2, '0')}`;
}
const LOTES_QUE_NO_SON = ['GENERICO', 'GENÉRICO', 'SIN LOTE', 'N/A', 'NA'];
/** @param {{ lote?: string, vence?: string, parecido?: { lote: string, vence: string } | null }} [valor] */
export function motivoDelLote({ lote, vence, parecido } = {}, hoy = hoySV()) {
    const l = String(lote || '').trim().toUpperCase();
    if (!l || LOTES_QUE_NO_SON.includes(l)) return 'Falta el lote impreso en la ampolla.';
    if (l.length < 2 || l.length > 30) return 'Ese lote no parece un lote.';
    const v = venceNormal(vence);
    if (!v) return 'Falta el vencimiento de la ampolla.';
    const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(v);
    // Lo que no es un mes no se compara: como texto, cualquier cosa que empiece
    // con «0» o «1» sale «vencida».
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return 'Escribe el vencimiento como MM/AA.';
    const fin = v.length === 7 ? `${v}-31` : v;   // un mes vale hasta su último día
    if (fin < String(hoy)) return 'La ampolla está vencida: no se puede aplicar.';
    // Lo pone la pantalla al comparar con los lotes ya vistos (`loteParecido`):
    // hasta que la caja elige el conocido o confirma que es otro, no se cobra.
    if (parecido) return `¿Es el lote ${parecido.lote}? Confirma antes de cobrar.`;
    return null;
}

/**
 * ¿El lote escrito es uno ya conocido con un error de tecleo? (usuario,
 * 2026-10-29: «que no se agreguen múltiples lotes que sean el mismo con
 * errores»). Devuelve el conocido al que se parece, o `null` si es idéntico a
 * uno o no se parece a ninguno. Parecido es:
 *   · iguales sin espacios/guiones/puntos y con O→0, I/L→1 (lo que se confunde
 *     leyendo una ampolla);
 *   · uno es el comienzo del otro (se cortó: «M55» por «M55895»);
 *   · a una tecla de distancia (cambiada, de más o de menos) desde 4 caracteres;
 *   · el mismo lote con OTRO vencimiento (un lote tiene un solo vencimiento).
 * No frena para siempre: la caja confirma «es otro lote» (`nuevo: true`).
 * @param {{ lote?: string, vence?: string }} valor
 * @param {{ lote: string, vence: string }[]} conocidos
 */
export function loteParecido({ lote, vence } = {}, conocidos = []) {
    const l = String(lote || '').trim().toUpperCase();
    if (l.length < 2 || !conocidos.length) return null;
    const v = venceNormal(vence);
    const exacto = conocidos.find((c) => c.lote === l);
    if (exacto) {
        const mismoMes = !/^\d{4}-\d{2}$/.test(v) || conocidos.some((c) => c.lote === l && c.vence === v);
        return mismoMes ? null : exacto;
    }
    const plano = (x) => x.replace(/[\s.\-_/]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    const p = plano(l);
    return conocidos.find((c) => {
        const q = plano(c.lote);
        if (p === q) return true;
        if (Math.min(p.length, q.length) >= 3 && (q.startsWith(p) || p.startsWith(q))) return true;
        return Math.min(p.length, q.length) >= 4 && aUnaTecla(p, q);
    }) || null;
}

/** Distancia de edición ≤ 1 (incluye dos letras vecinas cambiadas de lugar). */
function aUnaTecla(a, b) {
    if (a === b) return false;
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a.length === b.length) {
        const dif = [...a].map((ch, i) => (ch !== b[i] ? i : -1)).filter((i) => i >= 0);
        return dif.length === 1 || (dif.length === 2 && dif[1] === dif[0] + 1 && a[dif[0]] === b[dif[1]] && a[dif[1]] === b[dif[0]]);
    }
    const [c, l] = a.length < b.length ? [a, b] : [b, a];
    for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === c) return true;
    return false;
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
export function cuentaDelCobro({ modo, precios, items, mezcla, veces, cantidad, aplicarAhora, aNombreDe, venta, producto, sala, ficha, loteTraida, lotes = {} }) {
    const origen = modo === 'TRAIDA' ? 'TRAIDA' : 'COMPRADA';
    const precio = precios ? (origen === 'TRAIDA' ? precios.TRAIDA : precios.COMPRADA) : null;
    const faltaDosis = (items || []).some((i) => 'dosis_ml' in i && i.dosis_ml == null);
    const faltaLote = origen === 'TRAIDA'
        ? motivoDelLote(loteTraida) !== null
        // `parecido` vive en el estado de la pantalla, no en lo que viaja al servidor.
        : (items || []).some((i) => 'lote' in i && motivoDelLote({ ...i, parecido: lotes[i.linea_num]?.parecido }) !== null);
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
