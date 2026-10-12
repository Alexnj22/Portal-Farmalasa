// Partido de `cortesDiagnostico.js` el 2026-10-12 por peso, no por diseño:
// `data/bolsas` sólo necesita esta función pura, y al importarla desde el
// diagnóstico de cortes el empaquetador metía el diagnóstico entero en el trozo
// de Bolsas (2.8 → 9.3 kB gzip medido). `cortesDiagnostico` la re-exporta.

/**
 * Cuánto de una salida de bolsa lo contó ya un VALE de la caja, y cuánto no.
 *
 * ── Por qué una salida se parte en dos ─────────────────────────────────────
 * Una salida grande se reparte entre las bolsas que alcancen, y esas pueden ser
 * de días distintos. Sólo las partes que salen de una bolsa del día abierto se
 * convierten en un `VALE DE CAJA`, que es un renglón que el sistema de la caja
 * SÍ anota. Medido en Salud 3 el 1-sep: la remesa REM-1058 de **$500** salió de
 * tres bolsas —$119.38 de la de ese día y $380.62 de dos del 31-ago— y el vale
 * real fue de $119.38.
 *
 * Entonces la misma salida está mitad adentro y mitad afuera de la lista de
 * movimientos, y las dos mitades hay que poder nombrarlas:
 *
 *   `porVale`          cuánto aportó a cada vale, por `erp_movimiento_id`. Con
 *                      eso el renglón «VALE DE CAJA 8 (3 salidas) · $180.00» se
 *                      abre en las tres salidas que lo componen, sin adivinar
 *                      por monto — la cadena `caja_vale_id →
 *                      caja_vales_portal.erp_movimiento_id` es exacta.
 *   `montoSinVale`     lo que ningún vale contó. Ese dinero no aparecía en
 *                      ninguna pantalla de Efectivo: 65 salidas y $15,072.74
 *                      medidos el 2026-09-03.
 *
 * Un movimiento anulado no cuenta para ninguno de los dos: no movió dinero.
 *
 * `montoSinVale` nunca es negativo. Si las partes sumaran más que la operación
 * —dato inconsistente—, un negativo se restaría del neto e inventaría dinero;
 * cero dice «no queda nada afuera», que es la lectura segura.
 *
 * @param {object} op  fila de `bolsas_operaciones` con sus `bolsas_movimientos`
 *   embebidos, cada uno con `caja_vales_portal.erp_movimiento_id`.
 */
export function repartoDeUnaSalida(op) {
    const partes = (op?.bolsas_movimientos || []).filter((l) => !l.anulado_at);
    const porVale = new Map();
    let cubierto = 0;
    for (const l of partes) {
        const erp = l.caja_vales_portal?.erp_movimiento_id;
        if (erp == null) continue;
        const monto = Math.abs(Number(l.monto) || 0);
        porVale.set(erp, (porVale.get(erp) || 0) + monto);
        cubierto += monto;
    }
    const total = Math.abs(Number(op?.monto) || 0);
    return {
        porVale,
        cubiertoPorVales: cubierto,
        montoSinVale: Math.max(0, total - cubierto),
    };
}
