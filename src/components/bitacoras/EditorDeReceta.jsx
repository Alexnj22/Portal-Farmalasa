import React, { useCallback, useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { AlertTriangle, Check, RotateCw, Sparkles, ZoomIn } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import SegmentedControl from '../common/SegmentedControl';
import { avisosDeFoto, medirDocumento } from '../../utils/fotoDocumento';

// ═══════════════════════════════════════════════════════════════════════════
// El editor de la foto de una receta.
//
// ── Por qué NO se reusa `PhotoEditorModal` ─────────────────────────────────
// Es el editor de fotos de PRODUCTO, y sus dos herramientas grandes —quitar el
// fondo con un modelo de IA y el pincel para repasarlo— están hechas para
// recortar un objeto de su entorno. Una receta es una HOJA: no hay objeto que
// recortar, hay papel que enderezar y tinta que hacer legible. Ofrecer «quitar
// fondo» sobre un documento invita a borrarle la mitad, y arrastra 8 MB de
// modelo a una pantalla que se abre en el teléfono de una sala.
//
// ── Qué hace, entonces ─────────────────────────────────────────────────────
//   · Recortar a la hoja y enderezarla. Manual, con el mismo canónico de
//     recorte que ya usa el portal.
//   · «Aclarar»: sube el contraste hasta que el papel queda blanco y la tinta
//     negra. Es lo que la gente llama «limpiar el fondo» en un documento, y se
//     resuelve con un filtro de canvas — sin modelos ni descargas.
//   · Salir SIEMPRE al mismo tamaño. Una carpeta con recetas de 4 MB y de 80 kB
//     no se puede hojear ni imprimir parejo, y el peso es lo que después hace
//     inviable exportar un mes entero.
//   · Revisar el recorte y avisar: si casi no hay tinta, si la hoja quedó
//     oscura, si el recorte quedó chico, o si hay tinta de color que «Aclarada»
//     va a pasar a gris. Qué se mide y qué se descartó por no medir bien está
//     en `src/utils/fotoDocumento.js`.
//
// ── Lo que NO hace, y es a propósito ───────────────────────────────────────
// No busca solo los bordes del papel. Se puede —hay bibliotecas de visión que
// lo hacen— pero pesan varios megabytes y aciertan a medias con una foto
// movida sobre un mostrador. Un recorte automático equivocado es peor que uno
// manual: recorta media receta y nadie lo mira antes de guardar.
// ═══════════════════════════════════════════════════════════════════════════

// Un solo tamaño para todas. 1600px de lado largo alcanza para leer un sello y
// una firma —medido contra una receta real— y deja el archivo en pocos cientos
// de kB en vez de varios MB.
const LADO_LARGO = 1600;
const CALIDAD = 0.85;

// La revisión mide sobre una copia chica. Las tres medidas que se usan —cuán
// claro es el papel, cuánta tinta hay y cuánto color— son proporciones, así que
// no cambian con el tamaño, y a 800 px la revisión corre sin trabar el teléfono
// mientras alguien mueve el recorte.
const LADO_ANALISIS = 800;

const MODOS = [
    { value: 'original', label: 'Como está' },
    { value: 'aclarada', label: 'Aclarada' },
];

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
 * Rota, recorta y escala. Devuelve el lienzo listo, SIN aclarar.
 *
 * Lo usan las dos cosas que necesitan la misma imagen: el archivo que se guarda
 * (a 1600 px) y la revisión que avisa antes de guardar (a 800, que alcanza y
 * corre sin trabar el teléfono). Una sola tubería para que el aviso hable de la
 * foto que de verdad se va a guardar.
 */
async function dibujar(src, cropPx, rotacion, ladoLargo) {
    const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = src;
    });

    // 1 · Rotar sobre un lienzo del tamaño que corresponda.
    const rad = (rotacion * Math.PI) / 180;
    const girado = document.createElement('canvas');
    const gctx = girado.getContext('2d');
    const vertical = rotacion === 90 || rotacion === 270;
    girado.width  = vertical ? img.height : img.width;
    girado.height = vertical ? img.width  : img.height;
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
    //     información, sólo peso.
    const escala = Math.min(1, ladoLargo / Math.max(recorte.width, recorte.height));
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
async function componer(src, cropPx, rotacion, modo, nombre) {
    const { canvas, ctx } = await dibujar(src, cropPx, rotacion, LADO_LARGO);
    if (modo === 'aclarada') aclarar(ctx, canvas.width, canvas.height);

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', CALIDAD));
    const base = String(nombre || 'receta').replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}

