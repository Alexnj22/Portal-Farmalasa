// Los dos papeles de un documento de Distribución: el TICKET de venta (rollo
// térmico) y el PDF (la «representación gráfica» del DTE).
//
// ── La regla que manda todo: el papel sale del JSON ────────────────────────
// El DTE es el JSON firmado. El PDF y el ticket sólo lo representan, y la
// norma exige que digan lo mismo que él, con sus rótulos (Manual Funcional
// v2.0 §XXII). Por eso los dos se arman leyendo `dte.json` —el mismo objeto que
// se firmó y se mandó a Hacienda— y NUNCA el pedido, la ficha del cliente o el
// catálogo: si alguien corrige una ficha después de facturar, el papel de ese
// documento no puede cambiar.
//
// Sin sello no hay documento completo: el papel lo dice en letras, no lo
// esconde. Y en ambiente de pruebas lo dice también.
import { ubicacionMH } from '../data/geoCodigosMH';
import { dibujarQR, imprimirDocumento } from './ticketPrint';
import { hora12 } from './hora';
import { relojSV } from './fecha';
import { formatMoney } from './formatNumber';

export const NOMBRE_DOCUMENTO = {
    '01': 'FACTURA',
    '03': 'COMPROBANTE DE CREDITO FISCAL',
    '04': 'NOTA DE REMISION',
    '05': 'NOTA DE CREDITO',
    '06': 'NOTA DE DEBITO',
};

const CONDICION = { 1: 'Contado', 2: 'Credito', 3: 'Otro' };
// CAT-014: las que usa una droguería (catalogos.ts); el resto se muestra por número.
const UNIDAD_MEDIDA = { 59: 'Unidad', 99: 'Otra' };

// El lote y el vencimiento viajan al final de la descripción, dentro del JSON
// firmado (supabase/functions/_shared/dte/lotes.ts los escribe así). El papel
// los separa en sus columnas; si la cola no está, la descripción queda entera.
const COLA_DE_LOTE = / LOTE: (.+?)(?: VENCE: (\d{2}\/\d{2}\/\d{4}))?$/;
export function separarLote(descripcion) {
    const m = String(descripcion ?? '').match(COLA_DE_LOTE);
    if (!m) return { descripcion: descripcion ?? '', lote: null, vence: null };
    return { descripcion: descripcion.slice(0, m.index), lote: m[1], vence: m[2] ?? null };
}
const PLAZO = { '01': 'dias', '02': 'meses', '03': 'anios' };

/** La consulta pública de Hacienda: lo que abre el QR del papel. */
export const urlConsultaPublica = ({ ambiente, codigo_generacion, fec_emi }) =>
    `https://admin.factura.gob.sv/consultaPublica?ambiente=${ambiente}&codGen=${String(codigo_generacion).toUpperCase()}&fechaEmi=${fec_emi}`;

const dinero = (n) => formatMoney(Number(n ?? 0));
const cantidad = (n) => {
    const v = Number(n ?? 0);
    return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, '');
};
const formatoNit = (d) => {
    const s = String(d ?? '').replace(/\D/g, '');
    if (s.length === 14) return `${s.slice(0, 4)}-${s.slice(4, 10)}-${s.slice(10, 13)}-${s.slice(13)}`;
    if (s.length === 9) return `${s.slice(0, 8)}-${s.slice(8)}`;
    return d ?? '';
};
const formatoNrc = (d) => {
    const s = String(d ?? '').replace(/\D/g, '');
    return s.length >= 2 ? `${s.slice(0, -1)}-${s.slice(-1)}` : (d ?? '');
};
const fechaDdMm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const direccionDe = (d) => {
    if (!d) return '';
    const u = ubicacionMH(d.departamento, d.municipio, d.distrito);
    return [d.complemento, u].filter(Boolean).join(', ');
};

/** Lo que el papel necesita, leído del DTE sin inventar nada. */
export function leerDocumento(dte) {
    const j = dte.json;
    const id = j.identificacion;
    const r = j.receptor ?? {};
    const res = j.resumen;
    const iva = res.tributos?.find(t => t.codigo === '20')?.valor ?? res.totalIva ?? 0;
    const docReceptor = r.nit ? `NIT ${formatoNit(r.nit)}`
        : r.numDocumento ? `${r.tipoDocumento === '36' ? 'NIT' : r.tipoDocumento === '13' ? 'DUI' : 'Doc.'} ${r.tipoDocumento === '36' ? formatoNit(r.numDocumento) : r.numDocumento}`
            : '';
    const pago = res.pagos?.[0];
    return {
        tipo: id.tipoDte,
        nombre: NOMBRE_DOCUMENTO[id.tipoDte] ?? 'DOCUMENTO',
        prueba: id.ambiente === '00',
        sellado: dte.sello_recibido?.length === 40,
        sello: dte.sello_recibido ?? null,
        numeroControl: id.numeroControl,
        codigoGeneracion: id.codigoGeneracion,
        fecha: fechaDdMm(id.fecEmi),
        hora: hora12(id.horEmi),
        modelo: id.tipoModelo === 2 ? 'Diferido' : 'Previo',
        transmision: id.tipoOperacion === 2 ? 'Contingencia' : 'Normal',
        emisor: {
            nombre: j.emisor.nombre,
            comercial: j.emisor.nombreComercial,
            nit: formatoNit(j.emisor.nit),
            nrc: formatoNrc(j.emisor.nrc),
            actividad: j.emisor.descActividad,
            direccion: direccionDe(j.emisor.direccion),
            telefono: j.emisor.telefono,
            correo: j.emisor.correo,
            establecimiento: [j.emisor.codEstable, j.emisor.codPuntoVenta].filter(Boolean).join(' · ') || null,
        },
        receptor: {
            nombre: r.nombre ?? 'Consumidor final',
            comercial: r.nombreComercial ?? null,
            documento: docReceptor,
            nrc: r.nrc ? formatoNrc(r.nrc) : null,
            actividad: r.descActividad ?? null,
            direccion: direccionDe(r.direccion),
            telefono: r.telefono ?? null,
            correo: r.correo ?? null,
        },
        version: id.version,
        invalidado: !!dte.invalidado_at,
        relacionados: (j.documentoRelacionado ?? []).map(r => ({
            tipo: NOMBRE_DOCUMENTO[r.tipoDocumento] ?? `Tipo ${r.tipoDocumento}`,
            generacion: r.tipoGeneracion === 2 ? 'Electrónico' : 'Físico',
            numero: r.numeroDocumento,
            fecha: fechaDdMm(r.fechaEmision),
        })),
        apendice: (j.apendice ?? []).map(a => [a.etiqueta, a.valor]),
        renglones: j.cuerpoDocumento.map(c => ({
            ...separarLote(c.descripcion),
            n: c.numItem,
            codigo: c.codigo ?? '',
            unidad: UNIDAD_MEDIDA[c.uniMedida] ?? (c.uniMedida != null ? String(c.uniMedida) : ''),
            cantidad: cantidad(c.cantidad),
            precio: c.precioUni,
            descuento: c.montoDescu,
            noSujeta: c.ventaNoSuj,
            exenta: c.ventaExenta,
            gravada: c.ventaGravada,
        })),
        resumenCrudo: res,
        resumen: {
            gravada: res.totalGravada,
            exenta: res.totalExenta,
            noSujeta: res.totalNoSuj,
            descuento: res.totalDescu,
            subTotal: res.subTotal ?? res.subTotalVentas,
            iva,
            // En la Factura el IVA va DENTRO del precio: se informa, no se suma.
            ivaIncluido: id.tipoDte === '01',
            percepcion: res.ivaPerci ?? 0,
            retencion: res.ivaRete ?? 0,
            total: res.totalPagar ?? res.montoTotalOperacion,
            letras: res.totalLetras,
        },
        condicion: res.condicionOperacion
            ? `${CONDICION[res.condicionOperacion] ?? ''}${pago?.plazo ? ` a ${pago.periodo} ${PLAZO[pago.plazo] ?? ''}` : ''}`
            : null,
        observaciones: res.observaciones ?? null,
        qr: urlConsultaPublica(dte),
    };
}

