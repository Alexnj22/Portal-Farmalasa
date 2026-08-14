SET lock_timeout = '5s';

-- Las 11 aprobaciones de MIN/MAX que ya estaban en la bitácora se escribieron
-- con `requested_min`/`requested_max`, y el historial del producto lee
-- `old_min`/`new_min`. Por eso se veían como «MIN — MAX —» (reportado el
-- 2026-08-14 sobre CIPRO DENK): no era que faltara el dato, era que estaba
-- guardado con otro nombre.
--
-- Qué se completa y de dónde — nada se inventa:
--
--  · `new_min`/`new_max`  ← del PROPIO registro (`requested_min`/`requested_max`).
--    Es un cambio de nombre, no información nueva.
--  · `old_min`/`old_max`  ← de `minmax_change_requests.current_min/current_max`,
--    o sea el par que la solicitud dejó anotado como «Hoy» y que quien aprobó
--    tuvo a la vista. No es una medición del instante de aprobar —eso recién lo
--    devuelve `approve_minmax_request` desde hoy— pero es el registro real de
--    lo que había, hecho por el sistema y no por mí.
--  · `requested_by_name`/`requested_by_id` ← de la misma solicitud.
--
-- Las tres filas de junio no tienen `request_id` (venían de un flujo anterior):
-- reciben el cambio de nombre, que sale de ellas mismas, y nada más.
UPDATE public.audit_logs a
SET details = a.details
            || jsonb_build_object('new_min', a.details->'requested_min',
                                  'new_max', a.details->'requested_max')
            || COALESCE((
                 SELECT jsonb_strip_nulls(jsonb_build_object(
                          'old_min',           to_jsonb(r.current_min),
                          'old_max',           to_jsonb(r.current_max),
                          'requested_by_id',   to_jsonb(r.requested_by_id),
                          'requested_by_name', to_jsonb(r.requested_by_name)))
                 FROM public.minmax_change_requests r
                 WHERE r.id = (a.details->>'request_id')::bigint
               ), '{}'::jsonb)
WHERE a.action IN ('MINMAX_REQUEST_APPROVED', 'MINMAX_REQUEST_REJECTED')
  AND a.details ? 'requested_min'
  AND NOT (a.details ? 'new_min');