/**
 * Revisa el recorte actual y devuelve las medidas de la foto FINAL.
 *
 * Se mide sobre el lienzo sin aclarar —aclarar lleva todo a gris y borraría
 * justo el color que se quiere reportar— y las dimensiones se corrigen a las
 * que va a tener el archivo, que es de lo que habla el aviso del recorte chico.
 */
async function revisar(src, cropPx, rotacion) {
    const { canvas, ctx, recorte } = await dibujar(src, cropPx, rotacion, LADO_ANALISIS);
    const d = medirDocumento(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width, canvas.height,
    );
    const escalaFinal = Math.min(1, LADO_LARGO / Math.max(recorte.ancho, recorte.alto));
    return {
        ...d,
        ancho: Math.round(recorte.ancho * escalaFinal),
        alto: Math.round(recorte.alto * escalaFinal),
    };
}

export default function EditorDeReceta({ file, onConfirm, onCancel }) {
    const [src, setSrc] = useState(null);
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [rotacion, setRotacion] = useState(0);
    const [cropPx, setCropPx] = useState(null);
    const [modo, setModo] = useState('aclarada');
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

    // Se revisa con retardo y no en cada arrastre: mover el recorte dispara
    // decenas de eventos por segundo y medir en cada uno traba la mano de quien
    // está encuadrando. Medio segundo después de soltar es cuando la persona
    // mira la pantalla, que es cuando el aviso sirve.
    useEffect(() => {
        if (!src) return undefined;
        let vivo = true;
        const t = setTimeout(() => {
            revisar(src, cropPx, rotacion)
                .then(d => { if (vivo) setMedidas(d); })
                // Si la revisión falla, no pasa nada: es un aviso, no un
                // requisito. Guardar tiene que seguir funcionando igual.
                .catch(() => { if (vivo) setMedidas(null); });
        }, 500);
        return () => { vivo = false; clearTimeout(t); };
    }, [src, cropPx, rotacion]);

    const avisos = avisosDeFoto(medidas, modo);

    const confirmar = useCallback(async () => {
        setGuardando(true);
        const listo = await componer(src, cropPx, rotacion, modo, file?.name);
        setGuardando(false);
        onConfirm(listo);
    }, [src, cropPx, rotacion, modo, file, onConfirm]);

    return (
        <LiquidModal open onClose={guardando ? undefined : onCancel}
            maxWidth="max-w-2xl" ariaLabel="Preparar la foto de la receta">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Preparar la foto</h3>
                    <p className="text-caption text-content-3">
                        Deja sólo la receta y enderézala. Todas salen del mismo tamaño.
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-3">
                <div className="relative w-full h-[46vh] min-h-64 rounded-card overflow-hidden bg-surface-card-hover">
                    {src && (
                        <Cropper
                            image={src}
                            crop={crop}
                            zoom={zoom}
                            rotation={rotacion}
                            onCropChange={setCrop}
                            onZoomChange={setZoom}
                            onCropComplete={alRecortar}
                            // Libre y no un formato fijo: una receta puede ser
                            // media hoja, un talonario angosto o una carta.
                            objectFit="contain"
                            restrictPosition={false}
                        />
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <Button variant="secondary" size="sm" icon={RotateCw}
                        onClick={() => setRotacion(r => (r + 90) % 360)}>
                        Girar
                    </Button>

                    <label className="flex items-center gap-2 min-w-40 flex-1">
                        <ZoomIn size={14} className="text-content-3 shrink-0" />
                        <input
                            type="range" min="1" max="4" step="0.05" value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="w-full accent-brand cursor-pointer"
                            aria-label="Acercar"
                        />
                    </label>

                    <SegmentedControl value={modo} onChange={setModo} options={MODOS} />
                </div>

                {/* Los avisos reemplazan a la explicación fija cuando hay algo
                    que decir: dos carteles apilados no se leen ninguno. */}
                {avisos.length > 0 ? (
                    <div className="space-y-2">
                        {avisos.map((a, i) => (
                            <Notice key={a.texto} variant={a.tono} compact
                                icon={i === 0 && a.tono === 'warning' ? AlertTriangle : Sparkles}>
                                {a.texto}
                            </Notice>
                        ))}
                    </div>
                ) : (
                    <Notice variant="info" compact icon={Sparkles}>
                        «Aclarada» sube el contraste hasta dejar el papel blanco y la tinta negra.
                        Si la receta trae sello a color y se pierde, guárdala «como está».
                    </Notice>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onCancel} disabled={guardando}>
                    Cancelar
                </Button>
                <Button variant="primary" icon={Check} onClick={confirmar} loading={guardando}>
                    Usar esta foto
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
