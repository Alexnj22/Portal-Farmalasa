SET lock_timeout = '5s';

-- El detalle del cliente en Puntos nombra la SALA de cada movimiento
-- (rediseño del 2026-09-25). El libro guarda el código del programa
-- (`FLS3`); el nombre sale de `branches.codigo_puntos`. Un código que no está
-- ahí (`FSE1`, `ADM1`, del sistema anterior) se muestra tal cual.
CREATE OR REPLACE FUNCTION public.puntos_panel_cliente(p_customer_id bigint)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para consultar puntos.' USING ERRCODE = '42501';
  END IF;
  SELECT json_build_object(
    'cliente', (SELECT json_build_object('id', c.id, 'nombre', c.name, 'dui', c.dui, 'telefono', c.phone,
                                         'correo', c.email, 'acumula', coalesce(c.acumula_puntos, true))
                  FROM public.customers c WHERE c.id = p_customer_id),
    'cuenta', public.puntos_estado_cuenta(p_customer_id),
    'salas', (SELECT coalesce(json_object_agg(b.codigo_puntos, b.name), '{}'::json)
                FROM public.branches b WHERE b.codigo_puntos IS NOT NULL),
    'cuentas_anteriores', (
      SELECT coalesce(json_agg(json_build_object('id', a.id_cliente, 'como', a.asignada_como,
                                                 'cuando', a.asignada_at, 'nota', a.asignada_nota,
                                                 'saldo_alla', a.puntos) ORDER BY a.id_cliente), '[]'::json)
        FROM public.puntos_archivo_cliente a
        JOIN public.puntos_archivo_carga k ON k.id = a.carga_id AND k.completa
       WHERE a.asignada_a = p_customer_id)
  ) INTO v;
  RETURN v;
END;
$$;
