-- De qué terminal POS salió una boleta, y por qué el freno lo mira (2026-11-03).
--
-- Cada sala tiene su terminal Promerica y cada una numera sus boletas por su
-- lado. Cuando la de una sala no funciona, la operación se hace en la de otra:
-- el papel sale con la terminal ajena y el efectivo queda en la sala que
-- atendió (legítimo, confirmado por el usuario). Así llegó a Salud 1 la 001074
-- de la terminal de Salud 2, y el 3-nov la 001074 PROPIA quedó frenada.
--
-- · `caja_terminales_pos`: qué terminal es de qué sala. Es un catálogo: sale
--   de la tabla, no de una lista escrita en una función.
-- · `caja_huella_de_terminal`: la lectura de la foto confunde 0↔8 y 1↔4 (un
--   mismo papel de Salud 2 se leyó 60316001 y 60346001). Las dos partes se
--   comparan por su huella, con esos dígitos ya igualados. Las seis huellas
--   son distintas entre sí.
-- · `caja_sala_de_terminal(lectura)`: la sala dueña de la terminal impresa,
--   o NULL si no se reconoce o si el papel nombra a más de una. Medido sobre
--   las 3,360 boletas POS: 3,165 su sala, 3 otra (las tres del 26-oct en
--   Salud 1, de Salud 2), 1 ambigua, 191 sin terminal legible o sin foto.
-- · `pos_de_otra_sala(movimiento)`: campo calculado para las listas («POS de
--   Salud 2»). Se calcula al leer y no se guarda en una columna: rellenar 3,360
--   filas dispararía la bitácora de dinero 3,360 veces.
-- · El juez: terminales DISTINTAS → otra operación. Misma terminal o alguna
--   desconocida → número y monto, como hasta ahora. NO se dio por duplicado
--   «misma terminal y mismo número» con montos distintos: en Salud 4 la
--   boleta «5» son dos operaciones reales de la misma terminal ($19.59 CAESS
--   y $100 MoneyGram) con el número mal leído.
SET lock_timeout = '5s';

CREATE TABLE public.caja_terminales_pos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  terminal text NOT NULL UNIQUE CHECK (terminal ~ '^\d{8}$'),
  branch_id bigint NOT NULL REFERENCES public.branches(id),
  entidad text NOT NULL DEFAULT 'PROMERICA',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX caja_terminales_pos_branch_id_idx ON public.caja_terminales_pos (branch_id);
ALTER TABLE public.caja_terminales_pos ENABLE ROW LEVEL SECURITY;
CREATE POLICY caja_terminales_pos_select ON public.caja_terminales_pos
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.caja_terminales_pos FROM anon;

-- Medidas en los papeles ya anotados (la terminal más repetida de cada sala).
INSERT INTO public.caja_terminales_pos (terminal, branch_id)
SELECT v.terminal, v.branch_id FROM (VALUES
  ('60344001', 4), ('60346001', 25), ('60347001', 27),
  ('60348001', 28), ('69876001', 29), ('60352001', 2)) v(terminal, branch_id)
WHERE EXISTS (SELECT 1 FROM public.branches b WHERE b.id = v.branch_id)
ON CONFLICT (terminal) DO NOTHING;

CREATE OR REPLACE FUNCTION public.caja_huella_de_terminal(p text)
 RETURNS text LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$ SELECT translate(p, '81', '04'); $function$;

CREATE OR REPLACE FUNCTION public.caja_sala_de_terminal(p_lectura jsonb)
 RETURNS bigint LANGUAGE sql STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN count(DISTINCT t.branch_id) = 1 THEN min(t.branch_id) END
    FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(p_lectura -> 'leido' -> 'numeros_del_papel') = 'array'
                THEN p_lectura -> 'leido' -> 'numeros_del_papel' ELSE '[]'::jsonb END) n
    JOIN public.caja_terminales_pos t
      ON public.caja_huella_de_terminal(t.terminal) = public.caja_huella_de_terminal(n)
   WHERE n ~ '^\d{8}$';
$function$;

CREATE OR REPLACE FUNCTION public.pos_de_otra_sala(m public.caja_movimientos_portal)
 RETURNS text LANGUAGE sql STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT b.name FROM public.branches b
   WHERE m.tipo_codigo LIKE 'POS_PROMERICA%'
     AND b.id = public.caja_sala_de_terminal(m.foto_lectura)
     AND b.id IS DISTINCT FROM m.branch_id;
