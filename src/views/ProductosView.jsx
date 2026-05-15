import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, LayoutList, Boxes, Search, X, ChevronRight } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
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
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);
    const openSearch  = () => setIsSearchMode(true);
    const closeSearch = () => { setIsSearchMode(false); setRawSearch(''); };

    // ── Catálogo filters (live here, passed down to TabCatalogo which renders the pill) ──
    const [filterActivo,      setFilterActivo]      = useState('activos');
    const [filterLab,         setFilterLab]          = useState(null);
    const [filterCategoria,   setFilterCategoria]    = useState(null);
    const [filterAntibiotico, setFilterAntibiotico]  = useState(null);
    const [labs,              setLabs]               = useState([]);
    const [categorias,        setCategorias]         = useState([]);

    useEffect(() => {
        supabase.from('laboratorios').select('id, nombre').order('nombre')
            .then(({ data }) => setLabs(data || []));
        supabase.from('product_categories').select('nombre').order('nombre')
            .then(({ data }) => setCategorias((data || []).map(r => r.nombre)));
    }, []);

    const labOptions = labs.map(l => ({ value: String(l.id), label: l.nombre }));
    const catOptions = categorias.map(c => ({ value: c, label: c }));

    const handleCategoryCreated = (nombre) => {
        setCategorias(prev => [...prev, nombre].sort());
    };

    const searchPlaceholder = activeTab === 'catalogo'
        ? 'Buscar producto o principio activo...'
        : 'Buscar en inventario...';

    // ── filtersContent — one glass pill (tabs + search) matching Ventas ────────
    const filtersContent = (
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
    );

    return (
        <GlassViewLayout icon={Package} title="Productos" filtersContent={filtersContent}>
            <div className={activeTab === 'catalogo' ? '' : 'hidden'}>
                <TabCatalogo
                    searchTerm={debouncedSearch}
                    filterActivo={filterActivo}
                    setFilterActivo={setFilterActivo}
                    filterLab={filterLab}
                    setFilterLab={setFilterLab}
                    filterCategoria={filterCategoria}
                    setFilterCategoria={setFilterCategoria}
                    filterAntibiotico={filterAntibiotico}
                    setFilterAntibiotico={setFilterAntibiotico}
                    labOptions={labOptions}
                    catOptions={catOptions}
                    onCategoryCreated={handleCategoryCreated}
                />
            </div>
            <div className={activeTab === 'inventario' ? '' : 'hidden'}>
                <TabInventario searchTerm={debouncedSearch} />
            </div>
        </GlassViewLayout>
    );
}
