/**
 * Preparar la foto de un documento: marcarlo, enderezarlo y elegir su acabado.
 *
 * ══ POR QUÉ ESTO SE REESCRIBIÓ (2026-08-29) ═════════════════════════════════
 *
 * El usuario lo resumió así: *«no hay color en las fotos, se siente torpe el
 * editor, en teléfono igual, se ve súper pequeño, no hay posibilidad de hacer
 * zoom con los dedos, o rotar con los dedos… haz una reestructuración»*.
 *
 * Eran cinco síntomas de tres decisiones equivocadas, y por eso no alcanzaba
 * con retocar:
 *
 *  1. **El recorte era una CAJA de proporción fija** y lo que se movía era la
 *     foto debajo. Como un papel fotografiado está en perspectiva, ninguna de
 *     las formas de la lista («hoja de pie», «tarjeta», «tira») calzaba nunca:
 *     siempre sobraba escritorio o faltaba una esquina. De ahí venía la
 *     torpeza — no era lentitud, era que la herramienta no podía describir lo
 *     que había que recortar.
 *  2. **El acabado por defecto era «Aclarada»**, que lleva todo a gris. O sea
 *     que el portal decidía tirar el color de cada foto sin que nadie lo
 *     eligiera. Eso es «no hay color en las fotos».
 *  3. **No había gestos.** Un teléfono sin pellizco no se siente lento, se
 *     siente roto: es el primer gesto que todo el mundo prueba.
 *
 * ══ LO QUE ES AHORA ═════════════════════════════════════════════════════════
 *
 * Dos pasos, como cualquier escáner de teléfono:
 *
 *   **1 · Encuadrar** — la foto ocupa la pantalla y se marcan las CUATRO
 *   esquinas del papel. Se arrastran con el dedo (con lupa, porque el dedo tapa
 *   justo la esquina), se pellizca para acercar y se gira con dos dedos para
 *   trabajar cómodo. La perspectiva se corrige con esas esquinas, así que un
 *   papel en trapecio sale rectangular de verdad.
 *
 *   **2 · Acabado** — el documento ya enderezado, lo más grande que entre, y
 *   debajo una barra con los tres acabados y el giro. El acabado elegido se
 *   dibuja de verdad sobre esa vista al instante, así que se ve a tamaño
 *   completo lo que se va a guardar. Arranca en «Nítida», que mejora sin
 *   descartar color.
 *
 * La proporción del resultado sale del papel medido, así que la lista de formas
 * desapareció: era el remiendo de no poder marcar las esquinas.
 *
 * ══ LO QUE SE CONSERVÓ, Y POR QUÉ ═══════════════════════════════════════════
 *
 * Todo lo que estaba MEDIDO: los dos tratamientos de píxeles (`realzar`,
 * `aclarar` — ver `utils/tratamientoDeFoto.js`), la revisión que avisa antes de
 * guardar (`avisosDeFoto`), el piso por debajo del cual no se guarda
 * (`sePuedeGuardar`) y los tamaños de salida por tipo de papel. Nada de eso era
 * el problema.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Contrast, ImageIcon, Loader2, Maximize2, RotateCw, Sparkles, Wand2, X } from 'lucide-react';
import Button from './Button';
import LiquidModal from './LiquidModal';
import Notice from './Notice';
import LienzoDeEncuadre from './LienzoDeEncuadre';
import { DOCS, avisosDeFoto, escalaDeSalida, medirDocumento, sePuedeGuardar } from '../../utils/fotoDocumento';
import { ESQUINAS_ENTERAS, girarEsquinas, ordenarEsquinas } from '../../utils/perspectiva';
import { aEscala, aArchivo, rectificarPapel } from '../../utils/componerDocumento';
import { acabadoPorDefecto, acabadosDe, aplicarAcabado } from '../../utils/tratamientoDeFoto';
import useCoarsePointer from '../../hooks/useCoarsePointer';
import SegmentedControl from './SegmentedControl';

// El lado con el que se revisa la foto antes de guardarla. 800 alcanza para
// medir papel, tinta y color, y corre sin trabar un teléfono.
const LADO_ANALISIS = 800;
/* El ícono de cada acabado.
 *
 * Vive acá y no en `tratamientoDeFoto.js` a propósito: ese archivo es de
 * píxeles y no debe arrastrar `lucide-react` a todo el que lo importe. */
