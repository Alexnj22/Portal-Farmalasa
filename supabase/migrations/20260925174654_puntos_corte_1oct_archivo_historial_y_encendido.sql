SET lock_timeout = '5s';

-- ═══ 1 · La fecha de arranque ═══════════════════════════════════════════════
-- El motor mira los últimos 3 días. El día del corte eso incluye ventas del
-- 28–30 de septiembre que el sistema anterior ya acreditó (y que, si el cliente
-- las presentó, vienen dentro del historial migrado) y canjes que allá ya se
-- descontaron. Sin un piso, el primer día acredita dos veces y descuenta dos
-- veces. El piso vive en la FILA de configuración, no en el código: moverlo es
-- un UPDATE, nunca un despliegue.
ALTER TABLE public.puntos_config ADD COLUMN IF NOT EXISTS inicio date;
COMMENT ON COLUMN public.puntos_config.inicio IS
  'Primer día cuyas ventas y canjes procesa el motor del portal. Lo anterior vive en el historial migrado del sistema de puntos anterior. NULL = sin piso.';

CREATE OR REPLACE FUNCTION public.puntos_desde_efectivo(p_desde date)
RETURNS date LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$ SELECT greatest(p_desde, coalesce((SELECT inicio FROM public.puntos_config WHERE id), p_desde)); $$;
REVOKE EXECUTE ON FUNCTION public.puntos_desde_efectivo(date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_desde_efectivo(date) TO service_role;

CREATE OR REPLACE FUNCTION public.puntos_acumular(p_desde date, p_hasta date, p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 20000, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_leidas integer := 0; v_nuevas integer := 0; v_puntos bigint := 0;
  v_ya integer := 0; v_sin_ficha integer := 0;
  r record; v_lote bigint;
BEGIN
  -- El piso del arranque: lo anterior ya está en el historial migrado.
  p_desde := public.puntos_desde_efectivo(p_desde);
  IF p_desde > p_hasta THEN
    RETURN json_build_object('simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
      'leidas', 0, 'nuevas', 0, 'puntos', 0, 'ya_tenian_lote', 0, 'sin_ficha', 0,
      'tope_alcanzado', false, 'antes_del_inicio', true);
  END IF;

  FOR r IN
    SELECT * FROM json_to_recordset(
      public.ventas_elegibles_puntos(p_desde, p_hasta, p_margen, p_tope)
    ) AS x(invoice_id bigint, sucursal text, erp_invoice_id text, correlativo text,
           customer_id bigint, cod_vendedor int, total numeric, fecha date, puntos int)
  LOOP
    v_leidas := v_leidas + 1;

    -- Sin ficha no hay a quién acreditarle. Medido: 0 de 4,009 en la semana de
    -- prueba, pero una venta sin cliente no puede tumbar la corrida.
    IF r.customer_id IS NULL THEN v_sin_ficha := v_sin_ficha + 1; CONTINUE; END IF;

    -- La exclusión propia del circuito nuevo: la bitácora vieja no se mira. El
    -- índice único sobre invoice_id lo garantiza igual; esto sólo evita el
    -- trabajo y deja el conteo limpio.
    IF EXISTS (SELECT 1 FROM public.puntos_lote WHERE invoice_id = r.invoice_id) THEN
      v_ya := v_ya + 1; CONTINUE;
    END IF;

    v_nuevas := v_nuevas + 1;
    v_puntos := v_puntos + r.puntos;
    CONTINUE WHEN p_simular;

    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.customer_id)
      ON CONFLICT (customer_id) DO NOTHING;

    INSERT INTO public.puntos_lote
      (customer_id, origen, invoice_id, sucursal, puntos, restantes, ganado_el, vence_el)
    VALUES (r.customer_id, 'venta', r.invoice_id, r.sucursal, r.puntos, r.puntos,
            r.fecha, public.puntos_vence_el(r.fecha))
    RETURNING id INTO v_lote;

    UPDATE public.puntos_cuenta
       SET saldo = saldo + r.puntos, ganados = ganados + r.puntos, updated_at = now()
     WHERE customer_id = r.customer_id;
  END LOOP;

  RETURN json_build_object(
    'simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
    'leidas', v_leidas, 'nuevas', v_nuevas, 'puntos', v_puntos,
    'ya_tenian_lote', v_ya, 'sin_ficha', v_sin_ficha,
    'tope_alcanzado', v_leidas >= p_tope
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.puntos_barrer_canjes(p_desde date, p_hasta date, p_simular boolean DEFAULT true, p_tope integer DEFAULT 500)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record; res json;
  v_vistas int := 0; v_registrados int := 0; v_puntos bigint := 0;
  v_sin_saldo int := 0; v_convenio int := 0; v_nada int := 0;
  v_avisos json[] := '{}';
BEGIN
  -- El piso del arranque: un canje anterior ya se descontó en el sistema
  -- anterior y viene en el historial migrado. Registrarlo acá lo cobraría dos
  -- veces.
  p_desde := public.puntos_desde_efectivo(p_desde);

  FOR r IN
    SELECT si.id
      FROM public.sales_invoices si
     WHERE si.fecha BETWEEN p_desde AND p_hasta
       AND si.has_puntos
       AND si.customer_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.puntos_salida s
                        WHERE s.invoice_id = si.id AND s.tipo = 'canje')
     ORDER BY si.fecha, si.id
     LIMIT p_tope
  LOOP
    v_vistas := v_vistas + 1;
    res := public.puntos_registrar_canje(r.id, p_simular);

    IF (res->>'accion') = 'ninguna' THEN v_convenio := v_convenio + 1; CONTINUE; END IF;
    IF NOT coalesce((res->>'ok')::boolean, false) THEN v_nada := v_nada + 1; CONTINUE; END IF;

    v_registrados := v_registrados + 1;
    v_puntos := v_puntos + coalesce((res->>'puntos')::int, 0);

    IF coalesce((res->>'avisar')::boolean, false)
       OR (p_simular AND NOT coalesce((res->>'alcanza')::boolean, true)) THEN
      v_sin_saldo := v_sin_saldo + 1;
      IF v_sin_saldo <= 100 THEN v_avisos := v_avisos || coalesce(res->'aviso', res); END IF;
    END IF;
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
    'vistas', v_vistas, 'registrados', v_registrados, 'puntos', v_puntos,
    'sin_saldo_suficiente', v_sin_saldo, 'de_convenio', v_convenio,
    'sin_efecto', v_nada, 'avisos', to_json(v_avisos),
    'tope_alcanzado', v_vistas >= p_tope);