// ── Ticket ─────────────────────────────────────────────────────────────────

/**
 * El objeto que espera `imprimirDocumento`. Sólo ASCII y rótulos cortos: el
 * rollo no lee UTF-8 (IMPRESION-EN-TICKETERA §5) y `soloASCII` le quita las
 * tildes en el envío, pero un rótulo pensado sin ellas se lee mejor.
 */
// Las formas de pago como las dice el papel (sin tildes: el rollo no lee UTF-8).
const FORMA_EN_PAPEL = { '01': 'Efectivo', '02': 'T. debito', '03': 'T. credito', '04': 'Cheque', '05': 'Transferencia', '13': 'Credito' };

/**
 * ¿El ticket lleva el QR? NO (pedido del usuario, 2026-09-30: «quita el QR si
 * no es necesario, así ahorramos papel»). El papel conserva lo que permite
 * verificar el documento a mano —código de generación, fecha y sello—, y el
 * QR sigue en el PDF y en el JSON que recibe el cliente. Si la revisión con el
 * contador dice que el ticket también lo debe llevar, se enciende acá.
 */
const QR_EN_TICKET = false;

/**
 * El objeto que espera `imprimirDocumento`. Sólo ASCII y rótulos cortos: el
 * rollo no lee UTF-8 (IMPRESION-EN-TICKETERA §5) y `soloASCII` le quita las
 * tildes en el envío, pero un rótulo pensado sin ellas se lee mejor.
 *
 * ── Un producto, una línea (2026-09-30) ─────────────────────────────────────
 * CANT · DESCRIPCION · P.UNIT · TOTAL, con la cantidad delante (el usuario lo
 * prefiere así: «es más ordenado visualmente»). Antes un producto ocupaba
 * cinco renglones porque las cuatro columnas tenían el mismo ancho y la
 * descripción quedaba en un cuarto del papel; ahora la descripción se lleva el
 * ancho. En la impresora, `cantidadPrimero` le dice al maquetador del rollo el
 * orden (su geometría medida esperaba el nombre primero y el nombre caía en el
 * hueco de la cantidad). Un nombre largo sigue abajo, nunca se recorta.
 *
 * `pagos` (de `dist_pagos`): el papel dice cómo se pagó y, en efectivo, cuánto
 * entregó el cliente y el CAMBIO — el dato que se discute en el mostrador.
 */
