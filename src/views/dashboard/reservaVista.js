// Lo que la tarjeta y el detalle de una reserva dicen IGUAL (2026-10-22): el
// estado en palabras, las cuentas y el teléfono. Escrito una vez para que las
// dos piezas no terminen contando cosas distintas de la misma reserva.

// En qué va una reserva que viene de otra sala.
export const TRASLADO = {
    pedido: { label: 'Pedida a otra sala', variant: 'info' },
    enviado: { label: 'En camino', variant: 'info' },
    parcial: { label: 'Viene una parte', variant: 'warning' },
    rechazado: { label: 'No la mandan', variant: 'danger' },
    bodega: { label: 'Encargada a Bodega', variant: 'info' },
    precio: { label: 'Bodega: otro precio', variant: 'warning' },
    sin_existencia: { label: 'No se consigue', variant: 'danger' },
};

export const renglonesDe = (r) => r?.renglones ?? [r];

// Un estado por tarjeta: lo que pide la próxima acción de la sala.
export function estadoDeReserva(r) {
    const filas = renglonesDe(r);
    if (r.estado === 'en_revision') {
        return r.receta_estado === 'otra_foto'
            ? { label: 'Esperando otra foto', variant: 'info' }
            : { label: 'Receta por revisar', variant: 'warning', tono: 'warning' };
    }
    const pendientes = filas.filter((x) => x.estado === 'pendiente');
    if (pendientes.length && pendientes.length < filas.length) return { label: 'Una parte en camino', variant: 'info' };
    if (pendientes.length) {
        const t = pendientes.map((x) => TRASLADO[x.traslado_estado]).find(Boolean);
        if (t) return { ...t, tono: t.variant === 'danger' ? 'danger' : undefined };
        return { label: 'Por apartar', variant: 'warning' };
    }
    return { label: 'Lista para retirar', variant: 'success' };
}

// Total, lo pagado y lo que falta. Pagada en línea cuenta entera; si no, el anticipo.
export function cuentasDeReserva(r) {
    const filas = renglonesDe(r);
    const total = filas.reduce((t, x) => t + Number(x.precio ?? 0) * Number(x.cantidad ?? 1), 0) + Number(r.costo_envio ?? 0);
    const pagadoTodo = filas.every((x) => x.pago_estado === 'pagado') && !filas.some((x) => x.pago_prueba);
    const anticipo = filas.reduce((t, x) => t + Number(x.anticipo ?? 0), 0);
    const pagado = pagadoTodo ? total : Math.min(anticipo, total);
    return { total, pagado, falta: Math.max(0, Math.round((total - pagado) * 100) / 100), pagadoTodo };
}

// 72557451 → 7255-7451
export function telefonoLegible(tel) {
    const d = String(tel ?? '').replace(/\D/g, '');
    if (!d) return '';
    return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
}

export const formaDePagoLegible = (m) => ({
    efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', en_linea: 'En línea',
}[String(m ?? '').toLowerCase()] ?? (m || '—'));
