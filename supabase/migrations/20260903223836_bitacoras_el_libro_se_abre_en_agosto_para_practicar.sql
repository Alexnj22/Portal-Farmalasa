SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El libro se abre el 1 de AGOSTO, para practicar antes del arranque real.
--
-- Pedido del usuario (2026-09-03): «llenalo de agosto y septiembre como
-- prueba». La sala necesita renglones de verdad para aprender a completarlos —
-- buscar al médico en el registro del Consejo, sacarle la foto a la receta,
-- ver cómo se ve un folio— y con el libro vacío no hay nada que practicar.
--
-- ⚠️ ESTO ES DATO DE PRÁCTICA, NO EL LIBRO.
--
-- Antes del 1 de octubre hay que vaciarlo y volver a poner la fecha, o el libro
-- real estrena con dos meses de renglones a medio completar y con el folio
-- 00400 en su primera hoja. Los tres pasos, en este orden:
--
--   DELETE FROM public.bitacora_dispensaciones;
--   DELETE FROM public.receta_items;  DELETE FROM public.recetas;
--   UPDATE public.bitacora_folios SET ultimo = 0
--    WHERE serie IN ('disp','disp_rx','receta');
--   UPDATE public.branches SET libro_receta_desde = DATE '2026-10-01'
--    WHERE type = 'FARMACIA';
--
-- Está escrito acá y no en la cabeza de nadie porque es justo el paso que se
-- olvida: nada falla si no se hace, y el defecto sólo se ve el día de la
-- inspección.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.branches
   SET libro_receta_desde = DATE '2026-08-01'
 WHERE type = 'FARMACIA';

-- El backfill de los dos meses. Los folios salen en orden de sucursal, fecha y
-- hora, así que el libro nace cronológico y sin costuras.
SELECT public.sincronizar_bitacora_dispensaciones(DATE '2026-08-01', public.bitacora_hoy_sv(), NULL);
