-- Lenguaje: avisos de Clientes por revisar sin «ficha» ni «sistema de origen»; la encuesta de clientes dice «farmacia».
-- Funciones desde su definición viva (2026-11-16); los UPDATE sólo tocan filas con el texto viejo.
-- Lenguaje de «Por revisar» de Clientes (2026-11-16): «ficha» → cliente/datos,
-- «sistema de origen» → la caja, sin rayas, tú y frases cortas.
-- Las dos funciones parten de su definición VIVA (pg_get_functiondef); sólo
-- cambian los literales que ve una persona. Al final se reescriben las filas
-- guardadas con el texto viejo.
SET lock_timeout = '5s';

-- 1) El vigilante de clientes sin reconocer (avisos y resumen de la mañana).
CREATE OR REPLACE FUNCTION public.avisar_clientes_sin_reconocer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_dest   uuid[];
  v_n      integer := 0;
  v_total  integer; v_sin integer;
  v_cuerpo text;
  r        record;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE erp_id IS NULL)
    INTO v_total, v_sin
    FROM public.customers
   WHERE created_at >= (v_hoy::timestamp AT TIME ZONE 'America/El_Salvador');

  FOR r IN
    SELECT * FROM (VALUES
      ('reconocimiento_caido',
       CASE WHEN v_total >= 4 AND v_sin * 4 >= v_total * 3 THEN v_sin ELSE 0 END,
       'Las ventas no están reconociendo a los clientes',
       v_sin || ' de ' || v_total || ' clientes nuevos de hoy quedaron sin número interno. '
         || 'Cada uno queda como un cliente aparte y sus puntos no llegan a su cliente real. '
         || 'Revisa la conexión de las ventas con la caja.', 0),
      ('fusion_con_puntos',
       (SELECT count(*)::int FROM public.clientes_por_revisar
         WHERE motivo = 'fusion_con_puntos' AND descartado_at IS NULL
           AND created_at < now() - interval '2 days'),
       'Clientes repetidos con los puntos partidos',
       NULL, 40),
      ('puntos_en_otra_ficha',
       (SELECT count(*)::int FROM public.puntos_lote l
          JOIN public.sales_invoices s ON s.id = l.invoice_id
         WHERE l.origen = 'venta' AND l.ganado_el >= v_hoy - 7
           AND l.customer_id <> s.customer_id
           AND public.cliente_vigente(l.customer_id) IS DISTINCT FROM public.cliente_vigente(s.customer_id)),
       'Puntos en un cliente distinto al de su factura',
       NULL, 60),
      ('sin_numero_viejas',
       (SELECT count(*)::int FROM public.customers c
         WHERE c.erp_id IS NULL AND c.deshabilitada_at IS NULL
           AND c.created_at < now() - interval '3 days'
           AND c.created_at > now() - interval '60 days'
           AND NOT public.es_cliente_mostrador(c.name, c.erp_id)
           AND EXISTS (SELECT 1 FROM public.sales_invoices s WHERE s.customer_id = c.id)),
       'Clientes sin número interno',
       NULL, 50)
    ) t(tipo, n, titulo, cuerpo, orden)
  LOOP
    -- Sin casos: si vuelve a haber, avisa aunque sea el mismo número.
    IF coalesce(r.n, 0) = 0 THEN
      IF r.tipo <> 'reconocimiento_caido' THEN
        PERFORM public.aviso_valor_olvidar('CLIENTES_SIN_RECONOCER:' || r.tipo);
      END IF;
      CONTINUE;
    END IF;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.audit_logs
       WHERE action = 'CLIENTES_SIN_RECONOCER'
         AND details->>'tipo' = r.tipo AND details->>'dia' = v_hoy::text);
    -- Lo que no cambió no se repite: sólo con otro número, o una vez por semana
    -- (2026-11-14). «Reconocimiento caído» es crítico y sigue igual.
    CONTINUE WHEN r.tipo <> 'reconocimiento_caido'
              AND NOT public.aviso_cambio_o_semanal('CLIENTES_SIN_RECONOCER:' || r.tipo, r.n::text);

    IF v_dest IS NULL THEN
      SELECT array_agg(e.id) INTO v_dest
        FROM public.employees e
        JOIN public.roles ro ON ro.name = 'Sistema — Alertas Técnicas'
       WHERE e.status = 'ACTIVO'
         AND (e.role_id = ro.id OR e.secondary_role_id = ro.id);
    END IF;

    INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
    VALUES ('CLIENTES_SIN_RECONOCER', r.tipo, 'Vigilante', 'SYSTEM',
            CASE WHEN r.tipo = 'reconocimiento_caido' THEN 'CRITICAL' ELSE 'WARNING' END,
            jsonb_build_object('tipo', r.tipo, 'dia', v_hoy, 'casos', r.n,
                               'nuevas_hoy', v_total, 'sin_numero_hoy', v_sin,
                               'avisados', coalesce(array_length(v_dest, 1), 0)));

    IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
      v_cuerpo := coalesce(r.cuerpo,
          CASE r.tipo
            WHEN 'fusion_con_puntos' THEN
              r.n || ' caso' || CASE WHEN r.n = 1 THEN '' ELSE 's' END
              || ' en «Por revisar» con más de 2 días. No se pudieron unir solos. El cliente ve sólo parte de su saldo.'
            WHEN 'puntos_en_otra_ficha' THEN
              r.n || ' venta' || CASE WHEN r.n = 1 THEN '' ELSE 's' END
              || ' de la última semana tiene' || CASE WHEN r.n = 1 THEN '' ELSE 'n' END
              || ' los puntos en un cliente y la factura en otro.'
            ELSE
              r.n || ' cliente' || CASE WHEN r.n = 1 THEN '' ELSE 's' END
              || ' con compras sigue' || CASE WHEN r.n = 1 THEN '' ELSE 'n' END
              || ' sin número interno después de 3 días.'
          END);
      IF r.tipo = 'reconocimiento_caido' THEN
        PERFORM public.notify_employees(
          v_dest, 'SYSTEM', r.titulo, v_cuerpo, '/clientes?tab=revisar',
          jsonb_build_object('origen', 'clientes-sin-reconocer', 'tipo', r.tipo, 'casos', r.n),
          true, NULL);
      ELSE
        -- En el resumen el título lleva la cifra: el renglón se lee solo.
        PERFORM public.resumen_manana_agregar(
          v_dest, 'clientes_' || r.tipo, r.orden, 'SYSTEM',
          CASE r.tipo
            WHEN 'fusion_con_puntos' THEN
              r.n || CASE WHEN r.n = 1 THEN ' cliente repetido con los puntos partidos'
                                       ELSE ' clientes repetidos con los puntos partidos' END
            WHEN 'puntos_en_otra_ficha' THEN
              r.n || CASE WHEN r.n = 1 THEN ' venta con los puntos en otro cliente'
                                       ELSE ' ventas con los puntos en otro cliente' END
            ELSE
              r.n || CASE WHEN r.n = 1 THEN ' cliente sin número interno'
                                       ELSE ' clientes sin número interno' END
          END,
          v_cuerpo, '/clientes?tab=revisar',
          jsonb_build_object('origen', 'clientes-sin-reconocer', 'tipo', r.tipo, 'casos', r.n),
          true);
      END IF;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- 2) El resultado del alta en la caja: el aviso cuando el número ya es de otro cliente.
