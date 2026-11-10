// Bloque 6.A — capa de datos, entidad "laboratorios" (política de
// vencimiento/devolución por proveedor). Extraído de
// TabPoliticaVencimiento.jsx: 8 llamadas supabase.from().
import { supabase } from '../supabaseClient';
import { anotar, conBitacora } from './audit';
import { fetchAllRows } from '../utils/supabaseUtils';
import { subirFotoDeCatalogo } from '@plataforma/fotoConMiniatura';

export function fetchLaboratoriosBasic() {
    return supabase.from('laboratorios').select('id, nombre, foto, sugerir_en_app, ocultar_en_app, nombre_app, nombre_tienda').order('nombre');
}

// Los productos de este laboratorio salen primero en «Mismo principio activo»
// de la app. Con `.select` por la misma razón que la foto.
export async function guardarSugerirLaboratorio(id, sugerir, contexto = {}) {
    const { data, error } = await supabase.from('laboratorios').update({ sugerir_en_app: sugerir }).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No tienes permiso para cambiar este laboratorio.');
    anotar('SUGERIR_LABORATORIO_APP', id, { sugerir, ...contexto });
}

// La foto del laboratorio para la Tienda de la app. Con `.select` para notar
// el caso en que el RLS no deja escribir: un update así devuelve cero filas y
// ningún error.
export async function guardarFotoLaboratorio(id, foto, contexto = {}) {
    const { data, error } = await supabase.from('laboratorios').update({ foto }).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No tienes permiso para cambiar este laboratorio.');
    anotar('FOTO_LABORATORIO', id, { quitada: !foto, ...contexto });
}

export async function subirFotoLaboratorio(id, blob, contexto = {}) {
    const url = await subirFotoDeCatalogo(`laboratorios/${id}.jpg`, blob);
    const foto = `${url}?t=${Date.now()}`;
    await guardarFotoLaboratorio(id, foto, contexto);
    return foto;
}

// Fuera de las listas de laboratorios de la app; sus productos siguen a la venta.
export async function guardarOcultarLaboratorio(id, ocultar, contexto = {}) {
    const { data, error } = await supabase.from('laboratorios').update({ ocultar_en_app: ocultar }).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No tienes permiso para cambiar este laboratorio.');
    anotar('OCULTAR_LABORATORIO_APP', id, { ocultar, ...contexto });
}

// El nombre que ve el cliente en la app. Vacío = limpieza automática; dos
// laboratorios con el mismo nombre salen como uno solo. Devuelve el resultante.
export async function guardarNombreAppLaboratorio(id, nombreApp, contexto = {}) {
    const { data, error } = await supabase.from('laboratorios')
        .update({ nombre_app: nombreApp.trim() || null }).eq('id', id).select('id, nombre_app, nombre_tienda');
    if (error) throw error;
    if (!data?.length) throw new Error('No tienes permiso para cambiar este laboratorio.');
    anotar('NOMBRE_APP_LABORATORIO', id, { nombre_app: nombreApp.trim() || null, ...contexto });
    return data[0];
}

export function fetchProveedores() {
    return supabase.from('proveedores')
        .select('id, laboratorio_id, nombre, devolutivo, meses_devolucion, notas, vineta')
        .order('nombre');
}

export function fetchSuppliersNames() {
    return supabase.from('suppliers').select('nombre').order('nombre');
}

// Las escrituras anotan su propia entrada en la bitácora (D3, 2026-09-28):
// cualquier cliente que las llame la deja. `contexto` son los datos legibles
// que sólo la pantalla conoce; la acción es fija.
export async function insertProveedor(payload, contexto = {}) {
    const res = await supabase.from('proveedores').insert(payload).select().single();
    if (!res.error && res.data) {
        anotar('CREAR_PROVEEDOR', res.data.id, { proveedor: res.data.nombre, ...contexto });
    }
    return res;
}

export function updateProveedor(id, patch, contexto = {}) {
    return conBitacora(supabase.from('proveedores').update(patch).eq('id', id),
        'EDITAR_PROVEEDOR', id, { proveedor: patch?.nombre, ...contexto });
}

export function deleteProveedor(id, contexto = {}) {
    return conBitacora(supabase.from('proveedores').delete().eq('id', id),
        'ELIMINAR_PROVEEDOR', id, contexto);
}

export function fetchProductCountByLabDevolutivo(labId) {
    return supabase.from('products').select('id', { count: 'exact', head: true })
        .eq('laboratorio_id', labId).eq('devolutivo', true);
}

export async function updateProductsMarkND(labId, contexto = {}) {
    const res = await supabase.from('products')
        .update({ devolutivo: false })
        .eq('laboratorio_id', labId).eq('devolutivo', true)
        .select('id');
    if (!res.error) {
        anotar('LABORATORIO_MARCAR_ND', labId, { productos_afectados: res.data?.length ?? 0, ...contexto });
    }
    return res;
}

// ── TabLaboratorios.jsx (2 de sus 3 sitios; el tercero reutiliza
// fetchLaboratoriosBasic ya definida arriba) ─────────────────────────────────

const LAB_LOC_FIELDS = 'lab_id, branch_id, vitrina, estante, peldano, bodega_numero, bodega_peldano';

// Una fila por laboratorio y sala: con ~300 laboratorios y 7 salas pasa de
// 1000, y PostgREST corta en silencio — los últimos laboratorios aparecían
// «sin ubicar» aunque la tuvieran. Se lee en tandas, misma forma `{ data, error }`.
export async function fetchLabLocations() {
    const data = await fetchAllRows(() => supabase.from('lab_locations').select(LAB_LOC_FIELDS)
        .order('lab_id').order('branch_id'), { completo: true });
    return data == null ? { data: null, error: new Error('No se pudieron leer las ubicaciones.') } : { data, error: null };
}

export function upsertLabLocation(payload, contexto = {}) {
    return conBitacora(supabase.from('lab_locations').upsert(payload, { onConflict: 'lab_id,branch_id' }),
        'UPDATE_LAB_LOCATION', payload?.lab_id, { branch_id: payload?.branch_id, ...contexto });
}