export function ticketDeVenta(dte, marca = null, { pagos = [] } = {}) {
    const d = leerDocumento(dte);
    const res = d.resumen;
    const totales = [];
    if (!res.ivaIncluido) {
        totales.push(['SUMAS', dinero(res.subTotal)], ['IVA 13%', dinero(res.iva)]);
    }
    if (res.percepcion) totales.push(['IVA PERCIBIDO', dinero(res.percepcion)]);
    if (res.retencion) totales.push(['IVA RETENIDO', `-${dinero(res.retencion)}`]);
    totales.push(['TOTAL', dinero(res.total), true]);
    if (res.ivaIncluido) totales.push(['IVA incluido', dinero(res.iva)]);
    // Cómo se pagó; en efectivo, lo entregado y el cambio.
    for (const p of pagos ?? []) {
        const monto = Number(p.monto ?? 0);
        const forma = FORMA_EN_PAPEL[p.forma] ?? 'Pago';
        const recibido = p.forma === '01' && p.efectivo_recibido != null ? Number(p.efectivo_recibido) : null;
        if (recibido != null && recibido > monto) {
            totales.push([`${forma} recibido`, dinero(recibido)], ['CAMBIO', dinero(recibido - monto)]);
        } else if ((pagos?.length ?? 0) > 1 || p.forma !== '01') {
            totales.push([forma, dinero(monto)]);
        }
    }

    return {
        titulo: d.nombre,
        tituloDeCola: `${d.nombre} ${d.numeroControl.slice(-6)}`,
        // La marca va arriba, como membrete; los datos fiscales, debajo y tal
        // cual los dice el DTE. El rollo no lleva el icono: una imagen por el
        // camino directo es un comando que esa impresora todavía no probó, y
        // uno que no entiende se traga el trabajo siguiente (ticketPrint.js).
        // ── Que se lea de corrido (2026-09-30) ──
        // Pedido del usuario: «que se sienta más fluido visualmente». Membrete
        // sin repetir el nombre comercial (ya es el título); fecha y condición en
        // un solo renglón; el CLIENTE en su propio bloque —su nombre a lo ancho y
        // debajo su documento—, en vez de un valor largo pegado a la derecha que
        // se partía en «S.A. DE / C.V.»; y en el pie, cada rótulo arriba y su
        // dato abajo, para que un código de 36 caracteres no se corte a la mitad.
        encabezado: {
            titulo: (marca?.nombre ?? d.emisor.comercial ?? d.emisor.nombre).toUpperCase(),
            lineas: [
                marca || d.emisor.comercial ? d.emisor.nombre : null,
                `NIT ${d.emisor.nit}  NRC ${d.emisor.nrc}`,
                d.emisor.direccion,
                d.emisor.telefono ? `Tel. ${d.emisor.telefono}` : null,
            ].filter(Boolean),
        },
        datos: [
            ['Fecha', `${d.fecha} ${d.hora}`],
            ...(d.condicion ? [['Pago', d.condicion]] : []),
        ],
        bloques: [
            // En pruebas se dice en UNA línea: el aviso en letra gigante
            // gastaba cinco renglones de rollo en cada ticket de prueba.
            ...(d.prueba ? [{ titulo: 'PRUEBA - SIN VALIDEZ FISCAL' }] : []),
            {
                titulo: 'Cliente',
                texto: d.receptor.nombre,
                filas: [
                    ...(d.receptor.documento ? [[d.receptor.documento.split(' ')[0], d.receptor.documento.split(' ').slice(1).join(' ')]] : []),
                    ...(d.receptor.nrc ? [['NRC', d.receptor.nrc]] : []),
                ],
            },
        ],
        items: {
            cantidadPrimero: true,
            columnas: [
                { label: 'CANT', ancho: '11%' },
                { label: 'DESCRIPCION', ancho: '53%' },
                { label: 'P.UNIT', ancho: '17%', alinear: 'der' },
                { label: 'TOTAL', ancho: '19%', alinear: 'der' },
            ],
            // En el rollo el lote va pegado a la descripción: no hay ancho
            // para dos columnas más, y separado del producto se pierde.
            filas: d.renglones.map(r => [
                r.cantidad,
                // Vence como mes/año («V:11/27»): en el rollo cada carácter es
                // papel, y el día no cambia qué lote es.
                r.lote ? `${r.descripcion} L:${r.lote}${r.vence ? ` V:${r.vence.slice(3, 5)}/${r.vence.slice(8, 10)}` : ''}` : r.descripcion,
                dinero(r.precio).replace('$', ''),
                dinero(r.gravada + r.exenta + r.noSujeta).replace('$', ''),
            ]),
        },
        totales,
        total_letras: res.letras,
        pie: [
            'NUMERO DE CONTROL', d.numeroControl,
            'CODIGO DE GENERACION', d.codigoGeneracion,
            ...(d.sellado ? ['SELLO DE RECEPCION', d.sello] : ['PENDIENTE DEL SELLO DE HACIENDA']),
            ...(d.observaciones ? [d.observaciones] : []),
            QR_EN_TICKET ? 'Verifique este documento con el codigo QR.' : 'Consultelo en Hacienda con su codigo.',
        ],
        ...(QR_EN_TICKET ? { qr: d.qr } : {}),
    };
}

export const imprimirTicketDeVenta = (dte, marca = null, opciones = {}) => imprimirDocumento(ticketDeVenta(dte, marca, opciones), {
    tituloDeCola: `${NOMBRE_DOCUMENTO[dte.tipo] ?? 'Documento'} ${dte.numero_control.slice(-6)}`,
});

// ── PDF ────────────────────────────────────────────────────────────────────

let pdfMakePromise = null;
function getPdfMake() {
    if (!pdfMakePromise) {
        pdfMakePromise = Promise.all([
            import('pdfmake/build/pdfmake'),
            import('pdfmake/build/vfs_fonts'),
        ]).then(([mk, fonts]) => {
            const pdfMake = mk.default || mk;
            pdfMake.addVirtualFileSystem(fonts.default || fonts);
            return pdfMake;
        }).catch((err) => { pdfMakePromise = null; throw err; });
    }
    return pdfMakePromise;
}

const GRIS = '#5b6770';
const TINTA = '#1c2b33';
const LINEA = '#d5dee2';
const celda = (text, extra = {}) => ({ text: String(text ?? ''), fontSize: 8, color: TINTA, ...extra });
const par = (rotulo, valor) => ({
    text: [{ text: `${rotulo}  `, bold: true, color: GRIS, fontSize: 7 }, { text: String(valor ?? '—'), color: TINTA }],
    fontSize: 8, margin: [0, 1.5, 0, 1.5],
});
const parApilado = (rotulo, valor) => ({
    stack: [
        { text: rotulo, bold: true, color: GRIS, fontSize: 7 },
        { text: String(valor ?? '—'), fontSize: 7.5, color: TINTA, characterSpacing: 0.1 },
    ],
    margin: [0, 2, 0, 2],
});
// Sin marca, el papel sale en grises: la marca la decide la pantalla.
const SIN_MARCA = { petroleo: '#33424a', petroleoClaro: '#f1f3f4', naranja: '#9aa5ab', naranjaTexto: '#5b6770' };
let C = SIN_MARCA;
const rotuloDeSeccion = (t) => ({ text: t.toUpperCase(), bold: true, fontSize: 7.5, color: C.petroleo, characterSpacing: 1.2, margin: [0, 0, 0, 4] });

// Un panel: fondo petróleo muy claro, sin bordes. Da orden sin pedir tinta: en
// una impresora en blanco y negro sale como un gris apenas visible.
const panel = (stack, extra = {}) => ({
    table: { widths: ['*'], body: [[{ stack, fillColor: C.petroleoClaro, margin: [8, 7, 8, 7] }]] },
    layout: 'noBorders', ...extra,
});

// Las líneas de una tabla: sólo horizontales y finas; la cabecera, sin borde.
const lineasSuaves = {
    hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
    vLineWidth: () => 0,
    hLineColor: () => LINEA,
    paddingTop: () => 4, paddingBottom: () => 4, paddingLeft: () => 5, paddingRight: () => 5,
};

