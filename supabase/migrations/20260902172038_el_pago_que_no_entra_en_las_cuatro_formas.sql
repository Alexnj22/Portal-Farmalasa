SET lock_timeout = '5s';

/* ── El pago que no entra en las cuatro formas ─────────────────────────────
 *
 * Pedido del usuario (2-sep), mirando un crédito de MAPFRE: «cuando es del
 * ISSS, MAPFRE… agrega otro como método de pago, y que llegue solicitud de
 * confirmación a admin».
 *
 * ── Por qué vuelve «Otro», que se había quitado ───────────────────────────
 * Esta mañana se quitó a propósito: un cajón de sastre vuelve incontable lo
 * que entró, y con «Otro» disponible el corte de la caja no se puede cuadrar
 * por método. Eso sigue siendo cierto para un cliente de mostrador.
 *
 * Pero un crédito de una ASEGURADORA o del ISSS no se paga con ninguna de las
 * cuatro: se liquida por planilla, por compensación o contra un convenio, y
 * hasta hoy la sala tenía que mentir eligiendo «Transferencia» para poder
 * cerrarlo. Una opción que obliga a mentir es peor que un cajón de sastre.
 *
 * La diferencia con el «Otro» que se quitó es que éste **no es silencioso**:
 * exige escribir con qué se pagó y **dispara una solicitud de confirmación**.
 * O sea que no vuelve incontable nada — queda contado como «Otro» y con nombre,
 * y alguien tiene que mirarlo.
 *
 * ── El abono se aplica YA y la confirmación va después ─────────────────────
 * No se hace esperar al crédito. El dinero de una aseguradora ya se acordó
 * cuando la sala lo registra, y dejar el crédito abierto hasta que alguien
 * firme lo haría figurar como deuda del cliente — que es falso y además lo
 * metería en el aviso del plazo. La confirmación es una revisión, no un
 * permiso previo.
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
        'ABONO_OTRO_CONFIRMAR'
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
    'ABONO_CREDITO_CHANGE', 'ABONO_OTRO_CONFIRMAR'
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
    WHEN p_type = ANY (ARRAY['ABONO_CREDITO_CHANGE', 'ABONO_OTRO_CONFIRMAR'])
      THEN 'requests_cuentas_por_cobrar'
    ELSE NULL
  END;
$function$;

/* El índice de «una sola viva por abono» pasa a cubrir las DOS familias: una
 * confirmación pendiente y una corrección pendiente sobre el mismo abono se
 * pisarían igual que dos correcciones.
 * (La migración siguiente lo parte en dos: la confirmación resultó ser por
 *  PAGO y no por abono.) */
DROP INDEX IF EXISTS approval_requests_un_abono_pendiente;
CREATE UNIQUE INDEX approval_requests_un_abono_pendiente
    ON public.approval_requests ((metadata ->> 'abono_erp'))
    WHERE status = 'PENDING'
      AND type IN ('ABONO_CREDITO_CHANGE', 'ABONO_OTRO_CONFIRMAR');
