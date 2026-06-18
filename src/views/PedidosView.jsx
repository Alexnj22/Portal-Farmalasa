import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, History, Settings2, PackageCheck, TrendingDown, Activity, BarChart2 } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabGenerar      from './pedidos/TabGenerar';
import TabHistorial    from './pedidos/TabHistorial';
import TabReglas       from './pedidos/TabReglas';
import TabRecepcion    from './pedidos/TabRecepcion';
import TabDiferencias  from './pedidos/TabDiferencias';
import TabEnCurso      from './pedidos/TabEnCurso';
import TabMetricas     from './pedidos/TabMetricas';
import { useAuth }     from '../context/AuthContext';

// permKey define qué permiso gatea la visibilidad del tab.
// En curso y Métricas usan el mismo permiso que Historial (acceso de bodega).
const TABS = [
    { key: 'generar',     label: 'Generar',            icon: ClipboardList, permKey: 'pedidos_tab_generar'     },
    { key: 'historial',   label: 'Historial',           icon: History,       permKey: 'pedidos_tab_historial'   },
    { key: 'en_curso',    label: 'En curso',            icon: Activity,      permKey: 'pedidos_tab_historial'   },
    { key: 'metricas',    label: 'Métricas',            icon: BarChart2,     permKey: 'pedidos_tab_historial'   },
    { key: 'reglas',      label: 'Reglas de despacho',  icon: Settings2,     permKey: 'pedidos_tab_reglas'      },
    { key: 'recepcion',   label: 'Recepción',           icon: PackageCheck,  permKey: 'pedidos_tab_recepcion'   },
    { key: 'diferencias', label: 'Diferencias',         icon: TrendingDown,  permKey: 'pedidos_tab_diferencias' },
];

const VALID = new Set(TABS.map(t => t.key));

const SEARCH_PLACEHOLDER = {
    generar:     'Buscar producto en el pedido…',
    historial:   'Buscar pedido…',
    en_curso:    'Buscar pedido…',
    metricas:    'Buscar sucursal…',
    reglas:      'Buscar producto en reglas…',
    recepcion:   'Buscar pedido…',
    diferencias: 'Buscar producto…',
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
    const [historialKey,    setHistorialKey]    = useState(0);
    const [recepcionKey,    setRecepcionKey]    = useState(0);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);

    const handleTabChange = (tab) => {
        setSearchParams(p => { p.set('tab', tab); return p; });
        setRawSearch('');
        if (tab === 'historial') setHistorialKey(k => k + 1);
        if (tab === 'recepcion') setRecepcionKey(k => k + 1);
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
        <GlassViewLayout icon={ClipboardList} title="Pedidos a Sucursales" filtersContent={filtersContent}>
            {activeTab === 'generar'     && <TabGenerar     searchTerm={debouncedSearch} />}
            {activeTab === 'historial'   && <TabHistorial   searchTerm={debouncedSearch} refreshKey={historialKey} />}
            {activeTab === 'en_curso'    && <TabEnCurso     searchTerm={debouncedSearch} />}
            {activeTab === 'metricas'    && <TabMetricas    searchTerm={debouncedSearch} />}
            {activeTab === 'reglas'      && <TabReglas      searchTerm={debouncedSearch} />}
            {activeTab === 'recepcion'   && <TabRecepcion   searchTerm={debouncedSearch} refreshKey={recepcionKey} />}
            {activeTab === 'diferencias' && <TabDiferencias searchTerm={debouncedSearch} />}
        </GlassViewLayout>
    );
}
