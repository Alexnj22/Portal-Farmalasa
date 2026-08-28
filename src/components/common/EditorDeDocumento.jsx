import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { AlertTriangle, Check, RotateCw, Sparkles, Undo2, ZoomIn } from 'lucide-react';
import Button from './Button';
import LiquidModal from './LiquidModal';
import Notice from './Notice';
import SegmentedControl from './SegmentedControl';
import { DOCS, avisosDeFoto, escalaDeSalida, medirDocumento, sePuedeGuardar } from '../../utils/fotoDocumento';
import useCoarsePointer from '../../hooks/useCoarsePointer';

// ═══════════════════════════════════════════════════════════════════════════
// El editor de la foto de un DOCUMENTO DE PAPEL.
//
// Nació para la receta de las bitácoras (`EditorDeReceta`) y se generalizó el
// 2026-08-20, cuando el usuario preguntó cómo mejorar la foto del comprobante de
// una salida de dinero: «no puedes detectar que sea una boleta válida / que sólo
// se guarde la boleta / mostrar vista previa y ajustar». Las tres cosas que
// pedía ya existían acá, y la salida de dinero se había quedado con un
// `FileField` pelado — o sea que el problema no era construirlo, era que este
// canónico no se conocía fuera de bitácoras.
//
// Lo específico de cada documento viaja en props (`doc`): cómo se llama, qué
// tan chico puede quedar el recorte y por qué lado se mide. Todo lo demás —el
// recorte, el enderezado, «Aclarada», el tamaño único, la revisión— es igual
// para una receta y para una boleta térmica.
//
// ── Por qué NO se reusa `PhotoEditorModal` ─────────────────────────────────
// Es el editor de fotos de PRODUCTO, y sus dos herramientas grandes —quitar el
// fondo con un modelo de IA y el pincel para repasarlo— están hechas para
// recortar un objeto de su entorno. Un documento es una HOJA: no hay objeto que
// recortar, hay papel que enderezar y tinta que hacer legible. Ofrecer «quitar
// fondo» sobre un documento invita a borrarle la mitad, y arrastra 8 MB de
// modelo a una pantalla que se abre en el teléfono de una sala.
//
// ── Qué hace, entonces ─────────────────────────────────────────────────────
//   · Recortar a la hoja y enderezarla. Manual, con el mismo canónico de
//     recorte que ya usa el portal: un cuarto de vuelta para el papel acostado
//     y un carril de ±10° para los tres o cuatro grados con los que sale toda
//     foto tomada con una mano. Hasta el 2026-08-21 sólo había cuartos de
//     vuelta, o sea que la pantalla decía «enderézala» sin darle con qué.
//   · «Aclarar»: sube el contraste hasta que el papel queda blanco y la tinta
//     negra. Es lo que la gente llama «limpiar el fondo» en un documento, y se
//     resuelve con un filtro de canvas — sin modelos ni descargas.
//   · Salir SIEMPRE al mismo tamaño, y medido por el lado que hace legible a
//     ESE papel: una hoja por el lado largo, una boleta térmica por el ancho de
//     su tira (ver `salida` en `DOCS`). Una carpeta con recetas de 4 MB y de 80
//     kB no se puede hojear ni imprimir parejo, y el peso es lo que después hace
//     inviable exportar un mes entero.
//   · Encuadrar con la forma del PAPEL: el marco del recorte es alto para una
//     tira vertical y ancho para una hoja. Con un marco ancho, una boleta de 58
//     mm se dibujaba como una astilla en el medio de la pantalla.
//   · Revisar el recorte y avisar: si casi no hay tinta, si la hoja quedó
//     oscura, si el recorte quedó chico, o si hay tinta de color que «Aclarada»
//     va a pasar a gris. Qué se mide y qué se descartó por no medir bien está
//     en `src/utils/fotoDocumento.js`.
//
// ── Lo que NO hace, y es a propósito ───────────────────────────────────────
// No busca solo los bordes del papel. Se puede —hay bibliotecas de visión que
// lo hacen— pero pesan varios megabytes y aciertan a medias con una foto
// movida sobre un mostrador. Un recorte automático equivocado es peor que uno
// manual: recorta medio documento y nadie lo mira antes de guardar.
//
// Se reevaluó el 2026-08-20 con el pedido de «que detectes y recortes el papel»
// y la conclusión no cambió por sí sola — pero sí cambia el día que la foto YA
// viaje a un modelo por otro motivo (la lectura de la boleta): ahí el recuadro
// del papel sale de una llamada que igual se hace, y entra como SUGERENCIA que
// la persona confirma en este mismo editor, no como recorte a ciegas.
// ═══════════════════════════════════════════════════════════════════════════

// Un solo tamaño para cada tipo de documento, y POR QUÉ LADO se mide lo dice
// `DOCS` (`escalaDeSalida`): una hoja se normaliza por el lado largo, una boleta
// térmica por el ancho de su tira. Acá sólo se aplica.
/* La calidad del JPEG de salida. Un documento se guarda para LEERLO, y lo que
 * la compresión se lleva primero son justamente los bordes de la letra chica —
 * que es donde vive el número del DUI. 0.92 pesa ~40% más que 0.85 sobre una
 * imagen de 1600 px (de ~300 kB a ~430 kB) y es una diferencia que se ve al
 * ampliar. Un papel se guarda una vez y se mira durante años.
 *
 * `calidad` en `DOCS` lo baja donde no haga falta. */
