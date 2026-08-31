SET lock_timeout = '5s';

-- ── El kiosco no deja marcar un día suspendido ──────────────────────────────
--
-- `kiosco_marcar` YA frena por evento vigente —vacación, incapacidad, permiso—
-- leyendo `employee_events` con la misma forma de `endDate`. Una suspensión es
-- exactamente eso, así que entra en esa lista y no por un camino nuevo: dos
-- caminos para «hoy esta persona no marca» son dos respuestas que un día se
-- contradicen.
--
-- Se reescribe con `replace()` sobre la definición viva y NO pegando el cuerpo
-- entero a mano: son 5.4 kB de los que este cambio toca ocho caracteres, y
-- transcribirlos es la forma más probable de romper algo que hoy anda. El
-- `RAISE` de abajo es la mitad que importa — si la lista cambió de forma, la
-- migración FALLA en vez de aplicar un reemplazo que no reemplaza nada.
--
-- ⚠️ Lo que esto no puede defender: si mañana alguien reescribe `kiosco_marcar`
-- desde cero sin `'SUSPENSION'` en esa lista, el freno se pierde en silencio.
-- Por eso el freno REAL no está solo acá — `esta_suspendido()` es la respuesta
-- canónica y la planilla la consulta por su cuenta.
DO $$
DECLARE d text; viejo text; nuevo text;
BEGIN
    SELECT pg_get_functiondef(oid) INTO d
      FROM pg_proc WHERE proname = 'kiosco_marcar' AND pronamespace = 'public'::regnamespace;

    viejo := 'ev.type IN (''VACATION'',''DISABILITY'',''PERMIT'')';
    nuevo := 'ev.type IN (''VACATION'',''DISABILITY'',''PERMIT'',''SUSPENSION'')';

    IF position(nuevo in d) > 0 THEN
        RAISE NOTICE 'kiosco_marcar ya conocía SUSPENSION';
        RETURN;
    END IF;
    IF position(viejo in d) = 0 THEN
        RAISE EXCEPTION 'kiosco_marcar cambió de forma: no encontré la lista de eventos vigentes';
    END IF;

    EXECUTE replace(d, viejo, nuevo);
END $$;

