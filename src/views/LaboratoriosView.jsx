import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FlaskConical, MapPin, CalendarClock } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabLaboratorios from './productos/TabLaboratorios';
import TabPoliticaVencimiento from './productos/TabPoliticaVencimiento';

const TABS = [
    { key: 'ubicaciones', label: 'Ubicaciones',           icon: MapPin },
    { key: 'vencimiento',  label: 'Política de vencimiento', icon: CalendarClock },
];
const VALID_TABS = new Set(TABS.map(t => t.key));

export default function LaboratoriosView() {
    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab      = searchParams.get('tab');
    const activeTab   = VALID_TABS.has(rawTab) ? rawTab : 'ubicaciones';
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });

    const [rawSearch,       setRawSearch]       = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);

    // Montar al VISITAR, no al entrar. `hidden` esconde pero no desmonta, así
    // que abrir «Ubicaciones» también cargaba «Política de vencimiento» —sus
    // `laboratorios`, `proveedores` y `suppliers`—. Se quedan montadas después,
    // que es lo que el `hidden` compra: volver no re-pide ni pierde el filtro.
    const [visitadas, setVisitadas] = useState(() => new Set([activeTab]));
    if (!visitadas.has(activeTab)) setVisitadas(new Set(visitadas).add(activeTab));

    const searchPlaceholder = activeTab === 'vencimiento'
        ? 'Buscar laboratorio o proveedor...'
        : 'Buscar laboratorio o ubicación...';

    const filtersContent = (
        <ViewTabBar
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder={searchPlaceholder}
            showSearch
        />
    );

    return (
        <GlassViewLayout icon={FlaskConical} title="Laboratorios" filtersContent={filtersContent}>
            {visitadas.has('ubicaciones') && (
                <div className={activeTab === 'ubicaciones' ? '' : 'hidden'}>
                    <TabLaboratorios searchTerm={debouncedSearch} />
                </div>
            )}
            {visitadas.has('vencimiento') && (
                <div className={activeTab === 'vencimiento' ? '' : 'hidden'}>
                    <TabPoliticaVencimiento searchTerm={debouncedSearch} />
                </div>
            )}
        </GlassViewLayout>
    );
}
