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

/* ── El carné mide lo que mide una tarjeta, y va DE PIE ─────────────────────
 *
 * ID-1: 85.6 × 53.98 mm. En puntos de PDF (1 pt = 1/72 in) son 242.6 × 153.
 * No es una proporción elegida: es para que salga de la impresora del tamaño de
 * la funda donde va a ir.
 *
 * De pie y no acostado —lo eligió el usuario sobre los seis bocetos— y el
 * motivo se ve al mirarlos: con la tarjeta parada el retrato entra a casi el
 * doble de tamaño, que es lo que hace reconocible a alguien desde el otro lado
 * del mostrador. */
const CARNE = { ancho: 153, alto: 242.6 };

/**
 * El ícono de la farmacia: el arco verde y la cruz morada.
 *
 * Se DIBUJA en un lienzo en vez de incrustar el archivo del logo, y no es un
 * capricho: `public/Logo.png` pesa 3096 × 3186 px, o sea que meterlo en un PDF
 * que se genera en el navegador de una sala costaría más que todo el resto del
 * documento junto. Acá sale a 240 px, que es de sobra para 20 pt impresos.
 *
 * Las dos figuras salen del logo, no de una interpretación: el arco abierto
 * arriba a la derecha y la cruz griega centrada.
 */
export async function iconoDeLaFarmaciaPng(lado = 240) {
    if (typeof document === 'undefined') return null;
    try {
        const c = document.createElement('canvas');
        c.width = lado; c.height = lado;
        const x = c.getContext('2d');
        const r = lado * 0.38;
        const grosor = lado * 0.14;

        /* El arco: casi una vuelta entera, con la abertura arriba a la derecha,
         * que es donde la tiene el logo. Los ángulos van en el sentido del
         * reloj desde la abertura. */
        x.strokeStyle = MARCA.verde;
        x.lineWidth = grosor;
        x.lineCap = 'butt';
        x.beginPath();
        x.arc(lado / 2, lado / 2, r, -Math.PI * 0.22, Math.PI * 1.16);
        x.stroke();

        // La cruz griega, centrada: dos barras del mismo largo. Ocupa la mitad
        // del ícono — más chica se lee como un punto y se pierde el símbolo.
        const brazo = lado * 0.50;       // largo total de cada barra
        const ancho = lado * 0.185;      // grosor de cada barra
        x.fillStyle = MARCA.magenta;
        x.fillRect(lado / 2 - brazo / 2, lado / 2 - ancho / 2, brazo, ancho);
        x.fillRect(lado / 2 - ancho / 2, lado / 2 - brazo / 2, ancho, brazo);
        return c.toDataURL('image/png');
    } catch {
        return null;
    }
}

/**
 * El avatar cuando todavía no hay foto: las iniciales sobre el magenta.
 *
 * Un hueco gris en un carné se lee como un carné a medio hacer. Las iniciales
 * sobre el color de la empresa se leen como una decisión — y el día que llegue
 * la foto, ocupa exactamente el mismo lugar.
 */
export async function avatarComoPng(nombre, lado = 260, alto = null) {
    if (typeof document === 'undefined') return null;
    try {
        const H = alto || lado;
        const c = document.createElement('canvas');
        c.width = lado; c.height = H;
        const x = c.getContext('2d');
        x.fillStyle = MARCA.magenta;
        x.fillRect(0, 0, lado, H);
        // El arco del logo, insinuado: la misma curva verde, abajo a la
        // derecha, para que el hueco pertenezca a la marca y no sea un cuadro
        // de color cualquiera.
        x.fillStyle = MARCA.verde;
        x.beginPath();
        x.arc(lado * 0.92, H * 1.02, lado * 0.42, 0, Math.PI * 2);
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
            x.fillText(iniciales, lado / 2, H * 0.52);
        }
        return c.toDataURL('image/png');
    } catch {
        return null;
    }
}

/**
 * El FONDO de marca del retrato: el morado, el arco verde y el ícono al agua.
 *
 * Se dibuja aparte de la persona porque quien lo mira tiene que reconocer la
 * empresa sin leer nada — y porque el fondo de una foto de teléfono (una
 * pared, un estante, medio pasillo) es exactamente lo que hace que dos carnés
 * de la misma empresa no se parezcan entre sí.
 */
