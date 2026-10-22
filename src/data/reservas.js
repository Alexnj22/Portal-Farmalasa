import { supabase } from '../supabaseClient';
import { fechaTexto } from '../utils/fecha';
import { formatMoney } from '../utils/formatNumber';
import { subirArchivo } from '../utils/storageFiles';

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
        // Sólo una reserva de oferta tiene «precio de oferta» (2026-10-22): la
        // apartada en sala lleva el precio de ese día, que también se respeta.
        + (r.oferta ? '; el precio de oferta se respeta. ¡Le esperamos!' : '; se respeta el precio con que la apartó. ¡Le esperamos!');
}

/**
 * El mensaje de un encargo para quien no tiene la app (2026-10-22): con el
 * precio y la fecha que confirmó Bodega, o que ya llegó.
 */
export function mensajeDeEncargo(e, sala) {
    const nombre = String(e.cliente ?? '').trim().split(/\s+/)[0] ?? '';
    const primero = nombre ? nombre[0] + nombre.slice(1).toLowerCase() : '';
    const hola = `Hola${primero ? ` ${primero}` : ''}, le saludamos de Farmacia Salud ${sala ?? e.sala ?? ''}. `;
    if (e.estado === 'listo') return `${hola}Su encargo ${e.codigo} (${e.cantidad} × ${e.producto}) ya llegó. Puede pasar a retirarlo. ¡Le esperamos!`;
    return `${hola}Conseguimos su encargo ${e.codigo} (${e.cantidad} × ${e.producto}): `
        + `${formatMoney(Number(e.precio_unitario ?? 0))} c/u, total ${formatMoney(Number(e.anticipo ?? 0))}`
        + (e.fecha_estimada ? `, llega aproximadamente el ${fechaTexto(e.fecha_estimada, { weekday: 'long', day: 'numeric', month: 'long' })}` : '')
        + '. Para pedirlo se paga completo en la sala. ¿Le confirmamos?';
}

/** El mensaje con el enlace de pago que manda la sala (reglamento v3). */
export function mensajeDeEnlaceDePago(e, sala) {
    const nombre = String(e.cliente ?? '').trim().split(/\s+/)[0] ?? '';
    const primero = nombre ? nombre[0] + nombre.slice(1).toLowerCase() : '';
    return `Hola${primero ? ` ${primero}` : ''}, le saludamos de Farmacia Salud ${sala ?? ''}. `
        + `Este es el enlace para pagar ${formatMoney(Number(e.monto ?? 0))} de ${e.codigo}${e.detalle ? ` (${e.detalle})` : ''}: ${e.url} `
        + 'Puede pagar con tarjeta. Al pagarlo queda registrado y le avisamos cuando esté listo para retirar.';
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
 * no se entregó) se aplica en caja de CUALQUIER sala (2026-10-19). Desde el
 * 2026-10-21 es un CRÉDITO: se usa por partes (`monto`, con lo que queda como
 * tope) y lo usado se convierte en puntos del cliente, que la caja descuenta
 * como cualquier canje. `prueba` es la tarjeta de Puntos Salud (o su QR), el
 * DUI o el teléfono de la ficha: la base confirma con eso al titular.
 */
