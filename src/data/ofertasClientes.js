import { supabase } from '../supabaseClient';
import { anotar } from './audit';

/**
 * Ofertas para clientes y pre-registros de la app de clientes — migración
 * `app_clientes_base`.
 *
 * Las ofertas son la vitrina de la app: NO son `promociones` (bonos de
 * laboratorio para el personal). Se escriben directo; el RLS exige el permiso
 * `ofertas_clientes`. La imagen va al bucket PRIVADO `ofertas-clientes`: la app
 * la recibe firmada desde `app-clientes`, y acá se firma para la vista previa.
 *
 * Ninguna lista se acerca a 1000 filas: decenas de ofertas al año, y los
 * pre-registros pendientes se resuelven en la sala.
 */

const BUCKET = 'ofertas-clientes';

const sinError = ({ data, error }) => {
    if (error) throw error;
    return data;
};

const CAMPOS = ['titulo', 'descripcion', 'etiqueta', 'condiciones', 'imagen_path', 'inicio', 'fin',
    'exclusiva', 'branch_ids', 'publicada', 'orden',
    // La foto de un descuento de la caja (ver `fotoParaApp` en descuentos.js).
    'descuento_erp_id', 'promocion_id', 'descuento_tipo', 'descuento_monto', 'productos', 'foto_at',
    // El color que resalta la oferta en la app (etiqueta, velo de la foto).
    'acento'];

export async function fetchSalas() {
    return sinError(await supabase.from('branches').select('id, name').eq('type', 'FARMACIA').order('name'));
}

export async function fetchOfertas() {
    const filas = sinError(await supabase.from('ofertas_clientes')
        .select('id, titulo, descripcion, etiqueta, condiciones, imagen_path, inicio, fin, exclusiva, branch_ids, publicada, orden, updated_at, descuento_erp_id, promocion_id, descuento_tipo, descuento_monto, productos, foto_at, descuento_borrado_at, acento')
        .order('fin', { ascending: false })
        .limit(500));
    // La vista previa de la imagen: firmadas en una sola llamada.
    const rutas = filas.map((f) => f.imagen_path).filter(Boolean);
    if (!rutas.length) return filas;
    const { data: firmadas, error } = await supabase.storage.from(BUCKET).createSignedUrls(rutas, 3600);
    if (error) {
        console.error('ofertasClientes.js: no se pudieron firmar las imágenes', error);
        return filas;
    }
    const porRuta = new Map((firmadas ?? []).map((f) => [f.path, f.signedUrl]));
    return filas.map((f) => ({ ...f, imagen_url: f.imagen_path ? porRuta.get(f.imagen_path) ?? null : null }));
}

/**
 * Sube la imagen y devuelve su ruta en el bucket. Recibe un `File` del
 * navegador, o lo que arma la app: `{ datos: ArrayBuffer, tipo, nombre }`
 * (en el teléfono no hay `File`, y `crypto.randomUUID` no siempre existe).
 */
