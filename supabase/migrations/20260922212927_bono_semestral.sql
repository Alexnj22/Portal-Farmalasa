-- El bono de meta se paga por SEMESTRE — docs/PLAN-BONOS-DOS-CALENDARIOS-2026-09-22.md.
--
-- Regla del usuario (2026-09-22): ene–jun se paga en la 1ª quincena de julio y
-- jul–dic en la 1ª de enero, y es la SUMA del bono de cada mes. Quien ya no
-- trabaja el día del pago lo decide gerencia, caso por caso.
--
-- Tres piezas:
--   1. `metas_bono_persona` — la FOTO del bono de cada persona al cerrar cada
--      mes. Sin ella, sumar en julio recalcula enero con el personal de julio:
--      quien se fue en marzo desaparece de su propio enero, y quien cambió de
--      sala cobra en la nueva lo que vendió en la vieja.
--   2. El cierre del mes (`metas_ciclo_diario`, día 5) la toma después de
--      congelar la sala.
--   3. `bono_semestre*` — la hoja del semestre: la decisión de gerencia sobre
--      quien se fue, y la aprobación, que CONGELA lo que se paga.
--
-- La hoja mensual de Promociones (`liquidacion*`) no se toca acá: se retira en
-- otra migración, cuando esta ya esté en uso.

SET lock_timeout = '5s';

-- ── 1 · La foto del mes, por persona ────────────────────────────────────────
CREATE TABLE public.metas_bono_persona (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    year_month  text    NOT NULL CHECK (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    branch_id   bigint  NOT NULL REFERENCES public.branches(id),
    employee_id uuid    NOT NULL REFERENCES public.employees(id),
    venta       numeric(14,2) NOT NULL DEFAULT 0,
    bono        numeric(12,2) NOT NULL DEFAULT 0,
    es_jefe     boolean NOT NULL DEFAULT false,
    en_prueba   boolean NOT NULL DEFAULT false,
    -- `cierre`: la tomó el cron el día 5 con el personal de ese momento.
    -- `reconstruido`: se tomó después, con el personal del día en que se tomó.
    origen      text    NOT NULL CHECK (origen IN ('cierre', 'reconstruido')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (year_month, branch_id, employee_id)
);
CREATE INDEX idx_metas_bono_persona_employee ON public.metas_bono_persona (employee_id);
CREATE INDEX idx_metas_bono_persona_branch   ON public.metas_bono_persona (branch_id);

ALTER TABLE public.metas_bono_persona ENABLE ROW LEVEL SECURITY;
CREATE POLICY metas_bono_persona_select ON public.metas_bono_persona
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('metas', 'can_view'))
           AND (SELECT public.auth_module_scope('metas')) = 'ALL');

COMMENT ON TABLE public.metas_bono_persona IS
  'Foto del bono de meta de cada persona al cerrar el mes. Nunca se reescribe: la base del pago semestral.';

-- Toma la foto de un mes CERRADO. Nunca pisa una que ya exista.
CREATE OR REPLACE FUNCTION public.fotografiar_bono_meta_mes(
    p_year_month text, p_origen text DEFAULT 'cierre')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
    v_sala record;
    v_json json;
    v_n    integer := 0;
    v_k    integer;
