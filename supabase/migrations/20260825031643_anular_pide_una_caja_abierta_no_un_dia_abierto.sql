SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Corrección de la regla de v2.748.0, el mismo día (usuario, 2026-08-24).
--
-- Ahí el freno era de la VENTA: una vez que salía el cierre de su día, esa
-- factura no se anulaba nunca más. El usuario lo corrigió al pedir el texto del
-- aviso — «espera a mañana para anularlo, o cuando esté una caja abierta en la
-- sucursal»— y esa frase describe otra regla.
--
-- El freno es del MOMENTO, no de la venta: lo que hace falta para anular es que
-- la sala tenga una caja abierta AHORA, porque de esa caja sale el efectivo que
-- se devuelve. La fecha de la factura no interviene — es lo que el usuario ya
-- había dicho («no importa si la factura es de hace 2 o 3 días») y que la regla
-- anterior leía al revés.
--
-- Consecuencia que hay que tener presente: con esto una venta vieja se puede
-- anular mientras haya caja abierta. Es deliberado.
--
-- ── Cómo se sabe que hay una caja abierta ───────────────────────────────────
-- No existe un registro de APERTURA: lo único que el portal captura es el
-- cierre. Entonces se deduce del cierre, y se puede porque el cierre es
-- definitivo — verificado sobre los 336 cortes capturados: **no hay ni un corte
-- parcial con hora posterior al Z de su día**. El Z es siempre el último evento
-- de la sala.
--
-- O sea: la sala tiene caja abierta si HOY todavía no sacó su cierre.
--
-- Dos límites conocidos, escritos para que nadie los descubra de nuevo:
--
--   · **La madrugada.** Entre medianoche y la apertura, «hoy» todavía no tiene
--     Z y esto contesta «abierta» aunque la sala esté con la persiana abajo. No
--     se inventa un horario para taparlo: el portal no tiene la hora de
--     apertura de cada sala, y un horario inventado fallaría distinto en cada
--     una. A esa hora no hay nadie pidiendo anulaciones.
--   · **Una sala que deje de emitir su Z** (falla de captura) se leería como
--     abierta para siempre. La falla acá es hacia ABIERTO, al revés que en la
--     versión anterior — es la consecuencia inevitable de deducir «está
--     abierta» de la ausencia de un cierre. Lo vigila `gate:eficiencia`, que
--     mide el cron `cortes-caja-30s`.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sala_con_caja_abierta(p_branch_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    -- Sin sala no se puede probar que haya una caja abierta, así que se
    -- responde que NO. La falla segura es la que no deja anular.
    SELECT p_branch_id IS NOT NULL
       AND NOT EXISTS (
             SELECT 1
               FROM public.cortes_caja c
              WHERE c.tipo      = 'Z'
                AND c.branch_id = p_branch_id::integer
                AND c.fecha     = (now() AT TIME ZONE 'America/El_Salvador')::date
           );
$$;

COMMENT ON FUNCTION public.sala_con_caja_abierta(bigint) IS
'TRUE si esa sala todavía no sacó su cierre del día, o sea que tiene una caja abierta ahora. Es la regla que habilita anular una venta: el efectivo devuelto sale de esa caja.';

REVOKE EXECUTE ON FUNCTION public.sala_con_caja_abierta(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sala_con_caja_abierta(bigint) TO authenticated, service_role;


-- El trigger deja de mirar la fecha de la factura y pasa a mirar la sala.
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

    -- La sala sale de la FACTURA, nunca del `metadata` que mandó el navegador:
    -- ese objeto lo escribe quien pide, y con él la regla se esquivaría
    -- nombrando una sala que todavía no cerró.
    SELECT estado, branch_id
      INTO v_estado, v_branch
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

    -- Sólo la anulación. Cambiar el cliente, el vendedor o la forma de pago no
    -- saca efectivo de ninguna caja, así que no necesita que haya una abierta.
    IF NEW.type = 'ANNULMENT_REQUEST'
       AND NOT public.sala_con_caja_abierta(v_branch) THEN
        RAISE EXCEPTION 'CAJA_CERRADA: esa sala ya sacó su cierre del día, así que no hay caja de dónde descontar.';
    END IF;

    RETURN NEW;
END;
$function$;

-- La regla vieja se va entera: dos funciones que contestan lo mismo de dos
-- maneras distintas es cómo una se queda vieja sin que nadie lo note.
DROP FUNCTION IF EXISTS public.cierre_del_dia_ya_salio(bigint, date);
