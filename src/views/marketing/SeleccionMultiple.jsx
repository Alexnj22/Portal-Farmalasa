import React from 'react';
import Checkbox from '../../components/common/Checkbox';

/**
 * Elegir VARIAS de pocas opciones a la vista (marcas, redes). No es un
 * `LiquidSelect` —esconde lo elegido detrás de un clic— ni un `SegmentedControl`
 * —elige una sola—: es una tarjeta por opción con su `Checkbox`, que es el
 * control canónico de «sí/no» por elemento. La tarjeta marcada toma el tono de
 * marca para que lo elegido se lea de un vistazo.
 *
 * `opciones`: `[{ value, label, punto? }]` — `punto` es una clase de color.
 */
export default function SeleccionMultiple({ opciones, valores, onChange, disabled = false, columnas = 'grid-cols-2' }) {
    const elegidos = new Set((valores || []).map(String));
    const alternar = (v, on) => {
        const lista = (valores || []).filter((x) => String(x) !== String(v));
        onChange(on ? [...lista, v] : lista);
    };
    return (
        <div className={`grid ${columnas} gap-2`}>
            {opciones.map((o) => {
                const on = elegidos.has(String(o.value));
                return (
                    <div key={o.value} data-surface="card" data-tono={on ? 'brand' : undefined}
                        className="px-3 py-2 flex items-center gap-2 min-h-[var(--tap-min)] min-w-0">
                        {o.punto && <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${o.punto}`} aria-hidden />}
                        <Checkbox label={o.label} checked={on} disabled={disabled}
                            onChange={(v) => alternar(o.value, v)} className="min-w-0" />
                    </div>
                );
            })}
        </div>
    );
}
