SET lock_timeout = '5s';

-- ── Seguro de vida colectivo (MAPFRE) — 2026-10-14 ─────────────────────────
--
-- Pedido del usuario: la empresa paga cada NOVIEMBRE una prima por persona
-- (6.50 por millar anual de una suma asegurada IGUAL para todos —hoy $5,000,
-- o sea $32.50 por persona, «pero puede variar»—). Hay tres papeles y dos de
-- ellos NO son de una persona:
--
--   · la póliza (el documento general, el mismo cada año)  → seguro_vida_poliza
--   · el pago de cada año, con el listado de las personas  → seguro_vida_pagos
--     que cubre                                               + seguro_vida_cubiertos
--   · el certificado de cada asegurado                      → employee_documents
--     (categoría CERTIFICADO_SEGURO_VIDA, no vence)
--
-- «Solvente» se DERIVA: la persona está en el listado del pago del periodo
-- vigente. No se guarda en `employees` — un estado copiado se queda viejo el
-- día que alguien corrige el listado.
--
-- Tablas nuevas y frías: ningún cron las escribe, el DDL no toca tablas
-- calientes.

CREATE TABLE IF NOT EXISTS public.seguro_vida_poliza (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    aseguradora        text          NOT NULL DEFAULT 'MAPFRE',
    numero_poliza      text,
    suma_asegurada     numeric(12,2) NOT NULL DEFAULT 5000 CHECK (suma_asegurada > 0),
    tasa_por_millar    numeric(8,3)  NOT NULL DEFAULT 6.5  CHECK (tasa_por_millar > 0),
    -- NULL = la que sale de suma × tasa / 1000. Se escribe sólo cuando la
    -- aseguradora cobra otra cosa («dice 32.50 pero puede variar»).
    prima_por_persona  numeric(12,2) CHECK (prima_por_persona IS NULL OR prima_por_persona >= 0),
    mes_de_pago        smallint      NOT NULL DEFAULT 11 CHECK (mes_de_pago BETWEEN 1 AND 12),
    documento_url      text,
    documento_nombre   text,
    notas              text,
    actualizado_por    uuid DEFAULT public.auth_employee_id() REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at         timestamptz   NOT NULL DEFAULT now(),
    updated_at         timestamptz   NOT NULL DEFAULT now()
);
-- Una sola póliza vigente: la tabla es un registro, no una lista.
CREATE UNIQUE INDEX IF NOT EXISTS seguro_vida_poliza_una_sola ON public.seguro_vida_poliza ((true));

CREATE TABLE IF NOT EXISTS public.seguro_vida_pagos (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- El año del pago de noviembre. Cubre de noviembre de ese año a octubre
    -- del siguiente.
    anio               int           NOT NULL UNIQUE CHECK (anio BETWEEN 2000 AND 2100),
    fecha_pago         date,
    monto_total        numeric(12,2) CHECK (monto_total IS NULL OR monto_total >= 0),
    prima_por_persona  numeric(12,2) CHECK (prima_por_persona IS NULL OR prima_por_persona >= 0),
    comprobante_url    text,
    comprobante_nombre text,
    notas              text,
    registrado_por     uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at         timestamptz   NOT NULL DEFAULT now(),
    updated_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seguro_vida_cubiertos (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pago_id             bigint NOT NULL REFERENCES public.seguro_vida_pagos(id) ON DELETE CASCADE,
    -- NULL cuando el listado nombra a alguien sin ficha (o que ya salió): el
    -- nombre del papel se conserva igual, es lo que la aseguradora cubrió.
    employee_id         uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    nombre_en_documento text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pago_id, employee_id)
);
CREATE INDEX IF NOT EXISTS seguro_vida_cubiertos_employee_idx ON public.seguro_vida_cubiertos (employee_id);

ALTER TABLE public.seguro_vida_poliza    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seguro_vida_pagos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seguro_vida_cubiertos ENABLE ROW LEVEL SECURITY;

