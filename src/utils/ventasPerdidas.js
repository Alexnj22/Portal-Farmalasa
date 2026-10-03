/**
 * Ventas perdidas: lo que un cliente pidió y no había. El resumen de los más
 * pedidos y la forma de un reporte nuevo vivían en `VentasPperdidasView` y en
 * la tarjeta de búsqueda del tablero; se mudaron el 2026-10-03 para que la app
 * del teléfono reporte y resuma con la misma regla.
 */

/** Los más pedidos entre los pendientes: por unidades, con cuántas veces se pidió. */
export function masSolicitados(filas, cuantos = 5) {
    const m = {};
    for (const r of filas || []) {
        const k = r.descripcion || r.producto_buscado;
        if (!m[k]) m[k] = { nombre: k, veces: 0, total: 0 };
        m[k].veces += 1;
        m[k].total += Number(r.cantidad) || 0;
    }
    return Object.values(m).sort((a, b) => b.total - a.total).slice(0, cuantos);
}

/**
 * La fila de un reporte nuevo. `buscado` es lo que el cliente pidió tal cual;
 * `descripcion`, el nombre del producto si se identificó (p. ej. en el SRS).
 * La cantidad es un entero de 1 o más: si no, no hay reporte (`null`).
 */
export function reporteDeVentaPerdida({ buscado, descripcion = null, principioActivo = null, laboratorio = null, cantidad, salaId = null, empleadoId = null }) {
    const n = parseInt(cantidad, 10);
    const texto = String(buscado || descripcion || '').trim();
    if (!texto || !n || n < 1) return null;
    return {
        producto_buscado: texto, descripcion: descripcion || null, principio_activo: principioActivo || null,
        laboratorio: laboratorio || null, cantidad: n, branch_id: salaId, reportado_por: empleadoId, status: 'pendiente',
    };
}
