// Maestro de Proveedores — capa de datos. Lectura vía RPC Patrón C (json_agg).
import { supabase } from '../supabaseClient';

export async function fetchProveedoresMaestro() {
    const { data, error } = await supabase.rpc('get_proveedores_maestro');
    if (error) throw error;
    return data || [];
}

// Tabla chica (16 filas seed) — select directo, sin RPC, mismo patrón que
// fetchSuppliersBasic.
export function fetchProveedorCategorias() {
    return supabase.from('proveedores_categorias').select('id, clase, nombre').order('clase').order('nombre');
}

export async function setProveedorCategoria(id, categoriaId) {
    const { error } = await supabase.rpc('set_proveedor_categoria', { p_id: id, p_categoria_id: categoriaId });
    if (error) throw error;
}

// H5 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): asignación masiva. Las dos
// devuelven cuántas filas cambiaron DE VERDAD (no cuántas se seleccionaron),
// así el aviso no miente cuando algunas ya tenían esa categoría.
//
// La diferencia entre ambas es real y por eso son dos RPC: `bulk` le pone a
// todos LA MISMA categoría; `sugerida` le pone a cada uno LA SUYA, calculada
// desde su propio giro fiscal, e ignora a los que no tienen sugerencia.
export async function setProveedoresCategoriaBulk(ids, categoriaId) {
    const { data, error } = await supabase.rpc('set_proveedores_categoria_bulk', {
        p_ids: ids, p_categoria_id: categoriaId ?? null,
    });
    if (error) throw error;
    return data ?? 0;
}

export async function applyProveedoresCategoriaSugerida(ids) {
    const { data, error } = await supabase.rpc('apply_proveedores_categoria_sugerida', { p_ids: ids });
    if (error) throw error;
    return data ?? 0;
}

export async function setProveedorSupplier(id, supplierId) {
    const { error } = await supabase.rpc('set_proveedor_supplier', { p_id: id, p_supplier_id: supplierId });
    if (error) throw error;
}

// ── Clasificación fiscal (Art. 65 LIVA + catálogos del anexo F-07 v14) ───────
// RPC propio y no un parámetro más de `updateProveedorManual`, por dos motivos:
// ya hay DOS sobrecargas de esa función con DEFAULT —una tercera vuelve ambigua
// la llamada— y esto es un acto distinto, que lleva autor y fecha. Mismo criterio
// que `setProveedorCategoria` y `setProveedorSupplier`, que ya viven aparte.
//
// El autor NO viaja: lo resuelve el servidor desde la sesión.
export async function setProveedorClasificacionFiscal(id, c) {
    const { error } = await supabase.rpc('set_proveedor_clasificacion_fiscal', {
        p_id: id,
        p_iva_deducible: c.iva_deducible,
        p_clasificacion: c.f07_clasificacion ?? null,
        p_sector: c.f07_sector ?? null,
        p_tipo_costo_gasto: c.f07_tipo_costo_gasto ?? null,
        p_tipo_operacion: c.f07_tipo_operacion ?? null,
        p_nota: c.clasificacion_nota ?? null,
    });
    if (error) throw error;
}

// Confirma en tanda, y SOLO las que están en 'propuesta'. Las 'pendiente' son
// las que la ley condiciona (combustible, ferretería, alimentos, cómputo): ésas
// nadie las puede confirmar en masa sin mirarlas, y por eso el RPC las ignora.
//
// Devuelve cuántas cambiaron DE VERDAD, no cuántas se seleccionaron — mismo
// criterio que `applyProveedoresCategoriaSugerida`, para que el aviso no mienta.
export async function confirmarClasificacionPropuesta(ids) {
    const { data, error } = await supabase.rpc('confirmar_clasificacion_propuesta', { p_ids: ids });
    if (error) throw error;
    return data ?? 0;
}

// Las fichas que todavía no tienen clasificación confirmada, con el crédito
// fiscal que cada una tiene en juego. Lo pide sólo el panel de revisión, y por
// eso es un RPC aparte y no una columna más de `fetchProveedoresMaestro`: el
// monto cruza `purchase_dte_documents` y cuesta ~200ms que el listado no tiene
// por qué pagar en cada carga.
export async function fetchClasificacionFiscalPendiente() {
    const { data, error } = await supabase.rpc('get_clasificacion_fiscal_pendiente');
    if (error) throw error;
    return data || [];
}

// Resuelve en tanda una regla que la ley CONDICIONA. No es lo mismo que
// confirmar una propuesta: aquéllas ya traen los valores del anexo derivados del
// giro, y éstas nacen en blanco a propósito —la ley no permite derivarlas— así
// que acá se escribe la decisión, no se acepta una.
//
// El servidor sólo toca las que están en 'pendiente' y devuelve cuántas cambiaron
// de verdad, igual que las otras dos de tanda.
export async function resolverClasificacionPendiente(ids, c) {
    const { data, error } = await supabase.rpc('resolver_clasificacion_pendiente', {
        p_ids: ids,
        p_iva_deducible: c.iva_deducible,
        p_clasificacion: c.f07_clasificacion ?? null,
        p_sector: c.f07_sector ?? null,
        p_tipo_costo_gasto: c.f07_tipo_costo_gasto ?? null,
        p_tipo_operacion: c.f07_tipo_operacion ?? null,
    });
    if (error) throw error;
    return data ?? 0;
}

// H2 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): `percibe_1` ya NO se manda —
// el RPC lo deriva. Lo que viaja es el override tri-estado:
//   null  = automático (lo deciden los DTE del proveedor, Art. 163 CT)
//   true  = manual, sí percibe
//   false = manual, no percibe
// Antes se mandaba un booleano plano y el RPC lo copiaba al override en cada
// guardado, congelando el campo aunque el usuario solo hubiera tocado el
// teléfono.
export async function updateProveedorManual(id, fields) {
    const { error } = await supabase.rpc('update_proveedor_manual', {
        p_id: id,
        p_contacto_nombre: fields.contacto_nombre || null,
        p_telefono2: fields.telefono2 || null,
        p_nombre_cheques: fields.nombre_cheques || null,
        p_notas: fields.notas || null,
        p_activo: fields.activo !== false,
        p_alias: fields.alias || null,
        p_percibe_1_override: fields.percibe_1_override ?? null,
        // `retiene_renta` va por ACA y no por un setter propio: la ficha tiene un
        // solo camino de escritura, y dos formas de escribir el mismo registro se
        // separan el día que una gane un chequeo y la otra no.
        p_retiene_renta: fields.retiene_renta ?? null,
    });
    if (error) throw error;
}
