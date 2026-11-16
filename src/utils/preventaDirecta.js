// ═══════════════════════════════════════════════════════════════════════════
// La vista Preventa (2026-11-16): lo que la pantalla calcula sin preguntarle a
// nadie. El precio NO se calcula acá: lo decide la base (`preventa_cotizar`)
// según el cliente, y la base lo vuelve a calcular antes de mandar a caja.
// ═══════════════════════════════════════════════════════════════════════════

import { ETIQUETA_CAMPO, esContribuyente } from './clienteValidacion.js';
import { formatMoney } from './formatNumber.js';

/** El nombre de cada lista de precio (las claves son columnas de `product_precios`). */
export const NOMBRE_DE_LISTA = {
    vineta: 'Regular',
    descuento_1: 'Público',
    vip: 'Preferente',
    clinica: 'Mayoreo',
    mayoreo: 'Mayoreo Plus',
};

/** Las listas, de la más alta a la más baja (el orden en que se ofrecen). */
export const ORDEN_DE_LISTAS = ['vineta', 'descuento_1', 'vip', 'clinica', 'mayoreo'];

/** Cómo paga el cliente. El crédito exige un cliente con datos. */
export const PAGOS = [
    { value: 'contado', label: 'Efectivo' },
    { value: 'tarjeta', label: 'Tarjeta' },
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'credito', label: 'Crédito' },
    { value: 'cheque', label: 'Cheque' },
];

/** Lo que le falta a un cliente para emitirle crédito fiscal, como rótulos. */
export const CAMPOS_CCF = ['nit', 'nrc', 'giro', 'direccion'];
export function faltanParaCcf(cliente) {
    if (!cliente) return ['Cliente'];
    const faltan = CAMPOS_CCF.filter((c) => !String(cliente[c] ?? '').trim()).map((c) => ETIQUETA_CAMPO[c] ?? c);
    if (!esContribuyente(cliente.categoria)) faltan.unshift('Categoría contribuyente');
    return faltan;
}

/** Las listas con precio de una presentación, para elegir viendo el monto. */
export function opcionesDePrecio(precios) {
    return ORDEN_DE_LISTAS
        .filter((k) => Number(precios?.[k]) > 0)
        .map((k) => ({ lista: k, nombre: NOMBRE_DE_LISTA[k], precio: Number(precios[k]) }));
}

export const nombreDeLista = (k) => NOMBRE_DE_LISTA[k] ?? 'Regular';

/** Por qué le toca esa lista al cliente, en una frase corta. */
export function porQueEsaLista(lista, generico) {
    if (generico) return 'Cliente frecuente o sin datos: precio Público.';
    if (lista === 'mayoreo') return 'Mayoreo Plus: mayorista Plus o empleado.';
    if (lista === 'clinica') return 'Cliente mayorista: precio Mayoreo.';
    return 'Cliente con datos: precio Preferente.';
}

export const MAX_PRODUCTOS = 30;

/** Un producto nuevo en la venta: 1 de la presentación más chica, salvo que se diga otra. */
export function lineaNueva(producto, factor = 1) {
    return {
        producto_id: Number(producto.id), nombre: producto.nombre ?? '', factor: Number(factor) || 1, cantidad: 1, lista: null,
        foto_url: producto.foto_url ?? null,
    };
}

/** Lo que viaja a la base: producto, presentación (y su viñeta, si se eligió), cantidad y la lista autorizada. */
export const lineasParaCotizar = (lineas) => (lineas ?? []).map((l) => ({
    producto_id: l.producto_id, factor: l.factor, cantidad: Number(l.cantidad) || 0,
    ...(l.lista ? { lista: l.lista } : {}),
    ...(l.presentacion ? { presentacion: l.presentacion } : {}),
}));

/**
 * Las opciones de presentación de una línea (2026-11-16). Dos con las mismas
 * unidades son dos viñetas del mismo empaque (CAJA $10.61 y CAJA $10.65): se
 * muestran las dos con su viñeta y el valor lleva el id para distinguirlas.
 * `leer(valor)` devuelve el cambio para la línea: `{ factor, presentacion }`.
 */
