SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Lo que está por vencerse: la franja abierta a la que le quedan minutos.
--
-- ── Por qué hace falta un aviso ────────────────────────────────────────────
-- Medido el 2026-08-25 sobre los primeros nueve días: **45 de 270 lecturas
-- (17%) entraron fuera de hora**. Nadie se olvida a propósito de una franja de
-- dos horas: se olvida porque en la sala no hay nada que lo recuerde, y la
-- bitácora es la única tarea del día que no la dispara un cliente. El ítem
-- 6.1.14 del RTS pide que el registro sea CONTEMPORÁNEO — una lectura anotada a
-- las 21:00 sobre lo que marcaba el termómetro a las 13:00 no lo es, aunque el
-- número sea cierto.
--
-- ── Se avisa de lo que TODAVÍA SE PUEDE anotar a tiempo ────────────────────
-- Entra la franja que ya abrió (`desde <= ahora`) y que cierra dentro de los
-- próximos `p_minutos`. Lo que aún no abrió no es un pendiente —la base misma
-- lo rechaza—, y lo que ya venció es otra alarma: avisar de eso sería llegar
-- tarde a decir que se llegó tarde.
--
-- ── Un mes cerrado no genera avisos ────────────────────────────────────────
-- Cerrado y firmado, no se puede anotar sin reabrirlo. Un aviso que pide algo
-- que la base va a rechazar enseña a ignorar los avisos.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.bitacora_pendientes_por_vencer(p_minutos integer DEFAULT 45)
RETURNS TABLE (
    branch_id   bigint,
    branch_name text,
    fecha       date,
    cierra      text,
    minutos     integer,
    pendientes  integer,
    lecturas    integer,
    limpiezas   integer,
    areas       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
    WITH ahora AS (
        SELECT public.bitacora_hoy_sv() AS hoy, public.bitacora_ahora_sv()::time AS t
    ),
    bloques AS (
        -- Las franjas de temperatura y los turnos de limpieza son el mismo
        -- objeto para este cálculo: algo que hay que anotar dentro de una
        -- ventana. Tratarlos aparte daría dos avisos para la misma vuelta.
        SELECT ar.branch_id, ar.id AS area_id, ar.nombre, 'lectura'::text AS tipo,
               f->>'clave' AS clave, (f->>'desde')::time AS desde, (f->>'hasta')::time AS hasta
          FROM public.bitacora_areas ar
          CROSS JOIN ahora
          CROSS JOIN LATERAL jsonb_array_elements(ar.franjas) f
         WHERE ar.activa
           AND extract(isodow FROM ahora.hoy)::smallint = ANY (ar.dias_semana)
           AND ahora.hoy >= ar.vigente_desde
        UNION ALL
        SELECT ar.branch_id, ar.id, ar.nombre, 'limpieza',
               f->>'clave', (f->>'desde')::time, (f->>'hasta')::time
          FROM public.bitacora_areas ar
          CROSS JOIN ahora
          CROSS JOIN LATERAL jsonb_array_elements(ar.limpiezas) f
         WHERE ar.activa
           AND extract(isodow FROM ahora.hoy)::smallint = ANY (ar.dias_semana)
           AND ahora.hoy >= ar.vigente_desde
    ),
    faltan AS (
        SELECT b.*, ahora.hoy, ahora.t
          FROM bloques b CROSS JOIN ahora
         WHERE b.desde <= ahora.t
           AND b.hasta >  ahora.t
           AND b.hasta <= ahora.t + make_interval(mins => p_minutos)
           AND NOT public.bitacora_periodo_cerrado(b.branch_id, to_char(ahora.hoy, 'YYYY-MM'))
           AND NOT EXISTS (
               SELECT 1 FROM public.bitacora_lecturas l
                WHERE b.tipo = 'lectura' AND l.area_id = b.area_id
                  AND l.fecha = ahora.hoy AND l.franja = b.clave)
           AND NOT EXISTS (
               SELECT 1 FROM public.bitacora_limpiezas li
                WHERE b.tipo = 'limpieza' AND li.area_id = b.area_id
                  AND li.fecha = ahora.hoy AND li.turno = b.clave)
    )
    SELECT f.branch_id,
           br.name,
           f.hoy,
           to_char(f.hasta, 'HH24:MI'),
           -- Se redondea hacia abajo: decir «quedan 20» cuando quedan 20.7 es
           -- preferible a decir 21 y que la franja cierre antes.
           floor(extract(epoch FROM (f.hasta - f.t)) / 60)::integer,
           count(*)::integer,
           count(*) FILTER (WHERE f.tipo = 'lectura')::integer,
           count(*) FILTER (WHERE f.tipo = 'limpieza')::integer,
           string_agg(DISTINCT f.nombre, ', ')
      FROM faltan f
      JOIN public.branches br ON br.id = f.branch_id
     -- Se agrupa por HORA DE CIERRE y no por sucursal: la bodega central tiene
     -- franjas propias (cierra 08:00 y no abre a las 07:00 como las farmacias),
     -- así que una sala puede tener dos ventanas distintas cerrando en la misma
     -- media hora y cada una es un aviso con su propia hora.
     GROUP BY f.branch_id, br.name, f.hoy, f.hasta, f.t
     ORDER BY f.branch_id, f.hasta;
$function$;

REVOKE EXECUTE ON FUNCTION public.bitacora_pendientes_por_vencer(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bitacora_pendientes_por_vencer(integer) TO service_role;
