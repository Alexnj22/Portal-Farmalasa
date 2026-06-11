import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, History, Settings2, PackageCheck, TrendingDown } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabGenerar      from './pedidos/TabGenerar';
import TabHistorial    from './pedidos/TabHistorial';
import TabReglas       from './pedidos/TabReglas';
import TabRecepcion    from './pedidos/TabRecepcion';
import TabDiferencias  from './pedidos/TabDiferencias';
import { useAuth }     from '../context/AuthContext';

const TABS = [
    { key: 'generar',      label: 'Generar',            icon: ClipboardList },
    { key: 'historial',    label: 'Historial',           icon: History       },
    { key: 'reglas',       label: 'Reglas de despacho',  icon: Settings2     },
    { key: 'recepcion',    label: 'Recepción',           icon: PackageCheck  },
    { key: 'diferencias',  label: 'Diferencias',         icon: TrendingDown  },
];

const SEARCH_PLACEHOLDER = {
    generar:     'Buscar producto en el pedido…',
    historial:   'Buscar pedido…',
    reglas:      'Buscar producto en reglas…',
    recepcion:   'Buscar pedido…',
    diferencias: 'Buscar producto…',
};

export default function PedidosView() {
    const { hasPermission } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const VALID       = new Set(['generar', 'historial', 'reglas', 'recepcion', 'diferencias']);
    const allowedTabs = TABS.filter(t => hasPermission(`pedidos_tab_${t.key}`));
    const defaultTab  = allowedTabs[0]?.key ?? 'generar';
    const rawTab      = searchParams.get('tab');
    const activeTab   = VALID.has(rawTab) && allowedTabs.some(t => t.key === rawTab) ? rawTab : defaultTab;

    const setActiveTab = (tab) => {
        setSearchParams(p => { p.set('tab', tab); return p; });
        setRawSearch('');
    };

    const [rawSearch,       setRawSearch]       = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [historialKey,    setHistorialKey]    = useState(0);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);

    const handleTabChange = (tab) => {
        setSearchParams(p => { p.set('tab', tab); return p; });
        setRawSearch('');
        if (tab === 'historial') setHistorialKey(k => k + 1);
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
            <div className={activeTab === 'generar'   ? '' : 'hidden'}><TabGenerar    searchTerm={debouncedSearch} /></div>
            <div className={activeTab === 'historial' ? '' : 'hidden'}><TabHistorial  searchTerm={debouncedSearch} refreshKey={historialKey} /></div>
            <div className={activeTab === 'reglas'    ? '' : 'hidden'}><TabReglas     searchTerm={debouncedSearch} /></div>
            <div className={activeTab === 'recepcion'   ? '' : 'hidden'}><TabRecepcion   searchTerm={debouncedSearch} refreshKey={historialKey} /></div>
            <div className={activeTab === 'diferencias' ? '' : 'hidden'}><TabDiferencias searchTerm={debouncedSearch} /></div>
        </GlassViewLayout>
    );
}
