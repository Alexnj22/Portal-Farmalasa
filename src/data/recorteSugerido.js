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

/* La imagen se achica ANTES de mandarla. Para decir DÓNDE está un documento no
 * hace falta resolución: 1024 px del lado mayor alcanzan de sobra y la pregunta
 * viaja en ~150 kB en vez de varios megas. La lectura de los DATOS sí necesita
 * la foto grande, y por eso son dos cosas distintas. */
const LADO_PARA_PREGUNTAR = 1024;

async function achicar(file) {
    const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('no se pudo leer'));
        fr.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = () => rej(new Error('no se pudo abrir'));
        el.src = dataUrl;
    });
    const escala = Math.min(1, LADO_PARA_PREGUNTAR / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * escala);
    c.height = Math.round(img.height * escala);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { base64: c.toDataURL('image/jpeg', 0.8), tipo: 'image/jpeg' };
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

/**
 * Dónde está el papel: primero mirando los píxeles, y sólo si no se puede
 * decidir, preguntándole al modelo.
 *
 * Ése es el orden y no el otro, y se midió el 2026-08-29 sobre fotos sintéticas
 * cuyas esquinas verdaderas se conocen. `detectarPapel` acierta con menos del
 * 1% de desvío en un papel que contrasta con el fondo, tarda 5 a 13 ms, no
 * gasta red y no necesita permiso; el modelo, sobre la misma foto, erraba entre
 * el 10% y el 15% en cada una de las cuatro. Ver el encabezado de
 * `utils/detectarPapel.js`.
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
 * @param {{secretoDeCaptura?: string}} [opciones]
 */
export async function buscarEsquinas(file, { secretoDeCaptura } = {}) {
    if (!file?.type?.startsWith('image/')) return null;

    try {
        const [{ detectarPapel }, imagen] = await Promise.all([
            import('../utils/detectarPapel'),
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
