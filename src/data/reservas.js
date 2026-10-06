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
    return sinError(await supabase.rpc('reservas_de_sucursal', { p_branch_id: Number(branchId), p_abiertas: abiertas })) ?? [];
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
