import React, { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabSinVenta     from './inventario/TabSinVenta';

/**
 * Gestión de Stock — vista propia desde v2.521.0 (pedido del usuario).
 *
 * Era la tercera pestaña de Productos. Salió de ahí porque no trata del
 * catálogo: pregunta qué se está vendiendo sin parámetros de reposición y qué
 * stock lleva medio año quieto — o sea, decisiones de inventario. Su vecindario
 * real es Min/Max, Ventas Perdidas y el Conteo, y ahí es donde vive ahora.
 *
 * El envoltorio es fino a propósito: el buscador rebotado y el layout son lo
 * único que la pestaña necesitaba del padre, y `TabSinVenta` ya trae su propia
 * `FilterBar` y sus tarjetas.
 */
export default function GestionStockView() {
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
            placeholder="Buscar producto o principio activo..."
            showSearch
        />
    );

    return (
        <GlassViewLayout icon={Activity} title="Gestión de stock" filtersContent={filtersContent}>
            <TabSinVenta searchTerm={debouncedSearch} />
        </GlassViewLayout>
    );
}