$function$;

-- El juez, ahora con la terminal de cada lado.
CREATE OR REPLACE FUNCTION public.caja_misma_operacion_de_boleta(
  a_tipo_codigo text, a_forma_pago text, a_monto numeric,
  b_tipo_codigo text, b_forma_pago text, b_monto numeric,
  a_terminal bigint, b_terminal bigint)
 RETURNS boolean LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
           WHEN public.caja_familia_de_boleta(a_tipo_codigo, a_forma_pago) LIKE 'VOUCHER:%'
             OR public.caja_familia_de_boleta(b_tipo_codigo, b_forma_pago) LIKE 'VOUCHER:%' THEN false
           WHEN public.caja_familia_de_boleta(a_tipo_codigo, a_forma_pago)
                <> public.caja_familia_de_boleta(b_tipo_codigo, b_forma_pago) THEN false
           WHEN public.caja_familia_de_boleta(a_tipo_codigo, a_forma_pago) = 'POS_PROMERICA'
             AND a_terminal IS NOT NULL AND b_terminal IS NOT NULL
             AND a_terminal <> b_terminal THEN false
           ELSE a_monto IS NULL OR b_monto IS NULL OR round(a_monto, 2) = round(b_monto, 2)
         END;
$function$;

DROP FUNCTION public.boleta_ya_en_caja(bigint, text, text, text, numeric);

CREATE FUNCTION public.boleta_ya_en_caja(
  p_branch_id bigint, p_numero_boleta text,
  p_tipo_codigo text DEFAULT NULL, p_forma_pago text DEFAULT NULL, p_monto numeric DEFAULT NULL,
  p_lectura jsonb DEFAULT NULL)
 RETURNS json LANGUAGE sql STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT m.id, m.tipo, m.tipo_codigo, m.forma_pago, m.monto, m.concepto, m.numero_boleta,
           m.fecha, m.registrado_at,
           (SELECT b.name FROM public.branches b
             WHERE b.id = public.caja_sala_de_terminal(m.foto_lectura)) AS pos_de_sala,
           CASE WHEN p_tipo_codigo IS NULL AND p_forma_pago IS NULL THEN NULL
                ELSE public.caja_misma_operacion_de_boleta(
                       m.tipo_codigo, m.forma_pago, m.monto, p_tipo_codigo, p_forma_pago, p_monto,
                       public.caja_sala_de_terminal(m.foto_lectura),
                       public.caja_sala_de_terminal(p_lectura))
           END AS misma_operacion
    FROM public.caja_movimientos_portal m
    WHERE m.branch_id = p_branch_id
      AND m.anulado_at IS NULL
      AND m.numero_boleta IS NOT NULL
      AND ltrim(regexp_replace(p_numero_boleta, '\D', '', 'g'), '0') <> ''
      AND ltrim(regexp_replace(m.numero_boleta, '\D', '', 'g'), '0')
        = ltrim(regexp_replace(p_numero_boleta, '\D', '', 'g'), '0')
    ORDER BY m.registrado_at DESC
    LIMIT 5
  ) t;
$function$;

-- Para el aviso del diálogo: de qué sala es la terminal del papel recién leído.
CREATE OR REPLACE FUNCTION public.caja_pos_de_la_lectura(p_lectura jsonb)
 RETURNS json LANGUAGE sql STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT json_build_object('branch_id', b.id, 'sala', b.name)
    FROM public.branches b WHERE b.id = public.caja_sala_de_terminal(p_lectura);
$function$;

DROP FUNCTION public.caja_misma_operacion_de_boleta(text, text, numeric, text, text, numeric);

REVOKE EXECUTE ON FUNCTION public.caja_huella_de_terminal(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.caja_sala_de_terminal(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pos_de_otra_sala(public.caja_movimientos_portal) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.caja_misma_operacion_de_boleta(text, text, numeric, text, text, numeric, bigint, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.boleta_ya_en_caja(bigint, text, text, text, numeric, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.caja_pos_de_la_lectura(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caja_huella_de_terminal(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.caja_sala_de_terminal(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_de_otra_sala(public.caja_movimientos_portal) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.caja_misma_operacion_de_boleta(text, text, numeric, text, text, numeric, bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.boleta_ya_en_caja(bigint, text, text, text, numeric, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.caja_pos_de_la_lectura(jsonb) TO authenticated, service_role;