END;
$function$;

CREATE OR REPLACE FUNCTION public.puntos_barrer_anulaciones(p_desde date, p_hasta date, p_simular boolean DEFAULT true, p_tope integer DEFAULT 500)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record; res json;
  v_vistas int := 0; v_revertidas int := 0; v_puntos bigint := 0; v_no_rec bigint := 0;
BEGIN
  -- Mismo piso que acumular: sólo hay lotes con venta desde el arranque.
  p_desde := public.puntos_desde_efectivo(p_desde);

  FOR r IN
    SELECT l.invoice_id
      FROM public.puntos_lote l
      JOIN public.sales_invoices si ON si.id = l.invoice_id
     WHERE l.invoice_id IS NOT NULL
       AND l.restantes > 0
       AND si.fecha BETWEEN p_desde AND p_hasta
       AND si.estado <> 'FINALIZADA'
     ORDER BY l.invoice_id
     LIMIT p_tope
  LOOP
    v_vistas := v_vistas + 1;
    res := public.puntos_anular_venta(r.invoice_id, p_simular);
    IF coalesce((res->>'se_quitan')::int, (res->>'se_quitaron')::int, 0) > 0 THEN
      v_revertidas := v_revertidas + 1;
      v_puntos := v_puntos + coalesce((res->>'se_quitan')::int, (res->>'se_quitaron')::int, 0);
    END IF;
    v_no_rec := v_no_rec + coalesce((res->>'ya_gastados')::int, (res->>'no_recuperados')::int, 0);
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
    'vistas', v_vistas, 'revertidas', v_revertidas, 'puntos_quitados', v_puntos,
    'no_recuperados', v_no_rec, 'tope_alcanzado', v_vistas >= p_tope);
END;
$function$;