BEGIN
    IF coalesce(p_year_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
    END IF;
    IF p_year_month >= v_ym_actual THEN
        RAISE EXCEPTION 'MES_NO_CERRADO: % todavía no terminó', p_year_month;
    END IF;

    FOR v_sala IN
        SELECT m.branch_id FROM public.metas_sucursal m
         WHERE m.year_month = p_year_month ORDER BY m.branch_id
    LOOP
        v_json := public.bono_meta_sala_interno(v_sala.branch_id, p_year_month);
        IF v_json IS NULL OR (v_json ->> 'branch_id')::bigint IS DISTINCT FROM v_sala.branch_id THEN
            RAISE EXCEPTION 'META_ILEGIBLE: no se pudo leer el bono de la sala % en %',
                v_sala.branch_id, p_year_month;
        END IF;

        INSERT INTO public.metas_bono_persona
            (year_month, branch_id, employee_id, venta, bono, es_jefe, en_prueba, origen)
        SELECT p_year_month, v_sala.branch_id, (p ->> 'employee_id')::uuid,
               round(coalesce((p ->> 'venta')::numeric, 0), 2),
               round(coalesce((p ->> 'bono')::numeric, 0), 2),
               coalesce((p ->> 'es_jefe')::boolean, false),
               coalesce((p ->> 'en_prueba')::boolean, false),
               p_origen
          FROM json_array_elements(v_json -> 'personas') p
         WHERE (p ->> 'employee_id') IS NOT NULL
        ON CONFLICT (year_month, branch_id, employee_id) DO NOTHING;

        GET DIAGNOSTICS v_k = ROW_COUNT;
        v_n := v_n + v_k;
    END LOOP;

    RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fotografiar_bono_meta_mes(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fotografiar_bono_meta_mes(text, text) TO service_role;

-- ── 2 · El cierre del día 5 toma la foto después de congelar la sala ────────
-- Igual que en `bono_meta_sala_interno`: el cuerpo sale de `prosrc` y se le
-- agrega exactamente una línea; si el punto de enganche no aparece una sola
-- vez, aborta.
DO $mig$
DECLARE
    v_src  text;
    v_ancla text := $a$    v_n := public.congelar_metas_mes(v_ym_ant, false);
    v_out := v_out || 'congelado_' || v_ym_ant || '=' || v_n || ' ';$a$;
    v_con  text := $a$    v_n := public.congelar_metas_mes(v_ym_ant, false);
    v_out := v_out || 'congelado_' || v_ym_ant || '=' || v_n || ' ';

    -- Y el bono de cada persona, con el personal de HOY: el pago es semestral
    -- y sumar después recalcularía el mes con quien esté en julio o en enero.
    v_n := public.fotografiar_bono_meta_mes(v_ym_ant, 'cierre');
    v_out := v_out || 'bono_personas_' || v_ym_ant || '=' || v_n || ' ';$a$;
BEGIN
    SELECT prosrc INTO v_src FROM pg_proc
     WHERE oid = 'public.metas_ciclo_diario()'::regprocedure;
    IF (length(v_src) - length(replace(v_src, v_ancla, ''))) / length(v_ancla) <> 1 THEN
        RAISE EXCEPTION 'CUERPO_INESPERADO: el congelado de metas_ciclo_diario no aparece exactamente una vez';
    END IF;
    EXECUTE format($f$
CREATE OR REPLACE FUNCTION public.metas_ciclo_diario()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS %L$f$, replace(v_src, v_ancla, v_con));
END
$mig$;

-- Julio y agosto de 2026 ya cerraron sin foto. Se toman hoy: comparado contra
-- la hoja mensual que se armó el 5-sep, agosto da las mismas 24 personas y
-- $554.64, 0 diferencias.
SELECT public.fotografiar_bono_meta_mes('2026-07', 'reconstruido');
SELECT public.fotografiar_bono_meta_mes('2026-08', 'reconstruido');

-- ── 3 · El semestre ─────────────────────────────────────────────────────────
CREATE TABLE public.bono_semestre (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    semestre    text NOT NULL UNIQUE CHECK (semestre ~ '^[0-9]{4}-S[12]$'),
    estado      text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'aprobado')),
    aprobado_por uuid REFERENCES public.employees(id),
    aprobado_at timestamptz,
    nota        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Quien ya no trabaja: gerencia decide si cobra lo acumulado.
CREATE TABLE public.bono_semestre_decision (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    semestre_id  bigint NOT NULL REFERENCES public.bono_semestre(id),
    employee_id  uuid   NOT NULL REFERENCES public.employees(id),
    pagar        boolean NOT NULL,
    motivo       text   NOT NULL CHECK (btrim(motivo) <> ''),
    decidido_por uuid   NOT NULL REFERENCES public.employees(id),
    decidido_at  timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (semestre_id, employee_id)
);
CREATE INDEX idx_bono_semestre_decision_employee ON public.bono_semestre_decision (employee_id);

-- Lo que se aprobó, congelado. Sin esto, que alguien pase a BAJA después de
-- aprobar cambiaría quién cobra en una hoja ya firmada.
CREATE TABLE public.bono_semestre_detalle (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    semestre_id  bigint NOT NULL REFERENCES public.bono_semestre(id),
    employee_id  uuid   NOT NULL REFERENCES public.employees(id),
    total        numeric(12,2) NOT NULL,
    pagar        boolean NOT NULL,
    status_al_aprobar text NOT NULL,
    por_mes      jsonb  NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (semestre_id, employee_id)
);
CREATE INDEX idx_bono_semestre_detalle_employee ON public.bono_semestre_detalle (employee_id);

CREATE TABLE public.bono_semestre_historial (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    semestre_id bigint NOT NULL REFERENCES public.bono_semestre(id),
    evento      text   NOT NULL,
    employee_id uuid   REFERENCES public.employees(id),
    valor       text,
    nota        text,
    actor       uuid   REFERENCES public.employees(id),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bono_semestre_historial_semestre ON public.bono_semestre_historial (semestre_id);
CREATE INDEX idx_bono_semestre_historial_employee ON public.bono_semestre_historial (employee_id);

DO $pol$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['bono_semestre', 'bono_semestre_decision',
                             'bono_semestre_detalle', 'bono_semestre_historial']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
            USING ((SELECT public.auth_has_module_permission('metas', 'can_view'))
                   AND (SELECT public.auth_module_scope('metas')) = 'ALL')$p$,
            t || '_select', t);
    END LOOP;
END
$pol$;

-- Los seis meses de un semestre.
CREATE OR REPLACE FUNCTION public.meses_del_semestre(p_semestre text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT array_agg(left(p_semestre, 4) || '-' || lpad(m::text, 2, '0') ORDER BY m)
      FROM generate_series(CASE WHEN right(p_semestre, 1) = '1' THEN 1 ELSE 7 END,
                           CASE WHEN right(p_semestre, 1) = '1' THEN 6 ELSE 12 END) m;
$function$;

-- La hoja del semestre.
--  · Mes con foto → manda la foto.
--  · Mes cerrado o en curso SIN foto → se calcula en vivo y se marca
--    `provisional`: todavía se mueve.
--  · Semestre aprobado → manda lo congelado en `bono_semestre_detalle`.
CREATE OR REPLACE FUNCTION public.get_bono_semestral(p_semestre text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
    v_meses     text[];
    v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
    v_sem       public.bono_semestre%ROWTYPE;
    v_meses_json json;
    v_personas  json;
BEGIN
    IF public.auth_employee_id() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('metas', 'can_view')
       OR public.auth_module_scope('metas') <> 'ALL' THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: el pago semestral exige ver las metas de todas las salas'
            USING ERRCODE = '42501';
    END IF;
    IF coalesce(p_semestre, '') !~ '^[0-9]{4}-S[12]$' THEN
        RAISE EXCEPTION 'SEMESTRE_INVALIDO: se escribe AAAA-S1 o AAAA-S2';
    END IF;

    v_meses := public.meses_del_semestre(p_semestre);
    SELECT * INTO v_sem FROM public.bono_semestre WHERE semestre = p_semestre;

    SELECT json_agg(json_build_object(
               'ym', m.ym,
               'estado', CASE WHEN EXISTS (SELECT 1 FROM public.metas_bono_persona f
                                            WHERE f.year_month = m.ym) THEN 'cerrado'
                              WHEN m.ym <= v_ym_actual THEN 'provisional'
                              ELSE 'futuro' END,
               'informativo', NOT public.metas_bono_activo(m.ym))
           ORDER BY m.ym)
      INTO v_meses_json
      FROM unnest(v_meses) m(ym);

    IF v_sem.estado = 'aprobado' THEN
        SELECT json_agg(json_build_object(
                   'employee_id', d.employee_id, 'nombre', e.name, 'code', e.code,
                   'status', d.status_al_aprobar, 'activo', d.status_al_aprobar = 'ACTIVO',
                   'salas', (SELECT json_agg(DISTINCT b.name) FROM public.metas_bono_persona f
                               JOIN public.branches b ON b.id = f.branch_id
                              WHERE f.employee_id = d.employee_id AND f.year_month = ANY (v_meses)
                                AND f.bono > 0),
                   'por_mes', d.por_mes, 'total', d.total, 'provisional', false,
                   'pagar', d.pagar,
                   'decision', (SELECT json_build_object('pagar', x.pagar, 'motivo', x.motivo,
                                        'por', pe.name, 'at', x.decidido_at)
                                  FROM public.bono_semestre_decision x
                                  JOIN public.employees pe ON pe.id = x.decidido_por
                                 WHERE x.semestre_id = v_sem.id AND x.employee_id = d.employee_id))
               ORDER BY d.total DESC, e.name)
          INTO v_personas
          FROM public.bono_semestre_detalle d
          JOIN public.employees e ON e.id = d.employee_id
         WHERE d.semestre_id = v_sem.id;
    ELSE
        WITH
        con_foto AS (
            SELECT DISTINCT f.year_month FROM public.metas_bono_persona f
             WHERE f.year_month = ANY (v_meses)
        ),
        filas AS (
            SELECT f.year_month AS ym, f.branch_id, f.employee_id, f.bono, false AS provisional
              FROM public.metas_bono_persona f
             WHERE f.year_month = ANY (v_meses) AND f.bono > 0
            UNION ALL
            SELECT m.ym, ms.branch_id, (p ->> 'employee_id')::uuid,
                   round(coalesce((p ->> 'bono')::numeric, 0), 2), true
              FROM unnest(v_meses) m(ym)
              JOIN public.metas_sucursal ms ON ms.year_month = m.ym
             CROSS JOIN LATERAL json_array_elements(
                       public.bono_meta_sala_interno(ms.branch_id, m.ym) -> 'personas') p
             WHERE m.ym <= v_ym_actual
               AND m.ym NOT IN (SELECT c.year_month FROM con_foto c)
               AND (p ->> 'employee_id') IS NOT NULL
               AND round(coalesce((p ->> 'bono')::numeric, 0), 2) > 0
        ),
        por_mes AS (
            SELECT employee_id, ym, sum(bono) AS bono, bool_or(provisional) AS provisional
              FROM filas GROUP BY employee_id, ym
        ),
        persona AS (
            SELECT pm.employee_id,
                   sum(pm.bono) AS total,
                   bool_or(pm.provisional) AS provisional,
                   json_object_agg(pm.ym, pm.bono ORDER BY pm.ym) AS por_mes
              FROM por_mes pm GROUP BY pm.employee_id
        )
        SELECT json_agg(json_build_object(
                   'employee_id', p.employee_id, 'nombre', e.name, 'code', e.code,
                   'status', e.status, 'activo', e.status = 'ACTIVO',
                   'salas', (SELECT json_agg(DISTINCT b.name) FROM filas f
                               JOIN public.branches b ON b.id = f.branch_id
                              WHERE f.employee_id = p.employee_id),
                   'por_mes', p.por_mes, 'total', round(p.total, 2),
                   'provisional', p.provisional,
                   'pagar', CASE WHEN e.status = 'ACTIVO' THEN true ELSE d.pagar END,
                   'decision', CASE WHEN d.id IS NULL THEN NULL ELSE
                       json_build_object('pagar', d.pagar, 'motivo', d.motivo,
                                         'por', pe.name, 'at', d.decidido_at) END)
               ORDER BY p.total DESC, e.name)
          INTO v_personas
          FROM persona p
          JOIN public.employees e ON e.id = p.employee_id
          LEFT JOIN public.bono_semestre_decision d
                 ON d.semestre_id = v_sem.id AND d.employee_id = p.employee_id
          LEFT JOIN public.employees pe ON pe.id = d.decidido_por;
    END IF;

    RETURN json_build_object(
        'semestre',     p_semestre,
        'meses',        v_meses_json,
        'estado',       coalesce(v_sem.estado, 'borrador'),
        'aprobado_por', (SELECT e.name FROM public.employees e WHERE e.id = v_sem.aprobado_por),
        'aprobado_at',  v_sem.aprobado_at,
        'nota',         v_sem.nota,
        'personas',     coalesce(v_personas, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.bono_semestre_asegurar(p_semestre text)
 RETURNS public.bono_semestre
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v public.bono_semestre%ROWTYPE;
BEGIN
    INSERT INTO public.bono_semestre (semestre) VALUES (p_semestre)
    ON CONFLICT (semestre) DO NOTHING;
    SELECT * INTO v FROM public.bono_semestre WHERE semestre = p_semestre FOR UPDATE;
    RETURN v;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.bono_semestre_asegurar(text) FROM PUBLIC, anon, authenticated;

-- Gerencia decide por quien ya no trabaja.
CREATE OR REPLACE FUNCTION public.decidir_bono_semestral(
    p_semestre text, p_employee_id uuid, p_pagar boolean, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_sem   public.bono_semestre%ROWTYPE;
    v_status text;
    v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('metas', 'can_approve') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: decidir el bono de quien se fue es de gerencia'
            USING ERRCODE = '42501';
    END IF;
    IF coalesce(p_semestre, '') !~ '^[0-9]{4}-S[12]$' THEN
        RAISE EXCEPTION 'SEMESTRE_INVALIDO: se escribe AAAA-S1 o AAAA-S2';
    END IF;
    IF p_pagar IS NULL THEN RAISE EXCEPTION 'DECISION_REQUERIDA: pagar o no pagar'; END IF;
    IF v_motivo IS NULL THEN RAISE EXCEPTION 'MOTIVO_REQUERIDO: la decisión necesita el motivo'; END IF;

    SELECT status INTO v_status FROM public.employees WHERE id = p_employee_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: esa persona no existe'; END IF;
    IF v_status = 'ACTIVO' THEN
        RAISE EXCEPTION 'SIGUE_ACTIVO: quien sigue trabajando cobra; sólo se decide por quien ya no está';
    END IF;

    v_sem := public.bono_semestre_asegurar(p_semestre);
    IF v_sem.estado = 'aprobado' THEN
        RAISE EXCEPTION 'SEMESTRE_APROBADO: % ya está aprobado; hay que reabrirlo', p_semestre;
    END IF;

    INSERT INTO public.bono_semestre_decision
        (semestre_id, employee_id, pagar, motivo, decidido_por)
    VALUES (v_sem.id, p_employee_id, p_pagar, v_motivo, v_actor)
    ON CONFLICT (semestre_id, employee_id) DO UPDATE
       SET pagar = EXCLUDED.pagar, motivo = EXCLUDED.motivo,
           decidido_por = EXCLUDED.decidido_por, decidido_at = now();

    INSERT INTO public.bono_semestre_historial (semestre_id, evento, employee_id, valor, nota, actor)
    VALUES (v_sem.id, 'decision', p_employee_id,
            CASE WHEN p_pagar THEN 'pagar' ELSE 'no pagar' END, v_motivo, v_actor);

    RETURN public.get_bono_semestral(p_semestre);
END;
$function$;

-- Aprobar congela; reabrir exige motivo.
CREATE OR REPLACE FUNCTION public.aprobar_bono_semestral(
    p_semestre text, p_aprobar boolean DEFAULT true, p_nota text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor  uuid := public.auth_employee_id();
    v_sem    public.bono_semestre%ROWTYPE;
    v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
    v_meses  text[];
    v_hoja   json;
    v_faltan int;
    v_sin    int;
    v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('metas', 'can_approve') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: aprobar el pago semestral es de gerencia'
            USING ERRCODE = '42501';
    END IF;
    IF coalesce(p_semestre, '') !~ '^[0-9]{4}-S[12]$' THEN
        RAISE EXCEPTION 'SEMESTRE_INVALIDO: se escribe AAAA-S1 o AAAA-S2';
    END IF;

    v_sem := public.bono_semestre_asegurar(p_semestre);
    v_meses := public.meses_del_semestre(p_semestre);

    IF NOT p_aprobar THEN
        IF v_sem.estado <> 'aprobado' THEN
            RETURN public.get_bono_semestral(p_semestre);
        END IF;
        IF v_nota IS NULL THEN
            RAISE EXCEPTION 'MOTIVO_REQUERIDO: reabrir un semestre aprobado necesita el motivo';
        END IF;
        DELETE FROM public.bono_semestre_detalle WHERE semestre_id = v_sem.id;
        UPDATE public.bono_semestre
           SET estado = 'borrador', aprobado_por = NULL, aprobado_at = NULL,
               nota = v_nota, updated_at = now()
         WHERE id = v_sem.id;
        INSERT INTO public.bono_semestre_historial (semestre_id, evento, nota, actor)
        VALUES (v_sem.id, 'reabierto', v_nota, v_actor);
        RETURN public.get_bono_semestral(p_semestre);
    END IF;

    IF v_sem.estado = 'aprobado' THEN
        RETURN public.get_bono_semestral(p_semestre);
    END IF;

    IF v_meses[6] >= v_ym_actual THEN
        RAISE EXCEPTION 'SEMESTRE_ABIERTO: % todavía no terminó', p_semestre;
    END IF;
    SELECT count(*) INTO v_faltan FROM unnest(v_meses) m(ym)
     WHERE NOT EXISTS (SELECT 1 FROM public.metas_bono_persona f WHERE f.year_month = m.ym);
    IF v_faltan > 0 THEN
        RAISE EXCEPTION 'MESES_SIN_CERRAR: faltan % mes(es) por cerrar; el cierre corre el día 5', v_faltan;
    END IF;

    v_hoja := public.get_bono_semestral(p_semestre);

    SELECT count(*) INTO v_sin FROM json_array_elements(v_hoja -> 'personas') p
     WHERE NOT (p ->> 'activo')::boolean AND (p ->> 'decision') IS NULL  -- ->>: el JSON null no es un NULL de SQL
       AND (p ->> 'total')::numeric > 0;
    IF v_sin > 0 THEN
        RAISE EXCEPTION 'FALTAN_DECISIONES: % persona(s) que ya no trabajan esperan que se decida si cobran', v_sin;
    END IF;

    INSERT INTO public.bono_semestre_detalle
        (semestre_id, employee_id, total, pagar, status_al_aprobar, por_mes)
    SELECT v_sem.id, (p ->> 'employee_id')::uuid, (p ->> 'total')::numeric,
           coalesce((p ->> 'pagar')::boolean, false), p ->> 'status', (p -> 'por_mes')::jsonb
      FROM json_array_elements(v_hoja -> 'personas') p;

    UPDATE public.bono_semestre
       SET estado = 'aprobado', aprobado_por = v_actor, aprobado_at = now(),
           nota = coalesce(v_nota, nota), updated_at = now()
     WHERE id = v_sem.id;

    INSERT INTO public.bono_semestre_historial (semestre_id, evento, valor, nota, actor)
    SELECT v_sem.id, 'aprobado',
           to_char(coalesce(sum(total) FILTER (WHERE pagar), 0), 'FM999999990.00'), v_nota, v_actor
      FROM public.bono_semestre_detalle WHERE semestre_id = v_sem.id;

    RETURN public.get_bono_semestral(p_semestre);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_bono_semestral(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decidir_bono_semestral(text, uuid, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.aprobar_bono_semestral(text, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.meses_del_semestre(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bono_semestral(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decidir_bono_semestral(text, uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aprobar_bono_semestral(text, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meses_del_semestre(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bono_semestre_asegurar(text) TO service_role;
