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
import { girarEsquinas, ordenarEsquinas } from '@plataforma/perspectiva';
import { rectificarPapel, aArchivo, grisDe } from '@plataforma/componerDocumento';
import { afinarEsquinas } from '../utils/afinarEsquinas';
import { acabadoPorDefecto } from '@plataforma/tratamientoDeFoto';

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

/** Formato ID-1 (DUI, carnés): 85.6 × 54 mm. */
const PROPORCION_TARJETA = 85.6 / 54;
const TOLERANCIA_TARJETA = 0.06;

/** ¿Las cuatro esquinas (ya ordenadas, en fracciones) miden como una tarjeta? */
function tieneFormaDeTarjeta(esquinas, ancho, alto) {
    if (!Array.isArray(esquinas) || esquinas.length !== 4) return false;
    const p = esquinas.map(e => ({ x: e.x * ancho, y: e.y * alto }));
    const l = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const h = (l(p[0], p[1]) + l(p[3], p[2])) / 2;
    const v = (l(p[0], p[3]) + l(p[1], p[2])) / 2;
    const r = Math.max(h, v) / Math.max(1e-6, Math.min(h, v));
    return Math.abs(r - PROPORCION_TARJETA) / PROPORCION_TARJETA <= TOLERANCIA_TARJETA;
}

/**
 * Detecta, endereza, ajusta al papel y aplica el acabado.
 *
 * @param {File} file
 * @param {string} tipo  clave de `DOCS`
 * @returns {Promise<{ok:true, archivo:File, esquinas:Array, formato:object|null,
 *                   afinado:{lados:any, movimiento:any}|null}
 *                 | {ok:false, motivo:string}>}
 */
export async function prepararAutomatico(file, tipo = 'documento') {
    const doc = DOCS[tipo] || DOCS.documento;
    try {
        const { buscarEsquinas } = await import('./recorteSugerido');
        const propuesta = await buscarEsquinas(file, { tipo });
        const esquinas = propuesta?.esquinas;
        if (!Array.isArray(esquinas) || esquinas.length !== 4) {
            return { ok: false, motivo: 'no se reconoció el documento' };
        }

        const { imagen, soltar } = await cargar(file);

        /* Primero se ORDENAN, y no es un detalle de estilo.
         *
         * El prompt pide las cuatro esquinas «en el orden que sea» —a
         * propósito: exigirle un orden a un modelo es pedirle que además
         * acierte cuál llama «arriba a la izquierda» en una foto torcida—. Pero
         * `rectificarPapel` va con `yaOrdenadas: true`, o sea que toma el orden
         * recibido COMO la orientación elegida. Sin este paso, una detección
         * perfecta sale acostada o espejada según en qué orden vinieran los
         * puntos, y eso no se lee como «el modelo se equivocó» sino como «el
         * portal me dio vuelta el papel».
         *
         * El editor ya lo hacía (`EditorDeDocumento`, al enderezar); acá
         * faltaba, y este camino es el que corre SIEMPRE y sin que nadie mire.
         *
         * Después el giro que propuso la lectura se aplica rotando ese orden
         * —cuál es la de arriba a la izquierda—, no girando la foto: así no
         * cuesta ninguna interpolación. */
        const crudas = esquinas.map(p => ({ x: p.x, y: p.y }));
        let orden = ordenarEsquinas(crudas) || crudas;

        /* Las esquinas del modelo se AFINAN contra los bordes reales del papel
         * (2026-10-17): el modelo las da «a ojo» y el borde de papel contra
         * mesa está en la foto. Si no encuentra un borde claro, o el resultado
         * no es razonable, vuelven las del modelo sin cambios. Ver
         * `utils/afinarEsquinas.js`. */
        let afinado = null;
        try {
            const { gris, ancho, alto } = grisDe(imagen);
            /* La caja de una tarjeta llega con margen y sin inclinación (ver
             * `ubicarTarjeta`): se le da más banda y más ángulo para que llegue
             * al borde real. */
            afinado = afinarEsquinas(gris, ancho, alto, orden,
                propuesta.deLaTarjeta ? { banda: 0.06, grados: 10 } : undefined);
            /* En una tarjeta el borde más fuerte no siempre es el BORDE: la
             * franja del encabezado o el código de barras dan rectas más
             * marcadas que el contorno contra una mesa blanca, y medido el
             * 22-oct el afinado se les pegó y cortó «REPÚBLICA DE EL SALVADOR»
             * en 2 de 8 fotos. La forma lo delata —recortada así, la tarjeta ya
             * no mide 85.6 × 54—, y entonces vale la caja con margen, que nunca
             * corta. */
            if (propuesta.deLaTarjeta && !tieneFormaDeTarjeta(afinado.esquinas, ancho, alto)) {
                afinado = { ...afinado, esquinas: orden, ladosAfinados: 0, movimiento: 0, motivo: 'no quedaba con forma de tarjeta' };
            }
            orden = afinado.esquinas;
        } catch (e) { console.warn('afinarEsquinas:', e?.message || e); }
        const cuartos = ((Math.round((propuesta.giro || 0) / 90) % 4) + 4) % 4;
        for (let i = 0; i < cuartos; i++) orden = girarEsquinas(orden);

        let r = rectificarPapel(imagen, orden);

        /* ── El DUI se endereza SIEMPRE (2026-10-22) ──────────────────────────
         *
         * Hasta hoy el giro venía en la misma respuesta que las esquinas, y si
         * las esquinas las encontraban los píxeles el giro era 0: un DUI
         * fotografiado de costado se guardaba de costado. Y cuando lo daba el
         * modelo, se equivocaba 2 de cada 6. Ahora se pregunta aparte, sobre la
         * tarjeta ya recortada, eligiendo entre sus cuatro rotaciones. Si la
         * pregunta no contesta, queda como estaba: el botón de girar está a un
         * toque en «Ajustar».
         *
         * Y no sólo el DUI (2026-10-23): un carné de junta llegó de costado y
         * se guardó así, porque esto sólo corría con `tipo === 'dui'`. La
         * pregunta es sobre el TEXTO y vale para cualquier papel. Si el modelo
         * ya propuso un giro, se respeta ese. */
        if (r && !cuartos) {
            const { cuartosParaEnderezar } = await import('./recorteSugerido');
            const extra = await cuartosParaEnderezar(r.canvas);
            if (extra) {
                for (let i = 0; i < extra; i++) orden = girarEsquinas(orden);
                r = rectificarPapel(imagen, orden);
            }
        }
        const archivo = r ? await aArchivo(r.canvas, {
            doc, acabado: acabadoPorDefecto(doc), nombre: file.name,
        }) : null;
        // La URL del objeto se suelta acá y no en un `finally`: el único camino
        // que puede lanzar entre medio es `aArchivo`, y su error lo atrapa el
        // `catch` de abajo —que además AVISA—. Un `finally` sin `catch` propio
        // se lee como que el fallo se traga en silencio.
        soltar();

        if (!archivo) return { ok: false, motivo: 'no se pudo enderezar' };
        return { ok: true, archivo, esquinas: orden, formato: r.formato,
            afinado: afinado ? { lados: afinado.ladosAfinados, movimiento: afinado.movimiento } : null };
    } catch (e) {
        // Una ayuda que se cae no puede impedir adjuntar un papel: quien llama
        // abre el editor y el trabajo sigue.
        console.warn('prepararAutomatico:', e?.message || e);
        return { ok: false, motivo: 'no se pudo preparar' };
    }
}
