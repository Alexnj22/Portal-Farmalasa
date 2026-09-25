SET lock_timeout = '5s';

-- ═══ Migrar YA y el 1-oct sólo actualizar ═══════════════════════════════════
-- Decisión del usuario (2026-09-25): «¿si migramos ya? y el 1 solo
-- actualizamos?». Hasta hoy la migración era de UNA vez: si una cuenta ya
-- estaba en el libro, se saltaba. Para migrar ahora y traer lo nuevo cada
-- noche hasta el corte, cada movimiento del sistema anterior tiene que poder
-- reconocerse en el libro. Por eso:
--
--   · `puntos_lote.ref_anterior`    = Ventas.idVenta   (única)
--   · `puntos_salida.ref_anterior`  = Canjes.idCanje   (única)
--   · `cuenta_anterior` en los dos  = Clientes.idCliente de donde vino
--
-- Una sincronización inserta SÓLO lo que no está (por su número de origen) y
-- cuadra la CUENTA VIEJA, no la ficha: lo que vino de esa cuenta —compras menos
-- canjes más ajustes— tiene que dar su `Clientes.Puntos`. Si no da, entra la
-- diferencia como ajuste con motivo. Se mide por cuenta porque una ficha puede
-- recibir dos cuentas viejas (el mismo cliente con dos cuentas allá).
--
-- Mientras tanto el motor sigue APAGADO: el libro es un espejo del sistema
-- anterior hasta el arranque, y lo único que lo escribe es esta sincronización.

ALTER TABLE public.puntos_lote   ADD COLUMN IF NOT EXISTS ref_anterior bigint, ADD COLUMN IF NOT EXISTS cuenta_anterior bigint;
ALTER TABLE public.puntos_salida ADD COLUMN IF NOT EXISTS ref_anterior bigint, ADD COLUMN IF NOT EXISTS cuenta_anterior bigint;
CREATE UNIQUE INDEX IF NOT EXISTS puntos_lote_una_por_venta_anterior
  ON public.puntos_lote (ref_anterior) WHERE ref_anterior IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS puntos_salida_una_por_canje_anterior
  ON public.puntos_salida (ref_anterior) WHERE ref_anterior IS NOT NULL;
CREATE INDEX IF NOT EXISTS puntos_lote_cuenta_anterior
  ON public.puntos_lote (cuenta_anterior) WHERE cuenta_anterior IS NOT NULL;
CREATE INDEX IF NOT EXISTS puntos_salida_cuenta_anterior
  ON public.puntos_salida (cuenta_anterior) WHERE cuenta_anterior IS NOT NULL;
COMMENT ON COLUMN public.puntos_lote.ref_anterior IS
  'Ventas.idVenta del sistema de puntos anterior. Única: una compra vieja entra una sola vez al libro.';
COMMENT ON COLUMN public.puntos_salida.ref_anterior IS
  'Canjes.idCanje del sistema de puntos anterior. Única: un canje viejo sale una sola vez del libro.';