// El cierre (letras + totales) va SIEMPRE al pie de la última hoja, a la
// misma altura en todo documento: quien lo revisa sabe dónde mirar sin buscar.
// Las filas salen del RESUMEN del propio JSON, en el orden del formato de
// Hacienda, y se muestran aunque valgan cero: el bloque tiene siempre la misma
// forma, y un campo que el tipo de documento no trae no se inventa.
const FILAS_DEL_CIERRE = [
    ['subTotalVentas', 'Suma total de operaciones'],
    ['descuNoSuj', 'Descuento a ventas no sujetas'],
    ['descuExenta', 'Descuento a ventas exentas'],
    ['descuGravada', 'Descuento a ventas gravadas'],
    ['__iva', 'IVA 13%'],
    ['subTotal', 'Sub-total'],
    ['ivaPerci', 'IVA percibido'],
    ['ivaRete', 'IVA retenido', -1],
    ['montoTotalOperacion', 'Monto total de la operación'],
    ['totalNoGravado', 'Total otros montos no afectos'],
];
// Medido en el PDF: una fila de 8pt con relleno 4+4 ocupa ~17.3pt, y la del
// total ~24. Con 15.6 (la cuenta a ojo) el total se salía de la hoja y
// pdfmake lo pasaba solo a otra.
const ALTO_FILA = 17.5;
const ALTO_TOTAL = 26;
const PAGINA = { alto: 792, ancho: 612, margen: 36, pie: 52 };
const ANCHO = PAGINA.ancho - 2 * PAGINA.margen;

/**
 * La definición del PDF. Carta, con el membrete de la marca: los colores van en
 * rellenos y rótulos, nunca en un dato, y todo se sigue leyendo impreso en
 * blanco y negro. Lo que la norma exige (Manual Funcional §XXII) está todo y
 * sale del JSON firmado; la marca sólo lo ordena.
 *
 * Con muchos renglones el documento sigue en otra hoja: la cabecera de la
 * tabla se repite, desde la segunda hoja arriba se repite quién emite y qué
 * documento es (una hoja suelta tiene que poder identificarse sola), y el
 * cierre cae al pie de la ÚLTIMA. Si los renglones llegan hasta donde iría el
 * cierre, se abre una hoja más para él — nunca se encima.
 */
