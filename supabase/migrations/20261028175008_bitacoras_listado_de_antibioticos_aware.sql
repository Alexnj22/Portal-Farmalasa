SET lock_timeout = '5s';
-- Listado de antibióticos con su grupo AWaRe — Guía de Verificación BPAD 1.13
-- (MAYOR), RTS 11.02.04:24 §6.1.15.
--
-- El grupo es de la MOLÉCULA, no del producto: una tabla chica por principio
-- activo, y el listado sale de cruzarla con el catálogo. Así un producto nuevo
-- entra solo al listado el día que aparece, sin que nadie lo marque.
--
-- Fuente, en este orden: el Listado Oficial de Medicamentos 2026 de la SRS,
-- cap. J01 (`*(1)` Acceso, `*(2)` Precaución); lo que el LOM no marca o no
-- trae, la clasificación AWaRe 2023 de la OMS. Cada fila dice de cuál salió, y
-- `confirmado_por` queda vacío hasta que el regente la revise: la tabla es una
-- propuesta, no una firma.
CREATE TABLE IF NOT EXISTS public.antibioticos_aware (
    molecula        text PRIMARY KEY,                 -- minúsculas, sin tildes: se busca en pactivo_norm / nombre_norm
    grupo           text CHECK (grupo IN ('acceso','precaucion','reserva')),
    atc             text,
    fuente          text NOT NULL CHECK (fuente IN ('LOM 2026','OMS AWaRe 2023','sin clasificar')),
    confirmado_por  uuid REFERENCES public.employees(id),
    confirmado_at   timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.antibioticos_aware ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS antibioticos_aware_select ON public.antibioticos_aware;
CREATE POLICY antibioticos_aware_select ON public.antibioticos_aware
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS antibioticos_aware_update ON public.antibioticos_aware;
CREATE POLICY antibioticos_aware_update ON public.antibioticos_aware
    FOR UPDATE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['bitacoras_configurar'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['bitacoras_configurar'])));
REVOKE ALL ON public.antibioticos_aware FROM anon;

INSERT INTO public.antibioticos_aware (molecula, grupo, atc, fuente) VALUES
  ('amoxicilina',     'acceso',     'J01CA04', 'LOM 2026'),
  ('ampicilina',      'acceso',     'J01CA01', 'LOM 2026'),
  ('penicilina',      'acceso',     'J01CE',   'LOM 2026'),
  ('cefazolina',      'acceso',     'J01DB04', 'LOM 2026'),
  ('ceftriaxona',     'precaucion', 'J01DD04', 'LOM 2026'),
  ('claritromicina',  'precaucion', 'J01FA09', 'LOM 2026'),
  ('ciprofloxacin',   'precaucion', 'J01MA02', 'LOM 2026'),
  ('doxiciclina',     'acceso',     'J01AA02', 'LOM 2026'),
  ('clindamicina',    'acceso',     'J01FF01', 'LOM 2026'),
  ('gentamicina',     'acceso',     'J01GB03', 'LOM 2026'),
  ('amikacina',       'acceso',     'J01GB06', 'LOM 2026'),
  ('metronidazol',    'acceso',     'J01XD01', 'LOM 2026'),
  ('nitrofurantoina', 'acceso',     'J01XE01', 'LOM 2026'),
  ('fosfomicina',     'acceso',     'J01XX01', 'LOM 2026'),
  ('sulfametoxazol',  'acceso',     'J01EE01', 'LOM 2026'),
  ('cloranfenicol',   'acceso',     'J01BA01', 'LOM 2026'),
  ('vancomicina',     'precaucion', 'J01XA01', 'LOM 2026'),
  ('piperacilina',    'precaucion', 'J01CR05', 'LOM 2026'),
  ('levofloxacin',    'precaucion', 'J01MA12', 'OMS AWaRe 2023'),
  ('cefadroxilo',     'acceso',     'J01DB05', 'OMS AWaRe 2023'),
  ('oxacilina',       'acceso',     'J01CF04', 'OMS AWaRe 2023'),
  ('imipenem',        'precaucion', 'J01DH51', 'OMS AWaRe 2023'),
  ('azitromicina',    'precaucion', 'J01FA10', 'OMS AWaRe 2023'),
  ('cefixima',        'precaucion', 'J01DD08', 'OMS AWaRe 2023'),
  ('cefdinir',        'precaucion', 'J01DD15', 'OMS AWaRe 2023'),
  ('moxifloxacin',    'precaucion', 'J01MA14', 'OMS AWaRe 2023'),
  ('norfloxacin',     'precaucion', 'J01MA06', 'OMS AWaRe 2023'),
  ('ofloxacin',       'precaucion', 'J01MA01', 'OMS AWaRe 2023'),
  ('cefalexina',      'acceso',     'J01DB01', 'OMS AWaRe 2023'),
  ('dicloxacilina',   'acceso',     'J01CF01', 'OMS AWaRe 2023'),
  ('tetraciclina',    'acceso',     'J01AA07', 'OMS AWaRe 2023'),
  ('tinidazol',       'acceso',     'P01AB02', 'OMS AWaRe 2023'),
  ('secnidazol',      NULL,         'P01AB07', 'sin clasificar')
ON CONFLICT (molecula) DO NOTHING;

-- El listado: cada producto activo cuyo principio activo o nombre contiene una
-- molécula de la tabla. «ofloxacin» está contenido en «levofloxacin»: gana la
-- coincidencia más LARGA, si no la levofloxacina saldría como ofloxacina.
-- Devuelve json (patrón C de CLAUDE.md): no cae bajo el techo de 1000 filas.
CREATE OR REPLACE FUNCTION public.get_listado_antibioticos()
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.grupo NULLS LAST, t.molecula, t.producto), '[]'::json)
  FROM (
    SELECT DISTINCT ON (p.id)
           p.id            AS product_id,
           p.nombre        AS producto,
           p.principio_activo,
           a.molecula, a.grupo, a.atc, a.fuente,
           a.confirmado_at IS NOT NULL AS confirmado,
           coalesce(p.es_antibiotico, false) AS en_el_libro
      FROM public.products p
      JOIN public.antibioticos_aware a
        ON coalesce(p.pactivo_norm, '') LIKE '%' || a.molecula || '%'
        OR coalesce(p.nombre_norm, '')  LIKE '%' || a.molecula || '%'
     WHERE p.activo
     ORDER BY p.id, length(a.molecula) DESC
  ) t;
$$;
REVOKE EXECUTE ON FUNCTION public.get_listado_antibioticos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_listado_antibioticos() TO authenticated, service_role;
