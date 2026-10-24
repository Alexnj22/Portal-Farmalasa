SET lock_timeout = '5s';
DROP POLICY IF EXISTS dispensacion_clases_select ON public.dispensacion_clases;
DROP POLICY IF EXISTS dispensacion_clases_write  ON public.dispensacion_clases;
CREATE POLICY dispensacion_clases_select ON public.dispensacion_clases FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('bitacoras'::text, 'can_view'::text))
    OR (SELECT public.auth_has_module_permission('bitacoras_configurar'::text, 'can_view'::text))
    OR (SELECT public.auth_can_edit_any(ARRAY['bitacoras_configurar'::text])));
CREATE POLICY dispensacion_clases_insert ON public.dispensacion_clases FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['bitacoras_configurar'::text])));
CREATE POLICY dispensacion_clases_update ON public.dispensacion_clases FOR UPDATE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['bitacoras_configurar'::text])))
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['bitacoras_configurar'::text])));
CREATE POLICY dispensacion_clases_delete ON public.dispensacion_clases FOR DELETE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['bitacoras_configurar'::text])));

DROP POLICY IF EXISTS dist_listas_select   ON public.dist_listas;
DROP POLICY IF EXISTS dist_listas_escribir ON public.dist_listas;
CREATE POLICY dist_listas_select ON public.dist_listas FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('distribucion'::text, 'can_view'::text))
    OR (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'::text])));
CREATE POLICY dist_listas_insert ON public.dist_listas FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'::text])));
CREATE POLICY dist_listas_update ON public.dist_listas FOR UPDATE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'::text])))
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'::text])));
CREATE POLICY dist_listas_delete ON public.dist_listas FOR DELETE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'::text])));

DROP POLICY IF EXISTS dist_precios_select   ON public.dist_precios;
DROP POLICY IF EXISTS dist_precios_escribir ON public.dist_precios;
CREATE POLICY dist_precios_select ON public.dist_precios FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('distribucion'::text, 'can_view'::text))
    OR (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'::text])));
CREATE POLICY dist_precios_insert ON public.dist_precios FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'::text])));
CREATE POLICY dist_precios_update ON public.dist_precios FOR UPDATE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'::text])))
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'::text])));
CREATE POLICY dist_precios_delete ON public.dist_precios FOR DELETE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'::text])));

DROP POLICY IF EXISTS faltas_disciplinarias_select ON public.faltas_disciplinarias;
DROP POLICY IF EXISTS faltas_disciplinarias_write  ON public.faltas_disciplinarias;
CREATE POLICY faltas_disciplinarias_select ON public.faltas_disciplinarias FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('staff_detail'::text, 'can_view'::text))
    OR (SELECT public.auth_can_edit_any(ARRAY['staff_detail'::text])));
CREATE POLICY faltas_disciplinarias_insert ON public.faltas_disciplinarias FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['staff_detail'::text])));
CREATE POLICY faltas_disciplinarias_update ON public.faltas_disciplinarias FOR UPDATE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['staff_detail'::text])))
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['staff_detail'::text])));
CREATE POLICY faltas_disciplinarias_delete ON public.faltas_disciplinarias FOR DELETE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['staff_detail'::text])));

DROP POLICY IF EXISTS marketing_archivos_select  ON public.marketing_archivos;
DROP POLICY IF EXISTS marketing_archivos_galeria ON public.marketing_archivos;
CREATE POLICY marketing_archivos_select ON public.marketing_archivos FOR SELECT TO authenticated
  USING (
    (
      (   (NOT borrador)
       OR (subido_por = (SELECT public.auth_employee_id()))
       OR (pieza_id IN (SELECT p.id FROM public.marketing_piezas p
                         WHERE p.created_by = (SELECT public.auth_employee_id()))))
      AND (
           (SELECT public.auth_has_module_permission('marketing'::text, 'can_edit'::text))
        OR (    (SELECT public.auth_has_module_permission('marketing'::text, 'can_view'::text))
            AND EXISTS (SELECT 1
                          FROM public.marketing_piezas p
                          JOIN public.marketing_meses m ON m.id = p.mes_id
                         WHERE p.id = marketing_archivos.pieza_id
                           AND (m.publicado_at IS NOT NULL OR p.enviada_at IS NOT NULL))))
    )
    OR
    (
          (NOT reemplazado)
      AND (NOT borrador)
      AND (SELECT public.auth_has_module_permission('galeria'::text, 'can_view'::text))
      AND EXISTS (SELECT 1 FROM public.marketing_piezas p
                   WHERE p.id = marketing_archivos.pieza_id
                     AND p.liberada
                     AND p.estado = ANY (ARRAY['aprobado'::text, 'programado'::text, 'publicado'::text]))
    )
  );

DROP POLICY IF EXISTS marketing_marcas_select  ON public.marketing_marcas;
DROP POLICY IF EXISTS marketing_marcas_galeria ON public.marketing_marcas;
CREATE POLICY marketing_marcas_select ON public.marketing_marcas FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('marketing'::text, 'can_view'::text))
    OR (SELECT public.auth_has_module_permission('galeria'::text, 'can_view'::text)));

DROP POLICY IF EXISTS marketing_piezas_select  ON public.marketing_piezas;
DROP POLICY IF EXISTS marketing_piezas_galeria ON public.marketing_piezas;
CREATE POLICY marketing_piezas_select ON public.marketing_piezas FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('marketing'::text, 'can_view'::text))
    OR (    liberada
        AND estado = ANY (ARRAY['aprobado'::text, 'programado'::text, 'publicado'::text])
        AND (SELECT public.auth_has_module_permission('galeria'::text, 'can_view'::text))));

DROP POLICY IF EXISTS marketing_comentarios_update        ON public.marketing_comentarios;
DROP POLICY IF EXISTS marketing_comentarios_update_propio ON public.marketing_comentarios;
CREATE POLICY marketing_comentarios_update ON public.marketing_comentarios FOR UPDATE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['marketing'::text]))
    OR (SELECT public.auth_has_module_permission('marketing'::text, 'can_approve'::text))
    OR (autor_id = (SELECT public.auth_employee_id()) AND tipo = 'comentario'::text))
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['marketing'::text]))
    OR (SELECT public.auth_has_module_permission('marketing'::text, 'can_approve'::text))
    OR (autor_id = (SELECT public.auth_employee_id()) AND tipo = 'comentario'::text));
