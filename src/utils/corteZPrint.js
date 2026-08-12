import { formatMoney } from './formatNumber';
import { EMPRESA } from '../constants/empresa';

// PDF del Corte Z — uno o todas las sucursales en un solo archivo.
//
// UNA HOJA POR SUCURSAL, y es un requisito, no una casualidad (decisión del
// usuario, 2026-08-12). El PDF lleva las cifras —las tres secciones del ticket,
// el total, las cifras para declarar y el cotejo— más UN renglón de explicación
// bajo el total. Las seis comprobaciones viven sólo en la pantalla: se sacaron
// de acá porque empujaban una segunda hoja de puro texto.
//
// Ese renglón único es lo que se conservó de la explicación, y no es opcional:
// las secciones copian el ticket con su resta duplicada, así que sumadas dan
// MENOS que el TOTAL GENERAL. Sin la línea, la hoja tiene dos números para lo
// mismo y nada que diga cuál usar — que fue exactamente lo que confundió al
// usuario cuando se probó sin ella.
//
// Antes de agregar cualquier bloque nuevo: si no cabe en la hoja, no va.
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

/**
 * La dirección de la sucursal: la del local y su departamento, en una línea.
 *
 * Sin municipio a propósito. La dirección guardada ya nombra el lugar («…,
 * Nueva Concepción», «…, Agua Caliente»), mientras que el municipio del
 * catálogo es el de la división de 2024 —«Chalatenango Sur»—, así que ponerlos
 * juntos daría «Nueva Concepción, Chalatenango Sur, Chalatenango»: dos nombres
 * distintos para el mismo sitio, uno al lado del otro.
 *
 * Devuelve cadena vacía si no hay nada: el encabezado omite la línea en vez de
 * dejar un renglón en blanco que se lee como una dirección que no se cargó.
 */
export const direccionDe = (fila) =>
    [fila.direccion, fila.departamento].filter(Boolean).join(', ');

