import React, { memo } from 'react';
import { AlertCircle, Lock } from 'lucide-react';
import { inputHoverClass, applyInputMask } from '../../utils/inputStyles';

// Input estándar del portal: label uppercase + badge "Requerido"/error, icono
// izquierdo opcional, glow azul de marca al hover/focus, borde rojo cuando
// falta o es inválido. Todo formulario nuevo debe reusar este componente en
// vez de duplicar el estilo (ver memoria feedback_design_audit_means_full_pass).
const PortalInput = memo(({ icon: Icon, label, name, value, onChange, type = "text", placeholder, colSpan = 1, required = false, helperText, prefix, readOnly = false, maskType, hasError, errorMessage }) => {
    const handleInputChange = (e) => {
        let val = e.target.value;
        if (maskType) val = applyInputMask(val, maskType);
        e.target.value = val;
        onChange(e);
    };

    const isMissing = required && !value?.trim();
    const isInvalid = hasError || isMissing;
    const errorClasses = isInvalid ? 'outline outline-2 outline-danger/50' : '';
    const messageId = name ? `${name}-message` : undefined;

    return (
        <div className={`col-span-1 ${colSpan === 2 ? 'md:col-span-2' : ''}`}>
            <label htmlFor={name} className="text-[10px] font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between transition-colors">
                <span>{label} {helperText && <span className="text-[8px] text-brand ml-1">{helperText}</span>}</span>
                {isMissing && !hasError && <span id={messageId} className="text-danger font-bold bg-danger/10 px-2 py-0.5 rounded-md shadow-sm border border-danger/30">Requerido</span>}
                {hasError && errorMessage && <span id={messageId} className="text-danger font-bold bg-danger/15 px-2 py-0.5 rounded-md shadow-sm border border-danger/40 flex items-center gap-1"><AlertCircle size={10} /> {errorMessage}</span>}
            </label>
            <div data-surface="input" className={`relative flex items-center h-[40px] z-10 ${readOnly ? 'opacity-80 cursor-not-allowed' : `${inputHoverClass} ${errorClasses}`}`}>
                {Icon && <div className="absolute left-3 text-content-3"><Icon size={14} strokeWidth={2.5} /></div>}
                {prefix && <div className="absolute left-3 text-content-3 font-black text-[13px]">{prefix}</div>}
                <input
                    id={name}
                    type={type}
                    name={name}
                    value={value || ''}
                    onChange={handleInputChange}
                    placeholder={placeholder}
                    readOnly={readOnly}
                    disabled={readOnly}
                    required={required}
                    aria-required={required || undefined}
                    aria-invalid={isInvalid || undefined}
                    aria-describedby={isInvalid ? messageId : undefined}
                    className={`w-full h-full bg-transparent text-[16px] font-bold text-content outline-none ${Icon ? 'pl-9 pr-4' : prefix ? 'pl-8 pr-4' : 'px-4'}`}
                />
                {readOnly && <Lock size={12} className="absolute right-3 text-content-3" />}
            </div>
        </div>
    );
});

export default PortalInput;
