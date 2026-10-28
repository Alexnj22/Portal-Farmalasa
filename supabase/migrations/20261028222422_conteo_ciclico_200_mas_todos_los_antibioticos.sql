SET lock_timeout = '5s';
-- El conteo cíclico del día 15 lleva TODOS los antibióticos más 200 productos
-- que no lo son (pedido del usuario, 2026-10-28: «que salga junto al de la
-- quincena… 200 productos más los antibióticos… que no se repitan»).
--
-- Antes los antibióticos se comían la cuota: entraban primero y sólo hasta
-- `p_tamano`, así que en una sala con 70 quedaban 130 para el resto, y la
-- marca era la del catálogo (85 productos) y no el listado (159). Ahora:
--   · antibióticos = `antibioticos_del_cuadre()` con existencia, sin tope;
--   · los `p_tamano` se reparten sólo entre A/B/C, que por construcción ya no
--     tienen ningún antibiótico — no se pueden repetir.
--
-- Con eso el cíclico ES el cuadre mensual de antibióticos de cada sala: el
-- aviso y la hoja del cierre de mes aceptan un conteo CICLICO terminado igual
-- que uno «Bajo receta» (la Bodega no tiene cíclico y sigue con el suyo).
DO $$
DECLARE def text; nuevo text;
BEGIN
  SELECT pg_get_functiondef('public.seleccionar_muestra_ciclica(bigint,integer)'::regprocedure) INTO def;
  nuevo := def;
  nuevo := replace(nuevo, E'  v_ids int[];\nBEGIN',
                          E'  v_ids int[];\n  v_abx int[] := public.antibioticos_del_cuadre();\nBEGIN');
  nuevo := replace(nuevo, $a$WHEN p.es_antibiotico THEN 'BAJO_RECETA'$a$,
                          $a$WHEN u.pid = ANY(v_abx) THEN 'BAJO_RECETA'$a$);
  nuevo := replace(nuevo,
    $a$      LEAST(count(*) FILTER (WHERE seg = 'BAJO_RECETA'), p_tamano) AS q_abx,
      GREATEST(p_tamano - LEAST(count(*) FILTER (WHERE seg = 'BAJO_RECETA'), p_tamano), 0) AS resto$a$,
    $a$      count(*) FILTER (WHERE seg = 'BAJO_RECETA') AS q_abx,
      p_tamano AS resto$a$);
  nuevo := replace(nuevo,
    $a$    WHERE NOT EXISTS (SELECT 1 FROM base b WHERE b.pid = p.pid)$a$,
    $a$    WHERE NOT EXISTS (SELECT 1 FROM base b WHERE b.pid = p.pid) AND p.seg <> 'BAJO_RECETA'$a$);
  nuevo := replace(nuevo,
    $a$LIMIT GREATEST(p_tamano - (SELECT count(*) FROM base), 0)$a$,
    $a$LIMIT GREATEST(p_tamano - (SELECT count(*) FROM base WHERE seg <> 'BAJO_RECETA'), 0)$a$);
  IF nuevo NOT LIKE '%v_abx int[]%' OR nuevo NOT LIKE '%u.pid = ANY(v_abx)%' OR nuevo NOT LIKE '%p_tamano AS resto%'
     OR nuevo NOT LIKE '%AND p.seg <> ''BAJO_RECETA''%' OR nuevo NOT LIKE '%FROM base WHERE seg <> ''BAJO_RECETA''%' THEN
    RAISE EXCEPTION 'Sin ancla en seleccionar_muestra_ciclica';
  END IF;
  EXECUTE nuevo;

  -- La hoja del cierre de mes: el conteo del mes puede ser el cíclico.
  SELECT pg_get_functiondef('public.get_cuadre_antibioticos_mes(bigint,text)'::regprocedure) INTO def;
  nuevo := replace(def, $a$WHERE c.branch_id = p_branch_id AND c.scope_type = 'BAJO_RECETA'$a$,
                        $a$WHERE c.branch_id = p_branch_id AND c.scope_type IN ('BAJO_RECETA', 'CICLICO')$a$);
  IF nuevo = def THEN RAISE EXCEPTION 'Sin ancla en get_cuadre_antibioticos_mes'; END IF;
  EXECUTE nuevo;

  -- El aviso: cuenta como hecho un cíclico terminado.
  SELECT pg_get_functiondef('public.avisar_cuadre_antibioticos(date)'::regprocedure) INTO def;
  nuevo := replace(def, $a$c.scope_type = 'BAJO_RECETA'$a$, $a$c.scope_type IN ('BAJO_RECETA', 'CICLICO')$a$);
  nuevo := replace(nuevo,
    $a$'Cada mes se cuentan todos los antibióticos de la sala y se cuadran contra el sistema. '
                     || 'En Conteo de inventario, «Nuevo conteo» → «Bajo receta». Hay tiempo hasta fin de mes.'$a$,
    $a$'Cada mes se cuentan todos los antibióticos y se cuadran contra el sistema. '
                     || CASE WHEN c.sala = 'Bodega' THEN 'En Conteo de inventario, «Nuevo conteo» → «Bajo receta».'
                             ELSE 'Van dentro del conteo cíclico del día 15: terminen ese conteo.' END
                     || ' Hay tiempo hasta fin de mes.'$a$);
  nuevo := replace(nuevo,
    $a$'No se terminó el conteo «Bajo receta» de '$a$,
    $a$'No se terminó el conteo de antibióticos de '$a$);
  IF nuevo NOT LIKE '%Van dentro del conteo cíclico%' OR nuevo NOT LIKE '%conteo de antibióticos de ''%'
     OR nuevo LIKE $a$%c.scope_type = 'BAJO_RECETA'%$a$ THEN
    RAISE EXCEPTION 'Sin ancla en avisar_cuadre_antibioticos';
  END IF;
  EXECUTE nuevo;
END $$;
