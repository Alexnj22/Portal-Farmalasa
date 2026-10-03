SET lock_timeout = '5s';

-- Plan de alcance F3b (2026-10-02). La lectura del bucket `payment-proofs` era
-- `bucket_id = 'payment-proofs'` a secas: cualquier empleado con sesión listaba
-- y descargaba los 2,035 comprobantes de bolsas, cortes y abonos de TODAS las
-- salas, con la API de archivos y sin pasar por ninguna función.
--
-- Medido antes de cambiarla: simulada sobre los archivos reales para una
-- persona de cada cargo, el personal de caja ve el 100% de su sala y lo que
-- subió, y 0 de las otras; administración ve todo; los cargos sin módulos de
-- caja, nada. De las 2,065 referencias a estas fotos guardadas en bolsas,
-- movimientos de caja, abonos y pagos, ninguna apunta a la carpeta de otra
-- sala: nadie pierde una foto que hoy ve con razón.
--
-- Las dos ayudas no dependen del archivo y van en `(SELECT …)`: se calculan una
-- vez por consulta. Evaluada por fila, la primera versión agotó el tiempo.
ALTER POLICY payment_proofs_authenticated_select ON storage.objects
  USING (
    bucket_id = 'payment-proofs'
    AND (
      owner = (SELECT auth.uid())
      OR (SELECT public.comprobantes_de_caja_red())
      OR (split_part(name, '/', 1) IN ('bolsas', 'cortes', 'abonos-credito')
          AND split_part(name, '/', 2) = (SELECT public.comprobantes_de_caja_sala()))
      OR (split_part(name, '/', 1) = 'invoices'
          AND ((SELECT public.auth_has_module_permission('facturacion', 'can_view'))
               OR (SELECT public.auth_has_module_permission('requests_facturacion', 'can_view'))))
    )
  );
