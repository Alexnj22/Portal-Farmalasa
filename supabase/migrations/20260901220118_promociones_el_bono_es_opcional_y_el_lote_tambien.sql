-- Promociones — no toda promoción paga bono, y no toda tiene lote.
--
-- Dos cosas que el diseño daba por hechas y el usuario corrigió al ver la
-- pantalla (2026-09-01):
--
--   1. **Una promoción puede no pagar bono.** A veces la campaña sólo sirve para
--      MEDIR: qué se vendió de esos productos en esas fechas. Obligar a poner
--      montos convierte una medición en un pago que nadie acordó. Y cuando SÍ
--      hay bono, hace falta saber **quién lo cancela**: la empresa o un
--      proveedor — y cuál.
--
--   2. **El lote y el reparto no siempre se saben.** «Si no se tiene el dato de
--      reparto por sala ni la cuenta de compra, que permita guardar»: una
--      promoción que empezó hace tres días se registra igual y cuenta las ventas
--      de esas fechas. Exigir el lote para poder guardar deja la campaña sin
--      registrar justo cuando ya está corriendo.
--
-- La decisión de bono es POR PRODUCTO (elección del usuario): una misma campaña
-- puede mezclar productos que pagan con productos que sólo se miden.
--
-- El proveedor sale de `suppliers` —los 127 a los que realmente se les factura,
-- sincronizados del sistema— y no de la lista corta del portal: no hay que
-- mantenerla a mano y ya contiene a quien emite la nota de crédito.

SET lock_timeout = '5s';

-- ── El lote deja de ser obligatorio ─────────────────────────────────────────
-- Sin lote no hay techo: no cierra por «lote agotado», no hay aviso del 80% y no
-- hay excedente. Todo eso cae solo, porque las tres cosas se calculan CONTRA el
-- lote y una comparación con NULL no es cierta. La promoción sigue midiendo.
ALTER TABLE public.promocion_renglon
    ALTER COLUMN lote_total DROP NOT NULL;

COMMENT ON COLUMN public.promocion_renglon.lote_total IS
  'Unidades base negociadas, o NULL si todavía no se sabe. DECLARADO, no derivado de las compras: estos productos se compran de rutina cada mes. Sin lote la promoción sólo MIDE — no cierra por agotarse, no avisa al 80% y no genera excedentes.';

-- ── ¿Tiene bono? y quién lo paga ────────────────────────────────────────────
ALTER TABLE public.promocion_renglon
    ADD COLUMN IF NOT EXISTS tiene_bono  boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS paga        text,
    ADD COLUMN IF NOT EXISTS supplier_id integer REFERENCES public.suppliers(id);

COMMENT ON COLUMN public.promocion_renglon.tiene_bono IS
  'Si es falso, este producto sólo se MIDE: no paga nada a nadie y sus montos no se piden.';
COMMENT ON COLUMN public.promocion_renglon.paga IS
  'Quién cancela el bono: la empresa o un proveedor. NULL cuando no hay bono.';
COMMENT ON COLUMN public.promocion_renglon.supplier_id IS
  'El proveedor que paga, de `suppliers`. Obligatorio cuando paga = proveedor: «lo paga un proveedor» sin decir cuál no se puede cobrar.';

-- Las tres reglas, en la base y no en la pantalla: un formulario se puede
-- saltar, un CHECK no.
ALTER TABLE public.promocion_renglon
    DROP CONSTRAINT IF EXISTS promocion_renglon_paga_valido;
ALTER TABLE public.promocion_renglon
    ADD CONSTRAINT promocion_renglon_paga_valido
    CHECK (paga IS NULL OR paga IN ('empresa','proveedor'));

ALTER TABLE public.promocion_renglon
    DROP CONSTRAINT IF EXISTS promocion_renglon_bono_dice_quien_paga;
ALTER TABLE public.promocion_renglon
    ADD CONSTRAINT promocion_renglon_bono_dice_quien_paga
    CHECK (NOT tiene_bono OR paga IS NOT NULL);

