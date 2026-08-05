import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, LayoutList, Boxes, Activity } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabCatalogo     from './productos/TabCatalogo';
import TabInventario   from './productos/TabInventario';
import TabSinVenta     from './productos/TabSinVenta';
import { useAuth }     from '../context/AuthContext';
import { fetchLaboratoriosBasic } from '../data/laboratorios';
import { fetchProductCategories } from '../data/inventarioTab';

const TABS = [
    { key: 'catalogo',   label: 'Catálogo',        icon: LayoutList },
    { key: 'inventario', label: 'Inventario',       icon: Boxes      },
    { key: 'sinventa',   label: 'Gestión de Stock', icon: Activity   },
];

export default function ProductosView() {
    // ── Tab + search ────────────────────────────────────────────────────────
    const { hasPermission } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const VALID        = new Set(['catalogo', 'inventario', 'sinventa']);
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

    // ── Qué pestañas están MONTADAS ──────────────────────────────────────────
    // Las tres se montaban siempre y las dos inactivas se escondían con
    // `hidden`. Esconder no desmonta: abrir una pestaña disparaba la carga de
    // las tres, y como comparten el pool de PostgREST se hacían cola entre
    // ellas. Medido al entrar a «Gestión de Stock»: 44 llamadas, y su RPC más
    // pesado tardaba 5.6 s contra los 1.1 s que tarda el mismo RPC solo.
    //
    // Se montan al VISITARLAS y se quedan montadas — que es lo que el `hidden`
    // compraba de verdad: volver a una pestaña no vuelve a pedir sus datos ni
    // pierde su filtro. Lo que se tira es la carga de lo que nunca se abrió.
    //
    // El `set` se ajusta DURANTE el render, no en un efecto: es el patrón que
    // React documenta para derivar estado de una prop que cambió, y acá además
    // es lo correcto — en un efecto, la pestaña recién pedida se montaría un
    // render TARDE, o sea que al cambiar de pestaña se vería un hueco antes de
    // que apareciera. React descarta el render en curso y rehace este mismo
    // componente enseguida, sin pintar el intermedio.
    const [visitadas, setVisitadas] = useState(() => new Set([activeTab]));
    if (!visitadas.has(activeTab)) setVisitadas(new Set(visitadas).add(activeTab));

    // ── Catálogo filters (live here, passed down to TabCatalogo which renders the pill) ──
    const [filterActivo,      setFilterActivo]      = useState('activos');
    const [filterLab,         setFilterLab]          = useState(null);
    const [filterCategoria,   setFilterCategoria]    = useState(null);
    const [labs,              setLabs]               = useState([]);
    const [categorias,        setCategorias]         = useState([]);

    // Sus dos catálogos solo alimentan los filtros de TabCatalogo, así que se
    // piden cuando esa pestaña se abre — no al entrar a cualquiera de las tres.
    // (TabInventario pide los suyos por su cuenta; por eso `product_categories`
    // se veía dos veces en la red al abrir Inventario.)
    const verCatalogo = visitadas.has('catalogo');
    useEffect(() => {
        if (!verCatalogo) return;
        fetchLaboratoriosBasic()
            .then(({ data }) => setLabs(data || []));
        fetchProductCategories()
            .then(({ data }) => setCategorias((data || []).map(r => r.nombre)));
    }, [verCatalogo]);

    const labOptions = labs.map(l => ({ value: String(l.id), label: l.nombre }));
    const catOptions = categorias.map(c => ({ value: c, label: c }));

    const handleCategoryCreated = (nombre) => {
        setCategorias(prev => [...prev, nombre].sort());
    };

    const searchPlaceholder = activeTab === 'catalogo'
        ? 'Buscar producto o principio activo...'
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
            {visitadas.has('catalogo') && (
                <div className={activeTab === 'catalogo' ? '' : 'hidden'}>
                    <TabCatalogo
                        searchTerm={debouncedSearch}
                        filterActivo={filterActivo}
                        setFilterActivo={setFilterActivo}
                        filterLab={filterLab}
                        setFilterLab={setFilterLab}
                        filterCategoria={filterCategoria}
                        setFilterCategoria={setFilterCategoria}
                        labOptions={labOptions}
                        catOptions={catOptions}
                        onCategoryCreated={handleCategoryCreated}
                    />
                </div>
            )}
            {visitadas.has('inventario') && (
                <div className={activeTab === 'inventario' ? '' : 'hidden'}>
                    <TabInventario searchTerm={debouncedSearch} />
                </div>
            )}
            {visitadas.has('sinventa') && (
                <div className={activeTab === 'sinventa' ? '' : 'hidden'}>
                    <TabSinVenta searchTerm={debouncedSearch} />
                </div>
            )}
        </GlassViewLayout>
    );
}
