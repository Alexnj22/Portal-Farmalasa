-- Al contribuyente se le completa el distrito, y NADA MÁS (2026-08-16).
--
-- Pedido del usuario: «si es contribuyente, permite editar el distrito si no
-- está también. así se corrige.» Hasta hoy el circuito no le escribía ni una
-- letra a la ficha de un contribuyente (decisión del 2026-08-09), y por eso tres
-- facturas de Salud 1 llevaban días rebotando en Hacienda por un distrito vacío.
--
-- ── Por qué NO alcanza con marcarlos «se puede escribir» ────────────────────
-- La regla que ya existía para consumidores, cuando Hacienda rechaza la
-- ubicación, es poner el TRIPLE POR DEFECTO: Chalatenango / Chalatenango Sur /
-- CHALATENANGO. Medido antes de tocar nada, sobre las 77 fichas de
-- contribuyente y gran contribuyente sin distrito:
--
--   Chalatenango .... 62      San Salvador .... 10
--   La Libertad ......  3     San Miguel ......  2      Sonsonate ..... 1
--
-- O sea que el default habría **mudado de departamento a 15 contribuyentes**, y
-- el domicilio de un contribuyente es un dato de su documento fiscal. Las 77
-- tienen departamento y municipio; lo único que les falta es el distrito.
--
-- Por eso el alcance no es un booleano sino tres valores, y el del contribuyente
-- es `solo_distrito`: se deriva el distrito DENTRO de su propio municipio con el
-- matcher —el mismo que decidió 25,946 fichas— y no se toca nada más. Ni el
-- departamento, ni el municipio, ni el DUI, ni el teléfono.
--
-- `Extranjero` queda en `ninguno` a propósito (2 fichas): escribirle un distrito
-- salvadoreño a una dirección del exterior es inventar un hecho.
--
-- ── Por qué `clientes_sin_distrito_corregibles()` NO se toca ────────────────
-- Su contrato es «fichas que se pueden tocar ENTERAS», y quien la lee no es sólo
-- la Edge Function: `scripts/migracion-clientes/resolver_observaciones.py` la usa
-- para decidir a quién le pasa `bloque.py`, que aplica las reglas completas
-- —incluido el triple por defecto—. Ensancharla habría hecho que ese script,
-- si alguien lo corre, empiece a mudar contribuyentes en silencio. Los
-- contribuyentes entran por una rama propia de `fichas_para_corregir_dte()`.

SET lock_timeout = '5s';

