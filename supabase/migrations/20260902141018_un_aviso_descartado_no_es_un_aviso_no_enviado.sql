SET lock_timeout = '5s';

-- ── Un aviso descartado no es un aviso que no se mandó ─────────────────────
--
-- El cierre de agosto llegó DOS veces: el 1 a las 10:14 SV y otra vez el 2 a
-- las 08:00. No fue un cron duplicado ni un destinatario nuevo — la marca de
-- «ya avisado» era LA NOTIFICACIÓN MISMA:
--
--     WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE ... ym_cerrado = ...)
--
-- y la campana permite borrar (la X de cada tarjeta, y el bote que las vacía
-- todas: `DELETE /rest/v1/notifications?created_at=lte...`). O sea que la
-- pregunta que se hacía la guarda no era «¿ya se lo mandé?» sino «¿todavía la
-- tiene?». Quien limpió su campana volvió a recibirlo al día siguiente, y como
-- la ventana del aviso va del 1 al 5, iba a repetirse hasta CUATRO veces.
--
-- Medido: 10 personas lo recibieron de nuevo el 2 (8 de sala + 2 de
-- administración), y dos «vaciar todo» quedaron en el log entre las dos
-- corridas. No hay ninguna fila duplicada en la tabla — por eso el defecto es
-- invisible mirando `notifications`: la evidencia se borra con el aviso.
--
-- La marca se muda a una tabla que el destinatario NO puede tocar.

CREATE TABLE IF NOT EXISTS public.avisos_emitidos (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 'TIPO:identificador' — 'METAS_CIERRE_SALA:2026-08', 'TRASLADO_RESPALDO:<id>'
  clave        text NOT NULL,
  -- NULL = el aviso es de un hecho, no de una persona (una sala entera).
  recipient_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avisos_emitidos_unico UNIQUE NULLS NOT DISTINCT (clave, recipient_id)
);

CREATE INDEX IF NOT EXISTS avisos_emitidos_recipient_idx ON public.avisos_emitidos (recipient_id);
CREATE INDEX IF NOT EXISTS avisos_emitidos_created_idx   ON public.avisos_emitidos (created_at);

ALTER TABLE public.avisos_emitidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS avisos_emitidos_select ON public.avisos_emitidos;
CREATE POLICY avisos_emitidos_select ON public.avisos_emitidos
  FOR SELECT TO authenticated
  USING (recipient_id = (SELECT public.auth_employee_id()));

-- Sin policies de escritura: la escriben las funciones DEFINER que emiten el
-- aviso, y nadie más. Si la pudiera borrar el destinatario, volveríamos al bug.
REVOKE ALL    ON public.avisos_emitidos FROM PUBLIC, anon;
GRANT  SELECT ON public.avisos_emitidos TO authenticated;
GRANT  ALL    ON public.avisos_emitidos TO service_role;

COMMENT ON TABLE public.avisos_emitidos IS
  'Marca durable de «este aviso ya se emitió». Existe porque la notificación no puede ser su propia marca: el destinatario la borra y el aviso vuelve a salir (cierre de metas de agosto 2026, repetido a 10 personas el 2-sep). La clave es TIPO:identificador; recipient_id NULL cuando el aviso es de un hecho y no de una persona.';


-- ── El rastro de lo YA emitido, antes de cambiar las guardas ───────────────
-- Lo que todavía está en la campana. Lo que alguien borró no deja rastro; para
-- eso, después se corren las dos funciones una vez con la guarda nueva.
INSERT INTO public.avisos_emitidos (clave, recipient_id)
SELECT DISTINCT n.type || ':' || (n.metadata ->> 'ym_cerrado'), n.recipient_id
  FROM public.notifications n
 WHERE n.type IN ('METAS_CIERRE_SALA', 'METAS_CIERRE_EMPRESA')
   AND n.metadata ->> 'ym_cerrado' IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.avisos_emitidos (clave, recipient_id)
SELECT DISTINCT 'TRASLADO_RESPALDO:' || rid, NULL::uuid
  FROM public.notifications n,
       LATERAL jsonb_array_elements_text(n.metadata -> 'request_ids') rid
 WHERE n.type = 'TRASLADO_RESPALDO'
   AND jsonb_typeof(n.metadata -> 'request_ids') = 'array'
ON CONFLICT DO NOTHING;