ALTER TABLE public.promocion_renglon
    DROP CONSTRAINT IF EXISTS promocion_renglon_proveedor_con_nombre;
ALTER TABLE public.promocion_renglon
    ADD CONSTRAINT promocion_renglon_proveedor_con_nombre
    CHECK (paga IS DISTINCT FROM 'proveedor' OR supplier_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS promocion_renglon_supplier_idx
    ON public.promocion_renglon (supplier_id) WHERE supplier_id IS NOT NULL;

-- ── El corte del lote ignora los renglones sin lote ─────────────────────────
-- Sin techo no hay excedente. Antes `lote_total - (acum - u_base)` con NULL daba
-- NULL, y `greatest(least(u_base, NULL), 0)` devuelve 0 — o sea que TODO habría
-- caído en excedente. Es el modo de falla clásico: no lanza, contesta al revés.
CREATE OR REPLACE FUNCTION public.promocion_corte_del_lote(p_promocion_id bigint DEFAULT NULL)
RETURNS TABLE (
    renglon_id      bigint,
    promocion_id    bigint,
    cod_vendedor    text,
    employee_id     uuid,
    branch_id       bigint,
    u_dentro        numeric,
    u_excedente     numeric,
    monto_dentro    numeric,
    monto_excedente numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_ini   date;
    v_fin   date;
    v_prods integer[];
BEGIN
    SELECT min(r.inicio), max(r.fin), array_agg(DISTINCT r.erp_product_id)
      INTO v_ini, v_fin, v_prods
      FROM public.promocion_renglon r
     WHERE r.lote_total IS NOT NULL
       AND (p_promocion_id IS NULL OR r.promocion_id = p_promocion_id);

    IF v_ini IS NULL THEN RETURN; END IF;

    RETURN QUERY
    WITH facturas AS MATERIALIZED (
        SELECT si.id, si.branch_id, si.cod_vendedor, si.fecha
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    ),
    items AS MATERIALIZED (
        SELECT ii.id, ii.invoice_id, ii.erp_product_id, ii.factor_unidades, ii.cantidad
          FROM public.sales_invoice_items ii
         WHERE ii.erp_product_id = ANY (v_prods)
    ),
    lineas AS (
        SELECT r.id AS renglon_id, r.promocion_id, r.lote_total,
               f.id AS invoice_id, i.id AS item_id,
               f.branch_id, f.cod_vendedor, f.fecha,
               (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric AS u_base,
               CASE WHEN r.factor_unidades IS NULL
                    THEN (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric
                    ELSE i.cantidad::numeric
               END AS u_pago
          FROM items i
          JOIN facturas f ON f.id = i.invoice_id
          JOIN public.promocion_renglon r
            ON r.erp_product_id = i.erp_product_id
           AND f.fecha BETWEEN r.inicio AND r.fin
           AND (r.factor_unidades IS NULL OR i.factor_unidades = r.factor_unidades)
           AND r.lote_total IS NOT NULL      -- sin techo no hay excedente
           AND r.tiene_bono                  -- sin bono no hay nada que decidir
           AND (p_promocion_id IS NULL OR r.promocion_id = p_promocion_id)
         WHERE NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v
                            WHERE v.invoice_id = f.id)
    ),
    con_tarifa AS (
        SELECT l.*, t.bono_vendedor
          FROM lineas l
          JOIN LATERAL (
              SELECT tt.bono_vendedor FROM public.promocion_renglon_tarifa tt
               WHERE tt.renglon_id = l.renglon_id AND tt.desde <= l.fecha
               ORDER BY tt.desde DESC LIMIT 1
          ) t ON true
    ),
    ordenadas AS (
        SELECT c.*,
               sum(c.u_base) OVER (PARTITION BY c.renglon_id
                                   ORDER BY c.fecha, c.invoice_id, c.item_id
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acum
          FROM con_tarifa c
    ),
    partidas AS (
        SELECT o.*,
               greatest(least(o.u_base, o.lote_total - (o.acum - o.u_base)), 0) AS cabe
          FROM ordenadas o
    )
    SELECT p.renglon_id, p.promocion_id, p.cod_vendedor,
           e.id, p.branch_id,
           sum(p.cabe),
           sum(p.u_base - p.cabe),
           round(sum(p.cabe              * (p.u_pago / nullif(p.u_base,0)) * p.bono_vendedor), 2),
           round(sum((p.u_base - p.cabe) * (p.u_pago / nullif(p.u_base,0)) * p.bono_vendedor), 2)
      FROM partidas p
      LEFT JOIN public.employees e
             ON e.code = p.cod_vendedor AND e.status = 'ACTIVO'
     GROUP BY p.renglon_id, p.promocion_id, p.cod_vendedor, e.id, p.branch_id
    HAVING sum(p.u_base) > 0;
END;
$function$;

ALTER FUNCTION public.promocion_corte_del_lote(bigint) SET plan_cache_mode = 'force_custom_plan';

-- ── crear_promocion: el lote y el reparto pasan a ser opcionales ────────────
CREATE OR REPLACE FUNCTION public.crear_promocion(
    p_nombre    text,
    p_renglones jsonb,
    p_nota      text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor      uuid := public.auth_employee_id();
    v_promo_id   bigint;
    v_nombre     text := nullif(btrim(coalesce(p_nombre,'')), '');
    v_r          jsonb;
    v_rep        jsonb;
    v_renglon_id bigint;
    v_suma       integer;
    v_lote       integer;
    v_producto   integer;
    v_nombre_prod text;
    v_tiene      boolean;
    v_paga       text;
    v_prov       integer;
    v_n_renglones integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;
    IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'NOMBRE_REQUERIDO: la promoción necesita un nombre que la sala pueda reconocer';
    END IF;
    IF p_renglones IS NULL OR jsonb_array_length(p_renglones) = 0 THEN
        RAISE EXCEPTION 'SIN_PRODUCTOS: una promoción sin productos no cuenta nada';
    END IF;
    IF jsonb_array_length(p_renglones) > 50 THEN
        RAISE EXCEPTION 'DEMASIADOS_PRODUCTOS: máximo 50 por promoción';
    END IF;

    INSERT INTO public.promociones (nombre, nota, creado_por)
    VALUES (v_nombre, nullif(btrim(coalesce(p_nota,'')), ''), v_actor)
    RETURNING id INTO v_promo_id;

    FOR v_r IN SELECT * FROM jsonb_array_elements(p_renglones)
    LOOP
        v_producto := (v_r ->> 'erp_product_id')::integer;
        -- Vacío y ausente son lo mismo acá: «todavía no se sabe».
        v_lote     := nullif(v_r ->> 'lote_total', '')::integer;
        v_tiene    := coalesce((v_r ->> 'tiene_bono')::boolean, true);
        v_paga     := nullif(v_r ->> 'paga', '');
        v_prov     := nullif(v_r ->> 'supplier_id', '')::integer;

        SELECT p.nombre INTO v_nombre_prod FROM public.products p WHERE p.id = v_producto;
        IF v_nombre_prod IS NULL THEN
            RAISE EXCEPTION 'PRODUCTO_INEXISTENTE: el producto % no existe', v_producto;
        END IF;
        IF v_lote IS NOT NULL AND v_lote <= 0 THEN
            RAISE EXCEPTION 'LOTE_INVALIDO: % tiene un lote de %; dejalo vacío si no se sabe',
                v_nombre_prod, v_lote;
        END IF;
        IF v_tiene AND v_paga IS NULL THEN
            RAISE EXCEPTION 'FALTA_QUIEN_PAGA: % tiene bono, hay que decir si lo cancela la empresa o un proveedor',
                v_nombre_prod;
        END IF;
        IF v_paga = 'proveedor' AND v_prov IS NULL THEN
            RAISE EXCEPTION 'FALTA_EL_PROVEEDOR: % lo paga un proveedor, hay que decir cuál',
                v_nombre_prod;
        END IF;

        INSERT INTO public.promocion_renglon
            (promocion_id, erp_product_id, factor_unidades, inicio, fin, lote_total,
             tiene_bono, paga, supplier_id)
        VALUES
            (v_promo_id, v_producto,
             nullif(v_r ->> 'factor_unidades','')::smallint,
             (v_r ->> 'inicio')::date,
             (v_r ->> 'fin')::date,
             v_lote,
             v_tiene,
             CASE WHEN v_tiene THEN v_paga ELSE NULL END,
             CASE WHEN v_tiene AND v_paga = 'proveedor' THEN v_prov ELSE NULL END)
        RETURNING id INTO v_renglon_id;

        -- Sin bono la tarifa va en cero: la fila existe para que el cálculo no
        -- tenga que preguntarse si hay tarifa, y los ceros dicen lo mismo que
        -- «no paga» sin un caso especial en cada consulta.
        INSERT INTO public.promocion_renglon_tarifa
            (renglon_id, desde, bono_vendedor, bono_adm, bono_bodega,
             unidades_por_bono, creado_por)
        VALUES
            (v_renglon_id, (v_r ->> 'inicio')::date,
             CASE WHEN v_tiene THEN coalesce((v_r ->> 'bono_vendedor')::numeric, 0) ELSE 0 END,
             CASE WHEN v_tiene THEN coalesce((v_r ->> 'bono_adm')::numeric, 0)      ELSE 0 END,
             CASE WHEN v_tiene THEN coalesce((v_r ->> 'bono_bodega')::numeric, 0)   ELSE 0 END,
             coalesce(nullif(v_r ->> 'unidades_por_bono','')::integer, 1),
             v_actor);

        -- El reparto es opcional. Si viene, tiene que cuadrar con el lote — un
        -- reparto que no suma deja a alguna sala vendiendo contra un número que
        -- no es suyo. Si no viene, la promoción mide sin repartir.
        v_suma := 0;
        FOR v_rep IN SELECT * FROM jsonb_array_elements(coalesce(v_r -> 'reparto', '[]'::jsonb))
        LOOP
            INSERT INTO public.promocion_reparto
                (renglon_id, branch_id, asignado_original, asignado_vigente)
            VALUES
                (v_renglon_id,
                 (v_rep ->> 'branch_id')::bigint,
                 (v_rep ->> 'unidades')::integer,
                 (v_rep ->> 'unidades')::integer);
            v_suma := v_suma + (v_rep ->> 'unidades')::integer;
        END LOOP;

        IF v_suma > 0 AND v_lote IS NULL THEN
            RAISE EXCEPTION 'REPARTO_SIN_LOTE: % reparte % unidades pero no dice de qué lote',
                v_nombre_prod, v_suma;
        END IF;
        IF v_suma > 0 AND v_suma <> v_lote THEN
            RAISE EXCEPTION 'REPARTO_NO_CUADRA: % reparte % de un lote de %',
                v_nombre_prod, v_suma, v_lote;
        END IF;

        v_n_renglones := v_n_renglones + 1;
    END LOOP;

    PERFORM public.promocion_log(
        v_promo_id, NULL, NULL, 'creada', NULL, v_nombre,
        v_n_renglones || ' producto(s)');

    RETURN json_build_object('id', v_promo_id, 'renglones', v_n_renglones);
END;
$function$;

COMMENT ON FUNCTION public.crear_promocion(text, jsonb, text) IS
  'Crea una promoción completa en borrador. El lote y el reparto son OPCIONALES —una promoción puede sólo medir—, pero un reparto que viene tiene que sumar su lote. Un producto con bono tiene que decir quién lo paga, y si es un proveedor, cuál.';