const CALIDAD = 0.92;

// La revisión mide sobre una copia chica. Las tres medidas que se usan —cuán
// claro es el papel, cuánta tinta hay y cuánto color— son proporciones, así que
// no cambian con el tamaño, y a 800 px la revisión corre sin trabar el teléfono
// mientras alguien mueve el recorte.
const LADO_ANALISIS = 800;

/* Los tres tratamientos, y cuál ofrece cada papel lo dice `DOCS.modos`.
 *
 * `nitida` no descarta color: equilibra el blanco, levanta el negro y enfoca.
 * `aclarada` lleva todo a gris — perfecto para una receta, destructivo para un
 * DUI, donde quema la fotografía y los fondos de seguridad. */
const MODOS = {
    original: { value: 'original', label: 'Como está' },
    nitida:   { value: 'nitida',   label: 'Nítida' },
    aclarada: { value: 'aclarada', label: 'Aclarada' },
};

/* Qué ofrece un papel que no lo diga. `aclarar: false` —lo que declara el DUI—
 * significa «gris no», y ahora eso ya no lo deja sin ninguna mejora: le queda
 * «Nítida», que es la que se hizo para él. */
/* La aproximación de cada tratamiento para la vista previa. Ver el comentario
 * del `mediaStyle`: acá no se puede correr el algoritmo real, así que se imita
 * su INTENCIÓN — más contraste y color vivo para «Nítida», gris duro para
 * «Aclarada». */
const FILTRO_DE_VISTA = {
    original: 'none',
    nitida:   'contrast(1.3) saturate(1.15) brightness(1.04)',
    aclarada: 'grayscale(1) contrast(1.8) brightness(1.12)',
};

const modosDe = (doc) => (doc.modos || (doc.aclarar === false
    ? ['original', 'nitida']
    : ['original', 'nitida', 'aclarada'])).map(k => MODOS[k]).filter(Boolean);


/**
 * Sube el contraste hasta dejar papel blanco y tinta negra.
 *
 * ── Se probó la técnica «buena» y salió PEOR ──────────────────────────────
 * Lo canónico para iluminación despareja es dividir por el campo de luz (una
 * versión muy desenfocada de la propia foto). Medido sobre una receta torcida
 * en un mostrador oscuro: **queda un halo gris en el medio de la hoja y un
 * borde negro difuminado alrededor**. El motivo es que el desenfoque toma el
 * mostrador como parte del campo, y en el centro de una hoja grande y uniforme
 * el campo ES la hoja — dividirla por sí misma da gris plano.
 *
 * Esa técnica sirve cuando el marco entero es documento (un escáner), no
 * cuando el documento es la mitad de la foto. Así que se queda el estirón
 * global, que sobre la misma imagen deja el texto y el sello legibles.
 */
function aclarar(ctx, ancho, alto) {
    const img = ctx.getImageData(0, 0, ancho, alto);
    const d = img.data;
    // Dos pasadas: primero se busca cuán claro es el papel de ESTA foto (el
    // percentil alto del gris), y después se estira el rango contra ese valor.
    // Un umbral fijo deja negra una foto tomada a contraluz y lavada una con
    // flash — y las dos son igual de comunes en un mostrador.
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
        hist[g]++;
    }
    const total = ancho * alto;
    let acum = 0, blanco = 255;
    for (let g = 255; g >= 0; g--) {
        acum += hist[g];
        if (acum > total * 0.15) { blanco = g; break; }   // el 15% más claro ES el papel
    }
    const negro = Math.max(0, blanco - 110);
    const rango = Math.max(1, blanco - negro);

    for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
        let v = ((g - negro) / rango) * 255;
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
}

/**
 * Deja la foto NÍTIDA sin volverla gris.
 *
 * ── Por qué no alcanzaba «Aclarada» ────────────────────────────────────────
 *
 * «Aclarada» lleva todo a gris para dejar papel blanco y tinta negra, y eso es
 * lo correcto en una receta. Sobre un DUI quema la fotografía de la persona y
 * los fondos de seguridad a color — o sea justo lo que hay que poder mirar. Por
 * eso el DUI la tenía prohibida, y se quedaba sin ninguna mejora: la foto de un
 * teléfono sobre un escritorio sale lavada, amarillenta y blanda, y así quedaba
 * guardada. Lo dijo el usuario mirando la suya: «que se vea más nítido y más
 * claro».
 *
 * Esto hace tres cosas y ninguna descarta color:
 *
 *  1. **Equilibra el blanco.** Se busca el percentil alto de CADA canal por
 *     separado y se estira contra él. Una foto con luz amarilla tiene el azul
 *     apagado; estirando cada canal a su propio blanco, el papel vuelve a ser
 *     papel y la tinta azul del DUI sigue siendo azul.
 *
 *  2. **Levanta el negro.** El punto oscuro se busca en el percentil bajo, no
 *     en un cero fijo: una foto a contraluz no tiene ningún píxel negro, y
 *     estirar contra el cero no le sube el contraste.
 *
 *  3. **Enfoca (máscara de desenfoque).** Se resta una copia borrosa y se suma
 *     la diferencia: es lo que devuelve el filo a la letra chica. Es el paso que
 *     más se nota en la línea de caracteres del pie del DUI.
 *
 * Los percentiles son 1% y 99% a propósito, no el mínimo y el máximo: un solo
 * píxel quemado por un reflejo movería el blanco y dejaría el resto oscuro.
 */
