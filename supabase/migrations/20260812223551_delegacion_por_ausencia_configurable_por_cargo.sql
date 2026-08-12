-- La delegación por ausencia deja de ser una lista escrita en el código y pasa
-- a ser un interruptor por cargo y por módulo.
--
-- La versión de hace un rato (v2.577.0) traía una lista corta y fija: sólo se
-- heredaban los cinco módulos de solicitudes, y sólo ver y aprobar. El
-- razonamiento era «una ausencia no es una promoción».
--
-- El usuario lo corrigió, y tiene razón: heredar no es ascender, es **cargar
-- con el trabajo**. Que alguien se haya ido no significa que lo suyo quede en
-- pausa, y decidir cuál de sus tareas puede seguir sin él es una decisión del
-- negocio —cargo por cargo— y no algo que deba estar fijo en una función de
-- Postgres. Una lista en el código obliga a una migración cada vez que cambia
-- de opinión, que es la manera larga de decir que nunca cambia.
--
-- ── Dónde vive el interruptor ─────────────────────────────────────────────
-- En `role_permissions`, que ya está indexada por (cargo, módulo): exactamente
-- la granularidad que hace falta. La fila que manda es la del cargo AUSENTE:
-- «cuando no esté quien tiene este cargo, su jefe inmediato se hace cargo de
-- este módulo». Lo decide quien reparte los permisos, no quien los recibe.
--
-- Arranca en `false` en todos lados. Nada se hereda salvo que alguien lo
-- encienda a propósito, así que el default es el comportamiento de siempre.
-- Se siembran en `true` sólo los cinco de la lista que ya estaba viva, para no
-- cambiar por debajo lo que se desplegó hace un rato.
--
-- ── Y ahora sí se hereda `can_edit` ───────────────────────────────────────
-- Por lo mismo: si el interruptor está encendido es porque alguien decidió que
-- ese trabajo sigue. Recortarlo a ver/aprobar sería volver a decidir por él.

SET lock_timeout = '5s';

ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS delega_en_ausencia boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.role_permissions.delega_en_ausencia IS
  'Si esta encendido, cuando TODAS las personas activas de este cargo estan de vacaciones o incapacitadas, su jefe inmediato (roles.parent_role_id) hereda este modulo con estos mismos permisos, y lo pierde al volver.';

-- El freno de coste. Sin esto, cada consulta de permisos —y hay una en las
-- policies de 35 tablas— recorrería role_permissions buscando delegaciones que
-- casi siempre no existen. Con el índice parcial, «no hay nada delegado» se
-- contesta sin tocar la tabla.
CREATE INDEX IF NOT EXISTS role_permissions_delega_en_ausencia_idx
  ON public.role_permissions (role_id, module_key)
  WHERE delega_en_ausencia;

-- Conservar lo que ya estaba vivo: los cinco módulos que la lista fija
-- heredaba, en los cargos que efectivamente tienen ese permiso.
UPDATE public.role_permissions
   SET delega_en_ausencia = true
 WHERE module_key IN ('requests', 'requests_facturacion',
                      'requests_inventario', 'traslados', 'minmax')
   AND (can_view OR can_edit OR can_approve)
   AND NOT delega_en_ausencia;

-- ── La función, sin lista ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_hereda_por_ausencia(p_module_key text, p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.roles hijo
    JOIN public.role_permissions rp
      ON rp.role_id = hijo.id
     AND rp.module_key = p_module_key
    WHERE rp.delega_en_ausencia
      AND hijo.parent_role_id = (SELECT public.auth_employee_role_id())
      AND CASE p_action
            WHEN 'can_view'    THEN rp.can_view
            WHEN 'can_edit'    THEN rp.can_edit
            WHEN 'can_approve' THEN rp.can_approve
            ELSE false
          END
      -- El cargo tiene gente…
      AND EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.role_id = hijo.id AND e.status = 'ACTIVO'
      )
      -- …y no queda ni una disponible. Las dos condiciones hacen falta: sin la
      -- primera, un cargo VACÍO delegaría para siempre, porque «no queda
      -- ninguna disponible» es trivialmente cierto sobre el conjunto vacío.
      AND NOT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.role_id = hijo.id
          AND e.status = 'ACTIVO'
          AND NOT public.empleado_no_disponible(e.id)
      )
  );
$$;

COMMENT ON FUNCTION public.auth_hereda_por_ausencia(text, text) IS
  'Verdadero si quien consulta es jefe inmediato de un cargo que delega este modulo (role_permissions.delega_en_ausencia), lo tiene con esa accion, y TODAS sus personas activas estan de vacaciones o incapacitadas.';
