// ── El informe mensual de marketing, en PDF ────────────────────────────────
//
// Para la reunión de gerencia: qué se planificó y qué salió, la mezcla del
// mes, la inversión en pauta con sus resultados y, si la pieza iba ligada a
// una promoción, cómo se movió la venta de sus productos.
//
// pdfmake va por `await import()` (regla de librerías pesadas, gate:bundle):
// sólo hace falta al apretar el botón. Mismo patrón que `corteZPrint.js`.
//
// El papel no tiene tema: negro y grises, sin tokens de la pantalla.
import { formatMoney, formatQty, formatPct } from './formatNumber';
import { etiquetaMes, fechaNumerica } from './fecha';
import {
    ESTADOS_PIEZA, FORMATOS, resumenDelMes, mezclaDelMes, totalesDePauta,
    formatoDe, pilarDe, estadoDe, objetivoDe, variacionDeVentas, ESTADOS_MES,
} from './marketing';

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
            pdfMakePromise = null;   // reintentar en el próximo clic, no quedar roto
            throw err;
        });
    }
    return pdfMakePromise;
}

const dinero = (n) => formatMoney(Number(n) || 0);
const cifra = (n) => (n == null ? '—' : formatQty(n));
const th = (t, align = 'left') => ({ text: t, style: 'th', alignment: align });

function tablaSimple(encabezados, filas, anchos) {
    return {
        table: { headerRows: 1, widths: anchos, body: [encabezados, ...filas] },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 12],
    };
}

/**
 * @param {object} p
 * @param {object} p.mes        fila de `marketing_meses`
 * @param {Array}  p.piezas     las del mes, con `pauta`
 * @param {object} p.marcas     por id
 * @param {Array}  p.redes
 * @param {object} p.efectos    por id de pieza (de `marketing_efecto_en_ventas`)
 * @param {object} p.promociones por id (nombre)
 */
