import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Archive, ListPlus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import { usePestanaEnUrl } from '../hooks/usePestanaEnUrl';
import { useAuth } from '../context/AuthContext';
import TabParados   from './inventario/TabParados';
import TabSinMinMax from './inventario/TabSinMinMax';
import { ERP_NAMES, ERP_BODEGA, MI_ERP_POR_BRANCH } from './inventario/salasDeStock';

/**
 * Gestión de stock — dos preguntas sobre la existencia de una sala:
 *
 *  · **Productos parados**: lo que lleva seis meses sin venderse, agrupado por
 *    adónde mandarlo, con el envío a un clic. Es lo que abre el aviso semanal.
 *  · **Vendidos sin Min/Max**: lo que sí se vende y el pedido no repone solo.
 *
 * Eran dos modos de un segmentado dentro de la pestaña, y los dos se cargaban
 * siempre aunque se viera uno. Hoy son pestañas de la vista —en la dirección,
 * como todas (`usePestanaEnUrl`)— y cada una carga lo suyo al abrirse.
 *
 * La sala también vive en la dirección (`?sala=`) y es la MISMA para las dos:
 * cambiar de pestaña no la pierde. Sin ella, la de quien entra; Bodega no
 * vende al público, así que ahí «sin venta» no dice nada y se abre La Popular.
 */
const PESTANAS = [
    { key: 'parados',    label: 'Productos parados',    icon: Archive },
    { key: 'sin_minmax', label: 'Vendidos sin Min/Max', icon: ListPlus },
];

export default function GestionStockView() {
    const { user } = useAuth();
    const [pestana, setPestana] = usePestanaEnUrl(PESTANAS, 'parados');
    const [searchParams, setSearchParams] = useSearchParams();

    const deLaUrl = Number(searchParams.get('sala'));
    const propia = MI_ERP_POR_BRANCH[user?.branchId ?? user?.branch_id];
    const sala = ERP_NAMES[deLaUrl] && deLaUrl !== ERP_BODEGA ? deLaUrl
        : (propia && propia !== ERP_BODEGA ? propia : 5);
    const setSala = useCallback((erp) => {
        setSearchParams(p => { p.set('sala', String(erp)); return p; }, { replace: true });
    }, [setSearchParams]);

    const [rawSearch,       setRawSearch]       = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);

    const filtersContent = (
        <ViewTabBar
            tabs={PESTANAS}
            activeTab={pestana}
            onTabChange={setPestana}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder="Buscar producto o laboratorio..."
            showSearch
        />
    );

    return (
        <GlassViewLayout icon={Activity} title="Gestión de stock" filtersContent={filtersContent}>
            {pestana === 'parados'
                ? <TabParados key={sala} sala={sala} onSala={setSala} searchTerm={debouncedSearch} />
                : <TabSinMinMax key={sala} sala={sala} onSala={setSala} searchTerm={debouncedSearch} />}
        </GlassViewLayout>
    );
}