export function opcionesDePresentacion(fila, linea) {
    const lista = fila?.presentaciones?.length ? fila.presentaciones : null;
    if (!lista) {
        const v = String(linea.factor);
        return { options: [{ value: v, label: fila ? 'Sin precio' : '…' }], value: v, leer: () => ({}) };
    }
    const cuantas = new Map();
    for (const p of lista) cuantas.set(p.factor, (cuantas.get(p.factor) ?? 0) + 1);
    const doble = (f) => (cuantas.get(f) ?? 0) > 1;
    const options = lista.map((p) => ({
        value: doble(p.factor) ? `${p.factor}:${p.id_presentacion}` : String(p.factor),
        label: doble(p.factor) ? `${p.tipo} · viñeta ${Number(p.vineta).toFixed(2)}` : p.tipo,
    }));
    const f = Number(linea.factor) || 1;
    const value = doble(f) ? `${f}:${linea.presentacion ?? fila?.id_presentacion ?? lista.find((p) => p.factor === f)?.id_presentacion}` : String(f);
    const leer = (v) => {
        const [fa, id] = String(v ?? '').split(':');
        return { factor: Number(fa) || 1, presentacion: id ? Number(id) : null };
    };
    return { options, value, leer };
}

/** Agrega un producto; si ya está en esa presentación, le suma 1. */
export function agregarLinea(lineas, producto, factor = 1) {
    const i = lineas.findIndex((l) => l.producto_id === Number(producto.id) && l.factor === (Number(factor) || 1));
    if (i >= 0) return lineas.map((l, j) => (j === i ? { ...l, cantidad: Math.min(999, (Number(l.cantidad) || 0) + 1) } : l));
    if (lineas.length >= MAX_PRODUCTOS) return lineas;
    return [...lineas, lineaNueva(producto, factor)];
}

const centavos = (v) => Math.round(Number(v || 0) * 100) / 100;

/** Los totales de una cotización: lo que cobra, lo que costaría a precio Regular y lo que se ahorra. */
export function totalesDe(cotizacion) {
    const filas = cotizacion?.lineas ?? [];
    const total = centavos(filas.reduce((t, l) => t + Number(l.subtotal || 0), 0));
    const regular = centavos(filas.reduce((t, l) => t + Number(l.precio_regular || 0) * Number(l.cantidad || 0), 0));
    return {
        total, regular, ahorro: centavos(Math.max(0, regular - total)),
        productos: filas.length,
        unidades: filas.reduce((t, l) => t + Number(l.cantidad || 0) * Number(l.factor || 1), 0),
        conError: filas.filter((l) => l.error).length,
    };
}

/**
 * Lo que falta para poder mandar, UNO y en orden, con el campo donde se
 * arregla. null = se puede mandar. La base lo vuelve a revisar todo.
 */
export function faltaParaEnviar({ lineas, cotizacion, cotizando, documento, pago, puntos = 0, infoCliente = null }) {
    if (!(lineas ?? []).length) return { texto: 'Agrega al menos un producto.', campo: 'buscarProducto' };
    if (cotizando || !cotizacion) return { texto: 'Revisando precios y existencia…', campo: null };
    const mala = (cotizacion.lineas ?? []).find((l) => l.error);
    if (mala) return { texto: `${mala.nombre ?? 'Un producto'}: ${mala.error}`, campo: `linea-${mala.producto_id}-${mala.factor}` };
    if (documento === 'credito_fiscal') {
        const f = faltanParaCcf(cotizacion.cliente);
        if (f.length) return { texto: `Para crédito fiscal le falta al cliente: ${f.join(', ')}.`, campo: 'cliente' };
    }
    if (pago === 'credito' && (cotizacion.generico || !cotizacion.cliente))
        return { texto: 'El crédito necesita un cliente con sus datos.', campo: 'cliente' };
    const p = faltaEnPuntos({ puntos, info: infoCliente, total: totalesDe(cotizacion).total });
    if (p) return { texto: p, campo: 'puntos' };
    return null;
}

/** El estado de una preventa en la lista, como se lee en la sucursal. */
export function estadoDePreventa(p) {
    switch (p?.estado) {
        case 'viva': return { texto: 'En caja', tono: 'info' };
        case 'facturada': return { texto: 'Facturada', tono: 'success' };
        case 'enviando': return { texto: 'Enviando…', tono: 'neutral' };
        case 'fallida': return { texto: 'No llegó a caja', tono: 'danger' };
        case 'sin_enlace': return { texto: 'En caja sin número', tono: 'warning' };
        case 'descartada': return { texto: 'Anulada', tono: 'neutral' };
        default: return { texto: p?.estado ?? '—', tono: 'neutral' };
    }
}

/** ¿Se puede corregir o anular? Sólo mientras está en caja sin facturar (o si no llegó). */
export const sePuedeCorregir = (p) => p?.estado === 'viva';
export const sePuedeAnular = (p) => ['viva', 'fallida', 'sin_enlace'].includes(p?.estado);