CREATE OR REPLACE FUNCTION public.clientes_alta_erp_resultado(p_customer_id bigint, p_resultado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_rol  text := coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '');
  v_erp  text := nullif(btrim(coalesce(p_resultado ->> 'erp_id', '')), '');
  v_como text := p_resultado ->> 'como';
  v_otra bigint;
  v_n    integer := 0;
  v_toma timestamptz;
BEGIN
  IF v_rol <> 'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;

  IF coalesce((p_resultado ->> 'ok')::boolean, false) AND v_erp IS NOT NULL THEN
    -- Ese número ya es de otra ficha del portal: no se pisa, lo decide una persona.
    SELECT id INTO v_otra FROM public.customers WHERE erp_id = v_erp AND id <> p_customer_id LIMIT 1;
    IF v_otra IS NOT NULL THEN
      UPDATE public.clientes_alta_erp
         SET estado = 'revisar', tomado_hasta = NULL,
             ultimo_error = format('El número interno %s ya es del cliente %s.', v_erp, v_otra)
       WHERE customer_id = p_customer_id;
      RETURN json_build_object('ok', false, 'motivo', 'numero_de_otra_ficha', 'otra', v_otra);
    END IF;

    SELECT ultimo_intento_at INTO v_toma FROM public.clientes_alta_erp WHERE customer_id = p_customer_id;

    UPDATE public.customers SET erp_id = v_erp, updated_at = now()
     WHERE id = p_customer_id AND erp_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    -- Creada con los datos del momento de la toma: lo que estaba en la cola
    -- HASTA ESE MOMENTO ya viajó en el alta. Lo posterior, y todo lo de una
    -- ficha vinculada, lo sube el empuje de siempre.
    IF v_como = 'creada' AND v_n = 1 AND v_toma IS NOT NULL THEN
      UPDATE public.customers_changelog SET erp_synced_at = now()
       WHERE customer_id = p_customer_id AND erp_synced_at IS NULL AND descartado_at IS NULL
         AND campo <> 'notes' AND changed_at <= v_toma;
    END IF;

    UPDATE public.clientes_alta_erp
       SET estado = 'hecha', erp_id = v_erp, como = v_como, ultimo_error = NULL,
           tomado_hasta = NULL, resuelto_at = now()
     WHERE customer_id = p_customer_id;
    RETURN json_build_object('ok', true, 'erp_id', v_erp, 'actualizada', v_n);
  END IF;

  UPDATE public.clientes_alta_erp
     SET estado = CASE WHEN coalesce((p_resultado ->> 'revisar')::boolean, false)
                       THEN 'revisar' ELSE 'pendiente' END,
         ultimo_error = left(coalesce(p_resultado ->> 'error', 'sin detalle'), 500),
         tomado_hasta = NULL
   WHERE customer_id = p_customer_id;
  RETURN json_build_object('ok', false);
