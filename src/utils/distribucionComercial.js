// Torogoz, la parte comercial: clientes, catálogo, compras, proveedores,
// solicitudes de descuento y los datos de la empresa que factura.
//
// Las reglas de estos formularios vivían dentro de los modales del portal
// (`ClienteModal`, `TabCatalogo`, `CompraModal`, `ProveedorModal`,
// `TabEmisor`). Se mudaron acá el 2026-10-07 para que la app nativa valide
// EXACTAMENTE lo mismo: si una pantalla deja guardar lo que la otra frena, el
// error aparece en la base —un CHECK, un rechazo de Hacienda— y no en quien lo
// escribió.
import { sumarDias } from './fecha';
import { isValidDUIAlgorithm } from './duiUtils';
import { formatearNit } from './nitUtils';
import { leerMonto } from './distribucionComun';
import { descuentoDelCatalogo } from './distribucionPrecios';
import { totalEsperado, totalesCalculados } from './distribucionCompras';
import { tokenMatch } from './searchUtils';

/**
 * Un id para `client_uuid` (lo que hace idempotente guardar una compra). En el
 * navegador es el del sistema; en la app (Hermes no trae `randomUUID`) se arma
 * con `getRandomValues`, o con `Math.random` como último recurso: sólo tiene
 * que no repetirse, no ser secreto.
 */
export function nuevoUuid() {
    const c = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID();
    const b = new Uint8Array(16);
    if (c?.getRandomValues) c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ── Clientes ───────────────────────────────────────────────────────────────

/** La licencia de la SRS decide si se le puede vender: es la columna que importa. */
export function estadoLicencia(c, hoy) {
    if (!c.licencia_srs) return { variant: 'danger', label: 'Sin licencia' };
    if (c.licencia_srs_vence && c.licencia_srs_vence < hoy) return { variant: 'danger', label: 'Vencida' };
    if (c.licencia_srs_vence && c.licencia_srs_vence <= sumarDias(hoy, 30)) return { variant: 'warning', label: 'Vence pronto' };
    return { variant: 'success', label: 'Vigente' };
}

/**
 * La lista de clientes con la búsqueda y los filtros de la pestaña. Los
 * documentos se comparan por sus DÍGITOS: «0407-150390» y «0407150390» son el
 * mismo NIT escrito de dos maneras.
 */
export function filtrarClientes(clientes, { buscar = '', tipo = '', soloSinLicencia = false, hoy }) {
    const q = buscar.trim();
    const qd = q.replace(/\D/g, '');
    return (clientes ?? []).filter(c => (!tipo || c.tipo === tipo)
        && (!soloSinLicencia || estadoLicencia(c, hoy).variant !== 'success')
        && (!q || tokenMatch(q, c.nombre, c.nombre_comercial, c.ruta)
            || (qd.length >= 3 && tokenMatch(qd, c.num_documento?.replace(/\D/g, ''), c.nrc))));
}

/** Las cuatro tarjetas de Clientes. */
export function resumenDeClientes(clientes, hoy) {
    const activos = (clientes ?? []).filter(c => c.activo);
    return {
        activos: activos.length,
        contribuyentes: activos.filter(c => c.contribuyente).length,
        sinLicencia: activos.filter(c => estadoLicencia(c, hoy).variant !== 'success').length,
        credito: activos.filter(c => c.plazo_dias > 0).length,
    };
}

export const CLIENTE_VACIO = {
    tipo: 'tienda', nombre: '', nombre_comercial: '', tipo_documento: '13', num_documento: '',
    nrc: '', cod_actividad: '', desc_actividad: '', gran_contribuyente: false,
    departamento: '04', municipio: '', distrito: '', complemento: '', telefono: '', correo: '',
    licencia_srs: '', licencia_srs_vence: '', limite_credito: '0', plazo_dias: '0', ruta: '', ruta_id: '', notas: '', activo: true,
};

/** Una fila de `dist_clientes` → los valores del formulario (todo texto, nada null). */
export const clienteAFormulario = (c) => ({
    ...CLIENTE_VACIO, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? CLIENTE_VACIO[k] ?? ''])),
    num_documento: c.tipo_documento === '36' ? formatearNit(c.num_documento) : (c.num_documento ?? ''),
    limite_credito: String(c.limite_credito ?? 0), plazo_dias: String(c.plazo_dias ?? 0),
});

