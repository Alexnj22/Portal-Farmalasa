// Los pedidos de la distribuidora: qué se ve en cada pestaña, los números de
// arriba y el estado que se le muestra a cada uno. Vivían en `TabPedidos.jsx`
// y `PedidoModal.jsx`; acá los usan el portal y la app.
import { ESTADO_PEDIDO, VISTAS_PEDIDOS } from './distribucionComun';
import { tokenMatch } from './searchUtils';

/** Se trae una ventana de 60 días: la preventa se factura el mismo día o el siguiente. */
export const VENTANA_PEDIDOS_DIAS = 60;

/**
 * El estado de un pedido para la pantalla. Una preventa con un descuento
 * pedido espera a que lo decidan: no está «por facturar» todavía, y se dice así.
 */
export const estadoDePedido = (p) => (p.estado === 'confirmado' && p.descuento_solicitud_id
    ? { variant: 'warning', label: 'Descuento por aprobar' }
    : ESTADO_PEDIDO[p.estado] ?? ESTADO_PEDIDO.confirmado);

/** Los pedidos de una pestaña (pendientes / finalizados / anulados), con la búsqueda. */
export function pedidosDeLaVista(pedidos, vista, buscar = '') {
    const q = String(buscar ?? '').trim();
    const estados = (VISTAS_PEDIDOS.find(v => v.key === vista) ?? VISTAS_PEDIDOS[0]).estados;
    return (pedidos ?? []).filter(p => estados.includes(p.estado)
        && (!q || tokenMatch(q, p.dist_clientes?.nombre, String(p.id), p.dist_dte?.numero_control)));
}

/** Los números de arriba: por facturar, facturados hoy, sin sello y rechazados. */
export function resumenDePedidos(pedidos, hoy) {
    const lista = pedidos ?? [];
    return {
        porFacturar: lista.filter(p => p.estado === 'confirmado').length,
        facturadosHoy: lista.filter(p => p.estado !== 'anulado' && p.dist_dte && String(p.created_at).slice(0, 10) === hoy).length,
        sinSello: lista.filter(p => p.dist_dte && ['sin_firmar', 'firmado', 'contingencia'].includes(p.dist_dte.estado)).length,
        rechazados: lista.filter(p => p.dist_dte?.estado === 'rechazado').length,
    };
}

/** El número de control corto que se ve en la lista («#1234»). */
export const controlCorto = (numeroControl) => String(numeroControl ?? '').slice(-15).replace(/^0+/, '#');

/** Qué se puede hacer con un pedido, según su estado y si quien mira vende. */
export function accionesDePedido(pedido, puedeVender) {
    const dte = pedido.dist_dte;
    const porFacturar = !!puedeVender && pedido.estado === 'confirmado';
    return {
        facturar: porFacturar,
        anular: porFacturar,
        corregir: porFacturar,
        reintentar: !!puedeVender && !!dte && ['sin_firmar', 'firmado'].includes(dte.estado),
        volverAVender: !!puedeVender && pedido.estado !== 'confirmado',
        verDocumento: !!pedido.dte_id,
    };
}
