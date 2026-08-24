SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Las tres funciones sin `search_path`, y por qué `identidad_vales` no tiene
-- policies
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Los dos últimos hallazgos deterministas de la auditoría del 2026-08-23. Van
-- juntos porque son de la misma clase: no cambian ningún comportamiento,
-- cierran lo que el advisor levanta, y dejan escrito algo que hoy sólo estaba
-- en la cabeza de quien lo hizo.
--
-- ── 1. `SET search_path` en las tres que faltaban ──────────────────────────
-- La regla 4 del hardening dice SIEMPRE. Estas tres quedaron afuera.
--
-- El riesgo real es BAJO y conviene decirlo para no exagerar el hallazgo: las
-- tres son `LANGUAGE sql`, `IMMUTABLE`, **INVOKER** (no SECURITY DEFINER) y
-- puras — sólo usan `coalesce`, `upper`, `btrim`, `length` y `regexp_replace`,
-- y no tocan ni una tabla. Un `search_path` secuestrado sobre una función
-- INVOKER no escala privilegios: quien la llama ya corre con los suyos. Y no
-- están en ningún CHECK ni en ningún índice, que es donde un cambio de
-- comportamiento sí corrompería datos guardados (se comprobó).
--
-- Se arreglan igual por dos motivos. El primero es que la regla no admite
-- excepciones tácitas: una que se cumple «casi siempre» deja de ser una regla y
-- pasa a ser una costumbre. El segundo es concreto — las llaman OCHO funciones,
-- entre ellas `fichas_para_corregir_dte` y `update_customer_fiscal`, que son las
-- que deciden qué ficha de cliente se corrige antes de transmitir a Hacienda.
-- Ahí un resultado distinto no se ve: cambia qué se corrige.
--
-- `IMMUTABLE` se conserva. Fijar el path no las hace menos inmutables; es lo que
-- garantiza que el mismo argumento dé siempre el mismo resultado, que es
-- exactamente lo que `IMMUTABLE` promete.
--
-- Probado en el branch `staging` (cbnjplmnfmfsambavjce): las tres quedan con
-- `search_path=public, extensions`, siguen IMMUTABLE e INVOKER, y doce casos de
-- comportamiento dan idéntico a antes.

CREATE OR REPLACE FUNCTION public.es_telefono_sv_valido(p_tel text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT length(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g')) IN (0, 8)
      OR regexp_replace(coalesce(p_tel, ''), '\D', '', 'g') ~ '^503\d{8}$';
$function$;

CREATE OR REPLACE FUNCTION public.es_cliente_mostrador(p_name text, p_erp_id text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT upper(btrim(coalesce(p_name, ''))) IN
           ('TODOS', 'CLIENTES VARIOS', 'CLIENTE FRECUENTE', 'CLIENTE FRECUENTE NUEVO')
      OR coalesce(p_erp_id, '') IN ('-1', '-2');
$function$;

CREATE OR REPLACE FUNCTION public.customer_ficha_estado(p_categoria text, p_nit text, p_dui text, p_nrc text, p_pasaporte text, p_phone text, p_direccion text, p_giro text)
 RETURNS text LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN coalesce(p_nit, '') = '' AND coalesce(p_dui, '') = ''
     AND coalesce(p_nrc, '') = '' AND coalesce(p_pasaporte, '') = ''
     AND coalesce(p_phone, '') = '' AND coalesce(p_direccion, '') = ''
     AND coalesce(p_giro, '') = '' AND coalesce(p_categoria, '') = ''
      THEN 'vacia'
    WHEN p_categoria IN ('Contribuyente', 'Gran Contribuyente', 'Contribuyente Exento')
      THEN CASE WHEN coalesce(p_nit, '') <> '' AND coalesce(p_nrc, '') <> ''
                 AND coalesce(p_giro, '') <> '' AND coalesce(p_direccion, '') <> ''
                 AND coalesce(p_phone, '') <> ''
                THEN 'completa' ELSE 'parcial' END
    WHEN p_categoria = 'Extranjero'
      THEN CASE WHEN coalesce(p_pasaporte, '') <> '' AND coalesce(p_direccion, '') <> ''
                THEN 'completa' ELSE 'parcial' END
    ELSE
      CASE WHEN (coalesce(p_dui, '') <> '' OR coalesce(p_nit, '') <> '')
                 AND coalesce(p_phone, '') <> '' AND coalesce(p_direccion, '') <> ''
           THEN 'completa' ELSE 'parcial' END
  END;
$function$;

-- ── 2. `identidad_vales`: por qué RLS encendido y CERO policies ────────────
--
-- El advisor lo marca como INFO y la auditoría lo levantó como sospechoso. NO es
-- un olvido: es defensa en profundidad, y estaba bien hecho.
--
-- `authenticated` NO tiene GRANT sobre esta tabla —sólo `postgres` y
-- `service_role`— así que el navegador no la alcanza por PostgREST. Todo el
-- acceso pasa por cinco funciones SECURITY DEFINER.
--
-- El RLS sin policies es la segunda cerradura: el día que alguien le dé un GRANT
-- sin pensarlo, la tabla sigue cerrada en vez de quedar abierta. Una policy
-- `FOR SELECT` acá sería lo PEOR de los dos mundos — abriría por PostgREST algo
-- que hoy no se puede leer.
--
-- Va dentro de un `DO` porque la tabla NO existe en el branch de pruebas: se
-- creó después del último rehecho. Una migración que sólo corre en un entorno no
-- es una migración — es un parche que va a fallar el día que el branch se
-- replique.
DO $$
BEGIN
  IF to_regclass('public.identidad_vales') IS NOT NULL THEN
    COMMENT ON TABLE public.identidad_vales IS
      'Vales de identidad: la prueba de que alguien se identificó (carné, usuario o PIN) para autorizar una operación. RLS ENCENDIDO Y SIN POLICIES A PROPÓSITO — `authenticated` no tiene GRANT, así que el navegador no la alcanza, y todo el acceso pasa por funciones SECURITY DEFINER (probar_identidad, probar_identidad_por_carne, probar_identidad_por_usuario, consumir_vale_de_identidad, registrar_salida_de_bolsa). El RLS es la segunda cerradura: si alguien le diera un GRANT sin pensarlo, la tabla sigue cerrada. NO agregarle una policy de SELECT: abriría por PostgREST algo que hoy no se puede leer.';
  END IF;
END $$;
