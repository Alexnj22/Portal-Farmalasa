-- 1. `consulta_existencia_ajuste` dice si el producto es perecedero: un ajuste
--    de un conteo viejo (sin fecha) de un perecedero lo rechaza la caja, y la
--    pantalla pide el mes y año antes (2026-10-30, X-Ray Dol).
-- 2. El aviso a la sala de una carga/descarte aplicado lleva la nota de quien
--    la aplicó hasta 280 caracteres (antes 140): la corrección de factor ahora
--    le dice a la sala qué NO se ajustó y qué tiene que pedir.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.consulta_existencia_ajuste(p_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  s public.consultas_existencia_salas%ROWTYPE;
  v_producto int;
  v_cmp jsonb;
  v_lineas jsonb := '[]'::jsonb;
  v_exacto boolean := true;
  l jsonb;
  v_resto int;
  r record;
BEGIN
  IF NOT public.auth_has_module_permission('requests_inventario', 'can_approve') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  SELECT * INTO s FROM public.consultas_existencia_salas WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ENCONTRADA'; END IF;
  IF s.estado <> 'DESCUADRE' THEN RAISE EXCEPTION 'SIN_DESCUADRE'; END IF;
  SELECT erp_product_id INTO v_producto FROM public.consultas_existencia WHERE id = s.consulta_id;

  v_cmp := public.consulta_existencia_comparar(v_producto, s.erp_sucursal_id, s.conteo_2);
  IF (v_cmp->>'diferencia')::int IS DISTINCT FROM s.diferencia
     OR (v_cmp->'por_lote') IS DISTINCT FROM (s.sistema->'ronda_2'->'por_lote') THEN
    RETURN json_build_object('cambio', true, 'ahora', v_cmp);
  END IF;

  FOR l IN SELECT value FROM jsonb_array_elements(v_cmp->'por_lote') WHERE (value->>'diferencia')::int <> 0 LOOP
    v_resto := abs((l->>'diferencia')::int);
    FOR r IN
      SELECT DISTINCT upper(trim(pr.tipo)) tipo, pp.factor
        FROM public.product_precios pp JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
       WHERE pp.product_id = v_producto AND pp.activo AND pp.factor > 0
       ORDER BY pp.factor DESC
    LOOP
      IF v_resto >= r.factor THEN
        v_lineas := v_lineas || jsonb_build_object(
          'sentido', CASE WHEN (l->>'diferencia')::int > 0 THEN 'carga' ELSE 'descarte' END,
          'tipo', r.tipo, 'factor', r.factor, 'cantidad', v_resto / r.factor,
          'lote', l->>'lote', 'vence', l->>'vence',
          'existencia', ((l->>'sistema')::int / r.factor));
        v_resto := v_resto % r.factor;
      END IF;
    END LOOP;
    IF v_resto > 0 THEN v_exacto := false; END IF;
  END LOOP;

  RETURN json_build_object('cambio', false, 'exacto', v_exacto, 'lineas', v_lineas,
                           'contado', v_cmp->'contado', 'sistema', v_cmp->'sistema',
                           'diferencia', v_cmp->'diferencia',
                           'perecedero', (SELECT coalesce(perecedero, false) FROM public.products WHERE id = v_producto));
END $function$;

CREATE OR REPLACE FUNCTION public.notificar_resolucion_movimiento_inventario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m          jsonb := coalesce(NEW.metadata, '{}'::jsonb);
    v_branch   integer := nullif(m->>'branch_id', '')::integer;
    v_quien    text;
    v_titulo   text;
    v_cuerpo   text;
    v_verbo    text;
    v_lineas   integer;
    v_unidades numeric;
    v_dest     uuid[];
BEGIN
    IF NEW.type NOT IN ('INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST') THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    IF v_branch IS NULL THEN RETURN NEW; END IF;

    SELECT array_agg(id) INTO v_dest FROM public.employees
     WHERE branch_id = v_branch AND status = 'ACTIVO'
       AND public.rango_de_empleado(id) BETWEEN 1 AND 2
       AND id <> NEW.employee_id
       AND (NEW.approver_id IS NULL OR id <> NEW.approver_id);

    -- Una sala sin jefatura activa no es un error: simplemente no hay a quién.
    IF v_dest IS NULL OR array_length(v_dest,1) IS NULL THEN RETURN NEW; END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.approver_id;
    v_quien    := coalesce(v_quien, 'Supervisión');
    v_verbo    := CASE NEW.status WHEN 'APPROVED' THEN 'aprobó' WHEN 'REJECTED' THEN 'rechazó' ELSE 'canceló' END;
    v_lineas   := coalesce(jsonb_array_length(m->'items'), 0);
    v_unidades := coalesce((m->>'total_unidades')::numeric, 0);

    v_titulo := CASE WHEN NEW.type = 'INVENTORY_LOAD_REQUEST'
                     THEN '📦 Carga ' || CASE NEW.status WHEN 'APPROVED' THEN 'aplicada' ELSE 'no aplicada' END
                     ELSE '🗑️ Descarte ' || CASE NEW.status WHEN 'APPROVED' THEN 'aplicado' ELSE 'no aplicado' END END;

    -- La nota hasta 280 (2026-10-30): la corrección de factor dice ahí lo que
    -- NO se ajustó y qué tiene que pedir la sala; a 140 se cortaba a la mitad.
    v_cuerpo := v_quien || ' ' || v_verbo || ' '
             || v_lineas || CASE WHEN v_lineas = 1 THEN ' producto' ELSE ' productos' END
             || ' (' || trim(to_char(v_unidades,'FM999,999,990.####'))
             || CASE WHEN v_unidades = 1 THEN ' unidad' ELSE ' unidades' END || ')'
             || coalesce(' por ' || nullif(m->>'subtipo',''), '')
             || ' en tu sala.'
             || coalesce(' — ' || left(nullif(btrim(NEW.approver_note),''), 280), '');

    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, '/requests?solicitud=' || NEW.id,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status),
           v_branch, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo,
                'url', '/requests?solicitud=' || NEW.id,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));
    RETURN NEW;
END;
$function$;
