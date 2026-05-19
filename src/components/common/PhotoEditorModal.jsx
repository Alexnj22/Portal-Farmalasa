import React, { useState, useCallback, useRef, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, Scissors, Loader2, Check, RotateCcw } from 'lucide-react';

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

async function getCroppedBlob(imageSrc, cropPx, withBgRemoved) {
    const img = await loadImage(imageSrc);
    const canvas = document.createElement('canvas');
    canvas.width  = cropPx.width;
    canvas.height = cropPx.height;
    const ctx = canvas.getContext('2d');

    // Always composite onto white so JPEG has no transparent gaps
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, cropPx.x, cropPx.y, cropPx.width, cropPx.height, 0, 0, cropPx.width, cropPx.height);

    return new Promise((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.88)
    );
}

// ── Checkerboard style (transparent-area indicator) ───────────────────────────
const CHECKER = {
    backgroundImage: 'repeating-conic-gradient(#d0d0d0 0% 25%, #f8f8f8 0% 50%)',
    backgroundSize: '18px 18px',
};

// ── PhotoEditorModal ───────────────────────────────────────────────────────────

export default function PhotoEditorModal({ file, onConfirm, onCancel }) {
    const originalUrl = useRef(null);

    const [imageSrc, setImageSrc]         = useState(null);
    const [crop, setCrop]                 = useState({ x: 0, y: 0 });
    const [zoom, setZoom]                 = useState(1);
    const [cropPx, setCropPx]             = useState(null);
    const [bgRemoving, setBgRemoving]     = useState(false);
    const [bgRemoved, setBgRemoved]       = useState(false);
    const [bgError, setBgError]           = useState(false);
    const [confirming, setConfirming]     = useState(false);

    // Load file → object URL on mount
    useEffect(() => {
        const url = URL.createObjectURL(file);
        originalUrl.current = url;
        setImageSrc(url);
        return () => { URL.revokeObjectURL(url); };
    }, [file]);

    const onCropComplete = useCallback((_, pixels) => setCropPx(pixels), []);

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
            setImageSrc(prev => {
                if (prev !== originalUrl.current) URL.revokeObjectURL(prev);
                return newUrl;
            });
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
        setCrop({ x: 0, y: 0 });
        setZoom(1);
    };

    // ── Confirm ────────────────────────────────────────────────────────────────
    const handleConfirm = async () => {
        if (!cropPx || confirming) return;
        setConfirming(true);
        try {
            const blob = await getCroppedBlob(imageSrc, cropPx, bgRemoved);
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
                        <p className="text-[14px] font-black text-slate-800">Editar foto</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Ajusta el encuadre y aplica ediciones</p>
                    </div>
                    <button onClick={onCancel}
                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                        <X size={16} strokeWidth={2.5} />
                    </button>
                </div>

                {/* Crop area */}
                <div className="relative shrink-0" style={{ height: 340 }}>
                    {/* Checkerboard shows behind Cropper when bg is removed */}
                    {bgRemoved && (
                        <div className="absolute inset-0" style={CHECKER} />
                    )}
                    {!bgRemoved && (
                        <div className="absolute inset-0 bg-[#111]" />
                    )}
                    <Cropper
                        image={imageSrc}
                        crop={crop}
                        zoom={zoom}
                        aspect={1}
                        onCropChange={setCrop}
                        onZoomChange={setZoom}
                        onCropComplete={onCropComplete}
                        style={{
                            containerStyle: { background: 'transparent' },
                        }}
                    />
                </div>

                {/* Controls */}
                <div className="px-5 py-4 flex flex-col gap-3 shrink-0">

                    {/* Zoom slider */}
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
                            }`}
                        >
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
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
                    <button onClick={onCancel}
                        className="px-4 py-2 rounded-full text-[12px] font-bold text-slate-500 hover:bg-slate-100 transition-colors">
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={confirming || !cropPx}
                        className="px-5 py-2 rounded-full text-[12px] font-bold text-white bg-[#0052CC] hover:bg-[#003D99] transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                        {confirming
                            ? <><Loader2 size={12} className="animate-spin" /> Guardando…</>
                            : 'Guardar foto'
                        }
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