-- ── El alcance de escritura, en UN solo lugar ───────────────────────────────
-- Vivía repartido: el `CASE` de `fichas_para_corregir_dte`, el `WHERE` de
-- `clientes_sin_distrito_corregibles` y el `else if` de la Edge Function decían
-- lo mismo tres veces. Ahora la política es esta función y las tres la llaman.
CREATE OR REPLACE FUNCTION public.alcance_escritura_ficha(p_categoria text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    -- Consumidor, o ficha sin categoría (huérfana de la migración): todo.
    WHEN p_categoria IS NULL OR p_categoria = 'Consumidor' THEN 'todo'
    -- Contribuyente: sólo el distrito, y sólo si falta.
    WHEN p_categoria IN ('Contribuyente', 'Gran Contribuyente') THEN 'solo_distrito'
    -- Extranjero y cualquier categoría nueva: sólo espejo. Que una categoría
    -- desconocida caiga en «no tocar» es la falla segura — al revés, el día que
    -- aparezca una el circuito le escribiría sin que nadie lo haya decidido.
    ELSE 'ninguno'
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.alcance_escritura_ficha(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.alcance_escritura_ficha(text) TO authenticated, service_role;

-- ── La lista de trabajo ─────────────────────────────────────────────────────
-- `puede_escribir boolean` → `alcance_escritura text`. Cambia la forma de la
-- salida, así que hay que soltarla antes: `CREATE OR REPLACE` no puede.
DROP FUNCTION IF EXISTS public.fichas_para_corregir_dte();

CREATE FUNCTION public.fichas_para_corregir_dte()
 RETURNS TABLE(customer_id bigint, name text, erp_id text, categoria text, origen text, campo text, motivo_mh text, alcance_escritura text, ya_corregido boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH rechazados AS (
    SELECT DISTINCT ON (r.customer_id, r.campo_ficha)
           r.customer_id, r.cliente, r.erp_id, r.categoria,
           r.campo_ficha, r.motivo, r.ultimo_intento
    FROM public.dte_rechazos_vigentes r
    WHERE r.accionable
      -- `phone` se sumó el 2026-08-16. La lista es «qué campos sabe corregir
      -- la corrida de fichas», y tiene que coincidir con las ramas de su tabla
      -- de decisión: un campo de más deja una ficha dando vueltas sin que nadie
      -- la escriba, uno de menos la vuelve invisible para el proceso hecho para
      -- arreglarla — que fue exactamente lo que pasó con el teléfono.
      AND r.campo_ficha IN ('distrito','municipio','departamento','dui','phone')
      AND r.customer_id IS NOT NULL
    ORDER BY r.customer_id, r.campo_ficha, r.ultimo_intento DESC
  ),
  todo AS (
    -- ① Lo que Hacienda rechazó. La señal que no depende del espejo.
    SELECT rc.customer_id, rc.cliente AS name, rc.erp_id, rc.categoria,
           'rechazo'::text AS origen, rc.campo_ficha AS campo, rc.motivo AS motivo_mh,
           public.alcance_escritura_ficha(rc.categoria) AS alcance_escritura,
           EXISTS (
             SELECT 1 FROM public.dte_correcciones_ficha k
             WHERE k.customer_id = rc.customer_id
               AND k.campo IN (rc.campo_ficha, 'ubicacion')
               AND k.created_at < rc.ultimo_intento
           ) AS ya_corregido
    FROM rechazados rc

    UNION ALL

    -- ② Preventivo, alcance completo: consumidores y huérfanas sin distrito.
    SELECT c.id, c.name, c.erp_id, c.categoria,
           'sin_distrito'::text, 'distrito'::text, NULL::text,
           public.alcance_escritura_ficha(c.categoria), false
    FROM public.clientes_sin_distrito_corregibles() c
    WHERE NOT EXISTS (SELECT 1 FROM rechazados rc WHERE rc.customer_id = c.id)

    UNION ALL

    -- ③ Preventivo, SÓLO distrito: contribuyentes que todavía no rebotaron.
    -- Rama propia y no `clientes_sin_distrito_corregibles()` — ver el encabezado:
    -- esa función también la lee el script viejo, que aplica las reglas enteras.
    SELECT c.id, c.name, c.erp_id, c.categoria,
           'sin_distrito'::text, 'distrito'::text, NULL::text,
           public.alcance_escritura_ficha(c.categoria), false
    FROM public.customers c
    WHERE c.distrito IS NULL
      AND public.alcance_escritura_ficha(c.categoria) = 'solo_distrito'
      AND NOT public.es_cliente_mostrador(c.name, c.erp_id)
      AND NOT EXISTS (SELECT 1 FROM rechazados rc WHERE rc.customer_id = c.id)
  )
  -- El orden importa: la corrida corta en 120 fichas por presupuesto de tiempo,
  -- y lo que Hacienda ya rechazó tiene una factura esperando detrás. Sin este
  -- ORDER BY el corte lo decide el plan del día.
  SELECT t.customer_id, t.name, t.erp_id, t.categoria, t.origen, t.campo,
         t.motivo_mh, t.alcance_escritura, t.ya_corregido
  FROM todo t
  ORDER BY (t.origen <> 'rechazo'), t.customer_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.fichas_para_corregir_dte() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fichas_para_corregir_dte() TO authenticated, service_role;
