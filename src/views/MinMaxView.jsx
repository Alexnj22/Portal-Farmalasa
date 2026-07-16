import React, { useState, useEffect, useCallback } from 'react';
import { BarChart2 } from 'lucide-react';
import GlassViewLayout    from '../components/GlassViewLayout';
import ViewTabBar         from '../components/common/ViewTabBar';
import TabMinMax          from './productos/TabMinMax';
import TabMinMaxNetwork   from './productos/TabMinMaxNetwork';
import TabMinMaxRequests  from './productos/TabMinMaxRequests';
import { useAuth }       from '../context/AuthContext';
import { fetchStockConfigFull, fetchErpSucursalIdForBranchLocked } from '../data/stockParams';

const ALL_MINMAX_TABS = [
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
    const { user, hasPermission, getScope } = useAuth();
    const canApprove = hasPermission('minmax', 'can_approve');
    const BASE_TABS = ALL_MINMAX_TABS.filter(t => hasPermission(`minmax_tab_${t.key}`));
    const TABS = canApprove && hasPermission('minmax_tab_solicitudes')
        ? [...BASE_TABS, { key: 'solicitudes', label: 'Solicitudes' }]
        : BASE_TABS;

    const [activeTab,       setActiveTab]       = useState('sucursal');
    const [rawSearch,       setRawSearch]       = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [config,          setConfig]          = useState(DEFAULT_CONFIG);
    const [configLoaded,    setConfigLoaded]    = useState(false);
    const [lockedErpId,     setLockedErpId]     = useState(null);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);

    const loadConfig = useCallback(async () => {
        const { data, error } = await fetchStockConfigFull();
        if (error) console.error('MinMaxView: fetch stock_config failed:', error.message);
        if (data) setConfig({ ...DEFAULT_CONFIG, ...data });
        setConfigLoaded(true);
    }, []);

    useEffect(() => { loadConfig(); }, [loadConfig]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    useEffect(() => {
        if (getScope('minmax') !== 'BRANCH' || !user?.branchId) return;
        fetchErpSucursalIdForBranchLocked(user.branchId)
            .then(({ data }) => { if (data?.erp_sucursal_id) setLockedErpId(data.erp_sucursal_id); });
    }, [user?.branchId, getScope]);

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
                    lockedErpId={lockedErpId}
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
