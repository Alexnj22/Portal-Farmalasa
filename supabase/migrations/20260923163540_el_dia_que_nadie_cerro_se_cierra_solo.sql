SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- EL DÍA QUE NADIE CERRÓ SE CIERRA SOLO — una hora después del cierre.
--
-- Regla del usuario (23-sep): «que pase 1 hora después de la hora de cierre,
-- si aún sigue abierta la sucursal y hay un corte de caja cerca de la hora de
-- cierre» → el portal emite el corte Z. Y a la mañana siguiente se le avisa a
-- la sala que no hizo el cierre del día anterior.
--
-- ── Por qué hace falta y el sistema de la caja no lo cubre ─────────────────
-- Revisado en el propio sistema el 23-sep: no tiene ninguna opción de cierre
-- automático. Lo único que hace solo es un corte **C** a las 21:00:00 sobre la
-- caja que siga abierta — y un C no es el cierre del día. En las seis salas
-- desde el 1-ago hubo exactamente dos días sin Z, los dos de Salud 5 (13-sep,
-- domingo; 15-sep, feriado): los dos con ese C de las 21:00 y ningún Z. La caja
-- después desaparece de madrugada sin Z, y al día siguiente abre normal. O sea
-- que el olvido no traba nada visible: sólo deja el día sin su cierre fiscal.
--
-- ── Las piezas ─────────────────────────────────────────────────────────────
--   sala_hora_de_cierre        la hora de cierre de UN día, leída de
--                              `weekly_hours`. Era un cálculo escrito DENTRO de
--                              `sala_ya_cerro`; ahora las dos preguntas usan el
--                              mismo, y `sala_ya_cerro` contesta igual que antes
--                              (verificado sobre las 6 salas × 7 días × cada 5
--                              minutos antes de reemplazarla).
--   caja_falta_contra_corte    cuánto entró al cajón después de UN corte dado.
--                              Era el cuerpo de `caja_falta_por_contar`, que
--                              ahora elige su corte (el último CONFIRMADO) y le
--                              pregunta a ésta. Mismo resultado, verificado
--                              sobre cada sala-día de los últimos 60 días.
--   caja_cierre_automatico_decidir   EL juez. Lo consultan el cron y
--                              `hacer-corte-caja` justo antes de emitir: si
--                              pudieran contestar distinto, el cron mandaría a
--                              cerrar lo que la función después rechaza.
--   caja_cierres_automaticos   lo que pasó, una fila por sala y día.
--   avisar_dias_sin_cierre     el aviso de las 7:00 a la sala y a supervisión.
--
-- ── Qué frenos del Z NO aplican cuando cierra el portal, y por qué ─────────
-- El Z hecho a mano pasa por cuatro. En el automático:
--   · «ya hay un Z hoy» y «no hay caja abierta» se quedan tal cual.
--   · «hay un corte sin confirmar» NO aplica: el corte de las 21:00 que hace el
--     sistema solo nace PENDIENTE, y a esa hora no queda nadie que lo firme.
--     Frenar por eso sería no cerrar nunca justo el día que hace falta. Los
--     cortes siguen pendientes y el recordatorio de las 7:30 los pide igual.
--   · «efectivo sin contar» se mide contra el corte cercano al cierre aunque
--     no esté confirmado, porque es el que la regla del usuario nombra. Si
--     después de ese corte entró plata, NO se cierra: un Z sobre dinero que
--     nadie contó es exactamente el caso de Salud 2 del 6-sep.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. La hora de cierre de un día ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sala_hora_de_cierre(p_branch bigint, p_dia date)
RETURNS time
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dia    jsonb;
    v_abre   text;
    v_cierra text;