function fondoDeMarca(x, ancho, alto) {
    const g = x.createLinearGradient(0, 0, 0, alto);
    g.addColorStop(0, MARCA.magenta);
    g.addColorStop(1, '#7A167A');
    x.fillStyle = g;
    x.fillRect(0, 0, ancho, alto);

    // El arco del logo, asomando por abajo a la derecha — el mismo gesto que
    // el avatar de iniciales, para que con foto y sin foto se vean hermanos.
    x.save();
    x.globalAlpha = 0.92;
    x.fillStyle = MARCA.verde;
    x.beginPath();
    x.arc(ancho * 0.94, alto * 1.01, ancho * 0.46, 0, Math.PI * 2);
    x.fill();
    x.restore();

    // La cruz al agua, arriba a la izquierda. Muy tenue: es una marca de agua,
    // no un segundo logo compitiendo con la cara.
    x.save();
    x.globalAlpha = 0.13;
    x.fillStyle = '#FFFFFF';
    const cx = ancho * 0.24, cy = alto * 0.20;
    const brazo = ancho * 0.30, grosor = ancho * 0.11;
    x.fillRect(cx - brazo / 2, cy - grosor / 2, brazo, grosor);
    x.fillRect(cx - grosor / 2, cy - brazo / 2, grosor, brazo);
    x.restore();
}

/**
 * El retrato con la persona RECORTADA sobre el fondo de la empresa.
 *
 * ── Por qué se le quita el fondo a la foto ──────────────────────────────────
 *
 * Pedido del usuario (2026-08-29): «un efecto o algo que quede detrás de la
 * foto (la haces transparente sólo sacando a la persona) con los colores o
 * ícono de la empresa».
 *
 * Y resuelve un problema real, no sólo estético: la foto de un carné se toma
 * donde se puede —contra una pared, un estante, medio pasillo—, así que dos
 * carnés de la misma empresa salen con dos fondos distintos y ninguno dice
 * nada. Con el fondo de marca, todos los carnés se parecen entre sí y el
 * único que cambia es quien está adelante.
 *
 * ── Si no se puede, se sigue ────────────────────────────────────────────────
 *
 * El recorte lo hace un modelo que se descarga la primera vez (`@imgly`, el
 * mismo que ya usa el editor de fotos del portal). Sin red, o si el modelo no
 * reconoce a nadie, se devuelve `null` y el carné sale con la foto tal cual:
 * una mejora que se cae no puede dejar a alguien sin carné.
 */
