// Devolución de un renglón del pedido: de la sala a bodega.
//
// El traslado del pedido es todo o nada —la recepción ingresa la cantidad
// completa que salió de bodega, aunque la sala haya contado menos—, así que la
// diferencia quedaba anotada en el portal y no movía existencias nunca. Esto es
// lo que la mueve: la sala pide devolver, bodega acepta, el producto sale de la
// sala y **bodega confirma la entrada**.
//
// Esa última mitad es el punto entero. Sin ella el producto queda en tránsito:
// fuera de la sala y todavía no en bodega, que es peor que estar en cualquiera
// de los dos lados.
//
// ── Lo que este archivo NO hace ────────────────────────────────────────────
// No mueve nada. El movimiento vive en la edge function `devolver-pedido-erp`,
// que corre con credenciales que el navegador no tiene y que releen la
// existencia antes de escribir. Acá sólo se pide, se decide y se pregunta.
import { supabase } from '../supabaseClient';

/** El bucket de la foto del daño. Privado: se firma para mostrarla. */
export const BUCKET_EVIDENCIA = 'inventario-evidencia';
export const MAX_FOTOS = 3;

export const MOTIVOS = [
    { value: 'faltante', label: 'No llegó',  ayuda: 'Vino en la hoja pero no en la caja. No viaja nada: se corrige y ya.' },
    { value: 'danado',   label: 'Dañado',    ayuda: 'Llegó roto o golpeado. La foto es lo que deja a bodega decidir si se puede vender.' },
    { value: 'vencido',  label: 'Vencido',   ayuda: 'Llegó vencido o por vencer. El producto vuelve a bodega.' },
];

/** Si el producto viaja de verdad o si es sólo un arreglo de papeles. */
export const viajaPorMotivo = (motivo) => motivo !== 'faltante';

const SELECT = `
    id, pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id,
    motivo, viaja, cantidad, nota, evidencia_urls, estado,
    solicitada_por, solicitada_at, decidida_por, decidida_at, decision_nota, motivo_rechazo,
    clave, id_traslado, aviso, error_msg, enviado_at, recibido_at, recibido_por,
    detalle
`;

/** Las devoluciones de un pedido/sala, para pintarlas junto a su renglón. */
export async function fetchDevolucionesDePedido(pedidoId, sucursalId) {
    let q = supabase.from('pedido_devolucion').select(SELECT).eq('pedido_id', pedidoId);
    if (sucursalId) q = q.eq('erp_sucursal_id', sucursalId);
    const { data, error } = await q.order('solicitada_at', { ascending: true });
    if (error) console.error('devoluciones:', error.message);
    return data ?? [];
}

/**
 * Sube las fotos del daño y devuelve sus URLs.
 *
 * La evidencia va PRIMERO: si la subida falla, la devolución no se crea. Una
 * devolución por daño sin foto es exactamente la que bodega no puede decidir, y
 * dejarla entrar «para no perder lo escrito» la convierte en una fila que
 * alguien va a tener que rechazar a mano.
 *
 * Se guarda la URL en formato público como identificador aunque el bucket sea
 * privado (regla 10 de CLAUDE.md): la firma expira, así que lo que se persiste
 * no puede ser una URL firmada.
 */
export async function subirEvidencia(fotos, { salaId, userId }) {
    const urls = [];
    const carpeta = `devoluciones/${salaId ?? 'sin-sala'}/${userId ?? 'anon'}`;
    for (const [i, f] of [...fotos].entries()) {
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${carpeta}/${Date.now()}-${i}.${ext}`;
        const { error } = await supabase.storage
            .from(BUCKET_EVIDENCIA).upload(path, f, { contentType: f.type });
        if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
        const { data } = supabase.storage.from(BUCKET_EVIDENCIA).getPublicUrl(path);
        if (data?.publicUrl) urls.push(data.publicUrl);
    }
    return urls;
}

/** La sala pide devolver. La cantidad y el permiso los valida la base. */
export function solicitarDevolucion({ itemId, motivo, cantidad, nota, evidencia = [] }) {
    return supabase.rpc('solicitar_devolucion_pedido', {
        p_pedido_item_id: itemId,
        p_motivo:         motivo,
        p_cantidad:       Number(cantidad),
        p_nota:           nota || null,
        p_evidencia:      evidencia,
    });
}

/** Bodega acepta o rechaza. Rechazar sin motivo lo frena la base. */
export function decidirDevolucion(id, accion, nota) {
    return supabase.rpc('decidir_devolucion_pedido', {
        p_id: id, p_accion: accion, p_nota: nota || null,
    });
}

/**
 * Mueve la devolución, o la ingresa en bodega.
 *
 * `simulacro: true` verifica TODO contra el sistema —existencia, presentación,
 * lotes— y no escribe ni una línea. Es el valor por omisión de la función: mover
 * inventario real tiene que ser una decisión explícita.
 *
 * Nunca lanza: devuelve `{ ok, ... }` y el llamador decide qué mostrar.
 */
async function invocar(body) {
    try {
        const { data, error } = await supabase.functions.invoke('devolver-pedido-erp', { body });
        if (!error) return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };
        // `functions.invoke` marca error para cualquier status >= 400, pero el
        // motivo real viaja en el cuerpo — sin leerlo, todo fallo se ve como un
        // "non-2xx status code" indistinguible.
        try {
            const cuerpo = await error.context?.json?.();
            if (cuerpo) return cuerpo;
        } catch { /* el cuerpo no era JSON */ }
        return { ok: false, error: error.message ?? 'No se pudo mover la devolución.' };
    } catch (e) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

export const moverDevoluciones = (ids, { simulacro = true } = {}) =>
    invocar({ devolucion_ids: ids, accion: 'enviar', simulacro });

export const recibirDevoluciones = (ids, { simulacro = true } = {}) =>
    invocar({ devolucion_ids: ids, accion: 'recibir', simulacro });