function bloqueSucursal(fila, { conSalto }) {
    const sec = fila.detalle?.secciones || {};
    // Las cifras con las que se declara. El ticket no las trae —su línea
    // GRAVADAS es lo cobrado CON IVA y de débito fiscal no dice nada— así que
    // sin esto el PDF obligaba a abrir además el libro de IVA para llenar la
    // declaración.
    const decl = fila.declaracion || {};
    const direccion = direccionDe(fila);
    const secciones = [
        ['Ventas con tiquete',        sec.tiquete],
        ['Ventas con factura',        sec.factura],
        ['Ventas con crédito fiscal', sec.ccf],
    ];

    // El contraste contra el libro. Se imprime SIEMPRE, cuadre o no: un informe
    // que solo muestra el cotejo cuando falla no deja constancia de que se hizo.
    const dif = Number(fila.dif_total) || 0;
    const cuadra = Math.abs(dif) < 0.005;
    // El ticket resta la retención dos veces: su línea GRAVADAS ya viene neta y
    // su TOTAL se la vuelve a restar. Por eso el cotejo va contra `z_*` —las
    // gravadas— y no contra los totales del ticket. Cuando hay retención, el
    // cotejo suma su propia línea: es una fila, cabe en la hoja, y sin ella el
    // cuadro tendría un número que no se puede seguir.
    const conRetencion = Math.abs(Number(fila.retencion) || 0) >= 0.005
                      || Math.abs(Number(fila.portal_retencion) || 0) >= 0.005;

    return [
        ...(conSalto ? [{ text: '', pageBreak: 'before' }] : []),

        // Quién declara, arriba de todo. Va en CADA bloque y no una sola vez al
        // principio del archivo porque el archivo de "todas las sucursales" es
        // una sucursal por hoja, y una hoja suelta tiene que poder identificarse
        // sola: es un documento que se presenta, no un listado interno.
        { text: EMPRESA.razonSocial, style: 'empresa' },
        { text: `NIT: ${EMPRESA.nit}    NRC: ${EMPRESA.nrc}`, style: 'fiscal' },

        { text: fila.sucursal, style: 'suc' },
        ...(direccion ? [{ text: direccion, style: 'dir' }] : []),
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
                    { text: dinero(fila.z_total), style: 'totalVal' },
                ]],
            },
            layout: 'noBorders',
            margin: [0, 6, 0, conRetencion ? 2 : 14],
        },

        // El único renglón de explicación que lleva la hoja, y sólo cuando hace
        // falta. Las tres secciones de arriba son la copia del ticket, así que
        // arrastran su resta duplicada: sumadas dan menos que este total. Sin
        // esta línea, la hoja tiene dos números para lo mismo —«Total $976.73»
        // en la sección y «$980.33» en la declaración— y el lector tiene que
        // adivinar cuál usar. Va acá y no al pie porque se lee junto al número
        // que corrige.
        ...(conRetencion ? [{
            text: `Las secciones de arriba copian el Corte Z, que resta `
                + `${dinero(fila.retencion)} de retención dos veces. Este total es el correcto.`,
            style: 'nota',
        }] : []),

        { text: 'Para la declaración', style: 'secTitulo' },
        {
            table: {
                widths: ['*', 90, 90],
                body: [
                    [
                        { text: '', style: 'th' },
                        { text: 'Consumidor', style: 'th' },
                        { text: 'Contribuyente', style: 'th' },
                    ],
                    ['Ventas exentas',  dinero(decl.factura?.exentas),  dinero(decl.ccf?.exentas)],
                    ['Ventas gravadas', dinero(decl.factura?.gravadas), dinero(decl.ccf?.gravadas)],
                    ['Débito fiscal',   dinero(decl.factura?.debito),   dinero(decl.ccf?.debito)],
                    ['IVA retenido',    dinero(decl.factura?.retenido), dinero(decl.ccf?.retenido)],
                    [
                        { text: 'Total', bold: true },
                        { text: dinero(decl.factura?.total), bold: true },
                        { text: dinero(decl.ccf?.total), bold: true },
                    ],
                ],
            },
            layout: 'lightHorizontalLines',
            margin: [0, 0, 0, 12],
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
                    ['Ventas con factura', dinero(fila.z_factura), dinero(fila.portal_factura), dinero(fila.dif_factura)],
                    ['Ventas con crédito fiscal', dinero(fila.z_ccf), dinero(fila.portal_ccf), dinero(fila.dif_ccf)],
                    ...(conRetencion
                        ? [['Retención de IVA', dinero(fila.retencion),
                            dinero(fila.portal_retencion), dinero(fila.dif_retencion)]]
                        : []),
                    [
                        { text: 'Total general', bold: true },
                        { text: dinero(fila.z_total), bold: true },
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
            empresa:   { fontSize: 11, bold: true, color: '#222' },
            fiscal:    { fontSize: 9, color: '#555', margin: [0, 1, 0, 10] },
            suc:       { fontSize: 16, bold: true, margin: [0, 0, 0, 2] },
            dir:       { fontSize: 9, color: '#555', margin: [0, 0, 0, 3] },
            sub:       { fontSize: 10, color: '#444' },
            sub2:      { fontSize: 9,  color: '#777', margin: [0, 0, 0, 12] },
            secTitulo: { fontSize: 10, bold: true, margin: [0, 6, 0, 4] },
            th:        { fontSize: 8, bold: true, color: '#555' },
            totalRot:  { fontSize: 12, bold: true },
            totalVal:  { fontSize: 12, bold: true, alignment: 'right' },
            ok:        { fontSize: 9, color: '#1a7f37' },
            alerta:    { fontSize: 9, color: '#b42318', bold: true },
            nota:      { fontSize: 8, color: '#555', margin: [0, 0, 0, 12], lineHeight: 1.25 },
        },
        defaultStyle: { fontSize: 9 },
    };

    pdfMake.createPdf(doc).download(nombreArchivo);
}
