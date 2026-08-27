SET lock_timeout = '5s';

-- ── El estado de una persona, sin depender de quién pregunta ────────────────
--
-- El aro de la foto (`AvatarConEstado`, DESIGN.md §5.4) se resolvía contra la
-- lista de empleados del navegador, y esa lista está ACOTADA: quien no tiene
-- `staff_list.can_view` sólo recibe los de su propia sucursal, y
-- `employee_events` exige además `staff_detail` o `schedules` para leer los
-- eventos de otro. O sea que para una dependienta mirando un pedido despachado
-- desde Bodega, la foto salía sin aro — y no había forma de distinguir «sin aro
-- porque está» de «sin aro porque no la puedo ver». Es el mismo silencio que el
-- aro vino a cerrar, una capa más abajo.
--
-- ── Por qué DEVUELVE DOS NIVELES ───────────────────────────────────────────
-- Que el aro nunca calle no puede costar que todo el personal se entere de que
-- alguien está de INCAPACIDAD, que es información de salud. Así que:
--
--   · quien ya puede leer los eventos —`staff_detail`, `schedules`, o los
--     propios— recibe el estado PRECISO, igual que hoy;
--   · el resto recibe `AUSENTE` a secas: sabe que esa persona no está, que es
--     lo que necesita para no confundirlo con «está», y nada más.
--
-- DEFINER porque el punto es justamente no depender del RLS de quien llama; y
-- por eso devuelve el mínimo: id, estado y hasta cuándo. Ni nombre, ni nota, ni
-- metadata del evento.
--
-- `RETURNS json` y no `jsonb`: es el canon del proyecto para payloads (jsonb
-- construye el binario completo en memoria). Y devolver JSON esquiva el techo
-- de 1000 filas de PostgREST, aunque acá el arreglo de entrada nunca se acerque.
CREATE OR REPLACE FUNCTION public.get_estados_de_personas(p_ids uuid[])
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_yo    uuid := auth_employee_id();
  v_ve    boolean := auth_has_module_permission('staff_detail', 'can_view')
                  OR auth_has_module_permission('schedules', 'can_view');
  v_out   json;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v_out
  FROM (
    SELECT e.id,
           -- El orden importa y es el mismo que el de `estadoDePersona` en el
           -- navegador: primero los estados FIJOS de la ficha, y sólo si no hay
           -- ninguno se mira el evento vigente. Si divergieran, la foto y el
           -- texto de al lado dirían cosas distintas y nadie podría decir cuál
           -- de las dos miente.
           CASE
             WHEN upper(coalesce(e.status, '')) IN ('INACTIVO', 'BAJA') THEN 'INACTIVO'
             WHEN upper(coalesce(e.status, '')) = 'LIQUIDADO'  THEN 'LIQUIDADO'
             WHEN upper(coalesce(e.status, '')) = 'SUSPENDIDO' THEN 'SUSPENDIDO'
             WHEN ev.type IS NULL THEN NULL
             -- Sin permiso para ver eventos, el motivo se calla: la persona no
             -- está y con eso alcanza.
             WHEN v_ve OR e.id = v_yo THEN ev.type
             ELSE 'AUSENTE'
           END AS clave,
           CASE WHEN v_ve OR e.id = v_yo
                THEN nullif(ev.metadata->>'endDate', '')
                ELSE NULL
           END AS hasta
    FROM public.employees e
    LEFT JOIN LATERAL (
      SELECT x.type, x.metadata
      FROM public.employee_events x
      WHERE x.employee_id = e.id
        AND x.type IN ('VACATION', 'DISABILITY', 'SUPPORT', 'PERMIT', 'INDUCTION')
        AND x.date <= v_hoy
        AND (nullif(x.metadata->>'endDate', '') IS NULL
             OR (x.metadata->>'endDate')::date >= v_hoy)
      ORDER BY x.date DESC
      LIMIT 1
    ) ev ON true
    WHERE e.id = ANY(p_ids)
  ) t
  WHERE t.clave IS NOT NULL;   -- quien está presente no viaja: es el caso común

  RETURN v_out;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_estados_de_personas(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_estados_de_personas(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_estados_de_personas(uuid[]) IS
  'El aro de AvatarConEstado (DESIGN.md §5.4). Devuelve sólo id/clave/hasta, y el motivo preciso únicamente a quien ya puede leer employee_events; el resto recibe AUSENTE.';
