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
                        ? <Loader2 size={14} className="text-[#0052CC] animate-spin" />
                        : <Search size={14} className="text-slate-400" />
                    }
                </div>
                <input
                    type="text"
                    value={query}
                    onChange={e => handleInput(e.target.value)}
                    placeholder="Buscar en Registro SRS..."
                    className="w-full pl-9 pr-8 py-2.5 rounded-2xl border border-slate-200 bg-white text-[16px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all"
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

// Strips non-printable characters and Private Use Area / Object Replacement glyphs
// that macOS fonts substitute silently but Windows/Edge renders as OBJ boxes.
function sanitize(v) {
    if (v == null) return '';
    const s = typeof v === 'object'
        ? String(v.nombre ?? v.name ?? v.value ?? '')
        : String(v);
    // Strip: control chars, Unicode PUA (E000-F8FF), Specials incl. OBJ char (FFF0-FFFF)
    // Using new RegExp() so the build tool doesn't try to parse supplementary chars.
    return s
        // eslint-disable-next-line no-control-regex -- intencional: limpia basura binaria/PUA de lectores de código de barras
        .replace(new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\uE000-\uF8FF\uFFF0-\uFFFF]', 'g'), '')
        .replace(/\u00A0/g, ' ')
        .trim();
}

function SrsResultCard({ product: p, onSelect }) {
    const estatus    = sanitize(p.estatus ?? p.Activo ?? '');
    const activo     = estatus === 'A';
    const nombre     = sanitize(p.nombre_comercial ?? p.nombreComercial ?? '');
    const lab        = sanitize(p.laboratorio ?? '');
    const forma      = sanitize(p.NOMBRE_FORMA_FARMACEUTICA ?? '');
    const principio  = sanitize(p.principio_activo ?? p.formula ?? '');
    const conc       = sanitize(p.concentracion ?? '');
    const noregistro = sanitize(p.noregistro ?? '');

    let fechaStr = '';
    try {
        if (p.FECHA_INSCRIPCION) {
            fechaStr = new Date(p.FECHA_INSCRIPCION).toLocaleDateString('es-SV', {
                year: 'numeric', month: 'short', day: 'numeric',
            });
        }
    } catch { /* invalid date — skip */ }

    return (
        <div
            className={`rounded-2xl border bg-white p-3.5 flex flex-col gap-2 transition-all ${
                onSelect ? 'cursor-pointer hover:border-[#0052CC]/40 hover:shadow-md hover:shadow-blue-50 hover:-translate-y-px' : 'border-slate-200'
            }`}
            onClick={onSelect || undefined}
        >
            {/* Header row */}
            <div className="flex items-start justify-between gap-2">
                <p className="text-[12px] font-black text-slate-800 leading-tight flex-1">
                    {nombre || <span className="text-slate-400 font-normal italic">Sin nombre</span>}
                </p>
                <span className={`shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full ${
                    activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                    {activo ? 'ACTIVO' : 'INACTIVO'}
                </span>
            </div>

            {/* Lab + forma */}
            {(lab || forma) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {lab && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-500">
                            <Building2 size={10} className="text-slate-400 shrink-0" />
                            {lab}
                        </span>
                    )}
                    {forma && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-500">
                            <Pill size={10} className="text-slate-400 shrink-0" />
                            {forma}
                        </span>
                    )}
                </div>
            )}

            {/* Principio activo + concentración */}
            {principio && (
                <div className="flex items-start gap-1.5 bg-violet-50 rounded-xl px-3 py-2">
                    <FlaskConical size={11} className="text-violet-400 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-violet-700 font-medium leading-snug">
                        <span>{principio}</span>
                        {conc && <span className="ml-1.5 text-violet-500 font-bold">{conc}</span>}
                    </div>
                </div>
            )}

            {/* Footer: registro + fecha */}
            {(noregistro || fechaStr) && (
                <div className="flex items-center gap-3 pt-0.5">
                    {noregistro && (
                        <span className="text-[10px] text-slate-400 font-mono">{noregistro}</span>
                    )}
                    {fechaStr && (
                        <span className="text-[10px] text-slate-400">{fechaStr}</span>
                    )}
                </div>
            )}
        </div>
    );
}
