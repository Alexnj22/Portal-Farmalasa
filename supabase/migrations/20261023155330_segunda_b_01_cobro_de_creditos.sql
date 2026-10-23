SET lock_timeout = '5s';

-- Cobrar un crédito: un envío, UNA escritura en la caja (HA1, HA2, HA3).
-- Un abono en el sistema de la caja NO se puede deshacer. `resolver_otro`
-- abonaba antes de pasar la solicitud a APPROVED (doble aprobación o reintento
-- tras 504 = doble abono) y `pagar` no tenía clave de envío. La garantía es una
-- fila que se RECLAMA antes de tocar la caja (índice primario), como
-- `apartado_aplicaciones` y `credito_pago_tomar`. La reclama creditos-erp con la
-- llave del servidor; el navegador sólo la lee.
--   clave 'pagar:<uuid>' (una por intento de cobro) · 'resolver:<solicitud>'.
--   estado 'en_curso' mientras se escribe; 'hecho' con la respuesta dada. Si
--   nada entró, la fila se borra. Un 'en_curso' más viejo que p_vencido_seg es
--   de una ejecución muerta: se RETOMA revisando antes el historial del crédito.
--   Retención 90 días, purga perezosa al reclamar.

CREATE TABLE IF NOT EXISTS public.creditos_cobro_envios (
    clave        text PRIMARY KEY,
    branch_id    integer NOT NULL,
    tomado_por   uuid NOT NULL,
    estado       text NOT NULL DEFAULT 'en_curso'
                 CHECK (estado IN ('en_curso', 'hecho')),
    respuesta    jsonb,
    tomado_at    timestamptz NOT NULL DEFAULT now(),
    terminado_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creditos_cobro_envios_created_idx
    ON public.creditos_cobro_envios (created_at);

ALTER TABLE public.creditos_cobro_envios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS creditos_cobro_envios_select ON public.creditos_cobro_envios;
CREATE POLICY creditos_cobro_envios_select ON public.creditos_cobro_envios
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('cuentas_por_cobrar', 'can_view'))
           AND ((SELECT auth_module_scope('cuentas_por_cobrar')) = 'ALL'
                OR branch_id = (SELECT auth_employee_branch_id())));

REVOKE ALL ON public.creditos_cobro_envios FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.creditos_cobro_envios FROM authenticated;

COMMENT ON TABLE public.creditos_cobro_envios IS
    'Un envío de cobro de crédito = una escritura en la caja. creditos-erp reclama la fila (creditos_cobro_tomar) ANTES de abonar: el abono no se deshace en el origen. Retención 90 días.';

CREATE OR REPLACE FUNCTION public.creditos_cobro_tomar(
    p_clave text, p_branch_id integer, p_tomado_por uuid, p_vencido_seg integer DEFAULT 600)
RETURNS json
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
    v_fila public.creditos_cobro_envios;
BEGIN
    IF coalesce(btrim(p_clave), '') = '' THEN
        RAISE EXCEPTION 'falta la clave del envío';
    END IF;

    DELETE FROM public.creditos_cobro_envios
     WHERE created_at < now() - interval '90 days';

    INSERT INTO public.creditos_cobro_envios (clave, branch_id, tomado_por)
    VALUES (p_clave, p_branch_id, p_tomado_por)
    ON CONFLICT (clave) DO NOTHING;
    IF FOUND THEN
        RETURN json_build_object('tomado', true, 'retomado', false);
    END IF;

    SELECT * INTO v_fila FROM public.creditos_cobro_envios
     WHERE clave = p_clave FOR UPDATE;

    IF v_fila.estado = 'hecho' THEN
        RETURN json_build_object('tomado', false, 'estado', 'hecho',
                                 'respuesta', v_fila.respuesta);
    END IF;

    IF v_fila.tomado_at < now() - make_interval(secs => greatest(coalesce(p_vencido_seg, 600), 60)) THEN
        UPDATE public.creditos_cobro_envios
           SET tomado_at = now(), tomado_por = p_tomado_por
         WHERE clave = p_clave;
        RETURN json_build_object('tomado', true, 'retomado', true,
                                 'desde', v_fila.created_at);
    END IF;

    RETURN json_build_object('tomado', false, 'estado', 'en_curso',
        'hace_seg', floor(extract(epoch FROM now() - v_fila.tomado_at))::integer);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.creditos_cobro_tomar(text, integer, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.creditos_cobro_tomar(text, integer, uuid, integer) TO service_role;

COMMENT ON FUNCTION public.creditos_cobro_tomar(text, integer, uuid, integer) IS
    'Reclama un envío de cobro de crédito antes de escribir en la caja. Sólo service_role (creditos-erp). Ver creditos_cobro_envios.';

-- Los hermanos del diálogo no incluyen lo que ya espera firma (HA1). Definición
-- viva (2026-10-23); sólo cambia el NOT EXISTS. Sigue INVOKER.
CREATE OR REPLACE FUNCTION public.creditos_del_cliente(p_credito_id bigint)
 RETURNS TABLE(id bigint, branch_id bigint, credito text, documento text, fecha date, total numeric, abonado numeric, saldo numeric, dias integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH base AS (
        SELECT c.branch_id, c.customer_id, c.cliente
        FROM public.creditos_de_clientes c
        WHERE c.id = p_credito_id
    )
    SELECT c.id, c.branch_id, c.credito_erp, c.numero_doc, c.fecha,
           c.total, c.abonado, c.saldo, (current_date - c.fecha)::integer
    FROM public.creditos_de_clientes c, base b
    WHERE c.branch_id = b.branch_id
      AND c.saldo > 0.004
      AND (
        CASE WHEN b.customer_id IS NOT NULL
             THEN c.customer_id = b.customer_id
             ELSE c.customer_id IS NULL AND c.cliente = b.cliente
        END
      )
      AND (c.id = p_credito_id OR NOT EXISTS (
            SELECT 1 FROM public.creditos_cobros_por_aprobar r
             WHERE r.branch_id = c.branch_id
               AND r.credito_erp = c.credito_erp
               AND r.resuelto_at IS NULL))
    ORDER BY c.fecha, c.id;
$function$;

NOTIFY pgrst, 'reload schema';
