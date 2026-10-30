-- El conteo pide la fecha de vencimiento cuando el producto la necesita
-- (usuario, 2026-10-30: «debe pedirlo si el producto lo necesita, así al
-- ajustar, si hay que ajustar, va completo»).
--
-- X-Ray Dol es perecedero y no regulado: el conteo sólo pedía lote a los
-- regulados, así que la sala contó sin fecha, la corrección de factor salió
-- sin fecha y la caja la rechazó («necesita fecha de vencimiento»). Hay 2,135
-- productos en el mismo caso.
--
-- 1. `consulta_existencia_para_contar` dice si el producto es perecedero y la
--    fecha que el sistema ya tiene en la sala (para no hacerla escribir de nuevo).
-- 2. `consulta_existencia_contar` rechaza un renglón contado de un perecedero
--    sin fecha válida.
-- 3. `revision_de_presentaciones` lleva por fila si es perecedero, la fecha que
--    contó la sala y la fecha de la solicitud ya creada.
-- 4. `correccion_de_factor_poner_vence` completa la fecha en una corrección
--    que quedó pendiente porque la caja la rechazó sin ella.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.consulta_existencia_para_contar(p_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  s public.consultas_existencia_salas%ROWTYPE;
  c public.consultas_existencia%ROWTYPE;
  v_regulado boolean;
  v_perecedero boolean;
BEGIN
  SELECT * INTO s FROM public.consultas_existencia_salas WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ENCONTRADA'; END IF;
  IF public.auth_module_scope('conteo_inventario') <> 'ALL' AND s.branch_id <> public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  SELECT * INTO c FROM public.consultas_existencia WHERE id = s.consulta_id;
  SELECT coalesce(regulado, false), coalesce(perecedero, false)
    INTO v_regulado, v_perecedero
    FROM public.products WHERE id = c.erp_product_id;

  RETURN json_build_object(
    'id', s.id, 'estado', s.estado, 'ronda', CASE WHEN s.estado = 'RECONTAR' THEN 2 ELSE 1 END,
    'erp_product_id', c.erp_product_id,
    'nombre', (SELECT nombre FROM public.products WHERE id = c.erp_product_id),
    'sala', (SELECT name FROM public.branches WHERE id = s.branch_id),
    'regulado', v_regulado,
    'perecedero', v_perecedero,
    -- Sin lote (no regulado): la fecha que el sistema ya tiene en la sala, para
    -- confirmarla en vez de escribirla. Es una fecha, no una cantidad: no le
    -- dicta a la sala ningún número del conteo.
    'vence', CASE WHEN v_perecedero AND NOT v_regulado THEN (
      SELECT max(i.fecha_vencimiento) FROM public.inventory i
       WHERE i.erp_product_id = c.erp_product_id AND i.erp_sucursal_id = s.erp_sucursal_id
         AND NOT i.is_vencidos AND i.cantidad > 0) END,
    'presentaciones', (
      SELECT coalesce(json_agg(json_build_object('tipo', tipo, 'factor', factor) ORDER BY factor DESC), '[]'::json)
        FROM (SELECT DISTINCT upper(trim(pr.tipo)) tipo, pp.factor
                FROM public.product_precios pp JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
               WHERE pp.product_id = c.erp_product_id AND pp.activo AND pp.factor > 0) x),
    -- Los lotes que la sala tiene, por nombre y fecha: sin cantidades.
    'lotes', CASE WHEN v_regulado THEN (
      SELECT coalesce(json_agg(json_build_object('lote', lote, 'vence', vence) ORDER BY vence NULLS LAST, lote), '[]'::json)
        FROM (SELECT upper(trim(i.lote)) lote, max(i.fecha_vencimiento) vence
                FROM public.inventory i
               WHERE i.erp_product_id = c.erp_product_id AND i.erp_sucursal_id = s.erp_sucursal_id
                 AND NOT i.is_vencidos AND i.cantidad > 0
               GROUP BY 1) x) ELSE '[]'::json END);
END $function$;

CREATE OR REPLACE FUNCTION public.consulta_existencia_contar(p_id uuid, p_conteo jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  s public.consultas_existencia_salas%ROWTYPE;
  v_producto int;
  v_regulado boolean;
  v_perecedero boolean;
  v_cmp jsonb;
  v_estado text;
  v_yo uuid := public.auth_employee_id();
BEGIN
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  SELECT * INTO s FROM public.consultas_existencia_salas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ENCONTRADA'; END IF;
  IF public.auth_module_scope('conteo_inventario') <> 'ALL' AND s.branch_id <> public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF s.estado NOT IN ('PENDIENTE', 'RECONTAR') THEN RAISE EXCEPTION 'YA_CONTADA'; END IF;

  SELECT c.erp_product_id, coalesce(p.regulado, false), coalesce(p.perecedero, false)
    INTO v_producto, v_regulado, v_perecedero
    FROM public.consultas_existencia c JOIN public.products p ON p.id = c.erp_product_id
   WHERE c.id = s.consulta_id;

  IF jsonb_typeof(p_conteo) <> 'array' THEN RAISE EXCEPTION 'CONTEO_INVALIDO'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_conteo) x
     WHERE (x->>'cantidad') !~ '^\d+$' OR (x->>'factor') !~ '^[1-9]\d*$'
        OR coalesce(trim(x->>'tipo'), '') = ''
        OR (v_regulado AND (x->>'cantidad')::int > 0 AND coalesce(trim(x->>'lote'), '') = '')
        -- Un perecedero contado sin fecha no se podría cargar si hiciera falta.
        OR (v_perecedero AND (x->>'cantidad')::int > 0
            AND coalesce(x->>'vence', '') !~ '^\d{4}-\d{2}-\d{2}$')) THEN
    RAISE EXCEPTION 'CONTEO_INVALIDO';
  END IF;

  v_cmp := public.consulta_existencia_comparar(v_producto, s.erp_sucursal_id, p_conteo);

  IF s.estado = 'PENDIENTE' THEN
    v_estado := CASE WHEN (v_cmp->>'cuadra')::boolean THEN 'CUADRA' ELSE 'RECONTAR' END;
    UPDATE public.consultas_existencia_salas
       SET conteo_1 = p_conteo, contado_1_por = v_yo, contado_1_at = now(),
           sistema = jsonb_build_object('ronda_1', v_cmp),
           estado = v_estado,
           diferencia = CASE WHEN v_estado = 'CUADRA' THEN 0 END
     WHERE id = p_id;
  ELSE
    v_estado := CASE WHEN (v_cmp->>'cuadra')::boolean THEN 'CUADRA' ELSE 'DESCUADRE' END;
    UPDATE public.consultas_existencia_salas
       SET conteo_2 = p_conteo, contado_2_por = v_yo, contado_2_at = now(),
           sistema = sistema || jsonb_build_object('ronda_2', v_cmp),
           estado = v_estado,
           diferencia = (v_cmp->>'diferencia')::int
     WHERE id = p_id;
  END IF;

  -- Todas contestaron: se cierra y se avisa el resumen, una sola vez.
  IF v_estado <> 'RECONTAR' AND NOT EXISTS (
       SELECT 1 FROM public.consultas_existencia_salas
        WHERE consulta_id = s.consulta_id AND estado IN ('PENDIENTE', 'RECONTAR')) THEN
    UPDATE public.consultas_existencia SET cerrada_at = now()
     WHERE id = s.consulta_id AND cerrada_at IS NULL;
    IF FOUND THEN PERFORM public.consulta_existencia_avisar_resumen(s.consulta_id); END IF;
  END IF;

  -- En RECONTAR no se dice cuánto ni hacia dónde: sería dictarle el número.
  RETURN CASE WHEN v_estado = 'RECONTAR' THEN json_build_object('estado', v_estado)
         ELSE json_build_object('estado', v_estado, 'contado', v_cmp->'contado', 'sistema', v_cmp->'sistema',
                                'diferencia', v_cmp->'diferencia',
                                'texto', public.unidades_en_presentaciones(v_producto, (v_cmp->>'diferencia')::int)) END;
