/**
 * La constancia de una sanción del RIT Art. 83 — para imprimir, firmar y subir.
 *
 * ── Por qué existe en papel ─────────────────────────────────────────────────
 * Porque el reglamento lo exige y una pantalla no puede sustituirlo. El Art. 83
 * num. 1 manda «dejar constancia de dicho acto, en el cual se exigirá la
 * presencia del trabajador»; el num. 2 va más lejos y pide que se firme «por
 * ambas partes» y que el compromiso quede **con puño y letra del trabajador**.
 * Eso último es literal: un campo de texto escrito con el teclado de otro no es
 * la letra de nadie. Por eso el documento deja renglones EN BLANCO y no un
 * párrafo redactado — el espacio es el punto.
 *
 * ── Y por qué lleva el Art. 77 impreso ──────────────────────────────────────
 * El trabajador tiene dos días hábiles para reclamar la sanción ante Recursos
 * Humanos. Un derecho con plazo que nadie le comunica es un derecho que vence
 * solo. Va en el mismo papel que le entregan, arriba de su firma, para que no
 * dependa de que alguien se acuerde de decírselo.
 *
 * ── Qué NO hace ─────────────────────────────────────────────────────────────
 * No firma nada ni da por cumplido el trámite. Genera la hoja; el acto es
 * presencial. Lo que vuelve al portal es el papel escaneado, colgado del mismo
 * evento (`employee_documents.event_id`).
 *
 * El papel no tiene tema: los colores son los institucionales, muestreados del
 * logo, y no tokens del modo claro/oscuro. Es el mismo criterio del ticket.
 */
import { EMPRESA } from '../constants/empresa';
import { MARCA } from './documentoDeBienvenida';

// pdfmake por `await import()` — la regla de librerías pesadas de CLAUDE.md.
// Este archivo ya viaja diferido dentro del modal de sanción, pero la librería
// pesa más que todo lo demás junto y sólo hace falta al apretar el botón.
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
            pdfMakePromise = null;   // reintentar, no quedar roto
            throw err;
        });
    }
    return pdfMakePromise;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * «31 de agosto de 2026», que es como se lee una fecha en un documento que
 * alguien va a firmar. El mediodía evita que una fecha sin hora retroceda un
 * día al leerse como UTC.
 */
