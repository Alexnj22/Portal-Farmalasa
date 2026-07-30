import { supabase } from '../../supabaseClient';
import {
    fetchConteosInventario as fetchConteosInventarioData, fetchConteoDetalle as fetchConteoDetalleData,
} from '../../data/conteoInventario';
import { signPhotosDeep } from '../../utils/storageFiles';
import { formatMoney } from '../../utils/formatNumber';

// Las RPCs del módulo levantan códigos, no frases. Sin esta traducción el
// usuario veía el identificador crudo de Postgres en el toast.
const ERRORES = {
    SIN_PERMISO: 'No tenés permiso para esta acción.',
    FUERA_DE_ALCANCE: 'Ese conteo pertenece a otra sucursal.',
    ALCANCE_INVALIDO: 'El alcance del conteo no es válido.',
    SUCURSAL_SIN_MAPEO_ERP: 'Esta sucursal no está mapeada al ERP: no se puede tomar el inventario.',
    CONTEO_ABIERTO_EN_SUCURSAL: 'Ya hay un conteo abierto en esta sucursal. Finalizalo antes de empezar otro.',
    MUESTRA_CICLICA_VACIA: 'No hay productos con existencia para sortear la muestra de esta sucursal.',
    CONTEO_CERRADO_NO_EDITABLE: 'El conteo ya está cerrado y no admite cambios.',
    CONTEO_NO_ENCONTRADO: 'No se encontró el conteo.',
    CONTEO_NO_ENCONTRADO_O_YA_FINALIZADO: 'El conteo ya fue finalizado.',
    CONTEO_NO_ENCONTRADO_O_NO_FINALIZADO: 'El conteo no está finalizado todavía.',
    APROBADOR_ES_QUIEN_FINALIZO: 'No podés aprobar un conteo que vos mismo finalizaste: debe firmarlo otra persona.',
    ITEM_NO_ENCONTRADO: 'No se encontró el renglón.',
    ESTADO_INVALIDO: 'Estado de renglón inválido.',
    PRESENTACION_Y_LOTE_REQUERIDOS: 'Elige presentación y lote antes de agregar.',
    PRODUCTO_NO_ENCONTRADO: 'Ese producto no existe o está inactivo.',
    LINEA_YA_EXISTE: 'Ese producto ya está en el conteo con esa presentación y lote.',
    CONTEO_NO_APROBADO: 'El ajuste solo se registra después de que el conteo esté aprobado.',
    AJUSTE_YA_APLICADO: 'Este ajuste ya figura como aplicado en el ERP.',
    CONTEO_NO_ESTA_EN_REVISION: 'El recuento solo se hace entre finalizar y aprobar el conteo.',
    SIN_PERMISO_RECUENTO: 'El recuento lo hace un supervisor: hace falta permiso de aprobación en este módulo.',
    RECUENTO_MISMO_CONTADOR: 'No podés recontar una línea que vos mismo contaste: el recuento lo hace otra persona.',
    CANTIDAD_INVALIDA: 'La cantidad del recuento debe ser un número entero de 0 o más.',
};