END;
$function$;

-- 3) Las filas ya guardadas, a las mismas frases nuevas. Un UPDATE por patrón.
UPDATE public.clientes_por_revisar
   SET detalle = regexp_replace(detalle, '^Su (DUI|NIT) (.+) ya es de otra ficha\.$',
                                'Su \1 \2 ya es de otro cliente.')
 WHERE detalle ~ '^Su (DUI|NIT) (.+) ya es de otra ficha\.$';

UPDATE public.clientes_por_revisar
   SET detalle = regexp_replace(detalle,
         '^(«.*») no tiene número interno ni ninguna factura de la cual deducirlo\. Es una ficha suelta del portal: hay que ligarla a mano o darla de baja\.$',
         '\1 no tiene número interno ni ninguna factura de la cual deducirlo. Sólo existe en el portal. Lígalo a mano o dalo de baja.')
 WHERE detalle ~ '^(«.*») no tiene número interno ni ninguna factura de la cual deducirlo\. Es una ficha suelta del portal: hay que ligarla a mano o darla de baja\.$';

UPDATE public.clientes_por_revisar
   SET detalle = regexp_replace(detalle, '^Ya existe (.*) \(ficha #([0-9]+)\) con este mismo nombre\.$',
                                'Ya existe \1 (cliente #\2) con este mismo nombre.')
 WHERE detalle ~ '^Ya existe (.*) \(ficha #([0-9]+)\) con este mismo nombre\.$';

