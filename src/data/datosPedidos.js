import { supabase } from '../supabaseClient';

// Datos que el portal le PIDE a la sala para destrabar un documento.
//
// Hoy hay uno solo: el correo de un contribuyente que Hacienda rechazó y que no
// es un error de tipeo que el circuito pueda arreglar solo (espacios, «.con»).
// La sala lo escribe, confirma, y el portal lo guarda en la ficha del sistema
// donde se emite el documento y vuelve a transmitirlo.
//
// La sala NO edita al cliente: contesta una pregunta sobre su venta. Por eso no
// hace falta darle permiso sobre las 28,000 fichas para resolver un campo de
// una — y por eso la escritura pasa por una Edge Function y no por un update.

/**
 * Los pedidos abiertos de mi sala.
 *
 * `datos_pedidos_de_mi_sala` es DEFINER y filtra por la sucursal del EMPLEADO,
 * no por un parámetro: si la sala pudiera elegir la sucursal, podría contestar
 * el correo de un cliente que no tuvo enfrente. Quien mira Facturación los ve
 * todos, porque es quien persigue el trámite.
 *
 * Lanza a propósito: una lista vacía por falta de permiso se vería igual que
 * «no hay nada pendiente», y ésa es justo la confusión que este circuito vino a
 * cerrar.
 */
export async function fetchDatosPedidos() {
    const { data, error } = await supabase.rpc('datos_pedidos_de_mi_sala');
    if (error) throw new Error(error.message);
    return data ?? [];
}

/**
 * Contestar un pedido. Devuelve `{ ok, correo, documento }` o `{ ok:false, error }`.
 *
 * Nunca lanza: la vista decide qué mostrar. Y `documento.entro` se informa tal
 * cual viene — el reintento puede volver a rechazarse por otra cosa, y decir
 * «listo» sobre eso sería mentirle a quien acaba de contestar.
 */
export async function responderDatoPedido(pedidoId, valor) {
    try {
        const { data, error } = await supabase.functions.invoke('responder-dato-pedido', {
            body: { pedido_id: pedidoId, valor },
        });
        if (!error) return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };
        // El motivo real viaja en el cuerpo: sin leerlo, todo fallo se ve como
        // un "non-2xx status code" indistinguible.
        let detalle = '';
        try { detalle = (await error.context?.json())?.error ?? ''; } catch { /* sin cuerpo legible */ }
        return { ok: false, error: detalle || error.message };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}
