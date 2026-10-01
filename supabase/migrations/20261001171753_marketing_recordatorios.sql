-- Planificador de contenido, segunda tanda (pedido del usuario, 2026-10-01):
--   1. Recordatorio del día y piezas vencidas — con un estado «programado»
--      para lo que ya quedó agendado en la red y no hay que recordar.
--   2. Fecha límite para enviar el calendario del mes siguiente.
--   3. Fechas especiales que el calendario sugiere.
--   4. Piezas ligadas a una promoción, y si vendió más durante la pauta.
SET lock_timeout = '5s';

-- ── 1. «Programado»: ya agendado en la red, sale solo ──────────────────────
-- Va entre aprobado y publicado. El recordatorio de las 8:00 no insiste con lo
-- programado, y el mismo cron lo pasa a «publicado» cuando su día ya pasó.
ALTER TABLE public.marketing_piezas DROP CONSTRAINT marketing_piezas_estado_check;
ALTER TABLE public.marketing_piezas ADD CONSTRAINT marketing_piezas_estado_check
    CHECK (estado IN ('pendiente','en_proceso','finalizado','cambios','aprobado','programado','publicado'));

-- El candado de antes, con «programado» en la regla de reabrir: lo programado
-- también es algo que quien aprueba ya vio.
CREATE OR REPLACE FUNCTION public.marketing_candado_de_estado()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
    IF coalesce(current_setting('marketing.por_funcion', true), '') = 'si' THEN
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'marketing_meses' THEN
        IF TG_OP = 'INSERT' THEN
            NEW.estado := 'planificando'; NEW.version := 0;
            NEW.publicado_at := NULL; NEW.publicado_por := NULL;
            NEW.aprobado_at := NULL;  NEW.aprobado_por := NULL;
        ELSIF (NEW.estado, NEW.version, NEW.publicado_at, NEW.publicado_por, NEW.aprobado_at, NEW.aprobado_por)
              IS DISTINCT FROM (OLD.estado, OLD.version, OLD.publicado_at, OLD.publicado_por, OLD.aprobado_at, OLD.aprobado_por) THEN
            RAISE EXCEPTION 'El estado del mes se cambia publicándolo o aprobándolo';
        END IF;
    ELSE
        IF NEW.estado = 'aprobado' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'aprobado') THEN
            RAISE EXCEPTION 'Una pieza la aprueba quien revisa';
        END IF;
        -- Programar es después de aprobar: no se agenda lo que nadie vio.
        IF NEW.estado = 'programado' AND (TG_OP = 'INSERT' OR OLD.estado NOT IN ('aprobado','programado')) THEN
            RAISE EXCEPTION 'Sólo se programa una pieza aprobada';
        END IF;
        IF TG_OP = 'UPDATE' AND (NEW.revisado_por, NEW.revisado_at) IS DISTINCT FROM (OLD.revisado_por, OLD.revisado_at) THEN
            RAISE EXCEPTION 'La revisión la firma quien revisa';
        END IF;
        IF TG_OP = 'INSERT' THEN NEW.revisado_por := NULL; NEW.revisado_at := NULL; END IF;
        -- Tocar lo que se aprobó lo devuelve a revisión: si no, quien aprobó
        -- firmaría una pieza que ya no es la que vio.
        IF TG_OP = 'UPDATE' AND OLD.estado IN ('aprobado','programado') AND NEW.estado = OLD.estado
           AND (NEW.titulo, NEW.copy, NEW.hashtags, NEW.fecha, NEW.hora, NEW.formato, NEW.redes, NEW.marca_id)
               IS DISTINCT FROM
               (OLD.titulo, OLD.copy, OLD.hashtags, OLD.fecha, OLD.hora, OLD.formato, OLD.redes, OLD.marca_id) THEN
            NEW.estado := 'finalizado';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.marketing_archivo_reabre_pieza()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
    UPDATE public.marketing_piezas SET estado = 'finalizado'
     WHERE id = coalesce(NEW.pieza_id, OLD.pieza_id) AND estado IN ('aprobado','programado');
    RETURN NULL;
END $$;

-- ── 4. La promoción de la pieza ────────────────────────────────────────────
ALTER TABLE public.marketing_piezas
    ADD COLUMN promocion_id bigint REFERENCES public.promociones(id) ON DELETE SET NULL;
CREATE INDEX marketing_piezas_promocion_idx ON public.marketing_piezas (promocion_id) WHERE promocion_id IS NOT NULL;

