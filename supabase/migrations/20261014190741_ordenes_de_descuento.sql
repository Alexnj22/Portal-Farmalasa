SET lock_timeout = '5s';

-- ── Órdenes de descuento — 2026-10-14 ──────────────────────────────────────
--
-- Un empleado saca un préstamo y el banco le pide a la empresa que descuente
-- la cuota de la planilla y se la pague. Hasta hoy el portal sólo tenía el
-- MONTO del mes (`order_discount` en la planilla), tecleado a mano: no sabía
-- de qué banco, desde cuándo, hasta cuándo ni cuánto queda.
--
-- Una fila por orden. Los datos salen de la foto del documento (los lee
-- `leer-orden-de-descuento`) y la persona los confirma y corrige: todos son
-- editables. «Cuánto queda» se deriva de `fecha_fin` y `cuota` en pantalla —
-- guardarlo sería un número que envejece solo.
--
-- Tabla nueva y fría: ningún cron la escribe.

CREATE TABLE IF NOT EXISTS public.ordenes_descuento (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id       uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    -- El texto del catálogo `src/constants/bancos.js` (el valor ES el dato).
    banco             text,
    referencia        text,           -- número de préstamo / de la orden
    monto_prestamo    numeric(12,2) CHECK (monto_prestamo IS NULL OR monto_prestamo >= 0),
    tasa_interes      numeric(7,3)  CHECK (tasa_interes IS NULL OR tasa_interes >= 0),   -- % anual
    cuota             numeric(12,2) CHECK (cuota IS NULL OR cuota >= 0),
    periodicidad      text NOT NULL DEFAULT 'MENSUAL' CHECK (periodicidad IN ('MENSUAL', 'QUINCENAL')),
    plazo_cuotas      int CHECK (plazo_cuotas IS NULL OR plazo_cuotas > 0),
    fecha_inicio      date,
    fecha_fin         date,
    estado            text NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE', 'FINALIZADA', 'CANCELADA')),
    -- [{url, file_name}] — las fotos del documento (bucket `documents`,
    -- carpeta del empleado).
    archivos          jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- El nombre que leyó el modelo, para poder decir «el papel nombra a otra
    -- persona» sin volver a leerlo.
    nombre_en_documento text,
    notas             text,
    -- La ficha de quien la cargó, resuelta en la base: el navegador conoce la
    -- cuenta, no la ficha.
    creado_por        uuid DEFAULT public.auth_employee_id() REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio)
);
CREATE INDEX IF NOT EXISTS ordenes_descuento_employee_idx ON public.ordenes_descuento (employee_id);

ALTER TABLE public.ordenes_descuento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ordenes_descuento_select ON public.ordenes_descuento;
DROP POLICY IF EXISTS ordenes_descuento_insert ON public.ordenes_descuento;
DROP POLICY IF EXISTS ordenes_descuento_update ON public.ordenes_descuento;
DROP POLICY IF EXISTS ordenes_descuento_delete ON public.ordenes_descuento;

-- La persona ve las suyas; quien ve expedientes, todas.
CREATE POLICY ordenes_descuento_select ON public.ordenes_descuento FOR SELECT TO authenticated
    USING (employee_id = (SELECT auth_employee_id())
        OR (SELECT auth_has_module_permission('staff_detail', 'can_view')));
CREATE POLICY ordenes_descuento_insert ON public.ordenes_descuento FOR INSERT TO authenticated
    WITH CHECK ((SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])));
CREATE POLICY ordenes_descuento_update ON public.ordenes_descuento FOR UPDATE TO authenticated
    USING ((SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
    WITH CHECK ((SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])));
CREATE POLICY ordenes_descuento_delete ON public.ordenes_descuento FOR DELETE TO authenticated
    USING ((SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])));

REVOKE ALL ON public.ordenes_descuento FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ordenes_descuento TO authenticated;
