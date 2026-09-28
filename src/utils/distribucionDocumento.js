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
export function ticketDeVenta(dte) {
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
        encabezado: {
            titulo: d.emisor.comercial || d.emisor.nombre,
            lineas: [
                d.emisor.comercial ? d.emisor.nombre : null,
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

export const imprimirTicketDeVenta = (dte) => imprimirDocumento(ticketDeVenta(dte), {
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

const GRIS = '#555555';
const celda = (text, extra = {}) => ({ text: String(text ?? ''), fontSize: 8, ...extra });
const par = (rotulo, valor) => ({ text: [{ text: `${rotulo}: `, bold: true }, String(valor ?? '—')], fontSize: 8, margin: [0, 1, 0, 1] });

/** La definición del PDF. Carta, en negro: el papel no tiene tema. */
export function definicionPdf(dte, qrSvg) {
    const d = leerDocumento(dte);
    const res = d.resumen;
    const filasResumen = [
        ['Ventas no sujetas', res.noSujeta], ['Ventas exentas', res.exenta], ['Ventas gravadas', res.gravada],
        ...(res.descuento ? [['Descuentos', res.descuento]] : []),
        ...(res.ivaIncluido ? [] : [['Sub-total', res.subTotal], ['IVA 13%', res.iva]]),
        ...(res.percepcion ? [['IVA percibido', res.percepcion]] : []),
        ...(res.retencion ? [['IVA retenido', -res.retencion]] : []),
    ];
    return {
        pageSize: 'LETTER',
        pageMargins: [36, 36, 36, 48],
        ...(d.prueba ? { watermark: { text: 'SIN VALIDEZ FISCAL', color: '#999999', opacity: 0.15, bold: true } } : {}),
        footer: (actual, total) => ({
            columns: [
                { text: d.sellado ? 'Documento sellado por el Ministerio de Hacienda.' : 'Documento pendiente del sello de Hacienda.', fontSize: 7, color: GRIS },
                { text: `Página ${actual} de ${total}`, alignment: 'right', fontSize: 7, color: GRIS },
            ],
            margin: [36, 16, 36, 0],
        }),
        content: [
            {
                columns: [
                    {
                        width: '*',
                        stack: [
                            { text: d.emisor.nombre, bold: true, fontSize: 12 },
                            ...(d.emisor.comercial ? [{ text: d.emisor.comercial, fontSize: 9 }] : []),
                            { text: d.emisor.actividad, fontSize: 8, color: GRIS, margin: [0, 2, 0, 2] },
                            par('NIT', d.emisor.nit), par('NRC', d.emisor.nrc),
                            par('Dirección', d.emisor.direccion),
                            par('Teléfono', d.emisor.telefono), par('Correo', d.emisor.correo),
                        ],
                    },
                    {
                        width: 210,
                        stack: [
                            { text: 'DOCUMENTO TRIBUTARIO ELECTRÓNICO', bold: true, fontSize: 9, alignment: 'center' },
                            { text: d.nombre, bold: true, fontSize: 11, alignment: 'center', margin: [0, 2, 0, 6] },
                            ...(qrSvg ? [{ svg: qrSvg, width: 90, alignment: 'center', margin: [0, 0, 0, 4] }] : []),
                            { text: 'Consulte su validez con el código QR', fontSize: 7, alignment: 'center', color: GRIS },
                        ],
                    },
                ],
            },
            {
                margin: [0, 10, 0, 6],
                table: {
                    widths: ['*', '*'],
                    body: [[
                        { stack: [par('Código de generación', d.codigoGeneracion), par('Número de control', d.numeroControl),
                            par('Sello de recepción', d.sellado ? d.sello : 'PENDIENTE')] },
                        { stack: [par('Fecha y hora de emisión', `${d.fecha} ${d.hora}`), par('Modelo de facturación', d.modelo),
                            par('Tipo de transmisión', d.transmision)] },
                    ]],
                },
                layout: 'lightHorizontalLines',
            },
            { text: 'RECEPTOR', bold: true, fontSize: 9, margin: [0, 4, 0, 2] },
            {
                columns: [
                    { width: '*', stack: [par('Nombre', d.receptor.nombre), par('Documento', d.receptor.documento || '—'),
                        ...(d.receptor.nrc ? [par('NRC', d.receptor.nrc)] : []), ...(d.receptor.actividad ? [par('Actividad', d.receptor.actividad)] : [])] },
                    { width: '*', stack: [par('Dirección', d.receptor.direccion || '—'), par('Teléfono', d.receptor.telefono || '—'),
                        par('Correo', d.receptor.correo || '—')] },
                ],
            },
            {
                margin: [0, 10, 0, 0],
                table: {
                    headerRows: 1,
                    widths: [18, 34, '*', 52, 44, 50, 50, 56],
                    body: [
                        ['N°', 'Cant.', 'Descripción', 'Precio unit.', 'Desc.', 'No sujetas', 'Exentas', 'Gravadas']
                            .map(t => celda(t, { bold: true, fillColor: '#eeeeee' })),
                        ...d.renglones.map(r => [
                            celda(r.n), celda(r.cantidad, { alignment: 'right' }), celda(r.descripcion),
                            celda(dinero(r.precio), { alignment: 'right' }), celda(dinero(r.descuento), { alignment: 'right' }),
                            celda(dinero(r.noSujeta), { alignment: 'right' }), celda(dinero(r.exenta), { alignment: 'right' }),
                            celda(dinero(r.gravada), { alignment: 'right' }),
                        ]),
                    ],
                },
                layout: 'lightHorizontalLines',
            },
            {
                margin: [0, 10, 0, 0],
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
                        width: 200,
                        table: {
                            widths: ['*', 70],
                            body: [
                                ...filasResumen.map(([t, v]) => [celda(t), celda(v < 0 ? `-${dinero(-v)}` : dinero(v), { alignment: 'right' })]),
                                [celda('TOTAL A PAGAR', { bold: true, fontSize: 10 }), celda(dinero(res.total), { bold: true, fontSize: 10, alignment: 'right' })],
                            ],
                        },
                        layout: 'lightHorizontalLines',
                    },
                ],
            },
        ],
        defaultStyle: { font: 'Roboto', color: '#000000' },
    };
}

/** El PDF como `Blob`, para verlo en pantalla o descargarlo. */
export async function pdfDelDocumento(dte) {
    const [pdfMake, qr] = await Promise.all([getPdfMake(), dibujarQR(urlConsultaPublica(dte)).catch(() => '')]);
    const doc = pdfMake.createPdf(definicionPdf(dte, qr || null));
    // pdfmake 0.3 devuelve una promesa; la 0.2 recibía un callback. Se aceptan las dos.
    return doc.getBlob.length ? new Promise(r => doc.getBlob(r)) : doc.getBlob();
}

export const nombreDelPdf = (dte) =>
    `${(NOMBRE_DOCUMENTO[dte.tipo] ?? 'DOCUMENTO').replace(/\s+/g, '-')}-${dte.numero_control.slice(-6)}-${String(dte.codigo_generacion).toUpperCase()}.pdf`;