export function construirInformeDoc({ mes, piezas, marcas, redes, efectos = {}, promociones = {} }) {
    const resumen = resumenDelMes(piezas);
    const mezcla = mezclaDelMes(piezas);
    const pautas = piezas.filter((p) => p.pauta);
    const tot = totalesDePauta(pautas.map((p) => p.pauta), mes.presupuesto_pauta);
    const nombreRed = (c) => redes.find((r) => r.clave === c)?.nombre || c;
    const estadoMes = ESTADOS_MES[mes.estado]?.label || mes.estado;

    const porMarca = {};
    const marcasDe = (p) => (p.marcas?.length ? p.marcas : [p.marca_id]);
    for (const p of piezas) for (const m of marcasDe(p)) porMarca[m] = (porMarca[m] || 0) + 1;

    const conEfecto = piezas.filter((p) => p.promocion_id && efectos[p.id]?.durante);

    return {
        pageSize: 'LETTER',
        pageMargins: [40, 40, 40, 36],
        footer: (pagina, total) => ({
            text: `Página ${pagina} de ${total}`, alignment: 'center', fontSize: 7, color: '#888', margin: [0, 12, 0, 0],
        }),
        content: [
            { text: 'Informe de marketing', style: 'titulo' },
            { text: `${etiquetaMes(mes.mes)} · calendario ${estadoMes.toLowerCase()}${mes.version > 1 ? ` (versión ${mes.version})` : ''}`, style: 'sub' },
            mes.objetivo ? { text: [{ text: 'Objetivo: ', bold: true }, mes.objetivo], style: 'parrafo' } : null,

            { text: 'Resumen', style: 'seccion' },
            tablaSimple(
                [th('Piezas'), th('Publicadas', 'right'), th('Programadas', 'right'), th('Listas sin salir', 'right'), th('Sin terminar', 'right')],
                [[
                    String(resumen.total),
                    { text: String(resumen.por.publicado), alignment: 'right' },
                    { text: String(resumen.por.programado), alignment: 'right' },
                    { text: String(resumen.por.finalizado + resumen.por.aprobado), alignment: 'right' },
                    { text: String(resumen.abiertas), alignment: 'right' },
                ]],
                ['*', 'auto', 'auto', 'auto', 'auto']),

            {
                columns: [
                    { width: '*', stack: [
                        { text: 'Por marca', style: 'seccion' },
                        ...Object.entries(porMarca).map(([id, n]) => ({ text: `${marcas[id]?.nombre || '—'}: ${n}`, style: 'item' })),
                    ] },
                    { width: '*', stack: [
                        { text: 'Por formato', style: 'seccion' },
                        ...FORMATOS.filter((f) => mezcla.formatos[f.value])
                            .map((f) => ({ text: `${f.label}: ${mezcla.formatos[f.value]}`, style: 'item' })),
                    ] },
                    { width: '*', stack: [
                        { text: 'Por tema', style: 'seccion' },
                        ...Object.entries(mezcla.pilares).map(([k, n]) => ({ text: `${pilarDe(k).label}: ${n}`, style: 'item' })),
                    ] },
                ],
                margin: [0, 0, 0, 8],
            },

            { text: 'Calendario', style: 'seccion' },
            tablaSimple(
                [th('Fecha'), th('Marca'), th('Formato'), th('Pieza'), th('Redes'), th('Estado')],
                piezas.map((p) => [
                    fechaNumerica(p.fecha, { anio: false }),
                    marcasDe(p).map((m) => marcas[m]?.nombre).filter(Boolean).join(', ') || '—',
                    formatoDe(p.formato).label,
                    { text: p.titulo + (p.promocion_id && promociones[p.promocion_id] ? `\nPromoción: ${promociones[p.promocion_id].nombre}` : ''), fontSize: 8 },
                    (p.redes || []).map(nombreRed).join(', '),
                    estadoDe(p.estado).label,
                ]),
                ['auto', 'auto', 'auto', '*', 'auto', 'auto']),

            { text: 'Pauta', style: 'seccion' },
            pautas.length ? tablaSimple(
                [th('Pieza'), th('Objetivo'), th('Presupuesto', 'right'), th('Gastado', 'right'), th('Alcance', 'right'), th('Mensajes', 'right'), th('Clics', 'right')],
                [
                    ...pautas.map((p) => [
                        { text: p.titulo, fontSize: 8 },
                        objetivoDe(p.pauta.objetivo).label || '—',
                        { text: dinero(p.pauta.presupuesto), alignment: 'right' },
                        { text: p.pauta.gastado != null ? dinero(p.pauta.gastado) : '—', alignment: 'right' },
                        { text: cifra(p.pauta.alcance), alignment: 'right' },
                        { text: cifra(p.pauta.mensajes), alignment: 'right' },
                        { text: cifra(p.pauta.clics), alignment: 'right' },
                    ]),
                    [
                        { text: 'Total', bold: true }, '',
                        { text: dinero(tot.presupuesto), alignment: 'right', bold: true },
                        { text: dinero(tot.gastado), alignment: 'right', bold: true },
                        { text: cifra(tot.alcance), alignment: 'right', bold: true },
                        { text: cifra(tot.mensajes), alignment: 'right', bold: true },
                        { text: cifra(tot.clics), alignment: 'right', bold: true },
                    ],
                ],
                ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'])
                : { text: 'Sin pauta este mes.', style: 'parrafo' },
            pautas.length ? {
                text: [
                    `Presupuesto del mes ${dinero(tot.presupuestoMes)} · asignado ${dinero(tot.presupuesto)} · sin asignar ${dinero(tot.disponible)}`,
                    tot.costoPorMensaje != null ? ` · costo por mensaje ${dinero(tot.costoPorMensaje)}` : '',
                    tot.costoPorClic != null ? ` · costo por clic ${dinero(tot.costoPorClic)}` : '',
                ].join(''),
                style: 'nota',
            } : null,

            conEfecto.length ? { text: 'Ventas de las promociones', style: 'seccion' } : null,
            conEfecto.length ? tablaSimple(
                [th('Pieza'), th('Días'), th('Antes', 'right'), th('Durante', 'right'), th('Cambio', 'right')],
                conEfecto.map((p) => {
                    const v = variacionDeVentas(efectos[p.id]);
                    return [
                        { text: `${p.titulo}\n${promociones[p.promocion_id]?.nombre || ''}`, fontSize: 8 },
                        String(efectos[p.id].dias),
                        { text: dinero(v.antes), alignment: 'right' },
                        { text: dinero(v.durante), alignment: 'right' },
                        { text: v.pct == null ? 'sin ventas antes' : formatPct(v.pct, { decimales: 0 }), alignment: 'right' },
                    ];
                }),
                ['*', 'auto', 'auto', 'auto', 'auto']) : null,
            conEfecto.length ? {
                text: 'Compara la venta de los productos de la promoción en los días de la pauta contra los mismos días justo antes. '
                    + 'No aísla otros factores (temporada, inventario); es una referencia, no una medición del anuncio.',
                style: 'nota',
            } : null,
            { text: `Estados: ${ESTADOS_PIEZA.map((e) => e.label).join(' · ')}`, style: 'nota' },
        ].filter(Boolean),
        styles: {
            titulo:  { fontSize: 18, bold: true, color: '#111' },
            sub:     { fontSize: 10, color: '#555', margin: [0, 2, 0, 10] },
            seccion: { fontSize: 11, bold: true, margin: [0, 8, 0, 4] },
            th:      { fontSize: 8, bold: true, color: '#555' },
            item:    { fontSize: 9, color: '#333', margin: [0, 0, 0, 2] },
            parrafo: { fontSize: 9, color: '#333', margin: [0, 0, 0, 8] },
            nota:    { fontSize: 8, color: '#666', margin: [0, 0, 0, 10], lineHeight: 1.25 },
        },
        defaultStyle: { fontSize: 9 },
    };
}

export async function descargarInformePdf(datos) {
    const pdfMake = await getPdfMake();
    pdfMake.createPdf(construirInformeDoc(datos)).download(`Marketing_${String(datos.mes.mes).slice(0, 7)}.pdf`);
}
