import React, { useRef, useState, useEffect } from 'react';
import { UploadCloud, CheckCircle2, Eye, X } from 'lucide-react';

export const EL_SALVADOR_GEO = {
    "Ahuachapán": ["Ahuachapán Norte", "Ahuachapán Centro", "Ahuachapán Sur"],
    "Santa Ana": ["Santa Ana Norte", "Santa Ana Centro", "Santa Ana Este", "Santa Ana Oeste"],
    "Sonsonate": ["Sonsonate Norte", "Sonsonate Centro", "Sonsonate Este", "Sonsonate Oeste"],
    "Chalatenango": ["Chalatenango Norte", "Chalatenango Centro", "Chalatenango Sur"],
    "La Libertad": ["La Libertad Norte", "La Libertad Centro", "La Libertad Oeste", "La Libertad Este", "La Libertad Sur", "La Libertad Costa"],
    "San Salvador": ["San Salvador Norte", "San Salvador Oeste", "San Salvador Este", "San Salvador Centro", "San Salvador Sur"],
    "Cuscatlán": ["Cuscatlán Norte", "Cuscatlán Sur"],
    "La Paz": ["La Paz Oeste", "La Paz Centro", "La Paz Este"],
    "Cabañas": ["Cabañas Este", "Cabañas Oeste"],
    "San Vicente": ["San Vicente Norte", "San Vicente Sur"],
    "Usulután": ["Usulután Norte", "Usulután Este", "Usulután Oeste"],
    "San Miguel": ["San Miguel Norte", "San Miguel Centro", "San Miguel Oeste"],
    "Morazán": ["Morazán Norte", "Morazán Sur"],
    "La Unión": ["La Unión Norte", "La Unión Sur"]
};

export const clampInt = (v, min, max) => {
    const n = parseInt(String(v ?? ''), 10);
    if (Number.isNaN(n)) return null;
    return Math.max(min, Math.min(max, n));
};

export const formatPhoneMask = (value) => {
    if (!value) return '';
    const cleaned = value.replace(/\D/g, '').substring(0, 8);
    const match = cleaned.match(/^(\d{0,4})(\d{0,4})$/);
    if (match) {
        return !match[2] ? match[1] : `${match[1]}-${match[2]}`;
    }
    return value;
};

export const safeParse = (obj) => {
    if (typeof obj === 'string') {
        try { return JSON.parse(obj); } catch (e) { return {}; }
    }
    return obj || {};
};

// ============================================================================
// 🔘 SWITCH LIQUIDGLASS (Más "Apple-like")
// ============================================================================
export const Switch = ({ on, onToggle }) => (
    <button
        type="button"
        onClick={onToggle}
        className={`relative inline-flex items-center flex-shrink-0 w-12 h-7 rounded-full transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#007AFF]/50 active:scale-95 transform-gpu ${
            on ? "bg-[#007AFF] border border-[#0066CC]" : "bg-slate-200/80 border border-slate-300"
        }`}
        aria-pressed={on}
    >
        <span
            className={`absolute top-[2px] left-[2px] w-[22px] h-[22px] rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.8)] transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] transform-gpu ${
                on ? "translate-x-5" : "translate-x-0"
            }`}
        />
    </button>
);

