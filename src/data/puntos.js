import { supabase } from '../supabaseClient';

/**
 * El estado de puntos de una venta y los movimientos de un cliente.
 *
 * Los dos salen de `puntos-consulta`, que es la ÚNICA puerta: ese dato no vive
 * en el portal sino en la base del programa de puntos, y el navegador no puede
 * hablar MySQL.
 *
 * ── Por qué se pregunta cada vez y no se guarda ──────────────────────────────
 * El estado cambia en el MOSTRADOR, no acá: un ticket pasa de «pendiente» a
 * «acumulado» cuando el cliente lo presenta, y eso puede ser hoy o dentro de
 * seis meses. Una copia en el portal habría que refrescarla entera para no
 * mentir, y mentir sobre puntos es peor que no mostrarlos — la sala le diría a
 * alguien que los tiene pendientes cuando ya los cobró.
 *
 * ── Ninguna de las dos LANZA ────────────────────────────────────────────────
 * Son datos de apoyo: la lista de ventas y la ficha del cliente tienen que
 * seguir funcionando aunque el otro sistema no conteste. Devuelven vacío y
 * dejan el motivo en consola. Es la misma decisión que `registrarEgreso`.
 *
 * ── ESTE ARCHIVO ES LA COSTURA, y es a propósito ────────────────────────────
 * Los puntos van a pasar a ser parte del portal (decisión del usuario,
 * 2026-08-29). Cuando eso pase, la base de destino deja de existir como sistema
 * aparte y todo esto sale de Postgres.
 *
 * Para que esa mudanza sea barata, NADA de la forma del otro sistema cruza esta
 * línea: las pantallas reciben `acumulado`/`pendiente`/`devuelto`, que son
 * palabras del negocio, y nunca `aplicado = 1`, ni `TicketFactura`, ni un
 * `idCliente` de allá. El día que los puntos vivan acá se reescriben estas dos
 * funciones —y sólo estas dos— y ni la lista de ventas ni la ficha del cliente
 * se enteran.
 *
 * Si alguna vez hace falta un campo nuevo, se traduce ACÁ. Meterlo crudo en una
 * pantalla es lo que convertiría una mudanza de un archivo en una de veinte.
 */

/** Estado de puntos de un puñado de ventas. `{ [invoice_id]: { estado, anulada } }` */
export async function fetchEstadoDePuntos(invoiceIds) {
    const ids = (invoiceIds || []).filter(Boolean);
    if (!ids.length) return {};
    try {
        const { data, error } = await supabase.functions.invoke('puntos-consulta', {
            body: { accion: 'ventas', invoice_ids: ids },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || 'respuesta sin ok');
        return data.estados || {};
    } catch (e) {
        console.error('puntos.js: fetchEstadoDePuntos', e);
        return {};
    }
}

/** Saldo y movimientos de un cliente. `motivo` dice por qué vino vacío. */
export async function fetchPuntosDeCliente(customerId) {
    if (!customerId) return { cliente: null, movimientos: [], motivo: 'sin_cliente' };
    try {
        const { data, error } = await supabase.functions.invoke('puntos-consulta', {
            body: { accion: 'cliente', customer_id: customerId },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || 'respuesta sin ok');
        return {
            cliente: data.cliente || null,
            movimientos: data.movimientos || [],
            motivo: data.motivo || null,
        };
    } catch (e) {
        console.error('puntos.js: fetchPuntosDeCliente', e);
        return { cliente: null, movimientos: [], motivo: 'error' };
    }
}

/**
 * Cómo se dice cada estado en pantalla.
 *
 * Los rótulos hablan del NEGOCIO y nunca del otro sistema: «Acumulados», no
 * «aplicado = 1». Y «Sin enviar» en vez de «no sincronizada» — quien lo lee no
 * tiene por qué saber que hay dos bases de datos.
 */
export const ROTULO_PUNTOS = {
    acumulado:   { label: 'Acumulados', variante: 'success', ayuda: 'El cliente ya presentó el ticket y se le dieron sus puntos.' },
    pendiente:   { label: 'Pendientes', variante: 'neutral', ayuda: 'La venta está registrada y sus puntos se pueden reclamar.' },
    devuelto:    { label: 'Devueltos',  variante: 'warning', ayuda: 'La venta se anuló y sus puntos se quitaron.' },
    por_revisar: { label: 'Por revisar', variante: 'danger', ayuda: 'La venta se anuló con los puntos ya entregados y no se pudieron quitar solos.' },
    sin_enviar:  { label: 'Sin enviar', variante: 'neutral', ayuda: 'Esta venta no acumula puntos.' },
};
