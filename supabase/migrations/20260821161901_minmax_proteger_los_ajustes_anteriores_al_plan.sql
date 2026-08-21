-- Todo lo construido entre el 20 y el 21 de agosto protege DE AQUÍ EN ADELANTE.
-- Los ajustes anteriores siguen sin marca, y el recálculo del 1-sep iba a
-- pasarles por encima igual que el del 1-ago se llevó 567.
--
-- Esto los marca — con la fecha y el autor que YA están en la bitácora, no
-- inventados. Autorizado explícitamente por el dueño el 2026-08-21.
--
-- Tres frenos, y los tres importan:
--
--  1. `p.manual_at IS NULL`: no pisa ninguna marca existente, y hace el script
--     idempotente. Correrlo dos veces no hace nada la segunda.
--  2. `p.min_units = <lo que se puso>`: SÓLO marca la fila si el valor vigente
--     ES el que puso la persona. Los 727 pares que el recálculo del 1-ago ya se
--     llevó quedan FUERA a propósito: marcarlos protegería el número del
--     cálculo y no el humano — se cambiaría un error automático por otro.
--  3. No toca `min_units` ni `max_units`. Ni uno. Esto agrega la marca, no
--     restaura valores: restaurar 1,106 números de inventario a ciegas es
--     exactamente el riesgo que este plan existe para evitar.
--
-- Medido antes de aplicar: 12 por solicitud aprobada + 1,094 por edición de
-- celda = 1,106 filas. Ya había 23 marcadas por el trigger desde ayer.
--
-- El trigger `trg_marcar_ajuste_manual_minmax` NO se dispara con esto: su WHEN
-- mira min_units, max_units y manual_motivo, y ninguno de los tres cambia acá.

SET lock_timeout = '5s';

-- Primero las solicitudes: traen `reason` escrito, que es el porqué que la
-- persona ya redactó y que hasta ayer se perdía al aprobar.
UPDATE product_stock_params p
SET manual_at  = r.decided_at,
    manual_por = r.decided_by,
    manual_nota = r.reason
FROM minmax_change_requests r
WHERE p.erp_product_id  = r.erp_product_id
  AND p.erp_sucursal_id = r.erp_sucursal_id
  AND r.status = 'approved'
  AND r.decided_at IS NOT NULL
  AND p.manual_at IS NULL
  AND p.min_units = r.requested_min
  AND p.max_units = r.requested_max;

-- Después las ediciones de celda: la ÚLTIMA de cada producto·sala, y sólo si su
-- número sigue siendo el vigente.
WITH ult AS (
  SELECT DISTINCT ON (target_id, (details->>'sucursal_id'))
         target_id::int                        AS pid,
         (details->>'sucursal_id')::int        AS sid,
         (details->>'new_min')::int            AS nmin,
         (details->>'new_max')::int            AS nmax,
         created_at,
         user_name
  FROM audit_logs
  WHERE action IN ('MINMAX_LIVE_EDIT', 'MINMAX_DRAFT_EDIT', 'MINMAX_UPDATED_FROM_PEDIDO')
    AND (details->>'new_max')     ~ '^[0-9]+$'
    AND (details->>'new_min')     ~ '^[0-9]+$'
    AND target_id                 ~ '^[0-9]+$'
    AND (details->>'sucursal_id') ~ '^[0-9]+$'
  ORDER BY target_id, (details->>'sucursal_id'), created_at DESC
)
UPDATE product_stock_params p
SET manual_at  = u.created_at,
    manual_por = COALESCE(u.user_name, 'según la bitácora')
FROM ult u
WHERE p.erp_product_id  = u.pid
  AND p.erp_sucursal_id = u.sid
  AND p.manual_at IS NULL
  AND p.min_units = u.nmin
  AND p.max_units = u.nmax;
