-- Las solicitudes personales que el portal y la app crean no cabían en la
-- tabla: el CHECK de `approval_requests.type` aceptaba los nombres viejos
-- (PERMISSION, SICK_LEAVE, SCHEDULE_CHANGE, OTHER) y no los que usa el código
-- (`REQUEST_TYPES`): PERMIT, DISABILITY, OVERTIME, ADVANCE, CERTIFICATE.
-- Medido el 2026-10-01: CERO solicitudes personales en toda la historia de
-- producción — el insert fallaba y la pantalla decía «No se pudo crear la
-- solicitud». Se agregan los cinco; los viejos se quedan.
SET lock_timeout = '5s';
ALTER TABLE public.approval_requests DROP CONSTRAINT approval_requests_type_check;
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_type_check CHECK (type = ANY (ARRAY[
  'PERMISSION','VACATION','SICK_LEAVE','SCHEDULE_CHANGE','SHIFT_CHANGE','OTHER',
  'PERMIT','DISABILITY','OVERTIME','ADVANCE','CERTIFICATE',
  'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST','VENDOR_CHANGE_REQUEST','CLIENT_CHANGE_REQUEST',
  'INVENTORY_TRANSFER_REQUEST','INVENTORY_TRANSFER_PUSH','INVENTORY_DISCARD_REQUEST','INVENTORY_LOAD_REQUEST',
  'MINMAX_CHANGE_REQUEST','CAJA_MOVIMIENTO_CHANGE','ABONO_CREDITO_CHANGE','ABONO_APROBACION','DIST_DESCUENTO'
]::text[])) NOT VALID;
ALTER TABLE public.approval_requests VALIDATE CONSTRAINT approval_requests_type_check;
