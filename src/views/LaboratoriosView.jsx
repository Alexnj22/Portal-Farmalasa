import React, { useState, useEffect } from 'react';
import { FlaskConical } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabLaboratorios from './productos/TabLaboratorios';

export default function LaboratoriosView() {
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
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder="Buscar laboratorio o ubicación..."
            showSearch
        />
    );

    return (
        <GlassViewLayout icon={FlaskConical} title="Laboratorios" filtersContent={filtersContent}>
            <TabLaboratorios searchTerm={debouncedSearch} />
        </GlassViewLayout>
    );
}