/**
 * Lo que impide guardar la ficha, por campo. Lo que un Crédito Fiscal exige
 * (NIT, NRC, actividad, dirección completa) lo vuelve a exigir la base con un
 * CHECK: acá se avisa antes, allá se garantiza.
 */
export function erroresDeCliente(f) {
    const e = {};
    const contribuyente = !!f.nrc.trim();
    const digitosDoc = f.num_documento.replace(/\D/g, '');
    if (!f.nombre.trim()) e.nombre = 'Falta el nombre.';
    if (f.num_documento.trim()) {
        if (f.tipo_documento === '13' && !isValidDUIAlgorithm(f.num_documento)) e.num_documento = 'Ese DUI no pasa su dígito verificador.';
        if (f.tipo_documento === '36' && ![9, 14].includes(digitosDoc.length)) e.num_documento = 'Un NIT tiene 9 o 14 dígitos.';
    }
    if (f.nrc.trim() && !/^\d{2,8}$/.test(f.nrc.replace(/\D/g, ''))) e.nrc = 'El NRC son de 2 a 8 dígitos.';
    if (contribuyente) {
        if (f.tipo_documento !== '36' || !digitosDoc) e.num_documento = 'Un contribuyente necesita su NIT para recibir Crédito Fiscal.';
        if (!f.cod_actividad) e.cod_actividad = 'Un contribuyente necesita su actividad económica.';
        if (!f.municipio || !f.distrito || !f.complemento.trim()) e.direccion = 'Un contribuyente necesita la dirección completa.';
    }
    if (f.telefono && f.telefono.replace(/\D/g, '').length !== 8) e.telefono = 'Un teléfono son ocho dígitos.';
    if (leerMonto(f.limite_credito) === null) e.limite_credito = 'Escribe un monto, por ejemplo 1500.00';
    const plazo = leerMonto(f.plazo_dias);
    if (plazo === null || !Number.isInteger(plazo) || plazo > 120) e.plazo_dias = 'De 0 a 120 días.';
    return e;
}

/** Los valores del formulario → la fila que se guarda con `guardarCliente`. */
export function clienteParaGuardar(f, { id, emisorId }) {
    const contribuyente = !!f.nrc.trim();
    const digitosDoc = f.num_documento.replace(/\D/g, '');
    const nit = f.tipo_documento === '36' ? digitosDoc : f.num_documento.trim();
    return {
        id, emisor_id: emisorId, tipo: f.tipo, nombre: f.nombre.trim(),
        nombre_comercial: f.nombre_comercial.trim() || null,
        tipo_documento: nit ? f.tipo_documento : null, num_documento: nit || null,
        nrc: f.nrc.replace(/\D/g, '') || null,
        cod_actividad: f.cod_actividad || null, desc_actividad: f.desc_actividad || null,
        gran_contribuyente: contribuyente && f.gran_contribuyente,
        departamento: f.departamento || null, municipio: f.municipio || null, distrito: f.distrito || null,
        complemento: f.complemento.trim() || null, telefono: f.telefono.replace(/\D/g, '') || null,
        correo: f.correo.trim() || null, licencia_srs: f.licencia_srs.trim() || null,
        licencia_srs_vence: f.licencia_srs_vence || null,
        limite_credito: leerMonto(f.limite_credito), plazo_dias: leerMonto(f.plazo_dias),
        // El texto de la ruta lo pone la base desde `ruta_id`.
        ruta_id: f.ruta_id ? Number(f.ruta_id) : null, ruta: null, notas: f.notas.trim() || null, activo: f.activo,
    };
}

// ── Catálogo ───────────────────────────────────────────────────────────────

/** Los filtros del catálogo: venta libre, sólo farmacias, con descuento hoy, fuera de los pedidos. */
export function filtrarCatalogo(items, { buscar = '', canal = '', hoy }) {
    const q = buscar.trim();
    return (items ?? []).filter(p => (!q || tokenMatch(q, p.nombre))
        && (!canal || (canal === 'libre' ? p.venta_libre && !p.controlado
            : canal === 'farmacia' ? !p.venta_libre || p.controlado
            : canal === 'descuento' ? descuentoDelCatalogo(p, hoy) > 0
            : !p.activo)));
}

