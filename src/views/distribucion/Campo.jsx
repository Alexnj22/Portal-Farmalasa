import React from 'react';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';

// Un control que no trae rótulo propio (LiquidSelect, LiquidDatePicker,
// SegmentedControl) con el MISMO rótulo que `PortalInput` —alto fijo, misma
// letra—, así en una fila de formulario los campos quedan a la misma altura.
export default function Campo({ label, children, className = '' }) {
    return (
        <div className={`min-w-0 ${className}`}>
            <span className={rotuloCampo()}>{label}</span>
            {children}
        </div>
    );
}