-- ═══ 2 · El archivo del sistema anterior ════════════════════════════════════
-- Copia de sólo lectura de Clientes, Ventas y Canjes. La llena `puntos-archivar`.
-- Es historial de negocio: NO tiene purga (regla 7). Sólo se reemplaza por una
-- carga más nueva y completa.
CREATE TABLE IF NOT EXISTS public.puntos_archivo_carga (
  id              bigserial PRIMARY KEY,
  completa        boolean     NOT NULL DEFAULT false,
  mysql_clientes  integer,
  mysql_ventas    integer,
  mysql_canjes    integer,
  terminada_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.puntos_archivo_carga IS
  'Cada copia del sistema de puntos anterior. Sólo una completa sobrevive; la migración lee la última completa.';

CREATE TABLE IF NOT EXISTS public.puntos_archivo_cliente (
  carga_id    bigint  NOT NULL REFERENCES public.puntos_archivo_carga(id) ON DELETE CASCADE,
  id_cliente  bigint  NOT NULL,
  dui         text,
  puntos      integer NOT NULL DEFAULT 0,
  datos       jsonb   NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (carga_id, id_cliente)
);
CREATE TABLE IF NOT EXISTS public.puntos_archivo_venta (
  carga_id    bigint  NOT NULL REFERENCES public.puntos_archivo_carga(id) ON DELETE CASCADE,
  id_venta    bigint  NOT NULL,
  id_cliente  bigint  NOT NULL,
  fecha       timestamp NOT NULL,
  puntos      integer NOT NULL,
  sucursal    text,
  ticket      text,
  datos       jsonb   NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (carga_id, id_venta)
);
CREATE INDEX IF NOT EXISTS puntos_archivo_venta_cliente ON public.puntos_archivo_venta (carga_id, id_cliente, fecha, id_venta);
CREATE TABLE IF NOT EXISTS public.puntos_archivo_canje (
  carga_id    bigint  NOT NULL REFERENCES public.puntos_archivo_carga(id) ON DELETE CASCADE,
  id_canje    bigint  NOT NULL,
  id_cliente  bigint  NOT NULL,
  fecha       timestamp NOT NULL,
  puntos      integer NOT NULL,
  sucursal    text,
  ticket      text,
  datos       jsonb   NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (carga_id, id_canje)
);
CREATE INDEX IF NOT EXISTS puntos_archivo_canje_cliente ON public.puntos_archivo_canje (carga_id, id_cliente, fecha, id_canje);

ALTER TABLE public.puntos_archivo_carga   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_archivo_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_archivo_venta   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_archivo_canje   ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leer_archivo_carga   ON public.puntos_archivo_carga;
DROP POLICY IF EXISTS leer_archivo_cliente ON public.puntos_archivo_cliente;
DROP POLICY IF EXISTS leer_archivo_venta   ON public.puntos_archivo_venta;
DROP POLICY IF EXISTS leer_archivo_canje   ON public.puntos_archivo_canje;
CREATE POLICY leer_archivo_carga   ON public.puntos_archivo_carga   FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));
CREATE POLICY leer_archivo_cliente ON public.puntos_archivo_cliente FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));
CREATE POLICY leer_archivo_venta   ON public.puntos_archivo_venta   FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));
CREATE POLICY leer_archivo_canje   ON public.puntos_archivo_canje   FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));
REVOKE ALL ON public.puntos_archivo_carga, public.puntos_archivo_cliente,
              public.puntos_archivo_venta, public.puntos_archivo_canje FROM anon;
GRANT SELECT ON public.puntos_archivo_carga, public.puntos_archivo_cliente,
                public.puntos_archivo_venta, public.puntos_archivo_canje TO authenticated;