export function resumenDeCatalogo(items, hoy) {
    const activos = (items ?? []).filter(p => p.activo);
    return {
        total: activos.length,
        libre: activos.filter(p => p.venta_libre && !p.controlado).length,
        farmacia: activos.filter(p => !p.venta_libre || p.controlado).length,
        descuento: activos.filter(p => descuentoDelCatalogo(p, hoy) > 0).length,
    };
}

/**
 * Lo que se escribió en el formulario del precio, leído: los números, qué está
 * mal, si con el descuento se vende bajo el costo, y si se puede guardar.
 * `costo` es sin IVA y por unidad; el precio es con IVA. «Bajo el costo» avisa
 * y no bloquea: una liquidación de vencimiento puede ser justo lo que se quiere.
 */
export function leerFormularioDePrecio({ precio, descPct, tope, descDesde, descHasta, costo = null }) {
    // Con IVA y en centavos: es lo que paga el cliente, y la columna no guarda
    // más de dos decimales (un tercero se redondearía sin avisar).
    const leido = leerMonto(precio);
    const precioNum = leido !== null && Math.abs(leido * 100 - Math.round(leido * 100)) < 1e-9 ? leido : null;
    const pctNum = String(descPct ?? '').trim() === '' ? 0 : leerMonto(descPct);
    const pctMalo = pctNum === null || pctNum < 0 || pctNum > 100;
    const topeNum = String(tope ?? '').trim() === '' ? null : leerMonto(tope);
    const topeMalo = String(tope ?? '').trim() !== '' && (topeNum === null || topeNum < 0 || topeNum > 100);
    const fechasMal = !!(descDesde && descHasta && descDesde > descHasta);
    const finalSinIva = precioNum !== null && !pctMalo ? (precioNum * (1 - (pctNum || 0) / 100)) / 1.13 : null;
    const bajoCosto = costo !== null && finalSinIva !== null && finalSinIva < costo - 0.0001;
    return {
        precioNum, pctNum, pctMalo, topeNum, topeMalo, fechasMal, finalSinIva, bajoCosto,
        valido: precioNum !== null && !pctMalo && !topeMalo && !fechasMal,
        descuento: {
            descuento_pct: pctNum || 0,
            descuento_desde: pctNum ? descDesde || null : null,
            descuento_hasta: pctNum ? descHasta || null : null,
            descuento_max_pct: topeNum,
        },
    };
}

// ── Proveedores ────────────────────────────────────────────────────────────

const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '');

/** Lo que el formulario del proveedor tiene mal; `listo` = se puede guardar. */
export function leerFormularioDeProveedor(f) {
    const nit = soloDigitos(f.nit);
    const nrc = soloDigitos(f.nrc);
    const plazo = Number(f.plazo_dias);
    const errNit = nit !== '' && !/^\d{9,14}$/.test(nit);
    const errNrc = nrc !== '' && !/^\d{2,8}$/.test(nrc);
    const errPlazo = !Number.isInteger(plazo) || plazo < 0 || plazo > 180;
    return { nit, nrc, plazo, errNit, errNrc, errPlazo, listo: String(f.nombre ?? '').trim() !== '' && !errNit && !errNrc && !errPlazo };
}

export const proveedorAFormulario = (inicial = {}) => ({
    nombre: '', nit: '', nrc: '', telefono: '', correo: '', relacionada: false, gran_contribuyente: false,
    ...inicial, plazo_dias: String(inicial.plazo_dias ?? 0),
});

/** El texto de error de guardar un proveedor (el NIT repetido lo dice la base por su índice). */
export const mensajeDeProveedor = (e, general) =>
    (String(e?.message ?? '').includes('dist_proveedores_nit') ? 'Ya hay un proveedor con ese NIT.' : general(e));

// ── Compras ────────────────────────────────────────────────────────────────

const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const monto = (v) => (v === '' || v === null || v === undefined ? '' : String(v));

export const compraVacia = (hoy) => ({
    client_uuid: nuevoUuid(), proveedor_id: '', tipo_doc: '03', numero: '', codigo_generacion: '', fecha: hoy,
    condicion: 1, vence: '', gravada: '', exenta: '', iva: '', percepcion: '', retencion: '', total: '', nota: '', items: [],
});
export const renglonDeCompraVacio = () => ({ key: nuevoUuid(), product_id: null, cantidad: '', costo_unitario: '', lote: '', vence: '' });

