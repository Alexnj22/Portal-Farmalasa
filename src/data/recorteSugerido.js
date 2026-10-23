/**
 * Dónde está el documento dentro de la foto.
 *
 * ── Por qué se pregunta ANTES de subir ─────────────────────────────────────
 *
 * El editor de recorte se abre en cuanto alguien elige una imagen, y la lectura
 * completa del DUI corre después, sobre el archivo ya guardado. Para que el
 * editor pueda ABRIR con el recorte puesto hay que preguntar sobre el archivo
 * que está en la computadora — de ahí que esto mande la imagen en el cuerpo y no
 * una ruta del bucket.
 *
 * ── Es una SUGERENCIA, y eso no es una formalidad ──────────────────────────
 *
 * El recuadro entra como punto de partida del editor y la persona lo confirma o
 * lo corrige. `EditorDeDocumento` tiene escrito desde que se evaluó la primera
 * vez por qué el recorte automático a ciegas es peor que el manual: recorta
 * medio documento y nadie lo mira antes de guardar. Que lo proponga un modelo no
 * cambia eso — lo que cambia es que ahora el punto de partida suele estar bien.
 *
 * ── Nunca hace fallar nada ─────────────────────────────────────────────────
 *
 * Devuelve `null` ante cualquier problema: sin red, sin permiso, con una foto
 * que no tiene ningún documento reconocible. El editor abre igual, con su
 * recuadro de siempre. Una ayuda que se cae no puede impedir adjuntar un papel.
 */
import { supabase } from '../supabaseClient';
import { lienzoReducido, reducirAJpeg } from '@plataforma/imagenes';

/* La imagen se achica ANTES de mandarla. Para decir DÓNDE está un documento no
 * hace falta resolución: 1024 px del lado mayor alcanzan de sobra y la pregunta
 * viaja en ~150 kB en vez de varios megas. La lectura de los DATOS sí necesita
 * la foto grande, y por eso son dos cosas distintas. */
const LADO_PARA_PREGUNTAR = 1024;

async function achicar(file) {
    const base64 = await reducirAJpeg(file, { ladoMaximo: LADO_PARA_PREGUNTAR, calidad: 0.8, mensaje: 'no se pudo abrir' });
    return { base64, tipo: 'image/jpeg' };
}

/**
 * @param {File} file
 * @param {{secretoDeCaptura?: string}} [opciones]  el secreto del QR, cuando la
 *   pregunta sale del TELÉFONO: esa página se abre sin sesión —ése es el punto
 *   del QR— así que no tiene JWT que presentar, y sin esto sería el único lugar
 *   del portal donde las esquinas no se detectan solas.
 * @returns {Promise<{recuadro: {x,y,w,h}|null, giro: number, esquinas: {x,y}[]|null}|null>}
 */
export async function sugerirRecorte(file, { secretoDeCaptura } = {}) {
    if (!file?.type?.startsWith('image/')) return null;
    try {
        const chica = await achicar(file);
        const { data, error } = await supabase.functions.invoke('leer-dui', {
            body: {
                soloRecuadro: true, imagenBase64: chica.base64, tipo: chica.tipo,
                ...(secretoDeCaptura ? { secretoDeCaptura } : {}),
            },
        });
        if (error || !data?.ok || !data.recuadro) return null;
        return { recuadro: data.recuadro, giro: data.giro || 0, esquinas: data.esquinas || null };
    } catch {
        return null;
    }
}

/** Cuánto se agranda la caja del modelo hacia cada lado, en fracción de su tamaño. */
const MARGEN_DE_LA_CAJA = 0.04;

/**
 * Dónde está una TARJETA (el DUI) dentro de la foto, preguntado al modelo.
 *
 * No pasa por `detectarPapel`, y no por descuido: ese detector busca «la mancha
 * clara más grande», y un DUI se fotografía sobre una hoja o un escritorio
 * BLANCO — la mancha clara es el fondo. Medido el 2026-10-22: las dos caras de
 * un ingreso quedaron con un tercio de pared. Se probaron dos arreglos por
 * píxeles (umbral en gris y distancia de color al fondo) y ninguno separó la
 * tarjeta; ver el encabezado de `PROMPT_TARJETA` en `leer-dui`.
 *
 * @param {File} file
 * @param {{secretoDeCaptura?: string}} [opciones]
 * @returns {Promise<{recuadro: {x: number, y: number, w: number, h: number},
 *                    giro: number, esquinas: {x: number, y: number}[],
 *                    deLaTarjeta: boolean}|null>}
 */
export async function ubicarTarjeta(file, { secretoDeCaptura } = {}) {
    if (!file?.type?.startsWith('image/')) return null;
    try {
        const chica = await achicar(file);
        const { data, error } = await supabase.functions.invoke('leer-dui', {
            body: {
                soloTarjeta: true, imagenBase64: chica.base64, tipo: chica.tipo,
                ...(secretoDeCaptura ? { secretoDeCaptura } : {}),
            },
        });
        if (error || !data?.ok || !data.recuadro) return null;
        /* Se usa la CAJA, no las esquinas que devolvió el modelo. Medido el
         * 2026-10-22 sobre el DUI de un ingreso girado de cuatro formas: la caja
         * cae a pocos puntos de la tarjeta, y las esquinas le inventan una
         * inclinación —15° en una tarjeta que estaba derecha— que deforma el
         * recorte. La caja va con margen para no cortar NUNCA la tarjeta (un
         * encabezado cortado es un dato perdido; un borde de mesa, no), y
         * `afinarEsquinas` la ajusta después al borde real, inclinación incluida. */
        const { x, y, w, h } = data.recuadro;
        const mx = w * MARGEN_DE_LA_CAJA, my = h * MARGEN_DE_LA_CAJA;
        const x0 = Math.max(0, x - mx), y0 = Math.max(0, y - my);
        const x1 = Math.min(1, x + w + mx), y1 = Math.min(1, y + h + my);
        return {
            recuadro: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
            esquinas: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
            // El giro se decide DESPUÉS, sobre la tarjeta ya recortada: ver `cuartosParaEnderezar`.
            giro: 0,
            deLaTarjeta: true,
        };
    } catch {
        return null;
    }
}