-- Cierra una carga: cuadra sus conteos contra los de MySQL y, si dan, la marca
-- completa y borra las anteriores. Si no dan, la deja incompleta: la migración
-- nunca la va a leer.
CREATE OR REPLACE FUNCTION public.puntos_archivo_cerrar(p_carga bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v record; n_cli int; n_ven int; n_can int; v_ok boolean;
BEGIN
  SELECT * INTO v FROM public.puntos_archivo_carga WHERE id = p_carga FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'esa carga no existe'); END IF;
  SELECT count(*) INTO n_cli FROM public.puntos_archivo_cliente WHERE carga_id = p_carga;
  SELECT count(*) INTO n_ven FROM public.puntos_archivo_venta   WHERE carga_id = p_carga;
  SELECT count(*) INTO n_can FROM public.puntos_archivo_canje   WHERE carga_id = p_carga;
  v_ok := n_cli = v.mysql_clientes AND n_ven = v.mysql_ventas AND n_can = v.mysql_canjes;
  IF v_ok THEN
    UPDATE public.puntos_archivo_carga SET completa = true, terminada_at = now() WHERE id = p_carga;
    DELETE FROM public.puntos_archivo_carga WHERE id <> p_carga;
  END IF;
  RETURN json_build_object('ok', v_ok, 'carga', p_carga,
    'clientes', json_build_array(n_cli, v.mysql_clientes),
    'ventas',   json_build_array(n_ven, v.mysql_ventas),
    'canjes',   json_build_array(n_can, v.mysql_canjes));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_archivo_cerrar(bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_archivo_cerrar(bigint) TO service_role;

-- ═══ 3 · La migración CON historial ═════════════════════════════════════════
-- Decisión del usuario (2026-09-25): se trae el historial, no sólo el saldo,
-- «para saber cuáles puntos siguen y cuáles no». Cada acumulación del sistema
-- anterior es un lote con su fecha real; cada canje es una salida con su fecha
-- real, que consume los lotes del más viejo al más nuevo (la regla de la
-- cláusula 4). Todo lo ganado antes del 1-oct vence el 1-oct-2027 (régimen de
-- transición): `puntos_vence_el` ya lo resuelve.
--
-- El saldo que manda es `Clientes.Puntos`, porque es el que el cliente ve. Si
-- el historial no lo da exacto, la diferencia entra como AJUSTE con su motivo
-- —nunca en silencio— y se cuenta en el informe.
--
-- No se migra (se informa, y queda en el archivo para resolverlo a mano con
-- `p_solo_cliente`):
--   · DUI vacío o corto
--   · DUI sin ficha en el portal
--   · DUI en VARIAS fichas del portal       — elegir una le pone el saldo a otra persona
--   · DUI en VARIAS cuentas del sistema anterior — ídem, al revés
--
-- Por tandas (`p_despues_de`/`p_limite`): 14,600 cuentas en una sola llamada
-- no entran en el tiempo de una petición.
CREATE OR REPLACE FUNCTION public.puntos_migrar_historial(
  p_simular      boolean DEFAULT true,
  p_despues_de   bigint  DEFAULT 0,
  p_limite       integer DEFAULT 1000,
  p_solo_cliente bigint  DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_carga bigint; c record; m record;
  v_dui text; v_n int; v_cid bigint; v_ganados bigint; v_gastados bigint; v_dif bigint;
  v_salida bigint; v_cons int; v_saldo int; v_ultimo bigint := p_despues_de;
  v_leidas int := 0; v_migradas int := 0; v_ya int := 0; v_dui_corto int := 0;
  v_sin_ficha int := 0; v_varias_fichas int := 0; v_varias_cuentas int := 0;
  v_cuadran int := 0; v_ajustadas int := 0; v_no_cuadra_final int := 0;
  v_puntos bigint := 0; v_lotes int := 0; v_canjes int := 0;
  v_problemas json[] := '{}';
BEGIN
  SELECT id INTO v_carga FROM public.puntos_archivo_carga
   WHERE completa ORDER BY id DESC LIMIT 1;
  IF v_carga IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no hay una copia completa del sistema anterior');
  END IF;

  -- Los dos cruces por DUI se arman UNA vez por llamada. Hacerlos por fila
  -- serían 14,600 × 28,000 expresiones regulares: no hay índice por dígitos.
  DROP TABLE IF EXISTS _fichas_por_dui;
  CREATE TEMP TABLE _fichas_por_dui ON COMMIT DROP AS
    SELECT regexp_replace(dui, '\D', '', 'g') AS d, count(*)::int AS n, min(id) AS id
      FROM public.customers WHERE dui IS NOT NULL GROUP BY 1;
  CREATE INDEX ON _fichas_por_dui (d);
  DROP TABLE IF EXISTS _cuentas_por_dui;
  CREATE TEMP TABLE _cuentas_por_dui ON COMMIT DROP AS
    SELECT regexp_replace(coalesce(dui,''), '\D', '', 'g') AS d, count(*)::int AS n
      FROM public.puntos_archivo_cliente WHERE carga_id = v_carga GROUP BY 1;
  CREATE INDEX ON _cuentas_por_dui (d);

  FOR c IN
    SELECT a.*, regexp_replace(coalesce(a.dui,''), '\D', '', 'g') AS dui_d
      FROM public.puntos_archivo_cliente a
     WHERE a.carga_id = v_carga
       AND (p_solo_cliente IS NULL OR a.id_cliente = p_solo_cliente)
       AND (p_solo_cliente IS NOT NULL OR a.id_cliente > p_despues_de)
       -- Sólo quien tiene algo que traer: saldo o historial.
       AND (a.puntos <> 0
            OR EXISTS (SELECT 1 FROM public.puntos_archivo_venta v WHERE v.carga_id = v_carga AND v.id_cliente = a.id_cliente)
            OR EXISTS (SELECT 1 FROM public.puntos_archivo_canje k WHERE k.carga_id = v_carga AND k.id_cliente = a.id_cliente))
     ORDER BY a.id_cliente
     LIMIT CASE WHEN p_solo_cliente IS NULL THEN p_limite ELSE 1 END
  LOOP
    v_leidas := v_leidas + 1;
    v_ultimo := c.id_cliente;
    v_dui := c.dui_d;

    IF length(v_dui) < 8 THEN
      v_dui_corto := v_dui_corto + 1;
      IF c.puntos > 0 AND coalesce(array_length(v_problemas,1),0) < 200 THEN
        v_problemas := v_problemas || json_build_object('que','sin DUI usable','id_cliente',c.id_cliente,'saldo',c.puntos);
      END IF;
      CONTINUE;
    END IF;

    -- El mismo DUI en dos cuentas del sistema anterior: no se elige.
    IF coalesce((SELECT n FROM _cuentas_por_dui WHERE d = v_dui), 0) > 1 THEN
      v_varias_cuentas := v_varias_cuentas + 1;
      IF coalesce(array_length(v_problemas,1),0) < 200 THEN
        v_problemas := v_problemas || json_build_object('que','DUI en varias cuentas del sistema anterior','id_cliente',c.id_cliente,'dui',v_dui,'saldo',c.puntos);
      END IF;
      CONTINUE;
    END IF;

    SELECT coalesce(max(n), 0), max(id) INTO v_n, v_cid FROM _fichas_por_dui WHERE d = v_dui;

    IF v_n = 0 THEN
      v_sin_ficha := v_sin_ficha + 1;
      IF c.puntos > 0 AND coalesce(array_length(v_problemas,1),0) < 200 THEN
        v_problemas := v_problemas || json_build_object('que','sin ficha en el portal','id_cliente',c.id_cliente,'dui',v_dui,'saldo',c.puntos);
      END IF;
      CONTINUE;
    END IF;
    IF v_n > 1 THEN
      v_varias_fichas := v_varias_fichas + 1;
      IF coalesce(array_length(v_problemas,1),0) < 200 THEN
        v_problemas := v_problemas || json_build_object('que','DUI en varias fichas del portal','id_cliente',c.id_cliente,'dui',v_dui,'fichas',v_n,'saldo',c.puntos);
      END IF;
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.puntos_cuenta WHERE customer_id = v_cid AND migrada_at IS NOT NULL) THEN
      v_ya := v_ya + 1; CONTINUE;
    END IF;

    SELECT coalesce(sum(puntos),0) INTO v_ganados  FROM public.puntos_archivo_venta WHERE carga_id = v_carga AND id_cliente = c.id_cliente AND puntos > 0;
    SELECT coalesce(sum(puntos),0) INTO v_gastados FROM public.puntos_archivo_canje WHERE carga_id = v_carga AND id_cliente = c.id_cliente AND puntos > 0;
    v_dif := c.puntos - (v_ganados - v_gastados);
    IF v_dif = 0 THEN v_cuadran := v_cuadran + 1; ELSE v_ajustadas := v_ajustadas + 1;
      IF coalesce(array_length(v_problemas,1),0) < 200 THEN
        v_problemas := v_problemas || json_build_object('que','el historial no da el saldo: entra un ajuste','id_cliente',c.id_cliente,
          'saldo',c.puntos,'historial',v_ganados - v_gastados,'ajuste',v_dif);
      END IF;
    END IF;

    v_migradas := v_migradas + 1;
    v_puntos := v_puntos + greatest(c.puntos, 0);
    CONTINUE WHEN p_simular;

    INSERT INTO public.puntos_cuenta (customer_id, migrada_at) VALUES (v_cid, now())
      ON CONFLICT (customer_id) DO UPDATE SET migrada_at = now();

    -- Las entradas, con su fecha real.
    FOR m IN SELECT * FROM public.puntos_archivo_venta
              WHERE carga_id = v_carga AND id_cliente = c.id_cliente AND puntos > 0
              ORDER BY fecha, id_venta
    LOOP
      INSERT INTO public.puntos_lote (customer_id, origen, sucursal, puntos, restantes, ganado_el, vence_el, motivo, created_at)
      VALUES (v_cid, 'migracion', m.sucursal, m.puntos, m.puntos, m.fecha::date,
              public.puntos_vence_el(m.fecha::date),
              CASE WHEN coalesce(m.ticket,'') ~ '^[0-9]+$' THEN format('compra · ticket %s', m.ticket)
                   ELSE coalesce(nullif(trim(m.ticket),''), 'compra') END,
              m.fecha);
      v_lotes := v_lotes + 1;
    END LOOP;

    -- El historial dio MENOS que el saldo: la diferencia entra como ajuste.
    IF v_dif > 0 THEN
      INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
      VALUES (v_cid, 'ajuste', v_dif, v_dif, DATE '2026-09-30', public.puntos_vence_el(DATE '2026-09-30'),
              'cuadre con el saldo del sistema anterior');
    END IF;

    -- Las salidas, en orden, consumiendo del más viejo al más nuevo.
    FOR m IN SELECT * FROM public.puntos_archivo_canje
              WHERE carga_id = v_carga AND id_cliente = c.id_cliente AND puntos > 0
              ORDER BY fecha, id_canje
    LOOP
      INSERT INTO public.puntos_salida (customer_id, tipo, puntos, sucursal, motivo, created_at)
      VALUES (v_cid, 'canje', m.puntos, m.sucursal,
              CASE WHEN nullif(trim(coalesce(m.ticket,'')),'') IS NULL THEN 'canje'
                   ELSE format('canje · ticket %s', m.ticket) END,
              m.fecha)
      RETURNING id INTO v_salida;
      v_cons := public.puntos_consumir(v_cid, m.puntos, v_salida);
      IF v_cons = 0 THEN
        DELETE FROM public.puntos_salida WHERE id = v_salida;
      ELSIF v_cons < m.puntos THEN
        UPDATE public.puntos_salida SET puntos = v_cons,
               motivo = motivo || format(' · faltaron %s puntos', m.puntos - v_cons)
         WHERE id = v_salida;
      END IF;
      v_canjes := v_canjes + 1;
    END LOOP;

    -- El historial dio MÁS que el saldo: la diferencia sale como ajuste.
    IF v_dif < 0 THEN
      INSERT INTO public.puntos_salida (customer_id, tipo, puntos, motivo, created_at)
      VALUES (v_cid, 'ajuste', -v_dif, 'cuadre con el saldo del sistema anterior', TIMESTAMP '2026-09-30 23:59:59')
      RETURNING id INTO v_salida;
      v_cons := public.puntos_consumir(v_cid, (-v_dif)::int, v_salida);
      IF v_cons = 0 THEN DELETE FROM public.puntos_salida WHERE id = v_salida;
      ELSIF v_cons < -v_dif THEN UPDATE public.puntos_salida SET puntos = v_cons WHERE id = v_salida; END IF;
    END IF;

    -- La cuenta sale del libro, no de una suma aparte.
    UPDATE public.puntos_cuenta pc
       SET saldo   = coalesce((SELECT sum(restantes) FROM public.puntos_lote   WHERE customer_id = v_cid), 0),
           ganados = coalesce((SELECT sum(puntos)    FROM public.puntos_lote   WHERE customer_id = v_cid), 0),
           usados  = coalesce((SELECT sum(puntos)    FROM public.puntos_salida WHERE customer_id = v_cid), 0),
           updated_at = now()
     WHERE pc.customer_id = v_cid
    RETURNING saldo INTO v_saldo;

    IF v_saldo <> greatest(c.puntos, 0) THEN
      v_no_cuadra_final := v_no_cuadra_final + 1;
      IF coalesce(array_length(v_problemas,1),0) < 200 THEN
        v_problemas := v_problemas || json_build_object('que','NO CUADRA tras migrar','id_cliente',c.id_cliente,'saldo',c.puntos,'quedo',v_saldo);
      END IF;
    END IF;
  END LOOP;

  RETURN json_build_object('ok', true, 'simulado', p_simular, 'carga', v_carga,
    'leidas', v_leidas, 'ultimo_id', v_ultimo, 'hay_mas', v_leidas >= p_limite AND p_solo_cliente IS NULL,
    'migradas', v_migradas, 'puntos', v_puntos, 'lotes', v_lotes, 'canjes', v_canjes,
    'cuadran', v_cuadran, 'con_ajuste', v_ajustadas, 'no_cuadra_final', v_no_cuadra_final,
    'ya_migradas', v_ya, 'dui_corto_o_vacio', v_dui_corto, 'sin_ficha_en_el_portal', v_sin_ficha,
    'dui_en_varias_fichas', v_varias_fichas, 'dui_en_varias_cuentas', v_varias_cuentas,
    'problemas', to_json(v_problemas));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_migrar_historial(boolean,bigint,integer,bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_migrar_historial(boolean,bigint,integer,bigint) TO service_role;

-- ═══ 4 · El estado de cuenta nombra lo migrado ══════════════════════════════
-- Una cortesía de cumpleaños o un ajuste no son una «compra»: el motivo viaja.
CREATE OR REPLACE FUNCTION public.puntos_estado_cuenta(p_customer_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  SELECT json_build_object(
    'customer_id', p_customer_id,
    'saldo',   coalesce((SELECT saldo   FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'ganados', coalesce((SELECT ganados FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'usados',  coalesce((SELECT usados  FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'vencimientos', coalesce((
      SELECT json_agg(to_json(x) ORDER BY x.vence_el)
      FROM (SELECT vence_el, sum(restantes)::int AS puntos
              FROM public.puntos_lote
             WHERE customer_id = p_customer_id AND restantes > 0
             GROUP BY vence_el) x), '[]'::json),
    'movimientos', coalesce((
      SELECT json_agg(to_json(m) ORDER BY m.fecha DESC, m.id DESC)
      FROM (
        SELECT id, CASE WHEN origen = 'ajuste' THEN 'ajuste' ELSE 'compra' END::text AS tipo,
               ganado_el AS fecha, sucursal, puntos,
               CASE WHEN origen = 'venta' THEN NULL ELSE motivo END AS motivo
          FROM public.puntos_lote   WHERE customer_id = p_customer_id
        UNION ALL
        SELECT id, tipo, created_at::date, sucursal, -puntos, motivo
          FROM public.puntos_salida WHERE customer_id = p_customer_id
      ) m), '[]'::json)
  ) INTO v;
  RETURN v;
END;
$function$;

-- ═══ 5 · El arranque ════════════════════════════════════════════════════════
-- Bitácora de cada corrida de `puntos-arranque`, ensayo o real. Historial de
-- negocio: no se purga.
CREATE TABLE IF NOT EXISTS public.puntos_arranque (
  id          bigserial PRIMARY KEY,
  simulado    boolean NOT NULL,
  ok          boolean NOT NULL,
  encendido   boolean NOT NULL DEFAULT false,
  resultado   jsonb   NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.puntos_arranque ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leer_arranque ON public.puntos_arranque;
CREATE POLICY leer_arranque ON public.puntos_arranque FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));
REVOKE ALL ON public.puntos_arranque FROM anon;
GRANT SELECT ON public.puntos_arranque TO authenticated;
GRANT ALL ON public.puntos_arranque, public.puntos_archivo_carga, public.puntos_archivo_cliente,
             public.puntos_archivo_venta, public.puntos_archivo_canje TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.puntos_arranque_id_seq, public.puntos_archivo_carga_id_seq TO service_role;

-- El interruptor, en UN acto: fija el piso, enciende la acumulación, cambia la
-- fuente de las pantallas, apaga los dos crones de la base vieja, crea el del
-- motor y borra los dos de una sola vez del arranque. Todo en la misma
-- transacción: o queda encendido entero, o no cambió nada.
--
-- Los crones se tocan «sólo si existen» (regla de CLAUDE.md): un branch nuevo
-- no los tiene y `cron.unschedule('x')` lanza si `x` no existe.
CREATE OR REPLACE FUNCTION public.puntos_encender(p_inicio date, p_base_url text, p_simular boolean DEFAULT true)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_url text; v_hecho text[] := '{}';
BEGIN
  IF p_simular THEN
    RETURN json_build_object('simulado', true, 'inicio', p_inicio,
      'apagaria', (SELECT coalesce(json_agg(jobname), '[]') FROM cron.job
                    WHERE jobname IN ('sync-puntos-1min','puntos-vencer-mensual') AND active),
      'crearia', 'puntos-motor-1min');
  END IF;

  UPDATE public.puntos_config
     SET inicio = p_inicio, acumulacion_activa = true, fuente = 'portal',
         nota = format('encendido el %s: el libro del portal manda desde el %s', now()::date, p_inicio),
         updated_at = now()
   WHERE id;

  -- La base vieja deja de recibir ventas y de medir vencimientos.
  PERFORM cron.alter_job(jobid, active := false) FROM cron.job
   WHERE jobname IN ('sync-puntos-1min', 'puntos-vencer-mensual') AND active;
  v_hecho := array_append(v_hecho, 'apagados sync-puntos-1min y puntos-vencer-mensual');

  -- El motor, en el horario de las salas (mismo que traía sync-puntos).
  -- La URL la pasa quien llama (su propio SUPABASE_URL): escrita a mano, un
  -- branch de pruebas crearía un cron que le dispara a producción.
  IF p_base_url IS NULL OR p_base_url !~ '^https://[a-z0-9]+\.supabase\.co$' THEN
    RAISE EXCEPTION 'p_base_url inválida: %', p_base_url;
  END IF;
  v_url := p_base_url || '/functions/v1/puntos-motor';
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-motor-1min') THEN
    PERFORM cron.unschedule('puntos-motor-1min');
  END IF;
  PERFORM cron.schedule('puntos-motor-1min', '* 12-23,0-5 * * *', format($c$
    SELECT net.http_post(
      url     := %L,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $c$, v_url));
  v_hecho := array_append(v_hecho, 'creado puntos-motor-1min → ' || v_url);

  -- Los dos de una sola vez ya cumplieron.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-archivar-arranque') THEN
    PERFORM cron.unschedule('puntos-archivar-arranque');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-arranque-1oct') THEN
    PERFORM cron.unschedule('puntos-arranque-1oct');
  END IF;

  RETURN json_build_object('simulado', false, 'inicio', p_inicio, 'hecho', v_hecho);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_encender(date, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_encender(date, text, boolean) TO service_role;
REVOKE EXECUTE ON FUNCTION public.puntos_archivo_cerrar(bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_archivo_cerrar(bigint) TO service_role;

-- ═══ 6 · `puntos_cuadrar` se podía llamar sólo desde la consola ═════════════
-- Vaciaba su tabla temporal con `DELETE FROM _cuadre;` — sin WHERE. Por la API
-- (PostgREST, que es por donde la llaman las funciones del portal) corre
-- `pg_safeupdate`, que rechaza un DELETE sin WHERE: «DELETE requires a WHERE
-- clause». Desde el editor de SQL andaba, y por eso todas las pruebas de
-- septiembre la dieron por buena. La encontró el ensayo del arranque en el
-- entorno de pruebas: el cuadre, que es el freno antes de encender, no corría.
CREATE OR REPLACE FUNCTION public.puntos_cuadrar(p_customer_id bigint DEFAULT NULL::bigint, p_corregir boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json; v_corregidos integer := 0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _cuadre (
    customer_id bigint, saldo_guardado int, saldo_libro int,
    ganados_guardado int, ganados_libro int, usados_guardado int, usados_libro int
  ) ON COMMIT DROP;
  DELETE FROM _cuadre WHERE true;

  INSERT INTO _cuadre
  SELECT c.customer_id, c.saldo, coalesce(l.restantes, 0),
         c.ganados, coalesce(l.puntos, 0),
         c.usados, coalesce(s.puntos, 0)
  FROM public.puntos_cuenta c
  LEFT JOIN (SELECT customer_id, sum(restantes)::int restantes, sum(puntos)::int puntos
               FROM public.puntos_lote GROUP BY 1) l ON l.customer_id = c.customer_id
  LEFT JOIN (SELECT customer_id, sum(puntos)::int puntos
               FROM public.puntos_salida GROUP BY 1) s ON s.customer_id = c.customer_id
  WHERE p_customer_id IS NULL OR c.customer_id = p_customer_id;

  IF p_corregir THEN
    UPDATE public.puntos_cuenta c
       SET saldo = q.saldo_libro, ganados = q.ganados_libro, usados = q.usados_libro,
           updated_at = now()
      FROM _cuadre q
     WHERE q.customer_id = c.customer_id
       AND (c.saldo, c.ganados, c.usados) IS DISTINCT FROM
           (q.saldo_libro, q.ganados_libro, q.usados_libro);
    GET DIAGNOSTICS v_corregidos = ROW_COUNT;
  END IF;

  SELECT json_build_object(
    'cuentas', count(*),
    'descuadradas', count(*) FILTER (WHERE saldo_guardado <> saldo_libro),
    'corregidas', v_corregidos,
    'detalle', coalesce(json_agg(to_json(q)) FILTER (WHERE saldo_guardado <> saldo_libro), '[]'::json)
  ) INTO v FROM _cuadre q;

  RETURN v;
END;
$function$;
