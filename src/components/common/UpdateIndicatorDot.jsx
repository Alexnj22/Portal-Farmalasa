import React from 'react';

// Se muestra sobre el logo cuando el usuario cerró SystemUpdateBanner pero la
// migración de tema sigue en curso — permite reabrir el aviso sin esperar a
// la siguiente sesión (que es cuando reaparecería solo, vía sessionStorage).
export default function UpdateIndicatorDot({ onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Ver aviso de actualización del portal"
            className="absolute -top-0.5 -right-0.5 z-20 flex h-3 w-3 rounded-full focus:outline-none"
        >
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-logo-magenta opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-logo-magenta border border-white/40 shadow-[0_0_6px_rgba(152,29,151,0.8)]" />
        </button>
    );
}
