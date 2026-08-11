import React, { useState, useEffect, useCallback } from 'react';
import { BarChart2 } from 'lucide-react';
import GlassViewLayout    from '../components/GlassViewLayout';
import ViewTabBar         from '../components/common/ViewTabBar';
import TabMinMax          from './productos/TabMinMax';
import { useAuth }       from '../context/AuthContext';
import { fetchStockConfigFull, fetchErpSucursalIdForBranchLocked } from '../data/stockParams';

// La pestaña «Red» se retiró el 2026-08-09 a pedido del usuario: «no se me es de
// utilidad». Se fue entera —vista, permiso `minmax_tab_red` y el RPC
// `get_network_summary_json`, que no tenía otro consumidor— en vez de quedar
// escondida detrás de un permiso apagado. Una vista que nadie abre pero que
// sigue en el registro es deuda que parece función.
const ALL_MINMAX_TABS = [
    { key: 'sucursal', label: 'Sucursal' },
];

const DEFAULT_CONFIG = {
    cycle_days:      45,
    reorder_x_days:  7,
    reorder_y_days:  10,
    reorder_z_days:  15,
    xyz_x_percentile: 5,
    xyz_y_percentile: 35,
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
    // La pestaña «Solicitudes» se quitó el 2026-08-10 (decisión del usuario:
    // «quita el de min y max, lo siento innecesario»). Los ajustes pendientes
    // viven ahora en el centro de solicitudes junto al resto de lo que pide la
    // sala, que es donde se los va a buscar. Se resuelven ahí con la MISMA RPC
    // y con este mismo permiso (`minmax.can_approve`): lo que se fue es la
    // segunda puerta, no la llave.
    //
    // Lo que la pestaña tenía y el centro no: aprobar en lote. Se descartó a
    // sabiendas — con dos puertas al mismo cuarto, la que se usa menos se queda
    // vieja, que es exactamente lo que le pasó al detalle de las solicitudes
    // (dos copias, una con 10 tipos y otra con 2).
    const TABS = ALL_MINMAX_TABS.filter(t => hasPermission(`minmax_tab_${t.key}`));

    const [activeTab,       setActiveTab]       = useState(TABS[0]?.key ?? 'sucursal');
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
            activeTab === 'solicitudes' ? 'Buscar solicitud…'
                                        : 'Buscar producto en Min/Max…'
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
        </GlassViewLayout>
    );
}