-- ── Y al identificarse se le dice por qué, con la fecha de vuelta ───────────
-- Sin esto el carné simplemente no abriría nada y la pantalla diría «no
-- encontrado», que manda a buscar un lector roto o un carné desmagnetizado. Es
-- la misma decisión que ya tomó el bloqueo: se lo reconoce, y lo que se niega
-- es el acceso, dicho con su nombre.
CREATE OR REPLACE FUNCTION public.kiosco_identificar(p_device_id uuid, p_device_token uuid, p_carne text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch  bigint;
    v_limpio  text := upper(regexp_replace(coalesce(p_carne, ''), '\s', '', 'g'));
    v_fallos  integer;
    v_id      uuid;
    v_metodo  text := NULL;
    v_hoy     date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_hasta   text;
BEGIN
    v_branch := public.kiosco_sucursal(p_device_id, p_device_token);
    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    IF v_limpio = '' THEN
        RETURN json_build_object('ok', false, 'motivo', 'VACIO');
    END IF;

    SELECT count(*) INTO v_fallos
      FROM public.intentos_identidad i
     WHERE i.branch_id = v_branch
       AND i.proposito = 'KIOSCO_CARNE'
       AND NOT i.exito
       AND i.created_at > now() - interval '15 minutes';

    IF v_fallos >= 20 THEN
        RAISE EXCEPTION 'KIOSK_PIN_RATE_LIMITED';
    END IF;

    -- Primero el PIN del carné (8 alfanuméricos: espacio grande, es el que se
    -- escanea). Después el código, que es corto y por eso va segundo.
    SELECT e.id, 'CARNE' INTO v_id, v_metodo
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND btrim(coalesce(e.kiosk_pin, '')) <> ''
       AND upper(btrim(e.kiosk_pin)) = v_limpio
       AND public.kiosco_cubre_empleado(e.id, v_branch)
     LIMIT 1;

    IF v_id IS NULL THEN
        SELECT e.id, 'CODIGO' INTO v_id, v_metodo
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND btrim(coalesce(e.code, '')) <> ''
           AND upper(btrim(e.code)) = v_limpio
           AND public.kiosco_cubre_empleado(e.id, v_branch)
         LIMIT 1;
    END IF;

    -- El carné de papel del día. Va al final y con la MISMA exigencia de
    -- cobertura que los otros dos: un papel no habilita a marcar en una sala
    -- que no es la suya.
    IF v_id IS NULL THEN
        v_id := public.resolver_carne_temporal(v_limpio);
        IF v_id IS NOT NULL THEN
            IF public.kiosco_cubre_empleado(v_id, v_branch) THEN
                v_metodo := 'CARNE_TEMPORAL';
            ELSE
                v_id := NULL;
            END IF;
        END IF;
    END IF;

    INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
    VALUES (NULL, 'KIOSCO_CARNE', v_id, coalesce(v_metodo, 'DESCONOCIDO'), v_id IS NOT NULL, v_branch);

    IF v_id IS NULL THEN
        RETURN json_build_object('ok', false, 'motivo', 'NO_ENCONTRADO');
    END IF;

    -- Bloqueada: se la reconoció, y por eso el intento de arriba quedó como
    -- exitoso. Lo que se niega es el acceso, y se dice con su nombre para que
    -- la pantalla no invente que el carné está roto.
    IF public.employee_esta_bloqueado(v_id) THEN
        RETURN json_build_object(
            'ok',          false,
            'motivo',      'SIN_ACCESO',
            'employee_id', v_id,
            'nombre',      (SELECT e.name FROM public.employees e WHERE e.id = v_id)
        );
    END IF;

    -- Suspendida por el RIT Art. 83. Mismo criterio que el bloqueo, y ADEMÁS la
    -- fecha de vuelta: quien está parado frente al kiosco necesita saber si
    -- vuelve mañana o en tres semanas, y preguntárselo a su jefe es justo lo
    -- que una pantalla puede ahorrarle.
    IF public.esta_suspendido(v_id, v_hoy) THEN
        SELECT coalesce(nullif(x.metadata->>'endDate', ''), x.date::text) INTO v_hasta
          FROM public.employee_events x
         WHERE x.employee_id = v_id
           AND x.type = 'SUSPENSION'
           AND x.date <= v_hoy
           AND coalesce(nullif(x.metadata->>'endDate','')::date, x.date) >= v_hoy
         ORDER BY x.date DESC
         LIMIT 1;

        RETURN json_build_object(
            'ok',          false,
            'motivo',      'SUSPENDIDO',
            'employee_id', v_id,
            'nombre',      (SELECT e.name FROM public.employees e WHERE e.id = v_id),
            'hasta',       v_hasta
        );
    END IF;

    RETURN json_build_object(
        'ok',          true,
        'employee_id', v_id,
        'metodo',      v_metodo
    );
END;
$function$;

-- ── Y se ve en la foto ──────────────────────────────────────────────────────
-- `SUSPENSION` pasa a ser el SEXTO evento temporal, junto a vacación,
-- incapacidad, apoyo, permiso e inducción. Su gemelo en el navegador
-- (`src/utils/estadoDePersona.js`) lleva la misma lista, y las dos tienen que
-- moverse juntas: si divergieran habría una foto con aro de un color al lado de
-- un texto que dice otra cosa, y nadie podría decir cuál de las dos miente.
CREATE OR REPLACE FUNCTION public.get_estados_de_personas(p_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_yo    uuid := auth_employee_id();
  v_ve    boolean := auth_has_module_permission('staff_detail', 'can_view')
                  OR auth_has_module_permission('schedules', 'can_view');
  v_out   json;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v_out
  FROM (
    SELECT e.id,
           CASE
             WHEN upper(coalesce(e.status, '')) IN ('INACTIVO', 'BAJA') THEN 'INACTIVO'
             WHEN upper(coalesce(e.status, '')) = 'LIQUIDADO'  THEN 'LIQUIDADO'
             WHEN upper(coalesce(e.status, '')) = 'SUSPENDIDO' THEN 'SUSPENDIDO'
             WHEN ev.type IS NULL THEN NULL
             WHEN v_ve OR e.id = v_yo THEN ev.type
             ELSE 'AUSENTE'
           END AS clave,
           CASE WHEN v_ve OR e.id = v_yo
                THEN nullif(ev.metadata->>'endDate', '')
                ELSE NULL
           END AS hasta
    FROM public.employees e
    LEFT JOIN LATERAL (
      SELECT x.type, x.metadata
      FROM public.employee_events x
      WHERE x.employee_id = e.id
        AND x.type IN ('VACATION', 'DISABILITY', 'SUPPORT', 'PERMIT', 'INDUCTION', 'SUSPENSION')
        AND x.date <= v_hoy
        AND (nullif(x.metadata->>'endDate', '') IS NULL
             OR (x.metadata->>'endDate')::date >= v_hoy)
        -- Una sanción revocada por el reclamo del Art. 77 dejó de existir: no
        -- puede seguir pintando un aro en la foto de nadie.
        AND coalesce(x.metadata->'reclamo'->>'estado', '') <> 'REVOCADA'
      ORDER BY x.date DESC
      LIMIT 1
    ) ev ON true
    WHERE e.id = ANY(p_ids)
  ) t
  WHERE t.clave IS NOT NULL;

  RETURN v_out;
END;
$function$;
