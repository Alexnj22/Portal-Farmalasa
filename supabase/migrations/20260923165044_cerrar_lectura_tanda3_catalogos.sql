-- Cerrar la lectura — tanda 3 (Fase 2, catálogos) de docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md.
--
-- Regla 6 aprobada por el usuario el 2026-09-23: los catálogos que son de un
-- módulo se leen con ese módulo; los que toda pantalla necesita (productos,
-- sucursales, cargos, presentaciones, laboratorios, feriados…) no se tocan.
--
-- Cada uno se trazó a su lector (`src/data/*` → pantalla → permiso). Cuando la
-- tabla tiene escritura por módulo, el de escritura entra en la lectura: un
-- DELETE o un UPDATE necesita ver la fila, y cerrarle la lectura a quien puede
-- escribir le rompe el botón sin error (`product_active_principles` la escriben
-- productos y compras; `lab_locations`, laboratorios y productos).
--
-- Tres sin ningún lector desde el navegador quedan cerradas: `mv_refresh_state`
-- e `inventory_sync_huella` (sólo procesos internos) y `puntos_config` (su única
-- función INVOKER, `puntos_fuente`, no tiene quien la llame).
--
-- Quedan fuera, a propósito: `education_catalog_entries` (lo abre el formulario
-- de empleado desde varios lugares) y `suppliers`/`proveedores` (otras policies
-- los leen; cerrarlos cambia lo que ven esas tablas).

SET lock_timeout = '5s';

DROP POLICY "mv_refresh_state_select" ON public.mv_refresh_state;
DROP POLICY "inventory_sync_huella_select" ON public.inventory_sync_huella;
DROP POLICY "leer_config" ON public.puntos_config;

DROP POLICY "surveys_read" ON public.surveys;
CREATE POLICY surveys_select ON public.surveys
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuesta', 'can_view'))
        OR (SELECT public.auth_has_module_permission('encuesta_admin', 'can_view')));
DROP POLICY "survey_bloques_read" ON public.survey_bloques;
CREATE POLICY survey_bloques_select ON public.survey_bloques
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuesta', 'can_view'))
        OR (SELECT public.auth_has_module_permission('encuesta_admin', 'can_view')));
DROP POLICY "survey_preguntas_read" ON public.survey_preguntas;
CREATE POLICY survey_preguntas_select ON public.survey_preguntas
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('encuesta', 'can_view'))
        OR (SELECT public.auth_has_module_permission('encuesta_admin', 'can_view')));
DROP POLICY "pap_select" ON public.product_active_principles;
CREATE POLICY product_active_principles_select ON public.product_active_principles
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('productos', 'can_view'))
        OR (SELECT public.auth_has_module_permission('compras', 'can_view')));
DROP POLICY "product_locations_select" ON public.product_locations;
CREATE POLICY product_locations_select ON public.product_locations
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('productos', 'can_view')));
DROP POLICY "lab_locations_select" ON public.lab_locations;
CREATE POLICY lab_locations_select ON public.lab_locations
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('laboratorios', 'can_view'))
        OR (SELECT public.auth_has_module_permission('productos', 'can_view')));
DROP POLICY "product_categories_select" ON public.product_categories;
CREATE POLICY product_categories_select ON public.product_categories
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('inventario', 'can_view'))
        OR (SELECT public.auth_has_module_permission('productos', 'can_view')));
DROP POLICY "diferencia_opcion_select" ON public.diferencia_opcion;
CREATE POLICY diferencia_opcion_select ON public.diferencia_opcion
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('pedidos', 'can_view')));
DROP POLICY "faltas_disciplinarias_select" ON public.faltas_disciplinarias;
CREATE POLICY faltas_disciplinarias_select ON public.faltas_disciplinarias
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('staff_detail', 'can_view')));
DROP POLICY "dispensacion_clases_select" ON public.dispensacion_clases;
CREATE POLICY dispensacion_clases_select ON public.dispensacion_clases
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('bitacoras', 'can_view'))
        OR (SELECT public.auth_has_module_permission('bitacoras_configurar', 'can_view')));