/** Lo que devuelve `fetchCompra` → los valores del formulario. */
export const compraDesdeDetalle = (d) => ({
    id: d.id, client_uuid: d.client_uuid, proveedor_id: String(d.proveedor_id), tipo_doc: d.tipo_doc, numero: d.numero,
    codigo_generacion: d.codigo_generacion ?? '', fecha: d.fecha, condicion: d.condicion, vence: d.vence ?? '',
    gravada: monto(d.gravada), exenta: monto(d.exenta), iva: monto(d.iva), percepcion: monto(d.percepcion),
    retencion: monto(d.retencion), total: monto(d.total), nota: d.nota ?? '',
    items: [...(d.dist_compra_items ?? [])].sort((a, b) => a.id - b.id).map(i => ({
        key: String(i.id), product_id: i.product_id, codigo_proveedor: i.codigo_proveedor, descripcion_proveedor: i.descripcion_proveedor,
        cantidad: String(i.cantidad), costo_unitario: String(Number(i.costo_unitario)), lote: i.lote ?? '', vence: i.vence ?? '',
        lote_id: i.lote_id, nombre: i.products?.nombre,
    })),
});

/**
 * Pone en el formulario lo que se leyó del documento del proveedor
 * (`leerDteDelProveedor`). `prov` es el proveedor registrado con ese NIT, o null.
 */
export const compraConLectura = (x, { compra, items }, prov) => ({
    ...x, ...compra, proveedor_id: prov ? String(prov.id) : x.proveedor_id,
    codigo_generacion: compra.codigo_generacion ?? '',
    gravada: monto(compra.gravada), exenta: monto(compra.exenta), iva: monto(compra.iva),
    percepcion: monto(compra.percepcion), retencion: monto(compra.retencion), total: monto(compra.total),
    vence: compra.condicion === 2 && prov?.plazo_dias ? sumarDias(compra.fecha, prov.plazo_dias) : '',
    items: items.map(it => ({ ...it, key: nuevoUuid(), cantidad: String(it.cantidad), costo_unitario: String(it.costo_unitario) })),
});

/** «Copiar de los productos»: los montos del documento salen de los renglones. */
export function compraConMontosCalculados(x) {
    const calc = totalesCalculados(x.items, x.tipo_doc);
    const gravada = calc.productos;
    const iva = x.tipo_doc === '03' ? calc.iva : 0;
    return { ...x, gravada: String(gravada), exenta: x.exenta || '0', iva: String(iva),
        total: String(totalEsperado({ ...x, gravada, iva })) };
}

/** Los valores del formulario → lo que recibe `guardarCompra`. */
export const payloadDeCompra = (c) => ({
    id: c.id ?? null, client_uuid: c.client_uuid, proveedor_id: Number(c.proveedor_id), tipo_doc: c.tipo_doc,
    numero: c.numero.trim(), codigo_generacion: c.codigo_generacion?.trim() || null, fecha: c.fecha,
    condicion: Number(c.condicion), vence: Number(c.condicion) === 2 ? c.vence || null : null,
    gravada: num(c.gravada), exenta: num(c.exenta), iva: num(c.iva), percepcion: num(c.percepcion), retencion: num(c.retencion), total: num(c.total),
    nota: c.nota,
    items: c.items.filter(it => it.product_id).map(it => ({
        product_id: Number(it.product_id), codigo_proveedor: it.codigo_proveedor ?? null, descripcion_proveedor: it.descripcion_proveedor ?? null,
        unidades_por: it.unidades_por ?? 1, cantidad: Math.round(num(it.cantidad)), costo_unitario: num(it.costo_unitario),
        lote: String(it.lote ?? '').trim().toUpperCase(), vence: it.vence || null,
    })),
});

/** El costo con que se compara contra el precio de mercado: sin IVA (en una Factura el costo lo trae). */
export const costoSinIvaDeRenglon = (it, tipoDoc) => (tipoDoc === '03' ? num(it.costo_unitario) : num(it.costo_unitario) / 1.13);

/** Las tarjetas de Compras: lo del mes (`mes` = 'AAAA-MM') y los borradores. */
export function resumenDeCompras(compras, mes) {
    const delMes = (compras ?? []).filter(c => c.estado === 'recibida' && String(c.fecha).startsWith(mes));
    return {
        comprado: delMes.reduce((a, c) => a + Number(c.total), 0),
        credito: delMes.filter(c => c.tipo_doc === '03').reduce((a, c) => a + Number(c.iva), 0),
        documentos: delMes.length,
        borradores: (compras ?? []).filter(c => c.estado === 'borrador').length,
    };
}

