import React, { useState, useRef, useCallback } from 'react';
import Button from '../common/Button';
import { Search, Loader2, ChevronLeft, ChevronRight, FlaskConical, Building2, Pill, X } from 'lucide-react';
import Badge from '../common/Badge';
import SearchInput from '../common/SearchInput';
import { clickable } from '@nucleo/utils/clickable';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { buscarEnSrs } from '@nucleo/data/srs';
import { resultadoDeSrs } from '@nucleo/utils/srs';


// ── SrsBuscadorWidget ─────────────────────────────────────────────────────────

export default function SrsBuscadorWidget({
    initialQuery = '',
    onSelectResult = null,  // (product) => void — optional callback when user picks a result
}) {
    const [query, setQuery]       = useState(initialQuery);
    const [results, setResults]   = useState(null);
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState(null);
    const [page, setPage]         = useState(1);
    const [lastPage, setLastPage] = useState(1);
    const [total, setTotal]       = useState(0);
    const debounceRef             = useRef(null);

    const search = useCallback(async (q, pg = 1) => {
        if (!q.trim()) { setResults(null); setTotal(0); return; }
        setLoading(true);
        setError(null);
        try {
            const json = await buscarEnSrs(q, { pagina: pg, porPagina: 10 });
            setResults(json.data || []);
            setTotal(json.total || 0);
            setLastPage(json.last_page || 1);
            setPage(json.current_page || pg);
        } catch (e) {
            setError(mensajeAmigable(e));
            setResults(null);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleInput = (val) => {
        setQuery(val);
        clearTimeout(debounceRef.current);
        if (!val.trim()) { setResults(null); setTotal(0); return; }
        debounceRef.current = setTimeout(() => search(val, 1), 450);
    };

    const goPage = (pg) => search(query, pg);

    return (
        <div className="flex flex-col gap-3">
            {/* Search bar */}
            <div className="relative">
                <SearchInput
                    placeholder="Buscar en Registro SRS..."
                    value={query}
                    onChange={handleInput}
                    loading={loading}
                    autoFocus
                />
            </div>

            {/* Error */}
            {error && (
                <div className="px-4 py-3 rounded-2xl bg-danger/10 border border-danger/30 text-label text-danger-text font-medium">
                    {error}
                </div>
            )}

            {/* Results */}
            {results !== null && (
                <>
                    {results.length === 0 ? (
                        <div className="py-8 text-center text-body-sm text-content-3 font-medium">
                            Sin resultados para "{query}"
                        </div>
                    ) : (
                        <>
                            <p className="text-caption font-bold text-content-2 uppercase tracking-widest px-1">
                                {total} resultado{total !== 1 ? 's' : ''} en SRS
                            </p>

                            <div className="flex flex-col gap-2">
                                {results.map((p) => (
                                    <SrsResultCard
                                        key={p.id}
                                        product={p}
                                        onSelect={onSelectResult ? () => onSelectResult(p) : null}
                                    />
                                ))}
                            </div>

                            {/* Pagination */}
                            {lastPage > 1 && (
                                <div className="flex items-center justify-between pt-1">
                                    <Button variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => goPage(page - 1)}>Ant.</Button>
                                    <span className="text-label text-content-3 font-medium">
                                        Pág. {page} / {lastPage}
                                    </span>
                                    <Button variant="ghost" disabled={page >= lastPage} onClick={() => goPage(page + 1)}>Sig. <ChevronRight size={11} strokeWidth={2.5} /></Button>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}

// ── SrsResultCard ─────────────────────────────────────────────────────────────

function SrsResultCard({ product: p, onSelect }) {
    // La lectura del resultado (y su limpieza) es del núcleo: la app lee lo mismo.
    const { activo, nombre, lab, forma, principio, conc, noregistro } = resultadoDeSrs(p);

    let fechaStr = '';
    try {
        if (p.FECHA_INSCRIPCION) {
            fechaStr = fechaTexto(p.FECHA_INSCRIPCION, {
                year: 'numeric', month: 'short', day: 'numeric' });
        }
    } catch { /* invalid date — skip */ }

    return (
        <div
            data-surface="card" className={`p-3.5 flex flex-col gap-2 transition-all ${ onSelect ? 'cursor-pointer hover:border-brand/40 hover:shadow-md hover:shadow-blue-50' : 'border-divider' }`}
            {...clickable(onSelect || undefined)}
        >
            {/* Header row */}
            <div className="flex items-start justify-between gap-2">
                <p className="text-body-sm font-black text-content leading-tight flex-1">
                    {nombre || <span className="text-content-3 font-normal italic">Sin nombre</span>}
                </p>
                <Badge variant={activo ? 'success' : 'neutral'} size="sm" className="shrink-0">{activo ? 'ACTIVO' : 'INACTIVO'}</Badge>
            </div>

            {/* Lab + forma */}
            {(lab || forma) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {lab && (
                        <span className="flex items-center gap-1 text-label text-content-3">
                            <Building2 size={10} className="text-content-3 shrink-0" />
                            {lab}
                        </span>
                    )}
                    {forma && (
                        <span className="flex items-center gap-1 text-label text-content-3">
                            <Pill size={10} className="text-content-3 shrink-0" />
                            {forma}
                        </span>
                    )}
                </div>
            )}

            {/* Principio activo + concentración */}
            {principio && (
                <div className="flex items-start gap-1.5 bg-chart-3/10 rounded-xl px-3 py-2">
                    <FlaskConical size={11} className="text-chart-3-text shrink-0 mt-0.5" />
                    <div className="text-label text-chart-3-text font-medium leading-snug">
                        <span>{principio}</span>
                        {conc && <span className="ml-1.5 text-chart-3-text font-bold">{conc}</span>}
                    </div>
                </div>
            )}

            {/* Footer: registro + fecha */}
            {(noregistro || fechaStr) && (
                <div className="flex items-center gap-3 pt-0.5">
                    {noregistro && (
                        <span className="text-caption text-content-3 font-mono">{noregistro}</span>
                    )}
                    {fechaStr && (
                        <span className="text-caption text-content-3">{fechaStr}</span>
                    )}
                </div>
            )}
        </div>
    );
}
