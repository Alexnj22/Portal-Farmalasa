SET lock_timeout = '5s';

-- El movimiento corregido no dice que lo corrigieron.
--
-- Al aplicar una corrección de MONTO, `operar-caja` escribe el monto nuevo en
-- `caja_movimientos_portal` y nada más: la fila queda igual que si el importe
-- siempre hubiera sido ése. La tarjeta de Mi caja mostraba «−$240.50» sobre un
-- movimiento que se anotó por $248.50, sin decir que hubo una corrección, quién
-- la pidió, quién la aprobó, cuánto decía antes ni por qué. Toda esa historia
-- estaba guardada —en `approval_requests`— y no la leía nadie desde ahí.
--
-- Se resuelve leyendo la solicitud, no copiando sus datos a la fila del
-- movimiento: una copia congelada se desincroniza y hay que mantenerla.
--
-- Por qué DEFINER: la policy de `approval_requests` deja verlas a quien tiene
-- `requests` can_view, y **Gerente General no lo tiene** — vería el movimiento
-- corregido sin la marca, que es exactamente el defecto que esto viene a
-- cerrar. La pregunta correcta no es «¿puede ver solicitudes?» sino «¿puede ver
-- ESTE movimiento?», así que la guarda es la MISMA de
-- `caja_movimientos_portal`: `cortes_caja` can_view, y la sala si el alcance no
-- es ALL.
--
-- Devuelve NULL —no `[]`— sin el permiso: «no las puedo ver» y «no hubo
-- ninguna» se leen igual en pantalla, y quien llama tiene que poder separarlas.
--
-- `plpgsql` y no `LANGUAGE sql`: con una cláusula SET, una función sql se
-- planifica una sola vez con los argumentos como Params y nace con plan
-- genérico (regla 4 de CLAUDE.md).
CREATE INDEX IF NOT EXISTS approval_requests_movimiento_de_caja
    ON public.approval_requests (((metadata ->> 'movimiento_portal')))
    WHERE type = 'CAJA_MOVIMIENTO_CHANGE';

CREATE OR REPLACE FUNCTION public.get_correcciones_de_caja(p_movimientos bigint[])
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_salida json;
    v_alcance text;
BEGIN
    IF NOT (SELECT public.auth_has_module_permission('cortes_caja', 'can_view')) THEN
        RETURN NULL;
    END IF;
    v_alcance := (SELECT public.auth_module_scope('cortes_caja'));

    SELECT coalesce(json_agg(to_json(t) ORDER BY t.pedida_at DESC), '[]'::json)
      INTO v_salida
      FROM (
        SELECT
            m.id                                              AS movimiento,
            s.id                                              AS solicitud,
            s.status                                          AS estado,
            s.metadata ->> 'que'                              AS que,
            nullif(s.metadata ->> 'monto_actual', '')::numeric AS monto_antes,
            nullif(s.metadata ->> 'monto_nuevo',  '')::numeric AS monto_despues,
            s.note                                            AS motivo,
            s.approver_note                                   AS nota_de_quien_decidio,
            s.created_at                                      AS pedida_at,
            -- La firma sólo cuando YA se decidió: mientras está pendiente,
            -- `approver_id` puede ser el primer destinatario del aviso y no
            -- quien decide. Nombrarlo ahí sería atribuir una decisión que
            -- todavía no existe.
            CASE WHEN s.status <> 'PENDING' THEN s.updated_at END AS decidida_at,
            json_build_object('id', pide.id, 'name', pide.name,
                              'photo_url', pide.photo_url)    AS pidio,
            CASE WHEN s.status <> 'PENDING' AND dec.id IS NOT NULL
                 THEN json_build_object('id', dec.id, 'name', dec.name,
                                        'photo_url', dec.photo_url) END AS decidio
        FROM public.approval_requests s
        JOIN public.caja_movimientos_portal m
          ON m.id = nullif(s.metadata ->> 'movimiento_portal', '')::bigint
        LEFT JOIN public.employees pide ON pide.id = s.employee_id
        LEFT JOIN public.employees dec  ON dec.id  = s.approver_id
       WHERE s.type = 'CAJA_MOVIMIENTO_CHANGE'
         -- Por TEXTO para que entre por el índice parcial de arriba; el join de
         -- abajo ya lo vuelve al número del movimiento.
         AND s.metadata ->> 'movimiento_portal' = ANY (
                SELECT x::text FROM unnest(p_movimientos) AS x)
         AND (v_alcance = 'ALL'
              OR m.branch_id = (SELECT public.auth_employee_branch_id()))
      ) t;

    RETURN v_salida;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_correcciones_de_caja(bigint[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_correcciones_de_caja(bigint[]) TO authenticated, service_role;
