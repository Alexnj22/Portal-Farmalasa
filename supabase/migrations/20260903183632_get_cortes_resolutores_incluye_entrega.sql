SET lock_timeout = '5s';

-- Las personas que un corte NOMBRA, no sólo quien lo confirmó.
--
-- La función se escribió cuando un corte tenía un solo rol de persona
-- (`resuelto_por`), y su guarda `EXISTS` quedó escrita sobre esa columna. Desde
-- v2.964.0 hay dos más —`employee_id`, quien apretó «Hacer corte» en el portal,
-- y `recibido_por`, quien recibió la caja al confirmarlo— y con la guarda vieja
-- **una persona que sólo recibió cajas devuelve CERO filas**: sin nombre y sin
-- foto, que es indistinguible de «no tiene retrato».
--
-- El permiso de módulo sigue siendo la puerta; esto sólo amplía el conjunto de
-- fichas que un corte puede nombrar a los tres roles que la fila tiene.
CREATE OR REPLACE FUNCTION public.get_cortes_resolutores(p_ids uuid[])
 RETURNS TABLE(id uuid, name text, photo_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.id, e.name, e.photo_url
  FROM public.employees e
  WHERE (SELECT public.auth_has_module_permission('cortes_caja', 'can_view'))
    AND e.id = ANY(p_ids)
    AND EXISTS (
      SELECT 1 FROM public.cortes_caja c
      WHERE c.resuelto_por = e.id
         OR c.recibido_por = e.id
         OR c.employee_id  = e.id
    );
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_resolutores(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cortes_resolutores(uuid[]) TO authenticated, service_role;
