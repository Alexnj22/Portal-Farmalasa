import { formatMoney } from './formatNumber';

// PDF del Corte Z — uno o todas las sucursales en un solo archivo.
//
// pdfmake va por `await import()`: son ~809 kB gzip que solo hacen falta al
// apretar el botón, no al entrar a la vista (regla de librerías pesadas de
// CLAUDE.md, la vigila `npm run gate:bundle`). Mismo patrón que `pedidoPrint.js`.
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
        }).catch((err) => {
            pdfMakePromise = null;   // reintentar en el próximo click, no quedar roto
            throw err;
        });
    }
    return pdfMakePromise;
}

// El formateador del portal, no uno propio: el locale y los decimales del
// dinero se deciden en UN lugar (`es-SV`), y un PDF que redondea distinto que la
// pantalla es exactamente la diferencia que nadie encuentra.
const dinero = (n) => formatMoney(Number(n) || 0);

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const etiquetaPeriodo = (periodo) => {
    const [y, m] = String(periodo).slice(0, 7).split('-').map(Number);
    return `${MESES[m - 1]} ${y}`;
};

// Una sección del ticket → filas de la tabla. Se emiten las cinco líneas aunque
// vayan en cero: en el documento del origen están las cinco, y omitir una porque
// vale cero es decidir por el que lo lee que ese cero no importa.
function filasSeccion(sec = {}) {
    return [
        ['Ventas exentas',     dinero(sec.exentas)],
        ['Ventas gravadas',    dinero(sec.gravadas)],
        ['Ventas no sujetas',  dinero(sec.no_sujetas)],
        ['Retención',          dinero(sec.retencion)],
        ['Total',              dinero(sec.total)],
    ];
}

function bloqueSucursal(fila, { conSalto }) {
    const sec = fila.detalle?.secciones || {};
    const secciones = [
        ['Ventas con tiquete',        sec.tiquete],
        ['Ventas con factura',        sec.factura],
        ['Ventas con crédito fiscal', sec.ccf],
    ];

    // El contraste contra el libro. Se imprime SIEMPRE, cuadre o no: un informe
    // que solo muestra el cotejo cuando falla no deja constancia de que se hizo.
    const dif = Number(fila.dif_total) || 0;
    const cuadra = Math.abs(dif) < 0.005;

    return [
        ...(conSalto ? [{ text: '', pageBreak: 'before' }] : []),
        { text: fila.sucursal, style: 'suc' },
        { text: `Corte Z mensual · ${etiquetaPeriodo(fila.periodo)}`, style: 'sub' },
        { text: `Del ${fila.fecha_inicio} al ${fila.fecha_fin}`, style: 'sub2' },

        ...secciones.flatMap(([titulo, datos]) => ([
            { text: titulo, style: 'secTitulo' },
            {
                table: { widths: ['*', 90], body: filasSeccion(datos) },
                layout: 'lightHorizontalLines',
                margin: [0, 0, 0, 8],
            },
        ])),

        {
            table: {
                widths: ['*', 110],
                body: [[
                    { text: 'TOTAL GENERAL', style: 'totalRot' },
                    { text: dinero(fila.total_general), style: 'totalVal' },
                ]],
            },
            layout: 'noBorders',
            margin: [0, 6, 0, 14],
        },

        { text: 'Cotejo contra el libro de IVA del portal', style: 'secTitulo' },
        {
            table: {
                widths: ['*', 90, 90, 70],
                body: [
                    [
                        { text: '', style: 'th' }, { text: 'Corte Z', style: 'th' },
                        { text: 'Libro', style: 'th' }, { text: 'Diferencia', style: 'th' },
                    ],
                    ['Ventas con factura', dinero(fila.factura_total), dinero(fila.portal_factura), dinero(fila.dif_factura)],
                    ['Ventas con crédito fiscal', dinero(fila.ccf_total), dinero(fila.portal_ccf), dinero(fila.dif_ccf)],
                    [
                        { text: 'Total general', bold: true },
                        { text: dinero(fila.total_general), bold: true },
                        { text: dinero(fila.portal_total), bold: true },
                        { text: dinero(fila.dif_total), bold: true },
                    ],
                ],
            },
            layout: 'lightHorizontalLines',
            margin: [0, 0, 0, 8],
        },
        {
            text: cuadra
                ? 'Sin diferencia contra el libro.'
                : `Diferencia de ${dinero(Math.abs(dif))} contra el libro. Revisar antes de presentar.`,
            style: cuadra ? 'ok' : 'alerta',
        },
    ];
}

/**
 * @param {Array} filas  las que devuelve `get_cortes_z` (una por sucursal)
 * @param {string} nombreArchivo
 */
export async function descargarCorteZPdf(filas, nombreArchivo) {
    if (!filas?.length) throw new Error('No hay Corte Z para descargar en este período.');
    const pdfMake = await getPdfMake();

    const doc = {
        pageSize: 'LETTER',
        pageMargins: [40, 40, 40, 44],
        // El pie lleva el número de página porque el archivo de "todas las
        // sucursales" es una sucursal por hoja: sin numerar, dos hojas sueltas
        // no se sabe si son de la misma corrida.
        footer: (pagina, total) => ({
            text: `Página ${pagina} de ${total}`,
            alignment: 'center', fontSize: 7, color: '#888', margin: [0, 12, 0, 0],
        }),
        content: filas.flatMap((f, i) => bloqueSucursal(f, { conSalto: i > 0 })),
        styles: {
            suc:       { fontSize: 16, bold: true, margin: [0, 0, 0, 2] },
            sub:       { fontSize: 10, color: '#444' },
            sub2:      { fontSize: 9,  color: '#777', margin: [0, 0, 0, 12] },
            secTitulo: { fontSize: 10, bold: true, margin: [0, 6, 0, 4] },
            th:        { fontSize: 8, bold: true, color: '#555' },
            totalRot:  { fontSize: 12, bold: true },
            totalVal:  { fontSize: 12, bold: true, alignment: 'right' },
            ok:        { fontSize: 9, color: '#1a7f37' },
            alerta:    { fontSize: 9, color: '#b42318', bold: true },
        },
        defaultStyle: { fontSize: 9 },
    };

    pdfMake.createPdf(doc).download(nombreArchivo);
}
