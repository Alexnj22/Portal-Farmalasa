SET lock_timeout = '5s';

-- La primera version exigia que los dos primeros digitos fueran un
-- departamento (01-14). Es falso, y el ensayo BEGIN...ROLLBACK lo mostro: el
-- ERP tiene NIT que empiezan en 93/94 y son reales. Uno de ellos,
-- MARIA ANNA GERTRUD ISAAC DE CARRILLO (WEGERIC) = 93091607671010, aparece con
-- ese mismo numero en el libro de compras que el ERP le declara a Hacienda —
-- verificado en la comparacion ficha-contra-libro (52 de 52 coincidencias).
-- Con la regla vieja quedaban afuera 5 proveedores legitimos, uno de ellos
-- (DAE KI KIM / ODISEA) con compras reales. O sea que la validacion no habria
-- filtrado basura: habria perdido datos en silencio.
--
-- El discriminador de verdad es la FECHA que el NIT lleva adentro. El formato es
-- MMMM-DDMMAA-NNN-V, y lo que delata a la basura es el mes:
--
--   4353-24 53 24-5325  PROVEEDOR PRUEBA -> mes 53
--   9309-16 07 67-101-0 WEGERIC          -> 16/07/67, valido
--   0614-10 07 84-001-0 DROG. COMERCIAL  -> 10/07/84, valido
--
-- (Reemplazada por 20260802204432, que agrega el DUI como NIT.)
CREATE OR REPLACE FUNCTION public.nit_sv_valido(p_nit text)
 RETURNS boolean
 LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_nit ~ '^[0-9]{14}$'
     AND substring(p_nit, 5, 2)::int BETWEEN 1 AND 31   -- dia
     AND substring(p_nit, 7, 2)::int BETWEEN 1 AND 12;  -- mes
$function$;