export function definicionPdf(dte, qrSvg, marca = null) {
    C = marca?.colores ?? SIN_MARCA;
    const d = leerDocumento(dte);
    const res = d.resumen;
    const crudo = d.resumenCrudo;

    // Filas del cierre: sólo las que el esquema de este tipo trae.
    const filas = FILAS_DEL_CIERRE.flatMap(([k, rotulo, signo = 1]) => {
        if (k === '__iva') {
            if (res.ivaIncluido) return [];
            const iva = (crudo.tributos ?? []).find(t => t.codigo === '20');
            return crudo.tributos ? [[rotulo, iva?.valor ?? 0]] : [];
        }
        return k in crudo ? [[rotulo, Number(signo) * Number(crudo[k] ?? 0)]] : [];
    });
    const izquierda = [
        par('Valor en letras', res.letras),
        ...(d.condicion ? [par('Condición de la operación', d.condicion)] : []),
        ...(res.ivaIncluido ? [par('IVA incluido en el precio', dinero(res.iva))] : []),
        par('Observaciones', d.observaciones || '—'),
    ];
    // La altura del cierre se calcula, no se mide: pdfmake no la sabe antes de
    // dibujar. Se estima por arriba (las letras y las observaciones pueden
    // ocupar dos renglones cada una).
    const altoCierre = Math.max(
        filas.length * ALTO_FILA + ALTO_TOTAL + 8,
        24 + 13 * (izquierda.length + Math.ceil(String(d.observaciones ?? '').length / 60)),
    );
    const yCierre = PAGINA.alto - PAGINA.pie - altoCierre - 4;

    const cierre = {
        absolutePosition: { x: PAGINA.margen, y: yCierre },
        columns: [
            { width: '*', stack: izquierda },
            {
                width: 220,
                table: {
                    widths: ['*', 76],
                    body: [
                        ...filas.map(([t, v]) => [celda(t, { color: GRIS }), celda(v < 0 ? `-${dinero(-v)}` : dinero(v), { alignment: 'right' })]),
                        [
                            celda('TOTAL A PAGAR', { bold: true, fontSize: 9.5, color: '#ffffff', fillColor: C.petroleo, margin: [0, 2, 0, 2] }),
                            celda(dinero(res.total), { bold: true, fontSize: 11, color: '#ffffff', fillColor: C.petroleo, alignment: 'right', margin: [0, 1, 0, 1] }),
                        ],
                    ],
                },
                layout: lineasSuaves,
            },
        ],
        columnGap: 20,
    };

    const sumas = (k) => d.renglones.reduce((t, r) => t + Number(r[k] ?? 0), 0);
    const conLotes = d.renglones.some(r => r.lote);
    const marcaDeAgua = d.invalidado ? 'DOCUMENTO INVALIDADO' : d.prueba ? 'SIN VALIDEZ FISCAL' : null;

    return {
        pageSize: 'LETTER',
        pageMargins: [PAGINA.margen, 40, PAGINA.margen, PAGINA.pie],
        info: { title: `${d.nombre} ${d.numeroControl}`, author: d.emisor.nombre, creator: marca?.nombre ?? d.emisor.nombre },
        ...(marcaDeAgua ? { watermark: { text: marcaDeAgua, color: d.invalidado ? '#b91c1c' : '#999999', opacity: 0.12, bold: true } } : {}),
        // Si el guardián del cierre quedó donde el cierre se encimaría con los
        // renglones, se abre una hoja más.
        pageBreakBefore: (nodo) => nodo.id === 'guarda-del-cierre' && nodo.startPosition.top > yCierre - 8,
        header: (actual, total) => (actual === 1 ? null : {
            margin: [PAGINA.margen, 16, PAGINA.margen, 0],
            columns: [
                { text: [{ text: marca?.nombre ?? d.emisor.nombre, bold: true, color: C.petroleo }, { text: `  ·  ${d.nombre}`, color: TINTA }], fontSize: 7.5 },
                { text: `${d.numeroControl}  ·  ${d.fecha}  ·  Hoja ${actual} de ${total}`, fontSize: 7.5, color: GRIS, alignment: 'right' },
            ],
        }),
        footer: (actual, total) => ({
            margin: [PAGINA.margen, 14, PAGINA.margen, 0],
            stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: ANCHO, y2: 0, lineWidth: 0.6, lineColor: LINEA }] },
                {
                    margin: [0, 5, 0, 0],
                    columns: [
                        { text: marca ? [{ text: marca.nombre, bold: true, color: C.petroleo }, { text: `  ·  ${d.emisor.nombre}`, color: GRIS }] : d.emisor.nombre, fontSize: 7, color: GRIS },
                        { text: d.invalidado ? 'Documento invalidado ante el Ministerio de Hacienda' : d.sellado ? 'Documento sellado por el Ministerio de Hacienda' : 'Documento pendiente del sello de Hacienda', fontSize: 7, color: GRIS, alignment: 'center' },
                        { text: actual < total ? `Página ${actual} de ${total} · continúa` : `Página ${actual} de ${total}`, alignment: 'right', fontSize: 7, color: GRIS },
                    ],
                },
            ],
        }),
        content: [
            // ── Membrete ──
            {
                columns: [
                    ...(marca?.iconoSvg ? [{ width: 46, svg: marca.iconoSvg, fit: [46, 46] }] : []),
                    {
                        width: '*', margin: [marca?.iconoSvg ? 10 : 0, 5, 0, 0],
                        stack: [
                            { text: marca?.nombre ?? d.emisor.comercial ?? d.emisor.nombre, bold: true, fontSize: marca ? 21 : 15, color: C.petroleo, lineHeight: 0.9 },
                            ...(marca?.bajada ? [{ text: marca.bajada.toUpperCase(), bold: true, fontSize: 7, color: C.naranjaTexto, characterSpacing: 2.4, margin: [1, 3, 0, 0] }] : []),
                        ],
                    },
                    {
                        width: 210,
                        table: {
                            widths: ['*'],
                            body: [[{
                                fillColor: C.petroleo, margin: [10, 7, 10, 7],
                                stack: [
                                    { text: 'DOCUMENTO TRIBUTARIO ELECTRÓNICO', fontSize: 6.5, bold: true, color: '#cfe8ec', characterSpacing: 0.8, alignment: 'center' },
                                    { text: d.nombre, bold: true, fontSize: 11, color: '#ffffff', alignment: 'center', margin: [0, 3, 0, 0] },
                                ],
                            }]],
                        },
                        layout: 'noBorders',
                    },
                ],
            },
            { canvas: [{ type: 'rect', x: 0, y: 0, w: ANCHO, h: 2.2, color: C.naranja }], margin: [0, 10, 0, 12] },

            // ── Emisor · identificación · QR ──
            {
                columns: [
                    {
                        width: '*',
                        stack: [
                            rotuloDeSeccion('Emisor'),
                            { text: d.emisor.nombre, bold: true, fontSize: 10.5, color: TINTA },
                            ...(d.emisor.comercial && d.emisor.comercial !== d.emisor.nombre ? [{ text: d.emisor.comercial, fontSize: 8.5, color: TINTA, margin: [0, 1, 0, 0] }] : []),
                            { text: d.emisor.actividad, fontSize: 7.5, color: GRIS, margin: [0, 2, 0, 4] },
                            { columns: [par('NIT', d.emisor.nit), par('NRC', d.emisor.nrc)] },
                            par('Dirección', d.emisor.direccion),
                            { columns: [par('Teléfono', d.emisor.telefono), par('Correo', d.emisor.correo)] },
                            ...(d.emisor.establecimiento ? [par('Establecimiento · punto de venta', d.emisor.establecimiento)] : []),
                        ],
                    },
                    {
                        width: 250,
                        ...panel([
                            {
                                columns: [
                                    {
                                        width: '*',
                                        stack: [
                                            par('Emisión', `${d.fecha} ${d.hora}`),
                                            par('Modelo', d.modelo), par('Transmisión', d.transmision),
                                            par('Versión del JSON', d.version),
                                            parApilado('Número de control', d.numeroControl),
                                        ],
                                    },
                                    ...(qrSvg ? [{
                                        width: 66,
                                        stack: [
                                            { svg: qrSvg, width: 64, alignment: 'center' },
                                            { text: 'Verifique en Hacienda', fontSize: 6, color: GRIS, alignment: 'center', margin: [0, 2, 0, 0] },
                                        ],
                                    }] : []),
                                ],
                                columnGap: 8,
                            },
                            // Los dos códigos largos van a lo ancho: son 36 y 40
                            // caracteres sin espacios y no se pueden partir.
                            parApilado('Código de generación', d.codigoGeneracion),
                            parApilado('Sello de recepción', d.sellado ? d.sello : 'PENDIENTE'),
                        ]),
                    },
                ],
                columnGap: 16,
            },

            // ── Receptor ──
            {
                margin: [0, 14, 0, 0],
                ...panel([
                    rotuloDeSeccion('Receptor'),
                    {
                        columns: [
                            { width: '*', stack: [
                                { text: d.receptor.nombre, bold: true, fontSize: 9.5, color: TINTA, margin: [0, 0, 0, 2] },
                                ...(d.receptor.comercial && d.receptor.comercial !== d.receptor.nombre ? [par('Nombre comercial', d.receptor.comercial)] : []),
                                par('Documento', d.receptor.documento || '—'),
                                ...(d.receptor.nrc ? [par('NRC', d.receptor.nrc)] : []),
                                ...(d.receptor.actividad ? [par('Actividad', d.receptor.actividad)] : []),
                            ] },
                            { width: '*', stack: [
                                par('Dirección', d.receptor.direccion || '—'),
                                par('Teléfono', d.receptor.telefono || '—'),
                                par('Correo', d.receptor.correo || '—'),
                            ] },
                        ],
                        columnGap: 16,
                    },
                ]),
            },

            // ── Renglones ──
            {
                margin: [0, 14, 0, 0],
                table: {
                    headerRows: 1,
                    dontBreakRows: true,
                    // Lote y vence sólo si el documento los trae: uno sin lotes
                    // (anterior al inventario) no lleva dos columnas vacías.
                    // Con lote son doce columnas en 540pt: el relleno de las
                    // celdas (5+5) solo se comía 120pt y la descripción
                    // quedaba en 40, partida en cuatro renglones (medido).
                    widths: conLotes
                        ? [10, 30, 22, 26, '*', 40, 38, 40, 30, 34, 34, 42]
                        : [14, 44, 28, 32, '*', 46, 38, 44, 42, 50],
                    body: [
                        ['N°', 'Código', 'Cant.', 'Unidad', 'Descripción', ...(conLotes ? ['Lote', 'Vence'] : []), 'Precio unit.', 'Desc.', 'No sujetas', 'Exentas', 'Gravadas']
                            .map((t, i) => celda(t, { bold: true, color: '#ffffff', fillColor: C.petroleo, fontSize: 7, alignment: i < (conLotes ? 7 : 5) ? 'left' : 'right' })),
                        ...d.renglones.map((r, i) => {
                            const fondo = i % 2 ? '#f5f8f9' : null;
                            const num = (v) => celda(dinero(v), { alignment: 'right', fillColor: fondo });
                            return [
                                celda(r.n, { color: GRIS, fillColor: fondo }), celda(r.codigo, { fontSize: 7, fillColor: fondo }),
                                celda(r.cantidad, { alignment: 'right', fillColor: fondo }), celda(r.unidad, { fontSize: 7, fillColor: fondo }),
                                celda(r.descripcion, { fillColor: fondo }),
                                ...(conLotes ? [celda(r.lote ?? '—', { fontSize: 7, fillColor: fondo }), celda(r.vence ?? '—', { fontSize: 7, fillColor: fondo })] : []),
                                num(r.precio), num(r.descuento), num(r.noSujeta), num(r.exenta), num(r.gravada),
                            ];
                        }),
                        [
                            { text: 'Sumas', colSpan: conLotes ? 9 : 7, alignment: 'right', bold: true, fontSize: 8, color: TINTA }, ...Array(conLotes ? 8 : 6).fill({}),
                            ...[sumas('noSujeta'), sumas('exenta'), sumas('gravada')].map(v => celda(dinero(v), { alignment: 'right', bold: true })),
                        ],
                    ],
                },
                layout: conLotes ? { ...lineasSuaves, paddingLeft: () => 3, paddingRight: () => 3 } : lineasSuaves,
            },

            // ── Documentos relacionados (notas de crédito y débito, remisiones) ──
            ...(d.relacionados.length ? [
                { ...rotuloDeSeccion('Documentos relacionados'), margin: [0, 12, 0, 4] },
                {
                    table: {
                        headerRows: 1,
                        widths: ['*', 70, 190, 60],
                        body: [
                            ['Tipo de documento', 'Generación', 'Número o código', 'Fecha'].map(t => celda(t, { bold: true, color: GRIS, fontSize: 7 })),
                            ...d.relacionados.map(r => [celda(r.tipo), celda(r.generacion), celda(r.numero, { fontSize: 7.5 }), celda(r.fecha)]),
                        ],
                    },
                    layout: lineasSuaves,
                },
            ] : []),

            // ── Apéndice: datos del emisor que viajan en el JSON ──
            ...(d.apendice.length ? [
                { ...rotuloDeSeccion('Información adicional'), margin: [0, 12, 0, 2] },
                { columns: [0, 1].map(k => ({ width: '*', stack: d.apendice.filter((_, i) => i % 2 === k).map(([e, v]) => par(e, v)) })), columnGap: 16 },
            ] : []),

            // ── El cierre, al pie de la última hoja ──
            // Un espacio y no '': pdfmake no le consulta `pageBreakBefore` a un
            // nodo de texto vacío, y el guardián quedaba mudo (medido).
            { id: 'guarda-del-cierre', text: ' ', fontSize: 1 },
            cierre,
        ],
        defaultStyle: { font: 'Roboto', color: TINTA },
    };
}

