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

import { EMPRESA } from '../constants/empresa';

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

/* ── Los colores institucionales ────────────────────────────────────────────
 *
 * Salen del logo de la empresa (`public/Logo192.png`), muestreados píxel por
 * píxel y no elegidos a ojo: la cruz es `#981D97` y el arco `#8EC30F`. Están
 * acá y no en tokens del tema porque un carné IMPRESO no tiene tema — es el
 * mismo criterio que la regla del ticket: el papel no acompaña al modo oscuro.
 */
export const MARCA = {
    magenta: '#981D97',
    verde:   '#8EC30F',
    tinta:   '#231F20',
    gris:    '#6B7280',
    tenue:   '#F3E9F3',
};

/* ── El carné mide lo que mide una tarjeta ──────────────────────────────────
 * ID-1: 85.6 × 53.98 mm. En puntos de PDF (1 pt = 1/72 in) son 242.6 × 153.
 * No es una proporción elegida: es para que salga de la impresora del tamaño
 * de la funda donde va a ir. */
const CARNE = { ancho: 242.6, alto: 153 };

/**
 * El avatar cuando todavía no hay foto: las iniciales sobre el magenta.
 *
 * Un hueco gris en un carné se lee como un carné a medio hacer. Las iniciales
 * sobre el color de la empresa se leen como una decisión — y el día que llegue
 * la foto, ocupa exactamente el mismo lugar.
 */
