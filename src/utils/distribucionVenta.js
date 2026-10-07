// La venta de Torogoz SIN PANTALLA (2026-10-07): lo que antes vivía dentro de
// `views/DistribucionVentaView.jsx` y ahora usan igual el portal y la app
// nativa. Es la misma cuenta, copiada tal cual: cada renglón resuelto (precio,
// descuento, lote, existencia), el resumen del motor y lo que impide guardar o
// facturar. Si la pantalla y el teléfono hicieran cada uno la suya, un mismo
// carrito podría facturarse en uno y frenarse en el otro.
//
// Es AYUDA: el trigger de la base vuelve a decidir precio, descuento y venta
// libre al guardar (ver el encabezado de la vista).
import { formatMoney } from './formatNumber';
import { shortEmployeeName } from './nameUtils';
import { leerMonto } from './distribucionComun';
import { indexarLotes, ocupadasPorLote, libreEn } from './distribucionLotes';
import { presentacionesDe, precioDe, descuentoDelCatalogo, topeDeDescuento } from './distribucionPrecios';
import { calcularVenta, descuentoConIva } from './distribucionMotor';
import { problemaDePagos, cambioDePagos } from './distribucionPagos';

export const conCantidad = (n) => String(Math.round(n * 10000) / 10000);

/** Lo que se escribe en cantidad o descuento: sólo dígitos y UN separador decimal. */
export const soloNumero = (v) => {
    const limpio = String(v ?? '').replace(/[^0-9.,]/g, '').replace(',', '.');
    const [ent, ...resto] = limpio.split('.');
    return resto.length ? `${ent}.${resto.join('')}` : ent;
};

let siguienteRenglon = 1;
export const renglonNuevo = (productId, presentacion, extra = {}) => ({
    product_id: String(productId), presentacion, lista_id: '', cantidad: '1',
    descTipo: 'pct', descValor: '', ...extra, clave: siguienteRenglon++,
});

/** Lo que `distribucionLotes` necesita saber del catálogo para repartir un renglón. */
export function contextoLotes(idx, lotesIdx) {
    return {
        lotesDe: (pid) => lotesIdx.get(String(pid)) ?? [],
        porDe: (pid, pres) => presentacionesDe(idx, pid).find(x => x.presentacion === pres)?.unidades ?? 1,
        // El tramo de otro lote hereda la lista y un descuento en % (en $ no:
        // sería darlo dos veces).
        nuevo: (b, cambios) => renglonNuevo(b.product_id, b.presentacion, {
            lista_id: b.lista_id, descTipo: b.descTipo, descValor: b.descTipo === 'pct' ? b.descValor : '', ...cambios,
        }),
    };
}

/** «2026-11-01» → «11/2026»: el vencimiento como lo trae la caja del producto. */
export const mesVence = (v) => (v ? `${v.slice(5, 7)}/${v.slice(0, 4)}` : 'sin vencimiento');

/**
 * Los lotes de la ubicación de la venta (bodega, o el camión de quien vende),
 * descontando lo que apartaron OTRAS ventas (borrador 0012) y recordando quién.
 * Devuelve `{ lotesIdx, existencias }`; `existencias` es null si no se pudieron
 * leer los lotes (la venta sigue sin ese dato).
 */
export function lotesDeLaVenta({ lotesCrudos, desdeCamion, yo, reservas, sesion }) {
    const deAqui = (lotesCrudos ?? []).filter(l => (l.en_camion_de ?? null) === (desdeCamion ? yo ?? null : null));
    const base = indexarLotes(deAqui);
    const reservado = new Map();
    for (const r of reservas ?? []) {
        if (r.sesion === sesion) continue;
        const e = reservado.get(Number(r.lote_id)) ?? { unidades: 0, quien: new Set() };
        e.unidades += Number(r.unidades) || 0;
        e.quien.add(shortEmployeeName({ name: r.nombre }) || 'otro vendedor');
        reservado.set(Number(r.lote_id), e);
    }
    const lotesIdx = new Map();
    for (const [pid, lista] of base) {
        lotesIdx.set(pid, lista.map(l => {
            const r = reservado.get(l.id);
            return r ? { ...l, existencia: Math.max(0, l.existencia - r.unidades), reservadoPor: [...r.quien] } : l;
        }));
    }
    if (!lotesCrudos) return { lotesIdx, existencias: null };
    const existencias = new Map();
    for (const [pid, lista] of lotesIdx) existencias.set(pid, lista.reduce((t, l) => t + l.existencia, 0));
    for (const l of deAqui) if (!existencias.has(String(l.product_id))) existencias.set(String(l.product_id), 0);
    return { lotesIdx, existencias };
}