/** De una preventa guardada a las líneas del editor, para corregirla o repetirla. */
export function lineasDeVenta(venta) {
    return (venta?.renglones ?? []).map((r) => ({
        producto_id: Number(r.producto_id), nombre: String(r.nombre ?? ''),
        factor: Number(r.factor) || 1, cantidad: Number(r.cantidad) || 1, lista: null,
        lote: r.lote?.nombre ? { lote: r.lote.nombre, vence: r.lote.vence ?? null } : null,
    }));
}

/** Cómo se llama el programa del cliente en pantalla. */
export const NOMBRE_DE_PROGRAMA = {
    socio: 'Socio Puntos Salud',
    mayorista: 'Cliente mayorista',
    empresa: 'Empresa',
    fuera: 'Fuera del programa de puntos',
    mostrador: 'Cliente de mostrador',
};

/** El descuento en dólares de unos puntos ($0.01 por punto, como en caja). */
export const descuentoDePuntos = (puntos, valor = 0.01) => Math.round((Number(puntos) || 0) * valor * 100) / 100;

/**
 * Por qué no se pueden canjear esos puntos, o null. `info` es la ficha de
 * `preventa_cliente` (con `puntos` y `minimo_a_pagar`). La base lo vuelve a
 * revisar contando lo que apartaron otras preventas.
 */
export function faltaEnPuntos({ puntos, info, total }) {
    const n = Math.trunc(Number(puntos) || 0);
    if (n <= 0) return null;
    const p = info?.puntos;
    if (!p) return 'Elige un cliente para canjear puntos.';
    if (!p.puede_canjear) return 'Este cliente no puede canjear puntos.';
    if (n < p.minimo_canje) return `Se canjean como mínimo ${p.minimo_canje} puntos.`;
    if (n > p.tope) return `Se canjean como máximo ${p.tope} puntos por venta.`;
    if (n > p.disponibles) return `El cliente tiene ${p.disponibles} puntos disponibles.`;
    const minimo = Number(info?.minimo_a_pagar ?? 0.05);
    if (Number(total) - descuentoDePuntos(n, p.valor) < minimo)
        return `Con ese canje la venta queda bajo el mínimo a pagar (${formatMoney(minimo)}).`;
    return null;
}

/** Los puntos que se pueden usar como máximo en esta venta. */
export function maximoDePuntos(info, total) {
    const p = info?.puntos;
    if (!p?.puede_canjear) return 0;
    const minimo = Number(info?.minimo_a_pagar ?? 0.05);
    const porTotal = Math.floor(((Number(total) || 0) - minimo) / (p.valor || 0.01) + 1e-9);
    return Math.max(0, Math.min(p.disponibles, p.tope, porTotal));
}

/**
 * Todo lo que impide enviar, no sólo lo primero, y cada cosa con cómo
 * resolverla (2026-11-16, usuario: «los avisos deben dar sugerencias de cómo
 * solventar, no sólo el error»). Cada problema:
 *   { clave, titulo, ayuda, campo, linea?, acciones: [{ id, label, valor? }] }
 * Las acciones son IDS: la pantalla decide qué hace cada una y esconde las
 * que el usuario no puede usar (apartar, editar el cliente).
 */
