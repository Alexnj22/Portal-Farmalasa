-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0028 — numeración por establecimiento, un punto de venta por
-- vendedor, y los plazos de invalidación de la Normativa DTE v2.0
-- ═══════════════════════════════════════════════════════════════════════════
-- Fuente: Normativa de Cumplimiento de los DTE v2.0 (DGII, 25-may-2026) y
-- Manual Funcional del Sistema de Transmisión v2.0 (05/2026).
--
-- ── La numeración era por tipo y por punto de venta, y la norma lo prohíbe ──
-- Regla 7.1.2: «No podrá asignarse la numeración consecutiva por Punto de
-- Ventas o por tipo de documento, salvo autorización expresa por medio de
-- resolución». Es centralizada o por establecimiento. 0001 llevaba un contador
-- por (tipo, punto de venta): Hacienda no lo detecta —el tipo viaja dentro del
-- número de control, así que nunca choca— y por eso habría vivido para siempre
-- como un incumplimiento formal. Desde acá hay UN contador por establecimiento
-- y año, compartido por todos los tipos y todos los puntos de venta.
--
-- La firma de `dist_siguiente_correlativo` no cambia a propósito: la llama la
-- edge function y un cambio de firma dejaría la vieja viva con sus permisos.
-- `p_tipo` y `p_punto_venta` se ignoran; la fila compartida usa '*'.
--
-- ── Un punto de venta por vendedor ──────────────────────────────────────────
-- La norma define el punto de venta como el lugar «físico o virtual» donde se
-- usa el gestor «mediante un dispositivo local o remoto», y no limita cuántos.
-- Uno por vendedor deja ver en el número de control quién emitió, y aísla la
-- contingencia al teléfono que perdió señal. P001 queda para la oficina (el
-- `punto_venta` del emisor); cada vendedor recibe el siguiente libre la
-- primera vez que emite.
--
-- ── Plazos de invalidación (regla 13.1, Cuadro 6; MF §VII) ──────────────────
--   03 CCF · 04 NR · 05 NC · 06 ND · 07 CR → hasta el DÉCIMO DÍA HÁBIL del mes
--       siguiente al del sello, 23:59:59.
--   01 FE · 11 FEX · 14 FSE → 3 meses desde el sello; 2 AÑOS si es venta de
--       medicamentos perecederos para consumo humano (fila 3 del Cuadro 6).
-- Pasado el plazo, el evento no recibe sello y el documento sigue valiendo: se
-- corrige con Nota de Crédito (CT art. 119-E). El portal no puede saber si una
-- FE es «de medicamentos perecederos» por renglón, así que entre los 3 meses y
-- los 2 años NO bloquea: avisa y deja que Hacienda decida. Bloquear ahí
-- trabaría una invalidación legítima; dejarla pasar sólo arriesga un rechazo.
--
-- Días hábiles: lunes a viernes sin los asuetos nacionales (Código de Trabajo
-- art. 190). Los de San Salvador (3-5 ago) no son nacionales. Si la tabla se
-- queda corta, el plazo sale MÁS CORTO que el real —la falla es avisar antes,
-- nunca dejar pasar un vencido—, y por eso el candado del CCF tiene una franja
-- de gracia de cinco días en la que avisa en vez de bloquear.
SET lock_timeout = '5s';

-- ── Numeración ──────────────────────────────────────────────────────────────
-- Arranca en el mayor número ya usado en ese establecimiento y año: el
-- correlativo no puede repetirse en el ejercicio (Anexo I 1.3).
INSERT INTO public.dist_correlativos (emisor_id, ambiente, tipo, establecimiento, punto_venta, anio, ultimo)
SELECT emisor_id, ambiente, '*', establecimiento, '*', anio, max(ultimo)
  FROM public.dist_correlativos
 WHERE tipo <> '*'
 GROUP BY emisor_id, ambiente, establecimiento, anio
ON CONFLICT (emisor_id, ambiente, tipo, establecimiento, punto_venta, anio)
DO UPDATE SET ultimo = greatest(public.dist_correlativos.ultimo, EXCLUDED.ultimo);

CREATE OR REPLACE FUNCTION public.dist_siguiente_correlativo(
    p_emisor smallint, p_ambiente text, p_tipo text, p_establecimiento text, p_punto_venta text, p_anio smallint)
