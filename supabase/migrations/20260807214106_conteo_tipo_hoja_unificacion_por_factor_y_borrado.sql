-- Conteo de inventario: tipo de conteo (en vivo / según la hoja), unificación de
-- presentaciones por factor, y borrado de conteos con permiso de gestión.
--
-- 1. `conteos_inventario.fuente_sistema`
--    Hasta hoy el conteo era SIEMPRE "en vivo": guardar_conteo_item releía la
--    existencia del momento y calificaba la diferencia contra ese número, no
--    contra el que salió impreso en la hoja. Con la sucursal vendiendo eso
--    produce diferencias que no son de anaquel sino de reloj. 'HOJA' compara
--    contra el snapshot (`sistema_inicial`), que es exactamente lo que dice el
--    papel. Los conteos que ya existen quedan en 'VIVO': era su comportamiento.
--
-- 2. `conteo_inventario_items.grupo_key`
--    El ERP tiene el mismo producto con dos nombres de presentación y el mismo
--    factor ("LATA" y "LATA X 400 G", ambas 1x1): son la misma caja del anaquel
--    y salían como dos renglones, uno con la existencia y otro en cero. Se
--    unifican por FACTOR, que es lo que declara cuántas unidades trae el
--    empaque; presentaciones de distinto factor siguen separadas porque son
--    cosas distintas que contar. Medido en Bodega: 3,999 renglones → 3,669.
--
--    La clave del grupo es 'F<factor>' cuando el factor se conoce, y
--    'P:<PRESENTACION>' cuando no — así un renglón sin factor NUNCA se fusiona
--    con otro por ignorancia: se queda solo, como está hoy.
--
--    Los renglones de conteos ANTERIORES se rellenan con la clave de
--    presentación, no con la de factor: nacieron sin unificar y con la clave de
--    factor dos de ellos reclamarían la misma existencia y la contarían dos
--    veces. La relectura en vivo emite las dos granularidades (ver abajo), así
--    que la misma consulta sirve para los viejos y los nuevos.
--
-- 3. `eliminar_conteo_inventario`
--    Quien tiene «Gestionar» (can_edit) en el módulo puede borrar un conteo,
--    cualquiera sea su estado, dentro de su alcance de sucursal.

SET lock_timeout = '5s';

-- ── 1. Tipo de conteo ───────────────────────────────────────────────────────
ALTER TABLE public.conteos_inventario
  ADD COLUMN IF NOT EXISTS fuente_sistema text;

UPDATE public.conteos_inventario SET fuente_sistema = 'VIVO' WHERE fuente_sistema IS NULL;

ALTER TABLE public.conteos_inventario
  ALTER COLUMN fuente_sistema SET DEFAULT 'HOJA',
  ALTER COLUMN fuente_sistema SET NOT NULL;

ALTER TABLE public.conteos_inventario
  DROP CONSTRAINT IF EXISTS conteos_inventario_fuente_sistema_chk;
ALTER TABLE public.conteos_inventario
  ADD CONSTRAINT conteos_inventario_fuente_sistema_chk
  CHECK (fuente_sistema IN ('VIVO', 'HOJA'));

COMMENT ON COLUMN public.conteos_inventario.fuente_sistema IS
  'VIVO: la existencia se relee al teclear cada renglón. HOJA: se compara contra el snapshot impreso (sistema_inicial).';

-- ── 2. Grupo de presentación por factor ─────────────────────────────────────
ALTER TABLE public.conteo_inventario_items
  ADD COLUMN IF NOT EXISTS grupo_key text;

-- El factor por (producto, nombre de presentación). Se resuelve por
-- `presentaciones.tipo`, que es la clave exacta con la que product_precios
-- guarda la presentación (id_presentacion), y no parseando texto.
--
-- Nota sobre la regla de `detalle` → `product_precios.descripcion`: ésa sirve
-- para convertir cantidades a unidades base. Acá hace falta el factor de UNA
-- presentación concreta, y por id_presentacion es exacto. Medido sobre las
-- 24,155 filas de inventory los dos caminos coinciden en 24,145; de los 10 que
-- discrepan, el de presentación es el correcto (CETRADOL X 10 TABLETAS: "CAJA"
-- es factor 10, y su `detalle` "1X1" daría 1).
CREATE OR REPLACE VIEW public.conteo_presentacion_grupo
WITH (security_invoker = true) AS
SELECT pp.product_id,
       upper(btrim(pr.tipo))          AS pres_key,
       'F' || max(pp.factor)::text    AS grupo_key
FROM public.product_precios pp
JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
WHERE pp.activo AND pp.factor IS NOT NULL
GROUP BY 1, 2;

REVOKE ALL ON public.conteo_presentacion_grupo FROM PUBLIC, anon;
GRANT SELECT ON public.conteo_presentacion_grupo TO authenticated, service_role;

COMMENT ON VIEW public.conteo_presentacion_grupo IS
  'Clave de agrupación de presentaciones por factor. Dos presentaciones del mismo producto con el mismo factor son la misma cosa que contar.';

