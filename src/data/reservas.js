import { supabase } from '../supabaseClient';
import { fechaTexto } from '../utils/fecha';

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

/**
 * La sala decide sobre la receta que el cliente subió (2026-10-12).
 * `decision`: 'aprobada' (la reserva pasa a pendiente), 'otra_foto' (sigue en
 * revisión) o 'rechazada' (se cancela). El motivo es obligatorio salvo al
 * aprobar. La función avisa al cliente y anota la bitácora por su cuenta.
 */
export async function decidirReceta(id, decision, motivo = null) {
    return sinError(await supabase.rpc('reserva_receta_decidir', {
        p_id: Number(id), p_decision: decision, p_motivo: String(motivo ?? '').trim() || null,
    }));
}

/** Las horas que una receta lleva esperando: a las 4 se avisa a supervisión. */
export const HORAS_RECETA_URGENTE = 4;

// Los plazos de una reserva (sin foto, receta sin revisar, sin preparar,
// pagada, saldo a favor) NO se escriben acá: viven en `reserva_plazos()` y cada
// fila de `reservas_de_sucursal` trae `plazo_hasta` (hasta cuándo vale su
// estado) y `horas_al_preparar` (2026-10-21). Antes había copias a mano.

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
        // El plazo es un día entero, no una hora (2026-10-20): se dice el día.
        + (r.vence_at ? `Puede pasar a retirarla hasta el ${fechaTexto(r.vence_at, { weekday: 'long', day: 'numeric', month: 'long' })}` : 'Puede pasar a retirarla')
        + '; el precio de oferta se respeta. ¡Le esperamos!';
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
// Política: anticipo de al menos el 50 % y 7 días para retirarla. Desde el
// 2026-10-20 el alta va por `DialogoApartar` + `apartado_aplicar`; la función
// vieja de la base (`reserva_en_sucursal_crear`) se quitó el 2026-10-21.

/** Las presentaciones con precio de un producto, de la menor a la mayor. */
export async function preciosDeProducto(productId) {
    const filas = sinError(await supabase.from('product_precios')
        .select('vineta, factor, presentaciones(tipo)')
        .eq('product_id', Number(productId)).eq('activo', true).gt('vineta', 0)
        .order('factor', { ascending: true }));
    // El catálogo puede traer la MISMA presentación dos veces (mismo tipo,
    // factor y precio, con otro id de presentación): se ofrece una sola.
    const vistas = new Set();
    return (filas ?? []).map((f) => ({
        precio: Number(f.vineta), factor: Number(f.factor) || 1, tipo: f.presentaciones?.tipo ?? 'Unidad',
    })).filter((p) => {
        const k = `${p.tipo}|${p.factor}|${p.precio}`;
        if (vistas.has(k)) return false;
        vistas.add(k);
        return true;
    });
}

/**
 * Mandar a la caja la venta de una reserva (o de los renglones de un pedido),
 * ya armada: producto, cliente y vendedor —quien la envía— (2026-10-21).
 * La arma `armarVenta` del núcleo dentro de la función `preventa-caja`; la base
 * decide si se puede (permiso, sala, una sola preventa viva). Cuando la venta
 * se factura, la reserva se cierra sola.
 *
 * Devuelve `{ ok, referencia, externo_id, cliente_generico, avisos }` o
 * `{ ok: false, error }` con el motivo del servidor. Nunca lanza.
 */
