import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, Settings2, BarChart2, Package, Truck } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabGenerar      from './pedidos/TabGenerar';
import TabPedidos      from './pedidos/TabPedidos';
import TabReglas       from './pedidos/TabReglas';
import TabMetricas     from './pedidos/TabMetricas';
import TabRutas        from './pedidos/TabRutas';
import { useAuth }     from '../context/AuthContext';

const TABS = [
    { key: 'generar',  label: 'Generar',           icon: ClipboardList, permKey: 'pedidos_tab_generar'   },
    { key: 'pedidos',  label: 'Pedidos',            icon: Package,       permKey: 'pedidos_tab_historial' },
    { key: 'rutas',    label: 'Historial Rutas',    icon: Truck,         permKey: 'pedidos_tab_rutas'     },
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
        <GlassViewLayout icon={ClipboardList} title="Pedidos a Sucursales" filtersContent={filtersContent}>
            {activeTab === 'generar'  && <TabGenerar  searchTerm={debouncedSearch} />}
            {activeTab === 'pedidos'  && <TabPedidos  searchTerm={debouncedSearch} />}
            {activeTab === 'rutas'    && <TabRutas    searchTerm={debouncedSearch} />}
            {activeTab === 'metricas' && <TabMetricas searchTerm={debouncedSearch} />}
            {activeTab === 'reglas'   && <TabReglas   searchTerm={debouncedSearch} />}
        </GlassViewLayout>
    );
}
