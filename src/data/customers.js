// Bloque 6.A — capa de datos, entidad "customers". Extraído de
// WidgetAnnulmentRequest.jsx (ClientChangeForm): búsqueda server-side
// sobre el listado completo de clientes (23K+ filas) por tokens —
// cada token hace OR sobre search_name/nit/dui/phone/erp_id.
import { supabase } from '../supabaseClient';

export function searchCustomersByTokens(tokens) {
    let req = supabase.from('customers')
        .select('id, name, nit, dui, phone, erp_id')
        .order('name')
        .limit(30);
    for (const tok of tokens) {
        const like = `%${tok}%`;
        req = req.or(`search_name.ilike.${like},nit.ilike.${like},dui.ilike.${like},phone.ilike.${like},erp_id.ilike.${like}`);
    }
    return req;
}

// ── Módulo de Clientes ───────────────────────────────────────────────────────
//
// Todo pasa por RPC y **nada se filtra en el navegador**: son 24,502 fichas y
// PostgREST corta en 1000 sin avisar, así que un `select()` acá traería el 4%
// del catálogo y la vista mostraría números falsos con toda naturalidad.
// Filtrar, ordenar y paginar viven en `get_customers_page`.

/** Una página de la lista. Devuelve `{ total, rows }` — `total` es el conteo del
 *  filtro completo, no el de la página, que es lo que necesita el paginador. */
export async function fetchCustomersPage({
    search, categoria, departamento, municipio, ficha, erp,
    actividad, revisar, mostrador, sort, dir, page = 1, pageSize = 25,
} = {}) {
    const { data, error } = await supabase.rpc('get_customers_page', {
        p_search:       search || null,
        p_categoria:    categoria || null,
        p_departamento: departamento || null,
        p_municipio:    municipio || null,
        p_ficha:        ficha || null,
        p_erp:          erp || null,
        p_actividad:    actividad || null,
        p_revisar:      revisar || null,
        p_mostrador:    mostrador || null,
        p_sort:         sort || 'nombre',
        p_dir:          dir || 'asc',
        p_limit:        pageSize,
        p_offset:       (page - 1) * pageSize,
    });
    if (error) throw error;
    return { total: data?.total ?? 0, rows: data?.rows ?? [] };
}

export async function fetchCustomersStats() {
    const { data, error } = await supabase.rpc('get_customers_stats');
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data || {};
}

/** Ficha + actividad + últimas 12 facturas + bitácora, en una sola llamada. */
export async function fetchCustomerDetail(id) {
    const { data, error } = await supabase.rpc('get_customer_detail', { p_id: id });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data || {};
}

// El servidor devuelve códigos, no prosa, para que el mensaje se escriba una
// sola vez y del lado que sabe redactarlo (§26.8: qué pasó y qué hacer).
const ERRORES = {
    FORBIDDEN:                    'No tienes permiso para editar clientes.',
    NO_EXISTE:                    'Esa ficha ya no existe. Recarga la lista.',
    ES_MOSTRADOR:                 'Es un cliente genérico del mostrador, no una persona: no lleva ficha fiscal.',
    NOMBRE_VACIO:                 'El nombre no puede quedar vacío.',
    NOMBRE_DUPLICADO:             'Ya existe otra ficha con ese nombre. Búscala y edita esa.',
    CATEGORIA_INVALIDA:           'Esa categoría no es una de las seis del ERP.',
    RETENCION_INVALIDA:           'La retención va de 0 a 100.',
    GEO_INCOHERENTE:              'El departamento, el municipio y el distrito no se corresponden.',
    DUI_INVALIDO:                 'El DUI no pasa el dígito verificador. Revisa los números.',
    TELEFONO_INVALIDO:            'El teléfono debe tener 8 dígitos, o 503 + 8.',
    REQUIERE_CONFIRMACION_FISCAL: 'Son datos que se declaran a Hacienda: confirma el cambio.',
};

/** El código crudo del RPC, para que la vista pueda reaccionar a uno puntual
 *  (`REQUIERE_CONFIRMACION_FISCAL` abre el diálogo en vez de mostrar un error). */
export function codigoDeError(err) {
    const msg = err?.message || '';
    return Object.keys(ERRORES).find(c => msg.includes(c)) || null;
}

export function mensajeDeError(err) {
    return ERRORES[codigoDeError(err)] || err?.message || 'No se pudo guardar. Intenta de nuevo.';
}

/**
 * Guarda la ficha. **Es el único camino de escritura** — `customers` no tiene
 * policy de UPDATE, así que no hay forma de escribirla salteándose este RPC, ni
 * desde acá ni desde ningún otro lado.
 *
 * Solo viajan los campos que vienen en `campos`: el RPC conserva lo que no
 * recibe. Es deliberado y es lo contrario de lo que hace el ERP, cuyo POST
 * parcial BORRA lo que no se le manda.
 */
export async function updateCustomerFiscal(id, campos, { confirmarFiscal = false } = {}) {
    const { data, error } = await supabase.rpc('update_customer_fiscal', {
        p_id: id,
        p_campos: campos,
        p_confirmar_fiscal: confirmarFiscal,
    });
    if (error) throw error;
    return data;
}

/**
 * Manda al ERP lo que se acaba de guardar. **No se espera antes de dar por
 * guardada la ficha**: el guardado en el portal ya terminó y fue exitoso, y el
 * ERP es un servidor de terceros que puede tardar (medido: una lectura suya
 * tardó más de 300 s el 2026-08-01). Hacer esperar a la persona por eso sería
 * castigarla por la lentitud de otro.
 *
 * Si falla, no se pierde nada: la entrada de `customers_changelog` queda con
 * `erp_synced_at IS NULL`, o sea protegida contra el espejo y en la cola. La
 * recoge el próximo guardado o `empujar_al_erp.py`. Por eso esta función NUNCA
 * lanza: el resultado es informativo.
 */
export async function pushClienteAlErp(id) {
    try {
        const { data, error } = await supabase.functions.invoke('push-cliente-erp', {
            body: { customer_id: id },
        });
        if (error) return { empujado: false, error: error.message };
        return data || { empujado: false, error: 'sin respuesta' };
    } catch (e) {
        return { empujado: false, error: e?.message || String(e) };
    }
}
