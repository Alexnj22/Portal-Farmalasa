import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, LayoutList, Boxes, BarChart2, Activity } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabCatalogo     from './productos/TabCatalogo';
import TabInventario   from './productos/TabInventario';
import TabMinMax       from './productos/TabMinMax';
import TabSinVenta     from './productos/TabSinVenta';
import { supabase }    from '../supabaseClient';
import { useAuth }     from '../context/AuthContext';

const TABS = [
    { key: 'catalogo',   label: 'Catálogo',   icon: LayoutList },
    { key: 'inventario', label: 'Inventario',  icon: Boxes      },
    { key: 'minmax',     label: 'Min/Max',     icon: BarChart2  },
    { key: 'sinventa',   label: 'Gestión de Stock', icon: Activity },
];

export default function ProductosView() {
    // ── Tab + search ────────────────────────────────────────────────────────
    const { hasPermission } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const VALID        = new Set(['catalogo', 'inventario', 'minmax', 'sinventa']);
    const allowedTabs  = TABS.filter(t => hasPermission(`productos_tab_${t.key}`));
    const defaultTab   = allowedTabs[0]?.key ?? 'catalogo';
    const rawTab       = searchParams.get('tab');
    const activeTab    = VALID.has(rawTab) && allowedTabs.some(t => t.key === rawTab) ? rawTab : defaultTab;
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });

    const [rawSearch,       setRawSearch]       = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);

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
        : activeTab === 'minmax'
        ? 'Buscar en Min/Max...'
        : activeTab === 'sinventa'
        ? 'Buscar en Gestión de Stock...'
        : 'Buscar en inventario...';

    const filtersContent = (
        <ViewTabBar
            tabs={allowedTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder={searchPlaceholder}
        />
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
            <div className={activeTab === 'minmax' ? '' : 'hidden'}>
                <TabMinMax searchTerm={debouncedSearch} />
            </div>
            <div className={activeTab === 'sinventa' ? '' : 'hidden'}>
                <TabSinVenta searchTerm={debouncedSearch} />
            </div>
        </GlassViewLayout>
    );
}
