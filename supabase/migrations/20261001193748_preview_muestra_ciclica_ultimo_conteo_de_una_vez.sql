-- preview_muestra_ciclica (la vista previa del conteo cíclico) calculaba la
-- «cobertura» con un LEFT JOIN LATERAL: por CADA producto de la sala (1,521
-- en la medida) buscaba aparte cuándo se contó por última vez, y como la
-- función es INVOKER cada búsqueda volvía a pasar la RLS de cada renglón de
-- conteo (6,488 veces). Medido el 2026-10-01 con la sesión de un cargo de
-- dirección: 35,882 de sus 41,439 bloques por llamada.
--
-- Ahora el «último conteo por producto en esta sala» se calcula UNA vez y se
-- cruza: es la misma forma que ya usa `seleccionar_muestra_ciclica` (su CTE
-- `ultimo`). Cobertura idéntica en las dos salas con datos (1,521/103/0 y
-- 1,951/1,951/0). La función pasa a 6,454 bloques (−84%).
--
-- Parte de la definición VIVA y cambia sólo ese cruce; si el texto no está
-- tal cual, falla en vez de no hacer nada.
SET lock_timeout = '5s';
DO $$
DECLARE
  v_antes text := pg_get_functiondef('public.preview_muestra_ciclica'::regproc);
  v_despues text;
BEGIN
  v_despues := replace(v_antes,
    E'  LEFT JOIN LATERAL (\n    SELECT max(ci.contado_at) AS last_at\n    FROM public.conteo_inventario_items ci\n    JOIN public.conteos_inventario c ON c.id = ci.conteo_id\n    WHERE c.branch_id = p_branch_id AND ci.erp_product_id = x.pid AND ci.contado_at IS NOT NULL\n  ) u ON true;',
    E'  LEFT JOIN (\n    SELECT ci.erp_product_id AS pid, max(ci.contado_at) AS last_at\n    FROM public.conteo_inventario_items ci\n    JOIN public.conteos_inventario c ON c.id = ci.conteo_id\n    WHERE c.branch_id = p_branch_id AND ci.contado_at IS NOT NULL\n    GROUP BY ci.erp_product_id\n  ) u ON u.pid = x.pid;');
  IF v_despues = v_antes THEN
    RAISE EXCEPTION 'preview_muestra_ciclica: no encontré el LATERAL de la cobertura (¿cambió la función?)';
  END IF;
  EXECUTE v_despues;
END $$;
