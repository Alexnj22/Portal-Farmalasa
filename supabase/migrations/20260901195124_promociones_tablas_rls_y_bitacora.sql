-- Promociones por producto — las tablas, el RLS y la bitácora del módulo.
--
-- Fase 4 de docs/planes-cerrados/PLAN-METAS-2026-08-03.md §9a, cerrada de nuevo
-- con el usuario el 2026-09-01. El diseño y las mediciones que lo fundamentan
-- están en docs/PLAN-PROMOCIONES-2026-09-01.md; acá sólo el esquema.
--
-- Tres cosas que se midieron y que explican por qué el modelo es éste:
--
--   1. El LOTE es declarado, no derivado de las compras. Estos productos se
--      compran de rutina todos los meses (Loraler 11 veces en 5 meses,
--      Orfenaflex 7): derivarlo de la ventana de fechas haría que un
--      reabastecimiento normal suba el techo y la promoción no se acabe nunca.
--
--   2. La presentación se guarda como FACTOR, no como rótulo. De las 39,329
--      líneas de venta de agosto, `id_presentacion` es NULL en el 100%, hay 283
--      etiquetas distintas (217 normalizadas) y sólo 29 factores. Agrupar por el
--      texto partiría en dos una presentación que es una sola: el mismo producto
--      se factura como `CAJA 1x100` y `CAJA 1X100`.
--
--   3. Las compras YA vienen en unidades base (razón comprado/vendido = 1.02
--      sobre 1,265 productos), así que el lote y lo vendido se comparan sin
--      convertir. Por eso `lote_total` es un entero de unidades y no lleva
--      unidad adjunta.
--
-- El módulo se llama `promociones` y hereda el slot de `bonificaciones`, que
-- existía como «próximamente» desde que se retiró el módulo viejo el
-- 2026-07-28. Se renombra la clave para que coincida con la ruta /promociones
-- (moduleMap resuelve por el primer segmento) y se conservan los permisos que ya
-- estaban repartidos.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 0 · El módulo: `bonificaciones` pasa a llamarse `promociones`
-- ─────────────────────────────────────────────────────────────────────────────
-- Las 21 filas existentes se conservan (4 cargos con permiso: Administrador,
-- Supervisor/a de Ventas, QA/Testing y Jefe/a de Talento Humano). Se agrega
-- Gerente General con ver + aprobar, para que el excedente se pueda decidir
-- cuando Supervisión no está.
UPDATE public.role_permissions
   SET module_key = 'promociones'
 WHERE module_key = 'bonificaciones';

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'promociones', true, false, true, 'ALL'
  FROM public.roles r
 WHERE r.name = 'Gerente General'
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.role_id = r.id AND rp.module_key = 'promociones');

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · La promoción
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promociones (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre      text NOT NULL CHECK (btrim(nombre) <> ''),
    estado      text NOT NULL DEFAULT 'borrador'
                CHECK (estado IN ('borrador','activa','finalizada')),
    nota        text,
    creado_por  uuid REFERENCES public.employees(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.promociones IS
  'Una campaña de un laboratorio: varios productos con su lote y sus montos. La VIGENCIA no vive acá — se deriva de los renglones, porque extender un producto extiende la promoción (decisión del usuario 2026-09-01).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · El renglón: un producto de la promoción
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promocion_renglon (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    promocion_id    bigint  NOT NULL REFERENCES public.promociones(id) ON DELETE CASCADE,
    erp_product_id  integer NOT NULL REFERENCES public.products(id),
    factor_unidades smallint CHECK (factor_unidades IS NULL OR factor_unidades > 0),
    inicio          date NOT NULL,
    fin             date NOT NULL,
    lote_total      integer NOT NULL CHECK (lote_total > 0),
    estado          text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
    cerrado_at      timestamptz,
    cerrado_motivo  text CHECK (cerrado_motivo IS NULL
                                OR cerrado_motivo IN ('lote_agotado','fin_de_vigencia')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT promocion_renglon_vigencia CHECK (fin >= inicio),
    -- Un renglón cerrado siempre dice CUÁNDO y POR QUÉ. Sin esto, «cerrado» es
    -- un estado del que no se puede rendir cuentas.
    CONSTRAINT promocion_renglon_cierre_completo
      CHECK (estado <> 'cerrado' OR (cerrado_at IS NOT NULL AND cerrado_motivo IS NOT NULL))
);

COMMENT ON COLUMN public.promocion_renglon.factor_unidades IS
  'NULL = cualquier presentación, y se paga por unidad base. Con un factor, sólo cuentan las ventas hechas en esa presentación y el monto es POR esa presentación. Se guarda el factor y no el rótulo porque el rótulo está sucio: 283 etiquetas para 29 factores.';
COMMENT ON COLUMN public.promocion_renglon.lote_total IS
  'Unidades base negociadas con el laboratorio. DECLARADO, no derivado de las compras: estos productos se compran de rutina cada mes y derivarlo haría que la promoción no se acabe nunca.';

-- El mismo producto no se repite dentro de una promoción. Dos índices parciales
-- en vez de un UNIQUE: en Postgres los NULL son distintos entre sí, así que un
-- UNIQUE sobre (promocion_id, erp_product_id, factor_unidades) dejaría meter dos
-- veces el mismo producto con «cualquier presentación».
CREATE UNIQUE INDEX IF NOT EXISTS promocion_renglon_producto_cualquiera_uq
    ON public.promocion_renglon (promocion_id, erp_product_id)
 WHERE factor_unidades IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS promocion_renglon_producto_factor_uq
    ON public.promocion_renglon (promocion_id, erp_product_id, factor_unidades)
 WHERE factor_unidades IS NOT NULL;

CREATE INDEX IF NOT EXISTS promocion_renglon_promocion_idx
    ON public.promocion_renglon (promocion_id);
CREATE INDEX IF NOT EXISTS promocion_renglon_producto_idx
    ON public.promocion_renglon (erp_product_id);
-- El cierre diario sólo mira los abiertos.
CREATE INDEX IF NOT EXISTS promocion_renglon_abiertos_idx
    ON public.promocion_renglon (fin) WHERE estado = 'abierto';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · La tarifa, con fecha: editar un monto NO reescribe lo ya ganado
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promocion_renglon_tarifa (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    renglon_id        bigint NOT NULL REFERENCES public.promocion_renglon(id) ON DELETE CASCADE,
    desde             date NOT NULL,
    bono_vendedor     numeric(10,4) NOT NULL DEFAULT 0 CHECK (bono_vendedor >= 0),
    bono_adm          numeric(10,4) NOT NULL DEFAULT 0 CHECK (bono_adm     >= 0),
    bono_bodega       numeric(10,4) NOT NULL DEFAULT 0 CHECK (bono_bodega  >= 0),
    unidades_por_bono integer NOT NULL DEFAULT 1 CHECK (unidades_por_bono >= 1),
    creado_por        uuid REFERENCES public.employees(id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (renglon_id, desde)
);

COMMENT ON TABLE public.promocion_renglon_tarifa IS
  'Los tres montos por unidad, con la fecha desde la que rigen. Cambiar un monto agrega una fila; el cálculo toma la vigente a la FECHA DE CADA VENTA. Así «sin retroactividad» es cierto por construcción y no por acordarse.';

CREATE INDEX IF NOT EXISTS promocion_renglon_tarifa_renglon_idx
    ON public.promocion_renglon_tarifa (renglon_id, desde DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · El reparto del lote entre las salas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promocion_reparto (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    renglon_id        bigint NOT NULL REFERENCES public.promocion_renglon(id) ON DELETE CASCADE,
    branch_id         bigint NOT NULL REFERENCES public.branches(id),
    asignado_original integer NOT NULL CHECK (asignado_original >= 0),
    asignado_vigente  integer NOT NULL CHECK (asignado_vigente  >= 0),
    avisado_80_at     timestamptz,
    avisado_100_at    timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (renglon_id, branch_id)
);

COMMENT ON COLUMN public.promocion_reparto.asignado_original IS
  'Lo que se escribió al crear la promoción. No se toca nunca: es contra esto que se mide la desviación.';
COMMENT ON COLUMN public.promocion_reparto.asignado_vigente IS
  'Lo asignado HOY. Los traslados lo mueven al confirmarse la llegada — baja en la sala que envía, sube en la que recibe — y el total de la promoción no cambia.';

CREATE INDEX IF NOT EXISTS promocion_reparto_branch_idx
    ON public.promocion_reparto (branch_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · Cada movimiento del lote entre salas, para poder explicarlo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promocion_reparto_mov (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    renglon_id        bigint NOT NULL REFERENCES public.promocion_renglon(id) ON DELETE CASCADE,
    branch_id_origen  bigint REFERENCES public.branches(id),
    branch_id_destino bigint REFERENCES public.branches(id),
    unidades          integer NOT NULL CHECK (unidades > 0),
    -- Los tres circuitos de traslado son distintos y se enganchan aparte; saber
    -- de cuál vino un movimiento es lo que permite auditarlo después.
    circuito          text NOT NULL CHECK (circuito IN ('pedido','solicitud','envio','manual')),
    origen_ref        text,
    movido_por        uuid REFERENCES public.employees(id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT promocion_reparto_mov_dos_puntas
      CHECK (branch_id_origen IS NOT NULL OR branch_id_destino IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS promocion_reparto_mov_renglon_idx
    ON public.promocion_reparto_mov (renglon_id, created_at DESC);
CREATE INDEX IF NOT EXISTS promocion_reparto_mov_origen_idx
    ON public.promocion_reparto_mov (branch_id_origen) WHERE branch_id_origen IS NOT NULL;
CREATE INDEX IF NOT EXISTS promocion_reparto_mov_destino_idx
    ON public.promocion_reparto_mov (branch_id_destino) WHERE branch_id_destino IS NOT NULL;
CREATE INDEX IF NOT EXISTS promocion_reparto_mov_actor_idx
    ON public.promocion_reparto_mov (movido_por) WHERE movido_por IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6 · El excedente: lo vendido de más, que decide Supervisión
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promocion_excedente (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    renglon_id   bigint NOT NULL REFERENCES public.promocion_renglon(id) ON DELETE CASCADE,
    employee_id  uuid   NOT NULL REFERENCES public.employees(id),
    branch_id    bigint REFERENCES public.branches(id),
    unidades     integer NOT NULL CHECK (unidades > 0),
    monto        numeric(12,2) NOT NULL CHECK (monto >= 0),
    estado       text NOT NULL DEFAULT 'por_decidir'
                 CHECK (estado IN ('por_decidir','aprobado','negado')),
    decidido_por uuid REFERENCES public.employees(id),
    decidido_at  timestamptz,
    motivo       text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT promocion_excedente_decision_firmada
      CHECK (estado = 'por_decidir' OR (decidido_por IS NOT NULL AND decidido_at IS NOT NULL)),
    -- Negar sin decir por qué deja a la persona sin nada que reclamar.
    CONSTRAINT promocion_excedente_negado_con_motivo
      CHECK (estado <> 'negado' OR btrim(coalesce(motivo,'')) <> ''),
    UNIQUE (renglon_id, employee_id)
);

COMMENT ON TABLE public.promocion_excedente IS
  'Lo vendido por encima del lote. NO se paga solo ni se niega solo: va a Supervisión, y mientras se decide se muestra aparte sin sumar — nadie ve un número que después le baja.';

CREATE INDEX IF NOT EXISTS promocion_excedente_por_decidir_idx
    ON public.promocion_excedente (created_at DESC) WHERE estado = 'por_decidir';
CREATE INDEX IF NOT EXISTS promocion_excedente_empleado_idx
    ON public.promocion_excedente (employee_id);
CREATE INDEX IF NOT EXISTS promocion_excedente_branch_idx
    ON public.promocion_excedente (branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS promocion_excedente_decisor_idx
    ON public.promocion_excedente (decidido_por) WHERE decidido_por IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7 · La bitácora del módulo — calcada de `metas_historial`
-- ─────────────────────────────────────────────────────────────────────────────
-- Las referencias son ON DELETE SET NULL y los ids van desnormalizados a
-- propósito: una bitácora que se borra en cascada con lo que audita no es una
-- bitácora.
CREATE TABLE IF NOT EXISTS public.promocion_historial (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    promocion_id  bigint REFERENCES public.promociones(id)       ON DELETE SET NULL,
    renglon_id    bigint REFERENCES public.promocion_renglon(id) ON DELETE SET NULL,
    branch_id     bigint,
    evento        text NOT NULL,
    valor_antes   text,
    valor_despues text,
    actor         uuid,          -- NULL = lo hizo el portal (el cierre diario), no una persona
    nota          text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promocion_historial_promocion_idx
    ON public.promocion_historial (promocion_id, created_at DESC);
CREATE INDEX IF NOT EXISTS promocion_historial_renglon_idx
    ON public.promocion_historial (renglon_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8 · RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- El envoltorio `(SELECT …)` NO es estilo: sin él Postgres evalúa la función por
-- FILA. Incidente del 2026-07-08 — un count de 27K filas pasó de 25,000 ms a
-- 19 ms al ponerlo. El advisor de Supabase no lo detecta.
--
-- Ninguna tabla lleva policy de INSERT/UPDATE/DELETE: se escriben SÓLO por las
-- funciones DEFINER, que mantienen el estado y la bitácora en la misma
-- transacción.
ALTER TABLE public.promociones              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocion_renglon        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocion_renglon_tarifa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocion_reparto        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocion_reparto_mov    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocion_excedente      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocion_historial      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promociones_select ON public.promociones;
CREATE POLICY promociones_select ON public.promociones
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('promociones','can_view')));

DROP POLICY IF EXISTS promocion_renglon_select ON public.promocion_renglon;
CREATE POLICY promocion_renglon_select ON public.promocion_renglon
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('promociones','can_view')));

DROP POLICY IF EXISTS promocion_renglon_tarifa_select ON public.promocion_renglon_tarifa;
CREATE POLICY promocion_renglon_tarifa_select ON public.promocion_renglon_tarifa
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('promociones','can_view')));

-- El reparto sí tiene sala, así que se acota: el día que una sala tenga el
-- módulo, ve el suyo y no el de las demás.
DROP POLICY IF EXISTS promocion_reparto_select ON public.promocion_reparto;
CREATE POLICY promocion_reparto_select ON public.promocion_reparto
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('promociones','can_view'))
        AND CASE (SELECT public.auth_module_scope('promociones'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE branch_id = (SELECT public.auth_employee_branch_id())
            END
    );

DROP POLICY IF EXISTS promocion_reparto_mov_select ON public.promocion_reparto_mov;
CREATE POLICY promocion_reparto_mov_select ON public.promocion_reparto_mov
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('promociones','can_view'))
        AND CASE (SELECT public.auth_module_scope('promociones'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE branch_id_origen  = (SELECT public.auth_employee_branch_id())
                OR branch_id_destino = (SELECT public.auth_employee_branch_id())
            END
    );

-- Cada quien ve SU excedente aunque no tenga el módulo: es plata suya. Y quien
-- puede aprobar los ve todos, que es la cola de decisión.
DROP POLICY IF EXISTS promocion_excedente_select ON public.promocion_excedente;
CREATE POLICY promocion_excedente_select ON public.promocion_excedente
    FOR SELECT TO authenticated
    USING (
        employee_id = (SELECT public.auth_employee_id())
        OR (SELECT public.auth_has_module_permission('promociones','can_approve'))
        OR (SELECT public.auth_has_module_permission('promociones','can_view'))
    );

DROP POLICY IF EXISTS promocion_historial_select ON public.promocion_historial;
CREATE POLICY promocion_historial_select ON public.promocion_historial
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('promociones','can_view')));

REVOKE ALL ON public.promociones,              public.promocion_renglon,
              public.promocion_renglon_tarifa, public.promocion_reparto,
              public.promocion_reparto_mov,    public.promocion_excedente,
              public.promocion_historial
  FROM anon;

GRANT SELECT ON public.promociones,              public.promocion_renglon,
                public.promocion_renglon_tarifa, public.promocion_reparto,
                public.promocion_reparto_mov,    public.promocion_excedente,
                public.promocion_historial
   TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9 · `promocion_log` — la única puerta a la bitácora
-- ─────────────────────────────────────────────────────────────────────────────
-- Calcada de `metas_log`: ni siquiera un usuario logueado puede llamarla. La
-- invocan con PERFORM las RPC DEFINER del módulo, en la misma transacción que la
-- escritura que registran.
CREATE OR REPLACE FUNCTION public.promocion_log(
    p_promocion_id  bigint,
    p_renglon_id    bigint  DEFAULT NULL,
    p_branch_id     bigint  DEFAULT NULL,
    p_evento        text    DEFAULT NULL,
    p_valor_antes   text    DEFAULT NULL,
    p_valor_despues text    DEFAULT NULL,
    p_nota          text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
    IF p_evento IS NULL OR btrim(p_evento) = '' THEN
        RAISE EXCEPTION 'EVENTO_REQUERIDO: la bitácora necesita saber qué pasó';
    END IF;

    INSERT INTO public.promocion_historial
        (promocion_id, renglon_id, branch_id, evento,
         valor_antes, valor_despues, actor, nota)
    VALUES
        (p_promocion_id, p_renglon_id, p_branch_id, btrim(p_evento),
         p_valor_antes, p_valor_despues,
         public.auth_employee_id(),          -- NULL cuando lo hace el cron
         nullif(btrim(coalesce(p_nota,'')), ''));
END;
$function$;

COMMENT ON FUNCTION public.promocion_log(bigint, bigint, bigint, text, text, text, text) IS
  'Escribe la bitácora de Promociones. Sólo la llaman las RPC DEFINER del módulo: ni anon ni authenticated tienen EXECUTE.';

REVOKE EXECUTE ON FUNCTION public.promocion_log(bigint, bigint, bigint, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promocion_log(bigint, bigint, bigint, text, text, text, text)
    TO service_role;