/** Quién tiene reservado (en otra venta) algo de ese producto. */
export const quienTiene = (lotesIdx, pid) => [...new Set((lotesIdx.get(String(pid)) ?? []).flatMap(l => l.reservadoPor ?? []))];

/** Las unidades por lote que lleva el carrito: lo que se le pide a `reservar`. */
export function porLoteDe(carrito, porDe) {
    const m = new Map();
    for (const c of carrito) {
        const n = leerMonto(c.cantidad);
        if (c.lote_id == null || !(n > 0)) continue;
        const u = Math.ceil(n * porDe(c.product_id, c.presentacion));
        m.set(Number(c.lote_id), (m.get(Number(c.lote_id)) ?? 0) + u);
    }
    return [...m].map(([lote_id, unidades]) => ({ lote_id, unidades })).sort((a, b) => a.lote_id - b.lote_id);
}

/**
 * La venta entera: cada renglón resuelto, el resumen del motor y los dos
 * bloqueos (`bloqueoGuardar` impide hasta la preventa; `bloqueo`, facturar).
 */
export function armarVenta({
    carrito, idx, porId, listaEfectiva, tipoDoc, cliente, emisor, lotesIdx, existencias, ctxLotes,
    permitido, puedeVender, puedeConfigurar, puedeDescontar, pagos, plazo, credito, hoy,
}) {
    const conIva = tipoDoc === '01';
    const topeDescuento = Number(emisor?.descuento_max_pct ?? 0);
    const ocupadasTodas = ocupadasPorLote(carrito, ctxLotes.porDe);
    const ocupadasOtros = (clave) => {
        const c = carrito.find(x => x.clave === clave);
        if (!c || c.lote_id == null) return ocupadasTodas;
        const m = new Map(ocupadasTodas);
        const propias = (leerMonto(c.cantidad) ?? 0) * ctxLotes.porDe(c.product_id, c.presentacion);
        m.set(Number(c.lote_id), (m.get(Number(c.lote_id)) ?? 0) - propias);
        return m;
    };
    // Cada renglón resuelto: presentación, precio de lista y descuento (con IVA).
    const base = carrito.map(c => {
        const p = porId.get(c.product_id);
        const presentaciones = p ? presentacionesDe(idx, p.product_id) : [];
        const presentacion = c.presentacion ?? presentaciones[0]?.presentacion ?? 'UNIDAD';
        const lista = c.lista_id ? Number(c.lista_id) : listaEfectiva;
        const r = p ? precioDe(idx, p, presentacion, lista) : null;
        const n = leerMonto(c.cantidad);
        const brutoConIva = r && n ? n * r.precio : 0;
        const desc = r && n ? descuentoConIva({ tipo: c.descTipo, valor: leerMonto(c.descValor), cantidad: n, precioConIva: r.precio, conIva }) : 0;
        const pct = brutoConIva > 0 ? (desc / brutoConIva) * 100 : 0;
        const descMalo = String(c.descValor ?? '').trim() !== '' && leerMonto(c.descValor) == null;
        const pasaImporte = desc > brutoConIva + 1e-6;
        // ¿Lo puede dar quien vende? Mismo juicio que `dist_validar_item`: el
        // de configuración, cualquiera; el de descuentos, hasta el tope; y uno
        // ya dado que nadie tocó, sigue. Lo demás se PIDE (no bloquea).
        const yaDado = !!c.descFijo && c.descFijo === `${c.descTipo}|${c.descValor}|${c.cantidad}|${r?.precio}`;
        // Hasta el % del catálogo lo da cualquiera (0029); el tope es el del
        // producto si lo tiene.
        const catPct = descuentoDelCatalogo(p, hoy);
        // ¿Es el del catálogo tal cual? Se compara lo ESCRITO: el % calculado
        // sobre el importe cambia de base según el documento.
        const delCatalogo = catPct > 0 && c.descTipo === 'pct' && leerMonto(c.descValor) === catPct;
        const directo = desc === 0 || yaDado || puedeConfigurar || delCatalogo || pct <= catPct + 0.005
            || (puedeDescontar && pct <= topeDeDescuento(p, topeDescuento, hoy) + 0.005);
        const porAprobar = desc > 0 && !pasaImporte && !descMalo && !directo;
        const unidades = r && n ? Math.ceil(n * (r.unidades || 1)) : 0;
        const hay = existencias ? (existencias.get(c.product_id) ?? 0) : null;
        // El lote del renglón y lo que le queda, descontando lo que ya llevan
        // los demás renglones de este carrito.
        const lotesP = lotesIdx.get(c.product_id) ?? [];
        const lote = lotesP.find(x => x.id === Number(c.lote_id)) ?? null;
        const por = r?.unidades || 1;
        const libres = lotesP.map(x => ({ ...x, libre: libreEn(x, ocupadasOtros(c.clave)) }));
        const libreLote = lote ? libres.find(x => x.id === lote.id).libre : 0;
        const faltanUnidades = existencias ? Math.max(0, unidades - (lote ? libreLote : 0)) : 0;
        return {
            ...c, p, n, r, presentacion, presentaciones, desc, pct, catPct, delCatalogo, porAprobar, unidades, hay,
            lote, libres, libreLote, por,
            // Quién tiene apartado (en otra venta) lo que a este renglón le falta.
            quien: [...new Set(lotesP.flatMap(x => x.reservadoPor ?? []))],
            faltaExistencia: faltanUnidades > 0,
            faltan: faltanUnidades > 0 ? Math.ceil(faltanUnidades / por) : 0,
            descMalo, pasaImporte, noVa: !p || !permitido(p), sinPrecio: !!p && !r,
            // Otra lista distinta de la de la venta: se marca para que se vea.
            otraLista: r?.listaId != null && r.listaId !== listaEfectiva,
        };
    });
    // Los números —importe de cada renglón, IVA, retención, total— los da el
    // motor del documento, con las mismas opciones que usa la edge function.
    // Un descuento por aprobar NO entra: todavía no se dio.
    const cuentan = base.filter(l => l.r && l.n > 0 && !l.pasaImporte);
    const venta = calcularVenta(
        cuentan.map(l => ({ cantidad: l.n, precioConIva: l.r.precio, descuentoConIva: l.porAprobar ? 0 : l.desc })),
        {
            tipoDoc,
            retiene1: !!cliente?.gran_contribuyente && tipoDoc === '03',
            percibe1: !!emisor?.gran_contribuyente && !cliente?.gran_contribuyente && tipoDoc === '03',
        },
    );
    const delMotor = new Map(cuentan.map((l, i) => [l.clave, venta.renglones[i]]));
    const lineas = base.map(l => ({ ...l, doc: delMotor.get(l.clave) ?? null }));
    const porAprobar = lineas.filter(l => l.porAprobar);
    const montoPorAprobar = porAprobar.reduce((a, l) => a + (conIva ? l.desc : l.desc / 1.13), 0);
    const unidadesTotal = lineas.reduce((a, l) => a + (l.n || 0), 0);
    const cantidadMala = lineas.some(l => !l.n || l.n <= 0);
    const hayNoPermitidos = lineas.some(l => l.noVa);
    const haySinPrecio = lineas.some(l => l.sinPrecio);
    const descuentoMalo = lineas.find(l => l.descMalo || l.pasaImporte);
    const sinExistencia = lineas.find(l => l.faltaExistencia);
    const conCredito = pagos.some(f => f.forma === '13');
    const plazoNum = conCredito ? leerMonto(plazo) : null;
    const fijas = pagos.slice(0, -1);
    const sumaFijas = fijas.reduce((a, f) => a + (leerMonto(f.monto) ?? 0), 0);
    const alCredito = !conCredito ? 0
        : fijas.filter(f => f.forma === '13').reduce((a, f) => a + (leerMonto(f.monto) ?? 0), 0)
          + (pagos[pagos.length - 1].forma === '13' ? Math.max(0, venta.total - sumaFijas) : 0);
    // Lo que puede llevar a crédito es lo DISPONIBLE (límite menos lo que ya
    // debe), no el límite entero: el servidor frena igual (borrador 0014).
    const disponibleCredito = credito ? Number(credito.disponible) : Number(cliente?.limite_credito ?? 0);
    const excedeCredito = conCredito && cliente && Math.round(alCredito * 100) > Math.round(disponibleCredito * 100);
    const problemaPago = lineas.length ? problemaDePagos(pagos, venta.total, { cliente, plazo }) : null;
    const cambio = cambioDePagos(pagos, venta.total);
    const licenciaVencida = cliente?.licencia_srs_vence && cliente.licencia_srs_vence < hoy;
    const sinLicencia = cliente && (!cliente.licencia_srs || licenciaVencida);

    // Lo que impide GUARDAR (también como preventa).
    const bloqueoGuardar = !puedeVender ? 'No tienes permiso para vender en Distribución.'
        : !emisor ? 'Faltan los datos de la empresa.'
        : !cliente ? 'Elige el cliente.'
        : sinLicencia ? 'Este cliente no tiene licencia de la SRS vigente: no se le puede vender.'
        : !lineas.length ? 'Agrega al menos un producto.'
        : hayNoPermitidos ? 'Hay productos que este cliente no puede recibir: quítalos.'
        : haySinPrecio ? 'Hay una presentación sin precio: elige otra.'
        : cantidadMala ? 'Revisa las cantidades: tienen que ser mayores que cero.'
        : descuentoMalo ? `Revisa el descuento de «${descuentoMalo.p?.nombre ?? 'un producto'}».`
        : venta.error ? `No se pudo calcular la venta: ${venta.error}.`
        : null;
    // Y lo que además impide FACTURAR.
    const bloqueo = bloqueoGuardar
        ?? (porAprobar.length ? 'Hay descuentos por aprobar: la venta se guarda como preventa.' : null)
        ?? (sinExistencia ? `No hay existencia para «${sinExistencia.p?.nombre ?? 'un producto'}»: baja la cantidad o anota lo que falta como venta perdida.` : null)
        ?? (excedeCredito ? `${cliente.nombre} ya debe ${formatMoney(credito?.saldo ?? 0)}: puede llevar a crédito hasta ${formatMoney(disponibleCredito)}. Cobra un abono o cambia la forma de pago.` : null)
        ?? problemaPago;

    return {
        conIva, lineas, venta, porAprobar, montoPorAprobar, unidadesTotal, sinExistencia, conCredito, plazoNum,
        alCredito, disponibleCredito, excedeCredito, problemaPago, cambio, licenciaVencida, sinLicencia,
        bloqueoGuardar, bloqueo,
    };
}