export async function retratoDeMarcaPng(src, ancho = 260, alto = 320) {
    if (!src || typeof document === 'undefined') return null;
    try {
        const { removeBackground } = await import('@imgly/background-removal');
        const recortada = await removeBackground(src, {
            // El modelo chico: es el que ya usa `PhotoEditorModal` y el que hace
            // que esto tarde segundos y no minutos en una computadora de sala.
            model: 'small',
            output: { format: 'image/png', quality: 1 },
        });
        const url = URL.createObjectURL(recortada);
        // La URL se suelta al final y no en un `finally`: lo que pueda lanzar
        // entre medio lo atrapa el `catch` de abajo —que además AVISA—, y un
        // `finally` sin `catch` propio se lee como que el fallo se traga.
        {
            const img = await new Promise((res, rej) => {
                const el = new Image();
                el.onload = () => res(el); el.onerror = rej; el.src = url;
            });
            /* ── Encuadrar a la PERSONA, no a la foto ────────────────────────
             *
             * Después de quitar el fondo, casi toda la imagen es transparente:
             * cuánto ocupa la persona depende de a qué distancia se tomó la
             * foto. Si se dibujara la imagen entera, uno saldría enorme y otro
             * diminuto en el mismo carné — y eso no lo decide nadie, lo decide
             * quién sostenía el teléfono.
             *
             * Se busca la caja de lo que NO es transparente y se encuadra eso.
             * Así todos los carnés salen con la persona del mismo tamaño. */
            const medida = document.createElement('canvas');
            medida.width = img.naturalWidth; medida.height = img.naturalHeight;
            const mx = medida.getContext('2d', { willReadFrequently: true });
            mx.drawImage(img, 0, 0);
            const d = mx.getImageData(0, 0, medida.width, medida.height).data;
            let x0 = medida.width, y0 = medida.height, x1 = 0, y1 = 0;
            for (let py = 0; py < medida.height; py++) {
                for (let px = 0; px < medida.width; px++) {
                    // 40 y no 0: el recorte deja un halo casi transparente, y
                    // medirlo agrandaría la caja con aire que no es nadie.
                    if (d[(py * medida.width + px) * 4 + 3] > 40) {
                        if (px < x0) x0 = px; if (px > x1) x1 = px;
                        if (py < y0) y0 = py; if (py > y1) y1 = py;
                    }
                }
            }
            const hay = x1 > x0 && y1 > y0;
            const bw = hay ? x1 - x0 : img.naturalWidth;
            const bh = hay ? y1 - y0 : img.naturalHeight;
            if (!hay) { x0 = 0; y0 = 0; }

            const c = document.createElement('canvas');
            c.width = ancho; c.height = alto;
            const x = c.getContext('2d');
            fondoDeMarca(x, ancho, alto);

            /* Un poco de aire arriba y a los lados, y apoyada ABAJO: sin fondo,
             * centrar verticalmente deja una cabeza flotando. Apoyada al pie se
             * lee como un retrato. */
            const AIRE = 0.90;
            const escala = Math.min((ancho * AIRE) / bw, (alto * AIRE) / bh);
            const w = bw * escala, h = bh * escala;
            x.drawImage(img, x0, y0, bw, bh, (ancho - w) / 2, alto - h, w, h);
            const salida = c.toDataURL('image/jpeg', 0.92);
            URL.revokeObjectURL(url);
            return salida;
        }
    } catch (e) {
        console.warn('retratoDeMarcaPng:', e?.message || e);
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
export async function fotoCuadradaComoPng(src, lado = 220, alto = null) {
    if (!src || typeof document === 'undefined') return null;
    try {
        const img = await new Promise((res, rej) => {
            const el = new Image();
            el.onload = () => res(el);
            el.onerror = rej;
            el.crossOrigin = 'anonymous';
            el.src = src;
        });
        const H = alto || lado;
        const c = document.createElement('canvas');
        c.width = lado; c.height = H;
        const x = c.getContext('2d');
        /* Se recorta la mayor porción que quepa con la proporción del hueco, y
         * desde el CENTRO. Con la tarjeta de pie el hueco ya no es cuadrado
         * (26 × 32 mm), así que un recorte cuadrado dejaría franjas arriba y
         * abajo — que es exactamente lo que se venía a evitar. */
        const escala = Math.min(img.naturalWidth / lado, img.naturalHeight / H);
        const rw = lado * escala, rh = H * escala;
        x.drawImage(img,
            (img.naturalWidth - rw) / 2, (img.naturalHeight - rh) / 2, rw, rh,
            0, 0, lado, H);
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
    return d.toLocaleDateString('es-SV', { day: 'numeric', month: 'long', year: 'numeric' });
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
    nombre, cargo = '', sala = '', fechaDeInicio = null,
    barrasPng = null, retratoPng = null, iconoPng = null,
}) {
    /* La tarjeta se dibuja en coordenadas absolutas sobre la hoja: es la única
     * forma de que mida exactamente lo que tiene que medir. Centrada al ancho de
     * una carta (612 pt) y en la MITAD DE ARRIBA — la de abajo lleva la
     * inducción al portal, que es la otra cosa que hace falta el primer día. */
    const x0 = Math.round((612 - CARNE.ancho) / 2);
    const y0 = 112;
    const P = 10;                     // el margen interno de la tarjeta
    const canto = 6.2;                // el canto verde: 2.2 mm
    const fotoW = 74, fotoH = 91;     // 26 × 32 mm

    const abs = (x, y) => ({ absolutePosition: { x: x0 + x, y: y0 + y } });
    /* ── Las marcas de corte ────────────────────────────────────────────────
     * Pedido del usuario. No es decoración de imprenta: sin ellas hay que
     * adivinar dónde termina la tarjeta —el borde impreso es del mismo color
     * que el papel de alrededor— y una tarjeta recortada torcida no entra en la
     * funda. Van SEPARADAS de la tarjeta y hacia afuera, para que la tijera
     * pase por donde se cruzan y ninguna quede dentro del carné terminado. */
    const SEP = 5, LARGO = 14;
    const A = CARNE.ancho, B = CARNE.alto;
    const marcas = [];
    for (const [ex, ey] of [[0, 0], [A, 0], [0, B], [A, B]]) {
        const hx = ex === 0 ? -SEP - LARGO : SEP;
        const vy = ey === 0 ? -SEP - LARGO : SEP;
        marcas.push({ type: 'line', x1: ex + hx, y1: ey, x2: ex + hx + LARGO, y2: ey });
        marcas.push({ type: 'line', x1: ex, y1: ey + vy, x2: ex, y2: ey + vy + LARGO });
    }

    return [
        { text: '', pageBreak: 'before' },

        {
            ...abs(0, -58),
            columns: [{
                width: CARNE.ancho + 120,
                stack: [
                    { text: 'Tu carné', style: 'seccion', margin: [0, 0, 0, 2] },
                    { text: 'Recórtalo por las marcas y guárdalo en una funda. Con él marcas tu '
                          + 'entrada y tu salida, y entras al portal.', style: 'nota' },
                ],
            }],
        },

        // ── El cartón ──────────────────────────────────────────────────────
        {
            ...abs(0, 0),
            canvas: [
                { type: 'rect', x: 0, y: 0, w: CARNE.ancho, h: CARNE.alto, r: 9,
                  color: '#FFFFFF', lineWidth: 0.6, lineColor: '#DDDDDD' },
                // El canto verde. El rectángulo de la derecha le tapa el radio
                // de ese lado: pdfmake no sabe redondear sólo dos esquinas.
                { type: 'rect', x: 0, y: 0, w: canto, h: CARNE.alto, r: 9, color: MARCA.verde },
                { type: 'rect', x: canto - 9, y: 0, w: 9, h: CARNE.alto, color: MARCA.verde },
                ...marcas.map(m => ({ ...m, lineWidth: 0.6, lineColor: '#9A9A9A' })),
            ],
        },

        // ── El ícono de la farmacia y el nombre de la empresa ──────────────
        ...(iconoPng ? [{ image: iconoPng, width: 20, height: 20, ...abs(canto + P, P + 1) }] : []),
        {
            ...abs(canto + P + (iconoPng ? 26 : 0), P + 1),
            columns: [{
                width: CARNE.ancho - canto - P * 2 - (iconoPng ? 26 : 0),
                stack: [
                    { text: 'Farmacias', style: 'carneEmpresa' },
                    { text: 'La Popular y La Salud', style: 'carneEmpresa' },
                ],
            }],
        },

        // ── El retrato ─────────────────────────────────────────────────────
        ...(retratoPng ? [{
            image: retratoPng, width: fotoW, height: fotoH,
            ...abs(canto + (CARNE.ancho - canto - fotoW) / 2, 40),
        }] : []),
        {
            ...abs(canto + (CARNE.ancho - canto - fotoW) / 2, 40),
            canvas: [{ type: 'rect', x: 0, y: 0, w: fotoW, h: fotoH, r: 4,
                       lineWidth: 0.8, lineColor: '#DDDDDD' }],
        },

        /* ── Quién es ───────────────────────────────────────────────────────
         * Los cuatro renglones en UN bloque apilado y no en cuatro posiciones
         * fijas: con posiciones fijas hay que suponer cuántas líneas ocupa el
         * nombre, y «Edwin Núñez» —que entra en una— dejaba un hueco delante
         * del cargo mientras que un nombre de cuatro palabras se le encimaba. */
        {
            ...abs(canto, 140),
            columns: [{
                width: CARNE.ancho - canto,
                alignment: 'center',
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
            image: barrasPng, width: CARNE.ancho - canto - P * 2, height: 20,
            ...abs(canto + P, CARNE.alto - 30),
        }] : []),

        /* ── Lo que vale este pedazo de papel, DICHO ─────────────────────────
         * El código no caduca y es el mismo del plástico, así que quien le tome
         * una foto puede marcar y entrar por esta persona. Un carné que no se
         * explica se deja sobre un mostrador. */
        {
            ...abs(-30, CARNE.alto + 20),
            columns: [{
                width: CARNE.ancho + 60,
                stack: [
                    { text: 'Es el mismo código que va a llevar tu carné de plástico y no caduca. '
                          + 'Cuídalo como cuidarías el carné: cualquiera que le tome una foto puede '
                          + 'marcar por ti y entrar al portal como tú. Si lo pierdes, avísale a '
                          + 'Talento Humano y se cambia el código.', style: 'nota', alignment: 'center' },
                ],
            }],
        },

        /* ── La mitad de abajo: la inducción al portal ───────────────────────
         *
         * Pedido del usuario: dividir la segunda hoja y usar la otra mitad para
         * «una pequeña inducción del portal». Va acá y no en la primera página
         * porque la primera se guarda o se destruye —tiene la contraseña— y esto
         * es lo que conviene que quede a mano.
         *
         * En FLUJO y no en posición absoluta: son párrafos que crecen, y el
         * margen de arriba es lo que los deja debajo de la tarjeta. */
        {
            margin: [0, 372, 0, 0],
            canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0,
                       lineWidth: 0.5, lineColor: '#E5E7EB' }],
        },
        { text: 'El portal, en cinco minutos', style: 'seccion', margin: [0, 14, 0, 2] },
        {
            text: `Entra desde el teléfono o la computadora en ${DIRECCION_DEL_PORTAL}. `
                + 'Es la misma dirección en los dos, y en el teléfono se puede dejar '
                + 'instalada como una aplicación más.',
            style: 'texto', margin: [0, 0, 0, 8],
        },
        {
            columnGap: 18,
            columns: [
                { width: '*', stack: INDUCCION.slice(0, 3).map(bloqueDeInduccion) },
                { width: '*', stack: INDUCCION.slice(3).map(bloqueDeInduccion) },
            ],
        },
        {
            text: 'Si algo no te aparece, es porque tu cargo todavía no lo tiene habilitado — '
                + 'pídeselo a Talento Humano.',
            style: 'nota', margin: [0, 8, 0, 0],
        },
    ];
}