export function problemasDeVenta({ lineas, cotizacion, documento, pago, puntos = 0, infoCliente = null, hayCliente = false }) {
    const out = [];
    if (!(lineas ?? []).length) {
        out.push({ clave: 'vacia', titulo: 'Agrega al menos un producto.', ayuda: 'Búscalo por nombre o escanea el código (F3).',
            campo: 'buscarProducto', acciones: [{ id: 'buscar', label: 'Buscar producto' }] });
        return out;
    }
    if (!cotizacion) return out;
    for (const l of cotizacion.lineas ?? []) {
        if (!l.error) continue;
        const linea = `${l.producto_id}-${l.factor}`;
        const base = { clave: `linea-${linea}`, linea, campo: `linea-${linea}` };
        const nombre = l.nombre ?? 'Un producto';
        const pide = Number(l.cantidad ?? 0) * Number(l.factor ?? 1);
        if (/^Hay /.test(l.error)) {
            const alcanza = Math.floor(Number(l.existencia ?? 0) / Number(l.factor || 1));
            const otras = (l.otras ?? []).map((o) => `${o.sucursal} (${o.disponibles})`).join(', ');
            out.push({ ...base, tipo: 'existencia',
                titulo: `${nombre}: hay ${Number(l.existencia ?? 0)} y pides ${pide}.`,
                ayuda: alcanza > 0
                    ? `Baja a ${alcanza}${otras ? `, pide el resto a ${otras}` : ''} o apártalo para el cliente.`
                    : otras ? `No hay aquí. Hay en ${otras}: pídelo o apártalo.` : 'No hay en ninguna sucursal: apártalo como encargo o quítalo.',
                acciones: [
                    ...(alcanza > 0 ? [{ id: 'ajustar', label: `Dejar ${alcanza}`, valor: alcanza }] : []),
                    ...(otras ? [{ id: 'otras', label: 'Pedir a otra sucursal' }] : []),
                    { id: 'apartar', label: 'Apartar' },
                    { id: 'quitar', label: 'Quitar' },
                ] });
        } else if (/cantidad/i.test(l.error)) {
            out.push({ ...base, tipo: 'cantidad', titulo: `${nombre}: escribe una cantidad.`, ayuda: 'Va de 1 a 999.',
                acciones: [{ id: 'ajustar', label: 'Poner 1', valor: 1 }, { id: 'quitar', label: 'Quitar' }] });
        } else if (/precio/i.test(l.error) && !(l.presentaciones ?? []).length) {
            // Ninguna presentación tiene precio: un servicio o un producto que
            // no se vende en sala (p. ej. comisiones de corresponsal).
            out.push({ ...base, tipo: 'precio', titulo: `${nombre}: no tiene precio de venta.`,
                ayuda: 'No se vende por preventa. Quítalo de la venta.', acciones: [{ id: 'quitar', label: 'Quitar' }] });
        } else if (/precio/i.test(l.error)) {
            out.push({ ...base, tipo: 'precio', titulo: `${nombre}: esa presentación no tiene precio.`,
                ayuda: 'Elige otra presentación o quítalo.', acciones: [{ id: 'quitar', label: 'Quitar' }] });
        } else {
            out.push({ ...base, tipo: 'producto', titulo: `${nombre}: ${l.error}`, ayuda: 'No se puede vender. Quítalo de la venta.',
                acciones: [{ id: 'quitar', label: 'Quitar' }] });
        }
    }
    if (documento === 'credito_fiscal') {
        const f = faltanParaCcf(hayCliente ? cotizacion.cliente : null);
        if (f.length) out.push({ clave: 'ccf', campo: 'cliente',
            titulo: hayCliente ? `Para crédito fiscal faltan: ${f.join(', ')}.` : 'El crédito fiscal necesita un cliente.',
            ayuda: hayCliente ? 'Complétalos en los datos del cliente o emite Factura.' : 'Busca al cliente (F4) o emite Factura.',
            acciones: [hayCliente ? { id: 'editar', label: 'Completar datos' } : { id: 'cliente', label: 'Buscar cliente' },
                { id: 'factura', label: 'Cambiar a Factura' }] });
    }
    if (pago === 'credito' && (!hayCliente || cotizacion.generico)) {
        out.push({ clave: 'credito', campo: 'cliente', titulo: 'El pago al crédito necesita un cliente con datos.',
            ayuda: 'Busca al cliente (F4) o cambia el tipo de pago.',
            acciones: [{ id: 'cliente', label: 'Buscar cliente' }, { id: 'contado', label: 'Cambiar a Efectivo' }] });
    }
    const p = faltaEnPuntos({ puntos, info: infoCliente, total: totalesDe(cotizacion).total });
    if (p) {
        const max = maximoDePuntos(infoCliente, totalesDe(cotizacion).total);
        const min = Number(infoCliente?.puntos?.minimo_canje ?? 0);
        out.push({ clave: 'puntos', campo: 'puntos', titulo: p,
            ayuda: max >= min && max > 0 ? `Puede usar hasta ${max} en esta venta.` : 'En esta venta no alcanza para canjear.',
            acciones: [...(max >= min && max > 0 ? [{ id: 'puntos', label: `Usar ${max}`, valor: max }] : []),
                { id: 'puntos', label: 'No canjear', valor: 0 }] });
    }
    return out;
}

/** Los datos que le faltan a la ficha y que caja o Hacienda terminan pidiendo. */
export function datosQueFaltan(info) {
    if (!info || info.generico || info.programa === 'mostrador') return [];
    const v = (k) => String(info[k] ?? '').trim();
    return [
        !v('phone') && 'Teléfono',
        !v('dui') && !v('nit') && 'DUI o NIT',
        !v('email') && 'Correo',
        !v('direccion') && 'Dirección',
    ].filter(Boolean);
}

