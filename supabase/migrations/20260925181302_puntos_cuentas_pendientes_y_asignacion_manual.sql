SET lock_timeout = '5s';

-- ═══ Las cuentas del sistema anterior que no pasan solas ═════════════════════
-- Decisión del usuario (2026-09-25), sobre las 709 cuentas con saldo que la
-- migración no puede ligar por DUI:
--   «si son inválidos significa que están mal, así que déjalos así. si no hay
--    match, déjalos aparte en algún lado, por si un cliente reclama, los
--    asignamos manualmente después».
-- O sea: NADA se une solo por teléfono ni por nombre, y el DUI de la base
-- vieja nunca se escribe en la ficha (280 de 621 no pasan el verificador, y el
-- DUI de la ficha viaja a los DTE).
--
-- Tres piezas:
--   · el archivo anota a qué ficha se asignó cada cuenta, cuándo y cómo;
--   · `puntos_cuentas_pendientes` — las que quedaron afuera, con su motivo;
--   · `puntos_asignar_cuenta_anterior` — pasarla a mano cuando alguien reclame.
-- La migración automática y la manual usan la MISMA función por cuenta
-- (`puntos_migrar_cuenta_anterior`): dos copias de la misma regla divergen.

ALTER TABLE public.puntos_archivo_cliente
  ADD COLUMN IF NOT EXISTS asignada_a    bigint,
  ADD COLUMN IF NOT EXISTS asignada_at   timestamptz,
  ADD COLUMN IF NOT EXISTS asignada_como text CHECK (asignada_como IN ('dui', 'manual')),
  ADD COLUMN IF NOT EXISTS asignada_por  uuid,
  ADD COLUMN IF NOT EXISTS asignada_nota text;
-- Sin FK a `customers` a propósito: es un rastro de auditoría, y una FK
-- impediría fusionar una ficha duplicada que alguna vez recibió una cuenta.
COMMENT ON COLUMN public.puntos_archivo_cliente.asignada_a IS
  'customers.id que recibió el historial de esta cuenta. NULL = pendiente (ver puntos_cuentas_pendientes).';
CREATE INDEX IF NOT EXISTS puntos_archivo_cliente_asignada ON public.puntos_archivo_cliente (asignada_a)
  WHERE asignada_a IS NOT NULL;

