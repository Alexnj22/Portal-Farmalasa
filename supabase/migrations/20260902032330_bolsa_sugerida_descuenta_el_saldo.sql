SET lock_timeout = '5s';

/* ── LA BOLSA NUEVA SE MIDE CONTRA EL SALDO, NO CONTRA LA ETIQUETA ─────────
 *
 * Reportado por el usuario (1-sep): la etiqueta de `S3-1225` decía **$787.01**
 * y en el cajón había más.
 *
 * `bolsa_sugerida` restaba la suma de los `monto_inicial` de las bolsas del
 * día. Pero a una bolsa se le puede SACAR dinero —una remesa, un pago— y
 * entonces lo que tiene adentro ya no es lo que dice su etiqueta.
 *
 * Salud 3, 1-sep:
 *
 *   S3-1216   nació con $359.60, `REM-1058` le sacó $119.38  →  quedan $240.22
 *   corte     declarado $1,146.61
 *
 *   con monto_inicial:  1146.61 − 359.60 = 787.01   ← lo que salió, y falta
 *   con saldo:          1146.61 − 240.22 = 906.39   ← lo que hay en el cajón
 *
 * El declarado es TODO el efectivo del día que la sala tiene: lo que queda en
 * las bolsas viejas más lo del cajón. Si se resta la etiqueta en vez del saldo,
 * la bolsa nueva se lleva de menos exactamente lo que ya había salido, y esos
 * $119.38 quedan en el cajón como un sobrante que nadie puede explicar —
 * porque ese dinero no está: se fue con la remesa.
 *
 * `bolsa_saldo` es la misma función con la que se valida cada salida, así que
 * las dos mitades del circuito miden con la misma vara.
 */
CREATE OR REPLACE FUNCTION public.bolsa_sugerida(p_corte_id bigint)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
    SELECT round(c.total_declarado - coalesce((
        SELECT sum(public.bolsa_saldo(b.id))
          FROM public.bolsas b
         WHERE b.branch_id = c.branch_id
           AND b.fecha     = c.fecha
           AND b.estado   <> 'ANULADA'
    ), 0), 2)
      FROM public.cortes_caja c
     WHERE c.id = p_corte_id;
$function$;
