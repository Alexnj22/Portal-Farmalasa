// El registro de antibióticos por lote (PENDIENTES 17; Guía SRS 3.3/3.4),
// escrito UNA vez para la pantalla y la descarga: cómo se aplana el JSON de
// `get_registro_antibioticos_lote`, el saldo corrido de un lote, cómo se dice
// una cantidad en cajas y qué explica una diferencia.
//
// Todo número que llega de la base está en UNIDADES MÍNIMAS (cápsula, tableta,
// ampolla): es la única unidad en la que compras, traslados, ventas y
// existencias suman entre sí. Las cajas son sólo una ayuda para leerlo.

/** Lo que dice cada tipo de movimiento, en palabras de la sala. */
export const TIPO_MOVIMIENTO = {
    compra: 'Compra',
    recibido: 'Recibido',
    enviado: 'Enviado',
    venta: 'Venta',
    recibido_sin_lote: 'Recibido sin lote',
};

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Una fila por lote, con los datos del producto pegados. El orden es el de la
 * base (producto, y dentro de él los lotes por vencimiento).
 */
export function filasDelRegistro(registro) {
    const filas = [];
    for (const p of registro?.productos || []) {
        const cuadraProducto = num(p.cuadre?.diferencia) === 0;
        for (const l of p.lotes || []) {
            filas.push({
                clave: `${p.product_id}|${l.lote}`,
                product_id: p.product_id,
                producto: p.producto,
                en_el_libro: Boolean(p.en_el_libro),
                factor_caja: num(p.factor_caja),
                cuadre_producto: p.cuadre || null,
                cuadra_producto: cuadraProducto,
                traslados_fuera: num(p.traslados_fuera_del_portal) || 0,
                ...l,
                inicial: num(l.inicial),
                entradas: num(l.entradas) ?? 0,
                salidas: num(l.salidas) ?? 0,
                final_calculado: num(l.final_calculado),
                existencia: num(l.existencia),
                en_vencidos: num(l.en_vencidos) ?? 0,
                diferencia: num(l.diferencia),
                movimientos: l.movimientos || [],
            });
        }
    }
    return filas;
}

/** Estado de una fila: 'cuadra' | 'diferencia' | 'sin_base' | 'sin_lote'. */
export function estadoDeFila(f) {
    if (f.sin_lote) return 'sin_lote';
    if (f.diferencia === null || f.diferencia === undefined) return 'sin_base';
    return f.diferencia === 0 ? 'cuadra' : 'diferencia';
}

/**
 * Los movimientos del lote con el saldo después de cada uno. Sin saldo inicial
 * conocido (`sin_base`) no hay saldo corrido: se devuelve `saldo: null` en vez
 * de arrancar de cero, que inventaría un número.
 */
export function saldoCorrido(fila) {
    let saldo = fila.inicial;
    return (fila.movimientos || []).map((m) => {
        const u = Number(m.unidades) || 0;
        if (saldo !== null && saldo !== undefined) saldo += u;
        return { ...m, unidades: u, saldo: saldo ?? null };
    });
}

/**
 * Una cantidad en cajas, para leerla rápido: 290 con caja de 30 → «9 cj + 20».
 * Devuelve '' cuando no aporta (sin factor, factor 1, o menos de una caja).
 */
export function enCajas(unidades, factor) {
    const u = Number(unidades);
    const f = Number(factor);
    if (!Number.isFinite(u) || !Number.isFinite(f) || f <= 1) return '';
    const abs = Math.abs(u);
    if (abs < f) return '';
    const cajas = Math.floor(abs / f);
    const resto = abs - cajas * f;
    const signo = u < 0 ? '−' : '';
    return resto ? `${signo}${cajas} cj + ${resto}` : `${signo}${cajas} cj`;
}

/**
 * Por qué puede no cuadrar un lote, en una línea, o null si cuadra o no hay
 * nada que decir. El orden es de la explicación más probable a la menos.
 */
export function explicarDiferencia(f) {
    const estado = estadoDeFila(f);
    if (estado === 'sin_lote') {
        return 'Traslados hechos fuera del portal: el sistema no dice qué lote llevaron.';
    }
    if (estado === 'sin_base') {
        return 'Lote anterior al registro: se podrá cuadrar con la foto del primer día del mes.';
    }
    if (estado === 'cuadra') return null;
    if (f.fundido) return 'El lote viene escrito con dos números juntos: no coincide con el de la existencia.';
    if (f.generico) return 'Lote «GENERICO»: no identifica un lote real, así que no se puede seguir.';
    if (f.cuadra_producto && f.traslados_fuera > 0) {
        return 'El producto cuadra: la diferencia está en qué lote se movió, en un traslado hecho fuera del portal.';
    }
    if (f.cuadra_producto) return 'El producto cuadra: la diferencia está en el lote anotado en una venta o un traslado.';
    return 'Movimiento sin registrar: ajuste, devolución, vencido o traslado que no pasó por el portal.';
}

/** Cuenta por estado, para el filtro y el resumen. */
export function contarPorEstado(filas) {
    const c = { todos: 0, diferencia: 0, sin_base: 0, cuadra: 0, sin_lote: 0 };
    for (const f of filas) {
        c.todos += 1;
        c[estadoDeFila(f)] += 1;
    }
    return c;
}

const ORIGEN_INICIAL = {
    foto: 'Foto del inventario',
    historial: 'Historial del portal',
    sin_base: 'Sin saldo inicial',
};

/**
 * La descarga del registro: UNA fila por movimiento, con el saldo inicial y el
 * cierre de cada lote como filas propias — la forma de un libro de control que
 * un inspector reconoce. Devuelve `{ headers, rows }` para `exportCsv`.
 */
export function csvDelRegistro(registro, sucursal) {
    const headers = [
        'Sucursal', 'Producto', 'Bajo receta retenida', 'Lote', 'Vence', 'Fecha', 'Movimiento',
        'Documento', 'Origen / destino', 'Unidades', 'Saldo', 'Responsable', 'Nota',
    ];
    const rows = [];
    for (const f of filasDelRegistro(registro)) {
        const base = [sucursal, f.producto, f.en_el_libro ? 'Sí' : 'No', f.lote, f.vence ?? ''];
        rows.push([...base, registro?.desde ?? '', 'Saldo inicial', '', ORIGEN_INICIAL[f.inicial_origen] ?? '',
            '', f.inicial ?? '', '', '']);
        for (const m of saldoCorrido(f)) {
            rows.push([...base, m.fecha, TIPO_MOVIMIENTO[m.tipo] ?? m.tipo, m.documento ?? '', m.detalle ?? '',
                m.unidades, m.saldo ?? '', m.responsable ?? '', m.aproximado ? 'Reparto aproximado entre lotes' : '']);
        }
        rows.push([...base, registro?.hasta ?? '', 'Existencia', '', '', '', f.existencia ?? '', '',
            f.diferencia ? `Diferencia ${f.diferencia}` : '']);
    }
    return { headers, rows };
}
