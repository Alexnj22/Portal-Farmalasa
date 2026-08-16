SET lock_timeout = '5s';

-- El código de carné tiene TRES papeles a la vez, y ese es el problema de
-- fondo que esta auditoría destapó:
--   1. la credencial del carné (lo que se escanea),
--   2. la contraseña del portal (`login()` entra con él),
--   3. **el código de vendedor del ERP** — está en 349,207 facturas, y 39 de
--      los 47 empleados activos calzan con uno.
--
-- El (3) es la razón por la que el (1) y el (2) no pueden sostenerse: un valor
-- impreso en cada venta no es un secreto por más que se esconda la columna.
--
-- Mientras eso se resuelve de raíz (darle al carné un secreto propio, que es
-- otra decisión), Ventas necesita seguir diciendo quién vendió. Esta función es
-- ese mapa, con una puerta explícita —quien puede ver Ventas— en vez del acceso
-- universal que tenía la columna.
CREATE OR REPLACE FUNCTION public.get_vendedores()
 RETURNS TABLE(code text, id uuid, name text, first_names text, last_names text,
               photo_url text, branch_id bigint)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT e.code, e.id, e.name, e.first_names, e.last_names, e.photo_url, e.branch_id
      FROM public.employees e
     WHERE btrim(coalesce(e.code,'')) <> ''
       AND ((SELECT auth_has_module_permission('ventas','can_view'))
            OR (SELECT auth_has_module_permission('dash_anulaciones','can_view')));
$function$;

REVOKE EXECUTE ON FUNCTION public.get_vendedores() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_vendedores() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_vendedores() IS
 'Mapa codigo de vendedor -> persona, para las pantallas de ventas. Existe porque employees.code dejo de ser legible con la sesion: es la credencial del carne. Puerta: ventas.can_view o dash_anulaciones.can_view.';