export async function enviarPreventa(reservaIds) {
    try {
        const { data, error } = await supabase.functions.invoke('preventa-caja', {
            body: { accion: 'enviar', reservas: (reservaIds || []).map(Number) },
        });
        if (error) {
            // El motivo real viaja en el CUERPO (ver `pedir` en data/creditos).
            let detalle = '';
            try { detalle = (await error.context?.json())?.error ?? ''; } catch { /* sin cuerpo legible */ }
            return { ok: false, error: detalle || error };
        }
        return data ?? { ok: false, error: new Error('NO_SE_PUDO') };
    } catch (err) {
        return { ok: false, error: err };
    }
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

/**
 * El saldo a favor (anticipo de una reserva vencida, o lo pagado en línea que
 * no se entregó) se aplica en caja de CUALQUIER sala (2026-10-19): la sala lo
 * marca al usarlo y queda anotada.
 */
export async function usarSaldoAFavor(id) {
    return sinError(await supabase.rpc('reserva_usar_saldo_favor', { p_id: Number(id) }));
}

/**
 * Devolver en dinero un saldo a favor (2026-10-19): sólo administración
 * (`dash_reservas_devolver_saldo`), con motivo. La devolución se hace afuera;
 * acá queda quién la autorizó, cuándo, cuánto y por qué, y el saldo deja de
 * estar disponible. La base lo rechaza sin el permiso.
 */
export async function devolverSaldoAFavor(id, motivo) {
    return sinError(await supabase.rpc('reserva_saldo_devolver', { p_id: Number(id), p_motivo: String(motivo ?? '').trim() }));
}

/**
 * Un saldo a favor por el código que el cliente muestra (R-… o P-…), de
 * cualquier sala (2026-10-19): se usa en cualquier sucursal.
 */
export async function buscarSaldoAFavor(codigo) {
    return sinError(await supabase.rpc('saldo_favor_buscar', { p_codigo: String(codigo ?? '').trim() })) ?? [];
}

/**
 * La receta aprobada en la app para un renglón del libro bajo receta
 * (2026-10-19): misma ficha y producto, aprobada en los 60 días previos. Trae
 * la ruta de la foto (bucket privado de la app), quién la aprobó y cuándo.
 */
export async function recetaDeLaAppParaDispensacion(dispensacionId) {
    return sinError(await supabase.rpc('receta_app_de_dispensacion', { p_dispensacion_id: Number(dispensacionId) })) ?? [];
}

// ── Apartar o encargar desde la sala (2026-10-20) ──────────────────────────
// El cobro del anticipo va por `anotarIngreso` con el tipo APARTADO; esto es
// lo que la pantalla necesita ANTES de cobrar.

/** ¿Se aparta (hay en la sala y no es insumo) o se encarga? Con los precios del catálogo. */
export async function opcionesDeApartado(branchId, productoId, factor, cantidad) {
    return sinError(await supabase.rpc('apartado_opciones', {
        p_branch_id: Number(branchId), p_producto_id: Number(productoId), p_factor: Number(factor) || 1, p_cantidad: Number(cantidad) || 1,
    }));
}

/** Lo que hay que saber para retirar lo apartado: total, lo pagado separado
 *  por dónde está el dinero (efectivo de la caja, otras formas, en línea) y si
 *  el anticipo ya se aplicó a su factura. `ref`: `{ reserva_id }` o `{ encargo_id }`. */
export async function fetchParaRetirar(branchId, ref) {
    return sinError(await supabase.rpc('apartado_para_retirar', { p_branch_id: Number(branchId), p_apartado: ref }));
}

/** Entregar lo apartado sin anticipo, o con el anticipo ya aplicado. */
export async function entregarApartado(branchId, ref) {
    return sinError(await supabase.rpc('apartado_entregar', { p_branch_id: Number(branchId), p_apartado: ref }));
}

/** Registrar un encargo SIN cobrar: Compras o administración confirma precio y fecha. */
export async function crearEncargoEnSucursal({ branchId, customerId, productoId, productoNombre, factor, cantidad, nota }) {
    return sinError(await supabase.rpc('encargo_en_sucursal_crear', {
        p_branch_id: Number(branchId), p_customer_id: Number(customerId), p_producto_id: Number(productoId),
        p_producto_nombre: productoNombre, p_factor: Number(factor) || 1, p_cantidad: Number(cantidad), p_nota: nota?.trim() || null,
    }));
}
