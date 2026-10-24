-- ═══════════════════════════════════════════════════════════════════════════
-- Reglamento v2 de Puntos Salud — 4: fuera la reserva y las ofertas por nivel
-- (borrador 2026-10-24)
--
-- QUÉ CAMBIA (decisión del usuario: «lo que la app o el sistema promete y el
-- reglamento no tiene se quita»)
--   · Horas de reserva por nivel (48 h Oro/Platino) y días de anticipo de
--     ofertas por nivel (Platino 2): no están en el reglamento. Se ponen en el
--     valor de todos (24 h, 0 días) — hoy, con los niveles apagados, ya era lo
--     que recibía todo el mundo, así que no cambia nada visible — y
--     `puntos_nivel_guardar` ya no los acepta. Las columnas quedan (las lee
--     `puntos_horas_reserva`, que es de la tanda RESERVAS y que con esto
--     devuelve 24 h para cualquiera).
--   · Invitar a un amigo (referidos) NO se toca: decisión del usuario,
--     «queda en la app, pero no en el reglamento, así en cualquier momento
--     solo se quita».
--
-- DESDE CUÁNDO RIGE: al aplicarla.
-- TABLA CALIENTE: no.
-- CÓMO SE VERIFICÓ: staging con execute_sql — ver el informe de la tanda.
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

-- ── Reservas y ofertas por nivel ───────────────────────────────────────────
UPDATE public.puntos_niveles n
   SET horas_reserva = coalesce((SELECT b.horas_reserva FROM public.puntos_niveles b ORDER BY b.orden LIMIT 1), 24),
       dias_anticipo_ofertas = 0, updated_at = now()
 WHERE n.horas_reserva IS DISTINCT FROM coalesce((SELECT b.horas_reserva FROM public.puntos_niveles b ORDER BY b.orden LIMIT 1), 24)
    OR n.dias_anticipo_ofertas IS DISTINCT FROM 0;
COMMENT ON COLUMN public.puntos_niveles.horas_reserva IS 'DEPRECADO (2026-10-24): la reserva no cambia por nivel. Igual para todos.';
COMMENT ON COLUMN public.puntos_niveles.dias_anticipo_ofertas IS 'DEPRECADO (2026-10-24): las ofertas no se ven antes por nivel. 0 para todos.';

