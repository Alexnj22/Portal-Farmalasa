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
import { formatMoney } from './formatNumber';

export const NOMBRE_DOCUMENTO = {
    '01': 'FACTURA',
    '03': 'COMPROBANTE DE CREDITO FISCAL',
    '04': 'NOTA DE REMISION',
    '05': 'NOTA DE CREDITO',
    '06': 'NOTA DE DEBITO',
};

const CONDICION = { 1: 'Contado', 2: 'Credito', 3: 'Otro' };
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
        },
        receptor: {
            nombre: r.nombre ?? 'Consumidor final',
            documento: docReceptor,
            nrc: r.nrc ? formatoNrc(r.nrc) : null,
            actividad: r.descActividad ?? null,
            direccion: direccionDe(r.direccion),
            telefono: r.telefono ?? null,
            correo: r.correo ?? null,
        },
        renglones: j.cuerpoDocumento.map(c => ({
            n: c.numItem,
            cantidad: cantidad(c.cantidad),
            descripcion: c.descripcion,
            precio: c.precioUni,
            descuento: c.montoDescu,
            noSujeta: c.ventaNoSuj,
            exenta: c.ventaExenta,
            gravada: c.ventaGravada,
        })),
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
export function ticketDeVenta(dte, marca = null) {
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

    return {
        titulo: d.nombre,
        tituloDeCola: `${d.nombre} ${d.numeroControl.slice(-6)}`,
        // La marca va arriba, como membrete; los datos fiscales, debajo y tal
        // cual los dice el DTE. El rollo no lleva el icono: una imagen por el
        // camino directo es un comando que esa impresora todavía no probó, y
        // uno que no entiende se traga el trabajo siguiente (ticketPrint.js).
        encabezado: {
            titulo: (marca?.nombre ?? d.emisor.comercial ?? d.emisor.nombre).toUpperCase(),
            lineas: [
                marca || d.emisor.comercial ? d.emisor.nombre : null,
                d.emisor.comercial && d.emisor.comercial !== d.emisor.nombre ? d.emisor.comercial : null,
                `NIT ${d.emisor.nit}  NRC ${d.emisor.nrc}`,
                d.emisor.direccion,
                `Tel. ${d.emisor.telefono}`,
            ].filter(Boolean),
        },
        bloques: d.prueba ? [{ titulo: 'Ambiente de pruebas', texto: 'SIN VALIDEZ FISCAL', destacado: true }] : [],
        datos: [
            ['Fecha', `${d.fecha} ${d.hora}`],
            ['Cliente', d.receptor.nombre],
            ...(d.receptor.documento ? [['Doc.', d.receptor.documento]] : []),
            ...(d.receptor.nrc ? [['NRC', d.receptor.nrc]] : []),
            ...(d.condicion ? [['Condicion', d.condicion]] : []),
        ],
        items: {
            columnas: [{ label: 'CANT' }, { label: 'DESCRIPCION' }, { label: 'P. UNIT' }, { label: 'TOTAL' }],
            filas: d.renglones.map(r => [r.cantidad, r.descripcion, dinero(r.precio), dinero(r.gravada + r.exenta + r.noSujeta)]),
        },
        totales,
        total_letras: res.letras,
        pie: [
            `Num. control: ${d.numeroControl}`,
            `Cod. generacion: ${d.codigoGeneracion}`,
            d.sellado ? `Sello: ${d.sello}` : 'PENDIENTE DEL SELLO DE HACIENDA',
            ...(d.observaciones ? [d.observaciones] : []),
            'Verifique este documento con el codigo QR.',
        ],
        qr: d.qr,
    };
}

