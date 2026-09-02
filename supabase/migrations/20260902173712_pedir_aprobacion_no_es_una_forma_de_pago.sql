SET lock_timeout = '5s';

/* ── Pedir aprobación no es una forma de pago ──────────────────────────────
 *
 * Propuesta del usuario (2-sep): «¿y si en vez de otro, dice Solicitar
 * aprobación, y la forma de pago sí sale como tarjeta, transferencia, cheque,
 * otro (ahí sí)?». Es mejor, y el motivo es que había DOS preguntas metidas en
 * un solo control:
 *
 *   ¿con qué pagó?          efectivo · transferencia · tarjeta · cheque · otro
 *   ¿esto necesita firma?   sí · no
 *
 * Con «Otro» haciendo de las dos, un pago de MAPFRE hecho POR TRANSFERENCIA que
 * necesitaba aprobación había que registrarlo como «Otro» — o sea, perder el
 * dato real de con qué se pagó, que es justamente lo que hace falta para
 * cuadrar el banco. Y al revés: todo «Otro» pedía firma aunque no hiciera falta.
 *
 * Separadas: la forma vuelve a ser el dato del pago —las cinco, «Otro»
 * incluido— y la aprobación es un interruptor aparte que se puede pedir con
 * CUALQUIER forma.
 *
 * `Otro` lo enciende y no se puede apagar, y eso conserva lo que se ganó al
 * quitarlo esta mañana: un pago sin forma reconocible no puede entrar sin que
 * alguien lo mire.
 *
 * El tipo se renombra porque el nombre viejo pasó a mentir: ya no es «confirmar
 * un Otro», es «aprobar un abono». Se puede renombrar sin cuidado — cero filas
 * de ese tipo en producción, medido antes.
 */

ALTER TABLE public.approval_requests
    DROP CONSTRAINT IF EXISTS approval_requests_type_check;

ALTER TABLE public.approval_requests
    ADD CONSTRAINT approval_requests_type_check CHECK (type IN (
        'PERMISSION','VACATION','SICK_LEAVE','SCHEDULE_CHANGE','SHIFT_CHANGE','OTHER',
        'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST','VENDOR_CHANGE_REQUEST',
        'CLIENT_CHANGE_REQUEST',
        'INVENTORY_TRANSFER_REQUEST','INVENTORY_TRANSFER_PUSH',
        'INVENTORY_DISCARD_REQUEST','INVENTORY_LOAD_REQUEST',
        'MINMAX_CHANGE_REQUEST',
        'CAJA_MOVIMIENTO_CHANGE',
        'ABONO_CREDITO_CHANGE',
        'ABONO_APROBACION'
    )) NOT VALID;

ALTER TABLE public.approval_requests VALIDATE CONSTRAINT approval_requests_type_check;

CREATE OR REPLACE FUNCTION public.es_solicitud_operativa(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_type = ANY (ARRAY[
    'ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
    'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST',
    'INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST',
    'INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH',
    'CAJA_MOVIMIENTO_CHANGE',
    'ABONO_CREDITO_CHANGE', 'ABONO_APROBACION'
  ]);
$function$;

CREATE OR REPLACE FUNCTION public.modulo_de_aprobacion(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN p_type = ANY (ARRAY['ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                             'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST'])
      THEN 'requests_facturacion'
    WHEN p_type = ANY (ARRAY['INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST'])
      THEN 'requests_inventario'
    WHEN p_type = 'CAJA_MOVIMIENTO_CHANGE'
      THEN 'requests_caja'
    WHEN p_type = ANY (ARRAY['ABONO_CREDITO_CHANGE', 'ABONO_APROBACION'])
      THEN 'requests_cuentas_por_cobrar'
    ELSE NULL
  END;
$function$;

DROP INDEX IF EXISTS approval_requests_una_confirmacion_por_pago;
CREATE UNIQUE INDEX approval_requests_una_aprobacion_por_pago
    ON public.approval_requests ((metadata ->> 'pago_id'))
    WHERE status = 'PENDING' AND type = 'ABONO_APROBACION';
