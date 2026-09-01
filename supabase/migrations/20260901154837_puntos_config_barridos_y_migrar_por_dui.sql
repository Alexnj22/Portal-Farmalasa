-- Tres cosas, todas apagadas:
--   1. `puntos_config` — el interruptor. Nace en «mysql» y «acumulación off».
--   2. `puntos_migrar` corregida: liga por DUI, no por erp_id.
--   3. Los dos barridos: canjes y anulaciones.
--
-- Plan: docs/PLAN-PUNTOS-EN-SUPABASE-2026-09-01.md
SET lock_timeout = '5s';

-- ── El interruptor ──────────────────────────────────────────────────────────
-- Una FILA y no una policy ni una constante: la marcha atrás nunca puede ser
-- una migración (es la lección del outage del 2026-07-08). Encender el programa
-- es un UPDATE de una fila; apagarlo, el UPDATE inverso.
--
-- Los tres valores nacen en el estado APAGADO. Un interruptor cuyo default es
-- «encendido» se enciende por accidente, que es exactamente lo que no puede
-- pasar acá.
CREATE TABLE public.puntos_config (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  fuente             text    NOT NULL DEFAULT 'mysql'
                             CHECK (fuente IN ('mysql','portal')),
  acumulacion_activa boolean NOT NULL DEFAULT false,
  minimo_canje       integer NOT NULL DEFAULT 100 CHECK (minimo_canje > 0),
  nota               text,
  updated_by         uuid REFERENCES public.employees(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.puntos_config IS
  'Una sola fila (el CHECK sobre un boolean PK lo garantiza). `fuente` dice quién contesta el saldo: mysql = el sistema viejo, portal = el libro mayor de acá. Nace apagado a propósito.';
COMMENT ON COLUMN public.puntos_config.minimo_canje IS
  'Cuántos puntos hacen falta para canjear. Vive acá y no en una constante porque el dato medido dice que ESTE número es el cuello de botella del programa —3 de cada 4 clientes activos no llegan a 100 en seis meses— así que se va a mover, y moverlo tiene que ser una fila.';

INSERT INTO public.puntos_config (id, nota)
VALUES (true, 'creada apagada el 2026-09-01: el libro mayor existe pero no manda todavía');

ALTER TABLE public.puntos_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY leer_config ON public.puntos_config FOR SELECT TO authenticated USING (true);
REVOKE ALL    ON public.puntos_config FROM anon;
GRANT  SELECT ON public.puntos_config TO authenticated;

CREATE OR REPLACE FUNCTION public.puntos_fuente()
RETURNS text LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$ SELECT coalesce((SELECT fuente FROM public.puntos_config WHERE id), 'mysql'); $$;
COMMENT ON FUNCTION public.puntos_fuente() IS
  'Si la fila no existe devuelve «mysql»: el modo seguro es el que sigue funcionando como hasta ahora.';

REVOKE EXECUTE ON FUNCTION public.puntos_fuente() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.puntos_fuente() TO anon, authenticated, service_role;

-- ── La migración de saldos, corregida ───────────────────────────────────────
-- La primera versión ligaba por `erp_id` y estaba MAL: la base de puntos no
-- tiene el número del ERP, identifica por DUI. Lo delató leer cómo lo hace
-- `puntos-consulta`, que ya resolvía este puente para una pantalla.
--
-- Tres cosas que el terreno obliga, medidas el 2026-09-01 sobre las 28,111
-- fichas:
--   · Sólo los DÍGITOS. El portal guarda `########-#` y el otro sistema mezcla
--     formatos. Comparar el texto crudo perdería la mayoría de las coincidencias.
--   · 11,415 fichas NO tienen DUI. A ésas no se les puede migrar nada, y hay que
--     decirlo con un número, no descubrirlo después.
--   · 100 DUI están repetidos en 203 fichas. Ahí NO se elige: se informa. Elegir
--     mal le pone el saldo de una persona a otra, y eso no se deshace mirando.
DROP FUNCTION IF EXISTS public.puntos_migrar(json, date, boolean);

CREATE OR REPLACE FUNCTION public.puntos_migrar(
  p_filas json, p_ganado_el date DEFAULT DATE '2026-10-01', p_simular boolean DEFAULT true
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r record; v_cid bigint; v_n int; v_dui text;
  v_leidas int := 0; v_migradas int := 0; v_puntos bigint := 0;
  v_sin_ficha int := 0; v_ambiguas int := 0; v_ya int := 0;
  v_cero int := 0; v_dui_corto int := 0;
  v_problemas json[] := '{}';
BEGIN
  FOR r IN SELECT * FROM json_to_recordset(p_filas)
                    AS x(dui text, saldo integer, id_cliente text)
  LOOP
    v_leidas := v_leidas + 1;
    v_dui := regexp_replace(coalesce(r.dui,''), '\D', '', 'g');

    IF coalesce(r.saldo,0) <= 0 THEN v_cero := v_cero + 1; CONTINUE; END IF;
    IF length(v_dui) < 8      THEN v_dui_corto := v_dui_corto + 1; CONTINUE; END IF;

    SELECT count(*), min(id) INTO v_n, v_cid
      FROM public.customers
     WHERE regexp_replace(coalesce(dui,''), '\D', '', 'g') = v_dui;

    IF v_n = 0 THEN
      v_sin_ficha := v_sin_ficha + 1;
      IF v_sin_ficha <= 50 THEN
        v_problemas := v_problemas || json_build_object(
          'que','sin ficha en el portal','dui',v_dui,'saldo',r.saldo,'id_cliente',r.id_cliente);
      END IF;
      CONTINUE;
    END IF;

    IF v_n > 1 THEN
      v_ambiguas := v_ambiguas + 1;
      v_problemas := v_problemas || json_build_object(
        'que','ese DUI esta en varias fichas','dui',v_dui,'fichas',v_n,'saldo',r.saldo);
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.puntos_lote
                WHERE customer_id = v_cid AND origen = 'migracion') THEN
      v_ya := v_ya + 1; CONTINUE;
    END IF;

    v_migradas := v_migradas + 1;
    v_puntos   := v_puntos + r.saldo;
    CONTINUE WHEN p_simular;

    INSERT INTO public.puntos_cuenta (customer_id, migrada_at) VALUES (v_cid, now())
      ON CONFLICT (customer_id) DO UPDATE SET migrada_at = now();

    INSERT INTO public.puntos_lote
      (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (v_cid, 'migracion', r.saldo, r.saldo, p_ganado_el,
            public.puntos_vence_el(p_ganado_el),
            format('saldo traído del sistema anterior (cliente %s)', coalesce(r.id_cliente,'?')));

    UPDATE public.puntos_cuenta
       SET saldo = saldo + r.saldo, ganados = ganados + r.saldo, updated_at = now()
     WHERE customer_id = v_cid;
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'leidas', v_leidas,
    'migradas', v_migradas, 'puntos', v_puntos,
    'saldo_cero', v_cero, 'dui_corto_o_vacio', v_dui_corto,
    'sin_ficha_en_el_portal', v_sin_ficha, 'dui_en_varias_fichas', v_ambiguas,
    'ya_migradas', v_ya, 'problemas', to_json(v_problemas));
END;
$$;

-- ── Barrido de canjes ───────────────────────────────────────────────────────
-- Recorre las ventas marcadas y registra el canje que ya ocurrió en el sistema
-- de ventas. Devuelve los AVISOS armados; mandarlos es del llamador — una
-- función de Postgres no manda notificaciones.
CREATE OR REPLACE FUNCTION public.puntos_barrer_canjes(
  p_desde date, p_hasta date, p_simular boolean DEFAULT true, p_tope integer DEFAULT 500
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r record; res json;
  v_vistas int := 0; v_registrados int := 0; v_puntos bigint := 0;
  v_sin_saldo int := 0; v_convenio int := 0; v_nada int := 0;
  v_avisos json[] := '{}';
BEGIN
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
$$;

-- ── Barrido de anulaciones ──────────────────────────────────────────────────
-- Los DOS estados de anulación, no uno. «NULA» y «DTE INVALIDADO EN MH»: el
-- circuito viejo descartaba sólo por la palabra NULA, así que 1,024 facturas
-- anuladas ante Hacienda ganaron puntos igual.
CREATE OR REPLACE FUNCTION public.puntos_barrer_anulaciones(
  p_desde date, p_hasta date, p_simular boolean DEFAULT true, p_tope integer DEFAULT 500
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r record; res json;
  v_vistas int := 0; v_revertidas int := 0; v_puntos bigint := 0; v_no_rec bigint := 0;
BEGIN
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
$$;

REVOKE EXECUTE ON FUNCTION public.puntos_migrar(json,date,boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_migrar(json,date,boolean) TO service_role;
REVOKE EXECUTE ON FUNCTION public.puntos_barrer_canjes(date,date,boolean,integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_barrer_canjes(date,date,boolean,integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.puntos_barrer_anulaciones(date,date,boolean,integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_barrer_anulaciones(date,date,boolean,integer) TO service_role;
