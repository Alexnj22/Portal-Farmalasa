SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Una venta no se anula si el cierre de su día ya salió.
--
-- La pregunta que contesta el usuario: si la caja ya cerró, ¿de dónde sale el
-- efectivo que hay que devolver, y en qué asiento queda esa venta? En ningún
-- lado — el conteo ya se hizo, se declaró y se cuadró. Anular después no
-- corrige nada: mueve un número que ya se reportó y deja la caja descuadrada
-- sin que nadie pueda explicar por qué.
--
-- ── Qué significa "el día ya cerró" ──────────────────────────────────────────
-- Dos cosas, y la segunda es la que cierra el hueco:
--
--   1. La sala emitió su cierre del día (`cortes_caja.tipo = 'Z'`) para esa
--      fecha. Es un dato del sistema de origen, no una decisión del portal: el
--      Z NO se confirma acá (`CortesView` lo dice: «el cierre del día no es un
--      conteo, no se confirma») — existe o no existe. Las 6 salas lo emiten
--      todos los días entre las 16:00 y las 22:11.
--
--   2. La fecha ya pasó. Sin esto la regla sería sólo tan buena como la captura
--      de cortes, que arrancó el 2026-08-14: toda venta anterior a esa fecha no
--      tiene ni una fila de corte, y con la regla apoyada nada más en el Z se
--      leerían como días ABIERTOS — justo al revés de la verdad. Un día que ya
--      pasó está cerrado, lo haya capturado el portal o no.
--
-- O sea que la ventana real de anulación es: **la venta de hoy, antes de que la
-- sala saque su cierre**. Es lo que pidió el usuario el 2026-08-24, y con eso
-- muere el «período de gracia de 3 días» que mostraba el widget: una gracia que
-- ofrecía anular una venta de anteayer era exactamente lo que no se puede
-- hacer.
--
-- ── Por qué SECURITY DEFINER ─────────────────────────────────────────────────
-- `cortes_caja` tiene RLS por módulo: su policy de SELECT exige
-- `auth_has_module_permission('cortes_caja','can_view')`, y sólo 9 de los 24
-- cargos lo tienen. Quien pide una anulación puede no ser uno de ellos, y sin
-- DEFINER su lectura no fallaría: devolvería CERO filas, o sea «el día está
-- abierto» — que es la falla silenciosa de siempre, y del lado que abre.
-- Lo que se expone es un booleano sobre una sala y una fecha que el llamador ya
-- conoce: no hay dato de caja que se escape por acá.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cierre_del_dia_ya_salio(
    p_branch_id bigint,
    p_fecha     date
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    -- Sin sala o sin fecha no se puede probar que el día siga abierto, así que
    -- se responde CERRADO. La falla segura es la que NO deja anular.
    SELECT p_branch_id IS NULL
        OR p_fecha     IS NULL
        OR p_fecha < (now() AT TIME ZONE 'America/El_Salvador')::date
        OR EXISTS (
             SELECT 1
               FROM public.cortes_caja c
              WHERE c.tipo      = 'Z'
                AND c.fecha     = p_fecha
                AND c.branch_id = p_branch_id::integer
           );
$$;

COMMENT ON FUNCTION public.cierre_del_dia_ya_salio(bigint, date) IS
'TRUE si el cierre del día de esa sala ya salió (existe su corte Z) o si la fecha ya pasó. Es la regla que impide anular una venta cuya caja ya se cerró.';

REVOKE EXECUTE ON FUNCTION public.cierre_del_dia_ya_salio(bigint, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cierre_del_dia_ya_salio(bigint, date) TO authenticated, service_role;


-- ── El candado, en el mismo trigger que ya validaba las solicitudes ─────────
-- Va acá y no sólo en la pantalla porque la pantalla se puede saltear: la
-- solicitud es un INSERT en `approval_requests` y cualquiera con sesión puede
-- mandarlo. La UI muestra la regla ANTES de llenar un formulario; esto la
-- impone.
--
-- Sólo para ANULACIÓN. Cambiar el cliente, el vendedor o la forma de pago no
-- mueve el efectivo de la caja, así que un día cerrado no los estorba.
CREATE OR REPLACE FUNCTION public.validar_solicitud_facturacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_estado text;
    v_id     bigint;
    v_branch bigint;
    v_fecha  date;
BEGIN
    IF NEW.type NOT IN ('ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                        'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST') THEN
        RETURN NEW;
    END IF;

    BEGIN
        v_id := (NEW.metadata->>'invoice_id')::bigint;
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'SOLICITUD_SIN_FACTURA: la solicitud no identifica una factura.';
    END;

    IF v_id IS NULL THEN
        RAISE EXCEPTION 'SOLICITUD_SIN_FACTURA: la solicitud no identifica una factura.';
    END IF;

    -- La sala y la fecha salen de la FACTURA, nunca del `metadata` que mandó el
    -- navegador: el metadata lo escribe quien pide, y con él la regla se
    -- esquivaría mandando la fecha de hoy.
    SELECT estado, branch_id, fecha
      INTO v_estado, v_branch, v_fecha
      FROM public.sales_invoices
     WHERE id = v_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FACTURA_NO_EXISTE: esa factura ya no está en el portal.';
    END IF;

    -- Una factura anulada no se anula otra vez, y tampoco se le cambia el
    -- cliente, la forma de pago ni el vendedor: ya no es un documento vivo.
    IF public.factura_esta_anulada(v_estado) THEN
        RAISE EXCEPTION 'FACTURA_ANULADA: esa factura ya está anulada.';
    END IF;

    IF NEW.type = 'ANNULMENT_REQUEST'
       AND public.cierre_del_dia_ya_salio(v_branch, v_fecha) THEN
        RAISE EXCEPTION 'CORTE_CERRADO: el cierre del día de esa venta ya salió, así que no se puede anular.';
    END IF;

    RETURN NEW;
END;
$function$;