-- ── 2. Ajustes del planificador (una sola fila) ────────────────────────────
CREATE TABLE public.marketing_ajustes (
    id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
    dia_limite_envio      smallint NOT NULL DEFAULT 20 CHECK (dia_limite_envio BETWEEN 1 AND 28),
    recordatorios_activos boolean NOT NULL DEFAULT true,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.marketing_ajustes (id) VALUES (true);
CREATE TRIGGER marketing_ajustes_updated_at BEFORE UPDATE ON public.marketing_ajustes
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. Fechas especiales ───────────────────────────────────────────────────
-- Fija (`mes` + `dia`) o por regla (`regla`) para las que se mueven: la
-- Semana Santa sale de la Pascua y el Black Friday del cuarto jueves de
-- noviembre. La regla la calcula la pantalla; acá sólo se nombra.
CREATE TABLE public.marketing_fechas_especiales (
    id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre     text NOT NULL CHECK (btrim(nombre) <> ''),
    mes        smallint CHECK (mes BETWEEN 1 AND 12),
    dia        smallint CHECK (dia BETWEEN 1 AND 31),
    regla      text CHECK (regla IN ('jueves_santo','viernes_santo','black_friday')),
    idea       text,
    activo     boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((regla IS NOT NULL) <> (mes IS NOT NULL AND dia IS NOT NULL))
);

INSERT INTO public.marketing_fechas_especiales (nombre, mes, dia, regla, idea) VALUES
    ('Año Nuevo',                                 1,  1, NULL, 'Saludo de año nuevo y horarios de atención'),
    ('Día Mundial contra el Cáncer',              2,  4, NULL, 'Prevención y chequeos'),
    ('Día del Amor y la Amistad',                 2, 14, NULL, 'Regalos de cuidado personal'),
    ('Día Internacional de la Mujer',             3,  8, NULL, 'Salud de la mujer'),
    ('Día Mundial de la Salud',                   4,  7, NULL, 'Mensaje institucional de salud'),
    ('Jueves Santo',                           NULL, NULL, 'jueves_santo', 'Horarios de Semana Santa y botiquín de viaje'),
    ('Viernes Santo',                          NULL, NULL, 'viernes_santo', 'Protector solar, hidratación, primeros auxilios'),
    ('Día del Trabajo',                           5,  1, NULL, 'Horarios del feriado'),
    ('Día de la Madre',                           5, 10, NULL, 'Promociones y regalos para mamá'),
    ('Día Internacional de la Enfermería',        5, 12, NULL, 'Reconocimiento al personal de enfermería'),
    ('Día Mundial sin Tabaco',                    5, 31, NULL, 'Dejar de fumar'),
    ('Día del Padre',                             6, 17, NULL, 'Promociones y regalos para papá'),
    ('Día del Maestro',                           6, 22, NULL, 'Reconocimiento a docentes'),
    ('Fiestas Agostinas',                         8,  6, NULL, 'Horarios de vacaciones de agosto'),
    ('Día de la Independencia',                   9, 15, NULL, 'Saludo patrio'),
    ('Día Mundial del Farmacéutico',              9, 25, NULL, 'Reconocimiento a regentes y dependientes'),
    ('Día Mundial del Corazón',                   9, 29, NULL, 'Presión arterial y hábitos sanos'),
    ('Día del Niño',                             10,  1, NULL, 'Cuidado infantil, vitaminas'),
    ('Día Mundial de la Salud Mental',           10, 10, NULL, 'Bienestar emocional'),
    ('Día contra el Cáncer de Mama',             10, 19, NULL, 'Octubre rosa: autoexamen'),
    ('Día de los Difuntos',                      11,  2, NULL, 'Horarios del feriado'),
    ('Día Mundial de la Diabetes',               11, 14, NULL, 'Control de glucosa'),
    ('Black Friday',                           NULL, NULL, 'black_friday', 'Ofertas del fin de semana'),
    ('Nochebuena',                               12, 24, NULL, 'Horarios y saludo navideño'),
    ('Navidad',                                  12, 25, NULL, 'Saludo navideño'),
    ('Fin de año',                               12, 31, NULL, 'Horarios y saludo de fin de año');

-- ── RLS de las dos tablas nuevas ───────────────────────────────────────────
ALTER TABLE public.marketing_ajustes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_fechas_especiales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_ajustes, public.marketing_fechas_especiales FROM anon;
GRANT SELECT, UPDATE ON public.marketing_ajustes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.marketing_fechas_especiales TO authenticated;
GRANT ALL ON public.marketing_ajustes, public.marketing_fechas_especiales TO service_role;

CREATE POLICY marketing_ajustes_select ON public.marketing_ajustes FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('marketing','can_view')));
-- El día límite es un compromiso con gerencia: lo cambia quien aprueba.
CREATE POLICY marketing_ajustes_update ON public.marketing_ajustes FOR UPDATE TO authenticated
    USING ((SELECT public.auth_has_module_permission('marketing','can_approve')))
    WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_approve')));