export async function subirImagen(archivo) {
    const nombre = archivo.name ?? archivo.nombre ?? '';
    const ext = (nombre.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ruta = `${new Date().toISOString().slice(0, 7)}/${id}.${ext}`;
    sinError(await supabase.storage.from(BUCKET).upload(ruta, archivo.datos ?? archivo, {
        contentType: archivo.type || archivo.tipo || 'image/jpeg', upsert: false,
    }));
    return ruta;
}

export async function guardarOferta(id, datos) {
    const fila = Object.fromEntries(CAMPOS.filter((k) => k in datos).map((k) => [k, datos[k]]));
    if (id) {
        sinError(await supabase.from('ofertas_clientes')
            .update({ ...fila, updated_at: new Date().toISOString() }).eq('id', id).select('id').single());
        anotar('OFERTA_CLIENTE_EDITAR', id, fila);
        return id;
    }
    const nueva = sinError(await supabase.from('ofertas_clientes').insert(fila).select('id').single());
    anotar('OFERTA_CLIENTE_CREAR', nueva.id, fila);
    return nueva.id;
}

export async function publicarOferta(id, publicada) {
    // `.select()` para saber si el UPDATE tocó la fila: sin policy, devuelve
    // cero filas y ningún error.
    sinError(await supabase.from('ofertas_clientes')
        .update({ publicada, updated_at: new Date().toISOString() }).eq('id', id).select('id').single());
    anotar(publicada ? 'OFERTA_CLIENTE_PUBLICAR' : 'OFERTA_CLIENTE_RETIRAR', id, { publicada });
}

export async function borrarOferta(oferta) {
    sinError(await supabase.from('ofertas_clientes').delete().eq('id', oferta.id).select('id').single());
    if (oferta.imagen_path) {
        const { error } = await supabase.storage.from(BUCKET).remove([oferta.imagen_path]);
        if (error) console.error('ofertasClientes.js: la imagen quedó huérfana', error);
    }
    anotar('OFERTA_CLIENTE_BORRAR', oferta.id, { titulo: oferta.titulo });
}

// ── Pre-registros ───────────────────────────────────────────────────────────

export async function fetchPreregistros(estado = 'pendiente') {
    return sinError(await supabase.from('app_cliente_preregistros')
        .select('id, nombre, documento, telefono, email, fecha_nacimiento, acepta_promociones, estado, customer_id, created_at, resuelto_at')
        .eq('estado', estado)
        .order('created_at', { ascending: false })
        .limit(500));
}

/** `accion`: 'vincular' (con la ficha) o 'descartar'. */
export async function resolverPreregistro(id, accion, customerId = null) {
    return sinError(await supabase.rpc('app_preregistro_resolver', {
        p_id: id, p_accion: accion, p_customer_id: customerId,
    }));
}

/**
 * Las fichas con ESE documento —DUI, NIT o pasaporte—, nunca por nombre. El
 * documento ya viene limpio (sólo letras y números) desde `app-clientes`; se
 * vuelve a limpiar acá porque viaja dentro del filtro de PostgREST.
 */
export async function buscarFichasPorDocumento(documento) {
    const doc = String(documento ?? '').replace(/[^A-Za-z0-9]/g, '');
    if (doc.length < 7) return [];
    return sinError(await supabase.from('customers')
        .select('id, name, dui, nit, phone')
        .or(`ids_busq.ilike.%${doc}%,dui.eq.${doc},nit.eq.${doc},pasaporte.eq.${doc}`)
        .limit(10));
}

/** La oferta ligada a un descuento vivo, si la hay. */
export async function fetchOfertaDeDescuento(descuentoId) {
    const filas = sinError(await supabase.from('ofertas_clientes')
        .select('id, titulo, descripcion, etiqueta, condiciones, imagen_path, inicio, fin, exclusiva, branch_ids, publicada, orden, descuento_erp_id, promocion_id, descuento_tipo, descuento_monto, productos, foto_at, acento')
        .eq('descuento_erp_id', Number(descuentoId))
        .is('descuento_borrado_at', null)
        .limit(1));
    return filas[0] ?? null;
}

// ── Historias (carrusel tipo estados de la app) ─────────────────────────────
// Tabla `app_historias` (migración `app_clientes_historias_y_bandeja`). Mismo
// permiso y mismo bucket que las ofertas; la app las recibe firmadas desde
// `app-clientes`. Pocas decenas: sin paginar.

export async function fetchHistorias() {
    const filas = sinError(await supabase.from('app_historias')
        .select('id, titulo, texto, imagen_path, enlace, boton, inicio, fin, publicada, orden, updated_at, oferta_id, publicada_at')
        .order('updated_at', { ascending: false })
        .limit(200));
    const rutas = filas.map((f) => f.imagen_path).filter(Boolean);
    if (!rutas.length) return filas;
    const { data: firmadas, error } = await supabase.storage.from(BUCKET).createSignedUrls(rutas, 3600);
    if (error) {
        console.error('ofertasClientes.js: no se pudieron firmar las historias', error);
        return filas;
    }
    const porRuta = new Map((firmadas ?? []).map((f) => [f.path, f.signedUrl]));
    return filas.map((f) => ({ ...f, imagen_url: porRuta.get(f.imagen_path) ?? null }));
}

const CAMPOS_HISTORIA = ['titulo', 'texto', 'imagen_path', 'enlace', 'boton', 'inicio', 'fin', 'publicada', 'orden', 'oferta_id'];

/** Por historia: cuántos la vieron (con cuenta y visitantes) y cuántos tocaron un botón. */
export async function fetchVistasHistorias() {
    const filas = sinError(await supabase.rpc('app_historias_vistas_resumen')) ?? [];
    return new Map(filas.map((f) => [f.historia_id, f]));
}

/** Quién vio una historia: los clientes con cuenta, la más reciente primero (hasta 500). */
export async function fetchQuienesVieron(historiaId) {
    return sinError(await supabase.rpc('app_historia_quienes_vieron', { p_historia: historiaId })) ?? [];
}

/** Las ofertas que una historia puede mandar a reservar: las que no terminaron. */
export async function fetchOfertasParaHistoria(hoy) {
    return sinError(await supabase.from('ofertas_clientes')
        .select('id, titulo, fin, publicada')
        .gte('fin', hoy)
        .order('fin', { ascending: true })
        .limit(200));
}

export async function guardarHistoria(id, datos) {
    const fila = Object.fromEntries(CAMPOS_HISTORIA.filter((k) => k in datos).map((k) => [k, datos[k]]));
    if (id) {
        sinError(await supabase.from('app_historias')
            .update({ ...fila, updated_at: new Date().toISOString() }).eq('id', id).select('id').single());
        anotar('HISTORIA_APP_EDITAR', id, fila);
        return id;
    }
    const nueva = sinError(await supabase.from('app_historias').insert(fila).select('id').single());
    anotar('HISTORIA_APP_CREAR', nueva.id, fila);
    return nueva.id;
}

export async function publicarHistoria(id, publicada) {
    sinError(await supabase.from('app_historias')
        .update({ publicada, updated_at: new Date().toISOString() }).eq('id', id).select('id').single());
    anotar(publicada ? 'HISTORIA_APP_PUBLICAR' : 'HISTORIA_APP_RETIRAR', id, { publicada });
}

export async function borrarHistoria(h) {
    sinError(await supabase.from('app_historias').delete().eq('id', h.id).select('id').single());
    if (h.imagen_path) {
        const { error } = await supabase.storage.from(BUCKET).remove([h.imagen_path]);
        if (error) console.error('ofertasClientes.js: la imagen de la historia quedó huérfana', error);
    }
    anotar('HISTORIA_APP_BORRAR', h.id, { titulo: h.titulo });
}
