-- Una limpieza no se borra: se anula, y la corrección conserva lo que había.
--
-- Medido el 2026-09-03 escribiendo el procedimiento del RTS 6.1.14, que dice
-- que la documentación digital tiene que ser «atribuible, legible,
-- contemporánea, ORIGINAL y PRECISA»:
--
--   * `anular_limpieza_bitacora` hacía `DELETE`. Pedía motivo, lo validaba y lo
--     **descartaba**: la fila desaparecía y no quedaba rastro de que existió.
--   * `corregir_limpieza_bitacora` hacía `UPDATE … SET puntos = …,
--     observaciones = …`: **pisaba** el valor anterior. Sobrevivían quién,
--     cuándo y por qué, nunca QUÉ decía antes.
--
-- Las lecturas ya estaban bien (`bitacora_correcciones` guarda antes y después).
-- Las limpiezas eran la mitad que nadie había mirado, y el borrador del
-- procedimiento afirmaba «ningún dato se borra» sobre las dos.
--
-- Contra qué choca, además del 6.1.14:
--   * Ley de Firma Electrónica (D.L. 133/2015) Art. 13-A(c) — el archivo se
--     mantiene «íntegro, legible, completo y sin alteraciones»; y Art. 14,
--     último inciso: la alteración que afecte la integridad HACE PERDER el
--     valor legal del documento almacenado.
--   * Anexo 11 de las BPM de la UE, §9 — para cambio o borrado, el motivo debe
--     quedar documentado.
--   * 21 CFR Part 11 §11.10(e) — pista de auditoría de lo que crea, modifica o
--     BORRA un registro.
--
-- ── Por qué una tabla aparte y no una marca en la fila ──────────────────────
--
-- `bitacora_limpiezas` tiene `UNIQUE (area_id, fecha, turno)`. Marcando la fila
-- como anulada, ese turno quedaría ocupado para siempre y **no se podría volver
-- a registrar la limpieza** — que es justo lo que se quiere después de anular
-- una mal cargada. Se resolvería con un índice único parcial, pero eso obliga a
-- meterle `anulada_at IS NULL` a las CINCO funciones que leen la tabla
-- (`get_bitacora_dia`, `get_bitacora_mes_impreso`, `get_bitacora_resumen_mes`,
-- `bitacora_pendientes_por_vencer`, `registrar_limpieza_bitacora`), y una que
-- se olvide muestra como hecha una limpieza anulada, en silencio.
--
-- El historial aparte no toca ninguna de las cinco, conserva el turno libre, y
-- es el idioma que este repo ya usa para auditoría (`*_history`, `*_log`).
-- Guarda la FOTO COMPLETA de lo anulado —no sólo su id— para que el registro
-- sea reconstruible aunque la fila ya no exista.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.bitacora_limpiezas_historial (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    accion              text NOT NULL CHECK (accion IN ('corregir', 'anular')),
    -- Sin FK: al anular, la fila de `bitacora_limpiezas` deja de existir y este
    -- número queda como referencia histórica, no como puntero vivo.
    limpieza_id         bigint,
    area_id             bigint NOT NULL REFERENCES public.bitacora_areas(id) ON DELETE RESTRICT,
    fecha               date NOT NULL,
    turno               text NOT NULL,
    -- La foto de lo que había antes.
    puntos_antes        jsonb,
    observaciones_antes text,
    realizada_por       uuid REFERENCES public.employees(id),
    registrado_at_antes timestamptz,
    tarde_antes         boolean,
    -- Lo que quedó. Sólo en 'corregir': al anular no queda nada.
    puntos_despues      jsonb,
    observaciones_despues text,
    motivo              text NOT NULL,
    actor_id            uuid REFERENCES public.employees(id),
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bitacora_limpiezas_historial IS
  'Append-only. Toda corrección o anulación de una limpieza, con la foto de lo '
  'que había antes. Existe porque anular hacía DELETE sin dejar rastro, y el '
  'RTS 6.1.14 exige que el registro sea original y preciso. No se purga.';

CREATE INDEX IF NOT EXISTS bitacora_limpiezas_historial_area_fecha_idx
    ON public.bitacora_limpiezas_historial (area_id, fecha DESC);
-- FK con índice que la cubra (regla 2 de la estructura de BD).
CREATE INDEX IF NOT EXISTS bitacora_limpiezas_historial_actor_idx
    ON public.bitacora_limpiezas_historial (actor_id);
CREATE INDEX IF NOT EXISTS bitacora_limpiezas_historial_realizada_por_idx
    ON public.bitacora_limpiezas_historial (realizada_por);

ALTER TABLE public.bitacora_limpiezas_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bitacora_limpiezas_historial_select ON public.bitacora_limpiezas_historial;
CREATE POLICY bitacora_limpiezas_historial_select
    ON public.bitacora_limpiezas_historial FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('bitacoras', 'can_view')));

-- Sin policy de INSERT/UPDATE/DELETE a propósito: es append-only y sólo lo
-- escriben las dos funciones SECURITY DEFINER de abajo. Nadie escribe a mano.

REVOKE ALL ON public.bitacora_limpiezas_historial FROM PUBLIC, anon;
GRANT SELECT ON public.bitacora_limpiezas_historial TO authenticated;
GRANT ALL ON public.bitacora_limpiezas_historial TO service_role;

