// ── El acta de cierre mensual del servicio de diseño, en PDF ───────────────
//
// Lo que gerencia firmó para el pago del mes: el resultado, las observaciones y
// la FOTO de los números en ese momento (`marketing_cierres.resumen`), no los de
// hoy. pdfmake va por `import()` (gate:bundle); el papel no tiene tema.
import { etiquetaMes, fechaTexto } from './fecha';
import { resultadoCierreDe } from './marketing';

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
            pdfMakePromise = null;
            throw err;
        });
    }
    return pdfMakePromise;
}

const fila = (k, v) => [{ text: k, color: '#555' }, { text: String(v ?? '—'), alignment: 'right' }];

export function construirActaDoc({ mes, cierre, firmante, prestador }) {
    const r = cierre.resumen || {};
    const m = r.metas || {};
    const cal = r.calendario || {};
    return {
        pageSize: 'LETTER',
        pageMargins: [50, 50, 50, 50],
        content: [
            { text: 'Acta de cierre mensual', fontSize: 18, bold: true },
            { text: `Servicio de diseño gráfico y gestión de contenido · ${etiquetaMes(mes)}`, fontSize: 10, color: '#555', margin: [0, 2, 0, 14] },
            { text: [{ text: 'Resultado: ', bold: true }, resultadoCierreDe(cierre.resultado).label], fontSize: 12, margin: [0, 0, 0, 6] },
            cierre.observaciones ? { text: [{ text: 'Observaciones: ', bold: true }, cierre.observaciones], margin: [0, 0, 0, 12] } : null,
            {
                table: {
                    widths: ['*', 'auto'],
                    body: [
                        [{ text: 'Medida', bold: true }, { text: 'Resultado', bold: true, alignment: 'right' }],
                        fila('Publicaciones aprobadas (imágenes y carruseles)', `${r.publicaciones?.aprobadas ?? 0} de ${m.publicaciones ?? '—'}`),
                        fila('Videos o reels aprobados', `${r.videos?.aprobados ?? 0} de ${m.videos ?? '—'}`),
                        fila('Historias aprobadas', r.historias ?? 0),
                        fila(`Piezas listas con ${m.dias_anticipacion ?? 10} días de anticipación`, `${r.puntualidad?.a_tiempo ?? 0} a tiempo · ${r.puntualidad?.tarde ?? 0} tarde`),
                        fila('Calendario enviado desde el mes anterior',
                            cal.exento ? 'No aplica este mes' : (cal.a_tiempo == null ? 'Sin enviar' : (cal.a_tiempo ? 'Sí' : 'No'))),
                        fila('Visitas presenciales', `${r.visitas ?? 0} de ${m.visitas ?? '—'}`),
                        fila('Entregables del manual de marca', r.manual ?? 0),
                        fila('Rondas de cambios pedidas', `${r.cambios?.rondas ?? 0} (en ${r.cambios?.piezas_con_cambios ?? 0} piezas)`),
                        fila('Tiempo promedio de corrección', r.cambios?.horas_correccion != null ? `${r.cambios.horas_correccion} h` : '—'),
                        fila('Solicitudes extraordinarias', `${r.extraordinarias?.entregadas ?? 0} entregadas de ${r.extraordinarias?.pedidas ?? 0}`),
                    ],
                },
                layout: 'lightHorizontalLines',
                margin: [0, 0, 0, 30],
            },
            {
                columns: [
                    { stack: [{ text: '_______________________________' }, { text: firmante || 'Gerencia', margin: [0, 4, 0, 0] },
                        { text: `Firmado en el portal el ${fechaTexto(cierre.firmado_at, { day: 'numeric', month: 'long', year: 'numeric' })}`, fontSize: 8, color: '#666' }] },
                    { stack: [{ text: '_______________________________' }, { text: prestador || 'Prestador del servicio', margin: [0, 4, 0, 0] },
                        { text: 'Enterado', fontSize: 8, color: '#666' }] },
                ],
            },
        ].filter(Boolean),
        defaultStyle: { fontSize: 10 },
    };
}

export async function descargarActaPdf(datos) {
    const pdfMake = await getPdfMake();
    pdfMake.createPdf(construirActaDoc(datos)).download(`Acta_marketing_${String(datos.mes).slice(0, 7)}.pdf`);
}
