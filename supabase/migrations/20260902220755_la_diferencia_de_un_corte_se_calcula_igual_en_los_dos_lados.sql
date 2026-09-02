SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- La diferencia de un corte se calcula IGUAL en la base y en la pantalla.
--
-- `corte_diferencia` es el gemelo SQL de `diferenciaDelCorte`/`contraste`
-- (`src/utils/cortesDiagnostico.js`), y se quedó DOS arreglos atras. Medido el
-- 2026-09-02 sobre los cortes confirmados de la semana:
--
--   Salud 4 · 2-sep 15:02   pantalla  $0.00   base  +$88.25
--   Salud 3 · 2-sep 13:43   pantalla  $0.00   base  +$25.35
--
-- Y son dos causas distintas:
--
-- 1. **El efectivo de los cobros de credito hechos desde el portal.** Cobrar un
--    credito mete efectivo en el cajon y el sistema de la caja NO lo suma a su
--    esperado, asi que el conteo aparece como un sobrante que nadie hizo. El
--    portal lo corrige desde v2.953.0 sumandolo al esperado; aca no existia.
--    Salud 4 declaro $386.97 contra $298.72 del comprobante + $88.25 de cobros
--    = exacto.
--
-- 2. **La excepcion del «+1x cobros de credito», que el portal QUITO el 1-sep.**
--    Devolvia la cifra del formulario cuando la brecha era exactamente un cobro,
--    leyendola como «el tiquete sumo cobros del dia a un corte hecho antes».
--    Se midio sobre 485 cortes con todas las lineas: la suma del tiquete
--    (`subtotal - vales + cobros = total_caja`) cierra en 485/485, y el
--    formulario se aparta en 112 (23%). La premisa era ademas falsa —
--    `tk_cobros_credito` CRECE entre cortes del mismo dia en 40 de 371 pares
--    consecutivos, o sea que reporta lo que YA entro— y el «testigo
--    independiente» que la sostenia se armaba con el numero del formulario, o
--    sea el mismo origen que decia tener razon. Salud 3 tenia el tiquete exacto
--    y esta excepcion le inventaba $25.35.
--
-- ── Por que importa que sea ESTE numero ─────────────────────────────────────
-- `resolver_diferencia_corte` lo usa via `corte_tramo` para decidir CUANTO se le
-- cobra a alguien, y ademas rechaza si no coincide con el que mostro la
-- pantalla («la diferencia cambio mientras se resolvia»). O sea que la deriva no
-- cobraba de mas —el freno funcionaba— pero dejaba esos cortes SIN PODER
-- RESOLVERSE, con un mensaje que manda a mirar donde no esta el problema.
--
-- Ver [[feedback_el_arreglo_de_un_canonico_no_llega_a_su_gemelo]].
--
-- ── Enfrentados, que es lo unico que hace confiable a un gemelo ─────────────
-- `scripts/comparar-diferencia-de-corte.mjs` corre los 501 cortes tipo C
-- capturados por las DOS implementaciones y las compara. Al escribir esto:
-- **500 comparados, 500 iguales, 0 distintas** (el que falta es el unico sin
-- conteo, que en SQL lo ataja `corte_tramo` antes de llamar a la funcion).
-- Cambiar cualquiera de los dos lados exige volver a correrlo.
--
-- ── Los cobros del comprobante se DESPEJAN, no se leen ──────────────────────
-- `tk_cobros_credito` sale del papel con una expresion regular y el papel a
-- veces no imprime la linea; su ausencia se lee igual que un cero. La suma del
-- comprobante si lo dice sin ambiguedad porque cierra siempre:
-- `cobros = total_caja - subtotal + vales`, verificado al centavo en los 493
-- cortes capturados. Un cero de mas ahi inventa un faltante del tamano de los
-- cobros del dia. La linea leida queda solo como respaldo cuando faltan
-- `subtotal` o `vales`.
--
-- `DROP` + `CREATE`: cambia la lista de argumentos.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.corte_diferencia(numeric, numeric, numeric, numeric);