-- DUI estricto: 9 dígitos, verificador bueno y no todo ceros. `es_dui_valido`
-- da por bueno lo que no tiene 9 dígitos (sirve también para pasaportes), así
-- que para decidir «este DUI está mal escrito» no alcanza.
CREATE OR REPLACE FUNCTION public.puntos_dui_estricto(p_dui text)
RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT length(d) = 9 AND d !~ '^0+$' AND public.es_dui_valido(d)
    FROM (SELECT regexp_replace(coalesce(p_dui, ''), '\D', '', 'g') AS d) x;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_dui_estricto(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_dui_estricto(text) TO authenticated, service_role;

-- ── Una cuenta, a una ficha ─────────────────────────────────────────────────
-- Trae su historial: cada compra un lote con su fecha real, cada canje una
-- salida que consume del más viejo al más nuevo. El saldo que manda es el de
-- allá (`Clientes.Puntos`); si el historial no lo da, entra un ajuste con
-- motivo. La cuadratura se mide como DIFERENCIA (saldo después − antes), porque
-- la ficha puede tener ya puntos propios ganados en el portal.
CREATE OR REPLACE FUNCTION public.puntos_migrar_cuenta_anterior(
  p_carga bigint, p_id_cliente bigint, p_customer_id bigint,
  p_como text, p_por uuid DEFAULT NULL, p_nota text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  c record; m record;
  v_ganados bigint; v_gastados bigint; v_dif bigint;
  v_salida bigint; v_cons int; v_antes int; v_despues int;
  v_lotes int := 0; v_canjes int := 0;
BEGIN
  SELECT * INTO c FROM public.puntos_archivo_cliente
   WHERE carga_id = p_carga AND id_cliente = p_id_cliente FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'esa cuenta no está en el archivo'); END IF;
  IF c.asignada_a IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', format('esa cuenta ya se asignó a la ficha %s', c.asignada_a));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RETURN json_build_object('ok', false, 'error', 'esa ficha no existe');
  END IF;

  SELECT coalesce(sum(puntos),0) INTO v_ganados  FROM public.puntos_archivo_venta WHERE carga_id = p_carga AND id_cliente = p_id_cliente AND puntos > 0;
  SELECT coalesce(sum(puntos),0) INTO v_gastados FROM public.puntos_archivo_canje WHERE carga_id = p_carga AND id_cliente = p_id_cliente AND puntos > 0;
  v_dif := c.puntos - (v_ganados - v_gastados);

  INSERT INTO public.puntos_cuenta (customer_id, migrada_at) VALUES (p_customer_id, now())
    ON CONFLICT (customer_id) DO UPDATE SET migrada_at = now();
  SELECT saldo INTO v_antes FROM public.puntos_cuenta WHERE customer_id = p_customer_id;

  FOR m IN SELECT * FROM public.puntos_archivo_venta
            WHERE carga_id = p_carga AND id_cliente = p_id_cliente AND puntos > 0
            ORDER BY fecha, id_venta
  LOOP
    INSERT INTO public.puntos_lote (customer_id, origen, sucursal, puntos, restantes, ganado_el, vence_el, motivo, created_at)
    VALUES (p_customer_id, 'migracion', m.sucursal, m.puntos, m.puntos, m.fecha::date,
            public.puntos_vence_el(m.fecha::date),
            CASE WHEN coalesce(m.ticket,'') ~ '^[0-9]+$' THEN format('compra · ticket %s', m.ticket)
                 ELSE coalesce(nullif(trim(m.ticket),''), 'compra') END,
            m.fecha);
    v_lotes := v_lotes + 1;
  END LOOP;

  IF v_dif > 0 THEN
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (p_customer_id, 'ajuste', v_dif, v_dif, DATE '2026-09-30', public.puntos_vence_el(DATE '2026-09-30'),
            'cuadre con el saldo del sistema anterior');
  END IF;

  FOR m IN SELECT * FROM public.puntos_archivo_canje
            WHERE carga_id = p_carga AND id_cliente = p_id_cliente AND puntos > 0
            ORDER BY fecha, id_canje
  LOOP
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, sucursal, motivo, created_at)
    VALUES (p_customer_id, 'canje', m.puntos, m.sucursal,
            CASE WHEN nullif(trim(coalesce(m.ticket,'')),'') IS NULL THEN 'canje'
                 ELSE format('canje · ticket %s', m.ticket) END,
            m.fecha)
    RETURNING id INTO v_salida;
    v_cons := public.puntos_consumir(p_customer_id, m.puntos, v_salida);
    IF v_cons = 0 THEN
      DELETE FROM public.puntos_salida WHERE id = v_salida;
    ELSIF v_cons < m.puntos THEN
      UPDATE public.puntos_salida SET puntos = v_cons,
             motivo = motivo || format(' · faltaron %s puntos', m.puntos - v_cons)
       WHERE id = v_salida;
    END IF;
    v_canjes := v_canjes + 1;
  END LOOP;

  IF v_dif < 0 THEN
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, motivo, created_at)
    VALUES (p_customer_id, 'ajuste', -v_dif, 'cuadre con el saldo del sistema anterior', TIMESTAMP '2026-09-30 23:59:59')
    RETURNING id INTO v_salida;
    v_cons := public.puntos_consumir(p_customer_id, (-v_dif)::int, v_salida);
    IF v_cons = 0 THEN DELETE FROM public.puntos_salida WHERE id = v_salida;
    ELSIF v_cons < -v_dif THEN UPDATE public.puntos_salida SET puntos = v_cons WHERE id = v_salida; END IF;
  END IF;

  UPDATE public.puntos_cuenta pc
     SET saldo   = coalesce((SELECT sum(restantes) FROM public.puntos_lote   WHERE customer_id = p_customer_id), 0),
         ganados = coalesce((SELECT sum(puntos)    FROM public.puntos_lote   WHERE customer_id = p_customer_id), 0),
         usados  = coalesce((SELECT sum(puntos)    FROM public.puntos_salida WHERE customer_id = p_customer_id), 0),
         updated_at = now()
   WHERE pc.customer_id = p_customer_id
  RETURNING saldo INTO v_despues;

  UPDATE public.puntos_archivo_cliente
     SET asignada_a = p_customer_id, asignada_at = now(), asignada_como = p_como,
         asignada_por = p_por, asignada_nota = p_nota
   WHERE carga_id = p_carga AND id_cliente = p_id_cliente;

  RETURN json_build_object('ok', true, 'customer_id', p_customer_id, 'id_cliente', p_id_cliente,
    'puntos', greatest(c.puntos, 0), 'lotes', v_lotes, 'canjes', v_canjes, 'ajuste', v_dif,
    'saldo_antes', v_antes, 'saldo_despues', v_despues,
    'cuadra', (v_despues - coalesce(v_antes, 0)) = greatest(c.puntos, 0));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_migrar_cuenta_anterior(bigint,bigint,bigint,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_migrar_cuenta_anterior(bigint,bigint,bigint,text,uuid,text) TO service_role;

-- ── La migración automática, ahora sobre la función por cuenta ─────────────
-- Misma clasificación y mismo informe que antes. Lo que cambia: «ya migrada»
-- se lee del ARCHIVO (`asignada_a`), no de la ficha — una ficha puede recibir
-- a mano una segunda cuenta y eso no la vuelve «ya migrada» para la suya.
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
  v_carga bigint; c record; r json;
  v_dui text; v_n int; v_cid bigint; v_ganados bigint; v_gastados bigint; v_dif bigint;
  v_ultimo bigint := p_despues_de;
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

    IF c.asignada_a IS NOT NULL THEN v_ya := v_ya + 1; CONTINUE; END IF;

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

    r := public.puntos_migrar_cuenta_anterior(v_carga, c.id_cliente, v_cid, 'dui');
    IF NOT coalesce((r->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'cuenta %: %', c.id_cliente, r->>'error';
    END IF;
    v_lotes := v_lotes + (r->>'lotes')::int;
    v_canjes := v_canjes + (r->>'canjes')::int;
    IF NOT (r->>'cuadra')::boolean THEN
      v_no_cuadra_final := v_no_cuadra_final + 1;
      IF coalesce(array_length(v_problemas,1),0) < 200 THEN
        v_problemas := v_problemas || json_build_object('que','NO CUADRA tras migrar','id_cliente',c.id_cliente,'saldo',c.puntos,
          'antes',r->'saldo_antes','despues',r->'saldo_despues');
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

-- ── Las pendientes, para cuando alguien reclame ─────────────────────────────
-- Una fila por cuenta con saldo que no se asignó, con el MOTIVO. «DUI mal
-- escrito» va aparte de «sin ficha» porque se resuelven distinto: el primero
-- no se va a arreglar solo nunca; el segundo, si la persona tiene ficha, se
-- encuentra por nombre o teléfono al atenderla.
CREATE OR REPLACE VIEW public.puntos_cuentas_pendientes
WITH (security_invoker = true) AS
WITH carga AS (
  SELECT id FROM public.puntos_archivo_carga WHERE completa ORDER BY id DESC LIMIT 1
),
a AS (
  SELECT ac.*, regexp_replace(coalesce(ac.dui,''), '\D', '', 'g') AS d
    FROM public.puntos_archivo_cliente ac JOIN carga ON carga.id = ac.carga_id
),
por_dui_aca AS (SELECT d, count(*) AS n FROM a GROUP BY d),
por_dui_portal AS (
  SELECT regexp_replace(dui, '\D', '', 'g') AS d, count(*) AS n
    FROM public.customers WHERE dui IS NOT NULL GROUP BY 1
)
SELECT a.id_cliente,
       trim(coalesce(a.datos->>'Nombres','') || ' ' || coalesce(a.datos->>'Apellidos','')) AS nombre,
       a.dui,
       a.datos->>'Telefono' AS telefono,
       a.puntos AS saldo,
       CASE WHEN length(a.d) < 8                    THEN 'sin DUI'
            WHEN pa.n > 1                           THEN 'el mismo DUI está en varias cuentas del sistema anterior'
            WHEN pp.n > 1                           THEN 'el DUI está en varias fichas del portal'
            WHEN NOT public.puntos_dui_estricto(a.d) THEN 'DUI mal escrito en el sistema anterior'
            ELSE 'ninguna ficha del portal tiene ese DUI'
       END AS motivo,
       (SELECT max(v.fecha)::date FROM public.puntos_archivo_venta v
         WHERE v.carga_id = a.carga_id AND v.id_cliente = a.id_cliente) AS ultima_compra
  FROM a
  LEFT JOIN por_dui_aca pa ON pa.d = a.d
  LEFT JOIN por_dui_portal pp ON pp.d = a.d
 WHERE a.asignada_a IS NULL AND a.puntos > 0;
COMMENT ON VIEW public.puntos_cuentas_pendientes IS
  'Cuentas con saldo del sistema de puntos anterior que no se asignaron a una ficha. Se asignan a mano con puntos_asignar_cuenta_anterior cuando el cliente reclama.';
REVOKE ALL ON public.puntos_cuentas_pendientes FROM anon;
GRANT SELECT ON public.puntos_cuentas_pendientes TO authenticated, service_role;

-- ── Asignar a mano ──────────────────────────────────────────────────────────
-- Cuando un cliente reclama: se elige la ficha, se escribe por qué, y la cuenta
-- vieja pasa con todo su historial. `p_nota` es obligatoria: una asignación sin
-- motivo no se puede auditar después. Simula por defecto.
CREATE OR REPLACE FUNCTION public.puntos_asignar_cuenta_anterior(
  p_id_cliente bigint, p_customer_id bigint, p_nota text,
  p_simular boolean DEFAULT true, p_por uuid DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_carga bigint; c record; f record;
BEGIN
  IF nullif(trim(coalesce(p_nota,'')),'') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'falta el motivo de la asignación');
  END IF;
  SELECT id INTO v_carga FROM public.puntos_archivo_carga WHERE completa ORDER BY id DESC LIMIT 1;
  SELECT * INTO c FROM public.puntos_archivo_cliente WHERE carga_id = v_carga AND id_cliente = p_id_cliente;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'esa cuenta no está en el archivo'); END IF;
  SELECT id, name, dui, phone INTO f FROM public.customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'esa ficha no existe'); END IF;

  IF p_simular THEN
    RETURN json_build_object('ok', true, 'simulado', true,
      'cuenta_anterior', json_build_object('id', c.id_cliente,
          'nombre', trim(coalesce(c.datos->>'Nombres','') || ' ' || coalesce(c.datos->>'Apellidos','')),
          'dui', c.dui, 'telefono', c.datos->>'Telefono', 'saldo', c.puntos,
          'ya_asignada_a', c.asignada_a),
      'ficha', json_build_object('id', f.id, 'nombre', f.name, 'dui', f.dui, 'telefono', f.phone));
  END IF;

  RETURN public.puntos_migrar_cuenta_anterior(v_carga, p_id_cliente, p_customer_id, 'manual', p_por, p_nota);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_asignar_cuenta_anterior(bigint,bigint,text,boolean,uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_asignar_cuenta_anterior(bigint,bigint,text,boolean,uuid) TO service_role;
