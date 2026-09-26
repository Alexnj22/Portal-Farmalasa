import React from 'react';
import Switch from '../../components/common/Switch';

// `Switch` no dibuja su `label`: es el nombre accesible. En un formulario la
// persona tiene que LEER qué enciende, así que el texto va al lado y el mismo
// texto queda como nombre accesible.
export default function Interruptor({ label, ayuda, className = '', ...props }) {
    return (
        <div className={`flex w-full items-center justify-between gap-3 min-h-[var(--tap-min)] ${className}`}>
            <div className="min-w-0">
                <p className="text-body-sm text-content-2">{label}</p>
                {ayuda && <p className="text-caption text-content-3">{ayuda}</p>}
            </div>
            <Switch label={label} {...props} />
        </div>
    );
}