CREATE FUNCTION public.corte_diferencia(
    p_declarado     numeric,
    p_dif_erp       numeric,
    p_total_caja    numeric,
    p_subtotal      numeric,
    p_vales         numeric,
    p_cobros_tk     numeric,
    p_cobros_portal numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT CASE
        -- Sin las tres piezas no hay dos cifras que contrastar: queda la del
        -- formulario, que es todo lo que hay. Misma rama que `contraste`
        -- devolviendo `null` y `diferenciaDelCorte` cayendo a «guardada».
        WHEN p_declarado IS NULL OR p_dif_erp IS NULL OR p_total_caja IS NULL
            THEN coalesce(p_dif_erp, 0)
        ELSE round(
            p_declarado - (
                p_total_caja
                -- Lo que entro al cajon y el comprobante NO conto. Se resta lo
                -- que YA conto para no sumarlo dos veces, y el piso en cero es
                -- deliberado: si el comprobante conto MAS que el portal, son
                -- cobros hechos en la pantalla de la caja —que el portal no ve—
                -- y no un hallazgo.
                + greatest(0, round(
                    coalesce(p_cobros_portal, 0)
                    - CASE
                        WHEN p_subtotal IS NOT NULL AND p_vales IS NOT NULL
                            THEN round(p_total_caja - p_subtotal + p_vales, 2)
                        ELSE coalesce(p_cobros_tk, 0)
                      END, 2))
            ), 2)
    END;
$function$;

REVOKE EXECUTE ON FUNCTION public.corte_diferencia(numeric,numeric,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.corte_diferencia(numeric,numeric,numeric,numeric,numeric,numeric,numeric) TO authenticated, service_role;


-- `corte_tramo` le pasa las piezas nuevas. El resto no cambia: el tramo sigue
-- siendo la diferencia menos la del ultimo CONFIRMADO anterior del mismo dia y
-- la misma sala.
CREATE OR REPLACE FUNCTION public.corte_tramo(p_corte_id bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v      public.cortes_caja;
    v_dif  numeric;
    v_base numeric;
BEGIN
    SELECT * INTO v FROM public.cortes_caja WHERE id = p_corte_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;
    IF v.tipo <> 'C' THEN RAISE EXCEPTION 'El cierre del dia no tiene tramo.'; END IF;
    IF public.corte_no_conto_efectivo(v.tipo, v.total_declarado, v.diferencia_erp, v.tk_total_caja) THEN
        RAISE EXCEPTION 'Este corte no conto el efectivo: no tiene diferencia que medir.';
    END IF;

    v_dif := public.corte_diferencia(v.total_declarado, v.diferencia_erp, v.tk_total_caja,
                                     v.tk_subtotal, v.tk_vales, v.tk_cobros_credito,
                                     v.cobros_portal_efectivo);

    -- La base es el ultimo CONFIRMADO anterior. Los sin conteo no pueden serlo
    -- —`resolver_corte_caja` ya no los deja confirmar— asi que no hace falta
    -- excluirlos aca: la condicion de estado alcanza.
    SELECT public.corte_diferencia(c2.total_declarado, c2.diferencia_erp, c2.tk_total_caja,
                                   c2.tk_subtotal, c2.tk_vales, c2.tk_cobros_credito,
                                   c2.cobros_portal_efectivo)
      INTO v_base
      FROM public.cortes_caja c2
     WHERE c2.branch_id = v.branch_id
       AND c2.fecha     = v.fecha
       AND c2.tipo      = 'C'
       AND c2.estado    = 'CONFIRMADO'
       AND (c2.hora, c2.id) < (v.hora, v.id)
     ORDER BY c2.hora DESC, c2.id DESC
     LIMIT 1;

    RETURN round(v_dif - coalesce(v_base, 0), 2);
END;
$function$;