-- Leer: quien ve expedientes. Escribir: quien los edita — la misma compuerta
-- que el bucket `documents`, donde viven los archivos (`seguro-vida/…`).
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['seguro_vida_poliza','seguro_vida_pagos','seguro_vida_cubiertos'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON public.%1$s', t);
        EXECUTE format('DROP POLICY IF EXISTS %1$s_insert ON public.%1$s', t);
        EXECUTE format('DROP POLICY IF EXISTS %1$s_update ON public.%1$s', t);
        EXECUTE format('DROP POLICY IF EXISTS %1$s_delete ON public.%1$s', t);
        EXECUTE format($p$CREATE POLICY %1$s_select ON public.%1$s FOR SELECT TO authenticated
            USING ((SELECT auth_has_module_permission('staff_detail', 'can_view'))
                OR (SELECT auth_has_module_permission('staff_list', 'can_view')))$p$, t);
        EXECUTE format($p$CREATE POLICY %1$s_insert ON public.%1$s FOR INSERT TO authenticated
            WITH CHECK ((SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))$p$, t);
        EXECUTE format($p$CREATE POLICY %1$s_update ON public.%1$s FOR UPDATE TO authenticated
            USING ((SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
            WITH CHECK ((SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))$p$, t);
        EXECUTE format($p$CREATE POLICY %1$s_delete ON public.%1$s FOR DELETE TO authenticated
            USING ((SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))$p$, t);
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END LOOP;
END $$;

-- La fila de la póliza con los valores que dio el usuario. Sin documento: se
-- sube desde la pantalla.
INSERT INTO public.seguro_vida_poliza (aseguradora, suma_asegurada, tasa_por_millar)
SELECT 'MAPFRE', 5000, 6.5
WHERE NOT EXISTS (SELECT 1 FROM public.seguro_vida_poliza);

-- ── Registrar (o corregir) el pago de un año, con su listado ──────────────
--
-- En UNA transacción: el pago y su listado son el mismo hecho. Escrito en dos
-- llamadas del navegador, un corte en el medio deja un año «pagado» sin nadie
-- cubierto — que se lee como «nadie solvente» sin error.
--
-- INVOKER: el RLS de las tablas sigue decidiendo quién puede.
CREATE OR REPLACE FUNCTION public.registrar_pago_seguro_vida(
    p_anio int,
    p_fecha_pago date,
    p_monto_total numeric,
    p_prima_por_persona numeric,
    p_comprobante_url text,
    p_comprobante_nombre text,
    p_cubiertos jsonb,
    p_notas text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
    v_pago_id bigint;
    v_quien   uuid := (SELECT auth_employee_id());
    v_n       int;
BEGIN
    IF p_anio IS NULL THEN RAISE EXCEPTION 'Falta el año del pago.'; END IF;
    IF jsonb_typeof(coalesce(p_cubiertos, '[]'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'El listado de cubiertos tiene que ser una lista.';
    END IF;

    INSERT INTO public.seguro_vida_pagos AS p
        (anio, fecha_pago, monto_total, prima_por_persona, comprobante_url, comprobante_nombre, notas, registrado_por)
    VALUES (p_anio, p_fecha_pago, p_monto_total, p_prima_por_persona, p_comprobante_url, p_comprobante_nombre, p_notas, v_quien)
    ON CONFLICT (anio) DO UPDATE SET
        fecha_pago         = EXCLUDED.fecha_pago,
        monto_total        = EXCLUDED.monto_total,
        prima_por_persona  = EXCLUDED.prima_por_persona,
        -- Corregir el listado sin volver a subir el papel no borra el papel.
        comprobante_url    = coalesce(EXCLUDED.comprobante_url, p.comprobante_url),
        comprobante_nombre = coalesce(EXCLUDED.comprobante_nombre, p.comprobante_nombre),
        notas              = EXCLUDED.notas,
        registrado_por     = EXCLUDED.registrado_por,
        updated_at         = now()
    RETURNING id INTO v_pago_id;

    -- El listado se reemplaza entero: es la foto del papel de ESE año.
    DELETE FROM public.seguro_vida_cubiertos WHERE pago_id = v_pago_id;

    INSERT INTO public.seguro_vida_cubiertos (pago_id, employee_id, nombre_en_documento)
    SELECT DISTINCT ON (coalesce(x.employee_id::text, upper(trim(x.nombre))))
           v_pago_id, x.employee_id, coalesce(nullif(trim(x.nombre), ''), '(sin nombre)')
      FROM jsonb_to_recordset(coalesce(p_cubiertos, '[]'::jsonb)) AS x(employee_id uuid, nombre text)
     WHERE x.employee_id IS NOT NULL OR nullif(trim(x.nombre), '') IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    RETURN json_build_object('ok', true, 'pago_id', v_pago_id, 'cubiertos', v_n);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_pago_seguro_vida(int, date, numeric, numeric, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pago_seguro_vida(int, date, numeric, numeric, text, text, jsonb, text) TO authenticated, service_role;

-- ── El aviso del 1 de noviembre ────────────────────────────────────────────
--
-- A Talento Humano y Gerencia, con lo que hay que pagar estimado (personas
-- activas × prima). Si el pago de ese año ya está registrado no avisa, y el
-- freno de `metadata` (fuente + año) impide que salga dos veces.
CREATE OR REPLACE FUNCTION public.avisar_pago_seguro_vida()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_anio     int  := extract(year FROM (now() AT TIME ZONE 'America/El_Salvador'))::int;
    v_pol      public.seguro_vida_poliza%ROWTYPE;
    v_prima    numeric;
    v_personas int;
    v_dest     text[];
BEGIN
    IF EXISTS (SELECT 1 FROM public.seguro_vida_pagos WHERE anio = v_anio) THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'ya_pagado');
    END IF;
    IF EXISTS (SELECT 1 FROM public.announcements a
                WHERE a.metadata->>'source' = 'seguro-vida-pago'
                  AND a.metadata->>'anio' = v_anio::text) THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'ya_avisado');
    END IF;

    SELECT * INTO v_pol FROM public.seguro_vida_poliza LIMIT 1;
    v_prima := coalesce(v_pol.prima_por_persona, round(v_pol.suma_asegurada * v_pol.tasa_por_millar / 1000, 2));
    SELECT count(*) INTO v_personas FROM public.employees
     WHERE status = 'ACTIVO' AND coalesce(tipo_ficha, 'empleado') = 'empleado';

    SELECT array_agg(id::text) INTO v_dest
      FROM public.employees WHERE role_id IN (11, 2) AND status = 'ACTIVO';

    INSERT INTO public.announcements
        (title, message, target_type, target_value, read_by, is_archived, priority, metadata)
    VALUES (
        'Seguro de vida colectivo: toca el pago de ' || v_anio,
        'Este mes se paga la póliza de seguro de vida colectivo'
            || coalesce(' con ' || v_pol.aseguradora, '') || '.' || E'\n\n'
            || 'Prima por persona: $' || to_char(coalesce(v_prima, 0), 'FM999,990.00')
            || ' (' || to_char(v_pol.tasa_por_millar, 'FM990.00') || ' por millar de $'
            || to_char(v_pol.suma_asegurada, 'FM999,990.00') || ').' || E'\n'
            || 'Personas activas hoy: ' || v_personas || ' — estimado: $'
            || to_char(coalesce(v_prima, 0) * v_personas, 'FM999,990.00') || '.' || E'\n\n'
            || 'Cuando llegue el listado de la aseguradora, súbelo en Personal › Seguro de vida '
            || 'para dejar a cada persona como solvente.',
        CASE WHEN v_dest IS NOT NULL AND array_length(v_dest, 1) > 0 THEN 'EMPLOYEE' ELSE 'ALL' END,
        CASE WHEN v_dest IS NOT NULL AND array_length(v_dest, 1) > 0 THEN to_jsonb(v_dest) ELSE NULL END,
        '[]'::jsonb, false, 'HIGH',
        jsonb_build_object('source', 'seguro-vida-pago', 'anio', v_anio::text, 'fecha', v_hoy::text)
    );

    RETURN json_build_object('ok', true, 'avisado', true, 'anio', v_anio, 'personas', v_personas);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.avisar_pago_seguro_vida() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_pago_seguro_vida() TO service_role;

-- 13:00 UTC = 07:00 en El Salvador, el 1 de noviembre. SQL puro: cero
-- peticiones al sistema de origen.
SELECT cron.unschedule('avisar-pago-seguro-vida')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisar-pago-seguro-vida');
SELECT cron.schedule('avisar-pago-seguro-vida', '0 13 1 11 *',
    $$ SELECT public.avisar_pago_seguro_vida() $$);