export async function avatarComoPng(nombre, lado = 220) {
    if (typeof document === 'undefined') return null;
    try {
        const c = document.createElement('canvas');
        c.width = lado; c.height = lado;
        const x = c.getContext('2d');
        x.fillStyle = MARCA.magenta;
        x.fillRect(0, 0, lado, lado);
        // El arco del logo, insinuado: la misma curva verde, abajo a la
        // derecha, para que el hueco pertenezca a la marca y no sea un cuadro
        // de color cualquiera.
        x.fillStyle = MARCA.verde;
        x.beginPath();
        x.arc(lado * 0.92, lado * 1.02, lado * 0.42, 0, Math.PI * 2);
        x.fill();
        /* La primera y la ÚLTIMA palabra: «Carlos Antonio Renderos Mejía» da
         * CM y no CA. Con las dos primeras salían dos nombres de pila, que es
         * justo lo que no distingue a nadie en una familia. */
        const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
        const iniciales = partes.length
            ? (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
            : '';
        if (iniciales) {
            x.fillStyle = '#FFFFFF';
            x.font = `bold ${Math.round(lado * 0.38)}px Helvetica, Arial, sans-serif`;
            x.textAlign = 'center';
            x.textBaseline = 'middle';
            x.fillText(iniciales, lado / 2, lado * 0.52);
        }
        return c.toDataURL('image/png');
    } catch {
        return null;
    }
}

/**
 * La foto de la persona, recortada CUADRADA y como PNG.
 *
 * Cuadrada porque el hueco del carné lo es: dejar que la imagen se estire para
 * llenarlo deforma la cara, y `fit` la encoge y deja franjas de color a los
 * lados. Se recorta del centro, que es donde está la cara en toda foto de
 * carné.
 */
export async function fotoCuadradaComoPng(src, lado = 220) {
    if (!src || typeof document === 'undefined') return null;
    try {
        const img = await new Promise((res, rej) => {
            const el = new Image();
            el.onload = () => res(el);
            el.onerror = rej;
            el.crossOrigin = 'anonymous';
            el.src = src;
        });
        const c = document.createElement('canvas');
        c.width = lado; c.height = lado;
        const x = c.getContext('2d');
        const corto = Math.min(img.naturalWidth, img.naturalHeight);
        x.drawImage(img,
            (img.naturalWidth - corto) / 2, (img.naturalHeight - corto) / 2, corto, corto,
            0, 0, lado, lado);
        return c.toDataURL('image/jpeg', 0.9);
    } catch {
        // Una foto que no se pudo leer no puede tumbar el carné: sale con el
        // avatar de iniciales, que es exactamente para esto.
        return null;
    }
}

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
    /* `new Date('2026-09-01')` es medianoche UTC, y en El Salvador (UTC-6) eso
     * es el 31 de agosto: la fecha de inicio salía impresa un día antes. Es el
     * defecto que ya está anotado en memoria como «una fecha sin hora leída
     * como UTC retrocede». Se le pone hora del mediodía LOCAL. */
    const soloDia = /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
    const d = soloDia ? new Date(`${v}T12:00:00`) : new Date(v);
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

/* ── Lo básico del reglamento, dicho para quien entra ───────────────────────
 *
 * Son SEIS puntos de los sesenta y pico que tiene el reglamento interno, y la
 * selección no es un resumen: es lo que alguien necesita saber su primer día y
 * que, si no lo sabe, se entera perdiendo algo —el día de descanso por diez
 * minutos de tardanza, por ejemplo—.
 *
 * Cada uno lleva su artículo. No es formalismo: un papel que dice «no se puede»
 * sin decir dónde lo dice es una orden; con el artículo es una regla que la
 * persona puede ir a leer, y el reglamento completo está aprobado por la
 * Dirección General de Trabajo y a la vista en la empresa.
 *
 * Lo que NO va acá: nada que se parezca a una sanción, y nada de lo que le
 * corresponde a la empresa. Este papel es de bienvenida.
 */
export const BASICO_DEL_REGLAMENTO = [
    {
        titulo: 'Tu jornada y tu descanso',
        texto: 'La jornada diurna es de 8 horas y la semana de 44; la nocturna, de 7 y 39. '
             + 'Tienes derecho a un día de descanso remunerado por cada semana laboral, y entre '
             + 'una jornada y la siguiente deben pasar al menos 8 horas.',
        art: 'Arts. 16, 19 y 21',
    },
    {
        titulo: 'Marcar tu entrada y tu salida',
        texto: 'Registrar tu entrada y tu salida es una obligación, no un trámite: es lo que '
             + 'prueba tus horas. Se marca con tu carné.',
        art: 'Art. 51 nº 1',
    },
    {
        titulo: 'Los diez minutos de la semana',
        texto: 'Hay diez minutos de tolerancia POR SEMANA para las entradas. Pasando de ahí sin '
             + 'causa justificada se pierde la remuneración del día de descanso — no es una multa, '
             + 'es una prestación que se deja de ganar.',
        art: 'Art. 26',
    },
    {
        titulo: 'Si no vas a poder llegar',
        texto: 'Avisa de inmediato a tu jefe por el medio que tengas a mano, y al volver comprueba '
             + 'el motivo. Avisar a tiempo es lo que separa una ausencia justificada de una que no lo es.',
        art: 'Art. 25',
    },
    {
        titulo: 'Salir antes de tu hora',
        texto: 'Se permanece en el lugar de trabajo durante toda la jornada. Salir antes se puede, '
             + 'pero con autorización de tu jefe inmediato.',
        art: 'Art. 27',
    },
    {
        titulo: 'Lo que ves aquí no sale de aquí',
        texto: 'Guarda reserva absoluta sobre lo confidencial de la empresa y de las personas: '
             + 'precios, datos de clientes, recetas, expedientes.',
        art: 'Art. 51 nº 5',
    },
];

/**
 * La página del carné.
 *
 * ── Por qué es una página aparte y no un recuadro más ───────────────────────
 *
 * Porque se RECORTA. La primera página lleva la contraseña temporal, que se
 * guarda o se destruye; el carné se queda con la persona y va en una funda. En
 * la misma hoja, recortar el carné mutila las claves — o al revés, quien
 * archiva las claves se queda sin carné.
 *
 * Va a tamaño ID-1 exacto (85.6 × 54 mm) y con marca de corte, así que sale de
 * la impresora del tamaño de la funda.
 */
export function paginaDelCarne({
    nombre, cargo = '', sala = '', fechaDeInicio = null, barrasPng = null, retratoPng = null,
}) {
    // La tarjeta se dibuja en coordenadas absolutas sobre la hoja: es la única
    // forma de que mida exactamente lo que tiene que medir. Centrada al ancho
    // de una carta (612 pt) y arriba, donde la impresora es más fiel.
    const x0 = Math.round((612 - CARNE.ancho) / 2);
    const y0 = 150;
    const P = 12;                       // el margen interno de la tarjeta
    const bandaAlto = 30;
    const fotoLado = 66;

    const abs = (x, y) => ({ absolutePosition: { x: x0 + x, y: y0 + y } });

    return [
        { text: '', pageBreak: 'before' },
        /* El encabezado va en un `columns` con ancho, por lo mismo que el
         * nombre de adentro: un `width` sobre un texto absoluto no se respeta y
         * la línea se estiraba hasta el margen de la hoja, empezando en un sitio
         * y terminando en otro. */
        {
            ...abs(0, -52),
            columns: [{
                width: CARNE.ancho,
                stack: [
                    { text: 'Tu carné', style: 'seccion', margin: [0, 0, 0, 2] },
                    { text: 'Recórtalo por la línea y guárdalo en una funda. Con él marcas tu entrada '
                          + 'y tu salida y entras al portal.', style: 'nota' },
                ],
            }],
        },

        // ── El cartón ──────────────────────────────────────────────────────
        {
            ...abs(0, 0),
            canvas: [
                // La línea de corte, por fuera: se recorta POR ELLA, así que no
                // puede quedar dentro del carné terminado.
                { type: 'rect', x: -6, y: -6, w: CARNE.ancho + 12, h: CARNE.alto + 12,
                  lineWidth: 0.5, lineColor: '#C9C9C9', dash: { length: 3 } },
                // El cartón, blanco con borde tenue.
                { type: 'rect', x: 0, y: 0, w: CARNE.ancho, h: CARNE.alto, r: 8,
                  color: '#FFFFFF', lineWidth: 0.6, lineColor: '#D9D9D9' },
                // La banda superior, en el magenta del logo.
                { type: 'rect', x: 0, y: 0, w: CARNE.ancho, h: bandaAlto, r: 8, color: MARCA.magenta },
                // El cuadrado tapa el radio inferior de la banda: pdfmake no
                // sabe redondear sólo dos esquinas.
                { type: 'rect', x: 0, y: bandaAlto - 8, w: CARNE.ancho, h: 8, color: MARCA.magenta },
                // El filo verde: el arco del logo, dicho en una línea.
                { type: 'rect', x: 0, y: bandaAlto, w: CARNE.ancho, h: 2.5, color: MARCA.verde },
            ],
        },
        { text: EMPRESA.razonSocial.toUpperCase(), style: 'carneEmpresa', ...abs(P, 10) },

        // ── El retrato ─────────────────────────────────────────────────────
        ...(retratoPng ? [{
            image: retratoPng, width: fotoLado, height: fotoLado,
            ...abs(P, bandaAlto + 12),
        }] : []),
        {
            ...abs(P, bandaAlto + 12),
            canvas: [{ type: 'rect', x: 0, y: 0, w: fotoLado, h: fotoLado, r: 4,
                       lineWidth: 0.8, lineColor: MARCA.magenta }],
        },

        /* ── Quién es ───────────────────────────────────────────────────────
         * En un `columns` con ancho FIJO y no como textos sueltos: un `width`
         * sobre un texto con `absolutePosition` pdfmake lo ignora, y el nombre
         * se salía del cartón por la derecha. Medido: «Carlos Antonio Renderos
         * Mejía» cruzaba el borde. */
        {
            ...abs(P * 2 + fotoLado, bandaAlto + 11),
            columns: [{
                width: CARNE.ancho - fotoLado - P * 3,
                stack: [
                    { text: nombre || '', style: 'carneNombre' },
                    { text: cargo || '', style: 'carneCargo', margin: [0, 3, 0, 0] },
                    { text: sala ? `Sala · ${sala}` : '', style: 'carneDato', margin: [0, 4, 0, 0] },
                    { text: fechaDeInicio ? `Desde ${soloFecha(fechaDeInicio) || fechaDeInicio}` : '',
                      style: 'carneDato', margin: [0, 1, 0, 0] },
                ],
            }],
        },

        // ── El código, que es lo que lee la máquina ────────────────────────
        // Sin el número en texto: es la credencial que abre el portal y marca
        // asistencia, y en claro basta una foto desde el otro lado del
        // mostrador. Instrucción del usuario sobre el carné de papel.
        ...(barrasPng ? [{
            image: barrasPng, width: CARNE.ancho - P * 2, height: 26,
            ...abs(P, CARNE.alto - 38),
        }] : []),

        /* ── Lo que vale este pedazo de papel, DICHO ─────────────────────────
         * Vivía en la página 1, con el carné. Al mudarlo acá casi se pierde, y
         * es lo que no puede faltar: el código no caduca y es el mismo del
         * plástico, así que quien le tome una foto puede marcar y entrar por
         * esta persona. Un carné que no se explica se deja sobre un mostrador. */
        {
            ...abs(0, CARNE.alto + 22),
            columns: [{
                width: CARNE.ancho + 60,
                stack: [
                    { text: 'Es el mismo código que va a llevar tu carné de plástico y no caduca: '
                          + 'sigue sirviendo cuando te entreguen la tarjeta.', style: 'nota' },
                    { text: 'Cuídalo como cuidarías el carné: cualquiera que le tome una foto puede '
                          + 'marcar por ti y entrar al portal como tú. Si lo pierdes, avísale a '
                          + 'Talento Humano y se cambia el código.', style: 'nota', margin: [0, 4, 0, 0] },
                ],
            }],
        },
    ];
}

/**
 * Arma el documento. Devuelve la definición de pdfmake, sin descargar nada.
 *
 * Separado de la descarga a propósito: así una prueba puede leer lo que dice el
 * documento sin abrir un navegador ni bajar una librería.
 */
export function definicionDelDocumento({
    nombre, cargo = '', sala = '', usuario, contrasenaTemporal,
    barrasPng = null, barrasCarnePng = null, retratoPng = null, previsional = [],
    fechaDeInicio = null,
}) {
    const gris = '#6B7280';
    const linea = { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#E5E7EB' }], margin: [0, 14, 0, 14] };

    const cuerpo = [
        { text: `Bienvenido a ${EMPRESA.razonSocial}`, style: 'kicker' },
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

    if (previsional.length) {
        cuerpo.push(linea);
        cuerpo.push({ text: 'Tu ISSS y tu AFP', style: 'seccion' });
        for (const b of previsional) {
            cuerpo.push({ text: b.titulo, style: 'subseccion' });
            cuerpo.push({ text: b.texto, style: 'texto', margin: [0, 0, 0, 8] });
        }
    }

    cuerpo.push(linea);
    cuerpo.push({ text: 'Lo básico, para empezar', style: 'seccion' });
    cuerpo.push({
        text: 'Seis puntos del reglamento interno — el completo está aprobado por la Dirección General '
            + 'de Trabajo y a la vista en la empresa.',
        style: 'nota', margin: [0, 0, 0, 6],
    });
    /* En DOS columnas, y no es estética: con la lista a lo ancho, la sexta
     * regla y el cierre se caían a una tercera página —medido— y el carné
     * quedaba en la cuarta. El documento tiene que ser de DOS páginas: una que
     * se guarda o se destruye, y otra que se recorta. */
    const mitad = Math.ceil(BASICO_DEL_REGLAMENTO.length / 2);
    const comoBloque = (r) => ({
        text: [
            { text: `${r.titulo}. `, bold: true },
            { text: r.texto },
            { text: ` (${r.art})`, color: gris },
        ],
        style: 'reglaBreve', margin: [0, 0, 0, 6],
    });
    cuerpo.push({
        columnGap: 18,
        columns: [
            { width: '*', stack: BASICO_DEL_REGLAMENTO.slice(0, mitad).map(comoBloque) },
            { width: '*', stack: BASICO_DEL_REGLAMENTO.slice(mitad).map(comoBloque) },
        ],
    });

    cuerpo.push(linea);
    cuerpo.push({
        text: 'Este documento tiene tus claves. Guárdalo o destrúyelo después de entrar — no lo dejes '
            + 'sobre un mostrador. El carné va en la página siguiente.',
        style: 'nota',
    });

    cuerpo.push(...paginaDelCarne({ nombre, cargo, sala, fechaDeInicio,
        barrasPng: barrasCarnePng || barrasPng, retratoPng }));

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
            // El carné. Tamaños chicos y medidos: en 242 pt de ancho, un
            // nombre largo con 12 pt se parte en tres renglones.
            reglaBreve: { fontSize: 8.5, lineHeight: 1.25 },
            carneEmpresa: { fontSize: 7.5, bold: true, color: '#FFFFFF', characterSpacing: 1.1 },
            carneNombre:  { fontSize: 11.5, bold: true, color: MARCA.tinta, lineHeight: 1.05 },
            carneCargo:   { fontSize: 8.5, color: MARCA.magenta, bold: true },
            carneDato:    { fontSize: 7.5, color: MARCA.gris },
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
        /* El retrato: la foto si la hay, y si no las iniciales sobre el
         * magenta. Nunca un hueco — un carné con un cuadro vacío se lee como un
         * carné a medio hacer, y el día que llegue la foto ocupa el mismo sitio. */
        const [pdfMake, barrasPng, foto] = await Promise.all([
            getPdfMake(),
            barrasComoPng(datos?.valorDelCarne),
            fotoCuadradaComoPng(datos?.foto),
        ]);
        const retratoPng = foto || await avatarComoPng(datos?.nombre);
        const def = definicionDelDocumento({
            ...datos, barrasPng, retratoPng,
            previsional: orientacionPrevisional(datos),
        });
        pdfMake.createPdf(def).download(nombreDelArchivo(datos?.nombre));
        return { ok: true };
    } catch (e) {
        return { ok: false, motivo: String(e?.message || e) };
    }
}