-- ── Una carga nueva hereda las asignaciones de la anterior ─────────────────
-- Antes se perdían: la copia nueva reemplazaba a la vieja y con ella se iba
-- `asignada_a`. Con copias cada noche eso era perder cada asignación a mano.
CREATE OR REPLACE FUNCTION public.puntos_archivo_cerrar(p_carga bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v record; n_cli int; n_ven int; n_can int; v_ok boolean; v_heredadas int := 0;
BEGIN
  SELECT * INTO v FROM public.puntos_archivo_carga WHERE id = p_carga FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'esa carga no existe'); END IF;
  SELECT count(*) INTO n_cli FROM public.puntos_archivo_cliente WHERE carga_id = p_carga;
  SELECT count(*) INTO n_ven FROM public.puntos_archivo_venta   WHERE carga_id = p_carga;
  SELECT count(*) INTO n_can FROM public.puntos_archivo_canje   WHERE carga_id = p_carga;
  v_ok := n_cli = v.mysql_clientes AND n_ven = v.mysql_ventas AND n_can = v.mysql_canjes;
  IF v_ok THEN
    UPDATE public.puntos_archivo_cliente n
       SET asignada_a = o.asignada_a, asignada_at = o.asignada_at, asignada_como = o.asignada_como,
           asignada_por = o.asignada_por, asignada_nota = o.asignada_nota
      FROM public.puntos_archivo_cliente o
     WHERE n.carga_id = p_carga AND o.carga_id <> p_carga
       AND o.id_cliente = n.id_cliente AND o.asignada_a IS NOT NULL AND n.asignada_a IS NULL;
    GET DIAGNOSTICS v_heredadas = ROW_COUNT;
    UPDATE public.puntos_archivo_carga SET completa = true, terminada_at = now() WHERE id = p_carga;
    DELETE FROM public.puntos_archivo_carga WHERE id <> p_carga;
  END IF;
  RETURN json_build_object('ok', v_ok, 'carga', p_carga, 'asignaciones_heredadas', v_heredadas,
    'clientes', json_build_array(n_cli, v.mysql_clientes),
    'ventas',   json_build_array(n_ven, v.mysql_ventas),
    'canjes',   json_build_array(n_can, v.mysql_canjes));
END;
$$;

