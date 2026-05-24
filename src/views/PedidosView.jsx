import React from 'react';
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

export default function PedidosView() {
    const { hasPermission } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const VALID       = new Set(['generar', 'historial', 'reglas']);
    const allowedTabs = TABS.filter(t => hasPermission(`pedidos_tab_${t.key}`));
    const defaultTab  = allowedTabs[0]?.key ?? 'generar';
    const rawTab      = searchParams.get('tab');
    const activeTab   = VALID.has(rawTab) && allowedTabs.some(t => t.key === rawTab) ? rawTab : defaultTab;

    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });

    return (
        <GlassViewLayout icon={ClipboardList} title="Pedidos a Sucursales">
            <ViewTabBar
                tabs={allowedTabs}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                showSearch={false}
            />
            <div className="flex-1 overflow-y-auto">
                {activeTab === 'generar'   && <TabGenerar />}
                {activeTab === 'historial' && <TabHistorial />}
                {activeTab === 'reglas'    && <TabReglas />}
            </div>
        </GlassViewLayout>
    );
}