export const imprimirTicketDeVenta = (dte, marca = null) => imprimirDocumento(ticketDeVenta(dte, marca), {
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

/**
 * La definición del PDF. Carta, con el membrete de la marca: los colores van en
 * rellenos y rótulos, nunca en un dato, y todo se sigue leyendo impreso en
 * blanco y negro. Lo que la norma exige (Manual Funcional §XXII) está todo y
 * sale del JSON firmado; la marca sólo lo ordena.
 */
export function definicionPdf(dte, qrSvg, marca = null) {
    C = marca?.colores ?? SIN_MARCA;
    const d = leerDocumento(dte);
    const res = d.resumen;
    const filasResumen = [
        ['Ventas no sujetas', res.noSujeta], ['Ventas exentas', res.exenta], ['Ventas gravadas', res.gravada],
        ...(res.descuento ? [['Descuentos', res.descuento]] : []),
        ...(res.ivaIncluido ? [] : [['Sub-total', res.subTotal], ['IVA 13%', res.iva]]),
        ...(res.percepcion ? [['IVA percibido', res.percepcion]] : []),
        ...(res.retencion ? [['IVA retenido', -res.retencion]] : []),
    ];
    const ANCHO = 540; // carta (612) menos los márgenes
    return {
        pageSize: 'LETTER',
        pageMargins: [36, 36, 36, 52],
        info: { title: `${d.nombre} ${d.numeroControl}`, author: d.emisor.nombre, creator: marca?.nombre ?? d.emisor.nombre },
        ...(d.prueba ? { watermark: { text: 'SIN VALIDEZ FISCAL', color: '#999999', opacity: 0.12, bold: true } } : {}),
        footer: (actual, total) => ({
            margin: [36, 14, 36, 0],
            stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: ANCHO, y2: 0, lineWidth: 0.6, lineColor: LINEA }] },
                {
                    margin: [0, 5, 0, 0],
                    columns: [
                        { text: marca ? [{ text: marca.nombre, bold: true, color: C.petroleo }, { text: `  ·  ${d.emisor.nombre}`, color: GRIS }] : d.emisor.nombre, fontSize: 7, color: GRIS },
                        { text: d.sellado ? 'Documento sellado por el Ministerio de Hacienda' : 'Documento pendiente del sello de Hacienda', fontSize: 7, color: GRIS, alignment: 'center' },
                        { text: `Página ${actual} de ${total}`, alignment: 'right', fontSize: 7, color: GRIS },
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
                    widths: [16, 32, '*', 52, 40, 48, 48, 54],
                    body: [
                        ['N°', 'Cant.', 'Descripción', 'Precio unit.', 'Desc.', 'No sujetas', 'Exentas', 'Gravadas']
                            .map((t, i) => celda(t, { bold: true, color: '#ffffff', fillColor: C.petroleo, fontSize: 7, alignment: i < 3 ? 'left' : 'right' })),
                        ...d.renglones.map((r, i) => {
                            const fondo = i % 2 ? '#f5f8f9' : null;
                            const num = (v) => celda(dinero(v), { alignment: 'right', fillColor: fondo });
                            return [
                                celda(r.n, { color: GRIS, fillColor: fondo }), celda(r.cantidad, { alignment: 'right', fillColor: fondo }),
                                celda(r.descripcion, { fillColor: fondo }),
                                num(r.precio), num(r.descuento), num(r.noSujeta), num(r.exenta), num(r.gravada),
                            ];
                        }),
                    ],
                },
                layout: lineasSuaves,
            },

            // ── Letras y totales ──
            {
                margin: [0, 12, 0, 0],
                columns: [
                    {
                        width: '*',
                        stack: [
                            par('Valor en letras', res.letras),
                            ...(d.condicion ? [par('Condición de la operación', d.condicion)] : []),
                            ...(res.ivaIncluido ? [par('IVA incluido en el precio', dinero(res.iva))] : []),
                            ...(d.observaciones ? [par('Observaciones', d.observaciones)] : []),
                        ],
                    },
                    {
                        width: 210,
                        table: {
                            widths: ['*', 76],
                            body: [
                                ...filasResumen.map(([t, v]) => [celda(t, { color: GRIS }), celda(v < 0 ? `-${dinero(-v)}` : dinero(v), { alignment: 'right' })]),
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
            },
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

export const nombreDelPdf = (dte) =>
    `${(NOMBRE_DOCUMENTO[dte.tipo] ?? 'DOCUMENTO').replace(/\s+/g, '-')}-${dte.numero_control.slice(-6)}-${String(dte.codigo_generacion).toUpperCase()}.pdf`;
