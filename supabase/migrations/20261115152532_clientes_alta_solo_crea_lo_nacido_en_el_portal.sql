-- Alta de clientes en la caja: sólo se CREA lo que nació en el portal.
--
-- Medido el 2026-11-15 sobre las 34 fichas sin número: 25 nacieron de facturas
-- viejas (abril–septiembre) y NO están en la caja con ese nombre — alguien las
-- borró o les cambió el nombre allá. Crearlas resucitaría clientes borrados o
-- fabricaría duplicados («SIN NOMBRE», «ANA CALDERON (NO USAR)», «VICENTA PEÃ±A»
-- con las tildes dañadas, las dos cuentas de prueba de la app).
--
-- Regla: se crea sólo si la ficha nació en el portal —con `cliente_crear`
-- (`creado_por`) o en la caja del portal para una inyección (la nota que deja
-- `cliente_crear_de_mostrador`)— o si una persona lo pidió con «Crear de todas
-- formas» (`permitir_crear`). Todas se pueden VINCULAR si se encuentran.

SET lock_timeout = '5s';

ALTER TABLE public.clientes_alta_erp
  ADD COLUMN IF NOT EXISTS permitir_crear boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.clientes_alta_erp_tomar(
  p_customer_id bigint DEFAULT NULL, p_limite integer DEFAULT 5)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rol text := coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '');
  v_ids bigint[];
  v_out json;
BEGIN
  IF v_rol <> 'service_role' THEN
    IF p_customer_id IS NULL
       OR NOT ((SELECT public.auth_has_module_permission('clientes_crear', 'can_view'))
               OR (SELECT public.auth_can_edit_any(ARRAY['clientes']))) THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Las candidatas, bloqueadas para que dos llamadas no tomen la misma.
  SELECT array_agg(c.id) INTO v_ids
  FROM (
    SELECT c.id
      FROM public.customers c
      LEFT JOIN public.clientes_alta_erp a ON a.customer_id = c.id
     WHERE c.erp_id IS NULL                       -- barato primero: ~100 de 29 mil
       AND public.cliente_necesita_alta_erp(c)
       AND (p_customer_id IS NULL OR c.id = p_customer_id)
       AND coalesce(a.estado, 'pendiente') <> 'hecha'
       AND (a.tomado_hasta IS NULL OR a.tomado_hasta < now())
       -- El cron no reintenta lo que necesita una persona, y espera entre
       -- intentos: 10 min, 20, 40… hasta 6 h.
       AND (p_customer_id IS NOT NULL OR (
             coalesce(a.estado, 'pendiente') = 'pendiente'
             AND (a.ultimo_intento_at IS NULL
                  OR a.ultimo_intento_at < now() - least(interval '6 hours',
                       interval '10 minutes' * power(2, greatest(a.intentos - 1, 0))))))
     ORDER BY c.id
     LIMIT CASE WHEN p_customer_id IS NULL THEN greatest(1, least(p_limite, 20)) ELSE 1 END
     FOR UPDATE OF c SKIP LOCKED
  ) c;

  IF v_ids IS NULL THEN RETURN '[]'::json; END IF;

  INSERT INTO public.clientes_alta_erp AS a (customer_id, intentos, ultimo_intento_at, tomado_hasta, estado)
  SELECT unnest(v_ids), 1, now(), now() + interval '3 minutes', 'pendiente'
  ON CONFLICT (customer_id) DO UPDATE
     SET intentos = a.intentos + 1, ultimo_intento_at = now(),
         tomado_hasta = now() + interval '3 minutes',
         estado = 'pendiente';

  SELECT coalesce(json_agg(json_build_object(
           'customer_id', c.id, 'name', c.name, 'nit', c.nit, 'dui', c.dui, 'nrc', c.nrc,
           'pasaporte', c.pasaporte, 'phone', c.phone, 'telefono2', c.telefono2,
           'email', c.email, 'direccion', c.direccion, 'departamento', c.departamento,
           'municipio', c.municipio, 'distrito', c.distrito, 'categoria', c.categoria,
           'giro', c.giro, 'retencion_pct', c.retencion_pct,
           'fecha_nacimiento', c.fecha_nacimiento,
           -- ¿Se puede CREAR en la caja si no se encuentra? Ver el encabezado.
           'puede_crear', (a.creado_por IS NOT NULL OR a.permitir_crear
                           OR c.notes = 'Creada en la caja para una inyección')) ORDER BY c.id), '[]'::json)
    INTO v_out
    FROM public.customers c
    JOIN public.clientes_alta_erp a ON a.customer_id = c.id
   WHERE c.id = ANY (v_ids);
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clientes_alta_erp_tomar(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clientes_alta_erp_tomar(bigint, integer) TO authenticated, service_role;

-- «Reintentar» y «Crear de todas formas»: la ficha vuelve a la cola.
DROP FUNCTION IF EXISTS public.clientes_alta_erp_reintentar(bigint);
CREATE OR REPLACE FUNCTION public.clientes_alta_erp_reintentar(p_customer_id bigint, p_crear boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('clientes_crear', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.clientes_alta_erp
     SET estado = 'pendiente', ultimo_intento_at = NULL, tomado_hasta = NULL,
         permitir_crear = permitir_crear OR coalesce(p_crear, false)
   WHERE customer_id = p_customer_id AND estado <> 'hecha';
  RETURN json_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clientes_alta_erp_reintentar(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clientes_alta_erp_reintentar(bigint, boolean) TO authenticated, service_role;

-- El resumen dice también si la ficha se puede crear, para el botón.
CREATE OR REPLACE FUNCTION public.clientes_alta_erp_resumen()
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('clientes', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT json_build_object(
      'sin_numero', count(*),
      'revisar', count(*) FILTER (WHERE a.estado = 'revisar'),
      'por_revisar', coalesce(json_agg(json_build_object(
          'customer_id', c.id, 'name', c.name, 'dui', c.dui, 'phone', c.phone,
          'error', a.ultimo_error, 'intentos', a.intentos,
          'ultimo_intento_at', a.ultimo_intento_at, 'permitir_crear', a.permitir_crear)
          ORDER BY c.id) FILTER (WHERE a.estado = 'revisar'), '[]'::json))
      FROM public.customers c
      LEFT JOIN public.clientes_alta_erp a ON a.customer_id = c.id
     WHERE c.erp_id IS NULL AND public.cliente_necesita_alta_erp(c));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clientes_alta_erp_resumen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clientes_alta_erp_resumen() TO authenticated, service_role;