/* ── Qué encuentra en el portal quien entra por primera vez ─────────────────
 *
 * Cinco cosas, y son las que un dependiente usa de verdad: no es un índice del
 * menú. Lo que ve cada quien depende de su cargo, y por eso la nota del final
 * dice que faltar algo no es una falla.
 */
export const INDUCCION = [
    { titulo: 'Marcar entrada y salida',
      texto: 'Con tu carné, en el kiosco de tu sala. Es lo que prueba tus horas.' },
    { titulo: 'Mis avisos',
      texto: 'Lo que la empresa comunica a tu sala y a ti. Revísalo al entrar.' },
    { titulo: 'Mi perfil',
      texto: 'Tus datos y tu foto. Si cambias de teléfono o de dirección, avisa para actualizarlo.' },
    { titulo: 'Mis documentos',
      texto: 'Los papeles de tu expediente, para consultarlos cuando los necesites.' },
    { titulo: 'Solicitudes personales',
      texto: 'Vacaciones y permisos se piden desde aquí, y desde aquí ves en qué van.' },
];

const bloqueDeInduccion = (b) => ({
    text: [{ text: `${b.titulo}. `, bold: true }, { text: b.texto }],
    style: 'reglaBreve', margin: [0, 0, 0, 5],
});

/**
 * Arma el documento. Devuelve la definición de pdfmake, sin descargar nada.
 *
 * Separado de la descarga a propósito: así una prueba puede leer lo que dice el
 * documento sin abrir un navegador ni bajar una librería.
 */