export async function usarSaldoAFavor(id, monto, prueba) {
    return sinError(await supabase.rpc('reserva_usar_saldo_favor', {
        p_id: Number(id), p_monto: Number(monto), p_prueba: String(prueba ?? '').trim(),
    }));
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
 * cualquier sala (2026-10-19): se usa en cualquier sucursal. Sin `prueba` (o
 * con una que no es del titular) la base sólo dice que existe y dónde nació
 * (`confirmado: false`): ni el nombre ni el monto (2026-10-21).
 */
export async function buscarSaldoAFavor(codigo, prueba = null) {
    return sinError(await supabase.rpc('saldo_favor_buscar', {
        p_codigo: String(codigo ?? '').trim(), p_prueba: prueba ? String(prueba).trim() : null,
    })) ?? [];
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

/** Varios productos en un mismo encargo (2026-10-22): un encargo por producto,
 *  todos en una sola llamada —se registran todos o ninguno—. `lineas`:
 *  `[{ productoId, productoNombre, factor, cantidad }]`. Devuelve `[{ id, codigo, producto_nombre, cantidad }]`. */
export async function crearEncargosEnSucursal({ branchId, customerId, lineas, nota }) {
    return sinError(await supabase.rpc('encargos_en_sucursal_crear', {
        p_branch_id: Number(branchId), p_customer_id: Number(customerId), p_nota: nota?.trim() || null,
        p_lineas: lineas.map((l) => ({ producto_id: Number(l.productoId), producto_nombre: l.productoNombre,
            factor: Number(l.factor) || 1, cantidad: Number(l.cantidad) })),
    }));
}

// ── Encargar un producto que NO tenemos (2026-10-21) ───────────────────────
// La sala escribe el nombre, lo busca en el SRS y puede agregar una foto. Si
// no aparece en el SRS va igual, como consulta: Bodega responde precio y fecha
// o que no se puede (con motivo). Cuando Bodega lo crea y ya está en el
// catálogo, lo vincula al encargo; sin eso no se marca «Llegó».

/** Lo que se guarda del registro del SRS que eligió la sala. */
export const srsParaEncargo = (r) => (r ? {
    nombre: r.nombre, lab: r.lab, forma: r.forma, principio: r.principio, conc: r.conc,
    noregistro: r.noregistro, estatus: r.estatus,
} : null);

/** La foto va a `encargos-fotos/<sala>/…`; devuelve la URL que se guarda. */
export async function subirFotoDeEncargo(branchId, archivo) {
    const ext = (String(archivo?.type ?? '').split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const nombre = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return subirArchivo('encargos-fotos', `${Number(branchId)}/${nombre}.${ext}`, archivo, { contentType: archivo?.type || 'image/jpeg' });
}

export async function crearEncargoDeProductoNuevo({ branchId, customerId, nombre, cantidad, nota, srs, fotoUrl }) {
    return sinError(await supabase.rpc('encargo_nuevo_en_sucursal_crear', {
        p_branch_id: Number(branchId), p_customer_id: Number(customerId), p_nombre: String(nombre ?? '').trim(),
        p_cantidad: Number(cantidad), p_nota: nota?.trim() || null, p_srs: srs ?? null, p_foto_url: fotoUrl ?? null,
    }));
}

/** Bodega amarra el encargo al producto que ya creó (y ya llegó al catálogo). */
export async function vincularProductoDeEncargo(id, productId) {
    return sinError(await supabase.rpc('encargo_vincular_producto', { p_id: Number(id), p_product_id: Number(productId) }));
}

// ── La reserva en camino (2026-10-22) ────────────────────────────────────────
// Lo que no llegó entero se resuelve desde Reservas: pedirlo a otra sala (con
// `usePedirTraslado` y `reserva_id` en la solicitud), encargar el resto a
// Bodega, o lo que el cliente decida. La base hace las cuentas del dinero.

/** Lo que falta por pedir: ni llegó ni viene en camino. */
export const faltaDeReserva = (r) => Math.max(0, Number(r?.cantidad ?? 0) - Number(r?.traslado_llegaron ?? 0) - Number(r?.traslado_por_llegar ?? 0));

/** La reserva espera una decisión de la sala (o del cliente). */
export const reservaPorResolver = (r) => r?.origen === 'sucursal' && r?.estado === 'pendiente'
    && ['rechazado', 'parcial', 'sin_existencia', 'precio'].includes(r?.traslado_estado);

export async function encargarRestoABodega(id, nota = null) {
    return sinError(await supabase.rpc('reserva_encargar_a_bodega', { p_id: Number(id), p_nota: nota?.trim() || null }));
}

/** El cliente acepta (o no) el precio con que Bodega consigue el resto. */
export async function decidirPrecioDeBodega(id, acepta) {
    return sinError(await supabase.rpc('reserva_precio_de_bodega', { p_id: Number(id), p_acepta: !!acepta }));
}

/**
 * Lo que decidió el cliente: cuánto se queda del original (0 = nada) y, si
 * quiere, una alternativa de ESTA sala `{ producto_id, producto_nombre, factor,
 * cantidad, precio }`. Lo pagado cubre primero lo que se queda, después la
 * alternativa; lo que sobre queda a su favor.
 */
export async function ajustarReserva(id, { cantidad, alternativa = null, motivo }) {
    return sinError(await supabase.rpc('reserva_ajustar', {
        p_id: Number(id), p_cantidad: Number(cantidad), p_alternativa: alternativa, p_motivo: String(motivo ?? '').trim(),
    }));
}

/**
 * El reparto del dinero de `reserva_ajustar`, para mostrarlo ANTES de
 * confirmar. Es la misma cuenta que hace la base; la que vale es la de allá.
 */
export function repartoDelAjuste({ pagado, precio, cantidad, totalAlternativa = 0 }) {
    const r2 = (n) => Math.round(Number(n) * 100) / 100;
    const queda = r2(Math.min(pagado, r2(precio * cantidad)));
    const alt = r2(Math.min(r2(pagado - queda), totalAlternativa));
    return { queda, alternativa: alt, aFavor: r2(pagado - queda - alt) };
}

/** Una sola prórroga de 7 días para retirar (reglamento v2, cláusula 7). La base la limita a una. */
export async function prorrogarReserva(id) {
    return sinError(await supabase.rpc('reserva_prorrogar', { p_id: Number(id) }));
}

export async function prorrogarEncargo(id) {
    return sinError(await supabase.rpc('encargo_prorrogar', { p_id: Number(id) }));
}

/** El cliente no retira (o desiste de) un encargo pagado: lo pagado queda a su favor. */
export async function pasarEncargoASaldo(id, motivo) {
    return sinError(await supabase.rpc('encargo_pasar_a_saldo', { p_id: Number(id), p_motivo: String(motivo ?? '').trim() }));
}

/** La sala pide devolver un saldo a favor en efectivo; lo autoriza administración. */
export async function pedirDevolucionEnEfectivo(id, motivo) {
    return sinError(await supabase.rpc('reserva_saldo_pedir_devolucion', { p_id: Number(id), p_motivo: String(motivo ?? '').trim() }));
}

export async function negarDevolucionEnEfectivo(id, motivo) {
    return sinError(await supabase.rpc('reserva_saldo_negar_devolucion', { p_id: Number(id), p_motivo: String(motivo ?? '').trim() }));
}

/** Amarra a la reserva el vale de caja (salida DEVOLUCION) con que se entregó. */
export async function marcarDevolucionEntregada(id, movimientoId) {
    return sinError(await supabase.rpc('reserva_devolucion_entregada', { p_id: Number(id), p_movimiento: Number(movimientoId) }));
}

/** Las devoluciones ya autorizadas que la sala todavía tiene que entregar. */
export const devolucionesPorEntregar = (filas) => (filas || []).filter((r) => r.devolucion_pedida_at
    && r.saldo_favor_devuelto_at && !r.devolucion_entregada_at);
