import CanonSwitch from '../common/Switch';
import React, { useState, useEffect } from 'react';
import FileField from '../common/FileField';
import PortalInput from '../common/PortalInput';

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
// `LazyInput` era `PortalInput` reconstruido: mismo campo, mismo ícono a la
// izquierda, misma superficie. Lo único propio es el estado local que evita
// re-renderizar el formulario entero en cada tecla — eso se queda; el resto lo
// dibuja el canónico (2026-07-28).
export const LazyInput = ({ value, onChange, className = "", placeholder, required, pattern, minLength, maxLength, type = "text", icon: Icon, ariaLabel, maskType, inputMode }) => {
    const [localValue, setLocalValue] = useState(value || '');

    useEffect(() => { setLocalValue(value || ''); }, [value]); // eslint-disable-line react-hooks/set-state-in-effect -- sincroniza el input local con el prop controlado

    return (
        <PortalInput
            type={type}
            // `maskType` viaja hasta el canónico porque la mensualidad de un
            // alquiler es dinero: sin él el campo era `type="number"` y el
            // separador decimal lo decidía el idioma de cada computadora.
            maskType={maskType}
            inputMode={inputMode}
            icon={Icon}
            aria-label={ariaLabel ?? placeholder}
            required={required}
            pattern={pattern}
            minLength={minLength}
            maxLength={maxLength}
            placeholder={placeholder}
            className={className}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={() => onChange(localValue)}
        />
    );
};