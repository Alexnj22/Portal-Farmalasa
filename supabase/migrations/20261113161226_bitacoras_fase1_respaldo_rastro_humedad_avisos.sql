-- Bitácoras SRS, fase 1 (2026-11-13): lo que la auditoría del 13-nov encontró
-- roto o sin rastro, sin decisión de negocio de por medio.
--
--   1. El respaldo semanal dejaba fuera seis tablas nacidas después del 3-sep:
--      el libro de inyectables (lo pide el CSSP por tener inyectorio),
--      cumplimiento (farmacovigilancia, bajas, capacitación), las visitas del
--      regente (RTS 6.1.3), la revisión de lotes del libro y el listado AWaRe
--      (RTS 6.1.15). La lista de `backup_dump_table` y la de la edge function
--      `backup-critical-tables` son la MISMA lista: se mueven juntas.
--   2. El libro de inyectables se corregía pisando el dato, sin guardar el
--      anterior (ALCOA). Y la configuración de las áreas —donde viven el rango
--      que dispara la acción correctiva y la calibración del termómetro— se
--      cambiaba sin rastro. Las dos pasan por el mismo `bitacora_auditar` que ya
--      vigila lecturas, limpiezas, correcciones y cierres: la fila entera y,
--      en un cambio, la de antes, a `audit_logs`.
--   3. En un área que mide humedad, una lectura sin humedad se aceptaba (pasó
--      el 10-nov en Salud 1). Al ANOTAR se exige; al CORREGIR no, porque la
--      única salida honesta para una humedad imposible ya guardada (0 %, 3 %,
--      5 %) cuyo valor real nadie sabe es dejarla vacía con su motivo.
--   4. `bitacora_avisar_anomalias()`, una vez al día: la misma temperatura
--      anotada en las últimas 7 lecturas de un área (el refrigerador de Bodega
--      dijo 8.0 °C exactos 47 veces seguidas: así no se lee un termómetro), y
--      el refrigerador sin calibración vigente o que vence en 30 días (Guía
--      SRS 2.32, CRÍTICO). Avisa a quien anota en esa sala y a quien cierra el
--      mes; una vez por semana por cosa, no todos los días.
SET lock_timeout = '5s';

-- ── 1. Respaldo ─────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.backup_dump_table(text)'::regprocedure);
  v_old text := '''inyeccion_aplicaciones''';
  v_new text := '''inyeccion_aplicaciones'', ''inyeccion_libro'',
    -- Lo que nació después del 3-sep (auditoría del 2026-11-13)
    ''cumplimiento_registros'', ''regencia_visitas'', ''libro_lote_revisiones'',
    ''antibioticos_aware'', ''antibioticos_producto''';
BEGIN
  IF position('''cumplimiento_registros''' IN v_def) > 0 THEN
    RAISE NOTICE 'backup_dump_table ya tiene las tablas nuevas';
  ELSIF position(v_old IN v_def) = 0 THEN
    RAISE NOTICE 'backup_dump_table: no se encontró %', v_old;
  ELSE
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END
$mig$;

-- ── 2. Rastro de cambios ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS bitacora_areas_auditar ON public.bitacora_areas;
CREATE TRIGGER bitacora_areas_auditar
  AFTER INSERT OR UPDATE OR DELETE ON public.bitacora_areas
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_auditar();

DROP TRIGGER IF EXISTS inyeccion_libro_auditar ON public.inyeccion_libro;
CREATE TRIGGER inyeccion_libro_auditar
  AFTER INSERT OR UPDATE OR DELETE ON public.inyeccion_libro
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_auditar();

