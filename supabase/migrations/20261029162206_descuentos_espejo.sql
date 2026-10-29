-- PENDIENTES 30 (usuario 2026-10-29: «sí, hazlo»). La factura del sistema de
-- ventas NO trae el descuento del renglón —trae precio y total ya rebajado—,
-- así que una rebaja de campaña y un precio cambiado a mano se ven igual.
-- Se separan cruzando cada rebaja con las campañas de descuento.
--
-- Las campañas viven en el sistema de ventas y allá se BORRAN y se EDITAN sin
-- dejar rastro. Este espejo las guarda: la edge function
-- `espejo-descuentos` (cron 3 veces al día) lo pone al día por
-- `descuentos_espejo_sync`, que sólo escribe lo que cambió. Una campaña que
-- desaparece allá NO se borra acá: se marca `borrado_at`, porque las ventas
-- que hizo siguen siendo de esa campaña.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.descuentos_espejo (
  id              integer PRIMARY KEY,          -- id del descuento en el sistema de ventas
  descripcion     text NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('%', '$')),
  monto           numeric NOT NULL,             -- '$' = por CADA unidad
  inicio          date NOT NULL,
  fin             date NOT NULL,
  todas_las_salas boolean NOT NULL,
  branch_id       bigint REFERENCES public.branches(id),
  productos       integer[] NOT NULL DEFAULT '{}',
  borrado_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS descuentos_espejo_branch_id_idx ON public.descuentos_espejo (branch_id);
ALTER TABLE public.descuentos_espejo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS descuentos_espejo_select ON public.descuentos_espejo;
CREATE POLICY descuentos_espejo_select ON public.descuentos_espejo FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('promociones', 'can_view')));

-- p: [{id, descripcion, tipo, monto, inicio, fin, todas_las_salas, branch_id, productos|null}]
-- `productos` null = no se releyeron (campaña ya terminada): se conservan.
-- `completa` = la lista es la de TODA la red; sólo así se marca lo ausente.
CREATE OR REPLACE FUNCTION public.descuentos_espejo_sync(p jsonb, completa boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  n_cambios integer;
  n_borrados integer := 0;
BEGIN
  INSERT INTO public.descuentos_espejo AS d
    (id, descripcion, tipo, monto, inicio, fin, todas_las_salas, branch_id, productos)
  SELECT (x->>'id')::int, x->>'descripcion', x->>'tipo', (x->>'monto')::numeric,
         (x->>'inicio')::date, (x->>'fin')::date, (x->>'todas_las_salas')::boolean,
         nullif(x->>'branch_id', '')::bigint,
         CASE WHEN jsonb_typeof(x->'productos') = 'array'
              THEN ARRAY(SELECT e::int FROM jsonb_array_elements_text(x->'productos') e)
              ELSE coalesce((SELECT v.productos FROM public.descuentos_espejo v
                              WHERE v.id = (x->>'id')::int), '{}') END
    FROM jsonb_array_elements(p) x
  ON CONFLICT (id) DO UPDATE SET
    descripcion = EXCLUDED.descripcion, tipo = EXCLUDED.tipo, monto = EXCLUDED.monto,
    inicio = EXCLUDED.inicio, fin = EXCLUDED.fin, todas_las_salas = EXCLUDED.todas_las_salas,
    branch_id = EXCLUDED.branch_id, productos = EXCLUDED.productos,
    borrado_at = NULL, updated_at = now()
  WHERE (d.descripcion, d.tipo, d.monto, d.inicio, d.fin, d.todas_las_salas, d.branch_id, d.productos, d.borrado_at)
        IS DISTINCT FROM
        (EXCLUDED.descripcion, EXCLUDED.tipo, EXCLUDED.monto, EXCLUDED.inicio, EXCLUDED.fin,
         EXCLUDED.todas_las_salas, EXCLUDED.branch_id, EXCLUDED.productos, NULL::timestamptz);
  GET DIAGNOSTICS n_cambios = ROW_COUNT;

  -- Freno: una lista vacía (sesión vencida allá) no borra nada.
  IF completa AND jsonb_array_length(p) > 0 THEN
    UPDATE public.descuentos_espejo SET borrado_at = now(), updated_at = now()
     WHERE borrado_at IS NULL
       AND id NOT IN (SELECT (x->>'id')::int FROM jsonb_array_elements(p) x);
    GET DIAGNOSTICS n_borrados = ROW_COUNT;
  END IF;
  RETURN json_build_object('cambios', n_cambios, 'borrados', n_borrados);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.descuentos_espejo_sync(jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.descuentos_espejo_sync(jsonb, boolean) TO service_role;
