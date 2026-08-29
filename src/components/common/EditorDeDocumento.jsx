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
 *   **2 · Acabado** — el documento ya enderezado, grande, y una tira de
 *   miniaturas donde cada acabado se VE aplicado sobre esta foto antes de
 *   elegirlo. Arranca en «Nítida», que mejora sin descartar color.
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
import { AlertTriangle, ArrowLeft, Check, Loader2, Maximize2, RotateCw, Sparkles, X } from 'lucide-react';
import Button from './Button';
import LiquidModal from './LiquidModal';
import Notice from './Notice';
import LienzoDeEncuadre from './LienzoDeEncuadre';
import { DOCS, avisosDeFoto, escalaDeSalida, medirDocumento, sePuedeGuardar } from '../../utils/fotoDocumento';
import { ESQUINAS_ENTERAS, girarEsquinas } from '../../utils/perspectiva';
import { aEscala, aArchivo, rectificarPapel } from '../../utils/componerDocumento';
import { acabadoPorDefecto, acabadosDe, aplicarAcabado } from '../../utils/tratamientoDeFoto';
import useCoarsePointer from '../../hooks/useCoarsePointer';

// El lado con el que se revisa la foto antes de guardarla. 800 alcanza para
// medir papel, tinta y color, y corre sin trabar un teléfono.
const LADO_ANALISIS = 800;
// Las miniaturas de la tira de acabados. Chicas a propósito: se recalculan cada
// vez que cambia el recorte y tienen que salir en un parpadeo.
const LADO_MINIATURA = 132;

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
    const [vista, setVista] = useState(null);             // su vista previa con acabado
    const [miniaturas, setMiniaturas] = useState({});
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
        let listas = propuesta;
        const cuartos = ((Math.round((giroSugerido || 0) / 90) % 4) + 4) % 4;
        for (let i = 0; i < cuartos; i++) listas = girarEsquinas(listas);
        if (tocado.current) setEnEspera(listas);
        else setPuntos(listas);
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
    const enderezar = useCallback(() => {
        if (!imagen) return;
        // La MISMA tubería que usa el camino automático: si cada uno tuviera la
        // suya, corregir el encuadre y confirmar sin cambiar nada daría un
        // archivo distinto del que el portal había preparado solo.
        const r = rectificarPapel(imagen, puntos);
        if (!r) { setFallo('Ese encuadre no forma un documento. Mueve las esquinas.'); return; }
        setFallo(null);
        setEnderezada(r.canvas);
        setFormato(r.formato);
        setPaso('acabado');
    }, [imagen, puntos]);

    /* ── Paso 2: la vista previa y las miniaturas ────────────────────────────
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

    useEffect(() => {
        if (!enderezada) return;
        const escala = Math.min(1, LADO_MINIATURA / Math.max(enderezada.width, enderezada.height));
        const nuevas = {};
        for (const op of opciones) {
            const { canvas, ctx } = aEscala(enderezada, escala);
            aplicarAcabado(ctx, canvas.width, canvas.height, op.value);
            nuevas[op.value] = canvas.toDataURL('image/jpeg', 0.8);
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- nacen del recorte confirmado
        setMiniaturas(nuevas);
    }, [enderezada, opciones]);

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
            <LiquidModal.Header className="flex items-start gap-2 px-3! py-2! md:px-6! md:py-4!">
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
                    <h3 className="text-body font-bold text-content">
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
                        <div className="w-full h-full grid place-items-center
                                        bg-surface-card-hover rounded-card overflow-hidden p-2">
                            {vista
                                ? <img src={vista} alt="" className="max-w-full max-h-full object-contain
                                                                     rounded-card shadow-[var(--shadow-glass-2)]" />
                                : <Loader2 size={22} className="animate-spin text-content-3" />}
                        </div>
                    )}
                </div>

                {/* ── La tira de acabados, sólo en el paso 2 ─────────────────
                    Con la imagen aplicada en cada miniatura: un nombre como
                    «Aclarada» no dice qué le va a pasar a ESTA foto, y probar
                    uno por uno para ver es exactamente la torpeza que se vino a
                    sacar. */}
                {!enEncuadre && (
                    <div className="shrink-0 flex gap-2 overflow-x-auto pb-1">
                        {opciones.map(op => (
                            <button key={op.value} type="button"
                                onClick={() => setAcabado(op.value)}
                                title={op.pista}
                                className={`shrink-0 rounded-card overflow-hidden border-2 transition-all
                                            min-h-[var(--tap-min)] active:scale-[0.97]
                                            ${acabado === op.value
                                        ? 'border-brand shadow-[var(--shadow-glass-2)]'
                                        : 'border-transparent opacity-80'}`}>
                                {miniaturas[op.value]
                                    ? <img src={miniaturas[op.value]} alt=""
                                        className="w-20 h-14 object-cover" />
                                    : <span className="block w-20 h-14 bg-surface-card-hover" />}
                                <span className={`block px-2 py-1 text-micro font-black text-center
                                                  ${acabado === op.value ? 'text-brand-text' : 'text-content-3'}`}>
                                    {op.label}
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {/* Zona de avisos de ALTO FIJO: si creciera y encogiera con lo
                    que dijera el aviso, el lienzo (`flex-1`) cambiaría de alto,
                    la medición volvería a correr y el aviso cambiaría otra vez.
                    Ese bucle ya se vio en pantalla («hace zoom solo en bucle»). */}
                {/* En el paso 2 el alto es FIJO: si creciera y encogiera con lo
                    que dijera el aviso, el lienzo (`flex-1`) cambiaría de alto,
                    la medición volvería a correr y el aviso cambiaría otra vez
                    — ese bucle ya se vio en pantalla. En el paso 1 no hay
                    ninguna medición atada al alto, así que reservar 52 px sería
                    regalarle al vacío el espacio que le falta al documento. */}
                <div className={`shrink-0 overflow-y-auto ${enEncuadre ? '' : 'h-[52px]'}`}>
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

            <LiquidModal.Footer>
                {enEncuadre ? (
                    <div className="flex flex-nowrap items-center gap-2 w-full overflow-x-auto">
                        <Button variant="secondary" size="sm" icon={RotateCw}
                            iconOnly={conElDedo} title="Girar un cuarto de vuelta"
                            onClick={() => { tocado.current = true; setMostrarAyuda(false); setPuntos(girarEsquinas); }}>
                            {conElDedo ? null : 'Girar'}
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
                            onClick={enderezar} disabled={!imagen} className="shrink-0">
                            Continuar
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-nowrap items-center gap-2 w-full overflow-x-auto">
                        <Button variant="secondary" size="sm" icon={ArrowLeft}
                            iconOnly={conElDedo} title="Volver al encuadre"
                            onClick={() => { setPaso('encuadre'); setEnderezada(null); setFormato(null); }}
                            disabled={guardando}>
                            {conElDedo ? null : 'Volver al encuadre'}
                        </Button>
                        <span className="flex-1 min-w-2" />
                        <Button variant="primary" size="sm" icon={guardando ? Loader2 : Check}
                            onClick={guardar} loading={guardando}
                            className="shrink-0"
                            disabled={guardando || !enderezada || !piso.sePuede}>
                            {guardando ? 'Preparando…' : 'Guardar'}
                        </Button>
                    </div>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
