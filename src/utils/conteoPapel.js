// El CONTENIDO del papel de un conteo de inventario, sin pdfmake: el orden de
// los renglones, qué entra al ajuste, su valor, los rótulos del encabezado y
// el CSV del ajuste. Lo usan el PDF del portal (`conteoInventarioPrint`) y el
// papel del teléfono (`conteoPapelHtml`), para que digan lo mismo.

// Un conteo sencillo no lleva lote ni vencimiento: sus columnas no van.
export const esSimple = (conteo) => conteo?.modo === 'SIMPLE';

export const SCOPE_LABEL = {
    TOTAL: 'Todo el inventario', LABORATORIO: 'Por laboratorio', BAJO_RECETA: 'Bajo Receta',
    MANUAL: 'Selección manual', CICLICO: 'Cíclico del mes',
};
export const FUENTE_LABEL = {
    HOJA: 'Se compara contra esta hoja',
    VIVO: 'Se compara contra la existencia del momento',
};

/** Laboratorio → producto → lote → presentación (la hoja y el reporte, igual). */
export function ordenarRenglonesDeConteo(items = []) {
    return [...items].sort((a, b) =>
        (a.laboratorio_nombre || '').localeCompare(b.laboratorio_nombre || '', 'es')
        || (a.product_nombre || '').localeCompare(b.product_nombre || '', 'es')
        || (a.lote || '').localeCompare(b.lote || '', 'es')
        || (a.presentacion || '').localeCompare(b.presentacion || '', 'es'));
}

/** Por código: como se teclea el ajuste, un renglón tras otro. */
export function ordenarParaDigitar(items = []) {
    return [...items].sort((a, b) =>
        (a.erp_product_id ?? 0) - (b.erp_product_id ?? 0)
        || (a.lote || '').localeCompare(b.lote || '', 'es')
        || (a.presentacion || '').localeCompare(b.presentacion || '', 'es'));
}

// Entra al ajuste si tiene diferencia propia Y su pila no cuadra en unidades
// (`diferencia_grupo`, el neto de la base).
export const esAjuste = (i) => i.diferencia != null && i.diferencia !== 0 && (i.diferencia_grupo ?? i.diferencia) !== 0;
export const valorAjuste = (i) => (i.costo_unitario != null ? i.diferencia * Number(i.costo_unitario) : null);

/** Las cuentas del pie del reporte. */
export const totalesDelConteo = (items = []) => ({
    items: items.length,
    conDiferencia: items.filter(esAjuste).length,
    sinContar: items.filter((i) => i.estado_item === 'PENDIENTE').length,
    noUbicados: items.filter((i) => i.estado_item === 'SIN_UBICAR').length,
});

/** El aviso de conteo parcial (o `null`). */
export function avisoDeConteoParcial(conteo) {
    if (!conteo?.total_pendientes) return null;
    return conteo.pendientes_como_cero
        ? `Al cerrar, ${conteo.total_pendientes} renglón(es) sin contar se dieron por no ubicados (físico 0). Su faltante está incluido en los montos.`
        : `CONTEO PARCIAL: ${conteo.total_pendientes} renglón(es) quedaron sin contar y NO están valuados. Estos montos no son un cuadre completo.`;
}

/** El CSV del ajuste: `{ headers, rows, nombre }`. */
export function csvDeAjustesConteo(conteo, items = []) {
    const simple = esSimple(conteo);
    const ajustes = ordenarParaDigitar(items.filter(esAjuste));
    const headers = [
        'Tipo', 'ID INTERNO', 'Codigo barras', 'Producto', 'Laboratorio', 'Presentacion',
        ...(simple ? [] : ['Lote', 'Vence']),
        'Area', simple ? 'Alta a mano' : 'Alta de lote', 'Sistema', 'Fisico', 'Ajuste',
        'Costo unitario', 'Valor ajuste', 'Nota',
    ];
    const rows = ajustes.map((i) => [
        i.diferencia < 0 ? 'FALTANTE' : 'SOBRANTE',
        i.erp_product_id ?? '', i.codigo_barras ?? '', i.product_nombre ?? '', i.laboratorio_nombre ?? '', i.presentacion ?? '',
        ...(simple ? [] : [i.lote ?? '', i.fecha_vencimiento ?? '']),
        i.is_vencidos ? 'VENCIDOS' : 'NORMAL', i.es_agregado_manual ? 'SI' : 'NO',
        i.sistema_cantidad, i.fisico_cantidad, i.diferencia, i.costo_unitario ?? '',
        valorAjuste(i) != null ? valorAjuste(i).toFixed(2) : '', i.nota ?? '',
    ]);
    const suc = (conteo?.branches?.name || 'sucursal').replace(/[^a-zA-Z0-9]/g, '_');
    return { headers, rows, nombre: `Ajuste_${suc}_${String(conteo?.id ?? '').slice(0, 8)}` };
}
