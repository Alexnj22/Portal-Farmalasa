import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tag, Gift, History } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabPromos       from './promociones/TabPromos';
import TabBonificaciones from './promociones/TabBonificaciones';
import TabHistorial    from './promociones/TabHistorial';
import { useAuth }     from '../context/AuthContext';

const TABS = [
    { key: 'activas',        label: 'Promociones', icon: Tag     },
    { key: 'bonificaciones', label: 'Bonificaciones', icon: Gift  },
    { key: 'historial',      label: 'Historial',   icon: History  },
];

export default function PromocionesView() {
    const { hasPermission } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const VALID       = new Set(TABS.map(t => t.key));
    const rawTab      = searchParams.get('tab');
    const activeTab   = VALID.has(rawTab) ? rawTab : 'activas';
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });

    const [rawSearch,       setRawSearch]       = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 300);
        return () => clearTimeout(t);
    }, [rawSearch]);

    const canEdit = hasPermission('promociones', 'can_edit');

    const placeholders = {
        activas:        'Buscar promoción o producto...',
        bonificaciones: 'Buscar empleado...',
        historial:      'Buscar en historial...',
    };

    const filtersContent = (
        <ViewTabBar
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder={placeholders[activeTab]}
        />
    );

    return (
        <GlassViewLayout icon={Tag} title="Promociones" filtersContent={filtersContent}>
            <div className={activeTab === 'activas' ? '' : 'hidden'}>
                <TabPromos searchTerm={debouncedSearch} canEdit={canEdit} />
            </div>
            <div className={activeTab === 'bonificaciones' ? '' : 'hidden'}>
                <TabBonificaciones searchTerm={debouncedSearch} canEdit={canEdit} />
            </div>
            <div className={activeTab === 'historial' ? '' : 'hidden'}>
                <TabHistorial searchTerm={debouncedSearch} />
            </div>
        </GlassViewLayout>
    );
}
