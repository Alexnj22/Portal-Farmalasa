import React, { useState, useCallback, useRef, useEffect } from 'react';
import Button from './Button';
import Cropper from 'react-easy-crop';
import ModalShell from './ModalShell';
import useMediaQuery from '../../plataforma/useMediaQuery';
import { encuadrarProducto, medirFoto, quitarFondo } from '../../plataforma/fotoDeProducto';
import { revisarCalidad } from '@nucleo/utils/calidadDeFoto';
import Notice from './Notice';
import {
    X, ZoomIn, ZoomOut, Scissors, Loader2, Check, Focus, ImageOff,
    RotateCcw, RotateCw, Eraser, Paintbrush, ChevronLeft, Plus, Minus,
} from 'lucide-react';

// ── Canvas helpers ─────────────────────────────────────────────────────────────

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

async function getCroppedBlob(imageSrc, cropPx, rotation = 0) {
    const img = await loadImage(imageSrc);
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const bBoxW = Math.round(cos * img.width  + sin * img.height);
    const bBoxH = Math.round(sin * img.width  + cos * img.height);

    const rotCanvas = document.createElement('canvas');
    rotCanvas.width  = bBoxW;
    rotCanvas.height = bBoxH;
    const rotCtx = rotCanvas.getContext('2d');
    rotCtx.translate(bBoxW / 2, bBoxH / 2);
    rotCtx.rotate(rad);
    rotCtx.translate(-img.width / 2, -img.height / 2);
    rotCtx.drawImage(img, 0, 0);

    const canvas = document.createElement('canvas');
    canvas.width  = cropPx.width;
    canvas.height = cropPx.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(rotCanvas, cropPx.x, cropPx.y, cropPx.width, cropPx.height, 0, 0, cropPx.width, cropPx.height);

    return new Promise((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.88)
    );
}

// Read EXIF orientation from JPEG bytes (first 64 KB only)
function readExifRotation(file) {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const view = new DataView(e.target.result);
                if (view.getUint16(0, false) !== 0xFFD8) { resolve(0); return; }
                let offset = 2;
                while (offset + 4 < view.byteLength) {
                    const marker = view.getUint16(offset, false);
                    offset += 2;
                    if (marker === 0xFFE1) {
                        if (view.getUint32(offset + 2, false) !== 0x45786966) { offset += view.getUint16(offset, false); continue; }
                        const tiff   = offset + 8;
                        const little = view.getUint16(tiff, false) === 0x4949;
                        const ifd0   = tiff + view.getUint32(tiff + 4, little);
                        const count  = view.getUint16(ifd0, little);
                        for (let i = 0; i < count; i++) {
                            const ent = ifd0 + 2 + i * 12;
                            if (view.getUint16(ent, little) === 0x0112) {
                                const o = view.getUint16(ent + 8, little);
                                resolve({ 1: 0, 3: 180, 6: 90, 8: 270 }[o] ?? 0);
                                return;
                            }
                        }
                        resolve(0); return;
                    } else {
                        if (marker < 0xFF00) break;
                        offset += view.getUint16(offset, false);
                    }
                }
                resolve(0);
            } catch { resolve(0); }
        };
        reader.onerror = () => resolve(0);
        reader.readAsArrayBuffer(file.slice(0, 65536));
    });
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CHECKER = {
    backgroundImage: 'repeating-conic-gradient(#d0d0d0 0% 25%, #f8f8f8 0% 50%)',
    backgroundSize: '18px 18px',
};

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4];

// ── Cursor preview ─────────────────────────────────────────────────────────────
// Renders the brush shape at the cursor position as an overlay on the canvas.
// Positioned in display pixels relative to the canvas element's top-left.