-- ── El aviso a la sala ─────────────────────────────────────────────────────
-- Único cambio: la guarda y la marca. El cuerpo del aviso no se toca.
CREATE OR REPLACE FUNCTION public.metas_avisar_cierre_a_salas(p_ym_cerrado text, p_ultimo_intento boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ym_nuevo    text := to_char(((p_ym_cerrado || '-01')::date + interval '1 month')::date, 'YYYY-MM');
  v_dias_mes    integer := EXTRACT(day FROM ((p_ym_cerrado || '-01')::date + interval '1 month -1 day'))::int;
  v_fini        date;
  v_ffin        date;
  v_clave       text;
  v_n           integer;
BEGIN
  IF p_ym_cerrado IS NULL OR p_ym_cerrado !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_ym_cerrado;
  END IF;
  v_fini  := (p_ym_cerrado || '-01')::date;
  v_ffin  := (v_fini + interval '1 month -1 day')::date;
  v_clave := 'METAS_CIERRE_SALA:' || p_ym_cerrado;

  WITH
  cerrado AS (
    SELECT d.branch_id::bigint AS branch_id,
           SUM(d.sum_total - d.sum_no_producto)::numeric AS venta,
           COUNT(*)::int AS dias_dato
    FROM public.sales_daily_stats d
    WHERE to_char(d.date, 'YYYY-MM') = p_ym_cerrado
    GROUP BY 1
  ),
  salas AS (
    SELECT c.branch_id,
           COALESCE(res.venta_total, ROUND(c.venta, 2)) AS venta,
           mv.monto_meta AS meta_cerrada,
           COALESCE(res.pct_cumplimiento,
                    CASE WHEN mv.monto_meta > 0
                         THEN ROUND(c.venta / mv.monto_meta * 100, 1) END) AS pct,
           mn.monto_meta AS meta_nueva
    FROM cerrado c
    JOIN public.erp_sucursal_map em ON em.branch_id = c.branch_id AND NOT em.es_bodega
    LEFT JOIN public.metas_sucursal mv
           ON mv.branch_id = c.branch_id AND mv.year_month = p_ym_cerrado
    LEFT JOIN public.metas_resultado res
           ON res.branch_id = c.branch_id AND res.year_month = p_ym_cerrado
    LEFT JOIN public.metas_sucursal mn
           ON mn.branch_id = c.branch_id AND mn.year_month = v_ym_nuevo
          AND mn.estado = 'oficial'
    WHERE (c.dias_dato = v_dias_mes OR res.year_month IS NOT NULL)
      AND (mn.year_month IS NOT NULL OR p_ultimo_intento)
  ),
  vend AS MATERIALIZED (
    SELECT * FROM public.get_vendedores_resumen(v_fini, v_ffin, NULL)
  ),
  venta_sala AS (
    SELECT branch_id, SUM(total_ventas) AS total FROM vend GROUP BY 1
  ),
  vendedores AS MATERIALIZED (
    SELECT x.*,
           rank()  OVER (PARTITION BY x.branch_id ORDER BY x.parte DESC) AS puesto,
           count(*) OVER (PARTITION BY x.branch_id)                      AS cuantos,
           ROUND(avg(x.parte) OVER (PARTITION BY x.branch_id), 1)        AS promedio
    FROM (
      SELECT v.branch_id, v.cod_vendedor,
             e2.id AS employee_id, e2.name AS nombre,
             e2.first_names, e2.last_names,
             v.total_ventas AS venta,
             ROUND(v.total_ventas / NULLIF(t.total, 0) * 100, 1) AS parte
      FROM vend v
      JOIN venta_sala t ON t.branch_id = v.branch_id
      JOIN public.employees e2
        ON e2.code = v.cod_vendedor AND e2.branch_id = v.branch_id AND e2.status = 'ACTIVO'
    ) x
  ),
  destinatarios AS (
    SELECT e.id AS employee_id, e.code AS mi_codigo,
           s.branch_id, s.venta, s.meta_cerrada, s.pct, s.meta_nueva,
           mio.parte AS mi_parte, mio.puesto AS mi_puesto,
           mio.cuantos AS de, mio.promedio,
           EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.module_key = 'dash_meta_sala_vista_completa'
                      AND rp.can_view
                      AND rp.role_id IN (e.role_id, e.secondary_role_id)) AS ve_montos
    FROM salas s
    JOIN public.employees e ON e.branch_id = s.branch_id AND e.status = 'ACTIVO'
    LEFT JOIN vendedores mio
           ON mio.branch_id = s.branch_id AND mio.cod_vendedor = e.code
    WHERE EXISTS (SELECT 1 FROM public.role_permissions rp
                   WHERE rp.module_key = 'dash_meta_sala'
                     AND rp.can_view
                     AND rp.role_id IN (e.role_id, e.secondary_role_id))
  ),
  ins AS (
    INSERT INTO public.notifications
      (recipient_id, type, title, body, link, metadata, branch_id)
    SELECT d.employee_id,
           'METAS_CIERRE_SALA',
           CASE WHEN d.pct IS NULL
                THEN 'Así cerró ' || public.metas_mes_label(p_ym_cerrado)
                ELSE 'Cerraste ' || public.metas_mes_label(p_ym_cerrado) || ' en ' || d.pct || '%'
           END,
           CASE
             WHEN d.ve_montos AND d.pct IS NOT NULL THEN
               'Vendiste $' || to_char(d.venta, 'FM999,999,990.00')
               || ' de tu meta de $' || to_char(d.meta_cerrada, 'FM999,999,990.00') || '. '
             WHEN d.ve_montos THEN
               'Vendiste $' || to_char(d.venta, 'FM999,999,990.00')
               || '. Ese mes no tuvo meta. '
             ELSE ''
           END
           ||
           CASE
             WHEN d.meta_nueva IS NULL THEN
               'Tu meta de ' || public.metas_mes_label(v_ym_nuevo) || ' todavía se está definiendo.'
             WHEN d.ve_montos THEN
               'Tu meta de ' || public.metas_mes_label(v_ym_nuevo)
               || ' es $' || to_char(d.meta_nueva, 'FM999,999,990.00') || '.'
             ELSE
               'Tu meta de ' || public.metas_mes_label(v_ym_nuevo)
               || ' ya está publicada. Mírala en Inicio.'
           END,
           '/overview',
           jsonb_build_object(
             'ym_cerrado',    p_ym_cerrado,
             'ym_nuevo',      v_ym_nuevo,
             'mes_cerrado',   public.metas_mes_label(p_ym_cerrado),
             'mes_nuevo',     public.metas_mes_label(v_ym_nuevo),
             'pct',           d.pct,
             'mi_parte',      d.mi_parte,
             'puesto',        d.mi_puesto,
             'de',            d.de,
             'promedio',      d.promedio,
             'tabla', (
               SELECT json_agg(json_build_object(
                        'employee_id', x.employee_id,
                        'nombre',      x.nombre,
                        'nombres',     x.first_names,
                        'apellidos',   x.last_names,
                        'parte',       x.parte,
                        'yo',          x.cod_vendedor = d.mi_codigo,
                        'venta',       CASE WHEN d.ve_montos THEN x.venta END)
                      ORDER BY x.parte DESC)
               FROM vendedores x
               WHERE x.branch_id = d.branch_id)
           )
           || CASE WHEN d.ve_montos
                   THEN jsonb_build_object(
                          'venta',      d.venta,
                          'meta',       d.meta_cerrada,
                          'meta_nueva', d.meta_nueva)
                   ELSE '{}'::jsonb
              END,
           d.branch_id::integer
    FROM destinatarios d
    -- Una vez por persona y por mes cerrado. La marca vive fuera de la campana:
    -- borrar el aviso ya no lo vuelve a pedir.
    WHERE NOT EXISTS (
      SELECT 1 FROM public.avisos_emitidos a
       WHERE a.recipient_id = d.employee_id AND a.clave = v_clave
    )
    RETURNING recipient_id
  ),
  marca AS (
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT v_clave, i.recipient_id FROM ins i
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) IS
  'Avisa a cada sala cómo cerró el mes y cuál es su meta nueva. Dos cuerpos: con montos para quien tiene dash_meta_sala_vista_completa, en porcentaje para el resto. Idempotente por (persona, mes cerrado) contra `avisos_emitidos` — NO contra la notificación misma, que el destinatario puede borrar.';


