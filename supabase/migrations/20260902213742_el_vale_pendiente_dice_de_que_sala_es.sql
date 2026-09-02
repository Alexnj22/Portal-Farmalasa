SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El vale pendiente dice DE QUÉ SALA es.
--
-- Reportado por el usuario (2-sep) sobre el aviso de Bolsas:
--
--     «Faltan anotarle a la caja 2 salidas por $127.00»
--     — «¿qué es eso? ¿de qué sucursal? no entiendo»
--
-- Eran dos salidas de **Salud 3** de hoy (OTR-1062 $125.00 y GAS-1063 $2.00,
-- las dos de la bolsa S3-1230). El aviso no lo decía, la lista de «Ver cuáles»
-- tampoco —sólo folio y monto— y la simulación mostraba «Sala 5», que es el
-- número interno de la fila: un identificador, no un nombre.
--
-- El aviso vive fuera del filtro de sucursal A PROPÓSITO —es trabajo pendiente
-- y esconderlo detrás de un recorte sería no anunciarlo— así que la sala no se
-- puede deducir de la pantalla. Un aviso que no dice dónde no se puede
-- atender: es exactamente el motivo por el que se preguntó.
--
-- Por qué el nombre viaja con la FILA y no se cruza en el navegador: el mismo
-- dato lo necesita `anotar-vales-caja` para decir qué escribió, y dos lugares
-- resolviéndolo por su cuenta es como se llega a dos pantallas nombrando
-- distinto a la misma sala. Sale de `branches`, que es la tabla — no de una
-- lista escrita a mano.
--
-- `DROP` + `CREATE` y no `CREATE OR REPLACE`: cambia el tipo de retorno.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.caja_vales_pendientes();

CREATE FUNCTION public.caja_vales_pendientes()
 RETURNS TABLE(branch_id integer, sala text, dia_abierto date, movimiento_id bigint,
               operacion_id bigint, folio text, monto numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sistema boolean;
  v_todo    boolean;
  v_sala    bigint;
BEGIN
  v_sistema := coalesce(
      current_setting('request.jwt.claims', true)::json ->> 'role', ''
  ) = 'service_role';

  IF NOT v_sistema AND NOT (SELECT auth_has_module_permission('caja_vales','can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = 'Sin permiso para ver los vales de caja pendientes.';
  END IF;

  v_todo := v_sistema OR (SELECT auth_module_scope('caja_vales')) = 'ALL';
  v_sala := (SELECT auth_employee_branch_id());

  RETURN QUERY
  SELECT b.branch_id::integer,
         br.name,
         a.abierta_el,
         m.id,
         o.id,
         o.folio,
         (-m.monto)::numeric
  FROM public.bolsas_movimientos m
  JOIN public.bolsas b             ON b.id = m.bolsa_id
  JOIN public.bolsas_operaciones o ON o.id = m.operacion_id
  -- `JOIN` y no `LEFT JOIN`: `bolsas.branch_id` tiene FK a `branches`, así que
  -- una bolsa sin sala no existe. Un `LEFT` acá sólo serviría para dejar pasar
  -- un nombre nulo hasta la pantalla, que es el defecto que esto viene a
  -- cerrar.
  JOIN public.branches br          ON br.id = b.branch_id
  JOIN LATERAL (
      SELECT ap.abierta_el
      FROM public.cortes_caja_aperturas ap
      WHERE ap.branch_id = b.branch_id AND ap.cerrada_at IS NULL
      ORDER BY ap.abierta_el DESC
      LIMIT 1
  ) a ON true
  WHERE m.anulado_at IS NULL
    AND o.anulada_at IS NULL
    AND m.caja_vale_id IS NULL
    AND m.monto < 0
    AND b.fecha = a.abierta_el
    AND (v_todo OR b.branch_id = v_sala);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.caja_vales_pendientes() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.caja_vales_pendientes() TO authenticated, service_role;
