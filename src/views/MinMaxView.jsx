import React, { useState, useEffect, useCallback } from 'react';
import { BarChart2 } from 'lucide-react';
import GlassViewLayout    from '../components/GlassViewLayout';
import ViewTabBar         from '../components/common/ViewTabBar';
import TabMinMax             from './productos/TabMinMax';
import TabMinMaxNetwork      from './productos/TabMinMaxNetwork';
import TabMinMaxComparacion  from './productos/TabMinMaxComparacion';
import { supabase }      from '../supabaseClient';

const TABS = [
    { key: 'sucursal',    label: 'Sucursal'    },
    { key: 'red',         label: 'Red'         },
    { key: 'comparacion', label: 'vs ERP'      },
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
            activeTab === 'red'         ? 'Buscar en vista red…'        :
            activeTab === 'comparacion' ? 'Buscar en comparación ERP…'  :
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
            {activeTab === 'comparacion' && (
                <TabMinMaxComparacion searchTerm={debouncedSearch} />
            )}
        </GlassViewLayout>
    );
}
