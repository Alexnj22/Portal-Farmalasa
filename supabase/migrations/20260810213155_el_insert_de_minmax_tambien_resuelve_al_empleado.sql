SET lock_timeout = '5s';

-- El que se me escapó en `20260810211349` (2026-08-10).
--
-- El barrido con el que armé aquella lista mostraba los primeros 90 caracteres
-- de cada policy, y en `mmcr_insert` el `auth.uid()` viene DESPUÉS del chequeo
-- de permiso — o sea, justo fuera de la ventana. Arreglé su `SELECT` y dejé su
-- `INSERT` con el mismo defecto: las 22 personas que entran por una cuenta
-- ligada no podían crear una propuesta de Min/Max.
--
-- Que un recorte de 90 caracteres decida qué se arregla es la lección: la
-- consulta del barrido tiene que traer la expresión ENTERA.
DROP POLICY IF EXISTS mmcr_insert ON public.minmax_change_requests;
CREATE POLICY mmcr_insert ON public.minmax_change_requests
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth_has_module_permission('dash_minmax_req', 'can_view'))
    AND requested_by_id = (SELECT auth_employee_id())
  );
