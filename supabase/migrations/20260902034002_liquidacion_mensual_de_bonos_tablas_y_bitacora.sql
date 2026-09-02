-- La liquidación mensual de bonos — Fase 5 de PLAN-METAS-2026-08-03.md §9c.
--
-- Junta en UNA hoja lo que hoy vive en tres pantallas distintas: el bono de
-- meta de la sala, los bonos de las promociones por producto, el bono de las
-- promociones por laboratorio y los excedentes aprobados. Por persona, con su
-- total. El gerente la aprueba y a partir de ahí queda CONGELADA y exportable
-- para planilla.
--
-- ── En qué mes se paga cada cosa: la decisión que da forma a todo ───────────
-- No es obvio y no se puede improvisar, porque los tres bonos no viven en la
-- misma unidad de tiempo:
--
--   · META y LABORATORIO son mensuales por definición: la meta se fija por mes
--     y el umbral del laboratorio se negocia por mes. Pagan en SU mes.
--
--   · PRODUCTO no. Una promoción por producto vive por LOTE: puede empezar el
--     12 de agosto y cerrarse el 3 de octubre. Paga en el mes en que quedó
--     FINALIZADA, y va entera — no se parte por mes. Dos razones, y las dos son
--     de plata:
--       1. el bono depende del CORTE DEL LOTE, y dónde cae ese corte sólo se
--          sabe cuando la promoción termina: partirla por mes obligaría a pagar
--          en agosto un bono que en octubre resulta que estaba fuera del lote;
--       2. `unidades_por_bono` hace que partir PIERDA dinero. Con 3 unidades
--          por bono, 8 vendidas en agosto y 4 en septiembre son 12 → cuatro
--          bonos enteros. Partido por mes: floor(8/3)=2 más floor(4/3)=1 = 3.
--          Un bono se evapora en el corte del calendario, y nadie lo notaría.
--
--   · EXCEDENTE paga en el mes en que se APROBÓ. No es parte de un programa
--     mensual: es un pago extraordinario que alguien autorizó una fecha, y esa
--     fecha es lo único que lo ubica en el tiempo.
--
-- ── `informativa` se congela, no se deriva ─────────────────────────────────
-- Las bonificaciones están suspendidas (`metas_bono_activo` en false), así que
-- hoy toda liquidación nace informativa: dice «esto se habría ganado». El valor
-- se guarda EN la liquidación y no se vuelve a preguntar, porque el día que se
-- reactiven, un cálculo derivado convertiría en pagables meses viejos que nadie
-- pagó — y la pantalla diría que se debe plata de hace medio año.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · La liquidación de un mes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.liquidacion (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    year_month    text NOT NULL UNIQUE
                  CHECK (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    estado        text NOT NULL DEFAULT 'borrador'
                  CHECK (estado IN ('borrador','aprobada')),
    -- true = «esto se habría ganado». Ver el encabezado.
    informativa   boolean NOT NULL DEFAULT true,
    calculada_at  timestamptz,
    calculada_por uuid REFERENCES public.employees(id),
    aprobada_at   timestamptz,
    aprobada_por  uuid REFERENCES public.employees(id),
    nota          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    -- Una liquidación aprobada SIEMPRE tiene firma y fecha. Sin esto, un UPDATE
    -- que sólo mueva el estado dejaría un mes aprobado por nadie.
    CONSTRAINT liquidacion_aprobada_firmada
        CHECK (estado <> 'aprobada' OR (aprobada_por IS NOT NULL AND aprobada_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_liquidacion_estado ON public.liquidacion (estado, year_month DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · El detalle: una fila por concepto y por persona
-- ─────────────────────────────────────────────────────────────────────────────
-- Se guarda DESGLOSADO y no como un total por persona porque la pregunta que
-- se hace en planilla nunca es «cuánto le toca» a secas: es «cuánto le toca y
-- de dónde sale». Un total sin desglose obliga a recalcular para responderla, y
-- recalcular sobre un mes congelado da otro número.
CREATE TABLE IF NOT EXISTS public.liquidacion_detalle (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    liquidacion_id bigint NOT NULL REFERENCES public.liquidacion(id) ON DELETE CASCADE,
    -- NULL = es un FONDO del área, no de una persona.
    employee_id    uuid REFERENCES public.employees(id),
    branch_id      bigint REFERENCES public.branches(id),
    area           text NOT NULL CHECK (area IN ('persona','administracion','bodega')),
    tipo           text NOT NULL CHECK (tipo IN ('meta','producto','laboratorio','excedente')),
    concepto       text NOT NULL CHECK (btrim(concepto) <> ''),
    monto          numeric(12,2) NOT NULL CHECK (monto >= 0),
    detalle        jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    -- Un fondo no tiene persona y una persona no es un fondo. Sin esto, una
    -- fila mal armada se sumaría dos veces: en el total del área y en el de
    -- alguien.
    CONSTRAINT liquidacion_detalle_persona_o_fondo
        CHECK ((area = 'persona') = (employee_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_liquidacion_detalle_liq
    ON public.liquidacion_detalle (liquidacion_id);
CREATE INDEX IF NOT EXISTS idx_liquidacion_detalle_empleado
    ON public.liquidacion_detalle (employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_liquidacion_detalle_branch
    ON public.liquidacion_detalle (branch_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · La bitácora — append-only, desnormalizada a propósito
-- ─────────────────────────────────────────────────────────────────────────────
-- `year_month` se copia en vez de resolverse por la FK: una bitácora que se
-- borra en cascada con lo que audita no es una bitácora. Aprobar el pago de un
-- bono es exactamente el acto que hay que poder reconstruir después.
CREATE TABLE IF NOT EXISTS public.liquidacion_historial (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    liquidacion_id bigint,
    year_month     text,
    evento         text NOT NULL CHECK (btrim(evento) <> ''),
    valor_antes    text,
    valor_despues  text,
    actor          uuid REFERENCES public.employees(id),
    nota           text,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_liquidacion_historial_liq
    ON public.liquidacion_historial (liquidacion_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_liquidacion_historial_actor
    ON public.liquidacion_historial (actor);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · RLS — leer con el permiso del módulo; escribir sólo por RPC DEFINER
-- ─────────────────────────────────────────────────────────────────────────────
-- Vive en el módulo `promociones` y no en uno nuevo: los cinco cargos que ya lo
-- tienen —Administrador, Supervisión de Ventas, Talento Humano, Gerente General
-- y la cuenta de pruebas— son exactamente el público de esta hoja, y los cinco
-- tienen además `metas` con alcance ALL, que es lo que el cálculo necesita para
-- poder leer el bono de meta.
--
-- El wrapper `(SELECT …)` no es estilo: sin él Postgres evalúa la función por
-- FILA (incidente 2026-07-08, 25,000 ms → 19 ms).
DO $do$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['liquidacion','liquidacion_detalle','liquidacion_historial']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
            'USING ((SELECT public.auth_has_module_permission(''promociones'',''can_view'')))',
            t || '_select', t);
    END LOOP;
END $do$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · liquidacion_log — la única puerta a la bitácora
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liquidacion_log(
    p_liquidacion_id bigint,
    p_year_month     text    DEFAULT NULL,
    p_evento         text    DEFAULT NULL,
    p_valor_antes    text    DEFAULT NULL,
    p_valor_despues  text    DEFAULT NULL,
    p_nota           text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
    IF p_evento IS NULL OR btrim(p_evento) = '' THEN
        RAISE EXCEPTION 'EVENTO_REQUERIDO: la bitácora necesita saber qué pasó';
    END IF;

    INSERT INTO public.liquidacion_historial
        (liquidacion_id, year_month, evento, valor_antes, valor_despues, actor, nota)
    VALUES
        (p_liquidacion_id, p_year_month, btrim(p_evento),
         p_valor_antes, p_valor_despues,
         public.auth_employee_id(),
         nullif(btrim(coalesce(p_nota,'')), ''));
END;
$function$;

COMMENT ON FUNCTION public.liquidacion_log(bigint, text, text, text, text, text) IS
  'Escribe la bitacora de la liquidacion mensual. Solo la llaman las RPC DEFINER del modulo: ni anon ni authenticated tienen EXECUTE.';

REVOKE EXECUTE ON FUNCTION public.liquidacion_log(bigint, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.liquidacion_log(bigint, text, text, text, text, text)
    TO service_role;
