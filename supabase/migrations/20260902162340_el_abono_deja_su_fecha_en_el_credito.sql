SET lock_timeout = '5s';

/* ── La fecha del último abono la escribe el propio abono ──────────────────
 *
 * Se hizo el primer abono real desde el portal (2-sep, $10.00 por
 * transferencia) y la ficha del crédito seguía diciendo «ninguno desde el
 * portal» — con el abono listado tres renglones más abajo, en la misma
 * pantalla. La columna `ultimo_abono_el` existía y nadie la escribía.
 *
 * ── Por qué un TRIGGER y no una línea en la edge function ─────────────────
 * Porque hoy hay un solo escritor y mañana puede haber otro: una corrección a
 * mano, una anulación, un backfill. Con la línea en la función, cada escritor
 * nuevo tiene que acordarse — y olvidarlo no da error, da una ficha que dice
 * «ninguno» sobre un crédito que ya se cobró, que es exactamente el defecto que
 * esto viene a arreglar.
 *
 * `SECURITY DEFINER` a propósito: el trigger escribe en `creditos_de_clientes`,
 * que no acepta UPDATE de `authenticated`. Sin esto, el día que un abono se
 * anule desde el navegador el UPDATE fallaría y **abortaría la anulación** —
 * un trigger de bitácora que tumba la escritura que audita ya pasó en este
 * portal.
 *
 * Mira `anulado_at`: un abono anulado no cuenta como último. Por eso el
 * disparador también corre en UPDATE, y por eso la fecha se RECALCULA del
 * conjunto en vez de asignarse: al anular el último, la buena es la del
 * anterior, no un null.
 */
CREATE OR REPLACE FUNCTION public.tocar_ultimo_abono()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_branch bigint := COALESCE(NEW.branch_id, OLD.branch_id);
    v_credito text  := COALESCE(NEW.credito_erp, OLD.credito_erp);
BEGIN
    UPDATE public.creditos_de_clientes c
    SET ultimo_abono_el = (
        SELECT max((a.created_at AT TIME ZONE 'America/El_Salvador')::date)
        FROM public.creditos_abonos_portal a
        WHERE a.branch_id = v_branch AND a.credito_erp = v_credito
          AND a.anulado_at IS NULL
    )
    WHERE c.branch_id = v_branch AND c.credito_erp = v_credito;
    RETURN NULL;   -- AFTER: lo que devuelva no cambia nada
END;
$$;

DROP TRIGGER IF EXISTS trg_tocar_ultimo_abono ON public.creditos_abonos_portal;
CREATE TRIGGER trg_tocar_ultimo_abono
    AFTER INSERT OR UPDATE OF anulado_at ON public.creditos_abonos_portal
    FOR EACH ROW EXECUTE FUNCTION public.tocar_ultimo_abono();

/* Y el que ya se hizo, que quedó sin fecha. */
UPDATE public.creditos_de_clientes c
SET ultimo_abono_el = a.ultimo
FROM (
    SELECT branch_id, credito_erp,
           max((created_at AT TIME ZONE 'America/El_Salvador')::date) AS ultimo
    FROM public.creditos_abonos_portal
    WHERE anulado_at IS NULL
    GROUP BY branch_id, credito_erp
) a
WHERE a.branch_id = c.branch_id AND a.credito_erp = c.credito_erp
  AND c.ultimo_abono_el IS DISTINCT FROM a.ultimo;
