import React, { useState, useEffect, useCallback } from 'react';
import { BarChart2 } from 'lucide-react';
import GlassViewLayout    from '../components/GlassViewLayout';
import ViewTabBar         from '../components/common/ViewTabBar';
import TabMinMax          from './productos/TabMinMax';
import TabMinMaxNetwork   from './productos/TabMinMaxNetwork';
import TabMinMaxRequests  from './productos/TabMinMaxRequests';
import { supabase }      from '../supabaseClient';
import { useAuth }       from '../context/AuthContext';

const BASE_TABS = [
    { key: 'sucursal', label: 'Sucursal' },
    { key: 'red',      label: 'Red'      },
];

const DEFAULT_CONFIG = {
    cycle_days:      45,
    reorder_x_days:  7,
    reorder_y_days:  10,
    reorder_z_days:  15,
    xyz_x_cv_max:    150,
    xyz_y_cv_max:    400,
    abc_a_pct:       70,
    abc_b_pct:       90,
    analysis_days:   180,
    approaching_pct: 25,
    buffer_x_days:   0,
    buffer_y_days:   0,
    buffer_z_days:   0,
};

export default function MinMaxView() {
    const { hasPermission } = useAuth();
    const canApprove = hasPermission('minmax', 'can_approve');
    const TABS = canApprove
        ? [...BASE_TABS, { key: 'solicitudes', label: 'Solicitudes' }]
        : BASE_TABS;

    const [activeTab,       setActiveTab]       = useState('sucursal');
    const [rawSearch,       setRawSearch]       = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [config,          setConfig]          = useState(DEFAULT_CONFIG);
    const [configLoaded,    setConfigLoaded]    = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);

    const loadConfig = useCallback(async () => {
        const { data } = await supabase.from('stock_config').select('*').eq('id', 1).maybeSingle();
        if (data) setConfig({ ...DEFAULT_CONFIG, ...data });
        setConfigLoaded(true);
    }, []);

    useEffect(() => { loadConfig(); }, [loadConfig]);

    const filtersContent = (
        <ViewTabBar
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={v => { setActiveTab(v); setRawSearch(''); }}
            showSearch
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder={
            activeTab === 'red'         ? 'Buscar en vista red…'  :
            activeTab === 'solicitudes' ? 'Buscar solicitud…'     :
                                         'Buscar producto en Min/Max…'
        }
        />
    );

    return (
        <GlassViewLayout icon={BarChart2} title="Min / Max" filtersContent={filtersContent}>
            {configLoaded && activeTab === 'sucursal' && (
                <TabMinMax
                    searchTerm={debouncedSearch}
                    config={config}
                    onConfigChange={setConfig}
                />
            )}
            {configLoaded && activeTab === 'red' && (
                <TabMinMaxNetwork searchTerm={debouncedSearch} />
            )}
            {canApprove && activeTab === 'solicitudes' && (
                <TabMinMaxRequests searchTerm={debouncedSearch} />
            )}
        </GlassViewLayout>
    );
}