END $function$;

CREATE OR REPLACE FUNCTION public.revision_de_presentaciones()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('productos_tab_presentaciones', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN: no tenés acceso a las presentaciones de productos';
  END IF;

  RETURN json_build_object(
    -- Lo que cambió en los últimos 120 días y qué se convirtió.
    'cambios', (
      SELECT coalesce(json_agg(json_build_object(
               'id', c.id, 'erp_product_id', c.erp_product_id, 'nombre', p.nombre,
               'detectado_at', c.detectado_at, 'procesado_at', c.procesado_at,
               'resultado', c.resultado) ORDER BY c.procesado_at DESC NULLS FIRST), '[]'::json)
        FROM public.cambios_de_factor c
        JOIN public.products p ON p.id = c.erp_product_id
       WHERE c.detectado_at >= now() - interval '120 days'
         AND (c.procesado_at IS NULL
              OR c.resultado ? 'factor_antes'
              OR coalesce((c.resultado->>'ventas_sin_convertir')::int, 0) > 0)),

    -- La existencia que quedó contada en la unidad vieja: las filas de la foto
    -- que sacó el proceso al convertir (`existencia_por_corregir`), y sólo
    -- mientras sigan EXACTAMENTE como estaban. Una fila que cambió —se vendió,
    -- llegó una compra, alguien ya la corrigió en la caja— deja de ofrecerse:
    -- el botón descarta o carga sobre un número que ya no es el de la foto.
    'existencias', (
      WITH rec AS (
        SELECT DISTINCT ON (c.erp_product_id)
               c.id AS cambio_id, c.erp_product_id, c.detectado_at,
               (c.resultado->>'factor_antes')::int AS de,
               (c.resultado->>'factor_ahora')::int AS a,
               c.resultado->'existencia_por_corregir' AS lista
          FROM public.cambios_de_factor c
         WHERE c.procesado_at >= now() - interval '120 days'
           AND jsonb_typeof(c.resultado->'existencia_por_corregir') = 'array'
         ORDER BY c.erp_product_id, c.procesado_at DESC
      ),
      foto AS (
        SELECT r.*, e.x->>'sentido' AS sentido,
               (e.x->>'erp_sucursal_id')::int AS suc,
               nullif(btrim(coalesce(e.x->>'lote', '')), '') AS lote,
               nullif(e.x->>'vence', '')::date AS vence,
               e.x->>'presentacion' AS presentacion,
               (e.x->>'muestra')::int AS muestra,
               (e.x->>'esperado')::int AS esperado,
               (e.x->>'cargar')::int AS cargar, (e.x->>'sobran')::int AS sobran,
               e.x->>'carga_tipo' AS carga_tipo, (e.x->>'carga_factor')::int AS carga_factor
          FROM rec r
          CROSS JOIN LATERAL jsonb_array_elements(r.lista) e(x)
      ),
      vigente AS (
        SELECT f.* FROM foto f
         WHERE (f.sentido = 'achica' AND f.de > 1 AND f.a = 1
                AND EXISTS (SELECT 1 FROM public.inventory i
                             WHERE i.erp_product_id = f.erp_product_id
                               AND i.erp_sucursal_id = f.suc
                               AND NOT i.is_vencidos
                               AND nullif(btrim(coalesce(i.lote, '')), '') IS NOT DISTINCT FROM f.lote
                               AND upper(trim(i.presentacion)) = upper(f.presentacion)
                               AND i.cantidad = f.muestra))
            OR (f.sentido = 'crece' AND f.de = 1 AND f.a > 1
                -- Lo que el inventario muestra hoy tiene que ser lo que muestra
                -- si nadie tocó nada…
                AND (SELECT coalesce(sum(i.cantidad * coalesce(
                              (regexp_match(i.detalle, '\d+[xX](\d+)'))[1]::int, 1)), 0)
                       FROM public.inventory i
                      WHERE i.erp_product_id = f.erp_product_id
                        AND i.erp_sucursal_id = f.suc
                        AND NOT i.is_vencidos) = f.esperado
                -- …y como la existencia guardada no se ve entera (1 de 24 son 0
                -- cajas), una venta desde el cambio también la invalida.
                AND NOT EXISTS (SELECT 1
                                  FROM public.sales_invoice_items ii
                                  JOIN public.sales_invoices si ON si.id = ii.invoice_id
                                  JOIN public.erp_sucursal_map m2 ON m2.branch_id = si.branch_id
                                 WHERE ii.erp_product_id = f.erp_product_id
                                   AND m2.erp_sucursal_id = f.suc
                                   AND si.fecha >= (f.detectado_at AT TIME ZONE 'America/El_Salvador')::date
                                   AND public.venta_valida(si.estado)))
      )
      SELECT coalesce(json_agg(json_build_object(
               'cambio_id', v.cambio_id, 'erp_product_id', v.erp_product_id, 'nombre', p.nombre,
               'sentido', v.sentido,
               'sala', m.nombre, 'erp_sucursal_id', m.erp_sucursal_id, 'branch_id', m.branch_id,
               'presentacion', v.presentacion, 'lote', v.lote, 'vence', v.vence,
               'muestra', v.muestra, 'de', v.de, 'a', v.a,
               -- achica: 16 guardadas con caja de 1 son 1 caja; salen 15.
               -- crece:  1 guardada con caja de 24 es 1 caja; entra 1 caja
               --         (24) y queda 1 suelta de más que no se puede sacar
               --         sin una presentación de 1.
               'quedan',    CASE v.sentido WHEN 'achica' THEN v.muestra / v.de ELSE v.muestra END,
               'descartar', CASE v.sentido WHEN 'achica' THEN v.muestra - v.muestra / v.de END,
               'sueltas',   CASE v.sentido WHEN 'achica' THEN v.muestra % v.de END,
               -- Fotos anteriores al 29-oct no traen dónde cargar: caja nueva.
               'cargar',    CASE v.sentido WHEN 'crece'  THEN coalesce(v.cargar, v.muestra) END,
               'sobran',    CASE v.sentido WHEN 'crece'  THEN coalesce(v.sobran, v.muestra) END,
               'carga_tipo',   CASE v.sentido WHEN 'crece' THEN coalesce(v.carga_tipo, v.presentacion) END,
               'carga_factor', CASE v.sentido WHEN 'crece' THEN coalesce(v.carga_factor, v.a) END,
               -- Una carga de un perecedero sin fecha la rechaza la caja. La
               -- fecha sale de lo último que contó la sala (2026-10-30); si no
               -- contó con fecha, la pantalla la pide antes de corregir.
               'perecedero', coalesce(p.perecedero, false),
               'vence_contado', (
                 SELECT max(nullif(x->>'vence', '')::date)
                   FROM (SELECT coalesce(s2.conteo_2, s2.conteo_1) AS conteo
                           FROM public.consultas_existencia_salas s2
                           JOIN public.consultas_existencia c2 ON c2.id = s2.consulta_id
                          WHERE c2.erp_product_id = v.erp_product_id
                            AND s2.erp_sucursal_id = m.erp_sucursal_id
                            AND coalesce(s2.conteo_2, s2.conteo_1) IS NOT NULL
                          ORDER BY coalesce(s2.contado_2_at, s2.contado_1_at) DESC
                          LIMIT 1) u
                  CROSS JOIN LATERAL jsonb_array_elements(u.conteo) x
                  WHERE coalesce((x->>'cantidad')::int, 0) > 0
                    AND (v.lote IS NULL OR NOT coalesce(p.regulado, false)
                         OR upper(trim(x->>'lote')) = upper(v.lote))),
               'solicitud', (SELECT json_build_object('id', ar.id, 'status', ar.status,
                                    'aplicada', ar.metadata ? 'erp_aplicado', 'at', ar.created_at,
                                    'vence', ar.metadata->'items'->0->>'vence')
                               FROM public.approval_requests ar
                              WHERE ar.type = CASE v.sentido WHEN 'crece' THEN 'INVENTORY_LOAD_REQUEST'
                                                             ELSE 'INVENTORY_DISCARD_REQUEST' END
                                AND ar.metadata->'correccion_de_factor'->>'cambio_id' = v.cambio_id::text
                                AND (ar.metadata->>'erp_sucursal_id')::int = m.erp_sucursal_id
                                -- H28: la corrección es de UN lote.
                                AND nullif(btrim(coalesce(ar.metadata->'correccion_de_factor'->>'lote',
                                                          ar.metadata->'items'->0->>'lote', '')), '')
                                    IS NOT DISTINCT FROM v.lote
                                AND ar.status IN ('PENDING', 'APPROVED')
                              ORDER BY ar.created_at DESC LIMIT 1))
             ORDER BY p.nombre, m.erp_sucursal_id, v.lote), '[]'::json)
        FROM vigente v
        JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = v.suc
        JOIN public.products p ON p.id = v.erp_product_id),

    'sospechosos', (
      SELECT coalesce(json_agg(to_json(f) ORDER BY f.nombre, f.tipo), '[]'::json)
        FROM public.factores_sospechosos() f)
  );
END;
$function$;

-- Completa la fecha de vencimiento de una corrección de factor que quedó
-- pendiente porque la caja la rechazó sin ella. Sólo eso: no toca cantidades,
-- presentación ni sala, y sólo en una solicitud PENDIENTE de corrección.
CREATE OR REPLACE FUNCTION public.correccion_de_factor_poner_vence(p_id uuid, p_vence date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_meta jsonb;
BEGIN
  IF NOT public.auth_has_module_permission('requests_inventario', 'can_approve') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF p_vence IS NULL THEN RAISE EXCEPTION 'FALTA_VENCE'; END IF;

  SELECT metadata INTO v_meta FROM public.approval_requests
   WHERE id = p_id AND status = 'PENDING'
     AND type IN ('INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST')
     AND metadata ? 'correccion_de_factor'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ENCONTRADA'; END IF;

  UPDATE public.approval_requests
     SET metadata = jsonb_set(v_meta, '{items}', (
           SELECT coalesce(jsonb_agg(it || jsonb_build_object('vence', p_vence::text) ORDER BY o), '[]'::jsonb)
             FROM jsonb_array_elements(v_meta->'items') WITH ORDINALITY AS t(it, o))),
         updated_at = now()
   WHERE id = p_id;
END $function$;

REVOKE EXECUTE ON FUNCTION public.correccion_de_factor_poner_vence(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correccion_de_factor_poner_vence(uuid, date) TO authenticated, service_role;
