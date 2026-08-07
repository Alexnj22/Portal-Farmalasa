SET lock_timeout = '5s';

-- Bucket para la evidencia fotográfica de las solicitudes de ajuste de
-- inventario. Nace de un pedido concreto: en «Descargar por daño» hay que poder
-- ver el daño antes de aprobar la descarga — quien aprueba está en otra sala.
--
-- PRIVADO por defecto (regla 10 de CLAUDE.md), con tope de tamaño y lista de
-- tipos. Sólo imágenes: es una foto de un producto roto, no un expediente.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventario-evidencia', 'inventario-evidencia', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
   set public = excluded.public,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- Lectura: cualquier autenticado. Quien aprueba la solicitud puede estar en
-- Supervisión, en jefatura o en otra sala, y el archivo sólo se alcanza con una
-- URL firmada que emite el portal.
drop policy if exists inventario_evidencia_select on storage.objects;
create policy inventario_evidencia_select on storage.objects
  for select to authenticated
  using (bucket_id = 'inventario-evidencia');

-- Escritura: sólo quien puede crear la solicitud a la que la foto acompaña.
-- `WITH CHECK (true)` está prohibido por la regla 3 y es justo el agujero que la
-- auditoría del 2026-07-30 encontró en `attendance` y `audit_logs`: sin esto,
-- cualquier autenticado podría llenar el bucket.
drop policy if exists inventario_evidencia_insert on storage.objects;
create policy inventario_evidencia_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inventario-evidencia'
    and (select public.auth_can_edit_any(array['dash_inv_movement']))
  );

-- Sin policy de UPDATE ni DELETE: la evidencia de una solicitud es append-only,
-- igual que el historial. Si hubiera que purgarla, va por service_role.