/** El comprobante de una venta pasada, como lo lee la sucursal. */
export function nombreDeComprobante(tipo) {
    return { COF: 'Factura', CCF: 'Crédito fiscal', TIK: 'Ticket', NC: 'Nota de crédito' }[tipo] ?? tipo ?? '';
}

/**
 * De qué lotes sale lo que se pide (2026-11-16, usuario: «¿cómo sé qué lote
 * sacar?»). `lotes` viene de `preventa_lotes` ya en el orden en que caja los
 * usa (GENERICO primero, después el que vence antes); se toma de cada uno lo
 * que tiene hasta completar `unidades`. Cada lote vuelve con `toma`.
 */
export function lotesQueSalen(lotes, unidades) {
    let falta = Math.max(0, Number(unidades) || 0);
    return (lotes ?? []).map((l) => {
        const toma = Math.min(falta, Number(l.unidades) || 0);
        falta -= toma;
        return { ...l, toma };
    });
}

/** `2026-08-01` → `08/2026`. */
export const mesDeVencimiento = (fecha) => (/^\d{4}-\d{2}/.test(fecha ?? '') ? `${fecha.slice(5, 7)}/${fecha.slice(0, 4)}` : '—');

/** Vence en menos de 90 días contados desde `hoy` (`YYYY-MM-DD`). */
export function vencePronto(fecha, hoy) {
    if (!fecha || !hoy) return false;
    return (new Date(`${fecha}T00:00:00Z`) - new Date(`${hoy}T00:00:00Z`)) / 86400000 < 90;
}

/**
 * Qué marcar en la ficha al tocar «Completar»: con crédito fiscal, lo que
 * pide el CCF (y la categoría); si no, los datos importantes que faltan.
 */
export function queCompletar(documento, cliente) {
    if (!cliente) return null;
    if (documento === 'credito_fiscal') {
        return { campos: CAMPOS_CCF, motivo: 'Para el crédito fiscal falta', rotulo: 'Lo pide el crédito fiscal', categoria: esContribuyente(cliente.categoria) ? null : 'Contribuyente' };
    }
    const v = (k) => String(cliente[k] ?? '').trim();
    const campos = ['phone', ...(!v('dui') && !v('nit') ? ['dui'] : []), 'email', 'direccion'];
    return { campos, motivo: 'Para esta venta falta', rotulo: 'Falta' };
}

/** El mismo lote: nombre y vencimiento. */
export const mismoLote = (a, b) => Boolean(a && b) && a.lote === b.lote && (a.vence ?? null) === (b.vence ?? null);

/**
 * Cómo sale de los lotes lo que se pide, igual que lo arma caja
 * (`repartirCajaEnUnidades` en _shared/preventaCaja.ts): primero
 * presentaciones ENTERAS de cada lote, en orden; lo que ningún lote completa
 * se arma en unidades de varios lotes, al precio de la presentación. Con
 * `elegido` (`{lote, vence}`) ese lote va primero.
 *
 * Devuelve `{ lotes: [{lote, vence, unidades, enteras, sueltas}], armada, faltan }`.
 */
export function planDeLotes(lotes, cantidad, factor, elegido = null) {
    const f = Math.max(1, Number(factor) || 1);
    let orden = [...(lotes ?? [])];
    const i = elegido ? orden.findIndex((l) => mismoLote(l, elegido)) : -1;
    if (i > 0) orden = [orden[i], ...orden.slice(0, i), ...orden.slice(i + 1)];
    let faltan = Math.max(0, Number(cantidad) || 0);
    const plan = orden.map((l) => {
        const enteras = Math.min(Math.floor((Number(l.unidades) || 0) / f), faltan);
        faltan -= enteras;
        return { ...l, enteras, sueltas: 0 };
    });
    let armada = false;
    if (faltan > 0 && f > 1) {
        let unidades = faltan * f;
        const total = plan.reduce((t, l) => t + (Number(l.unidades) || 0) - l.enteras * f, 0);
        if (total >= unidades) {
            for (const l of plan) {
                const toma = Math.min((Number(l.unidades) || 0) - l.enteras * f, unidades);
                l.sueltas = toma; unidades -= toma;
            }
            faltan = 0; armada = true;
        }
    }
    return { lotes: plan, armada, faltan };
}

/** Lo que viaja a caja: lo de cotizar más el lote elegido, si hay. */
export const lineasParaEnviar = (lineas) => (lineas ?? []).map((l) => ({
    ...lineasParaCotizar([l])[0],
    ...(l.lote ? { lote: { nombre: l.lote.lote, vence: l.lote.vence ?? null } } : {}),
}));
