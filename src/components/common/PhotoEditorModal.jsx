import React, { useState, useCallback, useRef, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import { createPortal } from 'react-dom';
import {
    X, ZoomIn, ZoomOut, Scissors, Loader2, Check,
    RotateCcw, RotateCw, Eraser, Paintbrush, ChevronLeft,
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

    // Draw rotated image onto intermediate canvas
    const rotCanvas = document.createElement('canvas');
    rotCanvas.width  = bBoxW;
    rotCanvas.height = bBoxH;
    const rotCtx = rotCanvas.getContext('2d');
    rotCtx.translate(bBoxW / 2, bBoxH / 2);
    rotCtx.rotate(rad);
    rotCtx.translate(-img.width / 2, -img.height / 2);
    rotCtx.drawImage(img, 0, 0);

    // Crop from rotated canvas
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
                        // Check 'Exif\0\0'
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

// ── Checkerboard background (indicates transparent areas) ─────────────────────
const CHECKER = {
    backgroundImage: 'repeating-conic-gradient(#d0d0d0 0% 25%, #f8f8f8 0% 50%)',
    backgroundSize: '18px 18px',
};

// ── PhotoEditorModal ───────────────────────────────────────────────────────────
export default function PhotoEditorModal({ file, onConfirm, onCancel }) {
    const originalUrl    = useRef(null);
    const originalImgRef = useRef(null); // preloaded img element for brush restore
    const brushCanvasRef = useRef(null);
    const isDrawingRef   = useRef(false);

    const [imageSrc, setImageSrc]     = useState(null);
    const [crop, setCrop]             = useState({ x: 0, y: 0 });
    const [zoom, setZoom]             = useState(1);
    const [cropPx, setCropPx]         = useState(null);
    const [rotation, setRotation]     = useState(0);

    const [bgRemoving, setBgRemoving] = useState(false);
    const [bgRemoved, setBgRemoved]   = useState(false);
    const [bgError, setBgError]       = useState(false);

    const [brushMode, setBrushMode]   = useState(false);
    const [brushType, setBrushType]   = useState('erase'); // 'erase' | 'restore'
    const [brushSize, setBrushSize]   = useState(24);

    const [confirming, setConfirming] = useState(false);

    // Load file → object URL; auto-detect EXIF rotation for phones
    useEffect(() => {
        const url = URL.createObjectURL(file);
        originalUrl.current = url;
        setImageSrc(url);
        readExifRotation(file).then(deg => { if (deg) setRotation(deg); });
        return () => { URL.revokeObjectURL(url); };
    }, [file]);

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
        const img = new Image();
        img.onload = () => {
            canvas.width  = img.naturalWidth;
            canvas.height = img.naturalHeight;
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

    // ── Remove background ──────────────────────────────────────────────────────
    const handleRemoveBg = async () => {
        if (bgRemoving || bgRemoved) return;
        setBgRemoving(true);
        setBgError(false);
        try {
            const { removeBackground } = await import('@imgly/background-removal');
            const resultBlob = await removeBackground(imageSrc, {
                model: 'small',
                output: { format: 'image/png', quality: 1 },
            });
            const newUrl = URL.createObjectURL(resultBlob);
            setImageSrc(prev => { if (prev !== originalUrl.current) URL.revokeObjectURL(prev); return newUrl; });
            setBgRemoved(true);
            setCrop({ x: 0, y: 0 });
            setZoom(1);
        } catch {
            setBgError(true);
        } finally {
            setBgRemoving(false);
        }
    };

    // ── Reset to original ──────────────────────────────────────────────────────
    const handleReset = () => {
        if (imageSrc !== originalUrl.current) URL.revokeObjectURL(imageSrc);
        setImageSrc(originalUrl.current);
        setBgRemoved(false);
        setBgError(false);
        setBrushMode(false);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setRotation(0);
    };

    // ── Brush painting ─────────────────────────────────────────────────────────
    const drawBrush = useCallback((e) => {
        const canvas = brushCanvasRef.current;
        if (!canvas) return;
        const rect    = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const scaleX  = canvas.width  / rect.width;
        const scaleY  = canvas.height / rect.height;
        const x       = (clientX - rect.left) * scaleX;
        const y       = (clientY - rect.top)  * scaleY;
        const radius  = brushSize * ((scaleX + scaleY) / 2);

        const ctx = canvas.getContext('2d');
        ctx.save();
        if (brushType === 'erase') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,1)';
            ctx.fill();
        } else {
            // Restore: clip to circle, paste original pixels
            ctx.globalCompositeOperation = 'source-over';
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.clip();
            if (originalImgRef.current) {
                ctx.drawImage(originalImgRef.current, 0, 0, canvas.width, canvas.height);
            }
        }
        ctx.restore();
    }, [brushType, brushSize]);

    const onBrushStart = useCallback((e) => {
        e.preventDefault();
        isDrawingRef.current = true;
        drawBrush(e);
    }, [drawBrush]);

    const onBrushMove = useCallback((e) => {
        e.preventDefault();
        if (!isDrawingRef.current) return;
        drawBrush(e);
    }, [drawBrush]);

    const onBrushEnd = useCallback(() => { isDrawingRef.current = false; }, []);

    const exitBrushMode = () => {
        const canvas = brushCanvasRef.current;
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

    return createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
                    <div>
                        <p className="text-[14px] font-black text-slate-800">
                            {brushMode ? 'Retocar fondo' : 'Editar foto'}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                            {brushMode
                                ? 'Pinta para borrar o restaurar áreas del fondo'
                                : 'Ajusta el encuadre y aplica ediciones'}
                        </p>
                    </div>
                    <button
                        onClick={brushMode ? exitBrushMode : onCancel}
                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                        {brushMode ? <ChevronLeft size={16} strokeWidth={2.5} /> : <X size={16} strokeWidth={2.5} />}
                    </button>
                </div>

                {/* Crop / Brush area */}
                <div className="relative shrink-0 flex items-center justify-center overflow-hidden" style={{ height: 340, background: brushMode ? undefined : undefined }}>
                    {brushMode ? (
                        <>
                            <div className="absolute inset-0" style={CHECKER} />
                            <canvas
                                ref={brushCanvasRef}
                                style={{ maxWidth: '100%', maxHeight: '340px', position: 'relative', cursor: 'crosshair', touchAction: 'none', display: 'block' }}
                                onMouseDown={onBrushStart}
                                onMouseMove={onBrushMove}
                                onMouseUp={onBrushEnd}
                                onMouseLeave={onBrushEnd}
                                onTouchStart={onBrushStart}
                                onTouchMove={onBrushMove}
                                onTouchEnd={onBrushEnd}
                            />
                        </>
                    ) : (
                        <>
                            <div className={`absolute inset-0 ${bgRemoved ? '' : 'bg-[#111]'}`} style={bgRemoved ? CHECKER : undefined} />
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

                {/* Controls */}
                <div className="px-5 py-4 flex flex-col gap-3 shrink-0">
                    {brushMode ? (
                        <>
                            {/* Brush type + done */}
                            <div className="flex items-center gap-2">
                                <div className="flex rounded-2xl border border-slate-200 p-0.5 gap-0.5">
                                    <button
                                        onClick={() => setBrushType('erase')}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                                            brushType === 'erase'
                                                ? 'bg-slate-800 text-white'
                                                : 'text-slate-500 hover:text-slate-700'
                                        }`}>
                                        <Eraser size={11} strokeWidth={2} /> Borrar
                                    </button>
                                    <button
                                        onClick={() => setBrushType('restore')}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                                            brushType === 'restore'
                                                ? 'bg-[#0052CC] text-white'
                                                : 'text-slate-500 hover:text-slate-700'
                                        }`}>
                                        <Paintbrush size={11} strokeWidth={2} /> Restaurar
                                    </button>
                                </div>
                                <button
                                    onClick={exitBrushMode}
                                    className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold hover:bg-emerald-100 transition-colors">
                                    <Check size={11} strokeWidth={2.5} /> Listo
                                </button>
                            </div>

                            {/* Brush size */}
                            <div className="flex items-center gap-3">
                                <span className="shrink-0 w-3 h-3 rounded-full bg-slate-300 block" style={{ width: 6, height: 6 }} />
                                <input
                                    type="range" min={6} max={60} step={1}
                                    value={brushSize}
                                    onChange={e => setBrushSize(Number(e.target.value))}
                                    className="flex-1 accent-[#0052CC] cursor-pointer"
                                />
                                <span
                                    className="shrink-0 rounded-full bg-slate-300 block"
                                    style={{ width: Math.max(8, brushSize * 0.5), height: Math.max(8, brushSize * 0.5) }}
                                />
                            </div>

                            <p className="text-[10px] text-slate-400 text-center -mt-1">
                                {brushType === 'erase' ? 'Pinta sobre el fondo para eliminarlo' : 'Pinta sobre áreas eliminadas para restaurarlas'}
                            </p>
                        </>
                    ) : (
                        <>
                            {/* Zoom */}
                            <div className="flex items-center gap-2.5">
                                <ZoomOut size={13} className="text-slate-400 shrink-0" />
                                <input
                                    type="range" min={1} max={3} step={0.01}
                                    value={zoom}
                                    onChange={e => setZoom(Number(e.target.value))}
                                    className="flex-1 accent-[#0052CC] cursor-pointer"
                                />
                                <ZoomIn size={13} className="text-slate-400 shrink-0" />
                            </div>

                            {/* Rotation */}
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-slate-400 shrink-0">Rotar</span>
                                <button onClick={rotateLeft}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                                    <RotateCcw size={11} strokeWidth={2.5} /> 90° izq
                                </button>
                                <button onClick={rotateRight}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                                    <RotateCw size={11} strokeWidth={2.5} /> 90° der
                                </button>
                                {rotation !== 0 && (
                                    <span className="ml-auto text-[10px] font-bold text-[#0052CC]">{rotation}°</span>
                                )}
                            </div>

                            {/* Background removal */}
                            <div className="flex gap-2">
                                <button
                                    onClick={handleRemoveBg}
                                    disabled={bgRemoving || bgRemoved}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl text-[12px] font-bold transition-all border ${
                                        bgRemoved
                                            ? 'bg-emerald-50 text-emerald-600 border-emerald-200 cursor-default'
                                            : bgRemoving
                                                ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-wait'
                                                : bgError
                                                    ? 'bg-red-50 text-red-500 border-red-200 hover:bg-red-100'
                                                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-violet-50 hover:text-violet-600 hover:border-violet-200'
                                    }`}>
                                    {bgRemoving
                                        ? <><Loader2 size={13} className="animate-spin" /> Procesando…</>
                                        : bgRemoved
                                            ? <><Check size={13} /> Fondo eliminado</>
                                            : bgError
                                                ? 'Error — intentar de nuevo'
                                                : <><Scissors size={13} /> Quitar fondo</>
                                    }
                                </button>

                                {bgRemoved && (
                                    <button
                                        onClick={() => setBrushMode(true)}
                                        title="Retocar bordes del fondo con pincel"
                                        className="flex items-center gap-1.5 px-3 rounded-2xl border border-violet-200 text-violet-600 hover:bg-violet-50 text-[11px] font-bold transition-all whitespace-nowrap">
                                        <Paintbrush size={12} /> Retocar
                                    </button>
                                )}

                                {bgRemoved && (
                                    <button
                                        onClick={handleReset}
                                        title="Restaurar imagen original"
                                        className="w-10 flex items-center justify-center rounded-2xl border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all">
                                        <RotateCcw size={13} strokeWidth={2.5} />
                                    </button>
                                )}
                            </div>

                            {bgRemoving && (
                                <p className="text-[10px] text-slate-400 text-center -mt-1">
                                    La primera vez descarga el modelo — puede tardar unos segundos.
                                </p>
                            )}
                        </>
                    )}
                </div>

                {/* Footer — only in crop mode */}
                {!brushMode && (
                    <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
                        <button onClick={onCancel}
                            className="px-4 py-2 rounded-full text-[12px] font-bold text-slate-500 hover:bg-slate-100 transition-colors">
                            Cancelar
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={confirming || !cropPx}
                            className="px-5 py-2 rounded-full text-[12px] font-bold text-white bg-[#0052CC] hover:bg-[#003D99] transition-colors disabled:opacity-50 flex items-center gap-2">
                            {confirming
                                ? <><Loader2 size={12} className="animate-spin" /> Guardando…</>
                                : 'Guardar foto'
                            }
                        </button>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
