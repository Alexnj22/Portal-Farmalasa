/**
 * El documento que se le entrega a alguien el día que entra.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Hasta hoy la contraseña temporal se mostraba en un **aviso de 20 segundos** y
 * se copiaba al portapapeles. Si nadie la anotaba en esos 20 segundos, se
 * perdía: la contraseña sólo existe en esa respuesta del servidor, así que
 * recuperarla es reiniciarla. Y aunque alguien la anotara, quedaba un papelito
 * con una credencial y sin ninguna de las cosas que la persona necesita saber.
 *
 * Un documento resuelve las dos: se guarda, se imprime, se entrega, y puede
 * decir todo lo demás —cómo entrar, qué le toca hacer con su ISSS y su AFP, y
 * su carné—.
 *
 * ── El carné que va acá es el DEFINITIVO ────────────────────────────────────
 *
 * Es el `kiosk_pin`: el MISMO código que va a llevar su carné de plástico. La
 * primera versión emitía uno del día y estaba mal por dos motivos — ése vence a
 * medianoche, o sea que el papel deja de servir el mismo día que se lo
 * entregan, y emitirlo MATA el anterior, así que un alta que después falla
 * dejaba a alguien sin el papel que ya tenía.
 *
 * Que sea la credencial permanente sube la apuesta: por eso el documento lo
 * dice en voz alta —cualquiera que le tome una foto puede marcar por esa
 * persona— y por eso nunca lo escribe en texto.
 *
 * ── Lo que este documento NO hace ───────────────────────────────────────────
 *
 * **No escribe el valor del carné en texto.** Es la instrucción del usuario del
 * 2026-08-20 sobre el carné de papel —*«JAMÁS lo debes mostrar»*— y vale igual
 * acá: es una credencial que abre el portal, y en claro basta una foto. Va sólo
 * como código de barras, que es lo que el lector necesita y lo que un vistazo
 * no puede copiar.
 *
 * **No se manda a ningún lado.** Se descarga y ya. Quien lo entrega decide cómo.
 */

// pdfmake y jsbarcode van por `await import()`: son las dos librerías pesadas de
// la regla de CLAUDE.md, y este archivo lo importa el alta de personal, que casi
// siempre se abre sin llegar a generar un documento.
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

/** La dirección que la persona va a teclear. */
export const DIRECCION_DEL_PORTAL = 'portal.farmasalud.lat';

/**
 * El código de barras como PNG.
 *
 * pdfmake no dibuja SVG con la fidelidad que necesita un lector —el resto del
 * portal lo usa como SVG porque va a una ticketera—, así que acá se rasteriza.
 * Sin `document` (una prueba, un servidor) devuelve `null` y el documento sale
 * sin carné en vez de romperse: el usuario y la contraseña siguen sirviendo.
 */
async function barrasComoPng(valor) {
    const limpio = String(valor || '').toUpperCase().replace(/\s/g, '');
    if (!limpio || typeof document === 'undefined') return null;
    try {
        const JsBarcode = (await import('jsbarcode')).default;
        const canvas = document.createElement('canvas');
        JsBarcode(canvas, limpio, {
            // CODE128 es la del carné de plástico, o sea la única probada contra
            // los lectores que ya hay en las salas (ver `carnePrint.js`).
            format: 'CODE128', width: 2, height: 60, displayValue: false, margin: 0,
        });
        return canvas.toDataURL('image/png');
    } catch {
        return null;
    }
}

const soloFecha = (v) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });
};

/**
 * Qué le toca hacer a la persona con su ISSS y su AFP, y qué no.
 *
 * Los dos no se tramitan igual y confundirlos hace que el documento le pida
 * algo que no puede hacer: **al ISSS lo inscribe el patrono** y **la AFP la
 * elige el trabajador**. Es la misma distinción de `utils/acreditaciones.js`,
 * dicha del lado de quien recibe el papel.
 *
 * `null` —nadie preguntó— NO genera texto. Escribir «tienes que afiliarte» a
 * quien quizá ya está afiliado es peor que no decir nada.
 */