BEGIN
    SELECT b.weekly_hours -> (extract(dow from p_dia)::int::text)
      INTO v_dia
      FROM public.branches b
     WHERE b.id = p_branch;

    IF v_dia IS NULL THEN RETURN NULL; END IF;

    -- Una sala marcada cerrada ese día no tiene hora de cierre que contestar.
    IF coalesce((v_dia->>'isOpen')::boolean, false) IS NOT TRUE THEN RETURN NULL; END IF;

    -- Toma sólo «HH:MM» del principio: Salud 2 guarda «19:00 PM».
    v_abre   := substring(btrim(coalesce(v_dia->>'start','')) from '^[0-9]{1,2}:[0-9]{2}');
    v_cierra := substring(btrim(coalesce(v_dia->>'end',''))   from '^[0-9]{1,2}:[0-9]{2}');
    IF v_abre IS NULL OR v_cierra IS NULL THEN RETURN NULL; END IF;

    v_abre   := lpad(v_abre, 5, '0');
    v_cierra := lpad(v_cierra, 5, '0');

    -- Cierra antes de abrir = cruza la medianoche. No se adivina.
    IF v_cierra <= v_abre THEN RETURN NULL; END IF;

    RETURN v_cierra::time;
END $function$;

REVOKE EXECUTE ON FUNCTION public.sala_hora_de_cierre(bigint, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sala_hora_de_cierre(bigint, date) TO authenticated, service_role;


-- `sala_ya_cerro` pasa a preguntarle a la de arriba. La firma no cambia (sin
-- sobrecarga) y el margen de 15 minutos se queda donde estaba.
CREATE OR REPLACE FUNCTION public.sala_ya_cerro(
    p_branch  bigint,
    p_momento timestamp with time zone DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    -- Cuánto antes del cierre ya cuenta como el último corte del día.
    c_margen constant interval := interval '15 minutes';
    v_local  timestamp;
    v_cierra time;
BEGIN
    -- La sala vive en hora de El Salvador; `now()` viene en UTC.
    v_local  := p_momento AT TIME ZONE 'America/El_Salvador';
    v_cierra := public.sala_hora_de_cierre(p_branch, v_local::date);
    IF v_cierra IS NULL THEN RETURN NULL; END IF;

    RETURN v_local >= (v_local::date + v_cierra - c_margen);
END $function$;


-- ── 2. Cuánto entró después de UN corte ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.caja_falta_contra_corte(
    p_branch_id integer, p_dia date, p_corte_id bigint, p_piezas json DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ap     numeric;
  v_pz     json := p_piezas;
  v_espera numeric;
  v_c      public.cortes_caja%ROWTYPE;
  v_medido numeric;
BEGIN
  IF v_pz IS NULL THEN
    SELECT round(coalesce(a.monto_apertura, 0), 2) INTO v_ap
      FROM public.cortes_caja_aperturas a
     WHERE a.branch_id = p_branch_id AND a.abierta_el = p_dia
     ORDER BY a.turno DESC, a.id DESC
     LIMIT 1;
    -- Las mismas piezas que la pantalla usa para «cuánto hay en el cajón», pero
    -- SIN restar las bolsas: acá se pregunta cuánto ENTRÓ en total, no cuánto
    -- quedó suelto. Un solo sitio arma la suma.
    v_pz := public.caja_efectivo_piezas(p_branch_id, p_dia, coalesce(v_ap, 0));
  END IF;

  v_espera := round( (v_pz->>'apertura')::numeric
                   + (v_pz->>'ventas_efectivo')::numeric
                   + (v_pz->>'entradas')::numeric
                   - (v_pz->>'vales')::numeric, 2);

  -- El corte lo elige quien pregunta. Sin corte = todavía no se midió nada.
  IF p_corte_id IS NOT NULL THEN
    SELECT * INTO v_c
      FROM public.cortes_caja c
     WHERE c.id = p_corte_id AND c.branch_id = p_branch_id AND c.fecha = p_dia;
  END IF;

  IF p_corte_id IS NULL OR NOT FOUND THEN
    RETURN json_build_object(
      'medido', true, 'hay_corte', false, 'desde', NULL,
      'espera', v_espera, 'ya_medido', 0,
      'falta', greatest(0, v_espera));
  END IF;

  IF v_c.tk_total_caja IS NULL THEN
    RETURN json_build_object(
      'medido', false, 'hay_corte', true,
      'desde', to_char(v_c.hora, 'HH24:MI'),
      'espera', v_espera, 'ya_medido', NULL, 'falta', NULL);
  END IF;

  -- Lo que el corte dio por medido se DESPEJA del canónico, no se copia su
  -- fórmula: `declarado − corte_diferencia(...)`.
  v_medido := round(v_c.total_declarado - public.corte_diferencia(
      v_c.total_declarado, v_c.diferencia_erp, v_c.tk_total_caja,
      v_c.tk_subtotal, v_c.tk_vales, v_c.tk_cobros_credito,
      v_c.cobros_portal_efectivo), 2);

  RETURN json_build_object(
    'medido', true, 'hay_corte', true,
    'desde', to_char(v_c.hora, 'HH24:MI'),
    'espera', v_espera, 'ya_medido', v_medido,
    'falta', round(v_espera - v_medido, 2));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.caja_falta_contra_corte(integer, date, bigint, json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.caja_falta_contra_corte(integer, date, bigint, json) TO service_role;


-- `caja_falta_por_contar` conserva su firma y su respuesta: sólo elige el corte
-- y delega. El candado del cierre y el aviso de la pantalla siguen preguntándole
-- a ella.
CREATE OR REPLACE FUNCTION public.caja_falta_por_contar(
    p_branch_id integer, p_dia date, p_piezas json DEFAULT NULL::json
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_corte bigint;
BEGIN
  -- El último que CUENTA es el último CONFIRMADO. Un descartado no midió nada
  -- —su conteo se tiró— así que el tramo que abarcaba sigue abierto. Mismo
  -- criterio que `corte_tramo` y que `repartirPorCorte` en la pantalla.
  -- Verificado con Salud 1 el 17-ago, que tiene un descartado DESPUÉS del
  -- confirmado: elige el de las 22:01 y no el de las 22:03.
  SELECT c.id INTO v_corte
    FROM public.cortes_caja c
   WHERE c.branch_id = p_branch_id AND c.fecha = p_dia
     AND c.tipo = 'C' AND c.estado = 'CONFIRMADO'
   ORDER BY c.hora DESC, c.id DESC
   LIMIT 1;

  RETURN public.caja_falta_contra_corte(p_branch_id, p_dia, v_corte, p_piezas);
END;
$function$;


-- ── 3. Lo que pasó cada noche ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.caja_cierres_automaticos (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id       integer NOT NULL REFERENCES public.branches(id),
    fecha           date    NOT NULL,
    -- 'cerrado': el portal emitió el Z. 'no_cerrado': nadie cerró y el portal
    -- tampoco pudo, por el `motivo`.
    resultado       text    NOT NULL CHECK (resultado IN ('cerrado', 'no_cerrado')),
    motivo          text,
    -- El Z que emitió el portal (número del sistema de la caja).
    erp_corte_id    integer,
    -- El corte cercano al cierre sobre el que se apoyó la decisión.
    corte_hora      time,
    falta           numeric(12,2),
    detalle         jsonb   NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    -- Una fila por sala y día. Cubre también la FK (columna líder).
    CONSTRAINT caja_cierres_automaticos_sala_dia UNIQUE (branch_id, fecha)
);

COMMENT ON TABLE public.caja_cierres_automaticos IS
  'Una fila por sala y día en que nadie hizo el cierre del día: si el portal lo cerró solo (y con qué Z) o por qué no pudo. Historial de negocio: no se purga.';

ALTER TABLE public.caja_cierres_automaticos ENABLE ROW LEVEL SECURITY;

-- Escribe sólo la función del cierre (service_role). Leer, quien ve cortes, con
-- el mismo alcance por sala que `cortes_caja_aperturas`.
CREATE POLICY caja_cierres_automaticos_select ON public.caja_cierres_automaticos
  FOR SELECT TO authenticated
  USING (
    (SELECT public.auth_has_module_permission('cortes_caja', 'can_view'))
    AND ((SELECT public.auth_module_scope('cortes_caja')) = 'ALL'
         OR branch_id = (SELECT public.auth_employee_branch_id()))
  );
CREATE POLICY caja_cierres_automaticos_no_bloqueado ON public.caja_cierres_automaticos
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.auth_no_bloqueado()));

REVOKE ALL ON public.caja_cierres_automaticos FROM anon;
GRANT SELECT ON public.caja_cierres_automaticos TO authenticated;


-- Anota sin reescribir: el cron corre cada 10 minutos y la misma decisión no
-- tiene que volver a escribirse cada vez. Y un 'cerrado' no se pisa nunca.
CREATE OR REPLACE FUNCTION public.caja_cierre_automatico_anotar(
    p_branch_id integer, p_fecha date, p_resultado text, p_motivo text,
    p_erp_corte_id integer, p_corte_hora time, p_falta numeric, p_detalle jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  INSERT INTO public.caja_cierres_automaticos AS t
         (branch_id, fecha, resultado, motivo, erp_corte_id, corte_hora, falta, detalle)
  VALUES (p_branch_id, p_fecha, p_resultado, p_motivo, p_erp_corte_id, p_corte_hora,
          p_falta, coalesce(p_detalle, '{}'::jsonb))
  ON CONFLICT (branch_id, fecha) DO UPDATE
     SET resultado = EXCLUDED.resultado, motivo = EXCLUDED.motivo,
         erp_corte_id = EXCLUDED.erp_corte_id, corte_hora = EXCLUDED.corte_hora,
         falta = EXCLUDED.falta, detalle = EXCLUDED.detalle, updated_at = now()
   WHERE t.resultado <> 'cerrado'
     AND (t.resultado, t.motivo, t.erp_corte_id, t.corte_hora, t.falta, t.detalle)
         IS DISTINCT FROM
         (EXCLUDED.resultado, EXCLUDED.motivo, EXCLUDED.erp_corte_id,
          EXCLUDED.corte_hora, EXCLUDED.falta, EXCLUDED.detalle);
END $function$;

REVOKE EXECUTE ON FUNCTION public.caja_cierre_automatico_anotar(integer, date, text, text, integer, time, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.caja_cierre_automatico_anotar(integer, date, text, text, integer, time, numeric, jsonb) TO service_role;


-- ── 4. EL juez ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.caja_cierre_automatico_decidir(
    p_branch_id integer, p_momento timestamptz DEFAULT now()
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  -- La regla del usuario, en dos números.
  c_espera constant interval := interval '1 hour';  -- después de la hora de cierre
  c_cerca  constant interval := interval '1 hour';  -- «un corte cerca del cierre»
  v_local  timestamp := p_momento AT TIME ZONE 'America/El_Salvador';
  v_dia    date      := (p_momento AT TIME ZONE 'America/El_Salvador')::date;
  v_cierra time;
  v_c      record;
  v_falta  json;
  v_pend   numeric;
  v_base   jsonb;
BEGIN
  v_cierra := public.sala_hora_de_cierre(p_branch_id, v_dia);
  v_base := jsonb_build_object('branch_id', p_branch_id, 'fecha', v_dia,
                               'cierre', to_char(v_cierra, 'HH24:MI'));

  IF v_cierra IS NULL THEN
    RETURN (v_base || jsonb_build_object('procede', false, 'motivo', 'sin_horario'))::json;
  END IF;

  IF v_local < v_dia + v_cierra + c_espera THEN
    RETURN (v_base || jsonb_build_object('procede', false, 'motivo', 'todavia_no'))::json;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cortes_caja_aperturas a
                  WHERE a.branch_id = p_branch_id AND a.abierta_el = v_dia
                    AND a.cerrada_at IS NULL) THEN
    RETURN (v_base || jsonb_build_object('procede', false, 'motivo', 'sin_caja_abierta'))::json;
  END IF;

  IF EXISTS (SELECT 1 FROM public.cortes_caja c
              WHERE c.branch_id = p_branch_id AND c.fecha = v_dia AND c.tipo = 'Z') THEN
    RETURN (v_base || jsonb_build_object('procede', false, 'motivo', 'ya_tiene_z'))::json;
  END IF;

  -- El corte cercano al cierre: el último C del día que no se haya descartado,
  -- desde una hora antes del cierre en adelante. Confirmado o pendiente: el de
  -- las 21:00 que hace el sistema solo nace pendiente y nadie lo va a firmar.
  SELECT c.id, c.hora, c.estado INTO v_c
    FROM public.cortes_caja c
   WHERE c.branch_id = p_branch_id AND c.fecha = v_dia
     AND c.tipo = 'C' AND c.estado <> 'DESCARTADO'
     AND c.hora >= v_cierra - c_cerca
   ORDER BY c.hora DESC, c.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN (v_base || jsonb_build_object('procede', false, 'motivo', 'sin_corte_al_cierre'))::json;
  END IF;

  v_base := v_base || jsonb_build_object('corte_id', v_c.id,
                                         'corte_hora', to_char(v_c.hora, 'HH24:MI'),
                                         'corte_estado', v_c.estado);

  v_falta := public.caja_falta_contra_corte(p_branch_id, v_dia, v_c.id);
  IF (v_falta->>'medido')::boolean IS NOT TRUE THEN
    RETURN (v_base || jsonb_build_object('procede', false, 'motivo', 'no_se_pudo_medir'))::json;
  END IF;

  v_pend := (v_falta->>'falta')::numeric;
  IF v_pend >= 0.01 THEN
    RETURN (v_base || jsonb_build_object('procede', false, 'motivo', 'efectivo_sin_contar',
                                         'falta', v_pend))::json;
  END IF;

  RETURN (v_base || jsonb_build_object('procede', true, 'motivo', NULL, 'falta', v_pend))::json;
END $function$;

REVOKE EXECUTE ON FUNCTION public.caja_cierre_automatico_decidir(integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.caja_cierre_automatico_decidir(integer, timestamptz) TO service_role;


-- Las salas a mirar son las que tienen la caja de HOY abierta; una sala que
-- cerró bien ni aparece.
CREATE OR REPLACE FUNCTION public.caja_cierre_automatico_salas(p_momento timestamptz DEFAULT now())
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN (
    SELECT coalesce(json_agg(public.caja_cierre_automatico_decidir(s.branch_id, p_momento)
                             ORDER BY s.branch_id), '[]'::json)
      FROM (SELECT DISTINCT a.branch_id
              FROM public.cortes_caja_aperturas a
             WHERE a.cerrada_at IS NULL
               AND a.abierta_el = (p_momento AT TIME ZONE 'America/El_Salvador')::date) s
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.caja_cierre_automatico_salas(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.caja_cierre_automatico_salas(timestamptz) TO service_role;


-- ── 5. El aviso de la mañana ───────────────────────────────────────────────
-- A las 7:00, sobre el día anterior: toda sala que tuvo caja abierta y cuyo
-- cierre no hizo nadie. Dos casos, porque piden cosas distintas:
--   · el portal lo cerró solo → «la próxima vez, ciérrenlo ustedes»;
--   · quedó sin cierre         → «avisen a supervisión».
-- Va a la gente de ESA sala y a supervisión. La marca en `avisos_emitidos` es
-- por persona y por sala-día: correrla dos veces no manda dos.
CREATE OR REPLACE FUNCTION public.avisar_dias_sin_cierre(p_fecha date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dow  text[] := ARRAY['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  v_mes  text[] := ARRAY['enero','febrero','marzo','abril','mayo','junio','julio',
                         'agosto','septiembre','octubre','noviembre','diciembre'];
  v_fecha_texto text := v_dow[EXTRACT(dow FROM p_fecha)::int + 1] || ' '
                        || EXTRACT(day FROM p_fecha)::int || ' de '
                        || v_mes[EXTRACT(month FROM p_fecha)::int];
  v_n integer;
BEGIN
  WITH salas AS (
    SELECT DISTINCT a.branch_id FROM public.cortes_caja_aperturas a WHERE a.abierta_el = p_fecha
  ),
  casos AS (
    SELECT s.branch_id, b.name AS sala, ca.resultado, ca.motivo, ca.falta,
           ca.corte_hora, (ca.detalle->>'z_hora') AS z_hora
      FROM salas s
      JOIN public.branches b ON b.id = s.branch_id
      LEFT JOIN public.caja_cierres_automaticos ca
             ON ca.branch_id = s.branch_id AND ca.fecha = p_fecha
     WHERE ca.resultado = 'cerrado'
        OR NOT EXISTS (SELECT 1 FROM public.cortes_caja c
                        WHERE c.branch_id = s.branch_id AND c.fecha = p_fecha AND c.tipo = 'Z')
  ),
  destinatarios AS (
    -- La gente de la sala…
    SELECT c.branch_id, e.id AS employee_id
      FROM casos c
      JOIN public.employees e ON e.branch_id = c.branch_id
     WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
    UNION
    -- …y supervisión, por cargo y no por lista de ids.
    SELECT c.branch_id, e.id
      FROM casos c
      CROSS JOIN public.employees e
      JOIN public.roles r ON r.name IN ('Gerente General', 'Supervisor/a de Ventas')
     WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
       AND e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
  ),
  ins AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
    SELECT d.employee_id,
           'DIA_SIN_CIERRE',
           CASE WHEN c.resultado = 'cerrado'
                THEN c.sala || ': el portal cerró el día solo'
                ELSE c.sala || ': el día quedó sin cierre' END,
           'Nadie hizo el cierre del día del ' || v_fecha_texto || '. '
             || CASE WHEN c.resultado = 'cerrado'
                     THEN 'El portal lo hizo solo'
                          || coalesce(' a las ' || c.z_hora, '')
                          || coalesce(', con el corte de las ' || to_char(c.corte_hora, 'HH24:MI')
                                      || ' como último conteo', '')
                          || '. La próxima vez, cierren el día antes de irse.'
                     ELSE 'El portal no pudo hacerlo solo porque '
                          || CASE c.motivo
                               WHEN 'sin_corte_al_cierre'
                                 THEN 'no hubo un corte de caja cerca de la hora de cierre'
                               WHEN 'efectivo_sin_contar'
                                 THEN 'entraron $' || to_char(c.falta, 'FM999,990.00')
                                      || ' después del último corte y nadie los contó'
                               WHEN 'turno_parado' THEN 'el turno estaba cerrado'
                               ELSE 'no se pudo comprobar la caja' END
                          || '. Avisen a supervisión.' END,
           '/cortes',
           jsonb_build_object('fecha', p_fecha, 'fecha_texto', v_fecha_texto,
                              'sala', c.sala, 'resultado', coalesce(c.resultado, 'no_cerrado'),
                              'motivo', c.motivo),
           c.branch_id
      FROM destinatarios d
      JOIN casos c ON c.branch_id = d.branch_id
     WHERE NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                        WHERE a.recipient_id = d.employee_id
                          AND a.clave = 'DIA_SIN_CIERRE:' || c.branch_id || ':' || p_fecha)
    RETURNING recipient_id, branch_id
  ),
  marca AS (
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT 'DIA_SIN_CIERRE:' || i.branch_id || ':' || p_fecha, i.recipient_id FROM ins i
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END $function$;

REVOKE EXECUTE ON FUNCTION public.avisar_dias_sin_cierre(date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_dias_sin_cierre(date) TO service_role;


-- ── 6. Los dos relojes ─────────────────────────────────────────────────────
-- Cada 10 minutos entre las 17:00 y las 23:50 SV (23:00–05:50 UTC). Salud 5
-- cierra a las 16:00 los domingos, así que la primera corrida útil es a las
-- 17:00; la última queda antes de la medianoche, porque un Z emitido después
-- sería del día siguiente. La función no toca el sistema de la caja salvo para
-- una sala que ya cumple la regla: las demás se deciden en la base.
SELECT cron.schedule(
  'cierre-automatico-caja',
  '*/10 23,0-5 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/cierre-automatico-caja',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    timeout_milliseconds := 150000);
  $$
);

-- 07:00 SV = 13:00 UTC, sobre el día anterior.
SELECT cron.schedule(
  'dias-sin-cierre-0700-sv',
  '0 13 * * *',
  $$SELECT public.avisar_dias_sin_cierre((now() AT TIME ZONE 'America/El_Salvador')::date - 1)$$
);
