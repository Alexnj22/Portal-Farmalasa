// El lote de cada renglón de la venta: primero vence, primero sale, y lo que
// no alcanza se reparte SOLO en el siguiente lote, en un renglón aparte.
//
// Pedido del usuario (2026-09-29): «que salga según el vence […] si del lote 1
// hay 1 unidad, y pongo que voy a vender 3, que aparezca / se agregue el
// producto abajo con el siguiente lote disponible. Debe salir también el total
// en stock y por lote.»
//
// Todo aquí es puro (sin React) para poder probarlo: recibe el carrito y
// devuelve otro. La existencia se cuenta en UNIDADES (así se guarda el lote);
// un renglón se mide en PRESENTACIONES (una caja = N unidades), y una
// presentación no se parte entre lotes — igual que `dist_asignar_lotes`.
//
// Lo que decide la pantalla es una PREFERENCIA: la base, al facturar, respeta
// el lote del renglón si todavía alcanza y si no completa con el siguiente
// (borrador 0010). Así una preventa de hace tres días no traba la factura
// porque otra venta se llevó su lote.

const leer = (v) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
};
const redondear = (n) => Math.round(n * 10000) / 10000;

/** Los lotes de cada producto, primero vence primero sale (sin vencimiento al final). */
export function indexarLotes(filas) {
    const m = new Map();
    for (const l of filas ?? []) {
        const k = String(l.product_id);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push({ id: Number(l.id), lote: l.lote, vence: l.vence ?? null, existencia: Number(l.existencia) || 0 });
    }
    for (const lista of m.values()) {
        lista.sort((a, b) => Number(a.vence == null) - Number(b.vence == null) || String(a.vence).localeCompare(String(b.vence)) || a.id - b.id);
    }
    return m;
}

/** Unidades que ocupan en cada lote los renglones del carrito (menos `excepto`). */
export function ocupadasPorLote(carrito, porDe, excepto = null) {
    const m = new Map();
    for (const c of carrito) {
        if (c.clave === excepto || c.lote_id == null) continue;
        const u = leer(c.cantidad) * porDe(c.product_id, c.presentacion);
        m.set(Number(c.lote_id), (m.get(Number(c.lote_id)) ?? 0) + u);
    }
    return m;
}

/** Lo que queda en un lote para un renglón, descontando lo que ya tienen los demás. */
export const libreEn = (lote, ocupadas) => Math.max(0, lote.existencia - (ocupadas.get(lote.id) ?? 0));

/** El primer lote (por vencimiento) donde todavía cabe al menos una presentación. */
export function primerLoteLibre(lotes, ocupadas, por) {
    return (lotes ?? []).find(l => libreEn(l, ocupadas) >= por) ?? null;
}

const mismaClave = (a, b) => a.product_id === b.product_id && a.presentacion === b.presentacion
    && (a.lote_id == null ? b.lote_id == null : Number(a.lote_id) === Number(b.lote_id));

/**
 * Reparte el renglón `clave` entre los lotes de su producto.
 *   · Empieza por su lote (el elegido, o el primero que vence) y, si no
 *     alcanza, sigue con el siguiente por vencimiento.
 *   · Cada tramo extra es un renglón nuevo JUSTO DEBAJO (o se suma al que ya
 *     tenga ese mismo lote: la base no admite dos renglones iguales).
 *   · Lo que no cabe en ningún lote se queda en el último tramo: la pantalla
 *     lo marca «faltan N» y ofrece anotarlo como venta perdida.
 * `ctx`: { lotesDe(productId) → lotes FEFO, porDe(productId, presentacion) → unidades,
 *          nuevo(base, cambios) → renglón nuevo con clave propia }.
 */
export function repartir(carrito, clave, ctx) {
    const i = carrito.findIndex(c => c.clave === clave);
    if (i < 0) return carrito;
    const L = carrito[i];
    const lotes = ctx.lotesDe(L.product_id) ?? [];
    const n = leer(L.cantidad);
    if (!lotes.length || !n) {
        // Sin lotes (sin existencia): el renglón va sin lote.
        return L.lote_id == null ? carrito : carrito.map(c => (c.clave === clave ? { ...c, lote_id: null } : c));
    }
    const por = ctx.porDe(L.product_id, L.presentacion) || 1;
    const otros = carrito.filter(c => c.clave !== clave);
    const ocupadas = ocupadasPorLote(otros, ctx.porDe);

    const propio = lotes.find(l => l.id === Number(L.lote_id));
    const orden = propio ? [propio, ...lotes.filter(l => l !== propio)] : lotes;
    const tramos = [];
    let falta = n;
    for (const l of orden) {
        if (falta <= 0) break;
        const caben = Math.floor(libreEn(l, ocupadas) / por);
        if (caben <= 0) continue;
        const toma = Math.min(falta, caben);
        tramos.push({ lote_id: l.id, cantidad: toma });
        falta = redondear(falta - toma);
    }
    if (falta > 0) {
        if (tramos.length) tramos[tramos.length - 1].cantidad = redondear(tramos[tramos.length - 1].cantidad + falta);
        else tramos.push({ lote_id: propio?.id ?? lotes[0].id, cantidad: n });
    }

    // Arma el carrito: el primer tramo es el renglón mismo; los demás van debajo.
    let res = [...carrito];
    const fijar = (lista, clv, cambios) => lista.map(c => (c.clave === clv ? { ...c, ...cambios } : c));
    let ancla = L.clave;
    tramos.forEach((t, k) => {
        const deseado = { ...L, lote_id: t.lote_id };
        const existente = res.find(c => c.clave !== L.clave && mismaClave(c, deseado));
        if (k === 0) {
            if (existente) {
                // Su lote ya estaba en otro renglón: se juntan y éste desaparece.
                res = fijar(res, existente.clave, { cantidad: String(redondear(leer(existente.cantidad) + t.cantidad)) });
                res = res.filter(c => c.clave !== L.clave);
                ancla = existente.clave;
            } else {
                res = fijar(res, L.clave, { lote_id: t.lote_id, cantidad: String(t.cantidad) });
            }
            return;
        }
        if (existente) {
            res = fijar(res, existente.clave, { cantidad: String(redondear(leer(existente.cantidad) + t.cantidad)) });
            ancla = existente.clave;
        } else {
            const nuevo = ctx.nuevo(L, { lote_id: t.lote_id, cantidad: String(t.cantidad) });
            const pos = res.findIndex(c => c.clave === ancla);
            res = [...res.slice(0, pos + 1), nuevo, ...res.slice(pos + 1)];
            ancla = nuevo.clave;
        }
    });
    return res;
}

/** `repartir` sobre todos los renglones, en orden (al abrir una venta ya armada). */
export function repartirTodo(carrito, ctx) {
    let res = carrito;
    for (const c of carrito) {
        if (res.some(x => x.clave === c.clave)) res = repartir(res, c.clave, ctx);
    }
    return res;
}