function realzar(ctx, ancho, alto) {
    const original = ctx.getImageData(0, 0, ancho, alto);
    const d = original.data;
    const total = ancho * alto;

    /* ── 1. El tinte: una GANANCIA por canal, y acotada ─────────────────────
     *
     * La primera versión estiraba cada canal contra su propio blanco y su propio
     * negro. Corregía el tinte, sí — y de paso **borraba el color**: medido
     * sobre una foto amarillenta de prueba, la saturación se derrumbaba de 31.6
     * a 7.6. O sea que hacía exactamente lo que este tratamiento existe para
     * evitar: dejar el DUI casi en gris.
     *
     * Estirar cada canal por separado iguala los tres, y en una imagen dominada
     * por papel eso arrastra también el color de verdad. La corrección es una
     * GANANCIA —sólo el punto blanco— y ACOTADA: un canal no puede alejarse más
     * de un 18% de los otros. Con eso el amarillo de una bombilla se va y el
     * azul del fondo de seguridad se queda. */
    const blancoDe = (c) => {
        const hist = new Uint32Array(256);
        for (let i = c; i < d.length; i += 4) hist[d[i]]++;
        let acum = 0;
        for (let v = 255; v >= 0; v--) { acum += hist[v]; if (acum > total * 0.01) return v; }
        return 255;
    };
    const blancos = [blancoDe(0), blancoDe(1), blancoDe(2)];
    const refBlanco = Math.max(...blancos, 1);
    const TOPE = 1.18;
    const ganancias = blancos.map(b => Math.min(TOPE, Math.max(1 / TOPE, refBlanco / Math.max(1, b))));

    /* ── 2. El contraste: por LUMINANCIA, igual para los tres ───────────────
     * Aplicar el mismo estiramiento a los tres canales sube el contraste sin
     * mover el tono: es la diferencia entre «más contraste» y «menos color». */
    const histL = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
        histL[g]++;
    }
    let acum = 0, negro = 0, blanco = 255;
    for (let v = 0; v < 256; v++) { acum += histL[v]; if (acum > total * 0.02) { negro = v; break; } }
    acum = 0;
    for (let v = 255; v >= 0; v--) { acum += histL[v]; if (acum > total * 0.02) { blanco = v; break; } }
    /* El estirón va CON TOPE y sin llegar a los extremos, y las dos cosas se
     * midieron.
     *
     * Sin tope, una foto de poco contraste —que es la que más lo necesita— se
     * estira tanto que casi todo llega a 255 en los tres canales; y donde los
     * tres se topan, `max - min` es cero: o sea que el color desaparece
     * justamente por subir el contraste. Medido: la saturación caía de 31.6 a
     * 12.4 sobre una foto lavada.
     *
     * Por eso el rango de salida es 10–245 y no 0–255 —deja aire para que un
     * píxel claro siga teniendo tono— y la ganancia no pasa de 2.2×. Un
     * documento no necesita negros puros: necesita que la letra se despegue del
     * papel. */
    const SALIDA_BAJA = 10, SALIDA_ALTA = 245, GANANCIA_MAXIMA = 2.2;
    const rangoCrudo = Math.max(8, blanco - negro);
    const rango = Math.max(rangoCrudo, (SALIDA_ALTA - SALIDA_BAJA) / GANANCIA_MAXIMA);
    const amplitud = SALIDA_ALTA - SALIDA_BAJA;

    for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            const conGanancia = d[i + c] * ganancias[c];
            const v = SALIDA_BAJA + ((conGanancia - negro) / rango) * amplitud;
            d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
    }
    ctx.putImageData(original, 0, 0);

    // ── 3: la máscara de desenfoque ────────────────────────────────────────
    // La copia borrosa se hace con el filtro del navegador, que corre en la GPU:
    // desenfocar a mano en JavaScript sobre 1600 px sería medio segundo de hilo
    // principal, y esto se ejecuta mientras alguien mira la pantalla.
    const aux = document.createElement('canvas');
    aux.width = ancho; aux.height = alto;
    const auxCtx = aux.getContext('2d');
    auxCtx.filter = 'blur(1.2px)';
    auxCtx.drawImage(ctx.canvas, 0, 0);

    const nitida = ctx.getImageData(0, 0, ancho, alto);
    const borrosa = auxCtx.getImageData(0, 0, ancho, alto);
    const n = nitida.data, b = borrosa.data;
    const FUERZA = 0.9;
    for (let i = 0; i < n.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            const v = n[i + c] + (n[i + c] - b[i + c]) * FUERZA;
            n[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
    }
    ctx.putImageData(nitida, 0, 0);
}

/**
 * Rota, recorta y escala. Devuelve el lienzo listo, SIN aclarar.
 *
 * Lo usan las dos cosas que necesitan la misma imagen: el archivo que se guarda
 * (a 1600 px) y la revisión que avisa antes de guardar (a 800, que alcanza y
 * corre sin trabar el teléfono). Una sola tubería para que el aviso hable de la
 * foto que de verdad se va a guardar.
 */