function enLetras(iso) {
    if (!iso) return '';
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/**
 * Cómo se llama cada peldaño EN EL PAPEL, con su numeral.
 *
 * Los rótulos de la pantalla («Suspensión de 1 día») sirven para elegir; acá
 * hace falta el numeral del reglamento, porque el papel tiene que poder leerse
 * contra el RIT. Es la razón de que esta tabla no reuse `PELDANOS`.
 */
const SANCION = {
    1: { titulo: 'AMONESTACIÓN VERBAL',  numeral: 'Art. 83, numeral 1' },
    2: { titulo: 'AMONESTACIÓN ESCRITA', numeral: 'Art. 83, numeral 2' },
    3: { titulo: 'SUSPENSIÓN DE UN DÍA SIN GOCE DE SALARIO', numeral: 'Art. 83, numeral 3' },
    4: { titulo: 'SUSPENSIÓN SIN GOCE DE SALARIO',           numeral: 'Art. 83, numeral 4' },
};

/** Renglones vacíos para escribir a mano. El espacio ES el requisito. */
const renglones = (cuantos) => ({
    table: {
        widths: ['*'],
        body: Array.from({ length: cuantos }, () => [{ text: ' ', margin: [0, 7, 0, 0] }]),
    },
    layout: {
        hLineWidth: (i, node) => (i === 0 ? 0 : (i === node.table.body.length ? 0.7 : 0.7)),
        vLineWidth: () => 0,
        hLineColor: () => '#B9B9B9',
    },
    margin: [0, 4, 0, 0],
});

const etiqueta = (t) => ({ text: t, fontSize: 7.5, color: MARCA.gris,
                           characterSpacing: 0.6, bold: true, margin: [0, 0, 0, 1] });

/**
 * La definición del documento. Separada de la descarga para poder mirarla en
 * una prueba sin generar un PDF — la geometría de un papel que alguien firma no
 * se verifica a ojo.
 */
export function definicionDeLaConstancia({
    nombre, dui, cargo, sala, falta, faltaArticulo, peldano, fecha,
    dias, hasta, autorizacion, hechos, impuestaPor, logoPng, lugar,
} = {}) {
    const s = SANCION[peldano] || SANCION[1];
    const esSuspension = peldano === 3 || peldano === 4;

    const dato = (rotulo, valor) => [
        etiqueta(rotulo),
        { text: valor || '—', fontSize: 10, color: MARCA.tinta, margin: [0, 0, 0, 8] },
    ];

    return {
        pageSize: 'LETTER',
        pageMargins: [56, 44, 56, 52],
        defaultStyle: { fontSize: 10, color: MARCA.tinta, lineHeight: 1.25 },
        footer: (pagina, total) => ({
            columns: [
                { text: `${EMPRESA.razonSocial} · NIT ${EMPRESA.nit}`, fontSize: 7, color: MARCA.gris },
                { text: `${pagina} de ${total}`, fontSize: 7, color: MARCA.gris, alignment: 'right' },
            ],
            margin: [56, 12, 56, 0],
        }),
        content: [
            {
                columns: [
                    logoPng
                        ? { image: logoPng, width: 116, margin: [0, 0, 0, 0] }
                        : { text: EMPRESA.razonSocial, bold: true, fontSize: 12, color: MARCA.magenta },
                    {
                        stack: [
                            { text: 'CONSTANCIA DE MEDIDA DISCIPLINARIA', alignment: 'right',
                              bold: true, fontSize: 11, color: MARCA.magenta },
                            { text: `Reglamento Interno de Trabajo · ${s.numeral}`,
                              alignment: 'right', fontSize: 8, color: MARCA.gris },
                            // El NIT y el NRC son lo que hace el documento
                            // atribuible al patrono. Sin eso, el resto no se
                            // sostiene: una hoja sin emisor no acredita nada.
                            { text: `NIT ${EMPRESA.nit}  ·  NRC ${EMPRESA.nrc}`,
                              alignment: 'right', fontSize: 7.5, color: MARCA.gris, margin: [0, 4, 0, 0] },
                        ],
                    },
                ],
                margin: [0, 0, 0, 6],
            },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 503, y2: 0, lineWidth: 2, lineColor: MARCA.verde }],
              margin: [0, 0, 0, 16] },

            // ⚠️ El LUGAR llega por parámetro y no está escrito acá. La primera
            // versión decía «Chalatenango» y ese dato no existe en ninguna
            // constante de la empresa — lo había inferido de un comentario
            // sobre fichas de clientes. Un documento que se firma no puede
            // llevar un lugar deducido: o se sabe, o no se pone.
            { text: lugar ? `En ${lugar}, a los ${enLetras(fecha)}.` : `A los ${enLetras(fecha)}.`,
              margin: [0, 0, 0, 14] },

            {
                columns: [
                    { width: '*', stack: dato('TRABAJADOR', nombre) },
                    { width: 150, stack: dato('DOCUMENTO ÚNICO DE IDENTIDAD', dui) },
                ],
                columnGap: 18,
            },
            {
                columns: [
                    { width: '*', stack: dato('CARGO', cargo) },
                    { width: 150, stack: dato('LUGAR DE TRABAJO', sala) },
                ],
                columnGap: 18,
            },

            { ...etiqueta('FALTA COMETIDA'), margin: [0, 6, 0, 1] },
            { text: faltaArticulo ? `${falta} (${faltaArticulo})` : (falta || '—'),
              fontSize: 10, margin: [0, 0, 0, 8] },

            ...(hechos ? [
                etiqueta('HECHOS'),
                { text: hechos, fontSize: 10, margin: [0, 0, 0, 10] },
            ] : []),

            {
                table: {
                    widths: ['*'],
                    body: [[{
                        stack: [
                            { text: 'SANCIÓN IMPUESTA', fontSize: 7.5, color: MARCA.gris,
                              characterSpacing: 0.6, bold: true },
                            { text: s.titulo, bold: true, fontSize: 12, color: MARCA.magenta,
                              margin: [0, 2, 0, 0] },
                            ...(esSuspension ? [{
                                text: peldano === 3
                                    ? `Un día sin goce de salario: ${enLetras(fecha)}.`
                                    : `${dias} días sin goce de salario, del ${enLetras(fecha)} al ${enLetras(hasta)}.`,
                                fontSize: 10, margin: [0, 3, 0, 0],
                            }] : []),
                            // La autorización del Director General de Inspección de
                            // Trabajo va IMPRESA y no sólo guardada: sin ella la
                            // suspensión de más de un día es ilegal, y quien reciba
                            // el papel tiene que poder verla.
                            ...(peldano === 4 && autorizacion ? [{
                                text: `Autorización y calificación de motivos del Director General de Inspección de Trabajo: ${autorizacion}.`,
                                fontSize: 9, color: MARCA.gris, margin: [0, 3, 0, 0],
                            }] : []),
                        ],
                        margin: [10, 8, 10, 9],
                        fillColor: MARCA.tenue,
                    }]],
                },
                layout: 'noBorders',
                margin: [0, 0, 0, 14],
            },

            {
                text: peldano === 1
                    ? 'Se le advierte al trabajador que debe rectificar su conducta de inmediato.'
                    : 'Se le advierte al trabajador que la reincidencia dentro de los siguientes sesenta días habilita a la Empresa a aplicar la sanción siguiente del Art. 83 del Reglamento Interno de Trabajo.',
                margin: [0, 0, 0, 14],
            },

            // ── El compromiso, en blanco y a propósito ────────────────────────
            etiqueta('COMPROMISO DEL TRABAJADOR — ESCRÍBALO DE SU PUÑO Y LETRA'),
            { text: 'El Art. 83 del Reglamento Interno exige que el compromiso de cesar en el cometimiento de dichas faltas y mejorar sea declarado por el trabajador con su propia letra.',
              fontSize: 8, color: MARCA.gris, margin: [0, 0, 0, 2] },
            renglones(4),

            // ── El derecho a reclamar (Art. 77) ───────────────────────────────
            {
                table: {
                    widths: ['*'],
                    body: [[{
                        stack: [
                            { text: 'SI NO ESTÁ DE ACUERDO', fontSize: 7.5, color: MARCA.gris,
                              characterSpacing: 0.6, bold: true },
                            { text: 'Puede presentar su reclamo por escrito ante Recursos Humanos dentro de los DOS DÍAS HÁBILES siguientes a esta fecha; Recursos Humanos debe responderle dentro de los cinco días hábiles siguientes. Si no queda conforme, puede presentar el caso ante la Administración dentro de los dos días hábiles siguientes a esa respuesta, y la Administración resolverá en forma definitiva en un plazo no mayor de cinco días hábiles. (Reglamento Interno de Trabajo, Art. 77.)',
                              fontSize: 8.5, margin: [0, 2, 0, 0] },
                        ],
                        margin: [10, 7, 10, 8],
                    }]],
                },
                layout: {
                    hLineWidth: () => 0.7, vLineWidth: () => 0.7,
                    hLineColor: () => '#D8D8D8', vLineColor: () => '#D8D8D8',
                },
                margin: [0, 16, 0, 24],
            },

            // ── Si el trabajador se niega a firmar ────────────────────────────
            // Es el caso NORMAL en una sanción, no la excepción, y sin este
            // bloque la constancia se cae justo ahí: una hoja sin firma y sin
            // nada que explique por qué no la tiene no prueba que el acto haya
            // ocurrido. Con dos testigos, sí.
            //
            // Va impreso SIEMPRE y en blanco. Imprimirlo sólo cuando haga falta
            // obligaría a saber de antemano si la persona va a firmar, que es
            // justo lo que nadie sabe hasta que está enfrente.
            {
                table: {
                    widths: ['*'],
                    body: [[{
                        stack: [
                            { text: 'SI EL TRABAJADOR SE NIEGA A FIRMAR', fontSize: 7.5, color: MARCA.gris,
                              characterSpacing: 0.6, bold: true },
                            { text: 'Hágase constar aquí el motivo, y firmen dos testigos presentes en el acto.',
                              fontSize: 8.5, margin: [0, 2, 0, 0] },
                            renglones(2),
                            {
                                columns: [
                                    {
                                        width: '*',
                                        stack: [
                                            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 160, y2: 0, lineWidth: 0.7, lineColor: MARCA.gris }], margin: [0, 14, 0, 0] },
                                            { text: 'Testigo', fontSize: 7.5, color: MARCA.gris, margin: [0, 3, 0, 0] },
                                        ],
                                    },
                                    {
                                        width: '*',
                                        stack: [
                                            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 160, y2: 0, lineWidth: 0.7, lineColor: MARCA.gris }], margin: [0, 14, 0, 0] },
                                            { text: 'Testigo', fontSize: 7.5, color: MARCA.gris, margin: [0, 3, 0, 0] },
                                        ],
                                    },
                                ],
                                columnGap: 20,
                            },
                        ],
                        margin: [10, 7, 10, 9],
                    }]],
                },
                layout: {
                    hLineWidth: () => 0.7, vLineWidth: () => 0.7,
                    hLineColor: () => '#D8D8D8', vLineColor: () => '#D8D8D8',
                },
                margin: [0, 0, 0, 22],
            },

            {
                columns: [
                    {
                        width: '*',
                        stack: [
                            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.7, lineColor: MARCA.tinta }] },
                            { text: nombre || '', fontSize: 9, margin: [0, 4, 0, 0] },
                            { text: 'Trabajador', fontSize: 7.5, color: MARCA.gris },
                        ],
                    },
                    {
                        width: '*',
                        stack: [
                            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.7, lineColor: MARCA.tinta }] },
                            { text: impuestaPor || '', fontSize: 9, margin: [0, 4, 0, 0] },
                            { text: 'Por la Empresa', fontSize: 7.5, color: MARCA.gris },
                        ],
                    },
                ],
                columnGap: 26,
            },
        ],
    };
}