// ============================================================================
// ☁️ UPLOADER LIQUIDGLASS (Diseño de Botón Elevado)
// ============================================================================
export const FileUploader = ({ label, file, url, onChange }) => {
    const fileInputRef = useRef(null);
    const hasFile = !!file || !!url;

    const handleView = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (file) window.open(URL.createObjectURL(file), '_blank');
        else if (url) window.open(url, '_blank');
    };

    const handleClear = (e) => {
        e.preventDefault(); e.stopPropagation();
        onChange(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    return (
        <div className="mt-2 w-full">
            {label && <label className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 ml-1 mb-1.5 block">{label}</label>}
            
            <div className={`relative flex items-center gap-3 rounded-[1.25rem] p-2 transition-all duration-300 border transform-gpu ${
                !hasFile 
                    ? 'bg-amber-50/50 backdrop-blur-sm border-amber-200/60 shadow-[inset_0_2px_10px_rgba(255,255,255,0.6)] hover:bg-amber-50 hover:border-amber-300 hover:shadow-md cursor-pointer group' 
                    : 'bg-emerald-50 backdrop-blur-sm border-emerald-200 shadow-[inset_0_2px_10px_rgba(255,255,255,0.6)] hover:shadow-md'
            }`}
            onClick={() => !hasFile && fileInputRef.current?.click()}
            >
                {/* Ícono Izquierdo */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 shadow-sm ${
                    !hasFile ? 'bg-amber-100 text-amber-500 group-hover:scale-110 group-hover:bg-amber-500 group-hover:text-white' : 'bg-emerald-500 text-white shadow-emerald-500/30'
                }`}>
                    {!hasFile ? <UploadCloud size={18} strokeWidth={2.5}/> : <CheckCircle2 size={18} strokeWidth={2.5} />}
                </div>
                
                {/* Textos */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                    {file ? (
                        <><p className="text-[12px] text-emerald-700 font-bold truncate leading-none mb-1">{file.name}</p>
                        <p className="text-[9px] text-emerald-600/70 font-black uppercase tracking-widest leading-none">Archivo Listo</p></>
                    ) : url ? (
                        <><p className="text-[12px] text-emerald-700 font-bold truncate leading-none mb-1">Documento Guardado</p>
                        <p className="text-[9px] text-emerald-600/70 font-black uppercase tracking-widest leading-none">En el sistema</p></>
                    ) : (
                        <><p className="text-[11px] text-amber-700 font-bold leading-none mb-1">Documento Pendiente</p>
                        <p className="text-[9px] text-amber-600/80 font-black uppercase tracking-widest leading-none">Tocar para adjuntar</p></>
                    )}
                </div>

                {/* BOTONES DE ACCIÓN (Solo si hay archivo) */}
                {hasFile && (
                    <div className="flex items-center gap-1.5 pr-1 shrink-0">
                        <button type="button" onClick={handleView} className="w-8 h-8 flex items-center justify-center bg-white border border-emerald-200 rounded-lg text-emerald-600 shadow-sm hover:bg-emerald-500 hover:text-white hover:border-emerald-500 transition-all active:scale-95 z-20" title="Ver Documento">
                            <Eye size={16} strokeWidth={2.5} />
                        </button>
                        <button type="button" onClick={handleClear} className="w-8 h-8 flex items-center justify-center bg-white border border-red-200 rounded-lg text-red-500 shadow-sm hover:bg-red-500 hover:text-white hover:border-red-500 transition-all active:scale-95 z-20" title="Quitar Documento">
                            <X size={16} strokeWidth={2.5} />
                        </button>
                    </div>
                )}
                
                <input type="file" ref={fileInputRef} accept="application/pdf,image/*" className="hidden" onChange={(e) => onChange(e.target.files?.[0] || null)} />
            </div>
        </div>
    );
};

// ============================================================================
// ⌨️ LAZY INPUT LIQUIDGLASS (Reacciona al Focus como los modales)
// ============================================================================
export const LazyInput = ({ value, onChange, className = "", placeholder, required, pattern, minLength, maxLength, type = "text", icon: Icon }) => {
    const [localValue, setLocalValue] = useState(value || '');
    
    useEffect(() => { setLocalValue(value || ''); }, [value]);

    return (
        <div className="relative group flex items-center w-full">
            {Icon && (
                <div className="absolute left-4 z-10 w-8 h-8 rounded-xl bg-white/60 flex items-center justify-center text-slate-400 shadow-[0_2px_5px_rgba(0,0,0,0.02)] transition-colors duration-300 group-focus-within:text-[#007AFF] group-focus-within:bg-blue-50 pointer-events-none">
                    <Icon size={16} strokeWidth={2.5}/>
                </div>
            )}
            <input
                type={type}
                required={required}
                pattern={pattern}
                minLength={minLength}
                maxLength={maxLength}
                // 🚨 Fusión de la clase enviada (className) con la estética base Liquidglass
                className={`w-full py-3.5 bg-white/50 border border-white/60 rounded-[1.25rem] text-[13px] font-bold text-slate-700 placeholder-slate-400 outline-none transition-all duration-300 shadow-[inset_0_2px_10px_rgba(255,255,255,0.5)] focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] ${Icon ? 'pl-14 pr-4' : 'px-4'} ${className}`}
                placeholder={placeholder}
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={(e) => onChange(e.target.value)}
            />
        </div>
    );
};