CREATE POLICY marketing_fechas_select ON public.marketing_fechas_especiales FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('marketing','can_view')));
CREATE POLICY marketing_fechas_insert ON public.marketing_fechas_especiales FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_edit'))
             OR (SELECT public.auth_has_module_permission('marketing','can_approve')));
CREATE POLICY marketing_fechas_update ON public.marketing_fechas_especiales FOR UPDATE TO authenticated
    USING ((SELECT public.auth_has_module_permission('marketing','can_edit'))
        OR (SELECT public.auth_has_module_permission('marketing','can_approve')))
    WITH CHECK ((SELECT public.auth_has_module_permission('marketing','can_edit'))
             OR (SELECT public.auth_has_module_permission('marketing','can_approve')));

-- ── 4. Las promociones que se pueden ligar ─────────────────────────────────
-- El diseñador no tiene el módulo de Promociones, y no tiene por qué: ve sólo
-- nombre, tipo y vigencia, nunca montos ni bonos. Las de los últimos 120 días
-- más las que ya están ligadas a alguna pieza.
CREATE FUNCTION public.marketing_promociones()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
    IF NOT public.auth_has_module_permission('marketing','can_view') THEN
        RAISE EXCEPTION 'FORBIDDEN: el planificador exige ver Marketing';
    END IF;
    RETURN (
        SELECT coalesce(json_agg(t ORDER BY t.estado = 'activa' DESC, t.inicio DESC NULLS LAST), '[]'::json)
          FROM (SELECT p.id, p.nombre, p.tipo, p.estado,
                       coalesce(min(r.inicio), to_date(p.year_month || '-01', 'YYYY-MM-DD')) AS inicio,
                       coalesce(max(r.fin), (to_date(p.year_month || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date) AS fin
                  FROM public.promociones p
                  LEFT JOIN public.promocion_renglon r ON r.promocion_id = p.id
                 WHERE p.estado <> 'borrador'
                   AND (p.updated_at > now() - interval '120 days'
                        OR EXISTS (SELECT 1 FROM public.marketing_piezas mp WHERE mp.promocion_id = p.id))
                 GROUP BY p.id) t
    );
END $$;

-- ── 4. ¿Vendió más durante la pauta? ───────────────────────────────────────
-- Compara las ventas de los productos de la promoción en la ventana de la
-- pauta (o la semana desde la publicación, si no hay pauta) contra la MISMA
-- cantidad de días justo antes. No es causalidad —la temporada también mueve
-- la venta— y la pantalla lo dice así; es la comparación honesta más simple.
--
-- `plpgsql` + `force_custom_plan` (CLAUDE.md, trampa 1): el plan bueno depende
-- de las fechas y de los productos, que son argumentos.
CREATE FUNCTION public.marketing_efecto_en_ventas(p_pieza_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE
    v_p      public.marketing_piezas;
    v_desde  date;
    v_hasta  date;
    v_dias   integer;
    v_prods  integer[];
    v_tipo   text;
    v_dur    json;
    v_antes  json;
BEGIN
    IF NOT public.auth_has_module_permission('marketing','can_view') THEN
        RAISE EXCEPTION 'FORBIDDEN: el planificador exige ver Marketing';
    END IF;
    SELECT * INTO v_p FROM public.marketing_piezas WHERE id = p_pieza_id;
    IF NOT FOUND OR v_p.promocion_id IS NULL THEN RETURN NULL; END IF;

    SELECT coalesce(pa.fecha_inicio, v_p.fecha), coalesce(pa.fecha_fin, pa.fecha_inicio + 6, v_p.fecha + 6)
      INTO v_desde, v_hasta
      FROM (SELECT 1) x LEFT JOIN public.marketing_pautas pa ON pa.pieza_id = p_pieza_id;
    v_hasta := least(v_hasta, (now() AT TIME ZONE 'America/El_Salvador')::date);
    IF v_hasta < v_desde THEN
        RETURN json_build_object('pendiente', true, 'desde', v_desde);
    END IF;
    v_dias := v_hasta - v_desde + 1;

    SELECT tipo INTO v_tipo FROM public.promociones WHERE id = v_p.promocion_id;
    IF v_tipo = 'laboratorio' THEN
        SELECT array_agg(pr.id) INTO v_prods
          FROM public.products pr
          JOIN public.promocion_laboratorio pl ON pl.laboratorio_id = pr.laboratorio_id
         WHERE pl.promocion_id = v_p.promocion_id;
    ELSE
        SELECT array_agg(DISTINCT r.erp_product_id) INTO v_prods
          FROM public.promocion_renglon r WHERE r.promocion_id = v_p.promocion_id;
    END IF;
    IF v_prods IS NULL THEN RETURN json_build_object('sin_productos', true); END IF;

    SELECT json_build_object('unidades', coalesce(sum(ii.cantidad), 0), 'monto', coalesce(sum(ii.total_linea), 0),
                             'facturas', count(DISTINCT si.id))
      INTO v_dur
      FROM public.sales_invoice_items ii
      JOIN public.sales_invoices si ON si.id = ii.invoice_id
     WHERE ii.erp_product_id = ANY (v_prods)
       AND si.fecha BETWEEN v_desde AND v_hasta
       AND public.venta_valida(si.estado);

    SELECT json_build_object('unidades', coalesce(sum(ii.cantidad), 0), 'monto', coalesce(sum(ii.total_linea), 0),
                             'facturas', count(DISTINCT si.id))
      INTO v_antes
      FROM public.sales_invoice_items ii
      JOIN public.sales_invoices si ON si.id = ii.invoice_id
     WHERE ii.erp_product_id = ANY (v_prods)
       AND si.fecha BETWEEN v_desde - v_dias AND v_desde - 1
       AND public.venta_valida(si.estado);

    RETURN json_build_object('desde', v_desde, 'hasta', v_hasta, 'dias', v_dias,
                             'productos', array_length(v_prods, 1), 'durante', v_dur, 'antes', v_antes);
END $$;

-- ── 1 y 2. El recordatorio de las 8:00 ─────────────────────────────────────
CREATE FUNCTION public.marketing_recordatorios_diarios()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_hoy     date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_aj      public.marketing_ajustes;
    v_n       integer := 0;
    v_lista   text;
    v_cuantas integer;
    v_sig     date := (date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')) + interval '1 month')::date;
    v_mes_sig public.marketing_meses;
    v_editan  uuid[] := public.marketing_destinatarios('can_edit');
    v_aprueban uuid[] := public.marketing_destinatarios('can_approve');
BEGIN
    SELECT * INTO v_aj FROM public.marketing_ajustes WHERE id;
    IF NOT coalesce(v_aj.recordatorios_activos, true) THEN RETURN 0; END IF;

    -- Lo programado ya salió solo: pasa a publicado cuando su día quedó atrás.
    UPDATE public.marketing_piezas
       SET estado = 'publicado',
           publicado_en = coalesce(publicado_en, ((fecha + coalesce(hora, '12:00'::time)) AT TIME ZONE 'America/El_Salvador'))
     WHERE estado = 'programado' AND fecha < v_hoy;

    -- Lo de hoy que todavía no está programado ni publicado.
    SELECT count(*), string_agg(titulo || CASE WHEN estado = 'aprobado' THEN '' ELSE ' (' ||
               CASE estado WHEN 'cambios' THEN 'con cambios' WHEN 'finalizado' THEN 'sin aprobar'
                           ELSE 'sin terminar' END || ')' END, ' · ' ORDER BY hora NULLS LAST)
      INTO v_cuantas, v_lista
      FROM public.marketing_piezas
     WHERE fecha = v_hoy AND estado NOT IN ('programado','publicado');
    IF v_cuantas > 0 AND coalesce(array_length(v_editan, 1), 0) > 0 THEN
        v_n := v_n + public.notify_employees(v_editan, 'MARKETING',
            CASE WHEN v_cuantas = 1 THEN 'Hoy toca publicar 1 pieza' ELSE 'Hoy tocan ' || v_cuantas || ' piezas' END,
            left(v_lista, 300) || '. Si ya la agendaste en la red, márcala «Programada».',
            '/marketing?tab=calendario&mes=' || to_char(v_hoy, 'YYYY-MM'), true, '{}'::jsonb, NULL);
    END IF;

    -- Lo que pasó su fecha sin salir (últimos 14 días: más atrás ya no se
    -- publica, se replanifica).
    SELECT count(*), string_agg(titulo || ' (' || to_char(fecha, 'DD/MM') || ')', ' · ' ORDER BY fecha)
      INTO v_cuantas, v_lista
      FROM public.marketing_piezas
     WHERE fecha < v_hoy AND fecha >= v_hoy - 14 AND estado NOT IN ('programado','publicado');
    IF v_cuantas > 0 THEN
        v_n := v_n + public.notify_employees(
            (SELECT array_agg(DISTINCT x) FROM unnest(v_editan || v_aprueban) x), 'MARKETING',
            v_cuantas || CASE WHEN v_cuantas = 1 THEN ' pieza pasó su fecha sin publicarse' ELSE ' piezas pasaron su fecha sin publicarse' END,
            left(v_lista, 300),
            '/marketing?tab=tablero&mes=' || to_char(v_hoy, 'YYYY-MM'), false, '{}'::jsonb, NULL);
    END IF;

    -- El calendario del mes siguiente: tres días antes del límite, el día
    -- antes y el día del límite, al diseñador; vencido, también a quien aprueba
    -- (el día después, una sola vez) y al diseñador cada día hasta que lo envíe.
    SELECT * INTO v_mes_sig FROM public.marketing_meses WHERE mes = v_sig;
    IF v_mes_sig.publicado_at IS NULL THEN
        IF extract(day FROM v_hoy) IN (v_aj.dia_limite_envio - 3, v_aj.dia_limite_envio - 1, v_aj.dia_limite_envio)
           AND coalesce(array_length(v_editan, 1), 0) > 0 THEN
            v_n := v_n + public.notify_employees(v_editan, 'MARKETING',
                'Calendario de ' || public.marketing_nombre_mes(v_sig) || ': ' ||
                CASE WHEN extract(day FROM v_hoy) = v_aj.dia_limite_envio THEN 'hoy es el último día para enviarlo'
                     ELSE 'quedan ' || (v_aj.dia_limite_envio - extract(day FROM v_hoy))::int || ' días para enviarlo' END,
                'El límite es el ' || v_aj.dia_limite_envio || ' de cada mes.',
                '/marketing?tab=calendario&mes=' || to_char(v_sig, 'YYYY-MM'), true, '{}'::jsonb, NULL);
        ELSIF extract(day FROM v_hoy) > v_aj.dia_limite_envio THEN
            v_n := v_n + public.notify_employees(
                CASE WHEN extract(day FROM v_hoy) = v_aj.dia_limite_envio + 1
                     THEN (SELECT array_agg(DISTINCT x) FROM unnest(v_editan || v_aprueban) x)
                     ELSE v_editan END,
                'MARKETING',
                'El calendario de ' || public.marketing_nombre_mes(v_sig) || ' no se ha enviado',
                'Venció el ' || v_aj.dia_limite_envio || '. ' ||
                coalesce((SELECT count(*) FROM public.marketing_piezas WHERE mes_id = v_mes_sig.id), 0) || ' pieza(s) planificadas.',
                '/marketing?tab=calendario&mes=' || to_char(v_sig, 'YYYY-MM'), true, '{}'::jsonb, NULL);
        END IF;
    END IF;

    RETURN v_n;
END $$;

-- ── Permisos de ejecución ──────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.marketing_candado_de_estado()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_archivo_reabre_pieza()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_promociones()            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marketing_efecto_en_ventas(uuid)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marketing_recordatorios_diarios()  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.marketing_promociones()            TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.marketing_efecto_en_ventas(uuid)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.marketing_recordatorios_diarios()  TO service_role;

-- ── El cron: 8:00 de El Salvador (14:00 UTC) ───────────────────────────────
-- SQL puro: no llama a ninguna función ni al sistema de origen.
-- Guarda «sólo si existe» (regla del branch de pruebas).
SELECT cron.unschedule('marketing-recordatorios-8am-sv')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-recordatorios-8am-sv');
SELECT cron.schedule('marketing-recordatorios-8am-sv', '0 14 * * *',
                     $c$SELECT public.marketing_recordatorios_diarios()$c$);
