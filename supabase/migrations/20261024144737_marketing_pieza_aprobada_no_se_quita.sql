-- Quitar una pieza aprobada o programada dejaba sus diseños sueltos en el
-- bucket: la fila se borraba (la policy sólo excluía 'publicado') pero
-- `marketing_storage_delete` (H31) protege los archivos de una pieza aprobada,
-- programada o publicada. Las dos reglas decían cosas distintas. Se alinea la
-- de la pieza con la de sus archivos: un diseño aprobado no se quita.
SET lock_timeout = '5s';
ALTER POLICY marketing_piezas_delete ON public.marketing_piezas
  USING (
    (SELECT public.auth_has_module_permission('marketing', 'can_edit'))
    AND estado NOT IN ('aprobado', 'programado', 'publicado')
    AND (created_by = (SELECT public.auth_employee_id()) OR (SELECT public.auth_is_su()))
  );