/** El nombre del archivo: se reconoce en la carpeta de descargas sin abrirlo. */
export function nombreDeLaConstancia(nombre, fecha) {
    const limpio = String(nombre || 'empleado').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return `constancia-${limpio || 'empleado'}-${String(fecha || '').slice(0, 10)}.pdf`;
}

/**
 * Arma la constancia y la descarga.
 *
 * **Nunca lanza.** La sanción YA quedó registrada cuando esto corre: tumbar la
 * pantalla porque un PDF falló cambiaría un problema chico por uno grande —
 * dejaría a quien sanciona creyendo que no se guardó nada. El fallo vuelve como
 * `{ok:false}` para que la pantalla lo diga y ofrezca reintentar.
 */
export async function descargarConstancia(datos) {
    try {
        const { LOGO_DE_LA_EMPRESA, logoComoDataUrl } = await import('./marcaDeLaSala');
        const [pdfMake, logoPng] = await Promise.all([
            getPdfMake(),
            logoComoDataUrl(LOGO_DE_LA_EMPRESA).catch(() => null),
        ]);
        const def = definicionDeLaConstancia({ ...datos, logoPng });
        pdfMake.createPdf(def).download(nombreDeLaConstancia(datos?.nombre, datos?.fecha));
        return { ok: true };
    } catch (e) {
        return { ok: false, motivo: String(e?.message || e) };
    }
}
