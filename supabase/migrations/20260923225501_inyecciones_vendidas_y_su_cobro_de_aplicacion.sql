SET lock_timeout = '5s';

-- ¿Este renglón de venta es una inyección que se puede aplicar en la sala?
--
-- `products` no tiene la forma farmacéutica (`tipo_medicamento` está vacío en
-- casi todo el catálogo), así que se decide por el NOMBRE. Es una lista, no una
-- verdad: se armó el 2026-09-23 contra todo lo vendido en las seis salas desde
-- agosto, y cada exclusión es un caso real que el patrón agarraba mal —
-- «AMP» está dentro de CAMPOLON y AMPICILINA, y hay ampollas que se TOMAN
-- (bebibles, «BB», jalea, viales de Vitasym, la bebida AMP ENERGY).
-- La insulina queda fuera a propósito: se la aplica la persona en su casa.
CREATE OR REPLACE FUNCTION public.es_inyectable(p_descripcion text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
  SELECT upper(coalesce(p_descripcion, '')) ~ '(\mAMP|\mVIAL|\mINY|\mDEPOT|\mI\.M\.|\mIM\M|\mIV\M|\mX \d+ JERINGAS|GENTAMICINA.*\mML|DICLOFENAC SODICO.*\mML|CEFTRIAXONA|PENICILINA|BENZATIN)'
     AND upper(coalesce(p_descripcion, '')) !~ '(BEBIBLE|\mBB\M|B\.B|AMPICILINA|CAMPOLON ENERGY|AMP ENERGY|INSULIN|INSULEX|SOBRES|SHAMPOO|CAPS|\mTAB|JARABE|SUSP|CREMA|GOTAS|MAXIMUN D3|SARGENOR|JALEA|APETIL|ARGININ|ESPATAL|FOSFONEUROMAX|MULTIVITAMINAS Y HIERRO|CROMATONBIC|VIALES)'
$$;

REVOKE EXECUTE ON FUNCTION public.es_inyectable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_inyectable(text) TO authenticated, service_role;

-- Las ventas con inyección de un período y, para cada una, si se cobró la
-- aplicación.
--
-- El cobro es un movimiento de caja del portal con tipo `APLICACION`
-- («Aplicacion de inyeccion»). No hay nada que los ligue en la base: el
-- movimiento no nombra la factura, y en la mitad de los casos ni el producto.
-- Se emparejan por HORA —medido en Salud 4, 7 al 23-sep: la mediana entre la
-- venta y su cobro es de 42 segundos, y casi siempre lo registra quien vendió—.
--
-- El emparejamiento es UNO A UNO y codicioso por cercanía: se ordenan todos
-- los pares posibles (cobro entre 10 min antes y 45 min después de la venta,
-- mismo día y misma sala) por un puntaje y se toma el mejor par libre. Así una
-- venta no se queda con dos cobros ni un cobro se cuenta dos veces. Puntaje:
-- minutos de distancia, +5 si el cobro lo registró otra persona, −3 si el
-- cobro nombra un producto que está en la venta.
--
-- Lo que no se empareja se devuelve IGUAL, de los dos lados: una venta sin
-- cobro es lo que se está buscando, y un cobro sin venta casi siempre es
-- alguien que trajo su inyección o la compró otro día (un Tri Pack se aplica
-- en tres visitas). Esconder cualquiera de los dos cambiaría la respuesta.
--
-- ANTES del 2026-09-03 las aplicaciones se anotaban directo en la caja, sin
-- hora propia: no están en `caja_movimientos_portal` y esas ventas saldrían
-- «sin cobro» sin serlo. La pantalla lo avisa.
--
-- INVOKER: el RLS de ventas y de movimientos decide qué sala ve cada quien.
-- `plpgsql` + `force_custom_plan` porque el plan bueno depende del rango y la
-- sala (CLAUDE.md, trampas de planificación 1 y 4). RETURNS json: no cae bajo
-- el techo de 1000 filas.
CREATE OR REPLACE FUNCTION public.get_inyecciones_aplicadas(
  p_branch_id integer,
  p_desde date,
  p_hasta date
)
RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_ids     bigint[];
  v_ventas  bigint[] := '{}';
  v_cobros  bigint[] := '{}';
  r         record;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Rango de fechas inválido';
  END IF;
  IF p_hasta - p_desde > 92 THEN
    RAISE EXCEPTION 'El rango no puede pasar de tres meses';
  END IF;

  -- La pasada cara —leer cada renglón del período para mirarle el nombre— se
  -- hace UNA vez. Lo que sigue entra por la llave primaria.
  v_ids := ARRAY(
    SELECT DISTINCT si.id
    FROM sales_invoices si
    JOIN sales_invoice_items ii ON ii.invoice_id = si.id
    WHERE si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH', 'ANULADA')
      AND si.hora IS NOT NULL
      AND es_inyectable(ii.descripcion)
  );

  FOR r IN
    WITH ventas AS (
      SELECT si.id, si.branch_id, si.fecha, si.fecha + si.hora AS ts, si.cod_vendedor,
             string_agg(upper(ii.descripcion), ' ') AS productos
      FROM sales_invoices si
      JOIN sales_invoice_items ii ON ii.invoice_id = si.id
      WHERE si.id = ANY (v_ids)
        AND es_inyectable(ii.descripcion)
      GROUP BY si.id
    ), cobros AS (
      SELECT p.id, p.branch_id, p.fecha,
             (p.registrado_at AT TIME ZONE 'America/El_Salvador') AS ts,
             e.code,
             upper(nullif(trim(split_part(p.concepto, '·', 2)), '')) AS producto
      FROM caja_movimientos_portal p
      LEFT JOIN employees e ON e.id = p.registrado_por
      WHERE p.tipo_codigo = 'APLICACION'
        AND p.anulado_at IS NULL
        AND p.fecha BETWEEN p_desde AND p_hasta
        AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    )
    SELECT v.id AS venta_id, c.id AS cobro_id,
           abs(extract(epoch FROM c.ts - v.ts)) / 60
           + CASE WHEN c.code IS NOT DISTINCT FROM v.cod_vendedor THEN 0 ELSE 5 END
           - CASE WHEN c.producto IS NOT NULL
                   AND strpos(v.productos, split_part(c.producto, ' ', 1)) > 0
                  THEN 3 ELSE 0 END AS puntaje
    FROM ventas v
    JOIN cobros c ON c.branch_id = v.branch_id AND c.fecha = v.fecha
     AND c.ts BETWEEN v.ts - interval '10 minutes' AND v.ts + interval '45 minutes'
    ORDER BY 3, 1, 2
  LOOP
    IF NOT (r.venta_id = ANY (v_ventas)) AND NOT (r.cobro_id = ANY (v_cobros)) THEN
      v_ventas := v_ventas || r.venta_id;
      v_cobros := v_cobros || r.cobro_id;
    END IF;
  END LOOP;

  RETURN (
    WITH pares AS (
      SELECT * FROM unnest(v_ventas, v_cobros) AS t(venta_id, cobro_id)
    ), cobros AS (
      SELECT p.id, p.branch_id, p.fecha,
             to_char(p.registrado_at AT TIME ZONE 'America/El_Salvador', 'HH24:MI') AS hora,
             p.monto, p.concepto, p.registrado_por, e.name AS registrado_nombre,
             pa.venta_id
      FROM caja_movimientos_portal p
      LEFT JOIN employees e ON e.id = p.registrado_por
      LEFT JOIN pares pa ON pa.cobro_id = p.id
      WHERE p.tipo_codigo = 'APLICACION'
        AND p.anulado_at IS NULL
        AND p.fecha BETWEEN p_desde AND p_hasta
        AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    ), ventas AS (
      SELECT si.id, si.branch_id, si.fecha, to_char(si.hora, 'HH24:MI') AS hora,
             si.correlativo, si.cliente, si.cod_vendedor, ev.id AS vendedor_id, ev.name AS vendedor_nombre,
             json_agg(json_build_object('descripcion', ii.descripcion,
                                        'cantidad', ii.cantidad,
                                        'total', ii.total_linea) ORDER BY ii.linea_num) AS productos,
             sum(ii.cantidad) AS unidades,
             sum(ii.total_linea) AS total,
             pa.cobro_id
      FROM sales_invoices si
      JOIN sales_invoice_items ii ON ii.invoice_id = si.id
      LEFT JOIN employees ev ON ev.code = si.cod_vendedor
      LEFT JOIN pares pa ON pa.venta_id = si.id
      WHERE si.id = ANY (v_ids)
        AND es_inyectable(ii.descripcion)
      GROUP BY si.id, ev.id, ev.name, pa.cobro_id
    )
    SELECT json_build_object(
      'ventas', coalesce((
        SELECT json_agg(json_build_object(
                 'id', v.id, 'branch_id', v.branch_id, 'fecha', v.fecha, 'hora', v.hora,
                 'correlativo', v.correlativo, 'cliente', v.cliente,
                 'cod_vendedor', v.cod_vendedor, 'vendedor_id', v.vendedor_id,
                 'vendedor_nombre', v.vendedor_nombre,
                 'productos', v.productos, 'unidades', v.unidades, 'total', v.total,
                 'cobro', CASE WHEN c.id IS NULL THEN NULL ELSE json_build_object(
                   'id', c.id, 'hora', c.hora, 'monto', c.monto, 'concepto', c.concepto,
                   'registrado_por', c.registrado_por, 'registrado_nombre', c.registrado_nombre) END
               ) ORDER BY v.fecha DESC, v.hora DESC)
        FROM ventas v LEFT JOIN cobros c ON c.id = v.cobro_id
      ), '[]'::json),
      'cobros_sin_venta', coalesce((
        SELECT json_agg(json_build_object(
                 'id', c.id, 'branch_id', c.branch_id, 'fecha', c.fecha, 'hora', c.hora,
                 'monto', c.monto, 'concepto', c.concepto,
                 'registrado_por', c.registrado_por, 'registrado_nombre', c.registrado_nombre
               ) ORDER BY c.fecha DESC, c.hora DESC)
        FROM cobros c WHERE c.venta_id IS NULL
      ), '[]'::json)
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_inyecciones_aplicadas(integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inyecciones_aplicadas(integer, date, date) TO authenticated, service_role;

-- La pestaña «Inyecciones» de Ventas. Es una pregunta de supervisión —a quién
-- se le cobró la aplicación y a quién no—, así que la jefatura de sala NO la ve
-- (decisión del usuario, 2026-09-23): nombra a su propio equipo.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, scope)
SELECT r.id, 'ventas_tab_inyecciones',
       r.name IN ('Administrador', 'Gerente General', 'Jefe/a de Talento Humano',
                  'Supervisor/a de Ventas', 'QA / Testing (CI)'),
       false, 'ALL'
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id = r.id AND rp.module_key = 'ventas_tab_inyecciones');
