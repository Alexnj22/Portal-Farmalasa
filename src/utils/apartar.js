// Apartar o encargar en el mostrador — las cuentas y las reglas del formulario,
// escritas UNA vez (2026-10-22). Las usan `DialogoApartar` del portal y
// `reserva-anticipo` de la app del personal: con dos copias, una terminaría
// cobrando lo que la otra no deja, o diciendo «se encarga» de lo que ya viene.
//
// Quién decide de verdad es la base (`apartado_cotizar`, `apartado_aplicar`,
// `encargo_*`): esto es lo que la pantalla muestra y frena ANTES de mandar.
//
// Los modos (`modo`):
//   · 'reserva'  → hay en la sala: se aparta 7 días con el precio de hoy;
//   · 'viene'    → no hay, pero ya viene en camino un traslado que nadie apartó:
//                  se aparta sobre ése (o varios), y si no alcanzan el resto se
//                  encarga a Bodega con la misma reserva;
//   · 'traslado' → no hay, pero otra sala lo tiene: se pide y se aparta igual;
//   · 'encargo'  → no hay en ninguna parte: se encarga sin cobrar.
import { estadoDeFormaDePago } from './formaDePago';

export const redondear = (n) => Math.round(Number(n) * 100) / 100;

/** La base acepta encargos de 1 a 20 unidades por producto. */
export const TOPE_ENCARGO = 20;
/** Un apartado de sala va de 1 a 999 unidades. */
export const TOPE_APARTADO = 999;
/** Productos que caben en un mismo pedido o encargo, además del de la pantalla. */
export const TOPE_RENGLONES = 9;

/** La clave estable de una presentación (`tipo|factor|precio`). */
export const clavePresentacion = (p) => (p ? `${p.tipo}|${p.factor}|${p.precio}` : '');

/** Lo que ya viene en camino a la sala y se puede tomar (sin los que ya tomó otro renglón del pedido). */
export function trasladosQueVienen({ opciones, elegida, soloEncargo, apartados }) {
    if (opciones?.modo !== 'encargo' || !elegida || soloEncargo) return [];
    const usados = new Set((apartados ?? []).flatMap((a) => a.enCamino?.traslados_en_camino ?? []));
    return (opciones.en_camino ?? []).filter((v) => !usados.has(v.id));
}

/**
 * Los traslados que cubren la cantidad, en orden. Con `ids` (lo que eligió la
 * persona) se respetan esos; sin `ids`, se sugieren los primeros que alcanzan.
 * Nunca más de los que la cantidad necesita: al bajarla, los que sobran se sueltan.
 */
export function trasladosQueCubren(vienen, unidadesNecesarias, ids = null) {
    const fuente = ids ?? (vienen ?? []).map((v) => v.id);
    const elegidos = []; let u = 0;
    for (const id of fuente) {
        const v = (vienen ?? []).find((x) => x.id === id);
        if (!v || u >= unidadesNecesarias) continue;
        elegidos.push(id); u += Number(v.unidades);
    }
    return elegidos;
}

/** Cuántas (en la presentación elegida) se toman de cada traslado elegido, hasta cubrir la cantidad. */
export function tomaDeCadaTraslado(vienen, elegidos, factor, cantidad) {
    const f = factor || 1;
    const toma = new Map();
    (vienen ?? []).filter((v) => elegidos.includes(v.id)).reduce((resta, v) => {
        toma.set(v.id, Math.min(Math.floor(Number(v.unidades) / f), Math.ceil(Math.max(resta, 0) / f)));
        return resta - Number(v.unidades);
    }, cantidad * f);
    return toma;
}

/**
 * Todo lo que el formulario necesita saber a partir de lo elegido.
 *
 * Entra: `opciones` (de `apartado_opciones`), `producto` `{ id, nombre }`,
 * `elegida` (la presentación `{ tipo, factor, precio }`), `cantidad` (texto o
 * número), `lineas` (lo ya agregado al ENCARGO), `apartados` (lo ya agregado al
 * PEDIDO), `vienenElegidos` (ids, `[]` si se descartó lo que viene, `null` si
 * nadie eligió), `traslado` (`{ branch_id, sala, lista }` o null, de «pedir a
 * otra sala»), `cuanto` ('mitad' | 'todo' | 'otro'), `anticipo` (texto),
 * `pago` (forma de pago), `cobroEn` ('caja' | 'enlace'), y para el formulario
 * completo: `cliente`, `telOk`, `sinCatalogo`, `nombreNuevo`, `srs`,
 * `srsNoAparece`, `errorFoto`.
 */
