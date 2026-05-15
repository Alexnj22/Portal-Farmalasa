import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, LayoutList, Boxes, Search, X, ChevronRight, Building2, Tag } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect    from '../components/common/LiquidSelect';
import TabCatalogo     from './productos/TabCatalogo';
import TabInventario   from './productos/TabInventario';
import { supabase }    from '../supabaseClient';

const TABS = [
    { key: 'catalogo',   label: 'Catálogo',   icon: LayoutList },
    { key: 'inventario', label: 'Inventario',  icon: Boxes      },
];

export default function ProductosView() {
    // ── Tab + search ────────────────────────────────────────────────────────
    const [searchParams, setSearchParams] = useSearchParams();
    const VALID      = new Set(['catalogo', 'inventario']);
    const activeTab  = VALID.has(searchParams.get('tab')) ? searchParams.get('tab') : 'catalogo';
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });

    const [isSearchMode, setIsSearchMode] = useState(false);
    const [rawSearch,    setRawSearch]    = useState('');
    const openSearch  = () => setIsSearchMode(true);
    const closeSearch = () => { setIsSearchMode(false); setRawSearch(''); };

    // ── Catálogo filters (live here so they render in the floating header) ──
    const [filterActivo,      setFilterActivo]      = useState('activos');
    const [filterLab,         setFilterLab]          = useState(null);
    const [filterCategoria,   setFilterCategoria]    = useState(null);
    const [filterAntibiotico, setFilterAntibiotico]  = useState(null);
    const [labs,              setLabs]               = useState([]);
    const [categorias,        setCategorias]         = useState([]);

    useEffect(() => {
        supabase.from('laboratorios').select('id, nombre').order('nombre')
            .then(({ data }) => setLabs(data || []));
        supabase.from('products').select('tipo_medicamento').not('tipo_medicamento', 'is', null)
            .then(({ data }) => {
                const unique = [...new Set((data || []).map(r => r.tipo_medicamento).filter(Boolean))].sort();
                setCategorias(unique);
            });
    }, []);

    // Filter pill derived values
    const labOptions  = labs.map(l => ({ value: String(l.id), label: l.nombre }));
    const catOptions  = categorias.map(c => ({ value: c, label: c }));
    const selectedLab = labs.find(l => l.id === filterLab);
    const labW = selectedLab ? Math.max(150, Math.min(260, 90 + selectedLab.nombre.length * 7)) : 150;
    const catW = filterCategoria ? Math.max(140, Math.min(220, 90 + filterCategoria.length * 7)) : 140;
    const hasActiveFilters = filterLab !== null || filterCategoria !== null
                           || filterAntibiotico !== null || filterActivo === 'todos';
    const resetFilters = () => {
        setFilterLab(null); setFilterCategoria(null);
        setFilterAntibiotico(null); setFilterActivo('activos');
    };

    const searchPlaceholder = activeTab === 'catalogo'
        ? 'Buscar producto o principio activo...'
        : 'Buscar en inventario...';

    // ── filtersContent ──────────────────────────────────────────────────────
    const filtersContent = (
        <div className="flex items-center gap-3">

            {/* ── Catálogo filter pill (desktop only, hidden in search mode) ── */}
            {activeTab === 'catalogo' && !isSearchMode && (
                <div className="hidden lg:flex group items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 shrink-0 overflow-visible">

                    {/* Activos / Todos */}
                    <div className="flex items-center gap-0.5 px-2.5 py-2">
                        {[['activos', 'Activos'], ['todos', 'Todos']].map(([v, label]) => (
                            <button key={v} onClick={() => setFilterActivo(v)}
                                className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                                    filterActivo === v
                                        ? 'bg-emerald-100 text-emerald-700 shadow-sm'
                                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                }`}>{label}</button>
                        ))}
                    </div>

                    <div className="h-5 w-px bg-slate-100 shrink-0" />

                    {/* Laboratorio */}
                    <div className="flex items-center">
                        <div className="px-2 py-2 overflow-visible transition-all duration-200" style={{ width: labW + 'px' }}>
                            <LiquidSelect
                                value={filterLab ? String(filterLab) : ''}
                                onChange={v => setFilterLab(v ? parseInt(v) : null)}
                                options={labOptions}
                                placeholder="Laboratorio"
                                icon={Building2}
                                compact
                            />
                        </div>
                        {filterLab && (
                            <button onClick={() => setFilterLab(null)} title="Quitar laboratorio"
                                className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
                                <X size={9} strokeWidth={3} />
                            </button>
                        )}
                    </div>

                    <div className="h-5 w-px bg-slate-100 shrink-0" />

                    {/* Categoría */}
                    <div className="flex items-center">
                        <div className="px-2 py-2 overflow-visible transition-all duration-200" style={{ width: catW + 'px' }}>
                            <LiquidSelect
                                value={filterCategoria || ''}
                                onChange={v => setFilterCategoria(v || null)}
                                options={catOptions}
                                placeholder="Categoría"
                                icon={Tag}
                                compact
                            />
                        </div>
                        {filterCategoria && (
                            <button onClick={() => setFilterCategoria(null)} title="Quitar categoría"
                                className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
                                <X size={9} strokeWidth={3} />
                            </button>
                        )}
                    </div>

                    <div className="h-5 w-px bg-slate-100 shrink-0" />

                    {/* Antibiótico */}
                    <div className="flex items-center">
                        <button onClick={() => setFilterAntibiotico(v => v === true ? null : true)}
                            className={`mx-3 my-2 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                                filterAntibiotico === true
                                    ? 'bg-orange-100 text-orange-700 shadow-sm'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                            }`}>Antibiótico</button>
                        {filterAntibiotico && (
                            <button onClick={() => setFilterAntibiotico(null)} title="Quitar filtro"
                                className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
                                <X size={9} strokeWidth={3} />
                            </button>
                        )}
                    </div>

                    {/* Clear all */}
                    {hasActiveFilters && (
                        <>
                            <div className="h-5 w-px bg-slate-100 shrink-0" />
                            <button onClick={resetFilters} title="Limpiar todos los filtros"
                                className="mx-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-500 text-red-500 hover:text-white transition-all duration-200 shrink-0 hover:scale-110">
                                <X size={11} strokeWidth={3} />
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* ── Tabs + Search pill ── */}
            <div className="relative flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden">

                {/* Search mode */}
                <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left
                    ${isSearchMode ? 'max-w-[600px] opacity-100 px-4 md:px-5 gap-3' : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>
                    <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                    <input
                        ref={(el) => { if (el && isSearchMode) setTimeout(() => el.focus(), 100); }}
                        type="text"
                        placeholder={searchPlaceholder}
                        className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[180px] sm:w-[280px] md:w-[380px] placeholder:text-slate-400 focus:ring-0"
                        value={rawSearch}
                        onChange={e => setRawSearch(e.target.value)}
                    />
                    {rawSearch && (
                        <button onClick={() => setRawSearch('')} className="p-1 text-slate-400 hover:text-red-500 transition-all shrink-0">
                            <X size={16} strokeWidth={2.5} />
                        </button>
                    )}
                    <button onClick={closeSearch}
                        className="w-10 h-10 md:w-11 md:h-11 rounded-full hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2">
                        <ChevronRight size={18} strokeWidth={2.5} />
                    </button>
                </div>

                {/* Normal mode */}
                <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right
                    ${isSearchMode ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0' : 'max-w-[900px] opacity-100 pl-2 pr-1 md:pr-2 gap-1 md:gap-1.5'}`}>

                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        return (
                            <button key={tab.key} onClick={() => { setActiveTab(tab.key); closeSearch(); }}
                                className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 flex items-center gap-1.5 ${
                                    activeTab === tab.key
                                        ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]'
                                        : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'
                                }`}>
                                <Icon size={12} strokeWidth={2.5} />
                                <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                        );
                    })}

                    <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />
                    <button onClick={openSearch}
                        className="w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-300 hover:bg-[#0066CC] hover:-translate-y-0.5 active:scale-95 transform-gpu relative">
                        <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                        {rawSearch && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />}
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <GlassViewLayout icon={Package} title="Productos" filtersContent={filtersContent}>
            <div className={activeTab === 'catalogo' ? '' : 'hidden'}>
                <TabCatalogo
                    searchTerm={rawSearch}
                    filterActivo={filterActivo}
                    filterLab={filterLab}
                    filterCategoria={filterCategoria}
                    filterAntibiotico={filterAntibiotico}
                />
            </div>
            <div className={activeTab === 'inventario' ? '' : 'hidden'}>
                <TabInventario searchTerm={rawSearch} />
            </div>
        </GlassViewLayout>
    );
}
