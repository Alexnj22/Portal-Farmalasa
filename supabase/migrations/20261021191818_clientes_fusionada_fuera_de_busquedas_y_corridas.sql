-- La ficha fusionada (deshabilitada) deja de existir para quien busca o
-- resuelve clientes. Cada función parte de su definición VIVA del 2026-10-21.
--   upsert_customers_v2          una factura a su nombre se liga a la principal
--   puntos_cliente_por_documento el ingreso a la app entra a la principal
--   busqueda_clientes / buscar_personas_por_nombre / puntos_panel_candidatas
--                                no la ofrecen
--   fichas_para_corregir_dte / clientes_sin_distrito_corregibles
--                                la corrida nocturna no la toca
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.upsert_customers_v2(p_rows json)
 RETURNS TABLE(customer_name text, customer_id bigint)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- 1 · Crear solo lo que no existe ni por número ni por nombre.
  INSERT INTO public.customers (name, erp_id)
  SELECT e.nombre, e.erp_id
  FROM (
    SELECT DISTINCT upper(btrim(x.nombre)) AS nombre,
           nullif(btrim(coalesce(x.erp_id, '')), '') AS erp_id
    FROM json_to_recordset(p_rows) AS x(nombre text, erp_id text)
    WHERE upper(btrim(coalesce(x.nombre, ''))) <> ''
  ) e
  WHERE NOT EXISTS (SELECT 1 FROM public.customers c
                     WHERE e.erp_id IS NOT NULL AND c.erp_id = e.erp_id)
    AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.name = e.nombre)
  ON CONFLICT DO NOTHING;

  -- 2 · Devolver el mapa ya resuelto. Se relee `customers` en vez de usar el
  -- RETURNING del insert: así una fila que perdió una carrera con otra
  -- invocación igual sale con su id, en lugar de dejar la factura sin cliente.
  RETURN QUERY
  SELECT e.nombre,
         -- Una ficha fusionada (deshabilitada) conserva su nombre a propósito:
         -- así la próxima factura escrita igual NO abre otra ficha suelta y se
         -- liga directo a la principal.
         public.cliente_vigente(coalesce(por_erp.id, por_nombre.id)) AS id
  FROM (
    SELECT DISTINCT upper(btrim(x.nombre)) AS nombre,
           nullif(btrim(coalesce(x.erp_id, '')), '') AS erp_id
    FROM json_to_recordset(p_rows) AS x(nombre text, erp_id text)
    WHERE upper(btrim(coalesce(x.nombre, ''))) <> ''
  ) e
  -- El número manda; el nombre es el respaldo.
  LEFT JOIN public.customers por_erp    ON e.erp_id IS NOT NULL
                                       AND por_erp.erp_id = e.erp_id
  LEFT JOIN public.customers por_nombre ON por_nombre.name = e.nombre
  WHERE coalesce(por_erp.id, por_nombre.id) IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.puntos_cliente_por_documento(p_documento text, p_telefono text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, name text, dui text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_doc  text := upper(regexp_replace(coalesce(p_documento,''), '[^A-Za-z0-9]', '', 'g'));
  v_num  text := regexp_replace(coalesce(p_documento,''), '\D', '', 'g');
  v_tel  text := right(regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'), 8);
  v_hay_tel boolean := length(v_tel) = 8;
BEGIN
  IF length(v_doc) < 7 THEN RETURN; END IF;

  RETURN QUERY
  WITH cand AS (
    -- 1 · el código. Es nuestro y es único, así que no puede empatar consigo
    --     mismo; sí podría empatar con un pasaporte de 7 caracteres, y por eso
    --     el conteo final sigue exigiendo uno solo.
    SELECT c.id, c.name, c.dui, true AS por_codigo
      FROM public.puntos_codigo_acceso k
      JOIN public.customers c ON c.id = k.customer_id
     WHERE k.codigo = v_doc
    UNION ALL
    -- 2 · el DUI: nueve dígitos, mirando sólo los dígitos porque el portal lo
    --     guarda con guion y el otro sistema no
    SELECT c.id, c.name, c.dui, false
      FROM public.customers c
     WHERE length(v_num) = 9
       AND regexp_replace(coalesce(c.dui,''), '\D', '', 'g') = v_num
    UNION ALL
    -- 3 · el NIT
    SELECT c.id, c.name, c.dui, false
      FROM public.customers c
     WHERE length(v_num) >= 9
       AND regexp_replace(coalesce(c.nit,''), '\D', '', 'g') = v_num
    UNION ALL
    -- 4 · el pasaporte: alfanumérico, sin separadores y en mayúscula
    SELECT c.id, c.name, c.dui, false
      FROM public.customers c
     WHERE upper(regexp_replace(coalesce(c.pasaporte,''), '[^A-Za-z0-9]', '', 'g')) = v_doc
  ),
  ok AS (
    -- Una ficha fusionada entra como su principal: el DUI o el código que
    -- quedaron en la deshabilitada no abren sesión en ella, ni hacen que el
    -- mismo DUI en las dos cuente como «dos clientes» y no deje entrar.
    SELECT DISTINCT public.cliente_vigente(cand.id) AS id
      FROM cand
      JOIN public.customers c ON c.id = cand.id
     WHERE
       -- El código entra solo: se lo emite una persona en la caja, es nuestro,
       -- y su largo se eligió para aguantar esto. Si además vino un teléfono no
       -- se exige que coincida — el papel dice «escribí tu código» y quien de
       -- todos modos llenó el campo de arriba no puede quedar afuera por eso.
       cand.por_codigo
       -- Por documento sigue haciendo falta: el DUI de alguien no es un secreto
       -- ni lo emitimos nosotros, así que solo convertiría esto en un detector
       -- de «este DUI es cliente».
       OR (v_hay_tel AND (
             right(regexp_replace(coalesce(c.phone,''),     '\D', '', 'g'), 8) = v_tel
          OR right(regexp_replace(coalesce(c.telefono2,''), '\D', '', 'g'), 8) = v_tel))
  )
  SELECT v.id, v.name, v.dui FROM ok JOIN public.customers v ON v.id = ok.id
   WHERE (SELECT count(*) FROM ok) = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.busqueda_clientes(p_q text)
 RETURNS TABLE(id bigint, puntaje numeric, aproximado boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
DECLARE
  v_tok  jsonb := public.busqueda_palabras(p_q);
  v_pats text[];
  v_idx  text;
  v_n    int;
BEGIN
  IF jsonb_array_length(v_tok) = 0 THEN RETURN; END IF;
  v_pats := public.busqueda_prefiltro(v_tok);
  v_idx  := public.busqueda_la_mas_larga(v_pats);

  RETURN QUERY
  SELECT x.id, x.s, false
  FROM (
    SELECT c.id,
           public.busqueda_puntaje(v_tok, ARRAY[c.nombre_busq, c.ids_busq],
                                          ARRAY[c.nombre_comp, c.ids_comp])::numeric AS s
    FROM public.customers c
    -- Un patrón solo, sobre la MISMA expresión del índice de trigramas, es lo
    -- que lo deja entrar: `~ ALL (arreglo)` no puede, y recorría las 28,000
    -- fichas en cada búsqueda.
    WHERE (c.nombre_busq || ' ' || c.nombre_comp || ' ' || c.ids_busq || ' ' || c.ids_comp) ~ v_idx
      AND (c.nombre_busq || ' ' || c.nombre_comp || ' ' || c.ids_busq || ' ' || c.ids_comp) ~ ALL (v_pats)
      AND c.deshabilitada_at IS NULL  -- fusionada: no se ofrece
  ) x
  WHERE x.s > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RETURN; END IF;

  -- Aproximada, sólo sobre el NOMBRE (un NIT o un teléfono no se «parecen»:
  -- son o no son). Los trigramas eligen a los 300 más cercanos; el parecido
  -- exacto —el mismo de JS— decide.
  RETURN QUERY
  SELECT x.id, x.s * 50, true
  FROM (
    SELECT c.id,
           public.busqueda_parecido(v_tok, ARRAY[c.nombre_busq], ARRAY[c.nombre_comp]) AS s
    FROM (
      SELECT c0.id, c0.nombre_busq, c0.nombre_comp
      FROM public.customers c0
      WHERE public.word_similarity(public.norm_busqueda(p_q), c0.nombre_busq) >= 0.3
        AND c0.deshabilitada_at IS NULL
      ORDER BY public.word_similarity(public.norm_busqueda(p_q), c0.nombre_busq) DESC
      LIMIT 300
    ) c
  ) x
  WHERE x.s >= 0.75;
END;
$function$;

CREATE OR REPLACE FUNCTION public.buscar_personas_por_nombre(p_nombre text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tok  jsonb  := public.busqueda_palabras(p_nombre);
  v_pats text[] := public.busqueda_patrones_legados(public.busqueda_palabras(p_nombre));
  v_pre  text[] := public.busqueda_prefiltro(public.busqueda_palabras(p_nombre));
  v_idx  text   := public.busqueda_la_mas_larga(public.busqueda_prefiltro(public.busqueda_palabras(p_nombre)));
BEGIN
  IF v_pats IS NULL THEN
    RETURN json_build_object('clientes', '[]'::json, 'practicantes', '[]'::json,
                             'proveedores', '[]'::json, 'recetas', '[]'::json);
  END IF;
  RETURN json_build_object(
    'clientes', coalesce((
      SELECT json_agg(x.id) FROM (
        SELECT y.id FROM (
          SELECT c.id, c.name FROM public.customers c
          WHERE (c.nombre_busq || ' ' || c.nombre_comp || ' ' || c.ids_busq || ' ' || c.ids_comp) ~ v_idx
            AND (c.nombre_busq || ' ' || c.nombre_comp) ~ ALL (v_pre)
            AND public.busqueda_puntaje(v_tok, ARRAY[c.nombre_busq], ARRAY[c.nombre_comp]) > 0
            AND c.deshabilitada_at IS NULL
          -- La barrera es lo que importa. Sin ella, con el RLS de `customers`
          -- el planificador recorría las fichas en orden de nombre hasta
          -- juntar 20 —o sea TODAS cuando no hay ninguna—: 225 MB por llamada
          -- como usuario (medido con `medir:como-usuario`; como `postgres`
          -- eran 9). Con ella se juntan las que coinciden y recién después se
          -- ordenan: ~16 MB en el peor caso.
          OFFSET 0) y
        ORDER BY y.name LIMIT 20) x), '[]'::json),
    'practicantes', coalesce((
      SELECT json_agg(x.id) FROM (
        SELECT p.id FROM public.practicantes p
        WHERE regexp_replace(lower(public.f_unaccent(coalesce(p.first_names, '') || ' ' || coalesce(p.last_names, ''))), '[^a-z0-9 ]', '', 'g') LIKE ALL (v_pats)
          AND public.busqueda_coincide(v_tok, coalesce(p.first_names, '') || ' ' || coalesce(p.last_names, ''))
        ORDER BY p.last_names LIMIT 20) x), '[]'::json),
    'proveedores', coalesce((
      SELECT json_agg(x.nit) FROM (
        SELECT pm.nit FROM public.proveedores_maestro pm
        WHERE regexp_replace(lower(public.f_unaccent(coalesce(pm.nombre, ''))), '[^a-z0-9 ]', '', 'g') LIKE ALL (v_pats)
          AND public.busqueda_coincide(v_tok, pm.nombre)
        ORDER BY pm.nombre LIMIT 20) x), '[]'::json),
    'recetas', coalesce((
      SELECT json_agg(x.id) FROM (
        SELECT r.id FROM public.recetas r
        WHERE regexp_replace(lower(public.f_unaccent(coalesce(r.paciente_nombre, ''))), '[^a-z0-9 ]', '', 'g') LIKE ALL (v_pats)
          AND public.busqueda_coincide(v_tok, r.paciente_nombre)
        ORDER BY r.id DESC LIMIT 20) x), '[]'::json)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.puntos_panel_candidatas(p_id_cliente bigint, p_busqueda text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE c record; v_tel text; v_nombre text; v_q text; v_qd text; v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver Puntos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.puntos_cuentas_pendientes WHERE id_cliente = p_id_cliente;
  IF NOT FOUND THEN RETURN '[]'::json; END IF;
  v_tel := right(regexp_replace(coalesce(c.telefono, ''), '\D', '', 'g'), 8);
  v_nombre := upper(unaccent(coalesce(c.nombre, '')));
  v_q := nullif(upper(unaccent(trim(coalesce(p_busqueda, '')))), '');
  v_qd := nullif(regexp_replace(coalesce(p_busqueda, ''), '\D', '', 'g'), '');

  SELECT coalesce(json_agg(x ORDER BY x.por_telefono DESC, x.parecido DESC), '[]'::json) INTO v FROM (
    SELECT f.id, f.name AS nombre, f.dui, f.phone AS telefono,
           (length(v_tel) = 8 AND right(regexp_replace(coalesce(f.phone, ''), '\D', '', 'g'), 8) = v_tel) AS por_telefono,
           round(similarity(upper(unaccent(f.name)), v_nombre)::numeric, 2) AS parecido,
           (SELECT saldo FROM public.puntos_cuenta pc WHERE pc.customer_id = f.id) AS saldo_actual
      FROM public.customers f
     WHERE f.deshabilitada_at IS NULL AND CASE WHEN v_q IS NULL THEN
             (length(v_tel) = 8 AND right(regexp_replace(coalesce(f.phone, ''), '\D', '', 'g'), 8) = v_tel)
             OR (length(v_nombre) >= 6 AND upper(unaccent(f.name)) % v_nombre)
           ELSE
             upper(unaccent(f.name)) LIKE '%' || v_q || '%'
             OR (length(v_qd) >= 8 AND (regexp_replace(coalesce(f.dui, ''), '\D', '', 'g') = v_qd
                                        OR right(regexp_replace(coalesce(f.phone, ''), '\D', '', 'g'), 8) = right(v_qd, 8)))
           END
     ORDER BY 5 DESC, 6 DESC
     LIMIT 8
  ) x;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fichas_para_corregir_dte()
 RETURNS TABLE(customer_id bigint, name text, erp_id text, categoria text, origen text, campo text, motivo_mh text, alcance_escritura text, ya_corregido boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH rechazados AS (
    SELECT DISTINCT ON (r.customer_id, r.campo_ficha)
           r.customer_id, r.cliente, r.erp_id, r.categoria,
           r.campo_ficha, r.motivo, r.ultimo_intento
    FROM public.dte_rechazos_vigentes r
    WHERE r.accionable
      -- `phone` se sumó el 2026-08-16, `email` el 2026-08-24. La lista es «qué
      -- campos sabe corregir la corrida de fichas», y tiene que coincidir con
      -- las ramas de su tabla de decisión: un campo de más deja una ficha dando
      -- vueltas sin que nadie la escriba, uno de menos la vuelve invisible para
      -- el proceso hecho para arreglarla — que fue exactamente lo que pasó con
      -- el teléfono, y otra vez con el correo ocho días después.
      AND r.campo_ficha IN ('distrito','municipio','departamento','dui','phone','email')
      AND r.customer_id IS NOT NULL
    ORDER BY r.customer_id, r.campo_ficha, r.ultimo_intento DESC
  ),
  todo AS (
    -- ① Lo que Hacienda rechazó. La señal que no depende del espejo.
    SELECT rc.customer_id, rc.cliente AS name, rc.erp_id, rc.categoria,
           'rechazo'::text AS origen, rc.campo_ficha AS campo, rc.motivo AS motivo_mh,
           public.alcance_escritura_ficha(rc.categoria) AS alcance_escritura,
           EXISTS (
             SELECT 1 FROM public.dte_correcciones_ficha k
             WHERE k.customer_id = rc.customer_id
               -- El mismo campo, o una corrección de ubicación cuando el
               -- rechazo ES de ubicación. `ubicacion` cubre a los tres campos
               -- de domicilio porque se escriben juntos — y a ningún otro.
               AND (k.campo = rc.campo_ficha
                    OR (k.campo = 'ubicacion'
                        AND rc.campo_ficha IN ('distrito','municipio','departamento')))
               AND k.created_at < rc.ultimo_intento
           ) AS ya_corregido
    FROM rechazados rc

    UNION ALL

    -- ② Preventivo, alcance completo: consumidores y huérfanas sin distrito.
    SELECT c.id, c.name, c.erp_id, c.categoria,
           'sin_distrito'::text, 'distrito'::text, NULL::text,
           public.alcance_escritura_ficha(c.categoria), false
    FROM public.clientes_sin_distrito_corregibles() c
    WHERE NOT EXISTS (SELECT 1 FROM rechazados rc WHERE rc.customer_id = c.id)

    UNION ALL

    -- ③ Preventivo, SÓLO distrito: contribuyentes que todavía no rebotaron.
    -- Rama propia y no `clientes_sin_distrito_corregibles()` — ver el encabezado:
    -- esa función también la lee el script viejo, que aplica las reglas enteras.
    SELECT c.id, c.name, c.erp_id, c.categoria,
           'sin_distrito'::text, 'distrito'::text, NULL::text,
           public.alcance_escritura_ficha(c.categoria), false
    FROM public.customers c
    WHERE c.distrito IS NULL
      AND c.deshabilitada_at IS NULL
      AND public.alcance_escritura_ficha(c.categoria) = 'solo_distrito'
      AND NOT public.es_cliente_mostrador(c.name, c.erp_id)
      AND NOT EXISTS (SELECT 1 FROM rechazados rc WHERE rc.customer_id = c.id)
  )
  -- El orden importa: la corrida corta en 120 fichas por presupuesto de tiempo,
  -- y lo que Hacienda ya rechazó tiene una factura esperando detrás. Sin este
  -- ORDER BY el corte lo decide el plan del día.
  SELECT t.customer_id, t.name, t.erp_id, t.categoria, t.origen, t.campo,
         t.motivo_mh, t.alcance_escritura, t.ya_corregido
  FROM todo t
  -- Una ficha fusionada no se corrige ni se vuelve a fusionar cada noche.
  WHERE NOT EXISTS (SELECT 1 FROM public.customers d
                     WHERE d.id = t.customer_id AND d.deshabilitada_at IS NOT NULL)
  ORDER BY (t.origen <> 'rechazo'), t.customer_id;
$function$;

CREATE OR REPLACE FUNCTION public.clientes_sin_distrito_corregibles()
 RETURNS TABLE(id bigint, name text, erp_id text, categoria text, direccion text, departamento text, municipio text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT c.id, c.name, c.erp_id, c.categoria,
         c.direccion, c.departamento, c.municipio
  FROM public.customers c
  WHERE c.distrito IS NULL
    AND c.deshabilitada_at IS NULL
    AND (c.categoria = 'Consumidor' OR c.categoria IS NULL)
    AND NOT public.es_cliente_mostrador(c.name, c.erp_id)
  ORDER BY c.id;
$function$;
