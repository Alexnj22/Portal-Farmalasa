import { supabase } from '../../supabaseClient';
import {
    fetchConteosInventario as fetchConteosInventarioData, fetchConteoDetalle as fetchConteoDetalleData,
    insertConteoItemManual,
} from '../../data/conteoInventario';

export const createConteoInventarioSlice = (set, get) => ({
    conteosInventario: [],
    conteosInventarioLoading: false,

    fetchConteosInventario: async () => {
        set({ conteosInventarioLoading: true });
        try {
            const { data, error } = await fetchConteosInventarioData();
            if (error) throw error;
            set({ conteosInventario: data || [] });
            return data || [];
        } catch (err) {
            console.error('Error obteniendo conteos de inventario:', err);
            return [];
        } finally {
            set({ conteosInventarioLoading: false });
        }
    },

    crearConteoInventario: async ({ branchId, scopeType, scopeFilter, erpProductIds }) => {
        const { data, error } = await supabase.rpc('crear_conteo_inventario', {
            p_branch_id: branchId,
            p_scope_type: scopeType,
            p_scope_filter: scopeFilter || null,
            p_erp_product_ids: erpProductIds || null,
        });
        if (error) throw error;

        await get().appendAuditLog('CONTEO_CREADO', data, {
            timeline_title: 'Conteo de inventario iniciado',
            dimension: 'OPERATIVE',
            branch_id: branchId,
            new_value: `Alcance: ${scopeType}`,
        });

        await get().fetchConteosInventario();
        return data;
    },

    fetchConteoDetalle: async (conteoId) => {
        const { data, error } = await fetchConteoDetalleData(conteoId);
        if (error) throw error;
        return data;
    },

    // p_limit/p_offset se pasan como parámetros de la función (no .range() de
    // PostgREST) — así el LIMIT se aplica DENTRO del SQL antes del lookup en
    // vivo a inventory, acotando ese costo al tamaño de página sin importar
    // el tamaño total del conteo (ver comentario en la migración de la RPC).
    fetchConteoItems: async (conteoId, { page = 1, pageSize = 50, search = '', filtro = 'TODOS' } = {}) => {
        const from = (page - 1) * pageSize;
        const [{ data: count, error: countErr }, { data: rows, error: rowsErr }] = await Promise.all([
            supabase.rpc('get_conteo_items_count', { p_conteo_id: conteoId, p_search: search || null, p_filtro: filtro }),
            supabase.rpc('get_conteo_items_search', { p_conteo_id: conteoId, p_search: search || null, p_filtro: filtro, p_limit: pageSize, p_offset: from }),
        ]);
        if (countErr) throw countErr;
        if (rowsErr) throw rowsErr;
        return { rows: rows || [], total: count || 0 };
    },

    // Paginación por PRODUCTO (no por fila) — así un producto con muchos
    // lotes nunca se parte entre dos páginas y el total agregado por
    // producto (sistema/físico/diferencia) siempre es exacto.
    fetchConteoProductsPage: async (conteoId, { page = 1, pageSize = 25, search = '', filtro = 'TODOS' } = {}) => {
        const from = (page - 1) * pageSize;
        const [{ data: count, error: countErr }, { data: rows, error: rowsErr }] = await Promise.all([
            supabase.rpc('get_conteo_products_count', { p_conteo_id: conteoId, p_search: search || null, p_filtro: filtro }),
            supabase.rpc('get_conteo_products_page', { p_conteo_id: conteoId, p_search: search || null, p_filtro: filtro, p_limit: pageSize, p_offset: from }),
        ]);
        if (countErr) throw countErr;
        if (rowsErr) throw rowsErr;
        return { rows: rows || [], total: count || 0 };
    },

    // Líneas (lote/presentación) de UN producto dentro del conteo — se piden
    // solo al expandir su fila de grupo. Un producto real nunca tiene miles
    // de lotes, pero se acota igual por seguridad.
    fetchConteoProductItems: async (conteoId, erpProductId) => {
        const { data, error } = await supabase.rpc('get_conteo_items_search', {
            p_conteo_id: conteoId, p_search: null, p_filtro: 'TODOS', p_limit: 500, p_offset: 0, p_erp_product_id: erpProductId,
        });
        if (error) throw error;
        return data || [];
    },

    fetchConteoExistingProductIds: async (conteoId) => {
        const { data, error } = await supabase.rpc('get_conteo_existing_product_ids', { p_conteo_id: conteoId });
        if (error) throw error;
        return data || [];
    },

    // Corrige la etiqueta de lote/vencimiento de una línea ya creada (ej. el
    // físico encontrado trae un lote distinto al que copió el snapshot) —
    // nunca toca la tabla inventory real, solo el snapshot de auditoría.
    editarLoteConteoItem: async (itemId, { lote, fechaVencimiento }) => {
        const { data, error } = await supabase.rpc('editar_lote_conteo_item', {
            p_item_id: itemId, p_lote: lote, p_fecha_vencimiento: fechaVencimiento || null,
        });
        if (error) throw error;
        return data;
    },

    // El "sistema" se congela EN EL SERVIDOR (guardar_conteo_item relee
    // inventory en vivo en ese instante) — el cliente nunca envía/decide ese
    // valor, para que un conteo "en caliente" (sucursal abierta, ventas
    // corriendo) compare contra el stock real vigente al momento de contar,
    // no contra un snapshot viejo. También registra el guardado en el
    // historial append-only del ítem (quién contó, incluidas ediciones).
    guardarConteoItem: async (itemId, { fisicoCantidad, nota, estadoItem }) => {
        const { data, error } = await supabase.rpc('guardar_conteo_item', {
            p_item_id: itemId,
            p_fisico_cantidad: fisicoCantidad,
            p_nota: nota ?? null,
            p_estado_item: estadoItem,
        });
        if (error) throw error;
        return data;
    },

    fetchConteoItemHistory: async (itemId) => {
        const { data, error } = await supabase.rpc('get_conteo_item_history', { p_item_id: itemId });
        if (error) throw error;
        return data || [];
    },

    agregarProductoManualConteo: async (conteoId, { erpProductId, presentacion, detalle, lote, fechaVencimiento, costoUnitario }) => {
        const { data, error } = await insertConteoItemManual({
            conteo_id: conteoId,
            erp_product_id: erpProductId,
            presentacion: presentacion || null,
            detalle: detalle || null,
            lote: lote || null,
            fecha_vencimiento: fechaVencimiento || null,
            is_vencidos: false,
            sistema_cantidad: 0,
            costo_unitario: costoUnitario ?? null,
            estado_item: 'PENDIENTE',
            es_agregado_manual: true,
        });
        if (error) throw error;
        return data;
    },

    finalizarConteoInventario: async (conteoId) => {
        const { data, error } = await supabase.rpc('finalizar_conteo_inventario', { p_conteo_id: conteoId });
        if (error) throw error;

        const detalle = await get().fetchConteoDetalle(conteoId);
        await get().appendAuditLog('CONTEO_FINALIZADO', conteoId, {
            timeline_title: 'Conteo de inventario finalizado',
            dimension: 'OPERATIVE',
            branch_id: detalle?.branch_id,
            new_value: `${data.total_diferencias} diferencia(s) — faltante $${Number(data.valor_faltante).toFixed(2)} · sobrante $${Number(data.valor_sobrante).toFixed(2)}`,
        });

        return data;
    },

    aprobarConteoInventario: async (conteoId, nota) => {
        const { data, error } = await supabase.rpc('aprobar_conteo_inventario', { p_conteo_id: conteoId, p_nota: nota || null });
        if (error) throw error;

        const detalle = await get().fetchConteoDetalle(conteoId);
        await get().appendAuditLog('CONTEO_APROBADO', conteoId, {
            timeline_title: 'Conteo de inventario aprobado',
            dimension: 'OPERATIVE',
            branch_id: detalle?.branch_id,
            new_value: nota || 'Sin nota',
        });

        return data;
    },

    fetchTodosLosItemsConteo: async (conteoId) => {
        const { data, error } = await supabase.rpc('get_conteo_items_jsonb', { p_conteo_id: conteoId });
        if (error) throw error;
        return data || [];
    },
});