CREATE OR REPLACE FUNCTION public.conteo_grupo_key(p_product_id integer, p_presentacion text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  -- Sin factor conocido la clave es la presentación misma: un renglón que no se
  -- puede clasificar se queda solo, nunca se fusiona con otro.
  SELECT COALESCE(
    (SELECT g.grupo_key FROM public.conteo_presentacion_grupo g
      WHERE g.product_id = p_product_id
        AND g.pres_key = upper(btrim(COALESCE(p_presentacion, '')))),
    'P:' || upper(btrim(COALESCE(p_presentacion, '')))
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.conteo_grupo_key(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conteo_grupo_key(integer, text) TO authenticated, service_role;

-- Los renglones que ya existen NO se unifican retroactivamente: se los deja con
-- su clave de presentación para que cada uno siga apuntando a su propia
-- existencia. Unificarlos ahora haría que dos renglones ya impresos y repartidos
-- reclamaran el mismo número.
UPDATE public.conteo_inventario_items
SET grupo_key = 'P:' || upper(btrim(COALESCE(presentacion, '')))
WHERE grupo_key IS NULL;

COMMENT ON COLUMN public.conteo_inventario_items.grupo_key IS
  'Clave del grupo de presentaciones que este renglón representa: F<factor>, o P:<PRESENTACION> cuando el factor no se conoce.';

-- ── 3. Snapshot unificado + tipo de conteo ──────────────────────────────────
-- La firma cambia (entra `p_fuente_sistema`), así que la vieja se elimina en vez
-- de quedar como sobrecarga: dos funciones del mismo nombre con parámetros por
-- defecto hacen que una llamada vieja siga entrando por la puerta equivocada.
DROP FUNCTION IF EXISTS public.crear_conteo_inventario(bigint, text, jsonb, integer[], text);

CREATE OR REPLACE FUNCTION public.crear_conteo_inventario(
  p_branch_id bigint,
  p_scope_type text,
  p_scope_filter jsonb DEFAULT NULL::jsonb,
  p_erp_product_ids integer[] DEFAULT NULL::integer[],
  p_modo text DEFAULT 'LOTE'::text,
  p_fuente_sistema text DEFAULT 'HOJA'::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo_id uuid;
  v_erp_sucursal_ids int[];
  v_ciclico_ids int[];
  v_composicion jsonb;
BEGIN
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND p_branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF p_scope_type NOT IN ('TOTAL','LABORATORIO','BAJO_RECETA','MANUAL','CICLICO') THEN
    RAISE EXCEPTION 'ALCANCE_INVALIDO';
  END IF;
  IF p_modo NOT IN ('LOTE','SIMPLE') THEN
    RAISE EXCEPTION 'MODO_INVALIDO';
  END IF;
  IF p_fuente_sistema NOT IN ('VIVO','HOJA') THEN
    RAISE EXCEPTION 'FUENTE_SISTEMA_INVALIDA';
  END IF;

  -- Dos conteos abiertos sobre la misma sucursal se pisan: ambos leen el mismo
  -- stock en vivo y producen diferencias que se contradicen.
  IF EXISTS (SELECT 1 FROM public.conteos_inventario
             WHERE branch_id = p_branch_id AND status IN ('BORRADOR','EN_PROGRESO')) THEN
    RAISE EXCEPTION 'CONTEO_ABIERTO_EN_SUCURSAL';
  END IF;

  SELECT array_agg(erp_sucursal_id) INTO v_erp_sucursal_ids
  FROM public.erp_sucursal_map WHERE branch_id = p_branch_id;

  IF v_erp_sucursal_ids IS NULL THEN
    RAISE EXCEPTION 'SUCURSAL_SIN_MAPEO_ERP';
  END IF;

  -- La muestra se sortea EN EL SERVIDOR: si la eligiera el cliente, elegir qué
  -- se cuenta dejaría de ser un control y pasaría a ser una preferencia.
  IF p_scope_type = 'CICLICO' THEN
    SELECT array_agg(s.erp_product_id),
           jsonb_object_agg(s.segmento, s.n)
    INTO v_ciclico_ids, v_composicion
    FROM (
      SELECT erp_product_id, segmento, count(*) OVER (PARTITION BY segmento) n
      FROM public.seleccionar_muestra_ciclica(p_branch_id, COALESCE((p_scope_filter->>'tamano')::int, 200))
    ) s;

    IF v_ciclico_ids IS NULL THEN RAISE EXCEPTION 'MUESTRA_CICLICA_VACIA'; END IF;

    -- Queda registrado con qué composición se sorteó: un conteo cíclico que no
    -- dice cómo se armó no se puede auditar después.
    p_scope_filter := COALESCE(p_scope_filter, '{}'::jsonb)
      || jsonb_build_object('composicion', v_composicion, 'productos', array_length(v_ciclico_ids, 1));
  END IF;

  -- Siempre incluye TODO el inventario (vencido o no) — el conteo físico debe
  -- reflejar la realidad completa del anaquel/bodega. Lo del área de vencidos
  -- viaja marcado con `is_vencidos` y la hoja lo imprime en su propia tabla.
  INSERT INTO public.conteos_inventario (branch_id, created_by, scope_type, scope_filter, incluye_vencidos, status, modo, fuente_sistema)
  VALUES (p_branch_id, public.auth_employee_id(), p_scope_type, p_scope_filter, true, 'EN_PROGRESO', p_modo, p_fuente_sistema)
  RETURNING id INTO v_conteo_id;

  -- Un solo INSERT para los dos modos: lo único que cambia es si el lote y el
  -- vencimiento entran en la clave del grupo. Antes eran dos ramas casi iguales
  -- y la unificación por factor habría que escribirla dos veces.
  INSERT INTO public.conteo_inventario_items (
    conteo_id, erp_product_id, source_inventory_id, source_sync_key,
    presentacion, detalle, lote, fecha_vencimiento, is_vencidos,
    sistema_cantidad, sistema_inicial, costo_unitario, grupo_key)
  SELECT
    v_conteo_id,
    s.erp_product_id,
    -- La fila de origen solo se conserva cuando el renglón representa UNA:
    -- con el grupo unificado no hay una sola a la que apuntar, y es
    -- `source_sync_key` quien fija contra qué existencia se compara aunque
    -- después se corrija la etiqueta del lote.
    CASE WHEN count(*) = 1 THEN min(s.inv_id) END,
    CASE WHEN count(*) = 1 THEN min(s.sync_key) END,
    -- Gana la presentación con más unidades; si todas están en cero, la
    -- primera alfabéticamente. Es el nombre que quien cuenta ve en el anaquel.
    (array_agg(s.presentacion ORDER BY s.cantidad DESC, s.presentacion))[1],
    (array_agg(s.detalle      ORDER BY s.cantidad DESC, s.presentacion))[1],
    s.g_lote,
    s.g_fecha,
    s.is_vencidos,
    sum(s.cantidad)::int,
    sum(s.cantidad)::int,
    public.conteo_costo_unitario(
      s.erp_product_id,
      (array_agg(s.presentacion ORDER BY s.cantidad DESC, s.presentacion))[1]),
    s.gkey
  FROM (
    SELECT i.id AS inv_id, i.sync_key, i.erp_product_id, i.presentacion, i.detalle,
           i.cantidad, i.is_vencidos,
           CASE WHEN p_modo = 'SIMPLE' THEN NULL ELSE i.lote END AS g_lote,
           CASE WHEN p_modo = 'SIMPLE' THEN NULL ELSE i.fecha_vencimiento END AS g_fecha,
           COALESCE(g.grupo_key, 'P:' || upper(btrim(COALESCE(i.presentacion, '')))) AS gkey
    FROM public.inventory i
    LEFT JOIN public.products p ON p.id = i.erp_product_id
    LEFT JOIN public.conteo_presentacion_grupo g
           ON g.product_id = i.erp_product_id
          AND g.pres_key = upper(btrim(COALESCE(i.presentacion, '')))
    WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
      AND (
        p_scope_type = 'TOTAL'
        OR (p_scope_type = 'LABORATORIO' AND p.laboratorio_id = (p_scope_filter->>'laboratorio_id')::int)
        OR (p_scope_type = 'BAJO_RECETA' AND p.es_antibiotico = true)
        OR (p_scope_type = 'MANUAL' AND i.erp_product_id = ANY(p_erp_product_ids))
        OR (p_scope_type = 'CICLICO' AND i.erp_product_id = ANY(v_ciclico_ids))
      )
  ) s
  GROUP BY s.erp_product_id, s.is_vencidos, s.gkey, s.g_lote, s.g_fecha;

  RETURN v_conteo_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_conteo_inventario(bigint, text, jsonb, integer[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_conteo_inventario(bigint, text, jsonb, integer[], text, text) TO authenticated, service_role;

-- ── 4. Captura: de dónde sale el "sistema" contra el que se compara ─────────
-- Tres caminos, en este orden:
--   HOJA               → el número impreso (`sistema_inicial`). No se mueve.
--   `source_sync_key`  → la fila de origen. Es la que sigue mandando aunque
--                        después se corrija la etiqueta del lote.
--   grupo              → la suma del grupo de presentaciones. Es el camino de
--                        los renglones unificados y de los sencillos.
--
-- El predicado del grupo acepta la clave de factor Y la de presentación porque
-- los renglones de conteos anteriores guardan la segunda: sin las dos, un
-- conteo viejo dejaría de encontrar su existencia y leería 0.
CREATE OR REPLACE FUNCTION public.guardar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text DEFAULT NULL::text, p_estado_item text DEFAULT 'CONTADO'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item public.conteo_inventario_items%ROWTYPE;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_live_sistema int4;
  v_diferencia int4;
  v_evento text;
BEGIN
  SELECT * INTO v_item FROM public.conteo_inventario_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NO_ENCONTRADO'; END IF;

  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id;
  IF v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO') THEN
    RAISE EXCEPTION 'CONTEO_CERRADO_NO_EDITABLE';
  END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF p_estado_item NOT IN ('PENDIENTE','CONTADO','SIN_UBICAR') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO';
  END IF;

  -- Nada cambió: la línea queda EXACTAMENTE como estaba. Devolver lo guardado
  -- --no lo que diga inventory ahora-- es lo que evita que un click de más
  -- convierta una línea cuadrada en un faltante inventado.
  IF v_item.fisico_cantidad IS NOT DISTINCT FROM p_fisico_cantidad
     AND v_item.nota IS NOT DISTINCT FROM p_nota
     AND v_item.estado_item IS NOT DISTINCT FROM p_estado_item THEN
    RETURN jsonb_build_object(
      'sistema_cantidad', v_item.sistema_cantidad,
      'diferencia', v_item.diferencia,
      'evento', 'SIN_CAMBIO'
    );
  END IF;

  IF v_conteo.fuente_sistema = 'HOJA' THEN
    v_live_sistema := COALESCE(v_item.sistema_inicial, v_item.sistema_cantidad);
  ELSIF v_item.es_agregado_manual THEN
    v_live_sistema := v_item.sistema_cantidad;
  ELSIF v_item.source_sync_key IS NOT NULL THEN
    SELECT COALESCE((SELECT cantidad FROM public.inventory WHERE sync_key = v_item.source_sync_key), 0)
    INTO v_live_sistema;
  ELSE
    SELECT COALESCE(sum(i.cantidad), 0)::int INTO v_live_sistema
    FROM public.inventory i
    JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id
    WHERE m.branch_id = v_conteo.branch_id
      AND i.erp_product_id = v_item.erp_product_id
      AND i.is_vencidos = v_item.is_vencidos
      AND v_item.grupo_key IN (
            public.conteo_grupo_key(i.erp_product_id, i.presentacion),
            'P:' || upper(btrim(COALESCE(i.presentacion, ''))))
      AND (v_conteo.modo = 'SIMPLE'
           OR (i.lote IS NOT DISTINCT FROM v_item.lote
               AND i.fecha_vencimiento IS NOT DISTINCT FROM v_item.fecha_vencimiento));
  END IF;

  v_diferencia := CASE WHEN p_fisico_cantidad IS NULL THEN NULL ELSE p_fisico_cantidad - v_live_sistema END;

  v_evento := CASE
    WHEN v_item.fisico_cantidad IS NULL AND p_fisico_cantidad IS NOT NULL THEN 'CAPTURA'
    WHEN v_item.fisico_cantidad IS NOT NULL AND p_fisico_cantidad IS NULL THEN 'BORRADO'
    ELSE 'EDICION'
  END;

  UPDATE public.conteo_inventario_items
  SET fisico_cantidad = p_fisico_cantidad,
      sistema_cantidad = v_live_sistema,
      diferencia = v_diferencia,
      estado_item = p_estado_item,
      nota = p_nota,
      contado_por = public.auth_employee_id(),
      contado_at = now()
  WHERE id = p_item_id;

  INSERT INTO public.conteo_inventario_item_history
    (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
  VALUES (p_item_id, p_fisico_cantidad, v_live_sistema, v_diferencia, p_estado_item, p_nota,
          public.auth_employee_id(), v_evento);

  RETURN jsonb_build_object('sistema_cantidad', v_live_sistema, 'diferencia', v_diferencia, 'evento', v_evento);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recontar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item public.conteo_inventario_items%ROWTYPE;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_actor uuid := public.auth_employee_id();
  v_live_sistema int4;
  v_diferencia int4;
BEGIN
  IF p_fisico_cantidad IS NULL OR p_fisico_cantidad < 0 THEN
    RAISE EXCEPTION 'CANTIDAD_INVALIDA';
  END IF;

  SELECT * INTO v_item FROM public.conteo_inventario_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NO_ENCONTRADO'; END IF;

  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id;

  IF v_conteo.status != 'FINALIZADO' THEN
    RAISE EXCEPTION 'CONTEO_NO_ESTA_EN_REVISION';
  END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_approve') THEN
    RAISE EXCEPTION 'SIN_PERMISO_RECUENTO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF v_actor IS NOT NULL AND v_actor = v_item.contado_por THEN
    RAISE EXCEPTION 'RECUENTO_MISMO_CONTADOR';
  END IF;

  -- Mismo criterio que `guardar_conteo_item`: el recuento no puede comparar
  -- contra otra cosa que el primer conteo, o la revisión mediría dos cosas.
  IF v_conteo.fuente_sistema = 'HOJA' THEN
    v_live_sistema := COALESCE(v_item.sistema_inicial, v_item.sistema_cantidad);
  ELSIF v_item.es_agregado_manual THEN
    v_live_sistema := v_item.sistema_cantidad;
  ELSIF v_item.source_sync_key IS NOT NULL THEN
    SELECT COALESCE((SELECT cantidad FROM public.inventory WHERE sync_key = v_item.source_sync_key), 0)
    INTO v_live_sistema;
  ELSE
    SELECT COALESCE(sum(i.cantidad), 0)::int INTO v_live_sistema
    FROM public.inventory i
    JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id
    WHERE m.branch_id = v_conteo.branch_id
      AND i.erp_product_id = v_item.erp_product_id
      AND i.is_vencidos = v_item.is_vencidos
      AND v_item.grupo_key IN (
            public.conteo_grupo_key(i.erp_product_id, i.presentacion),
            'P:' || upper(btrim(COALESCE(i.presentacion, ''))))
      AND (v_conteo.modo = 'SIMPLE'
           OR (i.lote IS NOT DISTINCT FROM v_item.lote
               AND i.fecha_vencimiento IS NOT DISTINCT FROM v_item.fecha_vencimiento));
  END IF;

  v_diferencia := p_fisico_cantidad - v_live_sistema;

  UPDATE public.conteo_inventario_items
  SET fisico_primer_conteo = COALESCE(fisico_primer_conteo, fisico_cantidad),
      fisico_cantidad = p_fisico_cantidad,
      sistema_cantidad = v_live_sistema,
      diferencia = v_diferencia,
      estado_item = CASE WHEN p_fisico_cantidad = 0 AND v_live_sistema > 0 THEN 'SIN_UBICAR' ELSE 'CONTADO' END,
      nota = COALESCE(NULLIF(TRIM(p_nota), ''), nota),
      recontado_por = v_actor,
      recontado_at = now()
  WHERE id = p_item_id;

  INSERT INTO public.conteo_inventario_item_history
    (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
  VALUES (p_item_id, p_fisico_cantidad, v_live_sistema, v_diferencia, 'CONTADO',
          COALESCE(NULLIF(TRIM(p_nota), ''), 'Recuento de supervisor'), v_actor, 'RECUENTO');

  PERFORM public.recalcular_totales_conteo(v_item.conteo_id);

  RETURN jsonb_build_object(
    'sistema_cantidad', v_live_sistema,
    'diferencia', v_diferencia,
    'fisico_primer_conteo', COALESCE(v_item.fisico_primer_conteo, v_item.fisico_cantidad)
  );
END;
$function$;

-- ── 5. Alta a mano: el duplicado se mide por GRUPO ──────────────────────────
CREATE OR REPLACE FUNCTION public.agregar_item_conteo(p_conteo_id uuid, p_erp_product_id integer, p_presentacion text, p_lote text, p_fecha_vencimiento date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_pres text := NULLIF(TRIM(p_presentacion), '');
  v_lote text := NULLIF(TRIM(p_lote), '');
  v_fecha date := p_fecha_vencimiento;
  v_gkey text;
  v_id uuid;
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO'; END IF;
  IF v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO') THEN
    RAISE EXCEPTION 'CONTEO_CERRADO_NO_EDITABLE';
  END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  -- En SIMPLE el renglón no tiene lote NI vencimiento por definición: se
  -- descartan en vez de rechazarlos, para que un cliente viejo que todavía los
  -- mande no cree un renglón que la lista no sabría mostrar.
  IF v_conteo.modo = 'SIMPLE' THEN
    v_lote := NULL;
    v_fecha := NULL;
    IF v_pres IS NULL THEN
      RAISE EXCEPTION 'PRESENTACION_REQUERIDA';
    END IF;
  ELSIF v_pres IS NULL OR v_lote IS NULL THEN
    RAISE EXCEPTION 'PRESENTACION_Y_LOTE_REQUERIDOS';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_erp_product_id AND activo = true) THEN
    RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO';
  END IF;

  v_gkey := public.conteo_grupo_key(p_erp_product_id, v_pres);

  -- El duplicado se chequea por (producto, GRUPO de presentación, lote): con el
  -- nombre suelto se podía agregar dos veces la misma caja bajo dos nombres del
  -- catálogo, y el snapshot que ahora los unifica los volvería a separar.
  IF EXISTS (
    SELECT 1 FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id
      AND erp_product_id = p_erp_product_id
      AND COALESCE(grupo_key,'') = COALESCE(v_gkey,'')
      AND COALESCE(lote,'') = COALESCE(v_lote,'')
  ) THEN
    IF v_conteo.modo = 'SIMPLE' THEN
      RAISE EXCEPTION 'PRODUCTO_YA_EN_CONTEO';
    ELSE
      RAISE EXCEPTION 'LINEA_YA_EXISTE';
    END IF;
  END IF;

  -- sistema 0 e is_vencidos false son la definición de "apareció algo que el
  -- libro no tiene": todo lo que se cuente aquí es sobrante. El costo lo pone
  -- el servidor con el mismo criterio que el snapshot (C3).
  INSERT INTO public.conteo_inventario_items (
    conteo_id, erp_product_id, presentacion, lote, fecha_vencimiento, is_vencidos,
    sistema_cantidad, sistema_inicial, costo_unitario, estado_item, es_agregado_manual, grupo_key)
  VALUES (
    p_conteo_id, p_erp_product_id, v_pres, v_lote, v_fecha, false,
    0, 0, public.conteo_costo_unitario(p_erp_product_id, v_pres), 'PENDIENTE', true, v_gkey)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

-- ── 6. Borrar un conteo ─────────────────────────────────────────────────────
-- Quien tiene «Gestionar» en el módulo puede borrarlo, esté como esté, dentro
-- de su alcance de sucursal. Se lleva sus renglones y el historial de cada uno:
-- es un borrado real, no un archivado. Lo que queda es la entrada en la
-- bitácora que escribe el cliente con lo que esta función devuelve.
CREATE OR REPLACE FUNCTION public.eliminar_conteo_inventario(p_conteo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_items int;
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO'; END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  SELECT count(*) INTO v_items FROM public.conteo_inventario_items WHERE conteo_id = p_conteo_id;

  DELETE FROM public.conteo_inventario_item_history h
  USING public.conteo_inventario_items ci
  WHERE h.item_id = ci.id AND ci.conteo_id = p_conteo_id;

  DELETE FROM public.conteo_inventario_items WHERE conteo_id = p_conteo_id;
  DELETE FROM public.conteos_inventario WHERE id = p_conteo_id;

  RETURN jsonb_build_object(
    'branch_id', v_conteo.branch_id,
    'status', v_conteo.status,
    'scope_type', v_conteo.scope_type,
    'modo', v_conteo.modo,
    'created_at', v_conteo.created_at,
    'total_items', v_items,
    'total_diferencias', v_conteo.total_diferencias
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.eliminar_conteo_inventario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eliminar_conteo_inventario(uuid) TO authenticated, service_role;

-- ── 7. Lecturas: mismo criterio que la captura ──────────────────────────────
-- Las tres RPCs de lectura mostraban la existencia EN VIVO del renglón que
-- todavía no se contó. Con un conteo 'HOJA' eso contradecía al papel: la
-- pantalla decía un número y la hoja impresa otro. Ahora cada una respeta
-- `fuente_sistema`, y con 'HOJA' ni siquiera lee inventory (el CTE queda vacío).
--
-- `live_grp` emite DOS granularidades a propósito: la del factor, que es la de
-- los renglones nuevos, y la del nombre de presentación, que es la de los
-- renglones de conteos anteriores. Con una sola, uno de los dos grupos leería 0.

CREATE OR REPLACE FUNCTION public.get_conteo_items_jsonb(p_conteo_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_modo text;
  v_fuente text;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
BEGIN
  SELECT c.branch_id, c.modo, c.fuente_sistema INTO v_branch_id, v_modo, v_fuente
  FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids
  FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  RETURN (
    WITH live_raw AS MATERIALIZED (
      SELECT i.sync_key, i.erp_product_id AS r_pid, i.is_vencidos AS r_venc, i.cantidad::int AS cantidad,
             CASE WHEN v_modo = 'SIMPLE' THEN NULL ELSE i.lote END AS r_lote,
             CASE WHEN v_modo = 'SIMPLE' THEN NULL ELSE i.fecha_vencimiento END AS r_fecha,
             upper(btrim(COALESCE(i.presentacion, ''))) AS r_pres,
             COALESCE(g.grupo_key, 'P:' || upper(btrim(COALESCE(i.presentacion, '')))) AS r_key
      FROM public.inventory i
      LEFT JOIN public.conteo_presentacion_grupo g
             ON g.product_id = i.erp_product_id
            AND g.pres_key = upper(btrim(COALESCE(i.presentacion, '')))
      WHERE v_fuente = 'VIVO' AND i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
    ),
    live_inv AS MATERIALIZED (
      SELECT r.sync_key, r.cantidad AS sistema_live FROM live_raw r WHERE v_modo <> 'SIMPLE'
    ),
    live_grp AS MATERIALIZED (
      SELECT r.r_pid AS g_pid, r.r_venc AS g_venc, r.r_lote AS g_lote, r.r_fecha AS g_fecha,
             r.r_key AS g_key, sum(r.cantidad)::int AS sistema_live
      FROM live_raw r GROUP BY 1, 2, 3, 4, 5
      UNION ALL
      SELECT r.r_pid, r.r_venc, r.r_lote, r.r_fecha, 'P:' || r.r_pres, sum(r.cantidad)::int
      FROM live_raw r WHERE 'P:' || r.r_pres <> r.r_key GROUP BY 1, 2, 3, 4, 5
    )
    SELECT coalesce(json_agg(to_json(t)), '[]'::json)
    FROM (
      SELECT ci.id, ci.erp_product_id, ci.presentacion, ci.detalle, ci.lote, ci.fecha_vencimiento, ci.is_vencidos,
        CASE WHEN NOT v_ver THEN NULL
             WHEN ci.fisico_cantidad IS NULL AND NOT ci.es_agregado_manual THEN
               CASE WHEN v_fuente = 'HOJA'
                    THEN COALESCE(ci.sistema_inicial, ci.sistema_cantidad)
                    ELSE COALESCE(li.sistema_live, lg.sistema_live, 0) END
             ELSE ci.sistema_cantidad
        END AS sistema_cantidad,
        CASE WHEN v_ver THEN ci.sistema_inicial END AS sistema_inicial,
        ci.fisico_cantidad,
        CASE WHEN v_ver THEN ci.diferencia END AS diferencia,
        ci.estado_item, ci.nota,
        CASE WHEN v_ver THEN ci.costo_unitario END AS costo_unitario,
        ci.es_agregado_manual,
        CASE WHEN v_ver THEN ci.fisico_primer_conteo END AS fisico_primer_conteo,
        ci.recontado_at,
        p.nombre AS product_nombre, p.es_antibiotico, p.foto_url, p.codigo_barras, l.nombre AS laboratorio_nombre,
        NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS contado_por_nombre,
        NULLIF(TRIM(split_part(COALESCE(r.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(r.last_names,''), ' ', 1)), '') AS recontado_por_nombre,
        ci.contado_at,
        v_ver AS ver_sistema
      FROM public.conteo_inventario_items ci
      LEFT JOIN public.products p ON p.id = ci.erp_product_id
      LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
      LEFT JOIN public.employees e ON e.id = ci.contado_por
      LEFT JOIN public.employees r ON r.id = ci.recontado_por
      LEFT JOIN live_inv li ON li.sync_key = ci.source_sync_key
      LEFT JOIN live_grp lg ON lg.g_pid = ci.erp_product_id
                           AND lg.g_venc = ci.is_vencidos
                           AND lg.g_key = ci.grupo_key
                           AND lg.g_lote IS NOT DISTINCT FROM ci.lote
                           AND lg.g_fecha IS NOT DISTINCT FROM ci.fecha_vencimiento
      WHERE ci.conteo_id = p_conteo_id
      -- `presentacion` cierra el orden: en sencillo el lote es NULL en todos los
      -- renglones y sin ella dos presentaciones del mismo producto salían en
      -- orden arbitrario, distinto entre la hoja y el reporte.
      ORDER BY l.nombre NULLS LAST, p.nombre, ci.lote, ci.presentacion
    ) t
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_conteo_items_search(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_erp_product_id integer DEFAULT NULL::integer, p_erp_product_ids integer[] DEFAULT NULL::integer[])
RETURNS TABLE(id uuid, erp_product_id integer, presentacion text, detalle text, lote text, fecha_vencimiento date, is_vencidos boolean, sistema_cantidad integer, fisico_cantidad integer, diferencia integer, estado_item text, nota text, costo_unitario numeric, es_agregado_manual boolean, product_nombre text, es_antibiotico boolean, foto_url text, laboratorio_nombre text, contado_por_nombre text, contado_at timestamp with time zone, fisico_primer_conteo integer, recontado_at timestamp with time zone, recontado_por_nombre text, contado_por_photo_url text, recontado_por_photo_url text, ediciones_count integer, ver_sistema boolean)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_modo text;
  v_fuente text;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_filtro text;
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id, c.modo, c.fuente_sistema INTO v_branch_id, v_modo, v_fuente
  FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  v_filtro := CASE WHEN p_filtro IN ('DIFERENCIA', 'SIN_UBICAR') AND NOT v_ver THEN 'TODOS' ELSE p_filtro END;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre,
           NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS e_nombre,
           NULLIF(TRIM(split_part(COALESCE(r.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(r.last_names,''), ' ', 1)), '') AS r_nombre,
           e.photo_url AS e_photo, r.photo_url AS r_photo
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    LEFT JOIN public.employees e ON e.id = ci.contado_por
    LEFT JOIN public.employees r ON r.id = ci.recontado_por
    WHERE ci.conteo_id = p_conteo_id
      AND (p_erp_product_id IS NULL OR ci.erp_product_id = p_erp_product_id)
      AND (p_erp_product_ids IS NULL OR ci.erp_product_id = ANY(p_erp_product_ids))
  ),
  live_raw AS MATERIALIZED (
    SELECT i.sync_key, i.erp_product_id AS r_pid, i.is_vencidos AS r_venc, i.cantidad::int AS cantidad,
           CASE WHEN v_modo = 'SIMPLE' THEN NULL ELSE i.lote END AS r_lote,
           CASE WHEN v_modo = 'SIMPLE' THEN NULL ELSE i.fecha_vencimiento END AS r_fecha,
           upper(btrim(COALESCE(i.presentacion, ''))) AS r_pres,
           COALESCE(g.grupo_key, 'P:' || upper(btrim(COALESCE(i.presentacion, '')))) AS r_key
    FROM public.inventory i
    LEFT JOIN public.conteo_presentacion_grupo g
           ON g.product_id = i.erp_product_id
          AND g.pres_key = upper(btrim(COALESCE(i.presentacion, '')))
    WHERE v_fuente = 'VIVO' AND i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
  ),
  live_inv AS MATERIALIZED (
    SELECT r.sync_key, r.cantidad AS sistema_live FROM live_raw r WHERE v_modo <> 'SIMPLE'
  ),
  live_grp AS MATERIALIZED (
    SELECT r.r_pid AS g_pid, r.r_venc AS g_venc, r.r_lote AS g_lote, r.r_fecha AS g_fecha,
           r.r_key AS g_key, sum(r.cantidad)::int AS sistema_live
    FROM live_raw r GROUP BY 1, 2, 3, 4, 5
    UNION ALL
    SELECT r.r_pid, r.r_venc, r.r_lote, r.r_fecha, 'P:' || r.r_pres, sum(r.cantidad)::int
    FROM live_raw r WHERE 'P:' || r.r_pres <> r.r_key GROUP BY 1, 2, 3, 4, 5
  ),
  filtered AS (
    SELECT b.* FROM base b
    WHERE (v_filtro = 'TODOS' OR v_filtro IS NULL
           OR (v_filtro = 'PENDIENTES' AND b.estado_item = 'PENDIENTE')
           OR (v_filtro = 'DIFERENCIA' AND b.diferencia IS NOT NULL AND b.diferencia != 0)
           OR (v_filtro = 'SIN_UBICAR' AND b.estado_item = 'SIN_UBICAR'))
      AND (v_pats IS NULL OR public.norm_search(
             coalesce(b.p_nombre,'') || ' ' || coalesce(b.lote,'') || ' ' ||
             coalesce(b.l_nombre,'') || ' ' || coalesce(b.presentacion,'')
           ) LIKE ALL (v_pats))
    -- `presentacion` como último desempate: en SIMPLE el lote es NULL en todos
    -- los renglones, y sin él dos presentaciones del mismo producto quedaban en
    -- orden arbitrario — o sea con una página inestable entre llamadas.
    ORDER BY b.l_nombre NULLS LAST, b.p_nombre, b.lote, b.presentacion
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    f.id, f.erp_product_id, f.presentacion, f.detalle, f.lote, f.fecha_vencimiento, f.is_vencidos,
    CASE WHEN NOT v_ver THEN NULL
         WHEN f.fisico_cantidad IS NULL AND NOT f.es_agregado_manual THEN
           CASE WHEN v_fuente = 'HOJA'
                THEN COALESCE(f.sistema_inicial, f.sistema_cantidad)
                ELSE COALESCE(li.sistema_live, lg.sistema_live, 0) END
         ELSE f.sistema_cantidad END,
    f.fisico_cantidad,
    CASE WHEN v_ver THEN f.diferencia END,
    f.estado_item, f.nota,
    CASE WHEN v_ver THEN f.costo_unitario END,
    f.es_agregado_manual,
    f.p_nombre, f.p_es_antibiotico, f.p_foto_url, f.l_nombre,
    f.e_nombre, f.contado_at,
    CASE WHEN v_ver THEN f.fisico_primer_conteo END,
    f.recontado_at, f.r_nombre,
    f.e_photo, f.r_photo,
    (SELECT count(*)::int FROM public.conteo_inventario_item_history h
      WHERE h.item_id = f.id AND h.evento IN ('EDICION', 'BORRADO')),
    v_ver
  FROM filtered f
  LEFT JOIN live_inv li ON li.sync_key = f.source_sync_key
  LEFT JOIN live_grp lg ON lg.g_pid = f.erp_product_id
                       AND lg.g_venc = f.is_vencidos
                       AND lg.g_key = f.grupo_key
                       AND lg.g_lote IS NOT DISTINCT FROM f.lote
                       AND lg.g_fecha IS NOT DISTINCT FROM f.fecha_vencimiento
  ORDER BY f.l_nombre NULLS LAST, f.p_nombre, f.lote, f.presentacion;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_conteo_products_page(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_laboratorio_id integer DEFAULT NULL::integer, p_order_by text DEFAULT NULL::text, p_order_dir text DEFAULT 'asc'::text)
RETURNS TABLE(erp_product_id integer, product_nombre text, laboratorio_nombre text, es_antibiotico boolean, foto_url text, item_count integer, contados_count integer, sistema_total integer, fisico_total integer, diferencia_total integer, con_diferencia_count integer, con_vencidos_count integer, con_proximos_count integer, sin_ubicar_count integer, ver_sistema boolean)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_modo text;
  v_fuente text;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_filtro text;
  v_ob text;
  v_asc boolean := lower(coalesce(p_order_dir, 'asc')) <> 'desc';
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id, c.modo, c.fuente_sistema INTO v_branch_id, v_modo, v_fuente
  FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  v_filtro := CASE WHEN p_filtro IN ('DIFERENCIA', 'SIN_UBICAR') AND NOT v_ver THEN 'TODOS' ELSE p_filtro END;

  -- Lista blanca: cualquier otra cosa cae al orden por defecto. Y en conteo
  -- ciego, ordenar por sistema o por diferencia se ignora — ordenar la lista
  -- por el número que no se muestra lo revela igual, solo más despacio
  -- (es el mismo razonamiento que apaga el filtro "con diferencia").
  v_ob := CASE
            WHEN p_order_by IN ('sistema', 'diferencia') AND NOT v_ver THEN NULL
            WHEN p_order_by IN ('producto', 'laboratorio', 'lotes', 'progreso',
                                'sistema', 'fisico', 'diferencia') THEN p_order_by
            ELSE NULL
          END;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre, COALESCE(p.laboratorio_id, 0) AS p_lab_id
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE ci.conteo_id = p_conteo_id
      AND (p_laboratorio_id IS NULL OR COALESCE(p.laboratorio_id, 0) = p_laboratorio_id)
  ),
  live_raw AS MATERIALIZED (
    SELECT i.sync_key, i.erp_product_id AS r_pid, i.is_vencidos AS r_venc, i.cantidad::int AS cantidad,
           CASE WHEN v_modo = 'SIMPLE' THEN NULL ELSE i.lote END AS r_lote,
           CASE WHEN v_modo = 'SIMPLE' THEN NULL ELSE i.fecha_vencimiento END AS r_fecha,
           upper(btrim(COALESCE(i.presentacion, ''))) AS r_pres,
           COALESCE(g.grupo_key, 'P:' || upper(btrim(COALESCE(i.presentacion, '')))) AS r_key
    FROM public.inventory i
    LEFT JOIN public.conteo_presentacion_grupo g
           ON g.product_id = i.erp_product_id
          AND g.pres_key = upper(btrim(COALESCE(i.presentacion, '')))
    WHERE v_fuente = 'VIVO' AND i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
  ),
  live_inv AS MATERIALIZED (
    SELECT r.sync_key, r.cantidad AS sistema_live FROM live_raw r WHERE v_modo <> 'SIMPLE'
  ),
  live_grp AS MATERIALIZED (
    SELECT r.r_pid AS g_pid, r.r_venc AS g_venc, r.r_lote AS g_lote, r.r_fecha AS g_fecha,
           r.r_key AS g_key, sum(r.cantidad)::int AS sistema_live
    FROM live_raw r GROUP BY 1, 2, 3, 4, 5
    UNION ALL
    SELECT r.r_pid, r.r_venc, r.r_lote, r.r_fecha, 'P:' || r.r_pres, sum(r.cantidad)::int
    FROM live_raw r WHERE 'P:' || r.r_pres <> r.r_key GROUP BY 1, 2, 3, 4, 5
  ),
  matched AS (
    SELECT DISTINCT b.erp_product_id AS m_erp_product_id FROM base b
    WHERE (v_pats IS NULL OR public.norm_search(
             coalesce(b.p_nombre,'') || ' ' || coalesce(b.l_nombre,'') || ' ' ||
             coalesce(b.lote,'') || ' ' || coalesce(b.presentacion,'')
           ) LIKE ALL (v_pats))
  ),
  with_live AS (
    SELECT b.*,
           CASE
             WHEN b.fisico_cantidad IS NULL AND NOT b.es_agregado_manual THEN
               CASE WHEN v_fuente = 'HOJA'
                    THEN COALESCE(b.sistema_inicial, b.sistema_cantidad)
                    ELSE COALESCE(li.sistema_live, lg.sistema_live, 0) END
             ELSE b.sistema_cantidad
           END AS sistema_now
    FROM base b
    LEFT JOIN live_inv li ON li.sync_key = b.source_sync_key
    LEFT JOIN live_grp lg ON lg.g_pid = b.erp_product_id
                         AND lg.g_venc = b.is_vencidos
                         AND lg.g_key = b.grupo_key
                         AND lg.g_lote IS NOT DISTINCT FROM b.lote
                         AND lg.g_fecha IS NOT DISTINCT FROM b.fecha_vencimiento
    WHERE b.erp_product_id IN (SELECT m.m_erp_product_id FROM matched m)
  ),
  per_product AS (
    SELECT
      w.erp_product_id,
      max(w.p_nombre) AS product_nombre,
      max(w.l_nombre) AS laboratorio_nombre,
      bool_or(w.p_es_antibiotico) AS es_antibiotico,
      max(w.p_foto_url) AS foto_url,
      count(*)::int AS item_count,
      count(*) FILTER (WHERE w.estado_item != 'PENDIENTE')::int AS contados_count,
      sum(w.sistema_now)::int AS sistema_total,
      sum(w.fisico_cantidad)::int AS fisico_total,
      sum(w.diferencia)::int AS diferencia_total,
      count(*) FILTER (WHERE w.diferencia IS NOT NULL AND w.diferencia != 0)::int AS con_diferencia_count,
      count(*) FILTER (WHERE w.fecha_vencimiento IS NOT NULL AND w.fecha_vencimiento < CURRENT_DATE)::int AS con_vencidos_count,
      count(*) FILTER (WHERE w.fecha_vencimiento IS NOT NULL AND w.fecha_vencimiento >= CURRENT_DATE AND w.fecha_vencimiento <= CURRENT_DATE + 90)::int AS con_proximos_count,
      count(*) FILTER (WHERE w.estado_item = 'SIN_UBICAR')::int AS sin_ubicar_count
    FROM with_live w
    GROUP BY w.erp_product_id
  ),
  -- Dos claves de orden calculadas —una numérica y una de texto— en vez de SQL
  -- dinámico: la consulta queda estática (se lee, se explica y no admite
  -- inyección ni por descuido), y cada fila solo llena la que corresponde.
  ordenable AS (
    SELECT pp.*,
           CASE v_ob
             WHEN 'lotes'      THEN pp.item_count::numeric
             WHEN 'progreso'   THEN pp.contados_count::numeric / greatest(pp.item_count, 1)
             WHEN 'sistema'    THEN pp.sistema_total::numeric
             WHEN 'fisico'     THEN pp.fisico_total::numeric
             WHEN 'diferencia' THEN pp.diferencia_total::numeric
           END AS ord_num,
           CASE v_ob
             WHEN 'producto'    THEN pp.product_nombre
             WHEN 'laboratorio' THEN pp.laboratorio_nombre
           END AS ord_txt
    FROM per_product pp
  )
  SELECT
    o.erp_product_id, o.product_nombre, o.laboratorio_nombre, o.es_antibiotico, o.foto_url,
    o.item_count, o.contados_count,
    CASE WHEN v_ver THEN o.sistema_total END,
    o.fisico_total,
    CASE WHEN v_ver THEN o.diferencia_total END,
    CASE WHEN v_ver THEN o.con_diferencia_count END,
    o.con_vencidos_count, o.con_proximos_count,
    o.sin_ubicar_count,
    v_ver
  FROM ordenable o
  WHERE (v_filtro = 'TODOS' OR v_filtro IS NULL
         OR (v_filtro = 'PENDIENTES' AND o.contados_count < o.item_count)
         OR (v_filtro = 'DIFERENCIA' AND o.con_diferencia_count > 0)
         OR (v_filtro = 'SIN_UBICAR' AND o.sin_ubicar_count > 0))
  ORDER BY
    CASE WHEN v_asc     THEN o.ord_num END ASC  NULLS LAST,
    CASE WHEN NOT v_asc THEN o.ord_num END DESC NULLS LAST,
    CASE WHEN v_asc     THEN o.ord_txt END ASC  NULLS LAST,
    CASE WHEN NOT v_asc THEN o.ord_txt END DESC NULLS LAST,
    -- Desempate y orden por defecto: laboratorio y después producto, que es el
    -- orden del anaquel y por eso el que sirve para recorrerlo contando.
    o.laboratorio_nombre NULLS LAST, o.product_nombre
  LIMIT p_limit OFFSET p_offset;
END;
$function$;
