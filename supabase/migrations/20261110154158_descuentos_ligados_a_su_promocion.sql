-- Descuentos de la caja ligados a su promoción, solos (usuario, 2026-11-10).
--
-- Reactivó Rinokem y el precio no bajó: el descuento #32 se había cargado
-- aparte y `promociones.descuentos_erp` estaba vacío, así que reactivar no lo
-- movió. Medido ese día: 2 de 4 promociones por producto tenían su descuento
-- sin ligar (Rinokem #42 y Medilasa #43).
--
-- UN juez —`promociones_descuentos_sin_ligar()`— decide qué descuento es de
-- qué promoción, y lo leen tres sitios: el cron que copia los descuentos
-- (liga solo cuando no hay duda), la ventana de reactivar (ofrece los que
-- faltan) y la lista de promociones (avisa cuando el precio no bajó).
--
-- ── Por qué el criterio es tan estricto ──────────────────────────────────
-- «Mismo producto y fechas que se cruzan» liga MAL: el descuento #36
-- «PROMOCION ABBOTT 850GR 17/09 - 30/09» toma productos de «DESCUENTO EN LECHE
-- Y SUPLEMENTOS» (#33) en las mismas fechas y es otra campaña. Ligarlo haría
-- que reactivar la #33 le moviera el precio a la de Abbott. Por eso:
--   · TODOS los productos del descuento están en la promoción (no basta uno);
--   · arrancan juntos: el inicio del descuento a ≤3 días del primer producto;
--   · el descuento no es todavía de ninguna promoción;
--   · nunca por el nombre (dos descuentos pueden llamarse igual).
-- Y el cron liga sólo si hay UNA promoción posible; con dos, no adivina.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.promociones_descuentos_sin_ligar()
RETURNS TABLE(promocion_id bigint, descuento_id integer, candidatas integer)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  WITH pr AS (
    SELECT p.id, min(r.inicio) AS inicio, array_agg(DISTINCT r.erp_product_id) AS prods
      FROM public.promociones p
      JOIN public.promocion_renglon r ON r.promocion_id = p.id
     WHERE p.tipo = 'producto' AND p.estado IN ('activa', 'finalizada')
     GROUP BY p.id
  ), ligados AS (
    SELECT DISTINCT unnest(descuentos_erp) AS id FROM public.promociones
  ), par AS (
    SELECT pr.id AS promocion_id, d.id AS descuento_id
      FROM public.descuentos_espejo d
      JOIN pr ON cardinality(d.productos) > 0
             AND d.productos <@ pr.prods
             AND abs(d.inicio - pr.inicio) <= 3
     WHERE d.borrado_at IS NULL
       AND d.id NOT IN (SELECT l.id FROM ligados l WHERE l.id IS NOT NULL)
  )
  SELECT promocion_id, descuento_id,
         (count(*) OVER (PARTITION BY descuento_id))::int AS candidatas
    FROM par;
$$;
REVOKE EXECUTE ON FUNCTION public.promociones_descuentos_sin_ligar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promociones_descuentos_sin_ligar() TO service_role;

-- El cron: liga los que tienen UNA sola promoción posible, y lo anota.
CREATE OR REPLACE FUNCTION public.ligar_descuentos_sin_ligar()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  n integer := 0;
BEGIN
  FOR v IN
    SELECT s.promocion_id, s.descuento_id, d.descripcion
      FROM public.promociones_descuentos_sin_ligar() s
      JOIN public.descuentos_espejo d ON d.id = s.descuento_id
     WHERE s.candidatas = 1
     ORDER BY s.promocion_id, s.descuento_id
  LOOP
    UPDATE public.promociones
       SET descuentos_erp = array_append(descuentos_erp, v.descuento_id), updated_at = now()
     WHERE id = v.promocion_id AND NOT (v.descuento_id = ANY (descuentos_erp));
    IF FOUND THEN
      PERFORM public.promocion_log(
        v.promocion_id, NULL, NULL, 'descuento_ligado', NULL, v.descuento_id::text,
        format('«%s»: mismos productos y mismo arranque, sin otra promoción posible', v.descripcion));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ligar_descuentos_sin_ligar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ligar_descuentos_sin_ligar() TO service_role;

-- La ventana de reactivar: los que le faltan a ESTA promoción, con cuántas
-- promociones posibles tiene cada uno (más de una = la ventana no lo marca).
CREATE OR REPLACE FUNCTION public.promocion_descuentos_por_ligar(p_id bigint)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.auth_has_module_permission('promociones', 'can_view') THEN
    RETURN NULL;
  END IF;
  RETURN (
    SELECT coalesce(json_agg(json_build_object('id', s.descuento_id, 'candidatas', s.candidatas)
                             ORDER BY s.descuento_id), '[]'::json)
      FROM public.promociones_descuentos_sin_ligar() s
     WHERE s.promocion_id = p_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.promocion_descuentos_por_ligar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promocion_descuentos_por_ligar(bigint) TO authenticated, service_role;

-- Ligar uno a mano, desde la ventana. Sólo lo que el juez propone: no es una
-- puerta para ligar cualquier descuento a cualquier promoción.
CREATE OR REPLACE FUNCTION public.ligar_descuento_a_promocion(p_promocion bigint, p_descuento integer)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF public.auth_employee_id() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF NOT public.auth_has_module_permission('promociones', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
  END IF;
  IF EXISTS (SELECT 1 FROM public.promociones
              WHERE id = p_promocion AND p_descuento = ANY (descuentos_erp)) THEN
    RETURN json_build_object('ligado', true, 'ya_estaba', true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.promociones_descuentos_sin_ligar() s
                  WHERE s.promocion_id = p_promocion AND s.descuento_id = p_descuento) THEN
    RAISE EXCEPTION 'NO_CORRESPONDE: ese descuento no es de esta promoción o ya es de otra';
  END IF;
  UPDATE public.promociones
     SET descuentos_erp = array_append(descuentos_erp, p_descuento), updated_at = now()
   WHERE id = p_promocion;
  PERFORM public.promocion_log(p_promocion, NULL, NULL, 'descuento_ligado', NULL,
                               p_descuento::text, 'ligado al moverlo desde Promociones');
  RETURN json_build_object('ligado', true, 'ya_estaba', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ligar_descuento_a_promocion(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ligar_descuento_a_promocion(bigint, integer) TO authenticated, service_role;

-- La copia de la caja liga al terminar de copiar: es cuando hay descuentos
-- nuevos que mirar. Misma definición viva + el ligado al final.
CREATE OR REPLACE FUNCTION public.descuentos_espejo_sync(p jsonb, completa boolean)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  n_cambios integer;
  n_borrados integer := 0;
  n_ligados integer := 0;
BEGIN
  INSERT INTO public.descuentos_espejo AS d
    (id, descripcion, tipo, monto, inicio, fin, todas_las_salas, branch_id, productos)
  SELECT (x->>'id')::int, x->>'descripcion', x->>'tipo', (x->>'monto')::numeric,
         (x->>'inicio')::date, (x->>'fin')::date, (x->>'todas_las_salas')::boolean,
         nullif(x->>'branch_id', '')::bigint,
         CASE WHEN jsonb_typeof(x->'productos') = 'array'
              THEN ARRAY(SELECT e::int FROM jsonb_array_elements_text(x->'productos') e)
              ELSE coalesce((SELECT v.productos FROM public.descuentos_espejo v
                              WHERE v.id = (x->>'id')::int), '{}') END
    FROM jsonb_array_elements(p) x
  ON CONFLICT (id) DO UPDATE SET
    descripcion = EXCLUDED.descripcion, tipo = EXCLUDED.tipo, monto = EXCLUDED.monto,
    inicio = EXCLUDED.inicio, fin = EXCLUDED.fin, todas_las_salas = EXCLUDED.todas_las_salas,
    branch_id = EXCLUDED.branch_id, productos = EXCLUDED.productos,
    borrado_at = NULL, updated_at = now()
  WHERE (d.descripcion, d.tipo, d.monto, d.inicio, d.fin, d.todas_las_salas, d.branch_id, d.productos, d.borrado_at)
        IS DISTINCT FROM
        (EXCLUDED.descripcion, EXCLUDED.tipo, EXCLUDED.monto, EXCLUDED.inicio, EXCLUDED.fin,
         EXCLUDED.todas_las_salas, EXCLUDED.branch_id, EXCLUDED.productos, NULL::timestamptz);
  GET DIAGNOSTICS n_cambios = ROW_COUNT;

  -- Freno: una lista vacía (sesión vencida allá) no borra nada.
  IF completa AND jsonb_array_length(p) > 0 THEN
    UPDATE public.descuentos_espejo SET borrado_at = now(), updated_at = now()
     WHERE borrado_at IS NULL
       AND id NOT IN (SELECT (x->>'id')::int FROM jsonb_array_elements(p) x);
    GET DIAGNOSTICS n_borrados = ROW_COUNT;
  END IF;

  -- Sólo en la copia completa (el cron); la puntual de un guardado no liga.
  IF completa THEN
    n_ligados := public.ligar_descuentos_sin_ligar();
  END IF;
  RETURN json_build_object('cambios', n_cambios, 'borrados', n_borrados, 'ligados', n_ligados);
END;
$function$;

-- La lista: `descuento_por_mover` = la promoción está viva y algún producto
-- suyo que un descuento ligado SÍ rebajaba hoy no tiene ninguno vigente. Es
-- exactamente el caso Rinokem: la promoción cuenta y el precio no baja. Sólo
-- productos que algún descuento ligado tomó alguna vez: una promoción cuyo
-- descuento cubre 97 de 102 productos a propósito no avisa por los otros 5.
CREATE OR REPLACE FUNCTION public.get_promociones(p_estado text DEFAULT NULL::text, p_tipo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_out json;
    v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;

    SELECT coalesce(json_agg(to_json(x) ORDER BY x.inicio DESC NULLS LAST, x.nombre), '[]'::json)
      INTO v_out
      FROM (
        SELECT pm.id, pm.nombre, pm.estado, pm.nota, pm.created_at,
               pm.tipo, pm.year_month, pm.paga, pm.supplier_id,
               coalesce(array_length(pm.descuentos_erp, 1), 0) AS descuentos,
               (pm.tipo = 'producto' AND pm.estado = 'activa'
                AND coalesce(array_length(pm.descuentos_erp, 1), 0) > 0
                AND EXISTS (
                    SELECT 1 FROM public.promocion_renglon rr
                     WHERE rr.promocion_id = pm.id AND rr.estado = 'abierto'
                       AND rr.inicio <= v_hoy AND rr.fin >= v_hoy
                       AND EXISTS (SELECT 1 FROM public.descuentos_espejo d
                                    WHERE d.id = ANY (pm.descuentos_erp)
                                      AND rr.erp_product_id = ANY (d.productos))
                       AND NOT EXISTS (SELECT 1 FROM public.descuentos_espejo d
                                        WHERE d.id = ANY (pm.descuentos_erp)
                                          AND d.borrado_at IS NULL
                                          AND d.inicio <= v_hoy AND d.fin >= v_hoy
                                          AND rr.erp_product_id = ANY (d.productos)))
               ) AS descuento_por_mover,
               CASE pm.tipo
                 WHEN 'laboratorio' THEN (pm.year_month || '-01')::date
                 ELSE r.inicio END AS inicio,
               CASE pm.tipo
                 WHEN 'laboratorio'
                   THEN ((pm.year_month || '-01')::date
                         + interval '1 month' - interval '1 day')::date
                 ELSE r.fin END AS fin,
               r.renglones, r.lote_total, r.abiertos,
               CASE pm.tipo
                 WHEN 'laboratorio' THEN lab.nombres
                 ELSE r.laboratorios END AS laboratorios,
               lab.niveles, lab.salas
          FROM public.promociones pm
          LEFT JOIN LATERAL (
              SELECT min(rr.inicio) AS inicio,
                     max(rr.fin)    AS fin,
                     count(*)::int  AS renglones,
                     sum(rr.lote_total)::int AS lote_total,
                     count(*) FILTER (WHERE rr.estado = 'abierto')::int AS abiertos,
                     (SELECT json_agg(DISTINCT coalesce(lb.nombre,'Sin laboratorio'))
                        FROM public.promocion_renglon r2
                        JOIN public.products p2 ON p2.id = r2.erp_product_id
                        LEFT JOIN public.laboratorios lb ON lb.id = p2.laboratorio_id
                       WHERE r2.promocion_id = pm.id) AS laboratorios
                FROM public.promocion_renglon rr
               WHERE rr.promocion_id = pm.id
          ) r ON pm.tipo = 'producto'
          LEFT JOIN LATERAL (
              SELECT (SELECT json_agg(lb.nombre ORDER BY lb.nombre)
                        FROM public.promocion_laboratorio pl
                        JOIN public.laboratorios lb ON lb.id = pl.laboratorio_id
                       WHERE pl.promocion_id = pm.id) AS nombres,
                     (SELECT count(*)::int FROM public.promocion_nivel nv
                       WHERE nv.promocion_id = pm.id) AS niveles,
                     (SELECT count(DISTINCT nu.branch_id)::int
                        FROM public.promocion_nivel_umbral nu
                       WHERE nu.promocion_id = pm.id) AS salas
          ) lab ON pm.tipo = 'laboratorio'
         WHERE (p_estado IS NULL OR pm.estado = p_estado)
           AND (p_tipo   IS NULL OR pm.tipo   = p_tipo)
      ) x;

    RETURN v_out;
END;
$function$;

-- Lo que ya estaba sin ligar el día que esto nació (Medilasa #43 ← #31).
SELECT public.ligar_descuentos_sin_ligar();
