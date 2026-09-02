-- Promociones por LABORATORIO — el segundo tipo: niveles y umbral por sala.
--
-- Fase 4b de docs/planes-cerrados/PLAN-METAS-2026-08-03.md §9b, cuyas
-- definiciones se cerraron con el usuario el 2026-08-03 y no se reabren acá:
-- montos por nivel GLOBALES del programa, lo que cambia por sala es el UMBRAL;
-- cantidad de niveles flexible; «persona base» = todo empleado ACTIVO asignado
-- a esa sala; y la venta se DERIVA de products.laboratorio_id, o sea que la
-- matriz del Excel se llena sola.
--
-- ── Por qué el tipo laboratorio es MENSUAL y el de producto no ───────────────
-- El de producto vive por lote: empieza cuando llega la mercadería y termina
-- cuando se acaba, así que su vigencia sale de los renglones. Éste se mide
-- contra un umbral de venta del MES, que es la unidad en la que el laboratorio
-- negocia y en la que estaba escrito el Excel. Por eso `year_month` y no un par
-- de fechas: un umbral mensual medido sobre 45 días no significa nada.
--
-- ── La medición que decide la forma de la consulta ──────────────────────────
-- Preguntar «cuánto vendió cada sala de estos laboratorios en agosto» costaba
-- 1,511 ms hecho de la manera obvia. El plan entraba por las 21,603 facturas
-- del mes y sondeaba `sales_invoice_items` una por una: 28,954 heap fetches
-- para devolver seis filas.
--
-- Baja a 26 ms —58×— con tres cosas, y las tres importan:
--
--   1. `facturas` trae SÓLO (id, branch_id), que es exactamente lo que cubre
--      `idx_si_fecha_estado_branch`. Agregarle una columna más —probé con
--      cod_vendedor— rompe el index-only y el mismo plan pasa a 210 ms: 6,065
--      bloques de heap en vez de 960 fetches.
--   2. Una CERCA de ids. Los ids de `sales_invoices` están correlacionados con
--      la fecha (agosto ocupa 25,140 ids consecutivos para 21,660 facturas), y
--      `idx_sii_product_invoice` es (erp_product_id, invoice_id): con
--      `invoice_id BETWEEN lo AND hi` el rango entra como CONDICIÓN DE ÍNDICE y
--      no como filtro. La cerca es una optimización pura — el join con
--      `facturas` sigue siendo quien decide qué factura cuenta.
--   3. La cerca sale del CTE `facturas`, nunca de un `min(id) … WHERE fecha`
--      suelto: así escrito, el planificador recorre la PK descartando 338,764
--      filas y la consulta entera sube a 3,130 ms. Es la trampa que más se
--      parece a la corrección.
--
-- ── Por qué existe `promocion_cierre_sala` ──────────────────────────────────
-- Mientras el mes está abierto el nivel se calcula en vivo. Cuando cierra se
-- CONGELA: la venta, el nivel alcanzado, el monto y a cuánta gente le tocó.
-- Sin eso, editarle el umbral a un mes ya pagado le cambiaría el bono a alguien
-- que ya cobró — que es la regla «sin retroactividad» de §9c dicha en tablas.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · La promoción aprende que hay dos tipos
-- ─────────────────────────────────────────────────────────────────────────────
-- `tipo` nace en 'producto' porque es lo único que existía: las filas que ya
-- están son todas de ese tipo por construcción.
ALTER TABLE public.promociones
    ADD COLUMN IF NOT EXISTS tipo        text NOT NULL DEFAULT 'producto',
    ADD COLUMN IF NOT EXISTS year_month  text,
    ADD COLUMN IF NOT EXISTS paga        text,
    ADD COLUMN IF NOT EXISTS supplier_id integer REFERENCES public.suppliers(id);

ALTER TABLE public.promociones
    DROP CONSTRAINT IF EXISTS promociones_tipo_check,
    DROP CONSTRAINT IF EXISTS promociones_mes_segun_tipo,
    DROP CONSTRAINT IF EXISTS promociones_paga_valido,
    DROP CONSTRAINT IF EXISTS promociones_proveedor_con_nombre;

ALTER TABLE public.promociones
    ADD CONSTRAINT promociones_tipo_check
        CHECK (tipo IN ('producto','laboratorio')),
    -- El mes es obligatorio en laboratorio y prohibido en producto: si fuera
    -- sólo «opcional», una promoción de producto con mes escrito se leería como
    -- una vigencia que nadie respeta.
    ADD CONSTRAINT promociones_mes_segun_tipo
        CHECK (CASE tipo
                 WHEN 'laboratorio' THEN year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
                 ELSE year_month IS NULL END),
    ADD CONSTRAINT promociones_paga_valido
        CHECK (paga IS NULL OR paga IN ('empresa','proveedor')),
    ADD CONSTRAINT promociones_proveedor_con_nombre
        CHECK (paga IS DISTINCT FROM 'proveedor' OR supplier_id IS NOT NULL);

COMMENT ON COLUMN public.promociones.tipo IS
  'producto = por unidades vendidas de ciertos productos (renglones). laboratorio = por venta mensual de uno o mas laboratorios contra un umbral por sala.';
