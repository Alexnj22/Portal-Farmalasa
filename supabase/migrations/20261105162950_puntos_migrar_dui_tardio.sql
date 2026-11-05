-- Puntos del sistema anterior que se quedaron atrás porque el DUI llegó tarde a la ficha.
--
-- La migración (`puntos_migrar_historial`) une cada cuenta vieja con su ficha del
-- portal POR EL DUI, y corrió por última vez con el arranque del 1-oct. Una ficha
-- que en ese momento no tenía DUI quedó como «sin ficha en el portal» y, cuando
-- alguien se lo agregó después, nada volvió a mirarla: el cliente ve sólo los
-- puntos nuevos y los viejos no aparecen nunca.
--
-- Caso que lo destapó (2026-11-05): DAVID ALEXANDER SERRANO GUARDADO, ficha 8921,
-- cuenta vieja 24052 con 203 puntos en 17 compras. El DUI se lo escribieron el
-- 1-nov a las 15:12 y compró a las 15:21: el portal le mostraba 8. Ese día había
-- 4 casos iguales (639 puntos). La vista `puntos_cuentas_pendientes` los rotulaba
-- «tiene ficha: pasa sola en la migración» — y no pasaban solos.
--
-- Esta función los busca y los pasa con la MISMA pieza que la migración
-- (`puntos_sincronizar_cuenta_anterior`), así el libro queda igual que si
-- hubieran entrado el 1-oct. Quedan marcados `asignada_como = 'dui_tardio'`.
--
-- Mismas guardas que la migración: DUI de 8+ dígitos, UNA sola cuenta vieja con
-- ese DUI y UNA sola ficha del portal con ese DUI. Sólo cuentas con saldo
-- positivo: una cuenta vieja en cero no tiene nada que devolver, y su cuadre
-- podría descontar puntos nuevos de la ficha.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_migrar_dui_tardio(p_simular boolean DEFAULT true)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_carga bigint; c record; r json;
  v_pasadas json[] := '{}'; v_fallas json[] := '{}';
BEGIN
  SELECT id INTO v_carga FROM public.puntos_archivo_carga
   WHERE completa ORDER BY id DESC LIMIT 1;
  IF v_carga IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no hay una copia completa del sistema anterior');
  END IF;

  FOR c IN
    WITH a AS (
      SELECT ac.id_cliente, ac.puntos, ac.asignada_a, regexp_replace(coalesce(ac.dui, ''), '\D', '', 'g') AS d
        FROM public.puntos_archivo_cliente ac
       WHERE ac.carga_id = v_carga
    ), por_dui AS (
      SELECT d, count(*) AS n FROM a GROUP BY d
    ), pendientes AS (
      SELECT a.* FROM a JOIN por_dui pd ON pd.d = a.d AND pd.n = 1
       WHERE a.asignada_a IS NULL AND a.puntos > 0 AND length(a.d) >= 8
    ), fichas AS (
      SELECT regexp_replace(cu.dui, '\D', '', 'g') AS d, count(*) AS n, min(cu.id) AS customer_id
        FROM public.customers cu
       WHERE cu.dui IS NOT NULL
         AND regexp_replace(cu.dui, '\D', '', 'g') IN (SELECT d FROM pendientes)
       GROUP BY 1
    )
    SELECT p.id_cliente, p.puntos, f.customer_id
      FROM pendientes p
      JOIN fichas f ON f.d = p.d AND f.n = 1
     WHERE NOT EXISTS (SELECT 1 FROM public.puntos_cuenta pc
                        WHERE pc.customer_id = f.customer_id AND pc.fusionada_en IS NOT NULL)
     ORDER BY p.id_cliente
  LOOP
    IF p_simular THEN
      v_pasadas := v_pasadas || json_build_object('id_cliente', c.id_cliente, 'customer_id', c.customer_id, 'puntos', c.puntos);
      CONTINUE;
    END IF;
    BEGIN
      r := public.puntos_sincronizar_cuenta_anterior(v_carga, c.id_cliente, c.customer_id, 'dui_tardio', NULL,
             'el DUI llegó a la ficha después de la migración');
      IF coalesce((r->>'ok')::boolean, false) AND coalesce((r->>'cuadra')::boolean, false) THEN
        v_pasadas := v_pasadas || json_build_object('id_cliente', c.id_cliente, 'customer_id', c.customer_id,
                       'puntos', c.puntos, 'saldo_despues', r->'saldo_despues');
      ELSE
        -- No cuadra o no se pudo: se deshace ESTA cuenta y se deja para revisar a mano.
        RAISE EXCEPTION 'cuenta %: %', c.id_cliente, coalesce(r->>'error', 'no cuadra tras migrar');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fallas := v_fallas || json_build_object('id_cliente', c.id_cliente, 'customer_id', c.customer_id, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN json_build_object('ok', true, 'simulado', p_simular, 'carga', v_carga,
    'pasadas', coalesce(array_length(v_pasadas, 1), 0), 'detalle', to_json(v_pasadas),
    'fallas', to_json(v_fallas));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.puntos_migrar_dui_tardio(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_migrar_dui_tardio(boolean) TO service_role;

-- Cada hora en horario de sala: la ficha que recibe su DUI hoy ve sus puntos
-- viejos antes de la próxima compra, no al día siguiente.
SELECT cron.schedule('puntos-dui-tardio-hora', '25 12-23,0-5 * * *',
  $$SELECT public.puntos_migrar_dui_tardio(false)$$);

-- Nace APAGADO: su primera corrida pasaría los 3 casos que ya existían el día
-- que se escribió, y eso se enciende con el OK del usuario, no con la migración.
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'puntos-dui-tardio-hora';
