SET lock_timeout = '5s';

-- Faltaba el segundo formato. Desde 2018 una persona natural usa su DUI de 9
-- digitos como NIT, y el portal ya tiene dos asi, los dos traidos por DTE
-- firmados: OMAR ARNULFO SERRANO CRESPIN (018398946) y BRAULIO ERASMO MENA
-- RIVERA (009440859). La version anterior los daba por invalidos.
--
-- No es un detalle de borde: E3 del plan es justamente el anexo de retencion de
-- Renta del Art. 156, que aplica a personas naturales por servicios. Un
-- validador que rechaza el NIT de una persona natural es exactamente el que no
-- sirve para ese anexo.
--
-- Se aceptan los dos formatos y nada mas:
--   · 14 digitos con fecha DDMMAA en las posiciones 5-10 (el clasico)
--   · 9 digitos (DUI haciendo de NIT)
--
-- Sigue sin validar digito verificador ni existencia del contribuyente. Es un
-- filtro de FORMA, para que un `43532453245325` (mes 53) o un `111` no entren a
-- un libro de IVA como si fueran identificadores.
CREATE OR REPLACE FUNCTION public.nit_sv_valido(p_nit text)
 RETURNS boolean
 LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    -- DUI haciendo de NIT (persona natural, desde 2018)
    p_nit ~ '^[0-9]{9}$'
    OR (
      -- Clasico MMMM-DDMMAA-NNN-V
      p_nit ~ '^[0-9]{14}$'
      AND substring(p_nit, 5, 2)::int BETWEEN 1 AND 31
      AND substring(p_nit, 7, 2)::int BETWEEN 1 AND 12
    );
$function$;

COMMENT ON FUNCTION public.nit_sv_valido(text) IS
  'Filtro de FORMA de un NIT salvadoreno: 14 digitos con fecha DDMMAA en 5-10, o 9 digitos (DUI como NIT de persona natural, desde 2018). No valida digito verificador ni existencia del contribuyente. Nacio en E4 (barrido del maestro del ERP) para descartar basura evidente sin perder datos reales: la primera version exigia departamento 01-14 y descartaba 5 proveedores legitimos con NIT 9x, y la segunda descartaba a las personas naturales. Las dos las delato el ensayo BEGIN...ROLLBACK, no la lectura.';