function traducirError(err) {
    if (!err) return err;
    for (const [code, msg] of Object.entries(ERRORES)) {
        if (err.message?.includes(code)) return new Error(msg);
    }
    return err;
}

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
        if (error) throw traducirError(error);

        await get().appendAuditLog('CONTEO_CREADO', data, {
            timeline_title: 'Conteo de inventario iniciado',
            dimension: 'OPERATIVE',
            branch_id: branchId,
            new_value: `Alcance: ${scopeType}`,
        });

        await get().fetchConteosInventario();
        return data;
    },

    // Qué va a caer en la muestra del mes y cómo está la cobertura. Sin esto se
    // arma un conteo a ciegas sobre productos que uno no eligió a mano.
    previewMuestraCiclica: async (branchId, tamano) => {
        const { data, error } = await supabase.rpc('preview_muestra_ciclica', {
            p_branch_id: branchId, p_tamano: tamano,
        });
        if (error) throw traducirError(error);
        return data;
    },

    fetchConteoDetalle: async (conteoId) => {
        const { data, error } = await fetchConteoDetalleData(conteoId);
        if (error) throw error;
        return data;
    },

    // Paginación por PRODUCTO (no por fila) — así un producto con muchos
    // lotes nunca se parte entre dos páginas y el total agregado por
    // producto (sistema/físico/diferencia) siempre es exacto.
    //
    // Laboratorio y orden van al SERVIDOR por la misma razón que la paginación:
    // ordenar o filtrar las 25 filas que ya llegaron da un resultado que parece
    // correcto sobre un conteo de 2,500 renglones y no lo es. El servidor
    // además ignora el orden por sistema/diferencia en un conteo ciego — la
    // lista ordenada por el número tapado lo revela igual.
    fetchConteoProductsPage: async (conteoId, {
        page = 1, pageSize = 25, search = '', filtro = 'TODOS',
        laboratorioId = null, orderBy = null, orderDir = 'asc',
    } = {}) => {
        const from = (page - 1) * pageSize;
        const [{ data: count, error: countErr }, { data: rows, error: rowsErr }] = await Promise.all([
            supabase.rpc('get_conteo_products_count', {
                p_conteo_id: conteoId, p_search: search || null, p_filtro: filtro,
                p_laboratorio_id: laboratorioId,
            }),
            supabase.rpc('get_conteo_products_page', {
                p_conteo_id: conteoId, p_search: search || null, p_filtro: filtro,
                p_limit: pageSize, p_offset: from,
                p_laboratorio_id: laboratorioId, p_order_by: orderBy, p_order_dir: orderDir,
            }),
        ]);
        if (countErr) throw countErr;
        if (rowsErr) throw rowsErr;
        return { rows: rows || [], total: count || 0 };
    },

    // Solo los laboratorios que están EN ESTE conteo. El catálogo completo son
    // 1,100+: ofrecerlos todos deja elegir uno que no está en el anaquel y
    // vaciar la tabla sin explicación.
    fetchConteoLaboratorios: async (conteoId) => {
        const { data, error } = await supabase.rpc('get_conteo_laboratorios', { p_conteo_id: conteoId });
        if (error) throw error;
        return data || [];
    },

    // Totales de TODO el conteo, en vivo. Los de `conteos_inventario` los
    // escribe recalcular_totales_conteo, que solo corre al finalizar: mientras
    // el conteo está abierto valen 0, que es justo cuando sirve saber cuánto
    // falta. Los agregados de fetchConteoProductsPage son de la página (25 de
    // 1,457 productos), así que tampoco servían.
    fetchConteoResumen: async (conteoId) => {
        const { data, error } = await supabase.rpc('get_conteo_resumen', { p_conteo_id: conteoId });
        if (error) throw error;
        return data || null;
    },

    // Líneas (lote/presentación) de UN producto dentro del conteo — se piden
    // solo al expandir su fila de grupo. Un producto real nunca tiene miles
    // de lotes, pero se acota igual por seguridad.
    fetchConteoProductItems: async (conteoId, erpProductId) => {
        const { data, error } = await supabase.rpc('get_conteo_items_search', {
            p_conteo_id: conteoId, p_search: null, p_filtro: 'TODOS', p_limit: 500, p_offset: 0, p_erp_product_id: erpProductId,
        });
        if (error) throw error;
        // La RPC devuelve `photo_url` cruda (formato-public) porque en BD nunca
        // se guarda una URL firmada — expira. La foto de quien contó se firma acá.
        return await signPhotosDeep(data || []);
    },

    // Las líneas de TODOS los productos de la página, en un solo viaje. Al no
    // contraer nada (contar exige teclear seguido, no abrir acordeones) hacía
    // falta esto: antes era una llamada por producto, disparada por un click.
    // El array va acotado a los ~25 ids de la página, así que la respuesta son
    // decenas de filas y nunca se acerca al techo de 1000 de PostgREST.
    fetchConteoItemsForProducts: async (conteoId, erpProductIds, { search = '', filtro = 'TODOS' } = {}) => {
        if (!erpProductIds?.length) return [];
        const { data, error } = await supabase.rpc('get_conteo_items_search', {
            p_conteo_id: conteoId,
            p_search: search || null,
            p_filtro: filtro,
            p_limit: 2000,
            p_offset: 0,
            p_erp_product_id: null,
            p_erp_product_ids: erpProductIds,
        });
        if (error) throw error;
        return await signPhotosDeep(data || []);
    },

    // Cuántos renglones siguen sin cantidad física. Se pide antes de finalizar:
    // el usuario tiene que decidir qué son esos pendientes, no descubrirlos
    // después en el reporte (C4).
    fetchConteoPendientesCount: async (conteoId) => {
        const { data, error } = await supabase.rpc('get_conteo_items_count', {
            p_conteo_id: conteoId, p_search: null, p_filtro: 'PENDIENTES',
        });
        if (error) throw error;
        return data || 0;
    },

    // Corrige la etiqueta de lote/vencimiento de una línea ya creada (ej. el
    // físico encontrado trae un lote distinto al que copió el snapshot) —
    // nunca toca la tabla inventory real, ni cambia contra qué fila del ERP se
    // compara (eso lo fija source_sync_key), solo la etiqueta del renglón.
    editarLoteConteoItem: async (itemId, { lote, fechaVencimiento }) => {
        const { data, error } = await supabase.rpc('editar_lote_conteo_item', {
            p_item_id: itemId, p_lote: lote, p_fecha_vencimiento: fechaVencimiento || null,
        });
        if (error) throw traducirError(error);

        await get().appendAuditLog('CONTEO_LOTE_CORREGIDO', itemId, {
            timeline_title: 'Etiqueta de lote corregida en un conteo',
            dimension: 'OPERATIVE',
            new_value: `Lote: ${data.lote || '—'} · Vence: ${data.fecha_vencimiento || '—'}`,
        });

        return data;
    },

    // El "sistema" se congela EN EL SERVIDOR (guardar_conteo_item relee
    // inventory en vivo en ese instante) — el cliente nunca envía/decide ese
    // valor, para que un conteo "en caliente" (sucursal abierta, ventas
    // corriendo) compare contra el stock real vigente al momento de contar,
    // no contra un snapshot viejo.
    //
    // No lleva appendAuditLog a propósito: cada renglón guardado ya escribe en
    // conteo_inventario_item_history, que es su bitácora dedicada e
    // inmodificable (quién, cuándo, sistema, físico, nota, incluidas las
    // ediciones). Un conteo total son ~4,800 renglones: duplicarlos en
    // audit_logs no agregaría trazabilidad, solo volumen.
    guardarConteoItem: async (itemId, { fisicoCantidad, nota, estadoItem }) => {
        const { data, error } = await supabase.rpc('guardar_conteo_item', {
            p_item_id: itemId,
            p_fisico_cantidad: fisicoCantidad,
            p_nota: nota ?? null,
            p_estado_item: estadoItem,
        });
        if (error) throw traducirError(error);
        return data;
    },

    // Recuento de supervisor, entre finalizar y aprobar. La RPC exige
    // can_approve y rechaza que lo haga quien contó esa misma línea. No lleva
    // appendAuditLog por la misma razón que guardarConteoItem: la bitácora del
    // renglón es conteo_inventario_item_history, y ahí queda con nombre y hora.
    recontarConteoItem: async (itemId, { fisicoCantidad, nota }) => {
        const { data, error } = await supabase.rpc('recontar_conteo_item', {
            p_item_id: itemId,
            p_fisico_cantidad: fisicoCantidad,
            p_nota: nota ?? null,
        });
        if (error) throw traducirError(error);
        return data;
    },

    fetchConteoItemHistory: async (itemId) => {
        const { data, error } = await supabase.rpc('get_conteo_item_history', { p_item_id: itemId });
        if (error) throw error;
        return await signPhotosDeep(data || []);
    },

    agregarProductoManualConteo: async (conteoId, { erpProductId, presentacion, lote, fechaVencimiento }) => {
        const { data, error } = await supabase.rpc('agregar_item_conteo', {
            p_conteo_id: conteoId,
            p_erp_product_id: erpProductId,
            p_presentacion: presentacion,
            p_lote: lote,
            p_fecha_vencimiento: fechaVencimiento || null,
        });
        if (error) throw traducirError(error);

        await get().appendAuditLog('CONTEO_ITEM_AGREGADO', conteoId, {
            timeline_title: 'Producto agregado a un conteo',
            dimension: 'OPERATIVE',
            new_value: `Producto ${erpProductId} · ${presentacion} · lote ${lote}`,
        });

        return data;
    },

    finalizarConteoInventario: async (conteoId, pendientesComoCero = false) => {
        const { data, error } = await supabase.rpc('finalizar_conteo_inventario', {
            p_conteo_id: conteoId,
            p_pendientes_como_cero: pendientesComoCero,
        });
        if (error) throw traducirError(error);

        const detalle = await get().fetchConteoDetalle(conteoId);
        const trato = data.total_pendientes > 0
            ? ` · ${data.total_pendientes} pendiente(s) ${pendientesComoCero ? 'cerrados como no ubicados' : 'excluidos del cálculo'}`
            : '';
        await get().appendAuditLog('CONTEO_FINALIZADO', conteoId, {
            timeline_title: 'Conteo de inventario finalizado',
            dimension: 'OPERATIVE',
            branch_id: detalle?.branch_id,
            new_value: `${data.total_diferencias} diferencia(s) — faltante ${formatMoney(data.valor_faltante)} · sobrante ${formatMoney(data.valor_sobrante)}${trato}`,
        });

        return data;
    },

    aprobarConteoInventario: async (conteoId, nota) => {
        const { data, error } = await supabase.rpc('aprobar_conteo_inventario', { p_conteo_id: conteoId, p_nota: nota || null });
        if (error) throw traducirError(error);

        const detalle = await get().fetchConteoDetalle(conteoId);
        await get().appendAuditLog('CONTEO_APROBADO', conteoId, {
            timeline_title: 'Conteo de inventario aprobado',
            dimension: 'OPERATIVE',
            branch_id: detalle?.branch_id,
            new_value: nota || 'Sin nota',
        });

        return data;
    },

    // El portal no escribe stock: esto NO ajusta nada, deja constancia de que
    // alguien ya tecleó el ajuste en el ERP. Sin este registro, un conteo
    // aprobado y uno ya reflejado en el ERP se ven idénticos.
    marcarAjusteErp: async (conteoId, nota) => {
        const { data, error } = await supabase.rpc('marcar_ajuste_erp', { p_conteo_id: conteoId, p_nota: nota || null });
        if (error) throw traducirError(error);

        const detalle = await get().fetchConteoDetalle(conteoId);
        await get().appendAuditLog('CONTEO_AJUSTE_ERP_APLICADO', conteoId, {
            timeline_title: 'Ajuste del conteo aplicado en el ERP',
            dimension: 'OPERATIVE',
            branch_id: detalle?.branch_id,
            new_value: nota || 'Sin nota',
        });

        await get().fetchConteosInventario();
        return data;
    },

    fetchTodosLosItemsConteo: async (conteoId) => {
        const { data, error } = await supabase.rpc('get_conteo_items_jsonb', { p_conteo_id: conteoId });
        if (error) throw error;
        return data || [];
    },
});
