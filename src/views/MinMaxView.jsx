import React, { useState, useEffect } from 'react';
import { BarChart2 } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabMinMax       from './productos/TabMinMax';

export default function MinMaxView() {
    const [rawSearch,       setRawSearch]       = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);

    const filtersContent = (
        <ViewTabBar
            tabs={[]}
            activeTab=""
            onTabChange={() => {}}
            showSearch
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder="Buscar producto en Min/Max..."
        />
    );

    return (
        <GlassViewLayout icon={BarChart2} title="Min / Max" filtersContent={filtersContent}>
            <TabMinMax searchTerm={debouncedSearch} />
        </GlassViewLayout>
    );
}
