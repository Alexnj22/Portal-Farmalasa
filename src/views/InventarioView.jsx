import React, { useState, useEffect } from 'react';
import { Boxes } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import TabInventario   from './inventario/TabInventario';

/**
 * Inventario — vista propia desde v2.521.0 (pedido del usuario).
 *
 * Era la segunda pestaña de Productos. La existencia por sucursal, sus lotes y
 * sus vencimientos no son una propiedad del catálogo: son el estado de la
 * bodega hoy, y quien los consulta no está mirando fichas de producto. Pasa al
 * grupo Inventario, junto a Gestión de Stock y el Conteo.
 *
 * Igual que su hermana, el envoltorio solo aporta el buscador rebotado y el
 * layout — `TabInventario` trae su propia `FilterBar`, sus tarjetas y su
 * paginación.
 */
export default function InventarioView() {
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
            placeholder="Buscar en inventario..."
            showSearch
        />
    );

    return (
        <GlassViewLayout icon={Boxes} title="Inventario" filtersContent={filtersContent}>
            <TabInventario searchTerm={debouncedSearch} />
        </GlassViewLayout>
    );
}
