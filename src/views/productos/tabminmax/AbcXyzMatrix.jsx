// Extracted from TabMinMax.jsx (Bloque 6.C)
import React, { useMemo, useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { BarChart2, ChevronDown } from 'lucide-react';
import { normXyz } from './helpers';
import Button from '../../../components/common/Button';
import useLayoutCompacto from '../../../hooks/useLayoutCompacto';

const XYZ_KEYS = ['X', 'Y', 'Z'];
const ABC_KEYS = ['A', 'B', 'C'];
const XYZ_DESC = { X: 'estable', Y: 'moderada', Z: 'errática' };

// El peso visual de cada tramo. Sale del token de marca con `color-mix`, así que
// la escala sigue al tema en vez de quemar tres azules.
const TRAMO = { X: 100, Y: 55, Z: 24 };

/**
 * AbcXyzMatrix — la clasificación ABC × XYZ, como RANURA de la píldora.
 *
 * ── Por qué dejó de ser un bloque (2026-07-30, aprobado sobre mockup) ─────
 * Era una matriz de 3×3 con sus cabeceras y su leyenda: **124px de alto** entre
 * la píldora y la tabla, más los 44 de la tira de filtros que había abajo. En
 * total 168px de cromo antes de que se viera el primer producto.
 *
 * Una matriz 3×3 es la forma correcta cuando lo que se compara son *celdas entre
 * sí*, y acá casi nunca: se mira "cuántos A tengo" y "cuántos son erráticos".
 * Peor, **se mira para DECIDIR un filtro, no para vigilarla** — una vez elegida
 * la clase lo que importa es la lista, y la matriz se quedaba ocupando alto sin
 * que nadie la volviera a leer.
 *
 * Ahora es una ranura que resume lo aplicado ("ABC · A") y se abre entera cuando
 * hace falta. Adentro, barras apiladas por clase: contestan las dos preguntas de
 * un vistazo y conservan las nueve zonas de clic.
 *
 * ── En el teléfono no hay popover ─────────────────────────────────────────
 * Ahí esta ranura ya vive DENTRO de la hoja de filtros de la barra flotante, así
 * que abrir otra capa encima sería una hoja dentro de una hoja. Se dibuja
 * directamente desplegada.
 */
export default function AbcXyzMatrix({ data, filterAbc, setFilterAbc, filterXyz, setFilterXyz, loading }) {
    const compacto = useLayoutCompacto();
    const [abierto, setAbierto] = useState(false);
    const [caja, setCaja] = useState(null);
    const btnRef = useRef(null);
    const id = useId();

    const matrix = useMemo(() => {
        const m = {};
        for (const abc of ABC_KEYS)
            for (const xyz of XYZ_KEYS)
                m[`${abc}${xyz}`] = 0;
        for (const r of data) {
            if (r.is_dead_stock || r.alert_status === 'no_data') continue;
            const abc = r.draft_abc_class || r.abc_class || 'D';
            const xyz = normXyz(r.draft_demand_variability || r.demand_variability);
            if (m[`${abc}${xyz}`] !== undefined) m[`${abc}${xyz}`]++;
        }
        return m;
    }, [data]);

    const totalPorAbc = abc => XYZ_KEYS.reduce((s, x) => s + matrix[`${abc}${x}`], 0);

    const toggle = (abc, xyz) => {
        setFilterAbc(pa => pa === abc ? 'all' : abc);
        setFilterXyz(px => px === xyz ? 'all' : xyz);
    };

    useEffect(() => {
        if (!abierto || compacto) return undefined;
        const medir = () => {
            const r = btnRef.current?.getBoundingClientRect();
            if (r) setCaja({ top: r.bottom + 8, left: r.left });
        };
        medir();
        const alTeclear = e => { if (e.key === 'Escape') setAbierto(false); };
        const alClic = e => {
            if (!btnRef.current?.contains(e.target) && !e.target.closest?.(`[data-abc="${id}"]`)) setAbierto(false);
        };
        window.addEventListener('keydown', alTeclear);
        window.addEventListener('resize', medir);
        window.addEventListener('scroll', medir, true);
        document.addEventListener('mousedown', alClic);
        return () => {
            window.removeEventListener('keydown', alTeclear);
            window.removeEventListener('resize', medir);
            window.removeEventListener('scroll', medir, true);
            document.removeEventListener('mousedown', alClic);
        };
    }, [abierto, compacto, id]);

    // ── Las barras: una fila por clase, partida en X/Y/Z ──────────────────
    const barras = (
        <div className="flex flex-col gap-1.5 min-w-[240px]">
            {ABC_KEYS.map(abc => {
                const total = totalPorAbc(abc);
                return (
                    <div key={abc} className="flex items-center gap-2">
                        <button type="button"
                            onClick={() => setFilterAbc(p => p === abc ? 'all' : abc)}
                            aria-pressed={filterAbc === abc}
                            aria-label={`Clase ${abc}: ${total} producto${total === 1 ? '' : 's'}`}
                            className={`w-5 text-caption font-black shrink-0 transition-colors duration-150
                                ${filterAbc === abc ? 'text-brand-text' : 'text-content-3 hover:text-content-2'}`}>
                            {abc}
                        </button>

                        <div className="flex-1 flex h-[22px] rounded-btn overflow-hidden bg-surface-card-hover">
                            {XYZ_KEYS.map(xyz => {
                                const n = matrix[`${abc}${xyz}`];
                                if (!n) return null;
                                const pct = (n / Math.max(1, total)) * 100;
                                const activo = filterAbc === abc && filterXyz === xyz;
                                return (
                                    <button key={xyz} type="button"
                                        onClick={() => toggle(abc, xyz)}
                                        aria-pressed={activo}
                                        aria-label={`${abc}${xyz} — demanda ${XYZ_DESC[xyz]}: ${n} producto${n === 1 ? '' : 's'}`}
                                        title={`${abc}${xyz} · ${n}`}
                                        style={{
                                            flex: `0 0 ${pct}%`,
                                            background: `color-mix(in srgb, var(--brand) ${TRAMO[xyz]}%, transparent)`,
                                            outline: activo ? '2px solid var(--brand)' : undefined,
                                            outlineOffset: '-2px',
                                        }}
                                        className={`grid place-items-center min-w-0 text-micro font-black tabular-nums
                                            transition-[filter] duration-150 hover:brightness-110
                                            ${xyz === 'Z' ? 'text-content-2' : 'text-white'}`}>
                                        {pct > 14 ? n : ''}
                                    </button>
                                );
                            })}
                        </div>

                        <span className="w-10 text-right text-caption font-bold tabular-nums text-content-2 shrink-0">
                            {total}
                        </span>
                    </div>
                );
            })}

            <div className="flex items-center gap-3 pt-1 border-t border-border-card">
                {XYZ_KEYS.map(xyz => (
                    <span key={xyz} className="flex items-center gap-1 text-micro text-content-3">
                        <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: `color-mix(in srgb, var(--brand) ${TRAMO[xyz]}%, transparent)` }} />
                        <span className="font-black">{xyz}</span> {XYZ_DESC[xyz]}
                    </span>
                ))}
                {(filterAbc !== 'all' || filterXyz !== 'all') && (
                    <Button variant="ghost" size="xs" className="ml-auto"
                        onClick={() => { setFilterAbc('all'); setFilterXyz('all'); }}>
                        Limpiar
                    </Button>
                )}
            </div>
        </div>
    );

    if (loading || data.length === 0) {
        return (
            <span className="flex items-center gap-1.5 px-2 h-9 text-body-sm font-bold text-content-3">
                <BarChart2 size={13} strokeWidth={2.5} />
                {loading ? 'Clasificando…' : 'Sin clasificar'}
            </span>
        );
    }

    // En el teléfono la ranura ya vive dentro de la hoja de filtros: desplegada.
    if (compacto) return barras;

    const resumen = filterAbc === 'all' && filterXyz === 'all'
        ? null
        : `${filterAbc !== 'all' ? filterAbc : '·'}${filterXyz !== 'all' ? filterXyz : ''}`;

    return (
        <>
            <button ref={btnRef} type="button" onClick={() => setAbierto(v => !v)}
                aria-expanded={abierto} aria-haspopup="dialog"
                aria-label="Clasificación ABC por XYZ"
                className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-btn shrink-0
                    text-body-sm font-bold transition-colors duration-150
                    ${abierto || resumen ? 'text-brand-text' : 'text-content-2 hover:text-content'}`}>
                <BarChart2 size={13} strokeWidth={2.5} className="text-brand-text" />
                ABC
                {resumen && <span className="font-black tabular-nums text-brand-text">{resumen}</span>}
                <ChevronDown size={11} strokeWidth={2.5} className="text-content-3" />
            </button>

            {abierto && caja && createPortal(
                <div data-abc={id} role="dialog" aria-label="Clasificación ABC por XYZ"
                    data-surface="dropdown"
                    style={{ top: caja.top, left: caja.left }}
                    className="fixed z-dropdown p-3 animate-in fade-in zoom-in-95 duration-150 ease-out">
                    <p className="text-caption font-black uppercase tracking-widest text-content-3 mb-2">
                        Clasificación ABC × XYZ
                    </p>
                    {barras}
                </div>,
                document.body,
            )}
        </>
    );
}
