-- `auth_yo()` busca el apoyo vigente UNA vez, no tres.
--
-- 2026-11-10. La versión de 20261110221411 copió tal cual la búsqueda de las
-- cuatro funciones de identidad, y en ella `apoyo_vigente` (que recorre
-- employee_events) se llamaba tres veces por empleado candidato: dos por
-- `cargo_de_apoyo_vigente` y una por `sala_de_apoyo_vigente`. `auth_yo` corre
-- una vez en cada pedido al portal, así que eran ~2 ms de los ~3 de cada
-- pedido sólo en eso.
--
-- Ahora el apoyo se lee una vez (LATERAL) y de ahí salen el cargo y la sala,
-- con exactamente la misma regla que las dos funciones: el cargo de apoyo es
-- el `coverRoleId` si existe en `roles` y no es superusuario; la sala, el
-- `targetBranchId`. Mismo recuerdo, misma clave, mismos permisos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.auth_yo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_clave text := coalesce(v_uid::text, '-') || '@' || statement_timestamp()::text;
  v_c     text := current_setting('farmalasa.auth_yo', true);
  v_yo    jsonb;
BEGIN
  IF v_c IS NOT NULL AND v_c <> '' THEN
    v_yo := v_c::jsonb;
    IF v_yo->>'k' = v_clave THEN
      RETURN v_yo;
    END IF;
  END IF;

  SELECT jsonb_build_object(
           'k', v_clave,
           'e', x.id,
           'r', coalesce(c.cargo, x.role_id),
           's', CASE WHEN c.cargo IS NOT NULL THEN NULL ELSE x.secondary_role_id END,
           'b', coalesce((ap.a->>'targetBranchId')::integer, x.branch_id))
    INTO v_yo
    FROM (SELECT e.id, e.role_id, e.secondary_role_id, e.branch_id
            FROM public.employees e
           WHERE e.id = v_uid
              OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                          WHERE l.auth_user_id = v_uid)
           ORDER BY (e.id = v_uid) DESC
           LIMIT 1) x
    LEFT JOIN LATERAL (SELECT public.apoyo_vigente(x.id) AS a) ap ON true
    LEFT JOIN LATERAL (SELECT r.id::integer AS cargo FROM public.roles r
                        WHERE NOT coalesce(r.is_su, false)
                          AND r.id::text = ap.a->>'coverRoleId') c ON true;

  v_yo := coalesce(v_yo, jsonb_build_object('k', v_clave));
  PERFORM set_config('farmalasa.auth_yo', v_yo::text, true);
  RETURN v_yo;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.auth_yo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_yo() TO authenticated, service_role;
