-- Un ajuste de inventario se frena por PRODUCTO, no por sala (2026-10-15).
--
-- Pedido del usuario: «que se pueda solicitar ajuste de inventario aunque haya
-- un conteo de inventario, solo si ese producto no está en ese conteo».
--
-- Antes (20260826230232) un conteo abierto en la sala frenaba TODA carga o
-- descarga. El motivo era que el número cambiara debajo de quien cuenta — y eso
-- sólo pasa con los productos que están DENTRO del conteo. Los conteos
-- cíclicos llevan una parte del catálogo (medido hoy: 4 abiertos, 1,448
-- renglones), así que el freno por sala trababa productos que nadie contaba.
--
-- Lo que se mantiene:
--   * La guarda sigue en el trigger: el alta es un INSERT directo del navegador.
--   * Un conteo abierto SIN renglones todavía (no se sabe qué va a contar)
--     frena la sala entera, como antes. Hoy no hay ninguno, pero «no sé qué
--     cuenta» no puede ser la puerta por la que pase un ajuste.
--   * `sucursal_en_conteo` conserva `en_conteo` con el MISMO significado para
--     la pantalla: «la sala entera está frenada». Una app vieja que sólo mira
--     esa clave deja abrir el formulario y el trigger rechaza lo que toque un
--     producto contado — la falla segura.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.frenar_ajuste_si_hay_conteo_abierto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch bigint;
  v_sala text;
  v_choques text[];
  v_n int;
BEGIN
  IF NEW.type NOT IN ('INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST') THEN
    RETURN NEW;
  END IF;

  -- La sala viaja dentro de `metadata`. Si no viene, no se puede decidir, y una
  -- solicitud de ajuste SIN sala es un defecto por su cuenta: se rechaza.
  v_branch := NULLIF(NEW.metadata->>'branch_id','')::bigint;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'La solicitud no dice de qué sala es, y sin eso no se puede registrar.';
  END IF;

  -- Un conteo abierto que todavía no tiene renglones: no se sabe qué va a
  -- contar, así que frena la sala entera.
  SELECT b.name INTO v_sala
  FROM public.conteos_inventario c
  JOIN public.branches b ON b.id = c.branch_id
  WHERE c.branch_id = v_branch
    AND c.status IN ('BORRADOR','EN_PROGRESO')
    AND NOT EXISTS (SELECT 1 FROM public.conteo_inventario_items i WHERE i.conteo_id = c.id)
  LIMIT 1;

  IF v_sala IS NOT NULL THEN
    RAISE EXCEPTION 'En % hay un conteo de inventario abierto. Mientras se cuenta no se puede cargar ni descargar producto: el número cambiaría debajo de quien está contando. Cierra el conteo y vuelve a intentarlo.', v_sala;
  END IF;

  -- Los productos de la solicitud que están en un conteo abierto de la sala.
  -- Una línea sin `erp_product_id` no se puede cruzar: se rechaza igual que la
  -- solicitud sin sala, para que no sea la vuelta por donde pase.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.metadata->'items','[]'::jsonb)) it
    WHERE NULLIF(it->>'erp_product_id','') IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.conteos_inventario c
    WHERE c.branch_id = v_branch AND c.status IN ('BORRADOR','EN_PROGRESO')
  ) THEN
    RAISE EXCEPTION 'Hay un conteo de inventario abierto en la sala y una línea de la solicitud no dice qué producto es. Quítala y vuelve a intentarlo.';
  END IF;

  SELECT array_agg(DISTINCT COALESCE(it->>'descripcion', it->>'erp_product_id')), count(DISTINCT it->>'erp_product_id')
    INTO v_choques, v_n
  FROM jsonb_array_elements(COALESCE(NEW.metadata->'items','[]'::jsonb)) it
  WHERE EXISTS (
    SELECT 1
    FROM public.conteos_inventario c
    JOIN public.conteo_inventario_items i ON i.conteo_id = c.id
    WHERE c.branch_id = v_branch
      AND c.status IN ('BORRADOR','EN_PROGRESO')
      AND i.erp_product_id = (it->>'erp_product_id')::int
  );

  IF v_n > 0 THEN
    -- El texto sale tal cual a la pantalla (`mensajeAmigable`): para una
    -- persona, sin jerga, y dice qué hacer (DESIGN.md §26).
    RAISE EXCEPTION '% en el conteo de inventario abierto: %. Mientras se cuenta no se puede cargar ni descargar: el número cambiaría debajo de quien está contando. Quítalo de la solicitud o espera a que cierre el conteo.',
      CASE WHEN v_n = 1 THEN 'Este producto está' ELSE 'Estos productos están' END,
      array_to_string(v_choques[1:3], ', ') || CASE WHEN v_n > 3 THEN format(' y %s más', v_n - 3) ELSE '' END;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.frenar_ajuste_si_hay_conteo_abierto() IS
  'Rechaza una solicitud de carga o descarte de inventario que toque un producto de un conteo abierto de la sala (o cualquiera, si el conteo abierto aún no tiene renglones). La guarda vive acá porque el alta es un INSERT directo del navegador.';

-- plpgsql y no sql: con `SET search_path` una `LANGUAGE sql` nace con plan
-- genérico (regla 4 de CLAUDE.md, trampa 4).
CREATE OR REPLACE FUNCTION public.sucursal_en_conteo(p_branch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_primero record;
  v_sin_items boolean;
  v_productos jsonb;
BEGIN
  SELECT c.id, c.created_at, c.status, b.name AS sala INTO v_primero
  FROM public.conteos_inventario c
  JOIN public.branches b ON b.id = c.branch_id
  WHERE c.branch_id = p_branch_id
    AND c.status IN ('BORRADOR','EN_PROGRESO')
  ORDER BY c.created_at
  LIMIT 1;

  IF v_primero.id IS NULL THEN
    RETURN jsonb_build_object('en_conteo', false, 'conteo_abierto', false, 'productos', '[]'::jsonb);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.conteos_inventario c
    WHERE c.branch_id = p_branch_id AND c.status IN ('BORRADOR','EN_PROGRESO')
      AND NOT EXISTS (SELECT 1 FROM public.conteo_inventario_items i WHERE i.conteo_id = c.id)
  ) INTO v_sin_items;

  SELECT COALESCE(jsonb_agg(DISTINCT i.erp_product_id), '[]'::jsonb) INTO v_productos
  FROM public.conteos_inventario c
  JOIN public.conteo_inventario_items i ON i.conteo_id = c.id
  WHERE c.branch_id = p_branch_id
    AND c.status IN ('BORRADOR','EN_PROGRESO')
    AND i.erp_product_id IS NOT NULL;

  -- `en_conteo` = la sala ENTERA está frenada (mismo significado que antes
  -- para quien sólo mira esa clave). `productos` = los que no se pueden tocar.
  RETURN jsonb_build_object(
    'en_conteo', v_sin_items,
    'conteo_abierto', true,
    'conteo_id', v_primero.id,
    'sala', v_primero.sala,
    'desde', v_primero.created_at,
    'status', v_primero.status,
    'productos', v_productos);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sucursal_en_conteo(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sucursal_en_conteo(bigint) TO authenticated, service_role;
