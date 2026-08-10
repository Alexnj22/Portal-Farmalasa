SET lock_timeout = '5s';

-- ══════════════════════════════════════════════════════════════════════════
-- El lazo: de qué se entera la corrida nocturna, y qué recuerda haber hecho
-- ══════════════════════════════════════════════════════════════════════════
-- Hasta ahora la corrida sacaba su lista del ESPEJO (`customers.distrito IS
-- NULL`) y escribía en el ERP. Cuando las dos copias divergen mira la copia
-- equivocada: OVED tenía CHALATENANGO en el portal —así que no era candidato— y
-- el distrito VACÍO en el ERP, que es la ficha que viaja a Hacienda. Era
-- invisible justo para el proceso hecho para arreglarlo.
--
-- La señal que no depende del espejo es el rechazo mismo.

-- ── Lo que ya se corrigió, para no repetirlo eternamente ──────────────────
CREATE TABLE IF NOT EXISTS public.dte_correcciones_ficha (
  id          bigserial PRIMARY KEY,
  erp_id      text        NOT NULL,
  customer_id bigint,
  campo       text        NOT NULL,   -- ubicacion | distrito | dui
  antes       text,
  despues     text,
  motivo      text        NOT NULL,   -- sin_municipio | sin_distrito | rechazo_distrito | dui_invalido
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dte_correcciones_ficha_erp_campo_idx
  ON public.dte_correcciones_ficha (erp_id, campo, created_at DESC);
CREATE INDEX IF NOT EXISTS dte_correcciones_ficha_customer_idx
  ON public.dte_correcciones_ficha (customer_id);

ALTER TABLE public.dte_correcciones_ficha ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dte_correcciones_ficha_select ON public.dte_correcciones_ficha;
CREATE POLICY dte_correcciones_ficha_select ON public.dte_correcciones_ficha
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));

-- Append-only y sólo desde el proceso: la escribe la corrida con service_role,
-- que no pasa por RLS. Sin policy de INSERT/UPDATE/DELETE a propósito.

COMMENT ON TABLE public.dte_correcciones_ficha IS
  'Qué corrigió la corrida nocturna en la ficha del ERP y por qué. Append-only. '
  'Sirve de freno: si Hacienda vuelve a rechazar el mismo campo DESPUÉS de que '
  'se lo corrigió, la corrección no bastó y la ficha va a «Por revisar» en vez '
  'de reintentarse cada noche.';


-- ── Un motivo nuevo para «Por revisar» ────────────────────────────────────
ALTER TABLE public.clientes_por_revisar
  DROP CONSTRAINT IF EXISTS clientes_por_revisar_motivo_check;
ALTER TABLE public.clientes_por_revisar
  ADD CONSTRAINT clientes_por_revisar_motivo_check
  CHECK (motivo = ANY (ARRAY[
    'fiscal_congelado'::text, 'nombre_repetido'::text, 'dui_repetido'::text,
    'nit_repetido'::text, 'fusion_dudosa'::text,
    'rechazo_persistente'::text]));


-- ── La lista de trabajo ───────────────────────────────────────────────────
-- Dos fuentes:
--   · reactiva   — a quien Hacienda rechazó por un campo de la ficha
--   · preventiva — fichas sin distrito (lo que ya hacía)
--
-- `puede_escribir` separa las dos políticas que decidió el usuario: en el ERP
-- sólo se tocan CONSUMIDORES; a los contribuyentes se los espeja al portal y
-- nada más.
--
-- `ya_corregido` es el freno: hay una corrección de ese mismo campo ANTERIOR al
-- rechazo, o sea que ya se intentó y no alcanzó.
CREATE OR REPLACE FUNCTION public.fichas_para_corregir_dte()
RETURNS TABLE (
  customer_id bigint, name text, erp_id text, categoria text,
  origen text, campo text, motivo_mh text,
  puede_escribir boolean, ya_corregido boolean
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  WITH rechazados AS (
    SELECT DISTINCT ON (r.customer_id, r.campo_ficha)
           r.customer_id, r.cliente, r.erp_id, r.categoria,
           r.campo_ficha, r.motivo, r.ultimo_intento
    FROM public.dte_rechazos_vigentes r
    WHERE r.accionable
      AND r.campo_ficha IN ('distrito','municipio','departamento','dui')
      AND r.customer_id IS NOT NULL
    ORDER BY r.customer_id, r.campo_ficha, r.ultimo_intento DESC
  )
  SELECT rc.customer_id, rc.cliente, rc.erp_id, rc.categoria,
         'rechazo'::text, rc.campo_ficha, rc.motivo,
         (rc.categoria = 'Consumidor' OR rc.categoria IS NULL),
         EXISTS (
           SELECT 1 FROM public.dte_correcciones_ficha k
           WHERE k.customer_id = rc.customer_id
             AND k.campo IN (rc.campo_ficha, 'ubicacion')
             AND k.created_at < rc.ultimo_intento
         )
  FROM rechazados rc

  UNION ALL

  SELECT c.id, c.name, c.erp_id, c.categoria,
         'sin_distrito'::text, 'distrito'::text, NULL::text,
         true, false
  FROM public.clientes_sin_distrito_corregibles() c
  WHERE NOT EXISTS (SELECT 1 FROM rechazados rc WHERE rc.customer_id = c.id);
$$;

REVOKE EXECUTE ON FUNCTION public.fichas_para_corregir_dte() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fichas_para_corregir_dte() TO authenticated, service_role;

COMMENT ON FUNCTION public.fichas_para_corregir_dte() IS
  'La lista de trabajo de la corrida nocturna. Reactiva (Hacienda rechazó un '
  'campo de la ficha) + preventiva (sin distrito). `puede_escribir` = sólo '
  'consumidores se tocan en el ERP; el resto sólo se espeja. `ya_corregido` = '
  'el campo ya se había corregido antes de este rechazo, así que no alcanzó.';
