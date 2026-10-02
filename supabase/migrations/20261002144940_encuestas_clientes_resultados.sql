-- Encuestas a clientes — fase 4: los resultados.
-- Plan: docs/PLAN-ENCUESTAS-A-CLIENTES-2026-10-01.md
--
-- Todo se calcula ACÁ y sale como un solo json (patrón C de CLAUDE.md): las
-- respuestas crecen sin techo y PostgREST corta en 1000 sin avisar, así que
-- traerlas al navegador para contarlas daría números falsos con naturalidad.
--
-- La escala común es 0-100 para comparar dimensiones medidas con tipos
-- distintos: NPS 0-10 → ×10; caritas y acuerdo 1-5 → (v-1)/4×100; sí/no → %
-- de «sí». El NPS propiamente dicho (promotores − detractores) va aparte.
SET lock_timeout = '5s';

-- ── Puntaje 0-100 de una respuesta según su tipo ───────────────────────────
-- NULL cuando el tipo no es una escala (opciones, número, texto).
CREATE FUNCTION public.encuesta_cliente_puntaje(p_tipo text, p_valor jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
    SELECT CASE
        WHEN p_tipo = 'nps' AND jsonb_typeof(p_valor) = 'number' THEN (p_valor #>> '{}')::numeric * 10
        WHEN p_tipo IN ('csat','likert') AND jsonb_typeof(p_valor) = 'number' THEN ((p_valor #>> '{}')::numeric - 1) * 25
        WHEN p_tipo = 'si_no' AND jsonb_typeof(p_valor) = 'boolean' THEN CASE WHEN (p_valor #>> '{}')::boolean THEN 100 ELSE 0 END
        ELSE NULL END
$$;

-- ── Los resultados de una encuesta ─────────────────────────────────────────
-- `p_branch` NULL = todas las sucursales.
CREATE FUNCTION public.encuesta_cliente_resultados(p_id uuid, p_branch integer DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_enc public.encuestas_cliente;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'La encuesta no existe'; END IF;

    RETURN (
    WITH r AS (
        SELECT * FROM public.encuesta_cliente_respuestas
         WHERE encuesta_id = p_id AND (p_branch IS NULL OR branch_id = p_branch)
    ),
    preguntas AS (
        SELECT p ->> 'id' AS id, p ->> 'tipo' AS tipo, p ->> 'texto' AS texto, p ->> 'dimension' AS dimension,
               p -> 'opciones' AS opciones, sn * 1000 + n AS orden
          FROM jsonb_array_elements(coalesce(v_enc.cuestionario -> 'secciones', '[]')) WITH ORDINALITY AS sec(s, sn),
               jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) WITH ORDINALITY AS q(p, n)
    ),
    valores AS (
        SELECT r.id AS respuesta_id, r.branch_id, pr.id AS pregunta, pr.tipo, pr.dimension, kv.value AS valor
          FROM r CROSS JOIN LATERAL jsonb_each(r.respuestas) kv
          JOIN preguntas pr ON pr.id = kv.key
    ),
    nps AS (
        SELECT count(*) FILTER (WHERE nps >= 9) prom, count(*) FILTER (WHERE nps BETWEEN 7 AND 8) pas,
               count(*) FILTER (WHERE nps <= 6) det, count(nps) n
          FROM r
    )
    SELECT json_build_object(
        'total', (SELECT count(*) FROM r),
        'nps', (SELECT json_build_object('promotores', prom, 'pasivos', pas, 'detractores', det, 'respuestas', n,
                    'puntaje', CASE WHEN n > 0 THEN round((prom - det) * 100.0 / n) END) FROM nps),
        'por_sucursal', (
            SELECT coalesce(json_agg(json_build_object('branch_id', x.branch_id, 'nombre', b.name, 'respuestas', x.total,
                       'nps', x.nps, 'con_nps', x.con_nps) ORDER BY x.nps DESC NULLS LAST), '[]'::json)
              FROM (SELECT branch_id, count(*) total, count(nps) con_nps,
                           CASE WHEN count(nps) > 0 THEN round((count(*) FILTER (WHERE nps >= 9) - count(*) FILTER (WHERE nps <= 6)) * 100.0 / count(nps)) END nps
                      FROM public.encuesta_cliente_respuestas WHERE encuesta_id = p_id GROUP BY branch_id) x
              JOIN public.branches b ON b.id = x.branch_id),
        'por_dimension', (
            SELECT coalesce(json_agg(json_build_object('clave', d.clave, 'nombre', d.nombre, 'color', d.color,
                       'puntaje', x.puntaje, 'respuestas', x.n) ORDER BY d.orden), '[]'::json)
              FROM (SELECT dimension, round(avg(public.encuesta_cliente_puntaje(tipo, valor))) puntaje,
                           count(public.encuesta_cliente_puntaje(tipo, valor)) n
                      FROM valores WHERE dimension IS NOT NULL GROUP BY dimension) x
              JOIN public.encuesta_cliente_dimensiones d ON d.clave = x.dimension
             WHERE x.n > 0),
        'por_pregunta', (
            SELECT coalesce(json_agg(json_build_object(
                       'id', pr.id, 'tipo', pr.tipo, 'texto', pr.texto, 'dimension', pr.dimension, 'opciones', pr.opciones,
                       'respuestas', (SELECT count(*) FROM valores v WHERE v.pregunta = pr.id),
                       'promedio', (SELECT round(avg((v.valor #>> '{}')::numeric), 2) FROM valores v
                                     WHERE v.pregunta = pr.id AND jsonb_typeof(v.valor) = 'number'),
                       'puntaje', (SELECT round(avg(public.encuesta_cliente_puntaje(v.tipo, v.valor))) FROM valores v WHERE v.pregunta = pr.id),
                       -- Conteo por valor: número, sí/no u opción (en múltiple, cada opción marcada).
                       'conteo', (SELECT coalesce(json_object_agg(k, c), '{}'::json) FROM (
                                     SELECT CASE WHEN jsonb_typeof(v.valor) = 'array' THEN e #>> '{}' ELSE v.valor #>> '{}' END k, count(*) c
                                       FROM valores v
                                       LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.valor) = 'array' AND pr.tipo = 'multiple'
                                                                                   THEN v.valor ELSE '[]'::jsonb END) e ON true
                                      WHERE v.pregunta = pr.id AND pr.tipo NOT IN ('texto','ranking','numero')
                                        AND (pr.tipo <> 'multiple' OR e IS NOT NULL)
                                      GROUP BY 1) t),
                       -- Ordenar: posición promedio de cada opción (1 = la más importante).
                       'ranking', CASE WHEN pr.tipo = 'ranking' THEN (
                           SELECT coalesce(json_object_agg(k, pos), '{}'::json) FROM (
                               SELECT e.k, round(avg(e.pos), 2) pos
                                 FROM valores v CROSS JOIN LATERAL jsonb_array_elements_text(v.valor) WITH ORDINALITY AS e(k, pos)
                                WHERE v.pregunta = pr.id GROUP BY e.k) t) END
                   ) ORDER BY pr.orden), '[]'::json)
              FROM preguntas pr),
        'por_canal', (SELECT coalesce(json_object_agg(canal, n), '{}'::json)
                        FROM (SELECT canal, count(*) n FROM r GROUP BY canal) c)
    ));
END $$;

-- ── Los comentarios (respuestas abiertas) ──────────────────────────────────
-- Los 400 más recientes: es lo que se lee y lo que la IA resume.
CREATE FUNCTION public.encuesta_cliente_comentarios(p_id uuid, p_branch integer DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_enc public.encuestas_cliente;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id;
    RETURN (
        SELECT coalesce(json_agg(to_json(t) ORDER BY t.created_at DESC), '[]'::json) FROM (
            SELECT r.id, r.created_at, r.nps, r.canal, b.name AS sucursal, p ->> 'texto' AS pregunta,
                   r.respuestas ->> (p ->> 'id') AS texto,
                   r.contacto_nombre, r.telefono
              FROM public.encuesta_cliente_respuestas r
              JOIN public.branches b ON b.id = r.branch_id
             CROSS JOIN LATERAL jsonb_array_elements(coalesce(v_enc.cuestionario -> 'secciones', '[]')) s
             CROSS JOIN LATERAL jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) p
             WHERE r.encuesta_id = p_id AND (p_branch IS NULL OR r.branch_id = p_branch)
               AND p ->> 'tipo' = 'texto' AND nullif(btrim(r.respuestas ->> (p ->> 'id')), '') IS NOT NULL
             ORDER BY r.created_at DESC
             LIMIT 400) t
    );
END $$;

-- ── Las rondas: la misma encuesta repetida en el tiempo ────────────────────
-- La familia se arma por `origen_id` hasta la primera que no vino de otra
-- encuesta (una plantilla no es una ronda).
CREATE FUNCTION public.encuesta_cliente_rondas(p_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_raiz uuid;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    WITH RECURSIVE arriba AS (
        SELECT e.id, e.origen_id, 0 AS n FROM public.encuestas_cliente e WHERE e.id = p_id
        UNION ALL
        SELECT e.id, e.origen_id, a.n + 1 FROM public.encuestas_cliente e
          JOIN arriba a ON e.id = a.origen_id
         WHERE NOT e.es_plantilla AND a.n < 50
    )
    SELECT id INTO v_raiz FROM arriba ORDER BY n DESC LIMIT 1;

    RETURN (
        WITH RECURSIVE familia AS (
            SELECT e.id, 0 AS n FROM public.encuestas_cliente e WHERE e.id = v_raiz
            UNION ALL
            SELECT e.id, f.n + 1 FROM public.encuestas_cliente e JOIN familia f ON e.origen_id = f.id
             WHERE NOT e.es_plantilla AND f.n < 50
        )
        SELECT coalesce(json_agg(json_build_object(
                   'id', e.id, 'nombre', e.nombre, 'version', e.version, 'estado', e.estado,
                   'fecha_inicio', e.fecha_inicio, 'cerrada_at', e.cerrada_at,
                   'respuestas', x.total, 'nps', x.nps) ORDER BY e.version, e.created_at), '[]'::json)
          FROM familia f
          JOIN public.encuestas_cliente e ON e.id = f.id
          CROSS JOIN LATERAL (
              SELECT count(*) total,
                     CASE WHEN count(nps) > 0 THEN round((count(*) FILTER (WHERE nps >= 9) - count(*) FILTER (WHERE nps <= 6)) * 100.0 / count(nps)) END nps
                FROM public.encuesta_cliente_respuestas r WHERE r.encuesta_id = e.id) x
         WHERE e.estado IN ('publicada','cerrada','archivada') OR e.id = p_id
    );
END $$;

-- ── Las filas para el CSV ──────────────────────────────────────────────────
-- Una por respuesta, con todas sus respuestas en crudo: el navegador las
-- traduce con el cuestionario (rótulos de opciones) para escribir el archivo.
CREATE FUNCTION public.encuesta_cliente_respuestas_para_exportar(p_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN (
        SELECT coalesce(json_agg(json_build_object(
                   'fecha', r.created_at, 'sucursal', b.name, 'canal', r.canal, 'nps', r.nps,
                   'respuestas', r.respuestas, 'contacto_nombre', r.contacto_nombre, 'telefono', r.telefono,
                   'entrevistador', e.name, 'duracion_seg', r.duracion_seg) ORDER BY r.created_at), '[]'::json)
          FROM public.encuesta_cliente_respuestas r
          JOIN public.branches b ON b.id = r.branch_id
          LEFT JOIN public.employees e ON e.id = r.entrevistador_id
         WHERE r.encuesta_id = p_id
    );
END $$;

-- ── El aviso de detractor ──────────────────────────────────────────────────
-- Un cliente que pone 0-6 en recomendación es la señal que vale la pena
-- atender el mismo día. Avisa a la jefatura de ESA sala y a supervisión de
-- ventas, con lo que escribió y —si dejó su teléfono— para poder llamarlo.
CREATE FUNCTION public.encuesta_cliente_avisar_detractor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_enc  public.encuestas_cliente;
    v_dest uuid[];
    v_sala text;
    v_texto text;
BEGIN
    IF NEW.nps IS NULL OR NEW.nps > 6 THEN RETURN NULL; END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = NEW.encuesta_id;
    SELECT name INTO v_sala FROM public.branches WHERE id = NEW.branch_id;
    SELECT coalesce(array_agg(DISTINCT e.id), '{}') INTO v_dest
      FROM public.employees e
      JOIN public.roles r ON r.id IN (e.role_id, e.secondary_role_id)
     WHERE e.status = 'ACTIVO'
       AND ((r.name = 'Jefe/a de Sala' AND e.branch_id = NEW.branch_id) OR r.name = 'Supervisor/a de Ventas');
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NULL; END IF;
    -- La primera respuesta abierta, si hay: es lo que explica el puntaje.
    SELECT left(NEW.respuestas ->> (p ->> 'id'), 160) INTO v_texto
      FROM jsonb_array_elements(coalesce(v_enc.cuestionario -> 'secciones', '[]')) s,
           jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) p
     WHERE p ->> 'tipo' = 'texto' AND nullif(btrim(NEW.respuestas ->> (p ->> 'id')), '') IS NOT NULL
     LIMIT 1;
    PERFORM public.notify_employees(v_dest, 'ENCUESTAS',
        'Cliente insatisfecho en ' || coalesce(v_sala, 'sala') || ' (' || NEW.nps || '/10)',
        coalesce('«' || v_texto || '»', 'Sin comentario.')
          || CASE WHEN NEW.telefono IS NOT NULL THEN ' · Dejó su teléfono para seguimiento.' ELSE '' END,
        '/encuestas-clientes?encuesta=' || NEW.encuesta_id || '&vista=resultados',
        jsonb_build_object('encuesta_id', NEW.encuesta_id, 'respuesta_id', NEW.id), true, NEW.branch_id);
    RETURN NULL;
END $$;
CREATE TRIGGER encuesta_cliente_respuestas_detractor AFTER INSERT ON public.encuesta_cliente_respuestas
    FOR EACH ROW EXECUTE FUNCTION public.encuesta_cliente_avisar_detractor();

REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_puntaje(text, jsonb)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_resultados(uuid, integer)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_comentarios(uuid, integer)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_rondas(uuid)                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_respuestas_para_exportar(uuid)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_avisar_detractor()                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_puntaje(text, jsonb)              TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_resultados(uuid, integer)         TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_comentarios(uuid, integer)        TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_rondas(uuid)                      TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_respuestas_para_exportar(uuid)    TO authenticated, service_role;

-- ── El resumen de IA, guardado y compartido ────────────────────────────────
-- Pedido del usuario (2026-10-02): usar la IA lo menos posible para no llegar
-- a la cuota. Por eso el resumen se GUARDA (todos ven el mismo, sin volver a
-- llamar) y sólo se rehace cuando entraron suficientes comentarios nuevos.
-- `branch_key` 0 = todas las sucursales (una PK no admite NULL).
CREATE TABLE public.encuesta_cliente_resumenes (
    encuesta_id   uuid NOT NULL REFERENCES public.encuestas_cliente(id) ON DELETE CASCADE,
    branch_key    integer NOT NULL DEFAULT 0,
    texto         text NOT NULL,
    comentarios_n integer NOT NULL,
    hasta         timestamptz NOT NULL,
    generado_por  uuid REFERENCES public.employees(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (encuesta_id, branch_key)
);
ALTER TABLE public.encuesta_cliente_resumenes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.encuesta_cliente_resumenes FROM anon, authenticated;
GRANT SELECT ON public.encuesta_cliente_resumenes TO authenticated;
GRANT ALL ON public.encuesta_cliente_resumenes TO service_role;
CREATE POLICY encuesta_cliente_resumenes_select ON public.encuesta_cliente_resumenes FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuestas_clientes','can_view')));

-- Cuántas respuestas con texto hay después de un momento. Es la medida de
-- «comentarios nuevos» que decide si vale la pena volver a resumir.
CREATE FUNCTION public.encuesta_cliente_con_texto(p_id uuid, p_branch integer, p_desde timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
    SELECT count(*)::integer
      FROM public.encuesta_cliente_respuestas r, public.encuestas_cliente e
     WHERE e.id = p_id AND r.encuesta_id = p_id
       AND (p_branch IS NULL OR r.branch_id = p_branch)
       AND (p_desde IS NULL OR r.created_at > p_desde)
       AND EXISTS (SELECT 1
                     FROM jsonb_array_elements(coalesce(e.cuestionario -> 'secciones', '[]')) s,
                          jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) p
                    WHERE p ->> 'tipo' = 'texto' AND nullif(btrim(r.respuestas ->> (p ->> 'id')), '') IS NOT NULL);
$$;

-- El resumen guardado y si conviene rehacerlo. `minimo_nuevos` es el umbral
-- de la regla: menos de eso, el botón queda «al día».
CREATE FUNCTION public.encuesta_cliente_resumen(p_id uuid, p_branch integer DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_r public.encuesta_cliente_resumenes;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO v_r FROM public.encuesta_cliente_resumenes WHERE encuesta_id = p_id AND branch_key = coalesce(p_branch, 0);
    RETURN json_build_object(
        'texto', v_r.texto, 'comentarios_n', v_r.comentarios_n, 'generado_at', v_r.created_at,
        'generado_por', v_r.generado_por,
        'nuevos', public.encuesta_cliente_con_texto(p_id, p_branch, v_r.hasta),
        'minimo_nuevos', 5);
END $$;

-- Guardar lo que devolvió la IA. Si ya hay uno que cubre lo mismo o más
-- (dos personas apretaron a la vez), se queda el que estaba.
CREATE FUNCTION public.encuesta_cliente_guardar_resumen(p_id uuid, p_branch integer, p_texto text, p_hasta timestamptz)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_prev public.encuesta_cliente_resumenes;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF btrim(coalesce(p_texto, '')) = '' THEN RAISE EXCEPTION 'Resumen vacío'; END IF;
    SELECT * INTO v_prev FROM public.encuesta_cliente_resumenes
     WHERE encuesta_id = p_id AND branch_key = coalesce(p_branch, 0) FOR UPDATE;
    IF FOUND AND v_prev.hasta >= p_hasta THEN
        RETURN json_build_object('guardado', false, 'texto', v_prev.texto);
    END IF;
    INSERT INTO public.encuesta_cliente_resumenes (encuesta_id, branch_key, texto, comentarios_n, hasta, generado_por)
    VALUES (p_id, coalesce(p_branch, 0), left(p_texto, 6000),
            public.encuesta_cliente_con_texto(p_id, p_branch, NULL), p_hasta, public.auth_employee_id())
    ON CONFLICT (encuesta_id, branch_key) DO UPDATE
       SET texto = EXCLUDED.texto, comentarios_n = EXCLUDED.comentarios_n, hasta = EXCLUDED.hasta,
           generado_por = EXCLUDED.generado_por, created_at = now();
    RETURN json_build_object('guardado', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_con_texto(uuid, integer, timestamptz)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_resumen(uuid, integer)                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_guardar_resumen(uuid, integer, text, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_con_texto(uuid, integer, timestamptz)       TO service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_resumen(uuid, integer)                       TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_guardar_resumen(uuid, integer, text, timestamptz) TO authenticated, service_role;
