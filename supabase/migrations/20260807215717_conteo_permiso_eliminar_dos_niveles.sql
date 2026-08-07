-- Borrar un conteo: dos niveles, no uno.
--
-- v2.499.0 dejó que cualquiera con «Gestionar» borrara un conteo en cualquier
-- estado. Es demasiado: un conteo finalizado es evidencia firmada de una
-- auditoría —con el nombre de quién contó cada renglón y a qué hora— y uno a
-- medio contar son horas de trabajo de alguien más.
--
-- Lo que queda:
--   · «Gestionar» (can_edit) borra un conteo SIN EMPEZAR — abierto y sin un
--     solo renglón contado. Es el conteo que se armó mal: sucursal equivocada,
--     alcance equivocado, detalle equivocado. Nadie perdió nada al borrarlo.
--   · La capacidad `conteo_inventario_eliminar` borra cualquiera, incluido uno
--     finalizado o cerrado. Es la excepción y por eso es un permiso aparte.
--
-- «Empezado» se mide por renglones capturados, no por el estado: el conteo nace
-- en 'EN_PROGRESO' (nunca en 'BORRADOR'), así que mirar el estado dejaría el
-- borrado sin alcance real. Un renglón marcado «no ubicado» cuenta como
-- capturado: tiene físico 0, que es un dato, no la ausencia de uno.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.eliminar_conteo_inventario(p_conteo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_items int;
  v_contados int;
  v_sin_restriccion boolean;
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO'; END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE fisico_cantidad IS NOT NULL OR estado_item <> 'PENDIENTE')
  INTO v_items, v_contados
  FROM public.conteo_inventario_items WHERE conteo_id = p_conteo_id;

  v_sin_restriccion := public.auth_has_module_permission('conteo_inventario_eliminar', 'can_view');

  IF NOT v_sin_restriccion THEN
    -- El orden importa: un conteo finalizado casi siempre tiene renglones
    -- contados, y el motivo que hay que explicarle a quien lo intenta es que
    -- está firmado, no que está empezado.
    IF v_conteo.status NOT IN ('BORRADOR', 'EN_PROGRESO') THEN
      RAISE EXCEPTION 'ELIMINAR_REQUIERE_PERMISO_FINALIZADO';
    END IF;
    IF v_contados > 0 THEN
      RAISE EXCEPTION 'ELIMINAR_REQUIERE_PERMISO_INICIADO';
    END IF;
  END IF;

  DELETE FROM public.conteo_inventario_item_history h
  USING public.conteo_inventario_items ci
  WHERE h.item_id = ci.id AND ci.conteo_id = p_conteo_id;

  DELETE FROM public.conteo_inventario_items WHERE conteo_id = p_conteo_id;
  DELETE FROM public.conteos_inventario WHERE id = p_conteo_id;

  RETURN jsonb_build_object(
    'branch_id', v_conteo.branch_id,
    'status', v_conteo.status,
    'scope_type', v_conteo.scope_type,
    'modo', v_conteo.modo,
    'created_at', v_conteo.created_at,
    'total_items', v_items,
    'total_contados', v_contados,
    'total_diferencias', v_conteo.total_diferencias,
    -- Para la bitácora: no es lo mismo tirar un conteo vacío que uno firmado.
    'uso_permiso_especial', v_sin_restriccion AND (v_contados > 0 OR v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO'))
  );
END;
$function$;

-- La pantalla decide si ofrecer el botón con `get_conteo_resumen().contados`,
-- que ya viaja y NO está tapado en conteo ciego (es cuánto se avanzó, no cuánto
-- hay). Ese contador mira solo `estado_item <> 'PENDIENTE'`; el de acá suma
-- además `fisico_cantidad IS NOT NULL`. La diferencia es teórica —hoy los dos
-- se mueven juntos— y el desacuerdo cae del lado seguro: el servidor rechaza y
-- explica, en vez de borrar algo que la pantalla creyó vacío.