async function dibujar(src, cropPx, rotacion, escalaDe) {
    const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = src;
    });

    // 1 · Rotar sobre un lienzo del tamaño que corresponda.
    //
    //     El lienzo es la caja que ENCIERRA a la foto girada, y hay que
    //     calcularla con seno y coseno porque el giro ya no es de a 90°: desde
    //     que existe el enderezado fino (±10°) un cuarto de vuelta es sólo un
    //     caso particular de esta cuenta. Es también el sistema de coordenadas
    //     en el que el canónico de recorte devuelve el recuadro, así que las dos
    //     tienen que ser la MISMA caja o el recorte sale corrido.
    const rad = (rotacion * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad)), sen = Math.abs(Math.sin(rad));
    const girado = document.createElement('canvas');
    const gctx = girado.getContext('2d');
    girado.width  = Math.round(img.width * cos + img.height * sen);
    girado.height = Math.round(img.width * sen + img.height * cos);
    // El papel que asoma por las esquinas al enderezar sale blanco y no negro:
    // es el color del documento, así que no se nota como un recorte fallido.
    gctx.fillStyle = '#ffffff';
    gctx.fillRect(0, 0, girado.width, girado.height);
    gctx.translate(girado.width / 2, girado.height / 2);
    gctx.rotate(rad);
    gctx.drawImage(img, -img.width / 2, -img.height / 2);

    // 2 · Recortar.
    const c = cropPx || { x: 0, y: 0, width: girado.width, height: girado.height };
    const recorte = document.createElement('canvas');
    recorte.width = Math.max(1, Math.round(c.width));
    recorte.height = Math.max(1, Math.round(c.height));
    const rctx = recorte.getContext('2d');
    rctx.drawImage(girado, c.x, c.y, c.width, c.height, 0, 0, recorte.width, recorte.height);

    // 3 · Un solo tamaño. Nunca se AGRANDA: estirar una foto chica no agrega
    //     información, sólo peso (`escalaDeSalida` ya corta en 1).
    const escala = escalaDe(recorte.width, recorte.height);
    const salida = document.createElement('canvas');
    salida.width  = Math.max(1, Math.round(recorte.width * escala));
    salida.height = Math.max(1, Math.round(recorte.height * escala));
    const sctx = salida.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, salida.width, salida.height);
    sctx.drawImage(recorte, 0, 0, salida.width, salida.height);

    return { canvas: salida, ctx: sctx, recorte: { ancho: recorte.width, alto: recorte.height } };
}

/** Recorta, endereza, normaliza el tamaño y devuelve el archivo final. */
async function componer(src, cropPx, rotacion, modo, nombre, doc) {
    const { canvas, ctx } = await dibujar(src, cropPx, rotacion,
        (a, b) => escalaDeSalida(a, b, doc));
    if (modo === 'aclarada') aclarar(ctx, canvas.width, canvas.height);
    else if (modo === 'nitida') realzar(ctx, canvas.width, canvas.height);

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', CALIDAD));
    const base = String(nombre || doc?.archivo || 'documento').replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}

/**
 * Revisa el recorte actual y devuelve las medidas de la foto FINAL.
 *
 * Se mide sobre el lienzo sin aclarar —aclarar lleva todo a gris y borraría
 * justo el color que se quiere reportar— y las dimensiones se corrigen a las
 * que va a tener el archivo, que es de lo que habla el aviso del recorte chico.
 */
async function revisar(src, cropPx, rotacion, doc) {
    const { canvas, ctx, recorte } = await dibujar(src, cropPx, rotacion,
        (a, b) => Math.min(1, LADO_ANALISIS / Math.max(a, b)));
    const d = medirDocumento(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width, canvas.height,
    );
    const escalaFinal = escalaDeSalida(recorte.ancho, recorte.alto, doc);
    return {
        ...d,
        ancho: Math.round(recorte.ancho * escalaFinal),
        alto: Math.round(recorte.alto * escalaFinal),
    };
}

/**
 * @param {File}   file      la foto elegida
 * @param {string} tipo      clave de `DOCS` — hoy `receta`, `boleta` o `dui`
 * @param {func}   onConfirm recibe el `File` ya recortado y normalizado
 */