-- ── Una cuenta vieja, sincronizada con una ficha ───────────────────────────
-- La primera vez la ASIGNA (y queda el rastro de cómo); las siguientes sólo
-- trae lo nuevo. Idempotente: correrla dos veces seguidas no escribe nada.
DROP FUNCTION IF EXISTS public.puntos_migrar_cuenta_anterior(bigint, bigint, bigint, text, uuid, text);
CREATE OR REPLACE FUNCTION public.puntos_sincronizar_cuenta_anterior(
  p_carga bigint, p_id_cliente bigint, p_customer_id bigint,
  p_como text, p_por uuid DEFAULT NULL, p_nota text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
SET enable_seqscan = off
AS $$
DECLARE
  c record; m record;
  v_salida bigint; v_cons int; v_neto bigint; v_dif bigint;
  v_lotes int := 0; v_canjes int := 0; v_nueva boolean;
BEGIN
  SELECT * INTO c FROM public.puntos_archivo_cliente
   WHERE carga_id = p_carga AND id_cliente = p_id_cliente FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'esa cuenta no está en el archivo'); END IF;
  IF c.asignada_a IS NOT NULL AND c.asignada_a <> p_customer_id THEN
    RETURN json_build_object('ok', false, 'error', format('esa cuenta ya se asignó a la ficha %s', c.asignada_a));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RETURN json_build_object('ok', false, 'error', 'esa ficha no existe');
  END IF;
  v_nueva := c.asignada_a IS NULL;

  INSERT INTO public.puntos_cuenta (customer_id, migrada_at) VALUES (p_customer_id, now())
    ON CONFLICT (customer_id) DO UPDATE SET migrada_at = coalesce(public.puntos_cuenta.migrada_at, now());

  -- Las compras que todavía no están, con su fecha real.
  FOR m IN SELECT v.* FROM public.puntos_archivo_venta v
            WHERE v.carga_id = p_carga AND v.id_cliente = p_id_cliente AND v.puntos > 0
              AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l WHERE l.ref_anterior = v.id_venta)
            ORDER BY v.fecha, v.id_venta
  LOOP
    INSERT INTO public.puntos_lote (customer_id, origen, sucursal, puntos, restantes, ganado_el, vence_el,
                                    motivo, created_at, ref_anterior, cuenta_anterior)
    VALUES (p_customer_id, 'migracion', m.sucursal, m.puntos, m.puntos, m.fecha::date,
            public.puntos_vence_el(m.fecha::date),
            CASE WHEN coalesce(m.ticket,'') ~ '^[0-9]+$' THEN format('compra · ticket %s', m.ticket)
                 ELSE coalesce(nullif(trim(m.ticket),''), 'compra') END,
            m.fecha, m.id_venta, p_id_cliente);
    v_lotes := v_lotes + 1;
  END LOOP;

  -- Los canjes que todavía no están, en orden, del lote más viejo al más nuevo.
  FOR m IN SELECT k.* FROM public.puntos_archivo_canje k
            WHERE k.carga_id = p_carga AND k.id_cliente = p_id_cliente AND k.puntos > 0
              AND NOT EXISTS (SELECT 1 FROM public.puntos_salida s WHERE s.ref_anterior = k.id_canje)
            ORDER BY k.fecha, k.id_canje
  LOOP
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, sucursal, motivo, created_at,
                                      ref_anterior, cuenta_anterior)
    VALUES (p_customer_id, 'canje', m.puntos, m.sucursal,
            CASE WHEN nullif(trim(coalesce(m.ticket,'')),'') IS NULL THEN 'canje'
                 ELSE format('canje · ticket %s', m.ticket) END,
            m.fecha, m.id_canje, p_id_cliente)
    RETURNING id INTO v_salida;
    v_cons := public.puntos_consumir(p_customer_id, m.puntos, v_salida);
    IF v_cons = 0 THEN
      -- No había de dónde descontar: la salida no puede quedar en cero
      -- (CHECK puntos > 0). Se borra, y el cuadre de abajo iguala la cuenta
      -- con su saldo de allá.
      DELETE FROM public.puntos_salida WHERE id = v_salida;
    ELSIF v_cons < m.puntos THEN
      UPDATE public.puntos_salida SET puntos = v_cons,
             motivo = motivo || format(' · faltaron %s puntos', m.puntos - v_cons)
       WHERE id = v_salida;
    END IF;
    v_canjes := v_canjes + 1;
  END LOOP;

  -- El cuadre de ESTA cuenta vieja: lo que vino de ella tiene que dar su saldo.
  SELECT coalesce((SELECT sum(puntos) FROM public.puntos_lote   WHERE cuenta_anterior = p_id_cliente), 0)
       - coalesce((SELECT sum(puntos) FROM public.puntos_salida WHERE cuenta_anterior = p_id_cliente), 0)
    INTO v_neto;
  v_dif := greatest(c.puntos, 0) - v_neto;

  IF v_dif > 0 THEN
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo, cuenta_anterior)
    VALUES (p_customer_id, 'ajuste', v_dif, v_dif, DATE '2026-09-30', public.puntos_vence_el(DATE '2026-09-30'),
            'cuadre con el saldo del sistema anterior', p_id_cliente);
  ELSIF v_dif < 0 THEN
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, motivo, created_at, cuenta_anterior)
    VALUES (p_customer_id, 'ajuste', -v_dif, 'cuadre con el saldo del sistema anterior',
            least(now(), TIMESTAMP '2026-09-30 23:59:59'), p_id_cliente)
    RETURNING id INTO v_salida;
    v_cons := public.puntos_consumir(p_customer_id, (-v_dif)::int, v_salida);
    IF v_cons = 0 THEN DELETE FROM public.puntos_salida WHERE id = v_salida;
    ELSIF v_cons < -v_dif THEN UPDATE public.puntos_salida SET puntos = v_cons WHERE id = v_salida; END IF;
  END IF;

  -- La cuenta sale del libro, no de una suma aparte.
  UPDATE public.puntos_cuenta pc
     SET saldo   = coalesce((SELECT sum(restantes) FROM public.puntos_lote   WHERE customer_id = p_customer_id), 0),
         ganados = coalesce((SELECT sum(puntos)    FROM public.puntos_lote   WHERE customer_id = p_customer_id), 0),
         usados  = coalesce((SELECT sum(puntos)    FROM public.puntos_salida WHERE customer_id = p_customer_id), 0),
         updated_at = now()
   WHERE pc.customer_id = p_customer_id;

  IF v_nueva THEN
    UPDATE public.puntos_archivo_cliente
       SET asignada_a = p_customer_id, asignada_at = now(), asignada_como = p_como,
           asignada_por = p_por, asignada_nota = p_nota
     WHERE carga_id = p_carga AND id_cliente = p_id_cliente;
  END IF;

  SELECT coalesce((SELECT sum(puntos) FROM public.puntos_lote   WHERE cuenta_anterior = p_id_cliente), 0)
       - coalesce((SELECT sum(puntos) FROM public.puntos_salida WHERE cuenta_anterior = p_id_cliente), 0)
    INTO v_neto;

  RETURN json_build_object('ok', true, 'customer_id', p_customer_id, 'id_cliente', p_id_cliente,
    'nueva', v_nueva, 'puntos', greatest(c.puntos, 0), 'lotes', v_lotes, 'canjes', v_canjes, 'ajuste', v_dif,
    'saldo_despues', (SELECT saldo FROM public.puntos_cuenta WHERE customer_id = p_customer_id),
    'cambio', v_lotes > 0 OR v_canjes > 0 OR v_dif <> 0,
    'cuadra', v_neto = greatest(c.puntos, 0));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_sincronizar_cuenta_anterior(bigint,bigint,bigint,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_sincronizar_cuenta_anterior(bigint,bigint,bigint,text,uuid,text) TO service_role;

-- ── La migración, ahora incremental ────────────────────────────────────────
-- Una cuenta ya asignada se SINCRONIZA con su ficha (trae lo nuevo). Una que no
-- se clasifica igual que antes y, si su DUI da una sola ficha, se asigna.
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
  v_dui text; v_n int; v_cid bigint;
  v_ultimo bigint := p_despues_de;
  v_leidas int := 0; v_migradas int := 0; v_actualizadas int := 0; v_sin_cambios int := 0;
  v_dui_corto int := 0; v_sin_ficha int := 0; v_varias_fichas int := 0; v_varias_cuentas int := 0;
  v_con_ajuste int := 0; v_no_cuadra_final int := 0;
  v_puntos bigint := 0; v_lotes int := 0; v_canjes int := 0;
  v_problemas json[] := '{}';
BEGIN
  SELECT id INTO v_carga FROM public.puntos_archivo_carga
   WHERE completa ORDER BY id DESC LIMIT 1;
  IF v_carga IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no hay una copia completa del sistema anterior');
  END IF;

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
       AND (a.puntos <> 0 OR a.asignada_a IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.puntos_archivo_venta v WHERE v.carga_id = v_carga AND v.id_cliente = a.id_cliente)
            OR EXISTS (SELECT 1 FROM public.puntos_archivo_canje k WHERE k.carga_id = v_carga AND k.id_cliente = a.id_cliente))
     ORDER BY a.id_cliente
     LIMIT CASE WHEN p_solo_cliente IS NULL THEN p_limite ELSE 1 END
  LOOP
    v_leidas := v_leidas + 1;
    v_ultimo := c.id_cliente;
    v_dui := c.dui_d;
    v_cid := c.asignada_a;

    IF v_cid IS NULL THEN
      IF length(v_dui) < 8 THEN
        v_dui_corto := v_dui_corto + 1;
        IF c.puntos > 0 AND coalesce(array_length(v_problemas,1),0) < 200 THEN
          v_problemas := v_problemas || json_build_object('que','sin DUI usable','id_cliente',c.id_cliente,'saldo',c.puntos);
        END IF;
        CONTINUE;
      END IF;
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
    END IF;

    IF p_simular THEN
      IF c.asignada_a IS NULL THEN v_migradas := v_migradas + 1; v_puntos := v_puntos + greatest(c.puntos, 0);
      ELSE v_sin_cambios := v_sin_cambios + 1; END IF;
      CONTINUE;
    END IF;

    r := public.puntos_sincronizar_cuenta_anterior(v_carga, c.id_cliente, v_cid, 'dui');
    IF NOT coalesce((r->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'cuenta %: %', c.id_cliente, r->>'error';
    END IF;
    IF (r->>'nueva')::boolean THEN
      v_migradas := v_migradas + 1; v_puntos := v_puntos + greatest(c.puntos, 0);
    ELSIF (r->>'cambio')::boolean THEN v_actualizadas := v_actualizadas + 1;
    ELSE v_sin_cambios := v_sin_cambios + 1; END IF;
    v_lotes := v_lotes + (r->>'lotes')::int;
    v_canjes := v_canjes + (r->>'canjes')::int;
    IF (r->>'ajuste')::bigint <> 0 THEN
      v_con_ajuste := v_con_ajuste + 1;
      IF coalesce(array_length(v_problemas,1),0) < 200 THEN
        v_problemas := v_problemas || json_build_object('que','el historial no da el saldo: entra un ajuste','id_cliente',c.id_cliente,
          'saldo',c.puntos,'ajuste',r->'ajuste');
      END IF;
    END IF;
    IF NOT (r->>'cuadra')::boolean THEN
      v_no_cuadra_final := v_no_cuadra_final + 1;
      IF coalesce(array_length(v_problemas,1),0) < 200 THEN
        v_problemas := v_problemas || json_build_object('que','NO CUADRA tras migrar','id_cliente',c.id_cliente,'saldo',c.puntos);
      END IF;
    END IF;
  END LOOP;

  RETURN json_build_object('ok', true, 'simulado', p_simular, 'carga', v_carga,
    'leidas', v_leidas, 'ultimo_id', v_ultimo, 'hay_mas', v_leidas >= p_limite AND p_solo_cliente IS NULL,
    'migradas', v_migradas, 'actualizadas', v_actualizadas, 'sin_cambios', v_sin_cambios,
    'puntos', v_puntos, 'lotes', v_lotes, 'canjes', v_canjes,
    'con_ajuste', v_con_ajuste, 'no_cuadra_final', v_no_cuadra_final,
    'ya_migradas', v_sin_cambios + v_actualizadas,
    'dui_corto_o_vacio', v_dui_corto, 'sin_ficha_en_el_portal', v_sin_ficha,
    'dui_en_varias_fichas', v_varias_fichas, 'dui_en_varias_cuentas', v_varias_cuentas,
    'problemas', to_json(v_problemas));
END;
$$;

-- ── Asignar a mano: también sincroniza, y ya no espera al arranque ─────────
-- El freno de «sólo después del 1-oct» existía porque la copia nueva borraba la
-- asignación y se duplicaba. Con la herencia de `puntos_archivo_cerrar` y los
-- números de origen únicos, asignar hoy es seguro: la copia de esta noche la
-- conserva y la sincronización sólo trae lo nuevo.
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
  IF c.asignada_a IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', format('esa cuenta ya se asignó a la ficha %s', c.asignada_a));
  END IF;
  SELECT id, name, dui, phone INTO f FROM public.customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'esa ficha no existe'); END IF;

  IF p_simular THEN
    RETURN json_build_object('ok', true, 'simulado', true,
      'cuenta_anterior', json_build_object('id', c.id_cliente,
          'nombre', trim(coalesce(c.datos->>'Nombres','') || ' ' || coalesce(c.datos->>'Apellidos','')),
          'dui', c.dui, 'telefono', c.datos->>'Telefono', 'saldo', c.puntos),
      'ficha', json_build_object('id', f.id, 'nombre', f.name, 'dui', f.dui, 'telefono', f.phone));
  END IF;

  RETURN public.puntos_sincronizar_cuenta_anterior(v_carga, p_id_cliente, p_customer_id, 'manual', p_por, p_nota);
END;
$$;

CREATE OR REPLACE FUNCTION public.puntos_panel_asignar(
  p_id_cliente bigint, p_customer_id bigint, p_nota text, p_simular boolean DEFAULT true
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos', 'can_edit')) THEN
    RAISE EXCEPTION 'No tienes permiso para asignar cuentas de puntos.' USING ERRCODE = '42501';
  END IF;
  RETURN public.puntos_asignar_cuenta_anterior(p_id_cliente, p_customer_id, p_nota, p_simular,
                                               (SELECT public.auth_employee_id()));
END;
$$;
