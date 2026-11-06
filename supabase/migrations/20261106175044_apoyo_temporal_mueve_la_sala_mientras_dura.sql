SET lock_timeout = '5s';

-- El apoyo temporal mueve la SALA de una persona mientras dura (2026-11-06).
--
-- Fernando Oliva (Bodega) apoya como vendedor en Salud 4 hasta el 15-nov y no
-- podía hacer entradas ni salidas de caja allá: la caja, y más de 90 policies,
-- deciden «tu sala» con `employees.branch_id`, y un apoyo no lo toca. Decisión
-- del usuario: mientras el apoyo esté vigente, la persona ES de esa sala en
-- todo el portal; al vencer vuelve sola a la de su ficha, sin que nadie tenga
-- que acordarse de revertir nada.
--
-- Vigente = evento SUPPORT no cancelado ni reemplazado, con sala destino, y
-- con el día de HOY (hora de El Salvador) dentro de uno de sus rangos
-- (`supportRanges`) o, si no los tiene, entre `date` y `endDate`. Sin
-- `endDate` vale sólo su día: un apoyo sin fin movería a alguien para siempre,
-- y la falla segura es que no mueva.
CREATE OR REPLACE FUNCTION public.sala_de_apoyo_vigente(
    p_employee_id uuid,
    p_dia date DEFAULT ((now() AT TIME ZONE 'America/El_Salvador')::date)
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT (ev.metadata->>'targetBranchId')::integer
      FROM public.employee_events ev
     WHERE ev.employee_id = p_employee_id
       AND ev.type = 'SUPPORT'
       AND coalesce(ev.metadata->>'status', '') NOT IN ('CANCELLED', 'SUPERSEDED')
       AND coalesce(ev.metadata->>'targetBranchId', '') ~ '^[0-9]+$'
       AND CASE
             WHEN jsonb_typeof(ev.metadata->'supportRanges') = 'array'
              AND jsonb_array_length(ev.metadata->'supportRanges') > 0
             THEN EXISTS (
                    SELECT 1 FROM jsonb_array_elements(ev.metadata->'supportRanges') r
                     WHERE coalesce(r->>'start', '') ~ '^\d{4}-\d{2}-\d{2}$'
                       AND coalesce(r->>'end',   '') ~ '^\d{4}-\d{2}-\d{2}$'
                       AND (r->>'start')::date <= p_dia
                       AND (r->>'end')::date   >= p_dia)
             ELSE ev.date <= p_dia
              AND (CASE WHEN coalesce(ev.metadata->>'endDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
                        THEN (ev.metadata->>'endDate')::date ELSE ev.date END) >= p_dia
           END
     ORDER BY ev.date DESC, ev.created_at DESC
     LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.sala_de_apoyo_vigente(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sala_de_apoyo_vigente(uuid, date) TO authenticated, service_role;

-- La sala de la sesión: la del apoyo vigente, si hay uno; si no, la de la ficha.
-- Todas las policies y funciones que preguntan «¿es de su sala?» pasan por acá,
-- así que el apoyo vale en todo el portal con un solo cambio.
CREATE OR REPLACE FUNCTION public.auth_employee_branch_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT coalesce(public.sala_de_apoyo_vigente(e.id), e.branch_id) FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                 WHERE l.auth_user_id = (select auth.uid()))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$$;
