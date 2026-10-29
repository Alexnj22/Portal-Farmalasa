import CanonSwitch from '../common/Switch';
import React, { useState, useEffect } from 'react';
import FileField from '../common/FileField';
import PortalInput from '../common/PortalInput';

// eslint-disable-next-line react-refresh/only-export-components -- este archivo ya mezcla constantes/helpers con un componente (LazyInput); solo afecta Fast Refresh en dev
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
// ⌨️ LAZY INPUT — `PortalInput` con estado local
// ============================================================================
// `LazyInput` es el canónico `PortalInput` con una sola cosa propia: el estado
// local que evita re-renderizar el formulario entero en cada tecla (escribe al
// salir del campo). Todo lo demás —etiqueta asociada, «Requerido», borde de
// error, superficie y alto— lo dibuja el canónico.
//
// 2026-10-29: la etiqueta se escribía AFUERA, con un `<label>` sin `htmlFor`
// (hacer clic en «Teléfono fijo» no enfocaba nada), y cada llamador le pisaba
// la caja con `!bg-…`, `h-[40px]`/`h-[42px]`, sombras y bordes propios — por
// eso en Configuración general los campos medían distinto que los selects de
// al lado. Ahora `label` viaja al canónico y no se le pasan clases de caja.
//
// El valor se pasa SIEMPRE como texto: el canónico decide «Requerido» con
// `value?.trim()`, y un número (la mensualidad del alquiler) ahí revienta.
export const LazyInput = ({ value, onChange, placeholder, required, pattern, minLength, maxLength, type = "text", icon: Icon, ariaLabel, maskType, inputMode,
    label, name, hasError, errorMessage, labelAction, inputClassName = '', className = '' }) => {
    const aTexto = (v) => (v === null || v === undefined ? '' : String(v));
    const [localValue, setLocalValue] = useState(aTexto(value));

    useEffect(() => { setLocalValue(aTexto(value)); }, [value]); // eslint-disable-line react-hooks/set-state-in-effect -- sincroniza el input local con el prop controlado

    return (
        <PortalInput
            type={type}
            // `maskType` viaja hasta el canónico porque la mensualidad de un
            // alquiler es dinero: sin él el campo era `type="number"` y el
            // separador decimal lo decidía el idioma de cada computadora.
            maskType={maskType}
            inputMode={inputMode}
            icon={Icon}
            label={label}
            name={name}
            labelAction={labelAction}
            hasError={hasError}
            errorMessage={errorMessage}
            aria-label={label ? undefined : (ariaLabel ?? placeholder)}
            required={required}
            pattern={pattern}
            minLength={minLength}
            maxLength={maxLength}
            placeholder={placeholder}
            inputClassName={inputClassName}
            className={className}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={() => onChange(localValue)}
        />
    );
};

// ============================================================================
// 🗂️ SECCIÓN DE UN FORMULARIO DE SUCURSAL
// ============================================================================
// Las «islas» de los formularios de sucursal eran tarjetas a mano
// (`bg-surface-card rounded-3xl border … shadow-…`), con el lift de una
// tarjeta que se abre aunque no abrían nada, y un `transform`/`will-change`
// permanente encima (el «GPU lock») que convertía cada isla en raíz de fondo:
// el vidrio de adentro dejaba de desenfocar. La superficie va por
// `data-surface="card"` —dentro del modal se aplana sola (DESIGN §1.5)— y el
// encabezado es uno solo para los cinco formularios.
const TONOS_DE_SECCION = {
    brand: 'bg-brand/10 text-brand-text',
    success: 'bg-success/10 text-success-text',
    warning: 'bg-warning/10 text-warning-text',
    danger: 'bg-danger/10 text-danger-text',
    'chart-3': 'bg-chart-3/10 text-chart-3-text',
    'chart-4': 'bg-chart-4/10 text-chart-4-text',
    'chart-9': 'bg-chart-9/10 text-chart-9-text',
};

export const SeccionDeFormulario = ({ icon: Icon, titulo, subtitulo, tono = 'brand', accion, className = '', children }) => (
    <section data-surface="card" className={`p-5 flex flex-col ${className}`}>
        <header className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
                {Icon && (
                    <span aria-hidden="true" className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${TONOS_DE_SECCION[tono] || TONOS_DE_SECCION.brand}`}>
                        <Icon size={16} strokeWidth={2.5} />
                    </span>
                )}
                <div className="min-w-0">
                    <h4 className="text-caption font-black uppercase tracking-widest text-content">{titulo}</h4>
                    {subtitulo && <p className="text-label text-content-3 mt-0.5">{subtitulo}</p>}
                </div>
            </div>
            {accion}
        </header>
        <div className="flex flex-col gap-4 flex-1">{children}</div>
    </section>
);
