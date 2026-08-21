// Las sucursales que el recálculo mensual de MIN·MAX SÍ calcula.
//
// Bodega (erp_sucursal_id=6) NO está, a propósito (auditoría 2026-07-17): su
// MIN·MAX se mantiene solo y en tiempo real vía el trigger
// trg_bodega_draft_sync (SUM de las salas) y publish_stock_params —
// calculate_stock_params(6) generaba un borrador independiente basado en
// demanda agregada que publish_stock_params NUNCA podía aplicar (excluye
// erp_sucursal_id=6 en ambos bloques) y quedaba como ruido acumulado.
//
// Vive acá, y no dentro de `auto-calculate-minmax`, porque
// `check-sync-health-alerts` necesita la MISMA lista para saber a quién le
// toca correr. El vigilante deriva sus scopes del propio registro, así que una
// sucursal que alguna vez escribió una fila y después se sacó del cálculo se
// queda "vencida" para siempre. Pasó con Bodega: su única fila es del
// 17-jul-2026 —la corrida manual de aquella auditoría—, el 21-ago cruzó el
// umbral de 35 días y disparó un aviso al teléfono que iba a repetirse todos
// los días, porque el alertKey de antigüedad es uno por fecha.
//
// Dos listas dichas dos veces se desincronizan en la primera sucursal que
// entre o salga. Ésta es una sola, y los dos lados la importan.
export const ERP_ORDER_MINMAX = [5, 1, 2, 3, 4, 7];