export function planDeApartar({
    opciones = null, producto = null, elegida = null, cantidad = '1', lineas = [], apartados = [], vienenElegidos = null,
    traslado = null, cuanto = 'mitad', anticipo = '', pago = null, cobroEn = 'caja',
    cliente = null, telOk = false, sinCatalogo = false, nombreNuevo = '', srs = null, srsNoAparece = false, errorFoto = '',
} = {}) {
    const cant = Math.trunc(Number(cantidad)) || 0;
    const total = elegida ? redondear(elegida.precio * cant) : 0;
    // Con productos ya agregados al encargo, el que sigue sólo puede encargarse.
    const soloEncargo = lineas.length > 0;
    // Con productos ya en el pedido, el que sigue se aparta (en sala o en camino).
    const enPedido = apartados.length > 0;

    const vienen = trasladosQueVienen({ opciones, elegida, soloEncargo, apartados });
    const necesita = elegida ? cant * elegida.factor : 0;
    const sugeridos = trasladosQueCubren(vienen, necesita);
    const elegidosIds = trasladosQueCubren(vienen, necesita, vienenElegidos ?? sugeridos);
    const vieneSel = vienen.filter((v) => elegidosIds.includes(v.id));
    const vienenUnidades = elegida ? Math.floor(vieneSel.reduce((t, v) => t + Number(v.unidades), 0) / (elegida.factor || 1)) : 0;
    const restoABodega = vieneSel.length ? Math.max(cant - vienenUnidades, 0) : 0;
    const origenes = vieneSel.map((v) => v.origen).join(' y ');

    const modo = opciones?.modo === 'encargo' && vieneSel.length ? 'viene'
        : opciones?.modo === 'encargo' && traslado && !soloEncargo && !enPedido ? 'traslado' : (opciones?.modo ?? null);
    const seAparta = modo === 'reserva' || modo === 'viene';
    const totalApartados = redondear(apartados.reduce((t, a) => t + a.precio * a.cantidad, 0));
    // En un pedido, el cobro es por todo: lo agregado más el de la pantalla.
    const totalCobro = enPedido ? redondear(totalApartados + (producto && elegida && seAparta ? total : 0)) : total;
    // Reglamento v2 (lo vuelve a decidir `apartado_cotizar`): sin monto mínimo.
    const mitad = redondear(totalCobro * 0.5);
    const conAnticipo = !soloEncargo && (enPedido || modo === 'reserva' || modo === 'traslado' || modo === 'viene');
    const montoAnticipo = cuanto === 'mitad' ? mitad : cuanto === 'todo' ? totalCobro : (anticipo === '' ? 0 : Number(anticipo) || 0);
    const estadoPago = estadoDeFormaDePago(pago, montoAnticipo);
    const nombreProducto = producto ? `${producto.nombre}${elegida?.tipo ? ` · ${elegida.tipo}` : ''}` : '';

    // El producto de la pantalla como renglón del encargo o del pedido.
    const lineaActual = producto && elegida ? { productoId: producto.id, productoNombre: nombreProducto, factor: elegida.factor,
        cantidad: cant, precio: elegida.precio } : null;
    const totalLineas = redondear(lineas.reduce((s, l) => s + l.precio * l.cantidad, 0));
    // Cómo llega lo que se aparta sin existencia: el traslado que ya viene, o el que se pide ahora.
    const enCamino = modo === 'viene' ? { traslados_en_camino: elegidosIds, encargar_resto: restoABodega > 0 }
        : modo === 'traslado' && traslado ? { traslado_desde: traslado.branch_id } : {};
    const puedeAgregar = !sinCatalogo && modo === 'encargo' && !!lineaActual && cant >= 1 && cant <= TOPE_ENCARGO && lineas.length < TOPE_RENGLONES;
    // Al pedido: lo que se aparta en sala o lo que ya viene, nunca lo que se pide
    // a otra sala (ése pide su traslado al cobrarse y va solo).
    const puedeApartarOtro = !sinCatalogo && !soloEncargo && seAparta && !!lineaActual && cant >= 1 && cant <= TOPE_APARTADO
        && apartados.length < TOPE_RENGLONES && !(modo === 'viene' && restoABodega > TOPE_ENCARGO)
        && !apartados.some((a) => a.productoId === lineaActual.productoId);
    const renglonActual = lineaActual ? { ...lineaActual, enCamino: modo === 'viene' ? enCamino : null, origen: modo === 'viene' ? origenes : null } : null;
    const renglonesDelPedido = [...apartados, ...(producto && elegida && seAparta && renglonActual ? [renglonActual] : [])];

    const faltaTel = cliente && !telOk ? 'Confirma el teléfono del cliente.' : null;
    const faltaNuevo = !cliente ? 'Elige el cliente del listado.' : faltaTel ? faltaTel : String(nombreNuevo).trim().length < 3 ? 'Escribe el nombre del producto.'
        : !srs && !srsNoAparece ? 'Búscalo en el SRS, o marca que no aparece.' : cant < 1 || cant > TOPE_ENCARGO ? `Un encargo va de 1 a ${TOPE_ENCARGO} unidades.` : errorFoto || null;
    const falta = sinCatalogo ? faltaNuevo : !cliente ? 'Elige el cliente del listado.' : faltaTel ? faltaTel
        // Con productos ya agregados, el de la pantalla es opcional.
        : soloEncargo && !producto ? null
        : enPedido && !producto ? (montoAnticipo < 0.01 ? 'Escribe cuánto deja.' : montoAnticipo > totalCobro + 0.004
            ? 'El anticipo no puede pasar del total.' : estadoPago.falta)
        : !producto ? 'Elige el producto.' : !elegida ? 'Elige la presentación.'
        : cant < 1 || cant > TOPE_APARTADO ? `La cantidad va de 1 a ${TOPE_APARTADO}.` : !opciones ? 'Revisando la existencia…'
            : soloEncargo && modo !== 'encargo' ? 'Éste sí se puede apartar: quítalo y apártalo aparte, después del encargo.'
            : enPedido && !seAparta ? 'Éste no hay en la sala ni viene en camino: quítalo del pedido y encárgalo aparte.'
            : enPedido && apartados.some((a) => a.productoId === producto.id) ? 'Ese producto ya está en el pedido: quítalo y agrégalo con la cantidad total.'
            : modo === 'viene' && restoABodega > TOPE_ENCARGO ? `Bodega encarga hasta ${TOPE_ENCARGO} por pedido y faltan ${restoABodega}.`
            : modo === 'traslado' && !traslado.lista ? `Revisando lo que hay en ${traslado.sala}…`
            // La base acepta encargos de 1 a 20: decirlo antes y no con su error.
            : modo === 'encargo' && cant > TOPE_ENCARGO ? `Un encargo va de 1 a ${TOPE_ENCARGO} unidades.`
            : conAnticipo && montoAnticipo < 0.01 ? 'Escribe cuánto deja.'
                : conAnticipo && montoAnticipo > totalCobro + 0.004 ? 'El anticipo no puede pasar del total.'
                    : conAnticipo && (cobroEn === 'caja' || enPedido) ? estadoPago.falta : null;

    return {
        cant, total, soloEncargo, enPedido, vienen, sugeridos, elegidosIds, vieneSel, vienenUnidades, restoABodega, origenes,
        modo, seAparta, totalApartados, totalCobro, mitad, conAnticipo, montoAnticipo, estadoPago, nombreProducto,
        lineaActual, totalLineas, enCamino, puedeAgregar, puedeApartarOtro, renglonActual, renglonesDelPedido, falta,
        deja: Math.min(redondear(montoAnticipo || 0), totalCobro),
    };
}

/** Lo que va a `apartado` de `operar-caja` para un pedido de varios productos con un solo cobro. */
export const apartadoDelPedido = (customerId, renglones) => ({
    modo: 'pedido', customer_id: customerId, lineas: renglones.map((l) => ({
        producto_id: l.productoId, producto_nombre: l.productoNombre, factor: l.factor, cantidad: l.cantidad,
        precio: l.precio, ...(l.enCamino ?? {}) })),
});

/** De dónde viene lo que se apartó en un pedido, para el papel («Viene de …»). */
export const origenesDelPedido = (renglones) => [...new Set((renglones ?? []).map((l) => l.origen).filter(Boolean))].join(' y ') || null;

/** El teléfono escrito, como lo guardan las fichas (`7941-6817`); null si no son 8 dígitos. */
export function telefonoDeFicha(texto) {
    const d = String(texto ?? '').replace(/\D/g, '');
    return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4)}` : null;
}
