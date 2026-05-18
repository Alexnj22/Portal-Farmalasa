import React, { useState, useRef, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { Search, Loader2, ChevronLeft, ChevronRight, FlaskConical, Building2, Pill, X } from 'lucide-react';

async function fetchSrs(q, page = 1) {
    const { data, error } = await supabase.functions.invoke('srs-proxy', {
        method: 'GET',
        headers: { 'x-query': q, 'x-page': String(page) },
        // Pass params via query string by building URL ourselves
    });
    // supabase.functions.invoke doesn't support GET query params natively,
    // so we call via fetch with the session token
    throw new Error('use_direct'); // handled below
}

// Direct fetch wrapper using supabase session token
async function srsFetch(q, page = 1) {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const base  = import.meta.env.VITE_SUPABASE_URL;
    const url   = `${base}/functions/v1/srs-proxy?q=${encodeURIComponent(q)}&page=${page}&page-max=10`;
    const res   = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return res.json();
}

// ── SrsBuscadorWidget ─────────────────────────────────────────────────────────

export default function SrsBuscadorWidget({
    initialQuery = '',
    onSelectResult = null,  // (product) => void — optional callback when user picks a result
    onClose = null,
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
            const json = await srsFetch(q, pg);
            setResults(json.data || []);
            setTotal(json.total || 0);
            setLastPage(json.last_page || 1);
            setPage(json.current_page || pg);
        } catch (e) {
            setError(e.message);
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
                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    {loading
                        ? <Loader2 size={14} className="text-[#007AFF] animate-spin" />
                        : <Search size={14} className="text-slate-400" />
                    }
                </div>
                <input
                    type="text"
                    value={query}
                    onChange={e => handleInput(e.target.value)}
                    placeholder="Buscar en Registro SRS..."
                    className="w-full pl-9 pr-8 py-2.5 rounded-2xl border border-slate-200 bg-white text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/10 transition-all"
                    autoFocus
                    spellCheck={false}
                    autoComplete="off"
                />
                {query && (
                    <button onClick={() => { setQuery(''); setResults(null); setTotal(0); }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                        <X size={11} strokeWidth={2.5} />
                    </button>
                )}
            </div>

            {/* Error */}
            {error && (
                <div className="px-4 py-3 rounded-2xl bg-red-50 border border-red-100 text-[11px] text-red-500 font-medium">
                    {error}
                </div>
            )}

            {/* Results */}
            {results !== null && (
                <>
                    {results.length === 0 ? (
                        <div className="py-8 text-center text-[12px] text-slate-400 font-medium">
                            Sin resultados para "{query}"
                        </div>
                    ) : (
                        <>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">
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
                                    <button
                                        disabled={page <= 1}
                                        onClick={() => goPage(page - 1)}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold text-slate-500 border border-slate-200 hover:border-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                    >
                                        <ChevronLeft size={11} strokeWidth={2.5} /> Ant.
                                    </button>
                                    <span className="text-[11px] text-slate-400 font-medium">
                                        Pág. {page} / {lastPage}
                                    </span>
                                    <button
                                        disabled={page >= lastPage}
                                        onClick={() => goPage(page + 1)}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold text-slate-500 border border-slate-200 hover:border-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                    >
                                        Sig. <ChevronRight size={11} strokeWidth={2.5} />
                                    </button>
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
    const activo = (p.estatus ?? p.Activo) === 'A';

    return (
        <div className={`rounded-2xl border bg-white p-3.5 flex flex-col gap-2 transition-all ${
            onSelect ? 'cursor-pointer hover:border-[#007AFF]/40 hover:shadow-md hover:shadow-blue-50 hover:-translate-y-px' : 'border-slate-200'
        }`}
            onClick={onSelect || undefined}
        >
            {/* Header row */}
            <div className="flex items-start justify-between gap-2">
                <p className="text-[12px] font-black text-slate-800 leading-tight flex-1">
                    {p.nombre_comercial || p.nombreComercial}
                </p>
                <span className={`shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full ${
                    activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                    {activo ? 'ACTIVO' : 'INACTIVO'}
                </span>
            </div>

            {/* Lab + forma */}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
                {p.laboratorio && (
                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Building2 size={10} className="text-slate-400 shrink-0" />
                        {p.laboratorio}
                    </span>
                )}
                {p.NOMBRE_FORMA_FARMACEUTICA && (
                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Pill size={10} className="text-slate-400 shrink-0" />
                        {p.NOMBRE_FORMA_FARMACEUTICA}
                    </span>
                )}
            </div>

            {/* Principio activo + concentración */}
            {(p.principio_activo || p.formula) && (
                <div className="flex items-start gap-1.5 bg-violet-50 rounded-xl px-3 py-2">
                    <FlaskConical size={11} className="text-violet-400 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-violet-700 font-medium leading-snug">
                        <span>{p.principio_activo || p.formula}</span>
                        {p.concentracion && (
                            <span className="ml-1.5 text-violet-500 font-bold">{p.concentracion}</span>
                        )}
                    </div>
                </div>
            )}

            {/* Footer: registro + fecha */}
            <div className="flex items-center gap-3 pt-0.5">
                {p.noregistro && (
                    <span className="text-[10px] text-slate-400 font-mono">{p.noregistro}</span>
                )}
                {p.FECHA_INSCRIPCION && (
                    <span className="text-[10px] text-slate-400">
                        {new Date(p.FECHA_INSCRIPCION).toLocaleDateString('es-SV', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                )}
            </div>
        </div>
    );
}