/** Lado de cada una de las cuatro rotaciones: para decidir si el texto está
 *  de pie alcanza de sobra, y son cuatro imágenes en una sola pregunta. */
const LADO_PARA_ENDEREZAR = 512;

/**
 * Cuántos cuartos de vuelta, en el sentido del reloj, hay que girar el
 * documento ya recortado para que se lea derecho. `null` si no se pudo saber.
 *
 * Se le muestran al modelo las CUATRO rotaciones y elige la que se lee derecha.
 * Preguntarle «cuántos grados» falló 2 de 6 sobre un DUI real (el de cabeza lo
 * dio por 270); elegir entre cuatro es reconocer texto, que es lo que mejor
 * hace. Va sobre el recorte y no sobre la foto: así lo único distinto entre las
 * cuatro es el giro, y no hay mesa que distraiga.
 *
 * @param {HTMLCanvasElement} lienzo  el documento ya rectificado
 * @param {{secretoDeCaptura?: string}} [opciones]
 */
export async function cuartosParaEnderezar(lienzo, { secretoDeCaptura } = {}) {
    try {
        const imagenes = [0, 90, 180, 270].map(g =>
            lienzoReducido(lienzo, { ladoMaximo: LADO_PARA_ENDEREZAR, girar: g })
                .toDataURL('image/jpeg', 0.8).split(',')[1]);
        const { data, error } = await supabase.functions.invoke('leer-dui', {
            body: { cualDerecha: true, imagenes, ...(secretoDeCaptura ? { secretoDeCaptura } : {}) },
        });
        if (error || !data?.ok || !Number.isInteger(data.indice)) return null;
        return data.indice;
    } catch {
        return null;
    }
}

/**
 * Dónde está el papel: primero mirando los píxeles, y sólo si no se puede
 * decidir, preguntándole al modelo.
 *
 * Ése es el orden y no el otro, y se midió el 2026-08-29 sobre fotos sintéticas
 * cuyas esquinas verdaderas se conocen. `detectarPapel` acierta con menos del
 * 1% de desvío en un papel que contrasta con el fondo, tarda 5 a 13 ms, no
 * gasta red y no necesita permiso; el modelo, sobre la misma foto, erraba entre
 * el 10% y el 15% en cada una de las cuatro. Ver el encabezado de
 * `plataforma/detectarPapel.js`.
 *
 * El modelo no sobra: contesta justo lo que el umbral no puede —un papel que no
 * contrasta con la mesa— y además dice el GIRO, que es una pregunta sobre el
 * TEXTO y no sobre la geometría.
 *
 * Las dos rutas devuelven lo mismo para que quien llama no tenga que saber cuál
 * contestó. Y si ninguna contesta, `null`: el editor abre con su recuadro de
 * siempre y el trabajo sigue.
 *
 * @param {File} file
 * @param {{secretoDeCaptura?: string, tipo?: string}} [opciones]  `tipo: 'dui'`
 *   pregunta primero por la tarjeta (`ubicarTarjeta`)
 * @returns {Promise<{recuadro: {x: number, y: number, w: number, h: number}|null,
 *                    giro: number, esquinas: {x: number, y: number}[]|null,
 *                    deLaTarjeta?: boolean, deLosPixeles?: boolean}|null>}
 */
export async function buscarEsquinas(file, { secretoDeCaptura, tipo } = {}) {
    if (!file?.type?.startsWith('image/')) return null;

    // Una tarjeta va directo al modelo, con su pregunta propia. Si no contesta,
    // queda el camino de siempre: peor recorte, pero recorte.
    if (tipo === 'dui') {
        const tarjeta = await ubicarTarjeta(file, { secretoDeCaptura });
        if (tarjeta) return tarjeta;
    }

    try {
        const [{ detectarPapel }, imagen] = await Promise.all([
            import('@plataforma/detectarPapel'),
            new Promise((res, rej) => {
                const url = URL.createObjectURL(file);
                const el = new Image();
                el.onload = () => { URL.revokeObjectURL(url); res(el); };
                el.onerror = () => { URL.revokeObjectURL(url); rej(new Error('no se pudo abrir')); };
                el.src = url;
            }),
        ]);
        const esquinas = detectarPapel(imagen);
        if (esquinas) {
            const xs = esquinas.map(p => p.x), ys = esquinas.map(p => p.y);
            const x = Math.min(...xs), y = Math.min(...ys);
            return {
                esquinas,
                recuadro: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
                // El giro mira el TEXTO y esto miró la forma: sin leer nada, lo
                // honesto es no proponer ninguno. El botón de girar está a un
                // toque en el editor.
                giro: 0,
                deLosPixeles: true,
            };
        }
    } catch (e) {
        console.warn('detectarPapel:', e?.message || e);
    }

    return sugerirRecorte(file, { secretoDeCaptura });
}