export function orientacionPrevisional({ isss_estado, afp_estado } = {}) {
    const bloques = [];

    if (isss_estado && isss_estado !== 'TIENE') {
        bloques.push({
            titulo: 'Tu ISSS',
            texto: isss_estado === 'EN_TRAMITE'
                ? 'Tu inscripción está en trámite. La hace la empresa: no tienes que ir a ninguna oficina. '
                  + 'Cuando salga tu número te lo pasamos.'
                : 'Todavía no estás inscrito. La inscripción la hace la empresa, no tú: '
                  + 'no tienes que ir a ninguna oficina ni llevar papeles. Talento Humano lo tramita.',
        });
    }

    if (afp_estado && afp_estado !== 'TIENE') {
        bloques.push({
            titulo: 'Tu AFP',
            texto: afp_estado === 'EN_TRAMITE'
                ? 'Tu afiliación está en trámite. La AFP la eliges tú, así que si te piden algo, eres tú '
                  + 'quien tiene que responder. Avísale a Talento Humano cuando te den tu número.'
                : 'Todavía no estás afiliado, y esto sí lo tienes que hacer tú: la AFP la elige el trabajador '
                  + 'y sólo él puede afiliarse. Elige una (Confía o Crecer), preséntate en cualquiera de sus '
                  + 'agencias con tu DUI y pide tu afiliación. Desde enero de 2023 tu NUP es tu mismo número '
                  + 'de DUI, así que no necesitas otro número. Cuando te afilien, avísale a Talento Humano.',
        });
    }

    return bloques;
}

/**
 * Arma el documento. Devuelve la definición de pdfmake, sin descargar nada.
 *
 * Separado de la descarga a propósito: así una prueba puede leer lo que dice el
 * documento sin abrir un navegador ni bajar una librería.
 */
