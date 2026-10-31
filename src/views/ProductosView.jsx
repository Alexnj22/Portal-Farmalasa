import React, { useState, useEffect } from 'react';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { useSearchParams } from 'react-router-dom';
import { Package, LayoutList, Boxes, Scale, TrendingDown } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabCatalogo     from './productos/TabCatalogo';
import TabPresentaciones from './productos/TabPresentaciones';
import TabRevisionFactor from './productos/TabRevisionFactor';
import TabRentabilidad from './productos/TabRentabilidad';
import { useAuth }     from '@nucleo/context/AuthContext';
import { fetchLaboratoriosBasic } from '@nucleo/data/laboratorios';
import { fetchProductCategories } from '@nucleo/data/inventarioTab';

// «Inventario» y «Gestión de Stock» se fueron de acá el 2026-08-08 (pedido del
// usuario) a `/inventario` y `/gestion-stock`, en el grupo Inventario del menú.
// Lo que queda son las dos caras del catálogo: la ficha del producto y el
// maestro de presentaciones en que se vende.
const TABS = [
    { key: 'catalogo',       label: 'Catálogo',       icon: LayoutList },
    { key: 'presentaciones', label: 'Presentaciones',  icon: Boxes      },
    // El tamaño de cada presentación y lo que pasa cuando cambia (2026-10-15).
    // Comparte el permiso de Presentaciones: es la misma pregunta —en qué se
    // vende cada producto— vista desde lo que no cuadra.
    { key: 'revision',       label: 'Revisión de factor', icon: Scale, permiso: 'presentaciones' },
    // Margen de la viñeta sobre el costo (2026-10-31): exige ver costos.
    { key: 'rentabilidad',   label: 'Rentabilidad', icon: TrendingDown, permiso: 'catalogo', costos: true },
];

export default function ProductosView() {
    // ── Tab + search ────────────────────────────────────────────────────────
    const { hasPermission } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const VALID        = new Set(TABS.map(t => t.key));
    const allowedTabs  = TABS.filter(t => hasPermission(`productos_tab_${t.permiso ?? t.key}`)
        && (!t.costos || hasPermission('productos_ver_costos')));
    const defaultTab   = allowedTabs[0]?.key ?? 'catalogo';
    const rawTab       = searchParams.get('tab');
    const activeTab    = VALID.has(rawTab) && allowedTabs.some(t => t.key === rawTab) ? rawTab : defaultTab;
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });

    const [rawSearch, setRawSearch, debouncedSearch] = useBusqueda();

    // ── Qué pestañas están MONTADAS ──────────────────────────────────────────
    // Las pestañas se montaban todas y las inactivas se escondían con
    // `hidden`. Esconder no desmonta: abrir una pestaña disparaba la carga de
    // todas, y como comparten el pool de PostgREST se hacían cola entre
    // ellas. Medido cuando «Gestión de Stock» vivía acá: 44 llamadas al entrar,
    // y su RPC más pesado tardaba 5.6 s contra los 1.1 s que tarda solo.
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
    // piden cuando esa pestaña se abre — no al entrar a cualquiera de ellas.
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

    const searchPlaceholder = activeTab === 'presentaciones'
        ? 'Buscar presentación...'
        : 'Buscar producto o principio activo...';

    const filtersContent = (
        <ViewTabBar
            tabs={allowedTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={rawSearch}
            // La revisión no tiene qué buscar: son pocas filas y todas importan.
            onSearchChange={activeTab === 'revision' ? undefined : setRawSearch}
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
            {visitadas.has('presentaciones') && (
                <div className={activeTab === 'presentaciones' ? '' : 'hidden'}>
                    <TabPresentaciones searchTerm={debouncedSearch} />
                </div>
            )}
            {visitadas.has('rentabilidad') && (
                <div className={activeTab === 'rentabilidad' ? '' : 'hidden'}>
                    <TabRentabilidad searchTerm={debouncedSearch} />
                </div>
            )}
            {visitadas.has('revision') && (
                <div className={activeTab === 'revision' ? '' : 'hidden'}>
                    <TabRevisionFactor />
                </div>
            )}
        </GlassViewLayout>
    );
}
