SET lock_timeout = '5s';

-- Las piezas del cajón de CADA sala y día del rango, para las fichas de Cortes.
--
-- ── Por qué existe ────────────────────────────────────────────────────────
-- La ficha de «Las cajas» decía «Efectivo del día» y mostraba lo VENDIDO en
-- efectivo. No es lo que hay en el cajón: un ingreso por aplicar una inyección
-- entra y no es una venta, y un vale sale y tampoco. Medido el 2026-09-04 en
-- Salud 4: vendido en efectivo $280.15, ingresos $96.76, vales $90.00 — en el
-- cajón hay $286.91. La ficha decía $280.15, que no es ninguno de los dos.
--
-- ── Por qué llama a `caja_efectivo_piezas` en vez de rehacer la cuenta ─────
-- Esa función YA es el canónico del cajón: la usa `operar-caja` para decidir de
-- dónde sale una salida de efectivo, y el panel de Mi caja para mostrar la
-- cuenta renglón por renglón. Rehacer la aritmética acá sería el mismo juez con
-- otras piezas — dos respuestas sobre el mismo cajón el día que una de las dos
-- copias se quede vieja. Esta función sólo la llama una vez por sala y día.
--
-- ── Por qué SÓLO con alcance ALL ──────────────────────────────────────────
-- «Cuánto hay en el cajón» ES la respuesta del conteo a ciegas. Quien opera una
-- sala la cuenta, así que no puede recibirla — y esconderla en la pantalla no
-- alcanza: el número igual habría viajado al navegador. Es el mismo alcance de
-- `cortes_caja` que la ficha usa para decidir si pinta los montos.
CREATE OR REPLACE FUNCTION public.get_caja_piezas_del_rango(
    p_desde date, p_hasta date, p_branch integer DEFAULT NULL)
RETURNS TABLE(branch_id integer, fecha date, piezas json)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NOT (SELECT public.auth_has_module_permission('cortes_caja', 'can_view'))
       OR (SELECT public.auth_module_scope('cortes_caja')) <> 'ALL' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT a.sala, a.dia,
           public.caja_efectivo_piezas(a.sala, a.dia, a.apertura)
      FROM (
            -- Una fila por sala y día, no por apertura: el cajón es del DÍA, y
            -- dos turnos de la misma sala comparten sus billetes. La apertura
            -- se suma por eso mismo — es todo el fondo con el que arrancó.
            SELECT ap.branch_id AS sala,
                   ap.abierta_el AS dia,
                   round(sum(coalesce(ap.monto_apertura, 0)), 2) AS apertura
              FROM public.cortes_caja_aperturas ap
             WHERE ap.abierta_el BETWEEN p_desde AND p_hasta
               AND (p_branch IS NULL OR ap.branch_id = p_branch)
             GROUP BY 1, 2
           ) a;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_caja_piezas_del_rango(date, date, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_caja_piezas_del_rango(date, date, integer) TO authenticated, service_role;