export function definicionDelDocumento({
    nombre, cargo = '', sala = '', usuario, contrasenaTemporal,
    barrasPng = null, barrasCarnePng = null, retratoPng = null, iconoPng = null, previsional = [],
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
        barrasPng: barrasCarnePng || barrasPng, retratoPng, iconoPng }));

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
            /* Morado y no blanco: heredaba el color de cuando vivía sobre una
             * banda de color, y en la tarjeta blanca de la variante F quedaba
             * invisible — el nombre de la empresa sencillamente no salía. */
            carneEmpresa: { fontSize: 6.6, bold: true, color: MARCA.magenta, characterSpacing: .9, lineHeight: 1.15 },
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
        const [pdfMake, barrasPng, iconoPng] = await Promise.all([
            getPdfMake(),
            barrasComoPng(datos?.valorDelCarne),
            iconoDeLaFarmaciaPng(),
        ]);
        /* El retrato, en tres intentos y cada uno peor que el anterior:
         *   1. la persona recortada sobre el fondo de la empresa;
         *   2. la foto tal cual, encuadrada al hueco (si el recorte no se pudo);
         *   3. las iniciales sobre el morado (si no hay foto).
         * Nunca un hueco: un carné con un cuadro vacío se lee como uno a medio
         * hacer. 26 × 32 mm es el hueco del carné de pie. */
        const retratoPng = (datos?.foto && await retratoDeMarcaPng(datos.foto, 260, 320))
            || (datos?.foto && await fotoCuadradaComoPng(datos.foto, 260, 320))
            || await avatarComoPng(datos?.nombre, 260, 320);
        const def = definicionDelDocumento({
            ...datos, barrasPng, retratoPng, iconoPng,
            previsional: orientacionPrevisional(datos),
        });
        pdfMake.createPdf(def).download(nombreDelArchivo(datos?.nombre));
        return { ok: true };
    } catch (e) {
        return { ok: false, motivo: String(e?.message || e) };
    }
}