const ICONO_DE_ACABADO = { original: ImageIcon, nitida: Wand2, aclarada: Contrast };

/** Las cuatro esquinas por defecto: un margen adentro, no la foto entera. */
const ESQUINAS_CON_MARGEN = [
    { x: 0.08, y: 0.08 }, { x: 0.92, y: 0.08 },
    { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.92 },
];

/** El recuadro que devuelve la lectura automática, convertido a cuatro esquinas. */
function esquinasDelRecuadro(r) {
    if (!r || !(r.w > 0) || !(r.h > 0)) return null;
    const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
    const x1 = Math.min(1, r.x + r.w), y1 = Math.min(1, r.y + r.h);
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/**
 * @param {File}   file
 * @param {string} tipo         clave de `DOCS`
 * @param {object} [recuadro]   lo que propuso la lectura, en fracciones
 * @param {number} [giroSugerido]  cuartos de vuelta que propuso la lectura
 * @param {Array}  [esquinas]   las cuatro esquinas que propuso la lectura
 * @param {boolean}[yaRecortado] la imagen YA es el documento: se abre para
 *   enderezarla o mejorarla, no para encuadrarla de nuevo.
 * @param {boolean}[analizando] la lectura todavía viaja
 */
export default function EditorDeDocumento({
    file, tipo = 'receta', recuadro = null, giroSugerido = 0, esquinas = null,
    yaRecortado = false, analizando = false, onConfirm, onCancel,
}) {
    const doc = DOCS[tipo] || DOCS.receta;
    const conElDedo = useCoarsePointer();

    const [paso, setPaso] = useState('encuadre');      // encuadre · acabado
    const [imagen, setImagen] = useState(null);
    const [puntos, setPuntos] = useState(yaRecortado ? ESQUINAS_ENTERAS : ESQUINAS_CON_MARGEN);
    const [acabado, setAcabado] = useState(acabadoPorDefecto(doc));
    const [enderezada, setEnderezada] = useState(null);   // el lienzo rectificado
    const [formato, setFormato] = useState(null);         // a qué papel se pareció
    /* ── El giro es un CONTADOR, no una permutación de las esquinas ─────────
     *
     * Antes «Girar» rotaba el orden de los cuatro puntos, y el enderezado
     * confiaba en ese orden (`yaOrdenadas`). El problema es que el orden también
     * lo puede cambiar la MANO: las manijas son cuatro blancos de 44 pt y
     * arrastrar una por encima de otra las intercambia — y ahí el resultado sale
     * acostado sin que nadie haya pedido girarlo. Fue lo que reportó el usuario
     * con una factura: «ahora sí, pero ¿por qué la acuesta?».
     *
     * Ahora las esquinas se ordenan solas antes de enderezar —arriba-izquierda
     * es la que está arriba a la izquierda, la haya puesto quien la haya
     * puesto— y el giro que se APLICA es el que alguien pidió, contado aparte. */
    const [cuartos, setCuartos] = useState(0);
    const [vista, setVista] = useState(null);             // su vista previa con acabado
    const [medidas, setMedidas] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [fallo, setFallo] = useState(null);

    const opciones = useMemo(() => acabadosDe(doc), [doc]);

    /* ── La foto, cargada una vez ────────────────────────────────────────────
     * Se guarda el elemento `Image` y no sólo la URL porque hacen falta sus
     * medidas naturales en tres sitios: el encuadre, la lupa y el enderezado. */
    useEffect(() => {
        if (!file) return undefined;
        const url = URL.createObjectURL(file);
        const im = new Image();
        let vivo = true;
        im.onload = () => { if (vivo) setImagen(im); };
        im.onerror = () => { if (vivo) setFallo('No se pudo abrir la foto.'); };
        im.src = url;
        return () => { vivo = false; URL.revokeObjectURL(url); };
    }, [file]);

    /* ── La propuesta de la lectura sólo se adopta si nadie tocó nada ────────
     *
     * Llega uno o dos segundos después de abrir, y hasta el 2026-08-28 caía
     * encima de quien ya estaba encuadrando: la forma le cambiaba debajo de la
     * mano. Ahora se adopta si el encuadre sigue como nació, y si no queda a un
     * toque de distancia («Usar el recorte sugerido»). Quien decide es quien
     * está mirando. */
    const tocado = useRef(false);
    const propuestaVista = useRef(null);
    const propuesta = useMemo(() => {
        const p = (Array.isArray(esquinas) && esquinas.length === 4)
            ? esquinas.map(q => ({ x: q.x, y: q.y }))
            : esquinasDelRecuadro(recuadro);
        return p;
    }, [esquinas, recuadro]);
    const [enEspera, setEnEspera] = useState(null);

    useEffect(() => {
        if (!propuesta) return;
        const firma = JSON.stringify(propuesta);
        if (propuestaVista.current === firma) return;
        propuestaVista.current = firma;
        /* El giro que propuso la lectura se aplica ROTANDO EL ORDEN de las
         * esquinas —no girando la foto—: es la misma operación que el botón de
         * un cuarto de vuelta, y así no cuesta ninguna interpolación. */
        const propuestos = ((Math.round((giroSugerido || 0) / 90) % 4) + 4) % 4;
        if (tocado.current) setEnEspera(propuesta);
        else { setPuntos(propuesta); setCuartos(propuestos); }
    }, [propuesta, giroSugerido]);

    /* `tocado` es un ref porque lo LEE un efecto que no lo tiene por dependencia
     * —el que decide si la propuesta se adopta—, y con estado ahí leería el
     * valor de cuando el efecto corrió, no el de ahora. `mostrarAyuda` es estado
     * aparte porque eso sí se PINTA, y un ref leído en el render no vuelve a
     * dibujar nada. No son dos versiones del mismo dato: uno decide y el otro
     * se muestra. */
    const [mostrarAyuda, setMostrarAyuda] = useState(true);
    const cambiarPuntos = useCallback((nuevos) => {
        tocado.current = true;
        setMostrarAyuda(false);
        setPuntos(nuevos);
    }, []);

    // ── Paso 1 → 2: enderezar con las cuatro esquinas ───────────────────────
    const enderezarCon = useCallback((q) => {
        if (!imagen) return;
        /* Se ORDENAN y después se giran los cuartos que se pidieron. Ordenar
         * primero es lo que impide que arrastrar una manija por encima de otra
         * acueste el documento; girar después es lo que hace que el botón siga
         * sirviendo. */
        let esq = ordenarEsquinas(puntos) || puntos;
        for (let i = 0; i < q; i++) esq = girarEsquinas(esq);
        // La MISMA tubería que usa el camino automático: si cada uno tuviera la
        // suya, corregir el encuadre y confirmar sin cambiar nada daría un
        // archivo distinto del que el portal había preparado solo.
        const r = rectificarPapel(imagen, esq);
        if (!r) { setFallo('Ese encuadre no forma un documento. Mueve las esquinas.'); return; }
        setFallo(null);
        setEnderezada(r.canvas);
        setFormato(r.formato);
        setPaso('acabado');
    }, [imagen, puntos]);

    const enderezar = useCallback(() => enderezarCon(cuartos), [enderezarCon, cuartos]);

    /* Girar DESPUÉS de ver el resultado, que es cuando se nota que salió
     * acostado. Antes el botón sólo existía en el encuadre —donde lo que se ve
     * es la foto original, no el resultado—, así que había que adivinar si hacía
     * falta. «No me permite rotar» (usuario, sobre el paso del acabado). */
    const girarResultado = useCallback(() => {
        const q = (cuartos + 1) % 4;
        setCuartos(q);
        enderezarCon(q);
    }, [cuartos, enderezarCon]);

    /* ── Paso 2: la vista previa ─────────────────────────────────────────────
     *
     * Cada acabado se dibuja DE VERDAD sobre esta foto, no se imita con un
     * filtro del navegador. La versión anterior lo imitaba, y eso significa dos
     * versiones de la misma idea que se separan sin avisar: la miniatura
     * prometía una cosa y el archivo guardaba otra. */
    useEffect(() => {
        if (!enderezada) return;
        const escalaVista = Math.min(1, 1400 / Math.max(enderezada.width, enderezada.height));
        const { canvas, ctx } = aEscala(enderezada, escalaVista);
        aplicarAcabado(ctx, canvas.width, canvas.height, acabado);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- nace del recorte confirmado
        setVista(canvas.toDataURL('image/jpeg', 0.9));
    }, [enderezada, acabado]);

    /* La revisión que avisa: se mide sobre el recorte SIN acabado —«aclarada»
     * lleva todo a gris y borraría justo el color del que se quiere hablar— y
     * con las dimensiones que va a tener el archivo. */
    useEffect(() => {
        if (!enderezada) return;
        const escala = Math.min(1, LADO_ANALISIS / Math.max(enderezada.width, enderezada.height));
        const { canvas, ctx } = aEscala(enderezada, escala);
        const d = medirDocumento(ctx.getImageData(0, 0, canvas.width, canvas.height).data,
            canvas.width, canvas.height);
        const final = escalaDeSalida(enderezada.width, enderezada.height, doc);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- nace del recorte confirmado
        setMedidas({ ...d,
            ancho: Math.round(enderezada.width * final),
            alto: Math.round(enderezada.height * final) });
    }, [enderezada, doc]);

    const avisos = useMemo(
        () => (medidas ? avisosDeFoto(medidas, acabado, doc) : []), [medidas, acabado, doc]);
    const piso = useMemo(
        () => (medidas ? sePuedeGuardar(medidas, doc) : { sePuede: true }), [medidas, doc]);

    const guardar = useCallback(async () => {
        if (!enderezada) return;
        setGuardando(true);
        try {
            onConfirm(await aArchivo(enderezada, { doc, acabado, nombre: file?.name }));
        } catch (e) {
            console.error('EditorDeDocumento:', e);
            setFallo('No se pudo preparar el archivo. Intenta de nuevo.');
        } finally {
            setGuardando(false);
        }
    }, [enderezada, acabado, doc, file, onConfirm]);

    const enEncuadre = paso === 'encuadre';

    return (
        /* ── OCUPA LA PANTALLA ───────────────────────────────────────────────
           «Se ve súper pequeño» era literal: el diálogo topaba en 672 px y las
           filas de controles se le comían el alto al recorte. Acá el trabajo es
           mirar un documento, así que el documento se lleva todo lo que haya y
           los controles son una barra. `max-h-none!` levanta el tope canónico
           del 88 % — para esta pantalla y sólo para ésta. */
        <LiquidModal open onClose={guardando ? undefined : onCancel}
            maxWidth="max-w-[min(1600px,96vw)]"
            className="h-[96dvh] max-h-none!"
            ariaLabel={doc.titulo}>
            {/* `items-center` y `py-1.5` con el dedo: la cabecera del paso 2 no
                lleva bajada —el título es una palabra— así que alinear arriba
                dejaba el título y la X a distinta altura, y el relleno vertical
                sumaba alto que le falta al documento. Reportada como *«el header
                es demasiado grande»* (2026-08-30). En escritorio no cambia. */}
            <LiquidModal.Header className="flex items-center gap-2 px-3! py-1.5! md:px-6! md:py-4!">
                {/* ── La cabecera y el pie son ALTO QUE NO ES DOCUMENTO ───────
                    Medido en un iPhone 13: la cabecera se llevaba 94 px y el
                    pie **237** —los cuatro botones se apilaban en cuatro
                    renglones—, así que del alto de la pantalla al documento le
                    quedaba el 27 %. «Se ve súper pequeño» en el teléfono era
                    exactamente eso, y no el tamaño del diálogo.

                    Ahora el pie es UNA fila que no se parte, las herramientas
                    van sin rótulo con el dedo, y «Cancelar» se mudó acá arriba
                    como una X: es una salida, no una acción del trabajo. */}
                <div className="min-w-0 flex-1">
                    <h3 className={`font-bold text-content ${conElDedo ? 'text-body-sm' : 'text-body'}`}>
                        {enEncuadre ? doc.titulo : 'Acabado'}
                    </h3>
                    {/* Lo que está por llegar SE VE llegando: sin esto el editor
                        abre con cara de terminado y la lectura cae encima. */}
                    {enEncuadre && analizando ? (
                        <p className="text-caption text-content-3 flex items-center gap-1.5">
                            <Loader2 size={12} className="animate-spin shrink-0" />
                            Buscando el documento en la foto…
                        </p>
                    ) : !conElDedo && (
                        /* Con el dedo la instrucción NO va acá: en un teléfono
                           ocupa dos o tres renglones de cabecera, y ese alto sale
                           del documento. Va sobre la propia foto (`ayuda`), donde
                           no le saca espacio a nada. */
                        <p className="text-caption text-content-3">
                            {/* Lo que hay que LOGRAR con este papel — lo dice el
                                catálogo, y es distinto para una receta, una
                                boleta y un DUI. El CÓMO (los gestos) va sobre la
                                foto: son dos preguntas distintas y mezclarlas en
                                un renglón deja las dos a medias. */}
                            {enEncuadre ? doc.bajada
                                : (formato?.seguro
                                    /* El nombre del papel SÓLO cuando no hay
                                       duda: un oficio de pie y una cédula parada
                                       se llevan un 3.6 %, y poner el nombre
                                       equivocado se lee como que el portal
                                       entendió el documento. Ver
                                       `utils/formatosDePapel.js`. */
                                    ? `Se ajustó a tamaño ${formato.nombre.toLowerCase()} ${formato.orientacion}. Elige cómo se ve.`
                                    : 'Elige cómo se ve. Puedes volver y corregir el encuadre.')}
                        </p>
                    )}
                </div>
                <Button variant="ghost" size="sm" icon={X} iconOnly title="Cancelar"
                    onClick={onCancel} disabled={guardando} />
            </LiquidModal.Header>

            {/* `px-*!`/`py-*!` y no `p-*!`: el canónico trae `px-6 py-5`, y `p-3`
                no le gana a `px-6` — son propiedades distintas, no una más
                específica. Con el dedo esos 40 px verticales salen del
                documento. */}
            <LiquidModal.Body className="flex flex-col gap-2 px-3! py-2! md:px-4! md:py-3!">
                <div className="flex-1 min-h-0">
                    {enEncuadre ? (
                        imagen ? (
                            <LienzoDeEncuadre
                                imagen={imagen}
                                esquinas={puntos}
                                alCambiarEsquinas={cambiarPuntos}
                                ayuda={!mostrarAyuda ? null : (conElDedo
                                    ? 'Arrastra las esquinas · pellizca para acercar · gira con dos dedos'
                                    : 'Arrastra las cuatro esquinas del papel · rueda para acercar')}
                            />
                        ) : (
                            <div className="w-full h-full grid place-items-center">
                                <Loader2 size={22} className="animate-spin text-content-3" />
                            </div>
                        )
                    ) : (
                        <div className="relative w-full h-full min-h-0 flex items-center justify-center
                                        bg-surface-card-hover rounded-card overflow-hidden p-1">
                            {/* La vista previa toma TODO el hueco: `h-full w-full` con
                                `object-contain` entra entera y a la vez usa el alto
                                completo, en vez de quedarse en su tamaño natural con
                                aire alrededor. El `min-h-0` es la condición para que
                                eso valga —un hijo de flex sin él no baja de su
                                contenido— y el `p-1` en vez de `p-2` devuelve 8 px:
                                cada píxel de relleno es un píxel menos de documento.

                                Lo que la agrandó de verdad, igual, fue sacar la tira
                                de miniaturas de acá abajo (~46 px) y apretar la
                                cabecera. */}
                            {vista
                                ? <img src={vista} alt="" className="w-full h-full object-contain
                                                                     rounded-card shadow-[var(--shadow-glass-2)]" />
                                : <Loader2 size={22} className="animate-spin text-content-3" />}

                            {/* ── Girar va SOBRE la foto ─────────────────────
                                Y es la tercera casa que prueba, así que
                                conviene el registro:

                                · En el PIE, junto a la flecha de volver:
                                  *«parece que es para retomar la foto y no
                                  rotar»*.
                                · En la barra de acabados: *«el ícono de rotar
                                  se pierde (scroll horizontal)»*. Medido — en
                                  una pantalla de 375 px el diálogo deja 336, y
                                  el carril con los tres acabados mide 305: con
                                  el botón al lado, el total se iba 21 px
                                  afuera. Bajarle el ancho al carril lo habría
                                  partido en dos renglones, o sea 46 px menos de
                                  documento para no perder un botón.
                                · Acá: no cuesta NADA de alto y no se puede
                                  confundir con volver ni con cerrar, porque
                                  está encima de lo que gira.

                                El fondo opaco no es adorno: sin él, sobre un
                                papel blanco el ícono desaparece. */}
                            {vista && (
                                /* `data-surface` y `Button`, no un botón a mano: el
                                   primero lo pintó el gate de diseño —vidrio escrito
                                   a mano fuera de una superficie canónica, y el
                                   `title` repitiendo el `aria-label`—. La posición
                                   es lo único propio; el material y el rótulo los
                                   pone el canónico. */
                                <div data-surface="card"
                                    className="absolute bottom-2 right-2 rounded-btn shadow-[var(--shadow-glass-2)]">
                                    <Button variant="secondary" size="sm" icon={RotateCw}
                                        iconOnly title="Girar un cuarto de vuelta"
                                        onClick={girarResultado} disabled={guardando} />
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Los acabados y el giro, en UNA barra ───────────────────
                    Antes eran miniaturas de 80×84 con la foto aplicada en cada
                    una. El argumento era bueno —un nombre como «Aclarada» no
                    dice qué le va a pasar a ESTA foto— pero se llevaba 90 px de
                    alto, y en un teléfono ese alto sale del documento: *«para
                    aplicar el filtro no me muestra la imagen completa»*
                    (usuario, 2026-08-30).

                    Y el argumento ya no aplicaba: el acabado elegido se dibuja
                    de verdad sobre la vista GRANDE, al instante. O sea que la
                    miniatura de 80 px competía con una vista previa del tamaño
                    de la pantalla que muestra exactamente lo mismo, mejor.

                    El control es `SegmentedControl` y no tres botones sueltos
                    porque es literalmente lo que dice su canónico: una de N
                    está seleccionada.

                    **Y GIRAR va acá, no en el pie.** Estaba al lado de la
                    flecha de volver, y ahí no se lee como lo que es: *«ahora
                    que está a la par de retroceder parece que es para retomar
                    la foto y no rotar»*. Junto a los acabados queda con las
                    otras herramientas que cambian ESTA foto — el pie se queda
                    con salir y guardar, que son las dos decisiones. */}
                {!enEncuadre && (
                    /* NADA de `overflow-x-auto` acá.
                     *
                     * Lo tenía, y con eso el carril de acabados conservaba su
                     * ancho natural y empujaba a Girar fuera de la pantalla:
                     * *«el ícono de rotar se pierde (scroll horizontal), en
                     * móvil el scroll horizontal prohibido»* (usuario,
                     * 2026-08-30). Una herramienta a la que hay que llegar
                     * deslizando es una herramienta que no está.
                     *
                     * `min-w-0` es lo que lo arregla: deja que el carril CEDA
                     * ancho, y como `SegmentedControl` ya envuelve con más de
                     * dos opciones, si los tres acabados no entran en un
                     * renglón pasan a dos — pero Girar nunca desaparece. El
                     * alto sólo crece cuando de verdad hace falta. */
                    <div className="shrink-0 flex items-center justify-center">
                        {/* Sin `className`: el canónico ya trae `max-w-full` y
                            `flex-wrap`, y con eso solo el carril nunca se sale
                            —a 320 px pasa a dos renglones—. Se probó agregarle
                            `min-w-0 shrink!` para vencer su `shrink-0` y,
                            medido, no cambiaba un píxel: `shrink-0` sólo pesa
                            cuando el carril tiene un hermano que le dispute el
                            ancho, y ya no lo tiene. Un remiendo que no hace
                            nada es peor que ninguno: la próxima persona lo lee
                            como que hizo falta. */}
                        <SegmentedControl size="sm" label="Acabado"
                            value={acabado} onChange={setAcabado}
                            options={opciones.map(op => ({
                                value: op.value, label: op.label,
                                icon: ICONO_DE_ACABADO[op.value],
                            }))} />
                    </div>
                )}

                {/* La zona de avisos NO reserva alto, y eso es una corrección.
                    Reservaba 52 px fijos en el paso 2 con este motivo escrito:
                    «si creciera y encogiera con lo que dijera el aviso, el
                    lienzo (flex-1) cambiaría de alto, la medición volvería a
                    correr y el aviso cambiaría otra vez». Ese bucle es real y
                    ya se vio en pantalla — pero en el paso **1**, donde el
                    lienzo mide el encuadre contra su propia caja.

                    En el paso 2 no puede pasar: `medidas` sale de `enderezada`,
                    o sea del recorte ya confirmado (`[enderezada, doc]`), y no
                    de ninguna medida de pantalla. El motivo se heredó del paso
                    anterior sin volver a comprobarlo, y el costo eran 52 px de
                    nada debajo de los acabados cuando no hay ningún aviso —
                    reportado así: *«hay espacio abajo de los iconos de filtro,
                    puedes hacer más grande la preview»*. */}
                <div className="shrink-0 overflow-y-auto empty:hidden">
                    {fallo && <Notice variant="warning" compact>{fallo}</Notice>}
                    {!fallo && !enEncuadre && !piso.sePuede && (
                        <Notice variant="danger" compact>
                            <span className="flex items-center gap-1.5">
                                <AlertTriangle size={14} className="shrink-0" /> {piso.motivo}
                            </span>
                        </Notice>
                    )}
                    {!fallo && !enEncuadre && piso.sePuede && avisos.length > 0 && (
                        <Notice variant={avisos[0].tono === 'danger' ? 'danger' : 'warning'} compact>
                            {avisos[0].texto}
                        </Notice>
                    )}
                </div>
            </LiquidModal.Body>

            {/* ── El pie NO apila: es una barra de herramientas ───────────────
                El canónico, con el dedo, apila los botones a ancho completo
                (`[&_button]:w-full`) — que es lo correcto para un diálogo de
                «Cancelar / Aceptar». Acá el pie tiene HERRAMIENTAS (girar, todo,
                el recorte sugerido) más la acción principal, y apilarlas serían
                cinco botones de ancho completo comiéndose la pantalla.

                Sin desactivar esa regla, cada botón se estiraba a 356 px dentro
                de una fila que no se parte: medido en un iPhone 13, el contenido
                del pie desbordaba **120 px** en el encuadre y 68 en el acabado.
                Eso es lo que el usuario vio como «el botón se sale y crea
                scroll». */}
            <LiquidModal.Footer className="[&_button]:w-auto!">
                {enEncuadre ? (
                    <div className="flex flex-wrap items-center gap-2 w-full">
                        <Button variant="secondary" size="sm" icon={RotateCw}
                            iconOnly={conElDedo} title="Girar un cuarto de vuelta"
                            onClick={() => { setMostrarAyuda(false); setCuartos(c => (c + 1) % 4); }}>
                            {/* Dice cuánto se pidió: en el encuadre lo que se ve
                                es la FOTO, no el resultado, así que sin el
                                número el botón parece que no hace nada. */}
                            {conElDedo ? null : (cuartos ? `Girar · ${cuartos * 90}°` : 'Girar')}
                        </Button>
                        <Button variant="secondary" size="sm" icon={Maximize2}
                            iconOnly={conElDedo} title="Marcar la foto entera"
                            onClick={() => { tocado.current = true; setMostrarAyuda(false); setPuntos(ESQUINAS_ENTERAS); }}>
                            {conElDedo ? null : 'Todo'}
                        </Button>
                        {/* La propuesta que llegó mientras alguien trabajaba: no
                            se aplicó sola, pero tampoco se perdió. */}
                        {enEspera && (
                            <Button variant="secondary" size="sm" icon={Sparkles}
                                iconOnly={conElDedo} title="Usar el recorte sugerido"
                                onClick={() => { setPuntos(enEspera); setEnEspera(null); }}>
                                {conElDedo ? null : 'Usar el recorte sugerido'}
                            </Button>
                        )}
                        <span className="flex-1 min-w-2" />
                        <Button variant="primary" size="sm" icon={Check}
                            onClick={enderezar} disabled={!imagen}
                            /* Con el dedo se lleva el ancho que sobra: es la
                               acción del paso y el pulgar la acierta sin mirar.
                               En escritorio no crece — ahí un botón de 900 px
                               sería absurdo. */
                            className="shrink-0 flex-1 md:flex-none">
                            Continuar
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-2 w-full">
                        <Button variant="secondary" size="sm" icon={ArrowLeft}
                            iconOnly={conElDedo} title="Volver al encuadre"
                            onClick={() => { setPaso('encuadre'); setEnderezada(null); setFormato(null); }}
                            disabled={guardando}>
                            {conElDedo ? null : 'Volver al encuadre'}
                        </Button>
                        <span className="flex-1 min-w-2" />
                        <Button variant="primary" size="sm" icon={guardando ? Loader2 : Check}
                            onClick={guardar} loading={guardando}
                            className="shrink-0 flex-1 md:flex-none"
                            disabled={guardando || !enderezada || !piso.sePuede}>
                            {guardando ? 'Preparando…' : 'Guardar'}
                        </Button>
                    </div>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