-- ── El aviso a administración ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.metas_avisar_cierre_a_admin(p_ym_cerrado text, p_ultimo_intento boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ym_nuevo   text := to_char(((p_ym_cerrado || '-01')::date + interval '1 month')::date, 'YYYY-MM');
  v_dias_mes   integer := EXTRACT(day FROM ((p_ym_cerrado || '-01')::date + interval '1 month -1 day'))::int;
  v_fini       date;
  v_ffin       date;
  v_clave      text;
  v_n          integer;
BEGIN
  IF p_ym_cerrado IS NULL OR p_ym_cerrado !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_ym_cerrado;
  END IF;
  v_fini  := (p_ym_cerrado || '-01')::date;
  v_ffin  := (v_fini + interval '1 month -1 day')::date;
  v_clave := 'METAS_CIERRE_EMPRESA:' || p_ym_cerrado;

  WITH
  cerrado AS (
    SELECT d.branch_id::bigint AS branch_id,
           SUM(d.sum_total - d.sum_no_producto)::numeric AS venta,
           COUNT(*)::int AS dias_dato
    FROM public.sales_daily_stats d
    WHERE to_char(d.date, 'YYYY-MM') = p_ym_cerrado
    GROUP BY 1
  ),
  salas AS (
    SELECT c.branch_id, b.name AS sala,
           COALESCE(res.venta_total, ROUND(c.venta, 2)) AS venta,
           mv.monto_meta AS meta,
           COALESCE(res.pct_cumplimiento,
                    CASE WHEN mv.monto_meta > 0
                         THEN ROUND(c.venta / mv.monto_meta * 100, 1) END) AS pct
    FROM cerrado c
    JOIN public.erp_sucursal_map em ON em.branch_id = c.branch_id AND NOT em.es_bodega
    JOIN public.branches b ON b.id = c.branch_id
    LEFT JOIN public.metas_sucursal mv
           ON mv.branch_id = c.branch_id AND mv.year_month = p_ym_cerrado
    LEFT JOIN public.metas_resultado res
           ON res.branch_id = c.branch_id AND res.year_month = p_ym_cerrado
    WHERE (c.dias_dato = v_dias_mes OR res.year_month IS NOT NULL)
  ),
  global AS (
    SELECT SUM(venta) AS venta, SUM(meta) AS meta, COUNT(*) AS cuantas,
           CASE WHEN SUM(meta) > 0 THEN ROUND(SUM(venta) / SUM(meta) * 100, 1) END AS pct
    FROM salas
  ),
  vend AS MATERIALIZED (
    SELECT * FROM public.get_vendedores_resumen(v_fini, v_ffin, NULL)
  ),
  top3 AS (
    SELECT json_agg(json_build_object(
             'employee_id', t.id, 'nombre', t.name, 'sala', t.sala, 'venta', t.total_ventas)
           ORDER BY t.total_ventas DESC) AS filas
    FROM (
      SELECT e.id, e.name, b.name AS sala, v.total_ventas
      FROM vend v
      JOIN public.employees e
        ON e.code = v.cod_vendedor AND e.branch_id = v.branch_id AND e.status = 'ACTIVO'
      JOIN public.branches b ON b.id = v.branch_id
      JOIN public.erp_sucursal_map em ON em.branch_id = v.branch_id AND NOT em.es_bodega
      ORDER BY v.total_ventas DESC
      LIMIT 3
    ) t
  ),
  destinatarios AS (
    SELECT e.id AS employee_id
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND COALESCE(e.tipo_ficha, 'empleado') = 'empleado'
      AND EXISTS (SELECT 1 FROM public.role_permissions rp
                   WHERE rp.module_key = 'metas' AND rp.can_view
                     AND rp.role_id IN (e.role_id, e.secondary_role_id))
      AND NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map em
                       WHERE em.branch_id = e.branch_id AND NOT em.es_bodega)
  ),
  ins AS (
    INSERT INTO public.notifications
      (recipient_id, type, title, body, link, metadata)
    SELECT d.employee_id,
           'METAS_CIERRE_EMPRESA',
           -- «La meta» y no «la empresa»: lo que cerró en 96.4% es la meta.
           'La meta de ' || public.metas_mes_label(p_ym_cerrado)
             || ' cerró en ' || (SELECT pct FROM global) || '%',
           'Las ' || (SELECT cuantas FROM global) || ' salas vendieron $'
             || to_char((SELECT venta FROM global), 'FM999,999,990.00')
             || ' de una meta de $' || to_char((SELECT meta FROM global), 'FM999,999,990.00')
             || '. Las metas de ' || public.metas_mes_label(v_ym_nuevo) || ' ya están publicadas.',
           '/metas',
           jsonb_build_object(
             'ym_cerrado',  p_ym_cerrado,
             'ym_nuevo',    v_ym_nuevo,
             'mes_cerrado', public.metas_mes_label(p_ym_cerrado),
             'mes_nuevo',   public.metas_mes_label(v_ym_nuevo),
             'pct',         (SELECT pct   FROM global),
             'venta',       (SELECT venta FROM global),
             'meta',        (SELECT meta  FROM global),
             'sucursales',  (SELECT json_agg(json_build_object('sala', s.sala, 'pct', s.pct)
                                             ORDER BY s.pct DESC NULLS LAST) FROM salas s),
             'top3',        (SELECT filas FROM top3))
    FROM destinatarios d
    WHERE (SELECT pct FROM global) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.avisos_emitidos a
         WHERE a.recipient_id = d.employee_id AND a.clave = v_clave
      )
    RETURNING recipient_id
  ),
  marca AS (
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT v_clave, i.recipient_id FROM ins i
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.metas_avisar_cierre_a_admin(text, boolean) IS
  'El cierre del mes para administración: cumplimiento global de la empresa, cada sucursal con su porcentaje y los tres vendedores con más venta. Va a quien puede ver el módulo metas y NO está en una sala. Idempotente por (persona, mes cerrado) contra `avisos_emitidos` — NO contra la notificación misma, que el destinatario puede borrar.';


-- ── El mismo defecto, latente: el aviso de traslados por respaldo ──────────
-- Su marca también era la notificación (metadata.request_ids). Ahí la guarda
-- es global —basta que UNA persona de la sala la conserve— así que sólo se
-- repetía si la sala entera vaciaba su campana. Menos probable, mismo error.
CREATE OR REPLACE FUNCTION public.avisar_traslados_por_respaldo()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sala   record;
  v_n      integer;
  v_total  integer := 0;
  v_titulo text;
  v_cuerpo text;
BEGIN
  FOR v_sala IN
    WITH sin_avisar AS (
      SELECT ar.id,
             (ar.metadata->>'origen_branch_id')::integer AS origen,
             coalesce(nullif(ar.metadata->>'branch_name', ''), 'otra sala') AS destino,
             coalesce(nullif(ar.metadata->'erp_traslado'->>'by_name', ''), 'La sala de al lado') AS quien,
             ar.updated_at
        FROM public.approval_requests ar
       WHERE ar.type = 'INVENTORY_TRANSFER_REQUEST'
         AND ar.status = 'APPROVED'
         AND (ar.metadata->'erp_traslado'->>'por_respaldo')::boolean IS TRUE
         AND ar.updated_at >= now() - interval '7 days'
         AND NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                          WHERE a.clave = 'TRASLADO_RESPALDO:' || ar.id::text)
    )
    SELECT origen,
           count(*)                                        AS cuantos,
           to_jsonb(array_agg(id)::text[])                 AS ids,
           string_agg(DISTINCT quien, ', ')                AS quienes,
           string_agg(destino, ', ' ORDER BY updated_at)   AS destinos
      FROM sin_avisar
     WHERE origen IS NOT NULL
     GROUP BY origen
  LOOP
    v_titulo := CASE WHEN v_sala.cuantos = 1
                     THEN 'Salio un traslado mientras estaban cerrados'
                     ELSE v_sala.cuantos || ' traslados salieron mientras estaban cerrados' END;
    v_cuerpo := v_sala.quienes
             || CASE WHEN v_sala.cuantos = 1 THEN ' lo despacho' ELSE ' los despacho' END
             || ' por ustedes hacia ' || v_sala.destinos || '. Revisen que la existencia cuadre.';

    v_n := public.notify_branch(
             v_sala.origen, 'TRASLADO_RESPALDO', v_titulo, v_cuerpo, '/traslados',
             jsonb_build_object('request_ids', v_sala.ids), true);

    -- Sólo se marca lo que efectivamente salió: si la sala no tenía a quién
    -- avisarle, mañana se reintenta (como antes).
    IF coalesce(v_n, 0) > 0 THEN
      INSERT INTO public.avisos_emitidos (clave, recipient_id)
      SELECT 'TRASLADO_RESPALDO:' || t, NULL::uuid
        FROM jsonb_array_elements_text(v_sala.ids) t
      ON CONFLICT DO NOTHING;
    END IF;

    v_total := v_total + coalesce(v_n, 0);
  END LOOP;

  RETURN v_total;
END;
$function$;

COMMENT ON FUNCTION public.avisar_traslados_por_respaldo() IS
  'A la manana: le cuenta a la sala que estuvo cerrada que su sala de respaldo despacho traslados por ella. La marca de "ya avisado" vive en `avisos_emitidos` y no en la notificacion, que el destinatario puede borrar; asi tampoco hay que escribir en approval_requests, cuyo updated_at es la hora de salida del traslado.';


-- ── Retención ──────────────────────────────────────────────────────────────
-- La marca tiene que sobrevivir a la notificación (la campana se purga a los
-- 90 días), pero no para siempre: un año cubre cualquier ventana de reintento.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'purge-notifications-daily'),
  command => $cmd$
  DELETE FROM public.notifications   WHERE created_at < now() - interval '90 days';
  DELETE FROM public.avisos_emitidos WHERE created_at < now() - interval '400 days';
$cmd$);