-- ── Corregir: primero se guarda lo que había, después se pisa ───────────────
CREATE OR REPLACE FUNCTION public.corregir_limpieza_bitacora(p_limpieza_id bigint, p_puntos jsonb DEFAULT '[]'::jsonb, p_observaciones text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_area public.bitacora_areas%ROWTYPE;
    v_lim  public.bitacora_limpiezas%ROWTYPE;
    v_puntos jsonb;
BEGIN
    SELECT * INTO v_lim FROM public.bitacora_limpiezas WHERE id = p_limpieza_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese registro de limpieza no existe.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_area FROM public.bitacora_areas WHERE id = v_lim.area_id;
    PERFORM public.bitacora_exigir_acceso(v_area.branch_id, 'can_edit');

    IF public.bitacora_periodo_cerrado(v_area.branch_id, to_char(v_lim.fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder corregir.' USING ERRCODE = 'P0001';
    END IF;

    IF coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Hay que decir por que se corrige.' USING ERRCODE = 'P0001';
    END IF;

    -- Igual que al registrar: el detalle se arma contra la lista del área, no
    -- se copia lo que manda el navegador.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'clave', p->>'clave',
               'hecho', coalesce((
                   SELECT (m->>'hecho')::boolean
                     FROM jsonb_array_elements(coalesce(p_puntos, '[]'::jsonb)) m
                    WHERE m->>'clave' = p->>'clave'
                    LIMIT 1), false)
           )), '[]'::jsonb)
      INTO v_puntos
      FROM jsonb_array_elements(coalesce(v_area.puntos, '[]'::jsonb)) p;

    -- El historial va ANTES del UPDATE: si algo falla después, no queda una
    -- corrección anotada que nunca ocurrió — y si falla el historial, no se
    -- pisa nada. Las dos cosas en la misma transacción.
    INSERT INTO public.bitacora_limpiezas_historial (
        accion, limpieza_id, area_id, fecha, turno,
        puntos_antes, observaciones_antes, realizada_por, registrado_at_antes, tarde_antes,
        puntos_despues, observaciones_despues, motivo, actor_id)
    VALUES (
        'corregir', v_lim.id, v_lim.area_id, v_lim.fecha, v_lim.turno,
        v_lim.puntos, v_lim.observaciones, v_lim.realizada_por, v_lim.registrado_at, v_lim.tarde,
        v_puntos, nullif(btrim(p_observaciones), ''), btrim(p_motivo), public.auth_employee_id());

    UPDATE public.bitacora_limpiezas
       SET puntos = v_puntos,
           observaciones = nullif(btrim(p_observaciones), ''),
           corregida_at = now(),
           corregida_por = public.auth_employee_id(),
           correccion_motivo = btrim(p_motivo)
     WHERE id = p_limpieza_id;
END;
$function$;

-- ── Anular: la foto queda, la fila se va, el turno vuelve a estar libre ─────
CREATE OR REPLACE FUNCTION public.anular_limpieza_bitacora(p_limpieza_id bigint, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_area public.bitacora_areas%ROWTYPE;
    v_lim  public.bitacora_limpiezas%ROWTYPE;
BEGIN
    SELECT * INTO v_lim FROM public.bitacora_limpiezas WHERE id = p_limpieza_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese registro de limpieza no existe.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_area FROM public.bitacora_areas WHERE id = v_lim.area_id;
    PERFORM public.bitacora_exigir_acceso(v_area.branch_id, 'can_edit');

    IF public.bitacora_periodo_cerrado(v_area.branch_id, to_char(v_lim.fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder quitarlo.' USING ERRCODE = 'P0001';
    END IF;

    IF coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Hay que decir por que se quita.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.bitacora_limpiezas_historial (
        accion, limpieza_id, area_id, fecha, turno,
        puntos_antes, observaciones_antes, realizada_por, registrado_at_antes, tarde_antes,
        motivo, actor_id)
    VALUES (
        'anular', v_lim.id, v_lim.area_id, v_lim.fecha, v_lim.turno,
        v_lim.puntos, v_lim.observaciones, v_lim.realizada_por, v_lim.registrado_at, v_lim.tarde,
        btrim(p_motivo), public.auth_employee_id());

    DELETE FROM public.bitacora_limpiezas WHERE id = p_limpieza_id;
END;
$function$;

-- El respaldo semanal tiene que alcanzarlo, igual que a las otras siete. Esta
-- lista y la constante TABLES de `backup-critical-tables/index.ts` son la MISMA
-- lista dicha dos veces y se mueven juntas: una tabla agregada sólo allá vuelve
-- TABLE_NOT_ALLOWED y tumba el respaldo COMPLETO, no sólo esa tabla.
CREATE OR REPLACE FUNCTION public.backup_dump_table(p_table text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE result jsonb;
BEGIN
  IF p_table <> ALL(ARRAY[
    'employees','roles','role_permissions','branches','shifts','holidays',
    'employee_branches','employee_events','employee_documents','employee_rosters',
    'product_stock_params','dispatch_rules','stock_config','minmax_ignored',
    'product_categories','erp_sucursal_map',
    'kiosk_devices','overtime_bank','payroll_periods','payroll_entries',
    'vacation_plan_headers','vacation_plans','audit_logs',
    -- Bitácoras (RTS 6.2.16: 2 años; Guía BPAD 3.12: 1 año)
    'bitacora_areas','bitacora_lecturas','bitacora_limpiezas',
    'bitacora_correcciones','bitacora_cierres','bitacora_dispensaciones',
    'bitacora_folios','bitacora_limpiezas_historial'
  ]) THEN
    RAISE EXCEPTION 'TABLE_NOT_ALLOWED: %', p_table;
  END IF;
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM %I t', p_table) INTO result;
  RETURN result;
END;
$function$;