RETURNS bigint LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions AS $$
    -- p_tipo y p_punto_venta se ignoran: la numeración es por establecimiento
    -- (Normativa DTE v2.0, regla 7.1.2).
    INSERT INTO public.dist_correlativos AS c (emisor_id, ambiente, tipo, establecimiento, punto_venta, anio, ultimo)
    VALUES (p_emisor, p_ambiente, '*', p_establecimiento, '*', p_anio, 1)
    ON CONFLICT (emisor_id, ambiente, tipo, establecimiento, punto_venta, anio)
    DO UPDATE SET ultimo = c.ultimo + 1
    RETURNING ultimo;
$$;
REVOKE EXECUTE ON FUNCTION public.dist_siguiente_correlativo(smallint, text, text, text, text, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_siguiente_correlativo(smallint, text, text, text, text, smallint) TO service_role;

-- ── Puntos de venta ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dist_puntos_venta (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id   smallint NOT NULL REFERENCES public.dist_emisores(id),
    codigo      text NOT NULL CHECK (codigo ~ '^P[0-9]{3}$'),
    empleado_id uuid REFERENCES public.employees(id),
    activo      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (emisor_id, codigo),
    UNIQUE (emisor_id, empleado_id)
);
CREATE INDEX IF NOT EXISTS dist_puntos_venta_empleado ON public.dist_puntos_venta (empleado_id);
ALTER TABLE public.dist_puntos_venta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dist_puntos_venta_select ON public.dist_puntos_venta;
CREATE POLICY dist_puntos_venta_select ON public.dist_puntos_venta FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
REVOKE ALL ON public.dist_puntos_venta FROM anon, authenticated;
GRANT SELECT ON public.dist_puntos_venta TO authenticated;
GRANT ALL ON public.dist_puntos_venta TO service_role;

-- El punto de venta de quien emite; lo crea la primera vez. Sólo el servidor:
-- es parte de armar el número de control.
CREATE OR REPLACE FUNCTION public.dist_punto_venta_de(p_emisor smallint, p_empleado uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v text; v_oficina text;
BEGIN
    IF p_empleado IS NULL THEN
        SELECT punto_venta INTO v FROM dist_emisores WHERE id = p_emisor;
        RETURN v;
    END IF;
    SELECT codigo INTO v FROM dist_puntos_venta WHERE emisor_id = p_emisor AND empleado_id = p_empleado AND activo;
    IF v IS NOT NULL THEN RETURN v; END IF;
    -- Dos emisiones a la vez del mismo vendedor nuevo: una sola crea la fila.
    PERFORM pg_advisory_xact_lock(hashtext('dist_punto_venta_de'), p_emisor);
    SELECT codigo INTO v FROM dist_puntos_venta WHERE emisor_id = p_emisor AND empleado_id = p_empleado;
    IF v IS NOT NULL THEN
        UPDATE dist_puntos_venta SET activo = true WHERE emisor_id = p_emisor AND empleado_id = p_empleado;
        RETURN v;
    END IF;
    SELECT punto_venta INTO v_oficina FROM dist_emisores WHERE id = p_emisor;
    SELECT 'P' || lpad((greatest(
               coalesce(max(substr(codigo, 2)::int), 0),
               coalesce(substr(v_oficina, 2)::int, 1)) + 1)::text, 3, '0')
      INTO v FROM dist_puntos_venta WHERE emisor_id = p_emisor;
    INSERT INTO dist_puntos_venta (emisor_id, codigo, empleado_id) VALUES (p_emisor, v, p_empleado);
    RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_punto_venta_de(smallint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_punto_venta_de(smallint, uuid) TO service_role;

-- ── Asuetos nacionales ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dist_asuetos (
    fecha      date PRIMARY KEY,
    nombre     text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dist_asuetos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dist_asuetos_select ON public.dist_asuetos;
CREATE POLICY dist_asuetos_select ON public.dist_asuetos FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
REVOKE ALL ON public.dist_asuetos FROM anon, authenticated;
GRANT SELECT ON public.dist_asuetos TO authenticated;
GRANT ALL ON public.dist_asuetos TO service_role;

-- Fijos de cada año + Jueves, Viernes y Sábado Santo (Pascua: 2026-04-05,
-- 2027-03-28, 2028-04-16, 2029-04-01, 2030-04-21).
INSERT INTO public.dist_asuetos (fecha, nombre)
SELECT make_date(a, m, d), n
  FROM generate_series(2026, 2030) a,
       (VALUES (1, 1, 'Año Nuevo'), (5, 1, 'Día del Trabajo'), (5, 10, 'Día de la Madre'),
               (6, 17, 'Día del Padre'), (8, 6, 'Fiestas agostinas'), (9, 15, 'Independencia'),
               (11, 2, 'Día de los Difuntos'), (12, 25, 'Navidad')) f(m, d, n)
UNION ALL
SELECT p + o, n
  FROM (VALUES (date '2026-04-05'), (date '2027-03-28'), (date '2028-04-16'),
               (date '2029-04-01'), (date '2030-04-21')) pascua(p),
       (VALUES (-3, 'Jueves Santo'), (-2, 'Viernes Santo'), (-1, 'Sábado Santo')) s(o, n)
ON CONFLICT (fecha) DO NOTHING;

-- El día del sello en hora de El Salvador. `fh_procesamiento` llega de
-- Hacienda como «dd/MM/yyyy HH:mm:ss»; sin él, la fecha de emisión.
CREATE OR REPLACE FUNCTION public.dist_dia_del_sello(p_fh text, p_fec_emi date)
RETURNS date LANGUAGE sql IMMUTABLE
SET search_path = public, extensions AS $$
    SELECT CASE WHEN p_fh ~ '^\d{2}/\d{2}/\d{4}'
                THEN to_date(substr(p_fh, 1, 10), 'DD/MM/YYYY')
                ELSE p_fec_emi END;
$$;
REVOKE EXECUTE ON FUNCTION public.dist_dia_del_sello(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_dia_del_sello(text, date) TO authenticated, service_role;

-- El n-ésimo día hábil de un mes.
CREATE OR REPLACE FUNCTION public.dist_dia_habil_del_mes(p_mes date, p_n int)
RETURNS date LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
    SELECT d::date
      FROM generate_series(date_trunc('month', p_mes), date_trunc('month', p_mes) + interval '1 month - 1 day', interval '1 day') d
     WHERE extract(isodow FROM d) < 6
       AND NOT EXISTS (SELECT 1 FROM public.dist_asuetos a WHERE a.fecha = d::date)
     ORDER BY d
    OFFSET p_n - 1 LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.dist_dia_habil_del_mes(date, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_dia_habil_del_mes(date, int) TO authenticated, service_role;

-- El juez del plazo, UNO solo: lo consulta la edge function antes de firmar el
-- evento y la pantalla para avisar antes de que alguien lo intente.
--   estado: 'vigente'  → se puede invalidar
--           'gracia'   → CCF y afines, hasta 5 días después del límite
--                        calculado: se deja intentar con aviso (asueto que la
--                        tabla no conoce)
--           'medicamentos' → FE entre 3 meses y 2 años: sólo vale si es venta
--                        de medicamentos perecederos; se deja intentar con aviso
--           'vencido'  → no se invalida: Nota de Crédito
CREATE OR REPLACE FUNCTION public.dist_plazo_invalidacion(p_tipo text, p_dia_sello date, p_hoy date DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
DECLARE
    v_hoy date := coalesce(p_hoy, (now() AT TIME ZONE 'America/El_Salvador')::date);
    v_limite date; v_largo date; v_estado text;
BEGIN
    IF p_dia_sello IS NULL THEN RETURN NULL; END IF;
    IF p_tipo IN ('01', '11', '14') THEN
        v_limite := (p_dia_sello + interval '3 months')::date;
        v_largo := (p_dia_sello + interval '2 years')::date;
        v_estado := CASE WHEN v_hoy <= v_limite THEN 'vigente'
                         WHEN p_tipo = '01' AND v_hoy <= v_largo THEN 'medicamentos'
                         ELSE 'vencido' END;
    ELSE
        v_limite := public.dist_dia_habil_del_mes((date_trunc('month', p_dia_sello) + interval '1 month')::date, 10);
        v_estado := CASE WHEN v_hoy <= v_limite THEN 'vigente'
                         WHEN v_hoy <= v_limite + 5 THEN 'gracia'
                         ELSE 'vencido' END;
    END IF;
    RETURN json_build_object(
        'limite', v_limite,
        'limite_medicamentos', v_largo,
        'estado', v_estado,
        'dias', v_limite - v_hoy);
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_plazo_invalidacion(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_plazo_invalidacion(text, date, date) TO authenticated, service_role;

-- Por documento, para quien lo mira (INVOKER: el RLS de dist_dte decide).
CREATE OR REPLACE FUNCTION public.dist_plazo_invalidacion_de(p_dte bigint)
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
    SELECT public.dist_plazo_invalidacion(d.tipo, public.dist_dia_del_sello(d.fh_procesamiento, d.fec_emi))
      FROM public.dist_dte d WHERE d.id = p_dte;
$$;
REVOKE EXECUTE ON FUNCTION public.dist_plazo_invalidacion_de(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_plazo_invalidacion_de(bigint) TO authenticated, service_role;