-- ── 3. Humedad obligatoria al anotar ────────────────────────────────────────
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.registrar_lectura_bitacora(bigint,date,text,numeric,numeric,text)'::regprocedure);
  v_old text := '    PERFORM public.bitacora_validar_lectura(p_temperatura,';
  v_new text := '    IF v_area.mide_humedad AND p_humedad IS NULL THEN
        RAISE EXCEPTION ''Falta la humedad: esta area la mide.'' USING ERRCODE = ''P0001'';
    END IF;

    PERFORM public.bitacora_validar_lectura(p_temperatura,';
BEGIN
  IF position('Falta la humedad' IN v_def) > 0 THEN
    RAISE NOTICE 'registrar_lectura_bitacora ya exige la humedad';
  ELSIF position(v_old IN v_def) = 0 THEN
    RAISE NOTICE 'registrar_lectura_bitacora: no se encontró la validación';
  ELSE
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END
$mig$;

-- ── 4. Avisos de lo que no se ve en una lectura sola ────────────────────────
CREATE OR REPLACE FUNCTION public.bitacora_avisar_anomalias()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_hoy     date := public.bitacora_hoy_sv();
  v_semana  text := to_char(public.bitacora_hoy_sv(), 'IYYY-IW');
  r         record;
  v_dest    uuid[];
  v_key     text;
  v_avisos  int := 0;
BEGIN
  FOR r IN
    -- (a) La misma temperatura en las últimas 7 lecturas del área.
    SELECT a.id AS area_id, a.branch_id, b.name AS sala, a.nombre AS area,
           'repetida'::text AS tipo, max(u.temperatura) AS valor, NULL::date AS vence
      FROM public.bitacora_areas a
      JOIN public.branches b ON b.id = a.branch_id
      JOIN LATERAL (
        SELECT l.temperatura FROM public.bitacora_lecturas l
         WHERE l.area_id = a.id ORDER BY l.fecha DESC, l.registrado_at DESC LIMIT 7
      ) u ON true
     WHERE a.activa
     GROUP BY a.id, a.branch_id, b.name, a.nombre
    HAVING count(*) = 7 AND count(DISTINCT u.temperatura) = 1
    UNION ALL
    -- (b) Refrigerador sin calibración vigente, o que vence en 30 días.
    SELECT a.id, a.branch_id, b.name, a.nombre,
           CASE WHEN a.calibrado_hasta IS NULL THEN 'sin_calibrar'
                WHEN a.calibrado_hasta < v_hoy THEN 'calibracion_vencida'
                ELSE 'calibracion_por_vencer' END,
           NULL, a.calibrado_hasta
      FROM public.bitacora_areas a
      JOIN public.branches b ON b.id = a.branch_id
     WHERE a.activa AND a.tipo = 'refrigerador'
       AND (a.calibrado_hasta IS NULL OR a.calibrado_hasta < v_hoy + 30)
  LOOP
    v_key := 'bitacora_anomalia:' || r.tipo || ':' || r.area_id || ':' || v_semana;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n WHERE n.metadata->>'check_key' = v_key);

    -- Quien anota en esa sala, y quien firma el cierre del mes.
    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (
         (e.branch_id = r.branch_id AND EXISTS (
            SELECT 1 FROM public.role_permissions rp
             WHERE rp.role_id = e.role_id AND rp.module_key = 'bitacoras' AND rp.can_edit))
         OR EXISTS (
            SELECT 1 FROM public.role_permissions rp
             WHERE rp.role_id = e.role_id AND rp.module_key = 'bitacoras_cerrar_mes' AND rp.can_edit));
    CONTINUE WHEN v_dest IS NULL;

    PERFORM public.notify_employees(
      v_dest,
      'BITACORA_ANOMALIA',
      CASE r.tipo
        WHEN 'repetida' THEN r.area || ' de ' || r.sala || ': siempre el mismo valor'
        WHEN 'sin_calibrar' THEN r.area || ' de ' || r.sala || ': termómetro sin calibración'
        WHEN 'calibracion_vencida' THEN r.area || ' de ' || r.sala || ': calibración vencida'
        ELSE r.area || ' de ' || r.sala || ': la calibración vence pronto' END,
      CASE r.tipo
        WHEN 'repetida' THEN 'Las últimas 7 lecturas dicen ' || trim(to_char(r.valor, 'FM990.0')) ||
             ' °C exactos. Revisen que el termómetro funcione y anoten lo que marca en ese momento.'
        WHEN 'sin_calibrar' THEN 'La SRS pide que el termómetro del refrigerador esté calibrado. ' ||
             'Anoten la fecha y el vencimiento del certificado en Bitácoras → Configuración.'
        WHEN 'calibracion_vencida' THEN 'El certificado venció el ' || to_char(r.vence, 'DD/MM/YYYY') ||
             '. Hay que calibrar el termómetro y anotar el certificado nuevo.'
        ELSE 'El certificado vence el ' || to_char(r.vence, 'DD/MM/YYYY') ||
             '. Programen la calibración antes de esa fecha.' END,
      '/bitacoras',
      jsonb_build_object('check_key', v_key, 'area_id', r.area_id, 'branch_id', r.branch_id, 'tipo', r.tipo),
      true,
      r.branch_id::int);
    v_avisos := v_avisos + 1;
  END LOOP;
  RETURN json_build_object('ok', true, 'avisos', v_avisos);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bitacora_avisar_anomalias() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bitacora_avisar_anomalias() TO service_role;

-- 09:10 SV todos los días. Guarda «sólo si existe» al quitarlo (CLAUDE.md).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'bitacora-anomalias-diario';
SELECT cron.schedule('bitacora-anomalias-diario', '10 15 * * *', $$SELECT public.bitacora_avisar_anomalias()$$);
