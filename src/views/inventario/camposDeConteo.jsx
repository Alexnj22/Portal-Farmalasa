import React from 'react';
import { inputHoverClass } from '../../utils/inputStyles';

/**
 * Los dos envoltorios de campo del Conteo de inventario.
 *
 * Vivían dentro de `ConteoDetailView` y salieron el 2026-08-23, cuando el alta
 * manual se llevó a su propio archivo para poder diferirla: `Campo` sólo lo usa
 * ese formulario y `CajaFecha` lo usan los dos, así que dejarlos donde estaban
 * habría obligado a importar la vista desde el formulario —o a duplicarlos, que
 * es como se desincronizan—.
 *
 * Lo descubrió una prueba, no el compilador: mover el formulario de archivo dejó
 * `Campo`, `CajaFecha` y `FlaskConical` sin definir, y ni el build ni ESLint lo
 * vieron. Sólo se ve al renderizar (ver `tests/unit/altaManualDeConteo.test.jsx`).
 */

export function Campo({ label, children }) {
    return (
        <div className="flex flex-col gap-1 min-w-0">
            <span className="text-micro font-black uppercase tracking-widest text-content-3 ml-1">{label}</span>
            {children}
        </div>
    );
}

export function CajaFecha({ inerte, titulo, children }) {
    return (
        <div
            role="group"
            title={titulo}
            aria-disabled={inerte || undefined}
            className={`bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center
                h-[max(40px,var(--tap-min))] px-1.5 ${inputHoverClass}
                ${inerte ? 'opacity-60 pointer-events-none' : ''}`}
        >
            {children}
        </div>
    );
}
