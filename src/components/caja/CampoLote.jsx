import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { History } from 'lucide-react';
import PortalInput from '../common/PortalInput';
import useCapaFlotante from '../../plataforma/capaFlotante';
import { lotesQueCoinciden } from '@nucleo/utils/cobroDeAplicacion';

/**
 * El lote de la ampolla con los ya usados a mano (2026-10-29). Antes eran una
 * fila de botones encima del campo: con uno se veía bien, con seis era una
 * pared, y nada decía cuál se parecía a lo que se estaba escribiendo.
 *
 * Ahora es UN campo: al entrar se despliegan los lotes ya usados de ese
 * producto, y al escribir se filtran —primero los que empiezan así, al final
 * los que se le parecen por un error de tecleo—. Elegir uno llena el lote Y su
 * vencimiento. Escribir uno nuevo sigue libre: la lista ayuda, no obliga.
 *
 * Teclado: ↑/↓ recorren, Enter elige, Escape cierra.
 *
 * @param {{ lote: string, vence: string, veces?: number }[]} conocidos
 * @param {(c: { lote: string, vence: string }) => void} onElegir
 */
export default function CampoLote({ value, onChange, conocidos = [], onElegir }) {
    const [abierto, setAbierto] = useState(false);
    const [activo, setActivo] = useState(-1);
    const [pos, setPos] = useState(null);
    const cajaRef = useRef(null);
    const opciones = lotesQueCoinciden(value, conocidos);
    // Si lo escrito ya ES uno de la lista, no hay nada que ofrecer.
    const yaElegido = opciones.length === 1 && opciones[0].lote === String(value || '').trim().toUpperCase();
    const visible = abierto && opciones.length > 0 && !yaElegido;

    const medir = useCallback(() => {
        const r = cajaRef.current?.querySelector('input')?.closest('[data-surface]')?.getBoundingClientRect()
            ?? cajaRef.current?.getBoundingClientRect();
        if (r) setPos({ top: r.bottom + 6 + window.scrollY, left: r.left + window.scrollX, width: r.width });
    }, []);
    useCapaFlotante(visible);
    useEffect(() => {
        if (!visible) return undefined;
        window.addEventListener('scroll', medir, true);
        window.addEventListener('resize', medir);
        return () => { window.removeEventListener('scroll', medir, true); window.removeEventListener('resize', medir); };
    }, [visible, medir]);

    const elegir = (c) => { onElegir(c); setAbierto(false); setActivo(-1); };
    const mesAnio = (v) => { const [a, m] = String(v).split('-'); return `${m}/${a}`; };

    const tecla = (e) => {
        if (!visible) { if (e.key === 'ArrowDown' && opciones.length) { medir(); setAbierto(true); setActivo(0); e.preventDefault(); } return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((i) => Math.min(i + 1, opciones.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((i) => Math.max(i - 1, 0)); }
        else if (e.key === 'Enter' && activo >= 0) { e.preventDefault(); elegir(opciones[activo]); }
        else if (e.key === 'Escape') { e.stopPropagation(); setAbierto(false); }
    };

    return (
        <div ref={cajaRef}>
            <PortalInput label="Lote de la ampolla" value={value} maxLength={30} placeholder="Ej. 6D1514B"
                autoComplete="off" role="combobox" aria-expanded={visible} aria-autocomplete="list"
                aria-controls="lotes-conocidos"
                onFocus={() => { medir(); setAbierto(true); }} onBlur={() => setAbierto(false)} onKeyDown={tecla}
                onChange={(e) => { onChange(e.target.value.toUpperCase()); medir(); setAbierto(true); setActivo(-1); }} />
            {visible && pos && createPortal(
                <div style={{ top: pos.top, left: pos.left, width: pos.width }}
                    className="absolute z-confirm animate-in fade-in zoom-in-95 duration-[var(--dur-fast)] origin-top">
                    <div data-surface="dropdown" className="p-1.5 font-sans">
                        <p className="flex items-center gap-1.5 px-2.5 pt-1 pb-1.5 text-caption text-content-3">
                            <History size={12} strokeWidth={2.5} /> Ya usados de este producto
                        </p>
                        <ul id="lotes-conocidos" role="listbox" className="max-h-60 overflow-y-auto">
                            {opciones.map((c, i) => (
                                <li key={`${c.lote}|${c.vence}`} role="option" aria-selected={i === activo}>
                                    {/* `onMouseDown` + preventDefault: el campo no pierde el
                                        foco antes del clic, que cerraría la lista sin elegir. */}
                                    <button type="button" tabIndex={-1}
                                        onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(c)}
                                        onMouseEnter={() => setActivo(i)}
                                        className={`w-full flex items-center justify-between gap-3 px-2.5 min-h-[max(40px,var(--tap-min))] rounded-xl text-left transition-colors active:scale-[0.99]
                                            ${i === activo ? 'bg-surface-card-hover' : ''}`}>
                                        <span className="text-body font-bold text-content tabular-nums">{c.lote}</span>
                                        <span className="text-body-sm text-content-2 tabular-nums shrink-0">
                                            vence {mesAnio(c.vence)}
                                            {c.veces > 1 && <span className="text-content-3"> · {c.veces} veces</span>}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}
