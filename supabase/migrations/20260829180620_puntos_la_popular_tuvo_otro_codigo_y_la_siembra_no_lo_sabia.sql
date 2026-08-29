SET lock_timeout = '5s';

-- ── 32,837 ventas que decían «Sin enviar» y sí habían ganado sus puntos ──────
-- Lo levantó el usuario preguntando por qué había tantas sin enviar. Medido:
-- 33,419 sin motivo aparente, **32,837 de ellas de La Popular**, y todas se
-- cortan en marzo de 2026. La causa: **La Popular tuvo otro código**. En la base
-- de puntos hay 41,078 filas bajo `FLP` (su id más alto es 240,699, ahí paró) y
-- desde entonces usa `FLP1`.
--
-- La siembra unía `branches.codigo_puntos = 'FLP1'`, así que no encontró ni una
-- de las viejas y las dio por no enviadas. Verificado sobre 300 de ellas: las
-- 300 están allá, bajo `FLP`.
--
-- El código viejo va en la TABLA y no como constante en una función: es un dato
-- de la sala, y escondido en el código nadie lo encuentra el día que aparezca
-- otro. Es la regla de CLAUDE.md sobre catálogos que se escriben a mano.
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS codigo_puntos_previo text;

COMMENT ON COLUMN public.branches.codigo_puntos_previo IS
  'Código anterior de la sala en la base de puntos. Sólo La Popular tuvo uno (FLP, hasta el documento 240699). Sirve para leer su historia; lo nuevo se escribe siempre con codigo_puntos.';

UPDATE public.branches SET codigo_puntos_previo = 'FLP'
WHERE codigo_puntos = 'FLP1' AND codigo_puntos_previo IS DISTINCT FROM 'FLP';

-- ── La siembra acepta los dos códigos, y GUARDA el que corresponde ───────────
-- `sucursal` pasa a ser el código bajo el que esa venta vive REALMENTE del otro
-- lado, no el vigente de la sala. No es un detalle: todo lo que viene después
-- —buscar el ticket para revertirlo, borrarlo del registro— usa esa columna
-- como clave. Si dijera `FLP1` sobre una fila que allá está como `FLP`, la
-- reversión de una venta vieja de La Popular no encontraría nada y se leería
-- como «no estaba», que es exactamente la confusión que este arreglo corrige.
CREATE OR REPLACE FUNCTION public.puntos_sembrar_desde_destino(p_filas json)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
  n integer;
BEGIN
  WITH entrada AS (
    SELECT (x->>'sucursal')::text     AS sucursal,
           (x->>'id')::text           AS erp_invoice_id,
           (x->>'aplicado')::smallint AS aplicado
    FROM json_array_elements(p_filas) x
  ),
  resuelto AS (
    SELECT si.id AS invoice_id, e.sucursal, si.erp_invoice_id,
           si.correlativo, si.cliente,
           CASE WHEN si.cod_vendedor ~ '^[0-9]{1,9}$' THEN si.cod_vendedor::int END AS cod_vendedor,
           si.total, si.fecha, e.aplicado
    FROM entrada e
    JOIN public.branches b
      ON e.sucursal IN (b.codigo_puntos, b.codigo_puntos_previo)
    JOIN public.sales_invoices si
      ON si.branch_id = b.id AND si.erp_invoice_id = e.erp_invoice_id
  ),
  ins AS (
    INSERT INTO public.puntos_enviados
      (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor,
       total, fecha, aplicado, visto_at)
    SELECT invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor,
           total, fecha, aplicado, now()
    FROM resuelto
    ON CONFLICT (invoice_id) DO UPDATE
       SET aplicado = EXCLUDED.aplicado,
           sucursal = EXCLUDED.sucursal,
           visto_at = now()
       WHERE public.puntos_enviados.aplicado IS DISTINCT FROM EXCLUDED.aplicado
          OR public.puntos_enviados.sucursal IS DISTINCT FROM EXCLUDED.sucursal
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_sembrar_desde_destino(json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_sembrar_desde_destino(json) TO service_role;
