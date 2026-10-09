-- 09 · Los dos historiales jsonb que el navegador reescribía ENTEROS (2026-10-08).
--
-- `entrega_programada_historial` (Programar entrega) y `reenvios_historial`
-- (pedir un reenvío) se escribían así: leer el arreglo, agregarle una entrada
-- en el navegador y mandar el arreglo completo. Dos pantallas abiertas sobre
-- la misma sala —o la base cambiando el arreglo en el medio, que pasa: al
-- salir la ruta, `avisar_salida_de_ruta` le pone `sent_at` al ciclo— y gana la
-- última escritura: la entrada del otro desaparece sin error. En el reenvío
-- además el número de ciclo salía de `historial.length + 1` leído antes, así
-- que dos pedidos simultáneos daban el MISMO número de ciclo, que es la clave
-- con la que la ruta marca el reenvío (`ruta_pedidos.reenvio_ciclo`).
--
-- Ahora la base AGREGA sobre la fila bloqueada y calcula el ciclo ahí mismo.
--
-- Forma exacta de cada entrada — la misma que escribía usePedidosData.js:
--   · programar: { programada_at, registrado_at, por, nombre } (+ `motivo`,
--     sólo si viene; es nuevo y la pantalla no lo mandaba).
--   · reenvío: { ciclo, cajas, electrolits, especiales (sólo etiquetas),
--     sent_at: null, sent_by: null, solicitado_at, solicitado_por,
--     arrived_at: null, arrived_tipo: null, cajas_ok: [], cajas_danadas: [],
--     cajas_aun_faltantes: [] }. Nace PENDIENTE (decisión 2026-10-07): no toca
--     `reenvio_bodega_at`, así que no avisa; el aviso sale cuando sale la ruta.
--   · `por` / `solicitado_por` salen de `auth_employee_id()` — antes eran el
--     `user.id` que mandaba el navegador. Medido: los `por` que hay en
--     producción ya son ids de `employees`.
--
-- Alcance: las dos son de Bodega. En la pantalla, «Programar» sólo se ve con
-- alcance de red (`!isBranch`, TabPedidos.jsx) y el reenvío lo decide bodega
-- al resolver faltantes. Antes la base lo dejaba a cualquiera con la policy
-- `pss_update` de su sala.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.programar_entrega_sala(
  p_pedido_id   uuid,
  p_sucursal_id integer,
  p_cuando      timestamptz,
  p_motivo      text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid := auth_employee_id();
  v_hist  jsonb;
  v_entry jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: programar la entrega es de Bodega';
  END IF;
  IF p_cuando IS NULL THEN
    RAISE EXCEPTION 'INVALID: falta la fecha de entrega';
  END IF;

  SELECT entrega_programada_historial INTO v_hist
    FROM public.pedido_sucursal_status
   WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: esa sucursal no tiene ese pedido';
  END IF;
  v_hist := CASE WHEN jsonb_typeof(v_hist) = 'array' THEN v_hist ELSE '[]'::jsonb END;

  v_entry := jsonb_build_object(
               'programada_at', p_cuando,
               'registrado_at', now(),
               'por',           v_actor,
               'nombre',        (SELECT e.name FROM public.employees e WHERE e.id = v_actor))
          || CASE WHEN nullif(btrim(coalesce(p_motivo, '')), '') IS NOT NULL
                  THEN jsonb_build_object('motivo', btrim(p_motivo)) ELSE '{}'::jsonb END;
  v_hist := v_hist || jsonb_build_array(v_entry);

  UPDATE public.pedido_sucursal_status
     SET entrega_programada_at        = p_cuando,
         entrega_programada_historial = v_hist
   WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

  RETURN v_hist;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.programar_entrega_sala(uuid, integer, timestamptz, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.programar_entrega_sala(uuid, integer, timestamptz, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pedir_reenvio_sala(
  p_pedido_id   uuid,
  p_sucursal_id integer,
  p_cajas       integer[],
  p_especiales  jsonb,
  p_electrolits integer
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor  uuid := auth_employee_id();
  v_hist   jsonb;
  v_ciclo  integer;
  v_cajas  integer[] := coalesce(p_cajas, '{}');
  v_elec   integer   := greatest(coalesce(p_electrolits, 0), 0);
  v_esp    jsonb;
  v_nuevo  jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: el reenvío lo decide Bodega';
  END IF;

  -- Las especiales llegan como etiquetas o como `{ label, producto }`
  -- (`faltantesDeLaSala`); el ciclo guarda sólo la etiqueta, que es la clave.
  SELECT coalesce(jsonb_agg(to_jsonb(lbl) ORDER BY o), '[]'::jsonb) INTO v_esp
    FROM (SELECT CASE WHEN jsonb_typeof(e) = 'string' THEN e #>> '{}' ELSE e ->> 'label' END AS lbl, o
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_especiales) = 'array' THEN p_especiales ELSE '[]'::jsonb END)
                 WITH ORDINALITY AS t(e, o)) x
   WHERE lbl IS NOT NULL;

  IF cardinality(v_cajas) = 0 AND v_elec = 0 AND jsonb_array_length(v_esp) = 0 THEN
    RAISE EXCEPTION 'INVALID: el reenvío no lleva nada';
  END IF;

  SELECT reenvios_historial INTO v_hist
    FROM public.pedido_sucursal_status
   WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: esa sucursal no tiene ese pedido';
  END IF;
  v_hist  := CASE WHEN jsonb_typeof(v_hist) = 'array' THEN v_hist ELSE '[]'::jsonb END;
  v_ciclo := jsonb_array_length(v_hist) + 1;

  v_nuevo := jsonb_build_object(
    'ciclo', v_ciclo, 'cajas', to_jsonb(v_cajas), 'electrolits', v_elec, 'especiales', v_esp,
    'sent_at', NULL, 'sent_by', NULL,
    'solicitado_at', now(), 'solicitado_por', v_actor,
    'arrived_at', NULL, 'arrived_tipo', NULL,
    'cajas_ok', '[]'::jsonb, 'cajas_danadas', '[]'::jsonb, 'cajas_aun_faltantes', '[]'::jsonb);

  UPDATE public.pedido_sucursal_status
     SET reenvio_por        = v_actor,
         reenvios_historial = v_hist || jsonb_build_array(v_nuevo)
   WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

  RETURN jsonb_build_object('ciclo', v_ciclo,
                            'clave', p_pedido_id::text || '__' || p_sucursal_id || '__r' || v_ciclo);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.pedir_reenvio_sala(uuid, integer, integer[], jsonb, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pedir_reenvio_sala(uuid, integer, integer[], jsonb, integer) TO authenticated, service_role;