export function definicionDelDocumento({
    nombre, cargo = '', sala = '', usuario, contrasenaTemporal,
    barrasPng = null, previsional = [],
    fechaDeInicio = null,
}) {
    const gris = '#6B7280';
    const linea = { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#E5E7EB' }], margin: [0, 14, 0, 14] };

    const cuerpo = [
        { text: 'Tus accesos', style: 'kicker' },
        { text: nombre || '', style: 'nombre' },
        { text: [cargo, sala].filter(Boolean).join('  ·  '), style: 'subtitulo' },
        ...(fechaDeInicio ? [{ text: `Inicio de labores: ${soloFecha(fechaDeInicio) || fechaDeInicio}`, style: 'pie' }] : []),
        linea,

        { text: 'Cómo entrar al portal', style: 'seccion' },
        {
            ol: [
                `Abre ${DIRECCION_DEL_PORTAL} en el navegador del teléfono o de la computadora.`,
                'Escribe tu usuario y la contraseña temporal de abajo.',
                'El portal te va a pedir que cambies la contraseña. Elige una que sólo tú sepas.',
            ],
            style: 'texto', margin: [0, 0, 0, 10],
        },
        {
            table: {
                widths: ['auto', '*'],
                body: [
                    [{ text: 'Usuario', style: 'etiqueta' }, { text: usuario || '—', style: 'credencial' }],
                    [{ text: 'Contraseña temporal', style: 'etiqueta' }, { text: contrasenaTemporal || '—', style: 'credencial' }],
                ],
            },
            layout: 'lightHorizontalLines',
        },
        {
            text: 'Esta contraseña sirve una sola vez y sólo hasta que la cambies. Si alguien más la vio, '
                + 'cámbiala apenas entres y avísale a Talento Humano.',
            style: 'nota', margin: [0, 8, 0, 0],
        },
    ];

    if (barrasPng) {
        cuerpo.push(linea);
        cuerpo.push({ text: 'Tu carné', style: 'seccion' });
        cuerpo.push({
            text: 'Éste es el mismo código que va a llevar tu carné de plástico. Sirve para marcar tu '
                + 'entrada y tu salida y para entrar al portal, y sigue sirviendo cuando te entreguen '
                + 'el plástico — no caduca. Mientras tanto, recorta este pedazo y guárdalo.',
            style: 'texto', margin: [0, 0, 0, 8],
        });
        cuerpo.push({ image: barrasPng, width: 230, margin: [0, 0, 0, 4] });
        cuerpo.push({ text: nombre || '', style: 'pie' });
        // El número NO se escribe: quien lo lee es el lector, y en claro basta
        // una foto desde el otro lado del mostrador.
        cuerpo.push({
            text: 'Cuídalo como cuidarías el carné: cualquiera que le tome una foto puede marcar por ti '
                + 'y entrar al portal como tú. Si lo pierdes, avísale a Talento Humano y se cambia el código.',
            style: 'nota', margin: [0, 6, 0, 0],
        });
    }

    if (previsional.length) {
        cuerpo.push(linea);
        cuerpo.push({ text: 'Tu ISSS y tu AFP', style: 'seccion' });
        for (const b of previsional) {
            cuerpo.push({ text: b.titulo, style: 'subseccion' });
            cuerpo.push({ text: b.texto, style: 'texto', margin: [0, 0, 0, 8] });
        }
    }

    cuerpo.push(linea);
    cuerpo.push({
        text: 'Este documento tiene tus claves. Guárdalo o destrúyelo después de entrar — no lo dejes '
            + 'sobre un mostrador.',
        style: 'nota',
    });

    return {
        pageSize: 'LETTER',
        pageMargins: [40, 40, 40, 40],
        info: { title: `Accesos — ${nombre || ''}` },
        content: cuerpo,
        styles: {
            kicker:     { fontSize: 8,  color: gris, characterSpacing: 1.6, bold: true, margin: [0, 0, 0, 2] },
            nombre:     { fontSize: 22, bold: true },
            subtitulo:  { fontSize: 11, color: gris, margin: [0, 2, 0, 0] },
            seccion:    { fontSize: 13, bold: true, margin: [0, 0, 0, 6] },
            subseccion: { fontSize: 10, bold: true, margin: [0, 2, 0, 2] },
            texto:      { fontSize: 10, lineHeight: 1.35 },
            etiqueta:   { fontSize: 9,  color: gris, margin: [0, 6, 12, 6] },
            credencial: { fontSize: 15, bold: true, margin: [0, 4, 0, 4] },
            nota:       { fontSize: 8.5, color: gris, italics: true, lineHeight: 1.3 },
            pie:        { fontSize: 9,  color: gris },
        },
        defaultStyle: { fontSize: 10 },
    };
}

/** El nombre del archivo: se reconoce en la carpeta de descargas sin abrirlo. */
export function nombreDelArchivo(nombre) {
    const limpio = String(nombre || 'empleado').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return `accesos-${limpio || 'empleado'}.pdf`;
}

/**
 * Arma el documento y lo descarga.
 *
 * @returns {Promise<{ok: boolean, motivo?: string}>} nunca lanza: si el
 *   documento falla, la ficha YA se guardó y la contraseña sigue viva en el
 *   aviso. Tumbar el alta por un PDF sería cambiar un problema chico por uno
 *   grande.
 */
export async function descargarDocumentoDeBienvenida(datos) {
    try {
        const [pdfMake, barrasPng] = await Promise.all([
            getPdfMake(),
            barrasComoPng(datos?.valorDelCarne),
        ]);
        const def = definicionDelDocumento({ ...datos, barrasPng, previsional: orientacionPrevisional(datos) });
        pdfMake.createPdf(def).download(nombreDelArchivo(datos?.nombre));
        return { ok: true };
    } catch (e) {
        return { ok: false, motivo: String(e?.message || e) };
    }
}