export default function EditorDeDocumento({ file, tipo = 'receta', recuadro = null, giroSugerido = 0, onConfirm, onCancel }) {
    const doc = DOCS[tipo] || DOCS.receta;
    /* Con el dedo se arrastra la foto y se pellizca para acercar —el canónico de
     * recorte lo trae y está medido: 60 cuadros por segundo con el procesador
     * frenado 6×—, pero eso hay que DECIRLO: el recuadro es un marco fijo y lo
     * que se mueve es la foto, así que quien lo intenta al revés concluye que la
     * vista previa no se toca. */
    const conElDedo = useCoarsePointer();
    const [src, setSrc] = useState(null);
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    /* El cuarto de vuelta que la sugerencia dice que hace falta. Arranca en él y
     * no en cero: una tarjeta apoyada de lado en un escritorio sale girada, y
     * abrir el editor con ella derecha es la mitad del trabajo hecho. Sigue
     * siendo un punto de partida — el botón Girar está ahí para corregirlo. */
    const [rotacion, setRotacion] = useState(giroSugerido || 0);
    /* El enderezado fino, aparte del cuarto de vuelta.
     *
     * Una boleta sobre un mostrador sale torcida 3 o 4 grados casi siempre —se
     * fotografía con una mano—, y hasta hoy el editor sólo giraba de a 90°: o
     * sea que decía «enderézala» y no tenía con qué. Torcida no es un problema
     * estético: el recorte tiene que salirse del papel para no cortar un
     * renglón, y lo que entra de más es mostrador. */
    const [inclinacion, setInclinacion] = useState(0);
    /* Cuántas veces se pidió volver al recorte sugerido. Remonta el canónico,
     * que lee su caja inicial UNA sola vez. */
    const [intento, setIntento] = useState(0);
    /* La proporción del recuadro de recorte, con el papel de pie.
     *
     * Arranca en la del documento y la pisa la MEDIDA del papel en cuanto se
     * conoce el tamaño real de la foto (ver `alCargarLaFoto`): el recuadro que
     * devolvió la lectura viene en fracciones de la imagen, así que su
     * proporción en píxeles es la de ESTA boleta y no una estimación. */
    const [aspectoBase, setAspectoBase] = useState(doc.aspecto || 4 / 3);
    /* Si la forma salió del PAPEL o de un valor por defecto. Decide si hace
     * falta ofrecer las formas a mano: cuando la lectura midió el recuadro, la
     * proporción es la de esta boleta y elegir otra es empeorarla. El camino de
     * vuelta, si alguien la cambió, es «Recorte sugerido». */
    const [papelMedido, setPapelMedido] = useState(false);
    /* Si ya tocaron la vista previa. Sólo apaga el cartel del gesto — una vez
     * que la persona arrastró, decirle cómo arrastrar es tapar la foto. */
    const [tocado, setTocado] = useState(false);
    const [cropPx, setCropPx] = useState(null);
    /* «Aclarada» de entrada, PERO no en todo documento.
     *
     * Sube el contraste hasta dejar papel blanco y tinta negra, que es lo que
     * hace legible una receta o una boleta térmica. Sobre un DUI quema la
     * fotografía de la persona y los fondos de seguridad a color — o sea que
     * arruina justo lo que el lector necesita ver. Los documentos que no se
     * aclaran lo declaran con `aclarar: false` y ni siquiera ven el control:
     * ofrecerlo y confiar en que nadie lo apriete es dejar el defecto puesto. */
    /* El modo por defecto lo dice el papel. Para el DUI es «Nítida» —color, con
     * el blanco equilibrado y la letra enfocada—; para una receta sigue siendo
     * «Aclarada», que es lo que la hace legible. Ninguno arranca en «Como está»:
     * una foto de teléfono sin tratar es exactamente lo que se vino a evitar. */
    const [modo, setModo] = useState(doc.modoPorDefecto || (doc.aclarar === false ? 'nitida' : 'aclarada'));
    const [guardando, setGuardando] = useState(false);
    const [medidas, setMedidas] = useState(null);
    const urlRef = useRef(null);

    useEffect(() => {
        if (!file) return undefined;
        const url = URL.createObjectURL(file);
        urlRef.current = url;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- la vista previa nace del archivo elegido
        setSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    const alRecortar = useCallback((_a, px) => setCropPx(px), []);

    /* El recuadro del papel viene en fracciones de ANCHO y de ALTO, que son
     * distintos: sin el tamaño real de la foto, `w/h` no es una proporción sino
     * dos números sin unidad. Por eso se espera a que el canónico diga cuánto
     * mide la imagen.
     *
     * Se APLICA una sola vez, y por eso hay dos referencias en vez de un
     * `useState`: elegir una forma a mano remonta el recorte, el canónico vuelve
     * a avisar que cargó la foto, y sin este freno la medida del papel le pisaba
     * la elección a la persona en el mismo instante en que la hacía. La segunda
     * referencia guarda la medida para «Recorte sugerido», que tiene que poder
     * volver a ella. */
    const aspectoDelPapel = useRef(null);
    const aspectoAplicado = useRef(false);
    const alCargarLaFoto = useCallback(({ naturalWidth, naturalHeight }) => {
        if (!recuadro || !naturalWidth || !naturalHeight) return;
        const { w, h } = recuadro;
        if (!(w > 0) || !(h > 0)) return;
        const a = (w * naturalWidth) / (h * naturalHeight);
        // Un recuadro absurdo —el modelo devolvió cualquier cosa— no manda: se
        // acota a proporciones que un papel puede tener de verdad.
        if (!(a > 0.1) || !(a < 10)) return;
        aspectoDelPapel.current = a;
        setPapelMedido(true);
        if (aspectoAplicado.current) return;
        aspectoAplicado.current = true;
        setAspectoBase(a);
    }, [recuadro]);

    /* Un solo ángulo para las dos cosas que tienen que coincidir: lo que se ve
     * mientras se encuadra y lo que se dibuja al guardar. */
    const giro = rotacion + inclinacion;

    /* ── El recuadro NO gira con la imagen ──────────────────────────────────
     *
     * Acá había un `rotacion % 180 === 90 ? 1 / aspectoBase : aspectoBase`, con
     * un comentario que sonaba razonable: «un cuarto de vuelta acuesta el papel,
     * así que también acuesta su recuadro». Y era exactamente al revés.
     *
     * `react-easy-crop` gira la IMAGEN debajo de un recuadro fijo. Si al girar
     * la imagen se voltea también el recuadro, los dos rotan juntos y la
     * orientación del papel RESPECTO DEL RECUADRO no cambia nunca: el botón
     * Girar deja de servir para lo único que sirve. Lo dijo el usuario mirando
     * un DUI acostado dentro de un recuadro de pie: «no tiene sentido, al dar en
     * girar el formato no cambió del recorte».
     *
     * Y no era un caso raro: con la tarjeta fotografiada de lado —que es como
     * sale cuando se apoya en un escritorio— la posición inicial ya no
     * encuadraba, y girar la dejaba igual de mal del otro lado. No había forma
     * de recortarla.
     *
     * Ahora el recuadro se queda quieto y Girar hace lo que dice. Qué forma
     * tiene el recuadro lo decide el papel (`aspecto` de `DOCS`) y, donde hay
     * varias, el selector de formas — que es una elección explícita y no un
     * efecto colateral de otro botón. */
    const aspecto = aspectoBase;

    /* Volver a la sugerencia del lector.
     *
     * Existe porque el recorte propuesto es lo mejor que hay cuando la foto se
     * leyó bien, y hasta ahora un arrastre sin querer lo perdía para siempre:
     * la única salida era cancelar el editor y volver a elegir la foto. */
    const volverAlaSugerencia = useCallback(() => {
        if (aspectoDelPapel.current) setAspectoBase(aspectoDelPapel.current);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setRotacion(0);
        setInclinacion(0);
        setIntento((i) => i + 1);
    }, []);

    /* Elegir la forma del papel vuelve a encuadrar sobre la sugerencia: cambiar
     * la proporción sin reencuadrar deja el recuadro donde estaba pero de otro
     * tamaño, o sea fuera del papel. */
    const elegirForma = useCallback((v) => {
        const f = (doc.formas || []).find((x) => x.value === v);
        if (!f) return;
        setAspectoBase(f.aspecto);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setIntento((i) => i + 1);
    }, [doc.formas]);

    /**
     * El recorte SUGERIDO, puesto una sola vez al abrir.
     *
     * Llega en fracciones de 0 a 1 (el recuadro del papel que devolvió la
     * lectura de la boleta) y se convierte a la caja inicial del canónico: su
     * `initialCroppedAreaPercentages` habla en porcentaje, que es la misma idea
     * ×100. Va como sugerencia y no como recorte hecho — el editor sigue abierto
     * y la persona lo confirma o lo corrige. Un recorte automático que nadie
     * mira es peor que uno manual, y eso no cambia porque lo proponga un modelo.
     *
     * `key` sobre el `Cropper` para que un recuadro nuevo lo remonte: el
     * canónico lee su caja inicial UNA vez, al montarse.
     */
    const cajaInicial = useMemo(() => {
        if (!recuadro) return undefined;
        const { x, y, w, h } = recuadro;
        if (![x, y, w, h].every((n) => Number.isFinite(n))) return undefined;
        if (w <= 0 || h <= 0) return undefined;
        // Un poco de aire: el recuadro suele venir pegado al filo del papel y
        // recortar exactamente ahí come el borde impreso.
        const aire = 0.02;
        const x0 = Math.max(0, x - aire), y0 = Math.max(0, y - aire);
        return {
            x: x0 * 100,
            y: y0 * 100,
            width:  Math.min(1 - x0, w + aire * 2) * 100,
            height: Math.min(1 - y0, h + aire * 2) * 100,
        };
    }, [recuadro]);

    // Se revisa con retardo y no en cada arrastre: mover el recorte dispara
    // decenas de eventos por segundo y medir en cada uno traba la mano de quien
    // está encuadrando. Medio segundo después de soltar es cuando la persona
    // mira la pantalla, que es cuando el aviso sirve.
    useEffect(() => {
        if (!src) return undefined;
        let vivo = true;
        const t = setTimeout(() => {
            revisar(src, cropPx, giro, doc)
                .then(d => { if (vivo) setMedidas(d); })
                // Si la revisión falla, no pasa nada: es un aviso, no un
                // requisito. Guardar tiene que seguir funcionando igual.
                .catch(() => { if (vivo) setMedidas(null); });
        }, 500);
        return () => { vivo = false; clearTimeout(t); };
    }, [src, cropPx, giro, doc]);

    const avisos = avisosDeFoto(medidas, modo, doc);
    /* El PISO. `avisos` recomienda; esto impide guardar.
     *
     * Nació de un DUI real: la tarjeta acostada ocupando un tercio de una foto
     * vertical, el resto escritorio. La FOTO era grande, así que ningún aviso
     * de tamaño saltaba; lo chico era el documento adentro. Y una vez guardado
     * ilegible, nadie lo vuelve a mirar hasta que hace falta.
     *
     * Se mide el RECORTE, que es lo que se va a guardar. Y mientras la revisión
     * todavía no midió —`medidas` en null— NO se bloquea: un botón apagado
     * porque el portal todavía no terminó de pensar se lee como roto. */
    const piso = sePuedeGuardar(medidas, doc);

    const confirmar = useCallback(async () => {
        setGuardando(true);
        const listo = await componer(src, cropPx, giro, modo, file?.name, doc);
        setGuardando(false);
        onConfirm(listo);
    }, [src, cropPx, giro, modo, file, onConfirm, doc]);

    return (
        /* El diálogo toma el alto entero y el recorte se queda con lo que sobra
           (`flex-1` abajo), en vez de pedir una fracción fija de la pantalla.
           Medido en un teléfono de 390×844: con un marco de 58vh, la forma del
           papel, «Aclarada» y el aviso quedaban fuera de la vista y había que
           descubrirlos arrastrando. Un control que no se ve no existe.
           El ANCHO sí es del documento: una tira de 58 mm en un diálogo ancho
           deja dos franjas muertas a los lados. */
        <LiquidModal open onClose={guardando ? undefined : onCancel}
            maxWidth={doc.marco === 'alto' ? 'max-w-md' : 'max-w-2xl'}
            className="h-[88dvh]"
            ariaLabel={doc.titulo}>
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">{doc.titulo}</h3>
                    <p className="text-caption text-content-3">{doc.bajada}</p>
                </div>
            </LiquidModal.Header>

            {/* `space-y-2` y no 3: cinco huecos de 12 px son medio renglón de
                controles, y en un teléfono eso sale del recorte. */}
            <LiquidModal.Body className="space-y-2 flex flex-col">
                {/* El marco tiene la forma del PAPEL, no la del diálogo.
                    Una boleta térmica es una tira de 58 mm fotografiada con el
                    teléfono parado: en el marco ancho y bajo de una hoja se
                    dibujaba como una astilla en el medio de la pantalla —el
                    canónico encaja la foto entera dentro del marco— y quedaba
                    todo el mostrador alrededor, que es justo lo que hay que
                    sacar. Con el marco alto la tira ocupa casi toda la altura y
                    el recorte se hace con el dedo, no con la uña. */}
                <div onPointerDown={() => setTocado(true)}
                    className="relative w-full flex-1 min-h-32 rounded-card overflow-hidden bg-surface-card-hover">
                    {src && (
                        <Cropper
                            // La proporción entra en la `key` porque la caja
                            // inicial se lee UNA vez al montar: si cambia
                            // después, el recuadro queda con la forma nueva
                            // pero encuadrado con la vieja — o sea, fuera del
                            // papel.
                            key={`${cajaInicial ? 'sugerido' : 'libre'}-${intento}-${aspecto.toFixed(3)}`}
                            image={src}
                            crop={crop}
                            zoom={zoom}
                            rotation={giro}
                            initialCroppedAreaPercentages={cajaInicial}
                            onCropChange={setCrop}
                            onZoomChange={setZoom}
                            onCropComplete={alRecortar}
                            onMediaLoaded={alCargarLaFoto}
                            // El canónico NO tiene modo libre: sin esto usa 4:3
                            // acostado, que sobre una tira de 58 mm obliga a
                            // meter medio mostrador para poder encuadrarla.
                            aspect={aspecto}
                            // El tope del acercamiento y el del carril de abajo
                            // tienen que ser el MISMO número: el canónico trae 3
                            // de fábrica y el carril llegaba a 4, así que en el
                            // teléfono los dedos frenaban antes que el carril
                            // sobre la misma foto y parecía que la pantalla se
                            // trababa.
                            maxZoom={6}
                            objectFit="contain"
                            /* ── La vista previa MUESTRA el tratamiento ──────────
                               Sin esto, elegir «Nítida» o «Aclarada» no cambiaba
                               nada en pantalla: el tratamiento se aplicaba recién
                               al guardar. Un control que no acusa recibo se lee
                               como roto, y encima deja decidir a ciegas sobre lo
                               único que hay que decidir acá.

                               Es una APROXIMACIÓN con filtros del navegador, no el
                               algoritmo: el de verdad busca el blanco y el negro
                               de ESTA foto y enfoca con una máscara de desenfoque,
                               y eso no se puede escribir como un `filter`. El
                               archivo guardado sale MEJOR que esta vista previa,
                               nunca distinto en intención. */
                            style={{ mediaStyle: { filter: FILTRO_DE_VISTA[modo] || 'none' } }}
                            restrictPosition={false}
                        />
                    )}
                    {/* El gesto se explica DENTRO del marco, sobre la zona
                        oscurecida: ahí no le saca alto a los controles, que en
                        un teléfono es lo que escasea. Y hay que explicarlo: el
                        recuadro es un marco FIJO y lo que se mueve es la foto,
                        así que quien lo intenta al revés concluye que la vista
                        previa no se toca. `pointer-events-none` para no comerse
                        el primer arrastre justo donde dice cómo arrastrar. */}
                    {conElDedo && src && !tocado && (
                        <span data-surface="tooltip"
                            className="absolute inset-x-0 bottom-2 mx-auto w-fit max-w-[92%]
                                px-3 py-1 text-micro font-bold text-content text-center
                                pointer-events-none select-none">
                            Arrastra el papel y pellizca para acercar
                        </span>
                    )}
                </div>

                {/* Dos carriles, cada uno con su rótulo: acercar y enderezar se
                    usan uno tras otro sobre la misma foto y sin rótulo no se
                    distinguen. El de enderezar llega a ±10°, que es lo que se
                    tuerce un papel apoyado en un mostrador — un rango más grande
                    sólo hace imposible clavar los 3° que hacen falta. */}
                <div className="space-y-2 shrink-0">
                    <label className="flex items-center gap-2">
                        <ZoomIn size={14} className="text-content-3 shrink-0" />
                        <span className="text-caption text-content-3 w-16 shrink-0">Acercar</span>
                        <input
                            type="range" min="1" max="6" step="0.05" value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="w-full accent-brand cursor-pointer"
                            aria-label="Acercar"
                        />
                    </label>
                    <label className="flex items-center gap-2">
                        <RotateCw size={14} className="text-content-3 shrink-0" />
                        <span className="text-caption text-content-3 w-16 shrink-0">Enderezar</span>
                        <input
                            type="range" min="-10" max="10" step="0.5" value={inclinacion}
                            onChange={(e) => setInclinacion(Number(e.target.value))}
                            className="w-full accent-brand cursor-pointer"
                            aria-label="Enderezar"
                        />
                        <span className="text-caption tabular-nums text-content-3 w-10 text-right shrink-0">
                            {inclinacion ? `${inclinacion > 0 ? '+' : ''}${inclinacion}°` : '0°'}
                        </span>
                    </label>
                </div>

                {/* Todo en dos filas y en tamaño chico: cada fila de controles
                    se la saca al recorte, que es donde se hace el trabajo. La
                    forma del papel sólo la tienen los documentos cuyo largo
                    varía de verdad —una boleta térmica mide lo que el POS haya
                    impreso—; en los demás sería un control para elegir mal. */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {/* Con el dedo, «Girar» va sin rótulo: los tres controles de
                        esta fila con rótulo no entran en el ancho de un teléfono
                        y la fila se parte en tres, que son dos renglones que
                        salen del recorte. El giro de un cuarto de vuelta es la
                        flecha de siempre y además lleva su nombre en `title`. */}
                    <Button variant="secondary" size="sm" icon={RotateCw}
                        iconOnly={conElDedo} title="Girar un cuarto de vuelta"
                        onClick={() => setRotacion(r => (r + 90) % 360)}>
                        {conElDedo ? null : 'Girar'}
                    </Button>
                    {/* Sólo cuando hay sugerencia que recuperar: un botón que no
                        puede hacer nada se aprieta igual y no pasa nada, que es
                        peor que no estar. */}
                    {cajaInicial && (
                        <Button variant="ghost" size="sm" icon={Undo2} iconOnly
                            title="Volver al recorte sugerido"
                            onClick={volverAlaSugerencia} />
                    )}
                    {/* Sólo cuando la forma NO salió del papel: con el recuadro
                        medido, la proporción es la de ESTA boleta y elegir otra
                        es empeorarla. Además libera el renglón que en un
                        teléfono se lleva la vista previa. */}
                    {doc.formas && !papelMedido && (
                        <SegmentedControl
                            size="sm"
                            value={(doc.formas.find((f) => f.aspecto === aspectoBase) || {}).value || ''}
                            onChange={elegirForma}
                            options={doc.formas.map(({ value, label }) => ({ value, label }))}
                            label="Forma del papel"
                        />
                    )}
                    <div className="ml-auto">
                        <SegmentedControl size="sm" value={modo} onChange={setModo} options={modosDe(doc)} />
                    </div>
                </div>

                {/* ── ESTA ZONA TIENE ALTO FIJO, y ese es todo el punto ──────
                    Lo que había crecía y encogía con lo que dijera el aviso, y
                    eso arma un BUCLE de reflujo:

                      el aviso pasa de una línea a dos  →  el marco de recorte
                      (`flex-1`) pierde alto  →  el recorte mide distinto  →  la
                      revisión vuelve a correr  →  el aviso cambia  →  y otra vez.

                    Desde afuera se ve como que la vista «hace zoom sola en
                    bucle», que es exactamente como lo describió el usuario
                    mientras ajustaba un DUI. No era el recortador: era el
                    cartel de abajo moviéndole el alto.

                    Con alto fijo, el marco de recorte no cambia nunca de
                    tamaño, así que la medida no cambia, así que no hay
                    realimentación. Si hay más avisos de los que entran,
                    scrollean adentro — mover el resto de la pantalla para
                    hacerles lugar es justo lo que no puede pasar. */}
                <div className="shrink-0 h-[76px] md:h-[68px] overflow-y-auto overscroll-contain space-y-2 pr-0.5">
                    {/* El motivo del bloqueo va PRIMERO y en rojo: los demás
                        avisos son consejos y éste es la razón por la que el
                        botón está apagado. Un `title` solo no alcanza — con el
                        dedo no hay cursor que pasar por encima. */}
                    {!piso.sePuede && (
                        <Notice variant="danger" compact icon={AlertTriangle}>{piso.motivo}</Notice>
                    )}

                    {/* Los avisos reemplazan a la explicación fija cuando hay algo
                        que decir: dos carteles apilados no se leen ninguno. */}
                    {avisos.length > 0 ? (
                        avisos.map((a, i) => (
                            <Notice key={a.texto} variant={a.tono} compact
                                icon={i === 0 && a.tono === 'warning' ? AlertTriangle : Sparkles}>
                                {a.texto}
                            </Notice>
                        ))
                    ) : piso.sePuede && !conElDedo ? (
                        // Con el dedo el consejo del gesto ya está dentro del marco
                        // y el resto de la pista es de escritorio.
                        <Notice variant="info" compact icon={Sparkles}>{doc.pista}</Notice>
                    ) : null}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onCancel} disabled={guardando}>
                    Cancelar
                </Button>
                <Button variant="primary" icon={Check} onClick={confirmar} loading={guardando}
                    disabled={!piso.sePuede} title={piso.motivo || undefined}>
                    Usar esta foto
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