// ── Solicitudes de descuento ───────────────────────────────────────────────

export const ESTADO_SOLICITUD_DESCUENTO = {
    PENDING:   { variant: 'warning', label: 'Por decidir' },
    APPROVED:  { variant: 'success', label: 'Aprobado' },
    REJECTED:  { variant: 'danger',  label: 'Rechazado' },
    CANCELLED: { variant: 'neutral', label: 'Retirada' },
};

// ── La empresa que factura ─────────────────────────────────────────────────

export const TIPO_ESTABLECIMIENTO = [
    { value: '04', label: 'Bodega' },
    { value: '02', label: 'Casa matriz' },
    { value: '01', label: 'Sucursal' },
    { value: '07', label: 'Patio' },
];

export const EMISOR_VACIO = {
    nombre: '', nombre_comercial: '', nit: '', nrc: '', cod_actividad: '', desc_actividad: '',
    departamento: '04', municipio: '', distrito: '', complemento: '', telefono: '', correo: '',
    establecimiento: 'B001', punto_venta: 'P001', tipo_establecimiento: '04',
    cod_estable_mh: '', cod_punto_venta_mh: '', ambiente: '00', gran_contribuyente: false,
};

export const emisorAFormulario = (emisor) => (emisor
    ? { ...EMISOR_VACIO, ...Object.fromEntries(Object.entries(emisor).map(([k, v]) => [k, v ?? EMISOR_VACIO[k] ?? ''])), nit: formatearNit(emisor.nit) }
    : EMISOR_VACIO);

/**
 * El NIT, el NRC y la actividad tienen que ser EXACTAMENTE los de su registro
 * en Hacienda: si no coinciden, rechaza todo lo que se emita.
 */
export function erroresDeEmisor(f) {
    const e = {};
    const nit = f.nit.replace(/\D/g, '');
    if (!f.nombre.trim()) e.nombre = 'Falta la razón social.';
    if (![9, 14].includes(nit.length)) e.nit = 'El NIT tiene 9 o 14 dígitos.';
    if (!/^\d{2,8}$/.test(f.nrc.replace(/\D/g, ''))) e.nrc = 'El NRC son de 2 a 8 dígitos.';
    if (!f.cod_actividad) e.cod_actividad = 'Falta la actividad económica.';
    if (!f.municipio || !f.distrito || !f.complemento.trim()) e.direccion = 'Falta la dirección completa.';
    if (f.telefono.replace(/\D/g, '').length !== 8) e.telefono = 'Un teléfono son ocho dígitos.';
    if (!/^\S+@\S+\.\S+$/.test(f.correo.trim())) e.correo = 'Revisa el correo.';
    if (!/^[MBSP]\d{3}$/.test(f.establecimiento)) e.establecimiento = 'Una letra (M, B, S o P) y tres dígitos. Ej.: B001';
    if (!/^P\d{3}$/.test(f.punto_venta)) e.punto_venta = 'P y tres dígitos. Ej.: P001';
    if (f.cod_estable_mh && f.cod_estable_mh.length !== 4) e.cod_estable_mh = 'Son 4 caracteres.';
    if (f.cod_punto_venta_mh && f.cod_punto_venta_mh.length !== 4) e.cod_punto_venta_mh = 'Son 4 caracteres.';
    return e;
}

/** Los valores del formulario → los cambios que recibe `guardarEmisor`. */
export const emisorParaGuardar = (f) => ({
    nombre: f.nombre.trim(), nombre_comercial: f.nombre_comercial.trim() || null, nit: f.nit.replace(/\D/g, ''),
    nrc: f.nrc.replace(/\D/g, ''), cod_actividad: f.cod_actividad, desc_actividad: f.desc_actividad,
    departamento: f.departamento, municipio: f.municipio, distrito: f.distrito, complemento: f.complemento.trim(),
    telefono: f.telefono.replace(/\D/g, ''), correo: f.correo.trim(),
    establecimiento: f.establecimiento, punto_venta: f.punto_venta, tipo_establecimiento: f.tipo_establecimiento,
    cod_estable_mh: f.cod_estable_mh || null, cod_punto_venta_mh: f.cod_punto_venta_mh || null,
    ambiente: f.ambiente, gran_contribuyente: f.gran_contribuyente,
});
