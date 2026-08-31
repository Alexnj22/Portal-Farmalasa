-- Quién decide una corrección de caja: la familia `requests_caja`.
--
-- `CAJA_MOVIMIENTO_CHANGE` existía como tipo de solicitud desde el 29-ago, pero
-- `modulo_de_aprobacion()` no lo conocía, así que caía en el `ELSE NULL` — o
-- sea, en el módulo del ámbito (`requests` a secas). Consecuencia: la corrección
-- de un movimiento de CAJA la podía decidir cualquiera que decidiera solicitudes
-- de sala, y no había forma de delegar esa parte sin entregar el resto. Es
-- justamente lo que las familias vinieron a resolver (v2.576.0).
--
-- Esta función es el espejo en SQL de `MODULO_QUE_DECIDE` en
-- `src/constants/solicitudModulos.js`, y **las dos se mueven juntas**: la base
-- es la que manda —la policy rechaza igual— y el frontend sólo evita ofrecer un
-- botón condenado a rebotar. Si dejan de coincidir, el síntoma es mudo: un botón
-- que falla sin explicar, o uno que falta cuando sí se podía.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.modulo_de_aprobacion(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN p_type = ANY (ARRAY['ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                             'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST'])
      THEN 'requests_facturacion'
    WHEN p_type = ANY (ARRAY['INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST'])
      THEN 'requests_inventario'
    WHEN p_type = 'CAJA_MOVIMIENTO_CHANGE'
      THEN 'requests_caja'
    ELSE NULL
  END;
$function$;

-- Quién arranca pudiendo decidirlas: los cargos que HOY pueden operar la caja
-- desde el portal. Mientras el módulo esté abierto sólo para supervisión, ése
-- es el único cargo, y así la solicitud nace con alguien que la pueda resolver
-- en vez de quedarse esperando a que alguien se acuerde de dar el permiso.
--
-- No se le da a nadie más: repartir un permiso «por si acaso» es cómo un
-- control termina encendido en un cargo que nunca lo pidió.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'requests_caja', true, false, true, rp.scope
  FROM public.role_permissions rp
 WHERE rp.module_key = 'caja_vales' AND rp.can_edit
ON CONFLICT (role_id, module_key) DO UPDATE
   SET can_approve = true, can_view = true;
