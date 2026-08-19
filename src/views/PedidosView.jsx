import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, Loader2, Settings2, BarChart2, Package, Truck } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import { useAuth }     from '../context/AuthContext';

// ── Cada pestaña se baja al abrirla, no al entrar (2026-08-19) ─────────────
//
// Las cinco viajaban en el mismo trozo que la vista, así que abrir Pedidos
// descargaba TODAS —con RecepcionModal (1,959 líneas), CrearRutaModal (812),
// RutaMapModal (565) y FinalizarCajasModal (516) adentro— para mirar una. Era
// la segunda vista más pesada del portal y el `gate:bundle` la marcaba desde
// que se le fijó el techo el 2026-07-30.
//
// Es la misma movida que ya funcionó dos veces acá: recharts fuera del Inicio
// (204 → 103 kB, v2.521.2) y los cuatro formularios del tablero (133 → 86 kB,
// v2.615.1). El patrón es el de aquéllos —`lazy()` + `Suspense`— y no hay
// precarga a propósito: React se queda con el trozo después de la primera
// visita, así que sólo el primer clic de cada pestaña espera, y adelantar los
// cinco sería volver a bajar lo que este cambio dejó de bajar.
const TabGenerar  = lazy(() => import('./pedidos/TabGenerar'));
const TabPedidos  = lazy(() => import('./pedidos/TabPedidos'));
const TabReglas   = lazy(() => import('./pedidos/TabReglas'));
const TabMetricas = lazy(() => import('./pedidos/TabMetricas'));
const TabRutas    = lazy(() => import('./pedidos/TabRutas'));

// El área de la pestaña en blanco se lee como que algo se rompió. Ocupa el
// alto de una pestaña ya dibujada para que la barra de arriba no salte.
const Cargando = () => (
    <div className="flex-1 min-h-[320px] grid place-items-center">
        <Loader2 size={24} className="animate-spin text-content-3" strokeWidth={2.5} />
    </div>
);

const TABS = [
    { key: 'generar',  label: 'Generar',           icon: ClipboardList, permKey: 'pedidos_tab_generar'   },
    { key: 'pedidos',  label: 'Pedidos',            icon: Package,       permKey: 'pedidos_tab_historial' },
    // «Historial Rutas» decía dos cosas mal: la pestaña muestra también las
    // rutas ACTIVAS —no es un historial— y el catálogo de permisos ya nombra
    // esta misma superficie «Rutas de entrega». Un nombre por cosa.
    { key: 'rutas',    label: 'Rutas de entrega',   icon: Truck,         permKey: 'pedidos_tab_rutas'     },
    { key: 'metricas', label: 'Métricas',           icon: BarChart2,     permKey: 'pedidos_tab_metricas'  },
    { key: 'reglas',   label: 'Reglas de despacho', icon: Settings2,     permKey: 'pedidos_tab_reglas'    },
];

const VALID = new Set(TABS.map(t => t.key));

const SEARCH_PLACEHOLDER = {
    generar:  'Buscar producto en el pedido…',
    pedidos:  'Buscar pedido…',
    rutas:    'Buscar conductor o ruta…',
    metricas: 'Buscar sucursal…',
    reglas:   'Buscar producto en reglas…',
};

export default function PedidosView() {
    const { hasPermission } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const allowedTabs = TABS.filter(t => hasPermission(t.permKey));
    const defaultTab  = allowedTabs[0]?.key ?? 'generar';
    const rawTab      = searchParams.get('tab');
    const activeTab   = VALID.has(rawTab) && allowedTabs.some(t => t.key === rawTab) ? rawTab : defaultTab;

    const [rawSearch,       setRawSearch]       = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);

    const handleTabChange = (tab) => {
        setSearchParams(p => { p.set('tab', tab); return p; });
        setRawSearch('');
    };

    const filtersContent = (
        <ViewTabBar
            tabs={allowedTabs}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder={SEARCH_PLACEHOLDER[activeTab] ?? 'Buscar…'}
        />
    );

    return (
        <GlassViewLayout icon={ClipboardList} title="Pedidos a sucursales" filtersContent={filtersContent}>
            {/* La barra de pestañas y el buscador quedan FUERA: son de la
                vista, no de la pestaña, y tienen que seguir respondiendo
                mientras el trozo de la pestaña llega. */}
            <Suspense fallback={<Cargando />}>
                {activeTab === 'generar'  && <TabGenerar  searchTerm={debouncedSearch} />}
                {activeTab === 'pedidos'  && <TabPedidos  searchTerm={debouncedSearch} />}
                {activeTab === 'rutas'    && <TabRutas    searchTerm={debouncedSearch} />}
                {activeTab === 'metricas' && <TabMetricas searchTerm={debouncedSearch} />}
                {activeTab === 'reglas'   && <TabReglas   searchTerm={debouncedSearch} />}
            </Suspense>
        </GlassViewLayout>
    );
}