COMMENT ON COLUMN public.promociones.year_month IS
  'YYYY-MM. Solo en tipo laboratorio: el umbral se negocia por mes, y medirlo sobre otra ventana no significa nada.';

CREATE INDEX IF NOT EXISTS idx_promociones_tipo_mes
    ON public.promociones (tipo, year_month DESC);
CREATE INDEX IF NOT EXISTS idx_promociones_supplier
    ON public.promociones (supplier_id) WHERE supplier_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Los laboratorios del programa (uno o más)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promocion_laboratorio (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    promocion_id   bigint NOT NULL REFERENCES public.promociones(id) ON DELETE CASCADE,
    laboratorio_id integer NOT NULL REFERENCES public.laboratorios(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (promocion_id, laboratorio_id)
);
CREATE INDEX IF NOT EXISTS idx_promocion_laboratorio_promo
    ON public.promocion_laboratorio (promocion_id);
CREATE INDEX IF NOT EXISTS idx_promocion_laboratorio_lab
    ON public.promocion_laboratorio (laboratorio_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · Los niveles: el MONTO es global del programa
-- ─────────────────────────────────────────────────────────────────────────────
-- Ej. $10 / $20 / $30 / $40, iguales para las seis salas. La cantidad de
-- niveles la decide quien crea el programa; no hay cuatro fijos.
CREATE TABLE IF NOT EXISTS public.promocion_nivel (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    promocion_id      bigint NOT NULL REFERENCES public.promociones(id) ON DELETE CASCADE,
    nivel             smallint NOT NULL CHECK (nivel >= 1),
    monto_por_persona numeric(10,2) NOT NULL CHECK (monto_por_persona > 0),
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (promocion_id, nivel)
);
CREATE INDEX IF NOT EXISTS idx_promocion_nivel_promo
    ON public.promocion_nivel (promocion_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · El umbral: lo que cambia por SALA
-- ─────────────────────────────────────────────────────────────────────────────
-- La matriz del Excel, tal cual: Salud 4 necesita $4,250 para el nivel 1 y
-- Salud 5 sólo $1,800. Una sala sin fila en un nivel NO puede alcanzarlo — es
-- la manera de dejar un nivel fuera del alcance de una sala sin inventarle un
-- umbral infinito.
CREATE TABLE IF NOT EXISTS public.promocion_nivel_umbral (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    promocion_id  bigint NOT NULL REFERENCES public.promociones(id) ON DELETE CASCADE,
    nivel         smallint NOT NULL CHECK (nivel >= 1),
    branch_id     bigint NOT NULL REFERENCES public.branches(id),
    umbral_venta  numeric(12,2) NOT NULL CHECK (umbral_venta > 0),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (promocion_id, nivel, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_promocion_nivel_umbral_promo
    ON public.promocion_nivel_umbral (promocion_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_promocion_nivel_umbral_branch
    ON public.promocion_nivel_umbral (branch_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · El cierre congelado del mes
-- ─────────────────────────────────────────────────────────────────────────────
-- `personas` y `monto_por_persona` se guardan aunque se puedan recalcular: el
-- padrón de la sala cambia —alguien renuncia el 3 del mes siguiente— y el
-- número que se pagó tiene que seguir siendo el que se pagó.
CREATE TABLE IF NOT EXISTS public.promocion_cierre_sala (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    promocion_id      bigint NOT NULL REFERENCES public.promociones(id) ON DELETE CASCADE,
    branch_id         bigint NOT NULL REFERENCES public.branches(id),
    venta             numeric(12,2) NOT NULL CHECK (venta >= 0),
    nivel             smallint,                    -- NULL = no alcanzó ninguno
    monto_por_persona numeric(10,2) NOT NULL DEFAULT 0 CHECK (monto_por_persona >= 0),
    personas          integer NOT NULL DEFAULT 0 CHECK (personas >= 0),
    costo             numeric(12,2) NOT NULL DEFAULT 0 CHECK (costo >= 0),
    cerrado_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (promocion_id, branch_id),
    -- Sin nivel no se paga, y con nivel el monto tiene que existir. Evita la
    -- fila «alcanzó el nivel 2 y le tocan $0», que se leería como un error de
    -- la sala y no del programa.
    CONSTRAINT promocion_cierre_sala_nivel_con_monto
        CHECK ((nivel IS NULL AND monto_por_persona = 0)
            OR (nivel IS NOT NULL AND monto_por_persona > 0))
);
CREATE INDEX IF NOT EXISTS idx_promocion_cierre_sala_promo
    ON public.promocion_cierre_sala (promocion_id);
CREATE INDEX IF NOT EXISTS idx_promocion_cierre_sala_branch
    ON public.promocion_cierre_sala (branch_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6 · RLS — leer con el permiso del módulo; escribir sólo por RPC DEFINER
-- ─────────────────────────────────────────────────────────────────────────────
-- El wrapper `(SELECT …)` no es estilo: sin él Postgres evalúa la función por
-- FILA (incidente 2026-07-08, 25,000 ms → 19 ms).
DO $do$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['promocion_laboratorio','promocion_nivel',
                             'promocion_nivel_umbral','promocion_cierre_sala']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
            'USING ((SELECT public.auth_has_module_permission(''promociones'',''can_view'')))',
            t || '_select', t);
    END LOOP;
END $do$;
