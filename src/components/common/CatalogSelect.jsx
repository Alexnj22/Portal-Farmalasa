import React from 'react';
import LiquidSelect from './LiquidSelect';
import { OTRA_ESPECIALIDAD, isCatalogOther } from '../../utils/educationCatalogs';

// Select con fallback a "Otra..." (solo el select — el input de texto libre
// se renderiza aparte, en el caller, para poder ubicarlo a ancho completo).
// Usado por cualquier campo respaldado por education_catalog_entries
// (especialidad, profesión, institución educativa, etc.).
export const CatalogSelect = ({ value, onChange, options, portalSelectProps, inputHoverClass, hasError, placeholder = 'Seleccionar...', clearable = false }) => {
    const isOther = isCatalogOther(value, options);
    const selectValue = isOther ? OTRA_ESPECIALIDAD : value;
    return (
        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${hasError && !isOther ? '!border-red-400 !bg-red-50/50' : ''}`}>
            <LiquidSelect
                value={selectValue}
                onChange={(val) => onChange(val)}
                options={options}
                placeholder={placeholder}
                clearable={clearable}
                {...portalSelectProps}
            />
        </div>
    );
};

// Input de texto libre para cuando se elige "Otra..." — value llega en
// OTRA_ESPECIALIDAD (sentinel) hasta que el usuario teclea algo real.
export const CatalogOtherInput = ({ value, onChange, inputHoverClass, hasError, placeholder }) => (
    <input
        type="text"
        value={value === OTRA_ESPECIALIDAD ? '' : (value || '')}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder={placeholder}
        className={`w-full h-[40px] px-4 bg-white border rounded-[1rem] text-[13px] font-bold text-slate-700 outline-none shadow-sm ${inputHoverClass} ${hasError ? '!border-red-400 !bg-red-50/50' : 'border-slate-200/80'}`}
    />
);
