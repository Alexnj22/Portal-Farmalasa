import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, History, Settings2 } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabGenerar      from './pedidos/TabGenerar';
import TabHistorial    from './pedidos/TabHistorial';
import TabReglas       from './pedidos/TabReglas';
import { useAuth }     from '../context/AuthContext';

const TABS = [
    { key: 'generar',   label: 'Generar',           icon: ClipboardList },
    { key: 'historial', label: 'Historial',          icon: History       },
    { key: 'reglas',    label: 'Reglas de despacho', icon: Settings2     },
];

const SEARCH_PLACEHOLDER = {
    generar:   'Buscar producto en el pedido…',
    historial: 'Buscar pedido…',
    reglas:    'Buscar producto en reglas…',
};

export default function PedidosView() {
    const { hasPermission } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const VALID       = new Set(['generar', 'historial', 'reglas']);
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
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);

    const filtersContent = (
        <ViewTabBar
            tabs={allowedTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder={SEARCH_PLACEHOLDER[activeTab] ?? 'Buscar…'}
        />
    );

    return (
        <GlassViewLayout icon={ClipboardList} title="Pedidos a Sucursales" filtersContent={filtersContent}>
            <div className={activeTab === 'generar'   ? '' : 'hidden'}><TabGenerar   searchTerm={debouncedSearch} /></div>
            <div className={activeTab === 'historial' ? '' : 'hidden'}><TabHistorial searchTerm={debouncedSearch} /></div>
            <div className={activeTab === 'reglas'    ? '' : 'hidden'}><TabReglas    searchTerm={debouncedSearch} /></div>
        </GlassViewLayout>
    );
}
