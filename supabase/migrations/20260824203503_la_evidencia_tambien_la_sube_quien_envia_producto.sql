-- El bucket de evidencia sólo lo podía escribir quien mueve inventario, y el
-- envío por avería lo escribe quien hace traslados.
--
-- `inventario_evidencia_insert` nació el 2026-08-07 para «Descargar por daño»,
-- así que pide `dash_inv_movement`. La foto de un envío por «Avería» la toma
-- quien manda producto a Bodega, y ese permiso es `traslados`.
--
-- Medido contra producción antes de escribir esto: de los 11 cargos que pueden
-- enviar producto, SEIS no pueden escribir en el bucket —Auxiliar de Bodega,
-- Dependiente de Farmacia, Gerente General, Jefe/a de Sala, Regente de
-- Enfermería y Subjefe/a de Sala—, y son **42 de las 47 personas activas**. O
-- sea que sin esto la foto habría fallado justo para quien la toma: la sala.
--
-- Y el modo de falla habría sido de los caros. La subida va ANTES de crear el
-- envío —a propósito, para que una foto que no sube no deje una fila que nadie
-- puede decidir—, así que el error de RLS aparece con la caja ya armada y
-- diciendo «no se pudo subir la foto», sin ninguna pista de que lo que falta es
-- un permiso.
--
-- Se agrega `traslados` a la lista en vez de abrir la policy: `auth_can_edit_any`
-- acepta varios módulos justamente para esto, y quien no edita ninguno de los
-- dos sigue sin poder escribir. `WITH CHECK (true)` está prohibido por la regla
-- 3 y es el agujero que la auditoría del 2026-07-30 encontró en `attendance` y
-- `audit_logs`.
SET lock_timeout = '5s';

drop policy if exists inventario_evidencia_insert on storage.objects;
create policy inventario_evidencia_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inventario-evidencia'
    and (select public.auth_can_edit_any(array['dash_inv_movement','traslados']))
  );
