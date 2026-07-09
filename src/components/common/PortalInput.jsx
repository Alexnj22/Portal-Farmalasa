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

    const errorClasses = hasError || (required && !value?.trim()) ? '!border-red-400 !bg-red-50/50' : '';

    return (
        <div className={`col-span-1 ${colSpan === 2 ? 'md:col-span-2' : ''}`}>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between transition-colors">
                <span>{label} {helperText && <span className="text-[8px] text-[#0052CC] ml-1">{helperText}</span>}</span>
                {required && !value?.trim() && !hasError && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                {hasError && errorMessage && <span className="text-red-600 font-bold bg-red-100 px-2 py-0.5 rounded-md shadow-sm border border-red-300 flex items-center gap-1"><AlertCircle size={10} /> {errorMessage}</span>}
            </label>
            <div className={`relative bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] z-10 ${readOnly ? 'opacity-80 cursor-not-allowed bg-slate-100/50 border-slate-200/50' : `border-slate-200/80 ${inputHoverClass} ${errorClasses}`}`}>
                {Icon && <div className="absolute left-3 text-slate-400"><Icon size={14} strokeWidth={2.5} /></div>}
                {prefix && <div className="absolute left-3 text-slate-400 font-black text-[13px]">{prefix}</div>}
                <input
                    type={type}
                    name={name}
                    value={value || ''}
                    onChange={handleInputChange}
                    placeholder={placeholder}
                    readOnly={readOnly}
                    disabled={readOnly}
                    className={`w-full h-full bg-transparent text-[13px] font-bold text-slate-700 outline-none ${Icon ? 'pl-9 pr-4' : prefix ? 'pl-8 pr-4' : 'px-4'}`}
                />
                {readOnly && <Lock size={12} className="absolute right-3 text-slate-400" />}
            </div>
        </div>
    );
});

export default PortalInput;
