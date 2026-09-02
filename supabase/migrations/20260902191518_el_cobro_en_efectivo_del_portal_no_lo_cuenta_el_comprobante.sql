SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- El efectivo que el cliente entrega al abonar un crédito DESDE EL PORTAL entra
-- al cajón, pero el comprobante del corte no lo cuenta: el sistema de origen lo
-- registra como movimiento del día y NO lo suma ni a INGRESOS ni a la línea
-- COBROS CREDITO. Resultado: un sobrante fantasma por ese monto.
--
-- Medido el 2026-09-02, Salud 4, corte de las 13:00 — el primer día que hubo
-- cobros desde el portal:
--     esperado del comprobante   $230.85   (6.00 + 274.85 - 50.00)
--     cobros en efectivo         $ 88.25   ($8.55 10:03 + $79.70 12:39)
--     esperado real              $319.10
--     se contó                   $309.25   -> FALTAN $9.85, no sobran $78.40
--
-- La cifra se sella EN LA FILA DEL CORTE y no se calcula en cada pantalla: son
-- ocho lugares los que leen un corte (la lista, el detalle, la tarjeta, el
-- widget del inicio, el resumen del mes, los avisos, Mi caja y el ticket que se
-- imprime). Calculado en cada uno, alcanza que uno se olvide para que dos
-- pantallas señalen faltantes distintos sobre la misma persona.
-- ─────────────────────────────────────────────────────────────────────────────

-- Las formas de pago de un abono que SÍ entran al cajón. Una sola función para
-- que la lista no quede escrita dos veces: el gemelo de JavaScript
-- (`FORMAS_EN_EFECTIVO` de src/utils/cortesDiagnostico.js) consume el booleano
-- que devuelve `get_abonos_del_dia`, no su propia copia.
CREATE OR REPLACE FUNCTION public.formas_de_abono_en_efectivo()
RETURNS text[] LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$ SELECT ARRAY['efectivo']::text[] $$;

REVOKE EXECUTE ON FUNCTION public.formas_de_abono_en_efectivo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.formas_de_abono_en_efectivo() TO authenticated, service_role;

-- Cuánto cobró el portal en efectivo en esa sala hasta esa hora del día.
-- La hora es el dato que hace posible esta cuenta: los movimientos del origen
-- no la traen, y suponerla ya costó un sobrante inventado de $66.01.
CREATE OR REPLACE FUNCTION public.cobros_portal_en_efectivo(
    p_branch integer, p_fecha date, p_hasta time
) RETURNS numeric LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    SELECT coalesce(sum(a.monto), 0)::numeric(12,2)
      FROM public.creditos_abonos_portal a
     WHERE a.branch_id = p_branch
       AND a.anulado_at IS NULL
       AND lower(btrim(coalesce(a.forma, ''))) = ANY (public.formas_de_abono_en_efectivo())
       AND (a.created_at AT TIME ZONE 'America/El_Salvador')::date = p_fecha
       AND (a.created_at AT TIME ZONE 'America/El_Salvador')::time <= p_hasta
$$;

REVOKE EXECUTE ON FUNCTION public.cobros_portal_en_efectivo(integer, date, time) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cobros_portal_en_efectivo(integer, date, time) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS creditos_abonos_portal_sala_momento_idx
    ON public.creditos_abonos_portal (branch_id, created_at);

ALTER TABLE public.cortes_caja
    ADD COLUMN IF NOT EXISTS cobros_portal_efectivo numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cortes_caja.cobros_portal_efectivo IS
  'Cobros de crédito en efectivo hechos desde el portal hasta la hora de este corte. El comprobante del origen NO los cuenta: hay que sumarlos al esperado. Lo sella un trigger, no el cliente.';

-- El sello, en los dos sentidos: cuando nace o cambia el corte, y cuando cambia
-- un abono. Sin la segunda mitad, un cobro hecho a las 10:03 no aparecería en un
-- corte capturado a las 10:00 y luego corregido.
CREATE OR REPLACE FUNCTION public.cortes_caja_sella_cobros_portal()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
    NEW.cobros_portal_efectivo :=
        public.cobros_portal_en_efectivo(NEW.branch_id, NEW.fecha, NEW.hora);
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cortes_caja_cobros_portal ON public.cortes_caja;
CREATE TRIGGER cortes_caja_cobros_portal
    BEFORE INSERT OR UPDATE ON public.cortes_caja
    FOR EACH ROW EXECUTE FUNCTION public.cortes_caja_sella_cobros_portal();

CREATE OR REPLACE FUNCTION public.abonos_portal_resella_cortes()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
    v_sala  integer;
    v_fecha date;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_sala  := OLD.branch_id;
        v_fecha := (OLD.created_at AT TIME ZONE 'America/El_Salvador')::date;
    ELSE
        v_sala  := NEW.branch_id;
        v_fecha := (NEW.created_at AT TIME ZONE 'America/El_Salvador')::date;
    END IF;

    UPDATE public.cortes_caja c
       SET cobros_portal_efectivo =
             public.cobros_portal_en_efectivo(c.branch_id, c.fecha, c.hora)
     WHERE c.branch_id = v_sala
       AND c.fecha = v_fecha
       AND c.cobros_portal_efectivo IS DISTINCT FROM
             public.cobros_portal_en_efectivo(c.branch_id, c.fecha, c.hora);

    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS abonos_portal_resella_cortes ON public.creditos_abonos_portal;
CREATE TRIGGER abonos_portal_resella_cortes
    AFTER INSERT OR UPDATE OR DELETE ON public.creditos_abonos_portal
    FOR EACH ROW EXECUTE FUNCTION public.abonos_portal_resella_cortes();

-- Los cortes que ya existen. Sólo cambian los de un día con cobros del portal.
UPDATE public.cortes_caja c
   SET cobros_portal_efectivo =
         public.cobros_portal_en_efectivo(c.branch_id, c.fecha, c.hora)
 WHERE c.cobros_portal_efectivo IS DISTINCT FROM
         public.cobros_portal_en_efectivo(c.branch_id, c.fecha, c.hora);