/** El PDF como `Blob`, para verlo en pantalla o descargarlo. */
export async function pdfDelDocumento(dte, marca = null) {
    const [pdfMake, qr] = await Promise.all([getPdfMake(), dibujarQR(urlConsultaPublica(dte)).catch(() => '')]);
    const doc = pdfMake.createPdf(definicionPdf(dte, qr || null, marca));
    // pdfmake 0.3 devuelve una promesa; la 0.2 recibía un callback. Se aceptan las dos.
    return doc.getBlob.length ? new Promise(r => doc.getBlob(r)) : doc.getBlob();
}

/**
 * El archivo JSON que se le entrega al cliente: el documento TAL CUAL se firmó,
 * más la firma y el sello de Hacienda. Es la forma en que lo entregan todos los
 * proveedores que nos facturan a nosotros (medido sobre 7 emisores distintos el
 * 2026-09-28): sin `firmaElectronica` y `selloRecibido`, el cliente recibe un
 * documento que no puede demostrar que Hacienda lo recibió. Lo que no hay
 * (sin firmar, sin sello) no se inventa: la clave no va.
 */
export const jsonParaElCliente = (dte) => ({
    ...dte.json,
    ...(dte.firmado ? { firmaElectronica: dte.firmado } : {}),
    ...(dte.sello_recibido?.length === 40 ? { selloRecibido: dte.sello_recibido } : {}),
});

export const nombreDelPdf = (dte) =>
    `${(NOMBRE_DOCUMENTO[dte.tipo] ?? 'DOCUMENTO').replace(/\s+/g, '-')}-${dte.numero_control.slice(-6)}-${String(dte.codigo_generacion).toUpperCase()}.pdf`;

// ── Comprobante provisional (venta sin señal) ──────────────────────────────

/**
 * El papel de una venta hecha SIN SEÑAL (2026-09-30). No es el documento
 * tributario —ése se emite en contingencia al volver la señal, con la hora de
 * la venta—, pero ya lleva el CÓDIGO DE GENERACIÓN que va a tener, así el
 * cliente puede consultarlo en Hacienda después. Mismo formato compacto que el
 * ticket de venta.
 */