UPDATE public.clientes_por_revisar
   SET detalle = regexp_replace(detalle, '^Categoría (.*)\. La ficha está completa; se congela por ser fiscal\.$',
                                'Categoría \1. Sus datos están completos. Está congelado por ser fiscal.')
 WHERE detalle ~ '^Categoría (.*)\. La ficha está completa; se congela por ser fiscal\.$';

UPDATE public.clientes_por_revisar
   SET detalle = regexp_replace(detalle,
         '^El número interno ([0-9]+) no existe en el sistema de origen: su ficha vuelve vacía\. Hay que averiguar cuál es el número correcto de («.*») o dar de baja la ficha\.$',
         'El número interno \1 no existe en la caja. Averigua cuál es el número correcto de \2 o dalo de baja.')
 WHERE detalle ~ '^El número interno ([0-9]+) no existe en el sistema de origen: su ficha vuelve vacía\. Hay que averiguar cuál es el número correcto de («.*») o dar de baja la ficha\.$';

UPDATE public.clientes_por_revisar
   SET detalle = regexp_replace(detalle,
         '^El número interno ([0-9]+) corresponde a («.*»), pero esta ficha se llama («.*»)\. Podrían ser dos personas distintas: no se unieron\.$',
         'El número interno \1 corresponde a \2, pero este cliente se llama \3. Podrían ser dos personas distintas. No se unieron.')
 WHERE detalle ~ '^El número interno ([0-9]+) corresponde a («.*»), pero esta ficha se llama («.*»)\. Podrían ser dos personas distintas: no se unieron\.$';

UPDATE public.clientes_por_revisar
   SET detalle = regexp_replace(detalle,
         '^El sistema de origen no deja guardar la ficha de («.*»): («.*»)\. Ya existe otra ficha que considera la misma persona — hay que unirlas o distinguirlas a mano\.$',
         'La caja no deja guardar los datos de \1: \2. Ya hay otro cliente que cuenta como la misma persona. Únelos o distínguelos a mano.')
 WHERE detalle ~ '^El sistema de origen no deja guardar la ficha de («.*»): («.*»)\. Ya existe otra ficha que considera la misma persona — hay que unirlas o distinguirlas a mano\.$';

UPDATE public.clientes_por_revisar
   SET detalle = 'Hay dos clientes con este mismo nombre. No se sabe cuál corresponde. Únelos.'
 WHERE detalle = 'Hay dos fichas con este mismo nombre y no se puede saber cuál corresponde: hay que unificarlas.';

UPDATE public.clientes_por_revisar
   SET detalle = regexp_replace(detalle,
         '^(«.*») es la misma persona que («.*») \(número interno ([0-9]+)\), pero la ficha suelta tiene puntos acumulados: unirlas movería un saldo\. Hay que resolverlo a mano\.$',
         '\1 es la misma persona que \2 (número interno \3), pero tiene puntos acumulados. Unirlos movería un saldo. Resuélvelo a mano.')
 WHERE detalle ~ '^(«.*») es la misma persona que («.*») \(número interno ([0-9]+)\), pero la ficha suelta tiene puntos acumulados: unirlas movería un saldo\. Hay que resolverlo a mano\.$';

UPDATE public.clientes_alta_erp
   SET ultimo_error = regexp_replace(ultimo_error,
         '^En la caja ya es la ficha ([0-9]+) del portal \(cliente ([0-9]+)\)\.$',
         'El número interno \1 ya es del cliente \2.')
 WHERE ultimo_error ~ '^En la caja ya es la ficha ([0-9]+) del portal \(cliente ([0-9]+)\)\.$';

UPDATE public.encuestas_cliente SET objetivo = replace(objetivo, 'la visita a la sala', 'la visita a la farmacia') WHERE id = 'f30d4ede-eada-490d-9dea-4fae1cf4244e' AND objetivo LIKE '%la visita a la sala%';
