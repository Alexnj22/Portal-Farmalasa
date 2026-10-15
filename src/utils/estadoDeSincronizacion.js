// El resumen de «los datos se están actualizando» — el recuadro «Datos» del
// menú de Ajustes del portal (`SidebarSyncStatus`) y su gemelo en el Menú de la
// app. Lo decide UNA vez el núcleo: qué corrida vale por sala y cuándo una
// sala está al día, atrasada o caída.
//
// La fuente es `inventory_sync_log` (`fetchInventorySyncLogRecent`), que desde
// el 2026-09-22 sólo leen quienes tienen `inventario` o `sync_health`: para el
// resto el recuadro no se pide ni se dibuja.

/** Más de 8 minutos sin una corrida: atrasada. */
export const MINUTOS_ATRASO = 8;
/** Más de 15, o la última falló: caída. */
export const MINUTOS_CAIDA = 15;

/** ¿Quién ve el recuadro? Los mismos dos módulos que pueden leer la tabla. */
export const veEstadoDeDatos = (hasPermission) =>
    !!(hasPermission?.('inventario', 'can_view') || hasPermission?.('sync_health', 'can_view'));

/** La corrida más reciente de cada sala (las filas vienen de la más nueva a la más vieja). */
export function ultimaPorSala(filas) {
    const porSala = {};
    for (const f of filas || []) {
        if (f?.erp_sucursal_id != null && !porSala[f.erp_sucursal_id]) porSala[f.erp_sucursal_id] = f;
    }
    return Object.values(porSala).sort((a, b) => a.erp_sucursal_id - b.erp_sucursal_id);
}

/** Aplica una fila nueva (de tiempo real) a la lista: reemplaza la de su sala. Ignora las de vencidos. */
export function conCorridaNueva(salas, fila) {
    if (!fila?.erp_sucursal_id || fila.is_vencidos) return salas;
    return [...(salas || []).filter((s) => s.erp_sucursal_id !== fila.erp_sucursal_id), fila]
        .sort((a, b) => a.erp_sucursal_id - b.erp_sucursal_id);
}

/** `'bien' | 'atrasada' | 'caida'` de una sala, `minutos` desde su última corrida. */
export function nivelDeSala(minutos, fallo) {
    if (fallo || minutos == null || minutos > MINUTOS_CAIDA) return 'caida';
    if (minutos > MINUTOS_ATRASO) return 'atrasada';
    return 'bien';
}

/**
 * El resumen entero: cada sala con sus minutos y su nivel, si hay errores o
 * salas viejas, si todo está bien, y hace cuántos minutos fue la última.
 */
export function resumenDeSincronizacion(salas, ahora = Date.now()) {
    const lista = (salas || []).map((s) => {
        const minutos = (ahora - new Date(s.synced_at).getTime()) / 60000;
        return { ...s, minutos, nivel: nivelDeSala(minutos, !s.success) };
    });
    const conErrores = lista.some((s) => !s.success);
    const algunaVieja = lista.some((s) => s.minutos > MINUTOS_CAIDA);
    const ultimaMs = lista.length ? Math.max(...lista.map((s) => new Date(s.synced_at).getTime())) : null;
    return {
        salas: lista,
        conErrores,
        algunaVieja,
        todoBien: lista.length > 0 && !conErrores && !algunaVieja,
        minutosDesdeLaUltima: ultimaMs ? Math.round((ahora - ultimaMs) / 60000) : null,
    };
}