/** @typedef {{ nombre?: string, nombre_comercial?: string, nit?: string, nrc?: string }} EmisorPapel */
/** @param {{ marca?: any, emisor?: EmisorPapel, tipoNombre?: string, cliente?: any, emitidoAt: any, codigoGeneracion: string, renglones?: any[], total: any, pagos?: any[] }} datos */
export function ticketProvisional({ marca = null, emisor = {}, tipoNombre = 'FACTURA', cliente, emitidoAt, codigoGeneracion, renglones = [], total, pagos = [] }) {
    const f = new Date(emitidoAt);
    const iso = relojSV(f.getTime()).toISOString();
    const totales = [['TOTAL', dinero(total), true]];
    for (const p of pagos) {
        const recibido = p.forma === '01' && p.recibido != null ? Number(p.recibido) : null;
        const monto = Number(p.monto ?? total);
        if (recibido != null && recibido > monto) totales.push([`${FORMA_EN_PAPEL['01']} recibido`, dinero(recibido)], ['CAMBIO', dinero(recibido - monto)]);
        else if (p.forma !== '01') totales.push([FORMA_EN_PAPEL[p.forma] ?? 'Pago', dinero(monto)]);
    }
    return {
        titulo: 'COMPROBANTE PROVISIONAL',
        tituloDeCola: `Provisional ${codigoGeneracion.slice(0, 8)}`,
        encabezado: {
            titulo: (marca?.nombre ?? emisor.nombre_comercial ?? emisor.nombre ?? '').toUpperCase(),
            lineas: [emisor.nombre, emisor.nit ? `NIT ${formatoNit(emisor.nit)}${emisor.nrc ? `  NRC ${formatoNrc(emisor.nrc)}` : ''}` : null].filter(Boolean),
        },
        datos: [['Fecha', `${fechaDdMm(iso.slice(0, 10))} ${hora12(iso.slice(11, 19))}`]],
        bloques: [
            { titulo: `${tipoNombre} EN CONTINGENCIA - SIN SENAL` },
            { titulo: 'Cliente', texto: cliente },
        ],
        items: {
            cantidadPrimero: true,
            columnas: [
                { label: 'CANT', ancho: '11%' },
                { label: 'DESCRIPCION', ancho: '53%' },
                { label: 'P.UNIT', ancho: '17%', alinear: 'der' },
                { label: 'TOTAL', ancho: '19%', alinear: 'der' },
            ],
            filas: renglones.map(r => [String(r.cantidad), r.descripcion, dinero(r.precio).replace('$', ''), dinero(r.total).replace('$', '')]),
        },
        totales,
        pie: [
            'CODIGO DE GENERACION',
            codigoGeneracion,
            'Venta sin senal: el documento tributario se',
            'emite en contingencia al recuperar la senal.',
        ],
    };
}

// ── Cuentas por cobrar: recibo y estado de cuenta ──────────────────────────

const fechaDe = (iso) => {
    const r = relojSV(new Date(iso).getTime()).toISOString();
    return `${fechaDdMm(r.slice(0, 10))} ${hora12(r.slice(11, 19))}`;
};

/**
 * El RECIBO de un cobro (2026-09-30): lo que el cliente se queda como prueba de
 * que pagó. Qué documentos abona, cuánto a cada uno, lo que queda de cada uno
 * y lo que sigue debiendo en total. En efectivo, lo entregado y el cambio.
 */
export function ticketDeRecibo(recibo, marca = null, emisor = {}) {
    const totales = [['ABONO', dinero(recibo.monto), true]];
    if (recibo.forma === '01' && recibo.recibido != null && Number(recibo.recibido) > Number(recibo.monto)) {
        totales.push(['Efectivo recibido', dinero(recibo.recibido)], ['CAMBIO', dinero(Number(recibo.recibido) - Number(recibo.monto))]);
    }
    totales.push(['SALDO PENDIENTE', dinero(recibo.saldo_cliente)]);
    return {
        titulo: recibo.anulado_at ? 'RECIBO ANULADO' : 'RECIBO DE ABONO',
        tituloDeCola: `Recibo ${recibo.id}`,
        encabezado: {
            titulo: (marca?.nombre ?? emisor.nombre_comercial ?? emisor.nombre ?? '').toUpperCase(),
            lineas: [emisor.nombre, emisor.nit ? `NIT ${formatoNit(emisor.nit)}` : null].filter(Boolean),
        },
        datos: [['Recibo', String(recibo.id)], ['Fecha', fechaDe(recibo.created_at)]],
        bloques: [
            { titulo: 'Cliente', texto: recibo.cliente },
            { titulo: 'Forma de pago', filas: [[FORMA_EN_PAPEL[recibo.forma] ?? 'Pago', recibo.referencia ?? '']] },
        ],
        // Dos columnas: el maquetador del rollo sabe alinear cuatro (la venta)
        // o dos; con tres se comería la del medio.
        items: {
            columnas: [{ label: 'DOCUMENTO', ancho: '72%' }, { label: 'ABONO', ancho: '28%', alinear: 'der' }],
            filas: (recibo.abonos ?? []).map(a => [
                `...${a.numero_control.slice(-6)} del ${fechaDdMm(a.fecha)} - queda ${dinero(a.saldo)}`,
                dinero(a.monto),
            ]),
        },
        totales,
        pie: [
            recibo.recibido_por?.name ? `Recibio: ${recibo.recibido_por.name.split(' ').slice(0, 1).join(' ')}` : null,
            ...(recibo.nota ? [recibo.nota] : []),
            ...(recibo.anulado_at ? [`ANULADO: ${recibo.anulado_motivo}`] : []),
            'Gracias por su pago.',
        ].filter(Boolean),
    };
}

/**
 * La LIQUIDACIÓN del vendedor (borrador 0020): lo que se entrega al volver de
 * la ruta. Dos columnas, como el recibo.
 */
