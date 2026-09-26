-- U2 paso 1 — «¿esta factura cuenta como venta?» se contesta UNA vez.
--
-- Plan: docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md §E2. Unas cien funciones leen
-- `sales_invoices` y cada una escribía su propio filtro, con tres redacciones:
--
--   · `estado NOT IN ('NULA','DTE INVALIDADO EN MH')`   (~44: metas, Ventas, Mín·Máx…)
--   · `estado = 'FINALIZADA'`                           (~8: caja, formas de pago…)
--   · `estado = 'FINALIZADA' AND length(recibido_mh)=40` (~12: libros, Z, período)
--
-- Las dos primeras dan hoy las MISMAS filas porque existen sólo tres estados
-- (FINALIZADA 375,238 · DTE INVALIDADO EN MH 1,062 · NULA 9, ninguno nulo,
-- medido el 2026-09-26). Son dos reglas que coinciden por casualidad: con un
-- estado nuevo, metas y caja darían totales distintos del mismo día.
--
-- Decisión del usuario (2026-09-26): un estado que nadie conoce NO cuenta como
-- venta hasta que se revise —«A»—, y se le avisa. Por eso la regla es la
-- positiva (`= 'FINALIZADA'`) y no la exclusión, y por eso existe el vigilante.
--
-- ── Por qué estas dos NO llevan `SET search_path` (regla 4 de CLAUDE.md) ────
-- Una función `LANGUAGE sql` sin `SET` se INLINEA: el planificador la
-- reemplaza por su expresión (`si.estado = 'FINALIZADA'`) y sigue usando los
-- índices y las estadísticas de la columna. Con `SET` sería una caja cerrada:
-- una llamada por fila con selectividad por defecto —la trampa 4 de la regla
-- de funciones— sobre la tabla más grande de la base. El cuerpo sólo usa el
-- `=` de texto y `length`, que salen de `pg_catalog` (siempre primero en la
-- búsqueda), así que no hay nada que un `search_path` ajeno pueda suplantar.
-- Verificado en la base de pruebas: el plan muestra `Index Cond: (estado =
-- 'FINALIZADA')`.
--
-- Devuelven NULL con un estado NULL, igual que la comparación que reemplazan:
-- en un WHERE es «no entra». Envolverlas en `coalesce` impediría usar el
-- índice de `estado`.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.venta_valida(p_estado text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT p_estado = 'FINALIZADA' $$;

COMMENT ON FUNCTION public.venta_valida(text) IS
  'La venta operativa: lo que se vendió. Un estado desconocido NO cuenta (decisión 2026-09-26) y lo avisa avisar_estados_de_venta_desconocidos(). Sin SET a propósito: se inlinea.';

CREATE OR REPLACE FUNCTION public.venta_fiscal(p_estado text, p_recibido_mh text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT p_estado = 'FINALIZADA' AND length(p_recibido_mh) = 40 $$;

COMMENT ON FUNCTION public.venta_fiscal(text, text) IS
  'La venta que entra al libro: válida y con sello de Hacienda (40 caracteres; recibido_mh es text). Sin SET a propósito: se inlinea.';

REVOKE EXECUTE ON FUNCTION public.venta_valida(text)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.venta_fiscal(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.venta_valida(text)       TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.venta_fiscal(text, text) TO authenticated, service_role;

-- ── El vigilante ────────────────────────────────────────────────────────────
-- Un estado que no es ninguno de los tres conocidos queda FUERA de las ventas
-- sin error y sin fila de menos visible: el modo de falla de siempre. Esto lo
-- vuelve un aviso. Se lee por `idx_si_no_finalizada` (las ~1,070 filas que no
-- están finalizadas) y por el índice de `estado` para los nulos: medido en
-- producción, 1 ms y 9 bloques.
--
-- Avisa UNA vez por estado: la marca queda en `audit_logs`. Revisar el estado
-- es decidir si cuenta —y entonces se agrega a `venta_valida`— o no.
-- Destinatarios: el cargo «Sistema — Alertas Técnicas», el mismo que usa la
-- alerta del barrido de Hacienda; nunca un id escrito acá.

CREATE OR REPLACE FUNCTION public.avisar_estados_de_venta_desconocidos()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    r        record;
    v_dest   uuid[];
    v_n      integer := 0;
BEGIN
    FOR r IN
        SELECT coalesce(si.estado, '(vacío)') AS estado,
               count(*)                       AS facturas,
               sum(si.total)                  AS monto,
               min(si.fecha)                  AS desde,
               max(si.fecha)                  AS hasta
          FROM public.sales_invoices si
         WHERE (si.estado <> 'FINALIZADA' AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH'))
            OR si.estado IS NULL
         GROUP BY 1
    LOOP
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM public.audit_logs
             WHERE action = 'ESTADO_DE_VENTA_DESCONOCIDO'
               AND details->>'estado' = r.estado);

        IF v_dest IS NULL THEN
            SELECT array_agg(e.id) INTO v_dest
              FROM public.employees e
              JOIN public.roles ro ON ro.name = 'Sistema — Alertas Técnicas'
             WHERE e.status = 'ACTIVO'
               AND (e.role_id = ro.id OR e.secondary_role_id = ro.id);
        END IF;

        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('ESTADO_DE_VENTA_DESCONOCIDO', r.estado, 'Vigilante', 'SYSTEM', 'CRITICAL',
                jsonb_build_object('estado', r.estado, 'facturas', r.facturas,
                                   'monto', r.monto, 'desde', r.desde, 'hasta', r.hasta,
                                   'avisados', coalesce(array_length(v_dest, 1), 0)));

        IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
            PERFORM public.notify_employees(
                v_dest, 'SYSTEM',
                'Apareció un estado de venta nuevo',
                r.facturas || ' factura' || CASE WHEN r.facturas = 1 THEN '' ELSE 's' END
                  || ' en estado «' || r.estado || '» (' || to_char(r.desde, 'DD/MM/YYYY')
                  || CASE WHEN r.hasta <> r.desde THEN ' al ' || to_char(r.hasta, 'DD/MM/YYYY') ELSE '' END
                  || '). Mientras nadie lo revise, NO cuentan como venta en metas, Ventas ni caja.',
                '/ventas',
                jsonb_build_object('origen', 'estado-de-venta-desconocido', 'estado', r.estado,
                                   'facturas', r.facturas, 'monto', r.monto),
                true, NULL);
        END IF;
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.avisar_estados_de_venta_desconocidos() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_estados_de_venta_desconocidos() TO service_role;

-- Cada hora. SQL puro: no llama a ninguna función ni al sistema de origen.
SELECT cron.schedule('estados-de-venta-desconocidos', '20 * * * *',
                     $$SELECT public.avisar_estados_de_venta_desconocidos()$$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'estados-de-venta-desconocidos');