-- El lote y el vencimiento se corrigen también en el recuento.
--
-- Bodega, reconteo (2026-11-27): «¿por qué en el reconteo no se puede
-- modificar lote / vence? … debe haber una 3 salida, ajustar ahí mismo».
-- El recuento sólo existe con el conteo FINALIZADO, y `agregar_item_conteo` y
-- `editar_lote_conteo_item` sólo aceptaban BORRADOR/EN_PROGRESO. Quien recuenta
-- es justo quien tiene la caja en la mano y ve el lote mal anotado.
--
-- Con el conteo FINALIZADO las dos aceptan, pero con el MISMO permiso que
-- `recontar_conteo_item` (aprobar el conteo o `conteo_inventario_recontar`).
-- Las cantidades de esos lotes las guarda `recontar_conteo_item`, que ya deja
-- autor y hora en la bitácora del renglón. Abierto, todo sigue igual.
--
-- Se reescriben desde su definición VIVA, reemplazando sólo la guarda; si el
-- texto no aparece, la migración se cae en vez de quedar a medias.

SET lock_timeout = '5s';

DO $mig$
DECLARE
  v_fn text;
  v_def text;
  v_new text;
  v_guarda_permiso constant text :=
       E'  -- Con el conteo finalizado, sólo desde el recuento (2026-11-27): el\n'
    || E'  -- mismo permiso que `recontar_conteo_item`.\n'
    || E'  IF v_conteo.status = ''FINALIZADO'' THEN\n'
    || E'    IF NOT (public.auth_has_module_permission(''conteo_inventario'', ''can_approve'')\n'
    || E'            OR public.auth_has_module_permission(''conteo_inventario_recontar'', ''can_view'')) THEN\n'
    || E'      RAISE EXCEPTION ''SIN_PERMISO_RECUENTO'';\n'
    || E'    END IF;\n'
    || E'  ELSIF NOT public.auth_has_module_permission(''conteo_inventario'', ''can_edit'') THEN\n'
    || E'    RAISE EXCEPTION ''SIN_PERMISO'';\n'
    || E'  END IF;';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.agregar_item_conteo(uuid,integer,text,text,date,boolean)',
    'public.editar_lote_conteo_item(uuid,text,date)'
  ] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);

    v_new := replace(v_def,
      E'v_conteo.status NOT IN (''BORRADOR'',''EN_PROGRESO'') THEN',
      E'v_conteo.status NOT IN (''BORRADOR'',''EN_PROGRESO'',''FINALIZADO'') THEN');
    IF v_new = v_def THEN RAISE EXCEPTION '%: no se encontró la guarda de estado', v_fn; END IF;
    v_def := v_new;

    v_new := replace(v_def,
      E'  IF NOT public.auth_has_module_permission(''conteo_inventario'', ''can_edit'') THEN\n    RAISE EXCEPTION ''SIN_PERMISO'';\n  END IF;',
      v_guarda_permiso);
    IF v_new = v_def THEN RAISE EXCEPTION '%: no se encontró la guarda de permiso', v_fn; END IF;

    EXECUTE v_new;
  END LOOP;
END
$mig$;