export function ticketDeLiquidacion(liq, marca = null, emisor = {}) {
    const c = liq.cierre;
    const esperado = Number(liq.efectivo?.esperado ?? 0);
    const formas = {};
    for (const f of liq.por_forma ?? []) formas[f.forma] = (formas[f.forma] ?? 0) + Number(f.monto);
    const ef = liq.efectivo ?? {};
    const totales = [
        ['Vendido', dinero(liq.ventas?.total)],
        ['Cobrado de cartera', dinero(liq.cobros?.total)],
        ...Object.entries(formas).filter(([k]) => k !== '01').map(([k, v]) => [FORMA_EN_PAPEL[k] ?? 'Otro', dinero(v)]),
        // La caja del día (0024): el fondo vuelve; gastos y entregas ya salieron.
        ...(Number(ef.fondo) > 0 ? [['Fondo de cambio', dinero(ef.fondo)]] : []),
        ...(Number(ef.gastos) > 0 ? [['Gastos de ruta', `-${dinero(ef.gastos)}`]] : []),
        ...(Number(ef.entregas) > 0 ? [['Entregas parciales', `-${dinero(ef.entregas)}`]] : []),
        ['EFECTIVO A ENTREGAR', dinero(esperado), true],
    ];
    if (c) {
        totales.push(['Efectivo contado', dinero(c.contado)]);
        const d = Number(c.diferencia);
        totales.push([d === 0 ? 'SIN DIFERENCIA' : d > 0 ? 'SOBRANTE' : 'FALTANTE', dinero(Math.abs(d)), true]);
    }
    return {
        titulo: c ? 'LIQUIDACION CERRADA' : 'LIQUIDACION (SIN CERRAR)',
        tituloDeCola: `Liquidacion ${liq.fecha}`,
        encabezado: {
            titulo: (marca?.nombre ?? emisor.nombre_comercial ?? emisor.nombre ?? '').toUpperCase(),
            lineas: [emisor.nombre].filter(Boolean),
        },
        datos: [['Vendedor', liq.vendedor?.name ?? ''], ['Dia', fechaDdMm(liq.fecha)]],
        bloques: (liq.cheques?.length ? [{ titulo: 'Cheques a entregar', filas: liq.cheques.map(ch => [`${ch.cliente} ${ch.referencia ?? ''}`.trim(), dinero(ch.monto)]) }] : []),
        items: {
            columnas: [{ label: 'DOCUMENTO', ancho: '72%' }, { label: 'TOTAL', ancho: '28%', alinear: 'der' }],
            filas: (liq.ventas?.lista ?? []).map(v => [`...${v.numero_control.slice(-6)} ${v.cliente}`, dinero(v.total)]),
        },
        totales,
        pie: [
            Number(liq.devoluciones?.a_favor) > 0 ? `Devoluciones a favor de clientes: ${dinero(liq.devoluciones.a_favor)}` : null,
            c?.nota ? `Nota: ${c.nota}` : null,
            c?.cerrada_por ? `Recibio: ${String(c.cerrada_por).split(' ')[0]}` : null,
            'Firma del vendedor: ____________________',
        ].filter(Boolean),
    };
}

/** El CIERRE DEL DÍA de la distribuidora (borrador 0024): la empresa entera. */
export function ticketDeCierreDia(d, marca = null, emisor = {}) {
    const recibido = Number(d.efectivo_recibido ?? 0);
    const depositado = Number(d.depositado ?? 0);
    const formas = {};
    for (const f of d.por_forma ?? []) formas[f.forma] = (formas[f.forma] ?? 0) + Number(f.monto);
    return {
        titulo: d.cierre ? 'CIERRE DEL DIA' : 'CIERRE DEL DIA (SIN CERRAR)',
        tituloDeCola: `Cierre ${d.fecha}`,
        encabezado: {
            titulo: (marca?.nombre ?? emisor.nombre_comercial ?? emisor.nombre ?? '').toUpperCase(),
            lineas: [emisor.nombre].filter(Boolean),
        },
        datos: [['Dia', fechaDdMm(d.fecha)], ['Documentos', String(d.ventas?.documentos ?? 0)]],
        bloques: Object.keys(formas).length ? [{ titulo: 'Por forma de pago', filas: Object.entries(formas).map(([k, v]) => [FORMA_EN_PAPEL[k] ?? 'Otro', dinero(v)]) }] : [],
        items: {
            columnas: [{ label: 'VENDEDOR', ancho: '72%' }, { label: 'ENTREGO', ancho: '28%', alinear: 'der' }],
            filas: (d.vendedores ?? []).map(v => [`${String(v.name ?? '').split(' ')[0]}${v.cierre_id ? (Number(v.diferencia) ? ` (${dinero(v.diferencia)})` : '') : ' POR LIQUIDAR'}`,
                v.cierre_id ? dinero(v.contado) : dinero(v.esperado)]),
        },
        totales: [
            ['Vendido', dinero(d.ventas?.total)],
            ...(Number(d.devoluciones) > 0 ? [['Devoluciones', `-${dinero(d.devoluciones)}`]] : []),
            ['Gastos de ruta', dinero(d.gastos)],
            ['EFECTIVO RECIBIDO', dinero(recibido), true],
            ['Depositado', dinero(depositado)],
            ['QUEDA EN CAJA', dinero(recibido - depositado), true],
        ],
        pie: [
            ...(d.depositos ?? []).map(x => `Deposito ${x.banco} ${x.referencia}: ${dinero(x.monto)}`),
            d.cierre?.nota ? `Nota: ${d.cierre.nota}` : null,
            d.cierre?.cerrado_por ? `Cerro: ${String(d.cierre.cerrado_por).split(' ')[0]}` : null,
        ].filter(Boolean),
    };
}

/** El ESTADO DE CUENTA para dejárselo al cliente: qué debe, desde cuándo y cuánto. */
/** @param {{ cliente: any, estado?: any, marca?: any, emisor?: EmisorPapel }} datos */
export function ticketDeEstadoDeCuenta({ cliente, estado, marca = null, emisor = {} }) {
    const abiertas = (estado?.cuentas ?? []).filter(c => c.estado === 'abierta');
    const cr = estado?.credito ?? {};
    return {
        titulo: 'ESTADO DE CUENTA',
        tituloDeCola: `Estado de cuenta ${cliente}`,
        encabezado: {
            titulo: (marca?.nombre ?? emisor.nombre_comercial ?? emisor.nombre ?? '').toUpperCase(),
            lineas: [emisor.nombre].filter(Boolean),
        },
        datos: [['Al', fechaDe(new Date().toISOString())]],
        bloques: [{ titulo: 'Cliente', texto: cliente, filas: [['Limite', dinero(cr.limite)], ['Disponible', dinero(cr.disponible)]] }],
        items: {
            columnas: [{ label: 'DOCUMENTO', ancho: '72%' }, { label: 'SALDO', ancho: '28%', alinear: 'der' }],
            filas: abiertas.map(c => [
                `...${c.numero_control.slice(-6)} vence ${fechaDdMm(c.vence)}${c.dias > 0 ? ` (${c.dias}d)` : ''}`,
                dinero(c.saldo),
            ]),
        },
        totales: [
            ...(Number(cr.vencido) > 0 ? [['VENCIDO', dinero(cr.vencido)]] : []),
            ['TOTAL A PAGAR', dinero(cr.saldo), true],
        ],
        pie: ['Los dias entre parentesis son de atraso.'],
    };
}
