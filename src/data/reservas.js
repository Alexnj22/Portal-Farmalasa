import { supabase } from '../supabaseClient';

/**
 * Reservas de la app de clientes — migración `app_reservas_de_ofertas`.
 *
 * La sucursal NO las escribe directo: todo pasa por funciones de la base con
 * su propia guarda (`reserva_puede_manejar`: cualquier dependiente de ESA
 * sucursal, o quien edita Ofertas para clientes). El aviso a la app sale solo
 * —`avisos-clientes` mira cada minuto las reservas que pasaron a «lista»—; a
 * quien no tiene la app se le avisa por WhatsApp desde el portal.
 *
 * Una sucursal tiene decenas de reservas abiertas a lo sumo: sin paginar.
 */

const sinError = ({ data, error }) => {
    if (error) throw error;
    return data;
};

export async function fetchReservasDeSucursal(branchId, abiertas = true) {
    // `branchId` null = todas las salas (sólo quien edita Ofertas para clientes).
    return sinError(await supabase.rpc('reservas_de_sucursal', { p_branch_id: branchId == null ? null : Number(branchId), p_abiertas: abiertas })) ?? [];
}

/** `estado`: 'lista' (apartada y avisada), 'retirada' o 'cancelada'. */
export async function cambiarEstadoReserva(id, estado, motivo = null) {
    return sinError(await supabase.rpc('reserva_cambiar_estado', { p_id: id, p_estado: estado, p_motivo: motivo }));
}

export async function marcarAvisadaPorWhatsapp(id) {
    sinError(await supabase.rpc('reserva_avisada_whatsapp', { p_id: id }));
}

export const codigoDeReserva = (id) => `R-${String(id).padStart(6, '0')}`;

/** El mensaje que el dependiente manda por WhatsApp a quien no tiene la app. */
export function mensajeDeReservaLista(r, sala) {
    const nombre = String(r.cliente ?? '').trim().split(/\s+/)[0] ?? '';
    const primero = nombre ? nombre[0] + nombre.slice(1).toLowerCase() : '';
    return `Hola${primero ? ` ${primero}` : ''}, le saludamos de Farmacia Salud ${sala ?? ''}. `
        + `Su reserva ${codigoDeReserva(r.id)} (${r.cantidad} × ${r.producto}) ya está lista. `
        + 'Puede pasar a retirarla en las próximas 24 horas; el precio de oferta se respeta. ¡Le esperamos!';
}

/** El teléfono en formato de WhatsApp (El Salvador): sólo dígitos, con 503. */
export function whatsappDe(telefono) {
    const d = String(telefono ?? '').replace(/\D/g, '');
    if (d.length === 8) return `503${d}`;
    if (d.length === 11 && d.startsWith('503')) return d;
    return null;
}

// ── Encargos (2026-10-07) ────────────────────────────────────────────────────
// Lo que el cliente pide desde la app porque no hay en ninguna sucursal. Lo
// ven la sala del retiro y Bodega (con `null`, todos: Bodega o quien maneja
// ofertas para clientes).

export const codigoDeEncargo = (id) => `E-${String(id).padStart(6, '0')}`;

export async function fetchEncargos(branchId, abiertos = true) {
    return sinError(await supabase.rpc('encargos_de_sucursal', { p_branch_id: branchId == null ? null : Number(branchId), p_abiertos: abiertos })) ?? [];
}

/** `accion`: confirmar (con precio y fecha), rechazar (con nota), pedido, listo o entregado. */
export async function responderEncargo(id, accion, { precio = null, fecha = null, nota = null } = {}) {
    return sinError(await supabase.rpc('encargo_responder', { p_id: id, p_accion: accion, p_precio: precio, p_fecha: fecha, p_nota: nota }));
}

// ── Reserva hecha en la sucursal, con anticipo (2026-10-07) ────────────────
// Política: anticipo de al menos el 50 % y 7 días para retirarla. La guarda
// vive en `reserva_en_sucursal_crear` (sólo un dependiente de ESA sala).

/** Las presentaciones con precio de un producto, de la menor a la mayor. */
export async function preciosDeProducto(productId) {
    const filas = sinError(await supabase.from('product_precios')
        .select('vineta, factor, presentaciones(tipo)')
        .eq('product_id', Number(productId)).eq('activo', true).gt('vineta', 0)
        .order('factor', { ascending: true }));
    return (filas ?? []).map((f) => ({
        precio: Number(f.vineta), factor: Number(f.factor) || 1, tipo: f.presentaciones?.tipo ?? 'Unidad',
    }));
}

export async function crearReservaEnSucursal({ branchId, customerId, productoId, productoNombre, cantidad, precio, anticipo, metodo }) {
    return sinError(await supabase.rpc('reserva_en_sucursal_crear', {
        p_branch_id: Number(branchId), p_customer_id: Number(customerId), p_producto_id: Number(productoId),
        p_producto_nombre: productoNombre, p_cantidad: Number(cantidad), p_precio: Number(precio),
        p_anticipo: Number(anticipo), p_metodo: metodo,
    }));
}

/** El envío a domicilio de la app (una fila en `app_ajustes`). */
export async function fetchAjustesEnvio() {
    return sinError(await supabase.from('app_ajustes')
        .select('envio_activo, envio_costo, envio_gratis_desde, envio_nota, updated_at').eq('id', true).maybeSingle());
}

export async function guardarAjustesEnvio({ activo, costo, gratisDesde, nota }, employeeId) {
    const filas = sinError(await supabase.from('app_ajustes').update({
        envio_activo: !!activo, envio_costo: Number(costo), envio_gratis_desde: gratisDesde == null || gratisDesde === '' ? null : Number(gratisDesde),
        envio_nota: String(nota ?? '').trim(), updated_at: new Date().toISOString(), updated_by: employeeId ?? null,
    }).eq('id', true).select('id'));
    // Sin policy que lo deje, el UPDATE devuelve 0 filas sin error: se dice.
    if (!filas?.length) throw new Error('No tienes permiso para cambiar el envío a domicilio.');
}
