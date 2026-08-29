/**
 * El documento se prepara SOLO al elegir el archivo.
 *
 * ── Lo que se pidió ─────────────────────────────────────────────────────────
 *
 * Usuario, 2026-08-29: *«el portal debería ser capaz de, al subir la foto,
 * automáticamente detectar las esquinas, cuadrar y mejorar perspectiva, aplicar
 * filtro y reconocer lo que dice en busca de información relevante que se
 * guarde»*.
 *
 * Hasta hoy el portal sabía hacer las cuatro cosas y las ofrecía como un
 * TRABAJO: se abría el editor, se esperaba la propuesta, se confirmaba. Para
 * quien adjunta seis documentos de un expediente eso son seis diálogos que
 * decir que sí — y un paso que siempre se confirma sin mirar no está
 * protegiendo nada, sólo cansando.
 *
 * ── Y lo que eso cambia respecto de la regla anterior ───────────────────────
 *
 * Acá estaba escrito que «un recorte automático que nadie mira es peor que uno
 * manual». Sigue siendo cierto para un recorte que no se puede revisar; lo que
 * cambia es que ahora **se ve el resultado y se corrige a un toque**: el archivo
 * queda adjunto, se puede abrir, y «Ajustar» reabre el editor sobre la foto
 * ORIGINAL con las esquinas que se detectaron. La decisión de quien mira no se
 * eliminó, se movió después — que es donde no estorba.
 *
 * ── Cuándo NO se prepara solo ───────────────────────────────────────────────
 *
 * Si la lectura no encuentra las cuatro esquinas, no se inventa un recorte: se
 * abre el editor como siempre. Recortar por donde no va y adjuntarlo sin decir
 * nada es peor que pedir treinta segundos de trabajo.
 */
import { DOCS } from '../utils/fotoDocumento';
import { rectificarPapel, aArchivo } from '../utils/componerDocumento';
import { acabadoPorDefecto } from '../utils/tratamientoDeFoto';

/** La foto, cargada como elemento para poder medirla y redibujarla. */
function cargar(file) {
    return new Promise((res, rej) => {
        const url = URL.createObjectURL(file);
        const im = new Image();
        im.onload = () => { res({ imagen: im, soltar: () => URL.revokeObjectURL(url) }); };
        im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('no se pudo abrir')); };
        im.src = url;
    });
}

/**
 * Detecta, endereza, ajusta al papel y aplica el acabado.
 *
 * @param {File} file
 * @param {string} tipo  clave de `DOCS`
 * @returns {Promise<{ok:true, archivo:File, esquinas:Array, formato:object|null}
 *                 | {ok:false, motivo:string}>}
 */
export async function prepararAutomatico(file, tipo = 'documento') {
    const doc = DOCS[tipo] || DOCS.documento;
    try {
        const { sugerirRecorte } = await import('./recorteSugerido');
        const propuesta = await sugerirRecorte(file);
        const esquinas = propuesta?.esquinas;
        if (!Array.isArray(esquinas) || esquinas.length !== 4) {
            return { ok: false, motivo: 'no se reconoció el documento' };
        }

        const { imagen, soltar } = await cargar(file);

        /* El giro que propuso la lectura se aplica rotando el ORDEN de las
         * esquinas —cuál es la de arriba a la izquierda—, no girando la foto:
         * así no cuesta ninguna interpolación. */
        let orden = esquinas.map(p => ({ x: p.x, y: p.y }));
        const cuartos = ((Math.round((propuesta.giro || 0) / 90) % 4) + 4) % 4;
        for (let i = 0; i < cuartos; i++) orden = [orden[3], orden[0], orden[1], orden[2]];

        const r = rectificarPapel(imagen, orden);
        const archivo = r ? await aArchivo(r.canvas, {
            doc, acabado: acabadoPorDefecto(doc), nombre: file.name,
        }) : null;
        // La URL del objeto se suelta acá y no en un `finally`: el único camino
        // que puede lanzar entre medio es `aArchivo`, y su error lo atrapa el
        // `catch` de abajo —que además AVISA—. Un `finally` sin `catch` propio
        // se lee como que el fallo se traga en silencio.
        soltar();

        if (!archivo) return { ok: false, motivo: 'no se pudo enderezar' };
        return { ok: true, archivo, esquinas: orden, formato: r.formato };
    } catch (e) {
        // Una ayuda que se cae no puede impedir adjuntar un papel: quien llama
        // abre el editor y el trabajo sigue.
        console.warn('prepararAutomatico:', e?.message || e);
        return { ok: false, motivo: 'no se pudo preparar' };
    }
}
