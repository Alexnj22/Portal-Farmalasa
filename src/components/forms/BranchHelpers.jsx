import CanonSwitch from '../common/Switch';
import React, { useState, useEffect } from 'react';
import FileField from '../common/FileField';

// eslint-disable-next-line react-refresh/only-export-components -- este archivo ya mezcla constantes/helpers con un componente (LazyInput); solo afecta Fast Refresh en dev
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

// eslint-disable-next-line react-refresh/only-export-components
export const clampInt = (v, min, max) => {
    const n = parseInt(String(v ?? ''), 10);
    if (Number.isNaN(n)) return null;
    return Math.max(min, Math.min(max, n));
};

// eslint-disable-next-line react-refresh/only-export-components
export const formatPhoneMask = (value) => {
    if (!value) return '';
    const cleaned = value.replace(/\D/g, '').substring(0, 8);
    const match = cleaned.match(/^(\d{0,4})(\d{0,4})$/);
    if (match) {
        return !match[2] ? match[1] : `${match[1]}-${match[2]}`;
    }
    return value;
};

// eslint-disable-next-line react-refresh/only-export-components
export const safeParse = (obj) => {
    if (typeof obj === 'string') {
        try { return JSON.parse(obj); } catch { return {}; }
    }
    return obj || {};
};

// ============================================================================
// 🔘 SWITCH — alias del canónico (A14, 2026-07-27)
// ============================================================================
// Esto ERA un switch propio, y era uno de los tres que competían en el
// proyecto (los otros: PermissionsView.Toggle y FormPlanificador.Switch).
// Se conserva el nombre y la firma `on`/`onToggle` porque lo importan 5 call
// sites en 3 archivos; el cuerpo ahora es el canónico.
export const Switch = ({ on, onToggle, disabled, label }) => (
    <CanonSwitch checked={!!on} onChange={onToggle} disabled={disabled} label={label} size="lg" />
);

// ============================================================================
// ☁️ UPLOADER LIQUIDGLASS (Diseño de Botón Elevado)
// ============================================================================
export const FileUploader = ({ label, file, url, onChange }) => (
    // Envoltorio delgado sobre el canónico `FileField` (decisión 2c,
    // 2026-07-27). Se conserva el nombre porque lo consumen 9 sitios y
    // renombrarlos no aporta nada; lo que cambia es que ahora es UNA fila con
    // arrastre, y no la novena variante de "subir un archivo".
    //
    // `emptyState="pending"` mantiene el naranja del estado vacío: acá un
    // documento faltante es un requisito legal sin cumplir, no un campo
    // opcional en blanco.
    <FileField
        label={label}
        file={file}
        url={url}
        onChange={onChange}
        accept="application/pdf,image/*"
        emptyState="pending"
        className="mt-2"
    />
);

// ============================================================================
// ⌨️ LAZY INPUT LIQUIDGLASS (Reacciona al Focus como los modales)
// ============================================================================
export const LazyInput = ({ value, onChange, className = "", placeholder, required, pattern, minLength, maxLength, type = "text", icon: Icon, ariaLabel }) => {
    const [localValue, setLocalValue] = useState(value || '');
    
    useEffect(() => { setLocalValue(value || ''); }, [value]); // eslint-disable-line react-hooks/set-state-in-effect -- sincroniza el input local con el prop controlado

    return (
        <div className="relative group flex items-center w-full">
            {Icon && (
                <div className="absolute left-4 z-base w-8 h-8 rounded-xl bg-surface-card flex items-center justify-center text-content-3 shadow-[var(--shadow-elevation-xs)] transition-colors duration-300 group-focus-within:text-brand-text group-focus-within:bg-chart-1/10 pointer-events-none">
                    <Icon size={16} strokeWidth={2.5}/>
                </div>
            )}
            <input
                type={type}
                aria-label={ariaLabel ?? placeholder}
                required={required}
                pattern={pattern}
                minLength={minLength}
                maxLength={maxLength}
                // 🚨 Fusión de la clase enviada (className) con la estética base Liquidglass
                className={`w-full py-3.5 bg-surface-card border border-border-card rounded-2xl text-body-xl font-bold text-content-2 placeholder-content-3 outline-none transition-all duration-300 shadow-[var(--shadow-shine-lg)] focus:bg-surface-card focus:border-brand/30 focus:shadow-[var(--shadow-ring-brand)] ${Icon ? 'pl-14 pr-4' : 'px-4'} ${className}`}
                placeholder={placeholder}
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={(e) => onChange(e.target.value)}
            />
        </div>
    );
};