SET lock_timeout = '5s';

-- Fichas que la migración de clientes NO tocó, y por qué.
--
-- Existían solo como archivos JSON en `scripts/migracion-clientes/`, o sea que
-- nadie que use el portal podía verlas. Son dos familias:
--
--   · fiscal_congelado — 101 fichas de categoría fiscal. Por decisión del
--     usuario no se corrigen automáticamente: cada dato fiscal necesita una
--     persona detrás. 93 tienen ficha en el portal, 8 no.
--   · *_repetido — 49 fichas que NO se crearon para no duplicar un cliente que
--     ya existe. Solo 2 tienen ficha en el portal: las otras 47 no existen en
--     `customers`, y por eso hacen falta `name`/`datos` acá — no hay fila a la
--     que apuntar.
--
-- `datos` guarda el snapshot de la ficha para las que no existen: sin él,
-- decidir "¿la creo o la descarto?" obligaría a salir del portal.
CREATE TABLE IF NOT EXISTS public.clientes_por_revisar (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  erp_id         text        NOT NULL,
  name           text        NOT NULL,
  motivo         text        NOT NULL
                 CHECK (motivo IN ('fiscal_congelado', 'nombre_repetido',
                                   'dui_repetido', 'nit_repetido')),
  detalle        text,
  customer_id    bigint      REFERENCES public.customers(id) ON DELETE SET NULL,
  datos          jsonb,
  descartado_at  timestamptz,
  descartado_por text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- Repoblar es idempotente: una ficha puede tener DOS motivos distintos
  -- (fiscal y repetida), pero no dos filas del mismo motivo.
  UNIQUE (erp_id, motivo)
);

-- FK con índice que la cubra, y los dos filtros que la vista usa siempre.
CREATE INDEX IF NOT EXISTS clientes_por_revisar_customer_idx
  ON public.clientes_por_revisar (customer_id);
CREATE INDEX IF NOT EXISTS clientes_por_revisar_pendientes_idx
  ON public.clientes_por_revisar (motivo) WHERE descartado_at IS NULL;

ALTER TABLE public.clientes_por_revisar ENABLE ROW LEVEL SECURITY;

-- Lectura para quien pueda ver el módulo. El `(SELECT ...)` NO es cosmético:
-- sin él Postgres evalúa la función POR FILA (incidente 2026-07-08).
DROP POLICY IF EXISTS clientes_por_revisar_select ON public.clientes_por_revisar;
CREATE POLICY clientes_por_revisar_select ON public.clientes_por_revisar
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes', 'can_view')));

-- Sin policy de escritura a propósito: se escribe solo por los RPC de abajo,
-- que son DEFINER y validan el permiso de edición.


-- ── Lectura ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_clientes_por_revisar(
    p_familia text DEFAULT NULL,
    p_limit   integer DEFAULT 50,
    p_offset  integer DEFAULT 0)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_res json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('clientes', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  WITH vivos AS (
    SELECT r.*,
           CASE WHEN r.motivo = 'fiscal_congelado' THEN 'congelado' ELSE 'repetido' END AS familia
    FROM public.clientes_por_revisar r
    WHERE r.descartado_at IS NULL
  ), filtrados AS (
    SELECT * FROM vivos
    WHERE p_familia IS NULL OR familia = p_familia
  )
  SELECT json_build_object(
    'total',     (SELECT count(*) FROM filtrados),
    'congelado', (SELECT count(*) FROM vivos WHERE familia = 'congelado'),
    'repetido',  (SELECT count(*) FROM vivos WHERE familia = 'repetido'),
    'filas', coalesce((
      SELECT json_agg(to_json(f) ORDER BY f.familia, f.name)
      FROM (
        SELECT r.id, r.erp_id, r.name, r.motivo, r.detalle, r.familia,
               r.customer_id, r.datos, r.created_at,
               -- El nombre que hoy tiene la ficha del portal, si existe: sirve
               -- para ver de un vistazo si el nombre cambió desde entonces.
               c.name AS nombre_portal
        FROM filtrados r
        LEFT JOIN public.customers c ON c.id = r.customer_id
        ORDER BY r.motivo, r.name
        LIMIT greatest(p_limit, 0) OFFSET greatest(p_offset, 0)
      ) f
    ), '[]'::json)
  ) INTO v_res;

  RETURN v_res;
END;
$function$;


-- ── Descartar: "ya lo miré, no hay nada que hacer" ───────────────────────────
-- Es la contraparte de `descartado_at` en el espejo: una decisión que no se
-- anota se vuelve a tomar, y esta lista volvería a mostrar lo mismo para
-- siempre.
CREATE OR REPLACE FUNCTION public.descartar_cliente_por_revisar(
    p_id bigint, p_deshacer boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'sin permiso para revisar clientes';
  END IF;

  UPDATE public.clientes_por_revisar
     SET descartado_at  = CASE WHEN p_deshacer THEN NULL ELSE now() END,
         descartado_por = CASE WHEN p_deshacer THEN NULL
                               ELSE coalesce(auth.jwt() ->> 'email', 'desconocido') END,
         updated_at     = now()
   WHERE id = p_id;
END;
$function$;


-- ── Carga: la escriben los scripts de migración ─────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_clientes_por_revisar(p_filas json)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'sin permiso para revisar clientes';
  END IF;

  WITH filas AS (
    SELECT * FROM json_to_recordset(p_filas) AS x(
        erp_id text, name text, motivo text, detalle text, datos jsonb)
  )
  INSERT INTO public.clientes_por_revisar
      (erp_id, name, motivo, detalle, datos, customer_id)
  SELECT f.erp_id, f.name, f.motivo, f.detalle, f.datos,
         (SELECT c.id FROM public.customers c WHERE c.erp_id = f.erp_id)
  FROM filas f
  ON CONFLICT (erp_id, motivo) DO UPDATE SET
      name        = EXCLUDED.name,
      detalle     = EXCLUDED.detalle,
      datos       = EXCLUDED.datos,
      customer_id = EXCLUDED.customer_id,
      updated_at  = now()
  -- Sin este guard, repoblar reescribe las 150 filas cada vez aunque nada haya
  -- cambiado: es el mismo churn de WAL que el proyecto prohíbe en los syncs.
  WHERE (public.clientes_por_revisar.name, public.clientes_por_revisar.detalle,
         public.clientes_por_revisar.datos, public.clientes_por_revisar.customer_id)
        IS DISTINCT FROM
        (EXCLUDED.name, EXCLUDED.detalle, EXCLUDED.datos, EXCLUDED.customer_id);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_clientes_por_revisar(text, integer, integer)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.descartar_cliente_por_revisar(bigint, boolean)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_clientes_por_revisar(json)                  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_clientes_por_revisar(text, integer, integer)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.descartar_cliente_por_revisar(bigint, boolean)     TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.upsert_clientes_por_revisar(json)                  TO authenticated, service_role;