function BrushCursor({ pos, shape, size, type }) {
    const color = type === 'erase' ? 'rgba(239,68,68,0.85)' : 'rgba(0,82,204,0.85)';
    const fill  = type === 'erase' ? 'rgba(239,68,68,0.10)' : 'rgba(0,82,204,0.10)';
    const base  = { position: 'absolute', left: pos.x, top: pos.y, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 20, border: `1.5px solid ${color}`, backgroundColor: fill };

    let extra;
    if (shape === 'round') extra = { width: size * 2, height: size * 2, borderRadius: '50%' };
    else if (shape === 'h')  extra = { width: size * 4, height: size, borderRadius: 3 };
    else                     extra = { width: size, height: size * 4, borderRadius: 3 };

    return <div style={{ ...base, ...extra }} />;
}

// ── PhotoEditorModal ───────────────────────────────────────────────────────────

// `producto` (2026-10-30): la foto va al catálogo y sale en la app de
// clientes. Mide la imagen al abrirla y NO deja guardar una miniatura o una
// imagen vacía; ofrece «Encuadrar» (centra el producto con margen parejo) y lo
// hace solo después de quitar el fondo.
export default function PhotoEditorModal({ file, onConfirm, onCancel, producto = false }) {
    // Arriba de todo: hay `return` tempranos más abajo y un hook no puede quedar
    // detrás de uno.
    const enTactil = useMediaQuery('(hover: none)');
    const originalUrl    = useRef(null);
    const originalImgRef = useRef(null);
    const brushCanvasRef = useRef(null);
    const isDrawingRef   = useRef(false);

    // Crop mode state
    const [imageSrc, setImageSrc]     = useState(null);
    const [crop, setCrop]             = useState({ x: 0, y: 0 });
    const [zoom, setZoom]             = useState(1);
    const [cropPx, setCropPx]         = useState(null);
    const [rotation, setRotation]     = useState(0);

    // Background removal state
    const [bgRemoving, setBgRemoving] = useState(false);
    const [bgRemoved, setBgRemoved]   = useState(false);
    const [bgError, setBgError]       = useState(null);     // texto del motivo, o null
    // Calidad de la imagen ORIGINAL: el recorte no le agrega píxeles.
    const [calidad, setCalidad]       = useState(null);     // problemas de revisarCalidad, o null mientras mide
    const [medidas, setMedidas]       = useState(null);
    const [roto, setRoto]             = useState(false);    // el navegador no la pudo abrir
    const [encuadrando, setEncuadrando] = useState(false);
    const [sinProducto, setSinProducto] = useState(false);
    const [autoPaso, setAutoPaso]     = useState(null);     // 'limpiar' | 'fondo' | null
    const autoRef = useRef(null);

    // Brush mode state
    const [brushMode, setBrushMode]   = useState(false);
    const [brushType, setBrushType]   = useState('erase');  // 'erase' | 'restore'
    const [brushShape, setBrushShape] = useState('round');  // 'round' | 'h' | 'v'
    const [brushSize, setBrushSize]   = useState(24);
    const [brushZoom, setBrushZoom]   = useState(1);
    const [baseScale, setBaseScale]   = useState(1);        // scale so image fits 340px at zoom=1
    const [canvasDims, setCanvasDims] = useState({ w: 0, h: 0 });
    const [cursorPos, setCursorPos]   = useState(null);     // {x,y} relative to canvas el, display px

    const [confirming, setConfirming] = useState(false);

    // ── File load + EXIF ───────────────────────────────────────────────────────
    useEffect(() => {
        const url = URL.createObjectURL(file);
        originalUrl.current = url;
        setImageSrc(url);
        readExifRotation(file).then(deg => { if (deg) setRotation(deg); });
        let vivo = true;
        medirFoto(url)
            .then((m) => {
                if (!vivo) return;
                setMedidas(m);
                const problemas = revisarCalidad(m);
                setCalidad(problemas);
                // Automático en el catálogo: con fondo de UN color (blanco,
                // negro) o ya transparente, se limpia y encuadra al instante sin
                // modelo; con un fondo real (una mesa, una mano) corre el modelo
                // y después se encuadra. Una imagen que no se va a poder
                // guardar no gasta el modelo.
                if (producto && !problemas.some((p) => p.bloquea)) {
                    autoRef.current = m.fondoPlano ? 'limpiar' : 'fondo';
                    setAutoPaso(autoRef.current);
                }
            })
            .catch(() => { if (vivo) setRoto(true); });
        return () => { vivo = false; URL.revokeObjectURL(url); };
    }, [file, producto]);

    // Preload original img for restore brush (only once bg is removed)
    useEffect(() => {
        if (!bgRemoved || !originalUrl.current) return;
        const img = new Image();
        img.src = originalUrl.current;
        originalImgRef.current = img;
    }, [bgRemoved]);

    // Init brush canvas whenever entering brush mode
    useEffect(() => {
        if (!brushMode || !brushCanvasRef.current || !imageSrc) return;
        const canvas = brushCanvasRef.current;
        setBrushZoom(1);
        setCursorPos(null);
        const img = new Image();
        img.onload = () => {
            canvas.width  = img.naturalWidth;
            canvas.height = img.naturalHeight;
            // Scale so the image fits within the 340px canvas area at zoom=1
            const scale = (img.naturalWidth > 0 && img.naturalHeight > 0)
                ? Math.min(340 / img.naturalWidth, 340 / img.naturalHeight)
                : 1;
            setBaseScale(scale);
            setCanvasDims({ w: img.naturalWidth, h: img.naturalHeight });
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
        img.src = imageSrc;
    }, [brushMode]); // eslint-disable-line react-hooks/exhaustive-deps

    const onCropComplete = useCallback((_, pixels) => setCropPx(pixels), []);

    // ── Rotation ───────────────────────────────────────────────────────────────
    const rotateLeft  = () => { setRotation(r => (r - 90 + 360) % 360); setCrop({ x: 0, y: 0 }); setZoom(1); };
    const rotateRight = () => { setRotation(r => (r + 90) % 360);       setCrop({ x: 0, y: 0 }); setZoom(1); };

    // ── Encuadrar: el producto centrado con margen parejo ──────────────────────
    const encuadrar = async (src = imageSrc, limpiarFondo = false) => {
        setEncuadrando(true);
        setSinProducto(false);
        try {
            const url = await encuadrarProducto(src, { limpiarFondo });
            if (!url) { setSinProducto(true); return; }
            setImageSrc(prev => { if (prev !== originalUrl.current) URL.revokeObjectURL(prev); return url; });
            // Limpiar un fondo plano ES quitar el fondo: se marca, así el botón
            // dice «Fondo eliminado» y no invita a correr el modelo encima.
            if (limpiarFondo) setBgRemoved(true);
            setCrop({ x: 0, y: 0 });
            setZoom(1);
        } catch (err) {
            console.error('PhotoEditorModal: encuadrar falló', err);
            setSinProducto(true);
        } finally {
            setEncuadrando(false);
        }
    };

    // ── Remove background ──────────────────────────────────────────────────────
    const handleRemoveBg = async (src = imageSrc) => {
        if (bgRemoving || bgRemoved) return;
        setBgRemoving(true);
        setBgError(null);
        try {
            const resultBlob = producto
                ? await quitarFondo(src)
                : await (await import('@imgly/background-removal')).removeBackground(src, { model: 'small', output: { format: 'image/png', quality: 1 } });
            const newUrl = URL.createObjectURL(resultBlob);
            setImageSrc(prev => { if (prev !== originalUrl.current) URL.revokeObjectURL(prev); return newUrl; });
            setBgRemoved(true);
            setCrop({ x: 0, y: 0 });
            setZoom(1);
            if (producto) await encuadrar(newUrl);
        } catch (err) {
            console.error('PhotoEditorModal: quitar fondo falló', err);
            setBgError(navigator.onLine === false
                ? 'Sin conexión: la primera vez hay que descargar el modelo.'
                : err?.message === 'tardo'
                ? 'Tardó demasiado en esta computadora. Usa «Encuadrar producto» o una foto con fondo liso.'
                : 'No se pudo quitar el fondo en este navegador. Prueba «Encuadrar» o usa una foto con fondo blanco.');
        } finally {
            setBgRemoving(false);
        }
    };

    // Corre el paso automático una vez, cuando ya están declaradas las acciones.
    useEffect(() => {
        if (!autoPaso) return;
        setAutoPaso(null);
        if (autoPaso === 'limpiar') encuadrar(originalUrl.current, true);
        else handleRemoveBg(originalUrl.current);
    }, [autoPaso]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Reset to original ──────────────────────────────────────────────────────
    const handleReset = () => {
        if (imageSrc !== originalUrl.current) URL.revokeObjectURL(imageSrc);
        setImageSrc(originalUrl.current);
        setBgRemoved(false);
        setBgError(null);
        setSinProducto(false);
        autoRef.current = null;
        setBrushMode(false);
        setBrushZoom(1); setBaseScale(1); setCursorPos(null);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setRotation(0);
    };

    // ── Brush drawing ──────────────────────────────────────────────────────────
    // brushSize is in display pixels; r converts it to canvas pixels via scale.
    const drawBrush = useCallback((e) => {
        const canvas = brushCanvasRef.current;
        if (!canvas) return;
        const rect     = canvas.getBoundingClientRect();
        const clientX  = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY  = e.touches ? e.touches[0].clientY : e.clientY;
        const scaleX   = canvas.width  / rect.width;
        const scaleY   = canvas.height / rect.height;
        const x        = (clientX - rect.left) * scaleX;
        const y        = (clientY - rect.top)  * scaleY;
        const avgScale = (scaleX + scaleY) / 2;
        const r        = brushSize * avgScale; // canvas pixels

        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.beginPath();
        if (brushShape === 'round') {
            ctx.arc(x, y, r, 0, Math.PI * 2);
        } else if (brushShape === 'h') {
            // Horizontal stripe: 4:1 width:height ratio
            ctx.rect(x - r * 2, y - r * 0.5, r * 4, r);
        } else {
            // Vertical stripe: 1:4 width:height ratio
            ctx.rect(x - r * 0.5, y - r * 2, r, r * 4);
        }

        if (brushType === 'erase') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = 'rgba(0,0,0,1)';
            ctx.fill();
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.clip();
            if (originalImgRef.current) ctx.drawImage(originalImgRef.current, 0, 0, canvas.width, canvas.height);
        }
        ctx.restore();
    }, [brushType, brushSize, brushShape]);

    const onBrushStart = useCallback((e) => {
        e.preventDefault();
        isDrawingRef.current = true;
        drawBrush(e);
    }, [drawBrush]);

    const onBrushMove = useCallback((e) => {
        e.preventDefault();
        // Update live cursor position for preview
        const canvas = brushCanvasRef.current;
        if (canvas) {
            const rect    = canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            setCursorPos({ x: clientX - rect.left, y: clientY - rect.top });
        }
        if (!isDrawingRef.current) return;
        drawBrush(e);
    }, [drawBrush]);

    const onBrushEnd   = useCallback(() => { isDrawingRef.current = false; }, []);
    const onBrushLeave = useCallback(() => { isDrawingRef.current = false; setCursorPos(null); }, []);

    // ── Brush zoom ─────────────────────────────────────────────────────────────
    const handleZoomIn = () => {
        setBrushZoom(z => { const i = ZOOM_LEVELS.indexOf(z); return i < ZOOM_LEVELS.length - 1 ? ZOOM_LEVELS[i + 1] : z; });
        setCursorPos(null);
    };
    const handleZoomOut = () => {
        setBrushZoom(z => { const i = ZOOM_LEVELS.indexOf(z); return i > 0 ? ZOOM_LEVELS[i - 1] : z; });
        setCursorPos(null);
    };

    // ── Exit brush mode (commit canvas → new imageSrc) ─────────────────────────
    const exitBrushMode = () => {
        const canvas = brushCanvasRef.current;
        setBrushZoom(1); setBaseScale(1); setCursorPos(null);
        if (!canvas) { setBrushMode(false); return; }
        canvas.toBlob(blob => {
            if (blob) {
                const newUrl = URL.createObjectURL(blob);
                setImageSrc(prev => { if (prev !== originalUrl.current) URL.revokeObjectURL(prev); return newUrl; });
            }
            setBrushMode(false);
        }, 'image/png', 1);
    };

    // ── Confirm final crop ─────────────────────────────────────────────────────
    const handleConfirm = async () => {
        if (!cropPx || confirming) return;
        setConfirming(true);
        try {
            const blob = await getCroppedBlob(imageSrc, cropPx, rotation);
            onConfirm(blob);
        } catch {
            setConfirming(false);
        }
    };

    if (!imageSrc) return null;

    const bloquea = producto && calidad?.some((p) => p.bloquea);

    if (roto) {
        return (
            <ModalShell open onClose={onCancel} maxWidthClass="max-w-md" zClass="z-confirm" ariaLabel="La imagen no se pudo abrir">
                <div className="p-6 flex flex-col items-center text-center gap-3">
                    <ImageOff size={28} className="text-danger-text" />
                    <p className="text-body-lg font-black text-content">La imagen no se pudo abrir</p>
                    <p className="text-body-sm text-content-2">
                        El archivo está dañado o no es una imagen. Si la copiaste de internet, ábrela en su página y copia la imagen grande, no la miniatura.
                    </p>
                    <Button variant="secondary" onClick={onCancel}>Cerrar</Button>
                </div>
            </ModalShell>
        );
    }

    // ── Canvas CSS dimensions ──
    // baseScale shrinks the canvas so it fits 340px at zoom=1.
    // brushZoom multiplies from that base. Canvas pixel size never changes (only CSS size).
    const cW = canvasDims.w ? Math.round(canvasDims.w * baseScale * brushZoom) : undefined;
    const cH = canvasDims.h ? Math.round(canvasDims.h * baseScale * brushZoom) : undefined;

    // 2026-07-29: montaba su propio portal sin `role="dialog"`, sin
    // `aria-modal` y sin Escape. Pasa a `ModalShell` como los demás, con una
    // diferencia deliberada: `closeOnBackdrop={false}`. Acá un clic afuera
    // tiraría un recorte a medias sin preguntar, y el modal ya tiene dos
    // salidas explícitas (la X del encabezado y "Cancelar").
    return (
        // ── En el teléfono, PANTALLA COMPLETA (2026-07-30) ────────────────
        // No es una hoja y no debería serlo: recortar necesita ÁREA. Cuanto más
        // grande la foto, más preciso el gesto de encuadre, y una hoja le quita
        // la mitad de la pantalla justo a lo único que importa acá. Es el caso
        // donde el canónico de hoja sería peor, no mejor — pero el panel de
        // escritorio metido en un teléfono tampoco servía.
        //
        // `hojaEnTactil={false}` evita la conversión a hoja, y `max-w-none` con
        // `h-dvh` toma la pantalla. En escritorio se queda como estaba.
        <ModalShell
            open
            onClose={onCancel}
            maxWidthClass={enTactil ? 'max-w-none' : 'max-w-md'}
            hojaEnTactil={false}
            zClass="z-confirm"
            closeOnBackdrop={false}
            panelClassName={`flex flex-col overflow-hidden ${enTactil ? 'h-dvh' : ''}`}
            ariaLabel={brushMode ? 'Retocar fondo' : 'Editar foto'}
        >
            <>

                {/* ── Header ── */}
                <div className={`flex items-center justify-between px-5 border-b border-divider shrink-0
                    ${enTactil ? 'pt-[max(16px,var(--sa-top))] pb-4' : 'py-4'}`}>
                    <div>
                        <p className="text-body-lg font-black text-content">
                            {brushMode ? 'Retocar fondo' : 'Editar foto'}
                        </p>
                        <p className="text-label text-content-3 mt-0.5">
                            {brushMode
                                ? 'Pinta para borrar o restaurar áreas · usa zoom para precisión'
                                : medidas ? `Original ${medidas.ancho}×${medidas.alto} px · ajusta el encuadre` : 'Ajusta el encuadre y aplica ediciones'}
                        </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={brushMode ? exitBrushMode : onCancel}>{brushMode ? <ChevronLeft size={16} strokeWidth={2.5} /> : <X size={16} strokeWidth={2.5} />}</Button>
                </div>

                {/* ── Canvas / Crop area ── */}
                <div
                    className="relative shrink-0"
                    style={{
                        height: 340,
                        overflow: brushMode ? 'auto' : 'hidden',
                        ...(brushMode ? CHECKER : {}),
                    }}
                >
                    {brushMode ? (
                        /* Scrollable brush canvas with zoom */
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: '100%',
                            minHeight: '100%',
                            width: 'max-content',
                            height: 'max-content',
                        }}>
                            {/* Canvas wrapper — position:relative anchors the cursor preview */}
                            <div style={{ position: 'relative', lineHeight: 0 }}>
                                <canvas
                                    ref={brushCanvasRef}
                                    style={{
                                        display: 'block',
                                        cursor: 'none',
                                        touchAction: 'none',
                                        ...(cW ? { width: cW, height: cH, maxWidth: 'none' }
                                              : { maxWidth: '100%', maxHeight: 340 }),
                                    }}
                                    onMouseDown={onBrushStart}
                                    onMouseMove={onBrushMove}
                                    onMouseUp={onBrushEnd}
                                    onMouseLeave={onBrushLeave}
                                    onTouchStart={onBrushStart}
                                    onTouchMove={onBrushMove}
                                    onTouchEnd={onBrushEnd}
                                />
                                {cursorPos && (
                                    <BrushCursor
                                        pos={cursorPos}
                                        shape={brushShape}
                                        size={brushSize}
                                        type={brushType}
                                    />
                                )}
                            </div>
                        </div>
                    ) : (
                        <>
                            <div
                                // En el catálogo, sin fondo se ve sobre BLANCO: es como se
                                // guarda y como sale en la app. Sobre oscuro parecía que
                                // el fondo seguía ahí (reportado el 2026-10-30).
                                className={`absolute inset-0 ${bgRemoved ? (producto ? 'bg-[#fff]' : '') : 'bg-[#111]'}`}
                                style={bgRemoved && !producto ? CHECKER : undefined}
                            />
                            <Cropper
                                image={imageSrc}
                                crop={crop}
                                zoom={zoom}
                                rotation={rotation}
                                aspect={1}
                                onCropChange={setCrop}
                                onZoomChange={setZoom}
                                onCropComplete={onCropComplete}
                                style={{ containerStyle: { background: 'transparent' } }}
                            />
                        </>
                    )}
                </div>

                {/* ── Controls ── */}
                <div className="px-5 py-4 flex flex-col gap-3 shrink-0">
                    {brushMode ? (
                        <>
                            {/* Row 1: Erase / Restore + Listo */}
                            <div className="flex items-center gap-2">
                                <div className="flex rounded-2xl border border-divider p-0.5 gap-0.5">
                                    <button
                                        onClick={() => setBrushType('erase')}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-label font-bold transition-all ${
                                            brushType === 'erase' ? 'bg-chart-8-solid text-white' : 'text-content-3 hover:text-content-2'
                                        }`}>
                                        <Eraser size={11} strokeWidth={2} /> Borrar
                                    </button>
                                    <button
                                        onClick={() => setBrushType('restore')}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-label font-bold transition-all ${
                                            brushType === 'restore' ? 'bg-brand text-white' : 'text-content-3 hover:text-content-2'
                                        }`}>
                                        <Paintbrush size={11} strokeWidth={2} /> Restaurar
                                    </button>
                                </div>
                                <Button tone="success" icon={Check} onClick={exitBrushMode}>Listo</Button>
                            </div>

                            {/* Row 2: Brush shape + Zoom */}
                            <div className="flex items-center gap-3">

                                {/* Shape selector */}
                                <span className="text-caption font-bold text-content-3 shrink-0">Forma</span>
                                <div className="flex rounded-xl border border-divider p-0.5 gap-0.5">
                                    {/* Round */}
                                    <button
                                        onClick={() => setBrushShape('round')}
                                        title="Redonda"
                                        className={`w-8 h-7 flex items-center justify-center rounded-lg transition-all ${
                                            brushShape === 'round' ? 'bg-chart-8-solid text-white' : 'text-content-3 hover:text-content-2'
                                        }`}>
                                        <span style={{
                                            display: 'inline-block', width: 9, height: 9,
                                            borderRadius: '50%', background: 'currentColor',
                                        }} />
                                    </button>
                                    {/* Horizontal */}
                                    <button
                                        onClick={() => setBrushShape('h')}
                                        title="Recta horizontal"
                                        className={`w-8 h-7 flex items-center justify-center rounded-lg transition-all ${
                                            brushShape === 'h' ? 'bg-chart-8-solid text-white' : 'text-content-3 hover:text-content-2'
                                        }`}>
                                        <span style={{
                                            display: 'inline-block', width: 16, height: 3,
                                            background: 'currentColor', borderRadius: 1.5,
                                        }} />
                                    </button>
                                    {/* Vertical */}
                                    <button
                                        onClick={() => setBrushShape('v')}
                                        title="Recta vertical"
                                        className={`w-8 h-7 flex items-center justify-center rounded-lg transition-all ${
                                            brushShape === 'v' ? 'bg-chart-8-solid text-white' : 'text-content-3 hover:text-content-2'
                                        }`}>
                                        <span style={{
                                            display: 'inline-block', width: 3, height: 16,
                                            background: 'currentColor', borderRadius: 1.5,
                                        }} />
                                    </button>
                                </div>

                                {/* Zoom */}
                                <div className="ml-auto flex items-center gap-1">
                                    <span className="text-caption font-bold text-content-3 shrink-0 mr-1">Zoom</span>
                                    <Button variant="secondary" size="xs" icon={Minus} disabled={brushZoom === ZOOM_LEVELS[0]} iconOnly onClick={handleZoomOut} />
                                    <span className="text-label font-black text-content-2 w-8 text-center tabular-nums">
                                        {brushZoom}×
                                    </span>
                                    <Button variant="secondary" size="xs" icon={Plus} disabled={brushZoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} iconOnly onClick={handleZoomIn} />
                                </div>
                            </div>

                            {/* Row 3: Brush size slider */}
                            <div className="flex items-center gap-3">
                                <span className="shrink-0 rounded-full bg-content-3 block" style={{ width: 6, height: 6 }} />
                                <input
                                    type="range" min={6} max={60} step={1}
                                    value={brushSize}
                                    onChange={e => setBrushSize(Number(e.target.value))}
                                    className="flex-1 accent-brand cursor-pointer"
                                />
                                <span
                                    className="shrink-0 rounded-full bg-content-3 block"
                                    style={{ width: Math.max(8, brushSize * 0.5), height: Math.max(8, brushSize * 0.5) }}
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Zoom slider */}
                            <div className="flex items-center gap-2.5">
                                <ZoomOut size={13} className="text-content-3 shrink-0" />
                                <input
                                    type="range" min={1} max={3} step={0.01}
                                    value={zoom}
                                    onChange={e => setZoom(Number(e.target.value))}
                                    className="flex-1 accent-brand cursor-pointer"
                                />
                                <ZoomIn size={13} className="text-content-3 shrink-0" />
                            </div>

                            {/* Rotation */}
                            <div className="flex items-center gap-2">
                                <span className="text-caption font-bold text-content-3 shrink-0">Rotar</span>
                                <Button variant="secondary" icon={RotateCcw} onClick={rotateLeft}>90° izq</Button>
                                <Button variant="secondary" icon={RotateCw} onClick={rotateRight}>90° der</Button>
                                {rotation !== 0 && (
                                    <span className="ml-auto text-caption font-bold text-brand-text">{rotation}°</span>
                                )}
                            </div>

                            {/* Background removal */}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleRemoveBg()}
                                    disabled={bgRemoving || bgRemoved}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl text-body-sm font-bold transition-all border ${
                                        bgRemoved
                                            ? 'bg-success/10 text-success border-success/30 cursor-default'
                                            : bgRemoving
                                                ? 'bg-surface-card-hover text-content-3 border-divider cursor-wait'
                                                : bgError
                                                    ? 'bg-danger/10 text-danger border-danger/30 hover:bg-danger/20'
                                                    : 'bg-surface-card-hover text-content-2 border-divider hover:bg-chart-3/10 hover:text-chart-3-text hover:border-chart-3/30'
                                    }`}>
                                    {bgRemoving
                                        ? <><Loader2 size={13} className="animate-spin" /> Procesando…</>
                                        : bgRemoved
                                            ? <><Check size={13} /> Fondo eliminado</>
                                            : bgError
                                                ? 'Reintentar quitar fondo'
                                                : <><Scissors size={13} /> Quitar fondo</>}
                                </button>

                                {bgRemoved && (
                                    <Button tone="chart-3" icon={Paintbrush} title="Retocar bordes del fondo con pincel" onClick={() => setBrushMode(true)}>Retocar</Button>
                                )}

                                {bgRemoved && (
                                    <Button variant="secondary" icon={RotateCcw} title="Restaurar imagen original" iconOnly onClick={handleReset} />
                                )}
                            </div>

                            {producto && (
                                <Button variant="secondary" icon={encuadrando ? Loader2 : Focus} disabled={encuadrando || bgRemoving}
                                    title="Recorta el producto y lo centra con el mismo margen que las demás fotos" onClick={() => encuadrar(imageSrc, !bgRemoved && !!medidas?.fondoPlano)}>
                                    {encuadrando ? 'Encuadrando…' : 'Encuadrar producto'}
                                </Button>
                            )}
                            {bgError && <Notice variant="danger" compact>{bgError}</Notice>}
                            {sinProducto && <Notice variant="warning" compact>No se distingue el producto del fondo: encuádralo a mano con el zoom.</Notice>}
                            {producto && calidad?.map((p) => (
                                <Notice key={p.clave} variant={p.bloquea ? 'danger' : 'warning'} compact>{p.texto}</Notice>
                            ))}

                            {bgRemoving && (
                                <p className="text-caption text-content-3 text-center -mt-1">
                                    Quitando el fondo… la primera vez en esta computadora tarda más.
                                </p>
                            )}
                        </>
                    )}
                </div>

                {/* ── Footer — only in crop mode ── */}
                {!brushMode && (
                    <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-divider shrink-0">
                        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
                        <Button disabled={confirming || !cropPx || bloquea} onClick={handleConfirm}>{confirming
                                ? <><Loader2 size={12} className="animate-spin" /> Guardando…</>
                                : 'Guardar foto'}</Button>
                    </div>
                )}
            </>
        </ModalShell>
    );
}
