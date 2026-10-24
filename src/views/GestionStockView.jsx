import React, { lazy, Suspense, useCallback } from 'react';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { Activity, Archive, ListPlus, Loader2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { ERP_NAMES, ERP_BODEGA, MI_ERP_POR_BRANCH } from './inventario/salasDeStock';

// Cada pestaña llega por `lazy()` (2026-10-24), con el patrón de PedidosView:
// se ve UNA a la vez, y las dos viajaban juntas en el trozo de la vista.
// React se queda con el trozo después de la primera visita, así que sólo el
// primer clic de cada pestaña espera.
const TabParados   = lazy(() => import('./inventario/TabParados'));
const TabSinMinMax = lazy(() => import('./inventario/TabSinMinMax'));

// El área en blanco se lee como que algo se rompió: un giro del alto de una
// pestaña ya dibujada, para que nada salte al llegar.
const Cargando = () => (
    <div className="flex-1 min-h-[320px] grid place-items-center">
        <Loader2 size={24} className="animate-spin text-content-3" strokeWidth={2.5} />
    </div>
);

/**
 * Gestión de stock — dos preguntas sobre la existencia de una sala:
 *
 *  · **Productos sin venta**: lo que lleva seis meses sin venderse, agrupado por
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
    { key: 'parados',    label: 'Productos sin venta',  icon: Archive },
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

    const [rawSearch, setRawSearch, debouncedSearch] = useBusqueda();

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
            <Suspense fallback={<Cargando />}>
                {pestana === 'parados'
                    ? <TabParados key={sala} sala={sala} onSala={setSala} searchTerm={debouncedSearch} />
                    : <TabSinMinMax key={sala} sala={sala} onSala={setSala} searchTerm={debouncedSearch} />}
            </Suspense>
        </GlassViewLayout>
    );
}