/** Los renglones como los recibe `crearPedido`/`actualizarPedido`. */
export function renglonesParaGuardar(lineas, listaEfectiva) {
    return lineas.map(l => ({
        product_id: Number(l.product_id), cantidad: l.n, presentacion: l.presentacion,
        lote_id: l.lote_id != null ? Number(l.lote_id) : null,
        // La lista que se pidió: la del renglón o la de la venta. La base
        // vuelve a resolver el precio con esto, igual que `precioDe`.
        lista_id: (l.lista_id ? Number(l.lista_id) : listaEfectiva) ?? null,
        descuentoTipo: l.desc > 0 ? l.descTipo : null,
        // En $ viaja con IVA (como se guarda); en %, el porcentaje.
        descuentoValor: l.descTipo === 'pct' ? leerMonto(l.descValor) : l.desc,
    }));
}

/** Las formas de pago como las recibe `guardarPagos` (sin comprobantes). */
export const pagosParaGuardar = (pagos) => pagos.map((f, i) => ({
    forma: f.forma, monto: leerMonto(f.monto), referencia: f.referencia, recibido: leerMonto(f.recibido),
    resto: i === pagos.length - 1,
}));

/** La condición (1 contado · 2 crédito) y la forma de pago de la cabecera. */
export const cabeceraDePago = (pagos) => ({
    condicion: pagos.some(f => f.forma === '13') ? 2 : 1,
    formaPago: pagos[0].forma === '13' ? '01' : pagos[0].forma,
});