CREATE OR REPLACE FUNCTION public.puntos_nivel_guardar(p_clave text, p_cambios jsonb, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_antes public.puntos_niveles; v_nuevo public.puntos_niveles;
  v_clave text; v_err text; v_orden_max integer;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['puntos_tab_niveles'])) THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar los niveles del programa.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_antes FROM public.puntos_niveles WHERE clave = p_clave FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese nivel no existe.'; END IF;
  FOR v_clave IN SELECT jsonb_object_keys(coalesce(p_cambios, '{}'::jsonb)) LOOP
    -- Las horas de reserva y los días de anticipo de ofertas por nivel ya no
    -- son beneficios (2026-10-24): el Reglamento v2 no los tiene.
    IF v_clave IN ('horas_reserva', 'dias_anticipo_ofertas') THEN
      RAISE EXCEPTION 'Las reservas y las ofertas ya no cambian por nivel: el reglamento no lo contempla.';
    END IF;
    IF v_clave NOT IN ('nombre', 'desde', 'factor', 'puntos_cumpleanos',
                       'cupon_mensual', 'cupon_premios') THEN
      RAISE EXCEPTION 'No se puede cambiar «%» desde aquí.', v_clave;
    END IF;
  END LOOP;

  v_nuevo := v_antes;
  IF p_cambios ? 'nombre' THEN v_nuevo.nombre := nullif(btrim(p_cambios->>'nombre'), ''); END IF;
  IF p_cambios ? 'desde' THEN v_nuevo.desde := (p_cambios->>'desde')::numeric; END IF;
  IF p_cambios ? 'factor' THEN v_nuevo.factor := (p_cambios->>'factor')::numeric; END IF;
  IF p_cambios ? 'puntos_cumpleanos' THEN v_nuevo.puntos_cumpleanos := (p_cambios->>'puntos_cumpleanos')::integer; END IF;
  IF p_cambios ? 'horas_reserva' THEN v_nuevo.horas_reserva := (p_cambios->>'horas_reserva')::integer; END IF;
  IF p_cambios ? 'dias_anticipo_ofertas' THEN v_nuevo.dias_anticipo_ofertas := (p_cambios->>'dias_anticipo_ofertas')::integer; END IF;
  IF p_cambios ? 'cupon_mensual' THEN v_nuevo.cupon_mensual := coalesce((p_cambios->>'cupon_mensual')::integer, 0); END IF;
  IF p_cambios ? 'cupon_premios' THEN
    v_nuevo.cupon_premios := CASE WHEN jsonb_typeof(p_cambios->'cupon_premios') = 'array'
                                   AND jsonb_array_length(p_cambios->'cupon_premios') > 0
                                  THEN p_cambios->'cupon_premios' END;
  END IF;

  IF v_nuevo.nombre IS NULL OR length(v_nuevo.nombre) > 30 THEN RAISE EXCEPTION 'El nombre va de 1 a 30 letras.'; END IF;
  IF v_nuevo.desde IS NULL OR v_nuevo.desde < 0 THEN RAISE EXCEPTION 'El monto para llegar al nivel no puede ser negativo.'; END IF;
  -- El primer nivel es el de entrada: desde $0, siempre.
  IF v_antes.orden = (SELECT min(orden) FROM public.puntos_niveles) AND v_nuevo.desde <> 0 THEN
    RAISE EXCEPTION 'El nivel de entrada empieza en $0.';
  END IF;
  -- Escalera: cada nivel pide más que el anterior y menos que el siguiente.
  IF EXISTS (SELECT 1 FROM public.puntos_niveles n WHERE n.clave <> p_clave
              AND ((n.orden < v_antes.orden AND n.desde >= v_nuevo.desde)
                OR (n.orden > v_antes.orden AND n.desde <= v_nuevo.desde))) THEN
    RAISE EXCEPTION 'Cada nivel tiene que pedir más compra que el anterior y menos que el siguiente.';
  END IF;
  IF v_nuevo.factor IS NULL OR v_nuevo.factor < 1 OR v_nuevo.factor > 5 THEN
    RAISE EXCEPTION 'Los puntos por dólar van de 1 a 5.';
  END IF;
  IF v_nuevo.puntos_cumpleanos IS NULL OR v_nuevo.puntos_cumpleanos < 0 OR v_nuevo.puntos_cumpleanos > 5000 THEN
    RAISE EXCEPTION 'Los puntos de cumpleaños van de 0 a 5,000.';
  END IF;
  IF v_nuevo.horas_reserva IS NULL OR v_nuevo.horas_reserva < 1 OR v_nuevo.horas_reserva > 168 THEN
    RAISE EXCEPTION 'Las horas para retirar una reserva van de 1 a 168 (7 días).';
  END IF;
  IF v_nuevo.dias_anticipo_ofertas < 0 OR v_nuevo.dias_anticipo_ofertas > 14 THEN
    RAISE EXCEPTION 'Los días de anticipo de las ofertas van de 0 a 14.';
  END IF;
  IF v_nuevo.cupon_mensual < 0 OR v_nuevo.cupon_mensual > 10000 THEN
    RAISE EXCEPTION 'Los puntos del raspable van de 0 a 10,000.';
  END IF;
  v_err := public.puntos_premios_validos(v_nuevo.cupon_premios);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION '%', v_err; END IF;
  SELECT max(orden) INTO v_orden_max FROM public.puntos_niveles;
  IF v_antes.orden < v_orden_max - 1 AND (v_nuevo.cupon_mensual > 0 OR v_nuevo.cupon_premios IS NOT NULL) THEN
    RAISE EXCEPTION 'El raspable es sólo de los dos niveles más altos.';
  END IF;

  IF row(v_nuevo.*) IS NOT DISTINCT FROM row(v_antes.*) THEN
    RETURN json_build_object('ok', true, 'cambio', false);
  END IF;
  UPDATE public.puntos_niveles SET
    nombre = v_nuevo.nombre, desde = v_nuevo.desde, factor = v_nuevo.factor,
    puntos_cumpleanos = v_nuevo.puntos_cumpleanos, horas_reserva = v_nuevo.horas_reserva,
    dias_anticipo_ofertas = v_nuevo.dias_anticipo_ofertas,
    cupon_mensual = v_nuevo.cupon_mensual, cupon_premios = v_nuevo.cupon_premios, updated_at = now()
   WHERE clave = p_clave;
  -- El cumpleaños del nivel de entrada vivía también en `puntos_config`
  -- (lo leen `puntos_dar_cumpleanos` y la app): se mueven juntos para que no
  -- haya dos números para la misma promesa.
  IF v_antes.orden = (SELECT min(orden) FROM public.puntos_niveles) THEN
    UPDATE public.puntos_config SET puntos_cumpleanos = v_nuevo.puntos_cumpleanos, updated_at = now()
     WHERE id AND puntos_cumpleanos IS DISTINCT FROM v_nuevo.puntos_cumpleanos;
  END IF;
  INSERT INTO public.puntos_config_historial (employee_id, tabla, clave, antes, despues, nota)
  VALUES (public.auth_employee_id(), 'nivel', p_clave,
          to_jsonb(v_antes) - 'created_at' - 'updated_at', to_jsonb(v_nuevo) - 'created_at' - 'updated_at',
          nullif(btrim(p_nota), ''));
  RETURN json_build_object('ok', true, 'cambio', true);
END $function$;
