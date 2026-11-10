-- ─────────────────────────────────────────────────────────────────────────────
-- Base del sitio de la boda. Se corre UNA vez en un proyecto de Supabase NUEVO
-- (SQL Editor → pegar → Run). Es idempotente: se puede volver a correr.
--
-- Modelo de acceso:
--   · anon (invitados): NO lee tablas de invitados. Todo lo que hace pasa por
--     funciones que exigen su código de invitación o la clave del álbum.
--   · admin: usuario autenticado cuyo correo está en `admins`.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ── Tablas ───────────────────────────────────────────────────────────────────
create table if not exists admins (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists ajustes (
  clave text primary key,
  valor text not null,
  created_at timestamptz not null default now()
);

create table if not exists mesas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  capacidad int not null default 10 check (capacidad between 1 and 40),
  forma text not null default 'redonda' check (forma in ('redonda','rectangular')),
  x real not null default 50,  -- posición en el plano, 0–100 (%)
  y real not null default 50,
  created_at timestamptz not null default now()
);

create table if not exists grupos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,                 -- «Familia Pérez», «Ana y Luis»
  pases int not null default 1 check (pases between 1 and 30),
  lado text not null default 'ambos' check (lado in ('novio','novia','ambos')),
  telefono text,
  etiqueta text,                        -- «Trabajo», «Universidad»…
  notas text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','confirmado','parcial','declinado')),
  mensaje text,
  cancion text,
  respondido_at timestamptz,
  std_enviado_at timestamptz,           -- save the date enviado
  invitacion_enviada_at timestamptz,
  abierta_at timestamptz,               -- primera vez que abrieron su enlace
  created_at timestamptz not null default now()
);

create table if not exists personas (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references grupos(id) on delete cascade,
  nombre text not null,
  es_nino boolean not null default false,
  asistira boolean,                     -- null = no ha respondido
  restriccion text,                     -- alergias, vegetariano…
  mesa_id uuid references mesas(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists personas_grupo_idx on personas(grupo_id);
create index if not exists personas_mesa_idx on personas(mesa_id);

create table if not exists fotos (
  id uuid primary key default gen_random_uuid(),
  ruta text not null unique,            -- ruta dentro del bucket «album»
  autor text,
  momento text,
  ancho int,
  alto int,
  oculta boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists fotos_fecha_idx on fotos(created_at desc);

create table if not exists mensajes (
  id uuid primary key default gen_random_uuid(),
  autor text not null,
  texto text not null,
  oculto boolean not null default false,
  created_at timestamptz not null default now()
);

-- Clave del álbum (va en el QR de las mesas). Cambiarla desde el panel.
insert into ajustes (clave, valor) values ('clave_album', upper(substr(md5(random()::text), 1, 6)))
on conflict (clave) do nothing;

-- ── Admin ────────────────────────────────────────────────────────────────────
create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where email = (auth.jwt() ->> 'email'));
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table admins   enable row level security;
alter table ajustes  enable row level security;
alter table mesas    enable row level security;
alter table grupos   enable row level security;
alter table personas enable row level security;
alter table fotos    enable row level security;
alter table mensajes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ajustes','mesas','grupos','personas','fotos','mensajes'] loop
    execute format('drop policy if exists %I on %I', t || '_admin', t);
    execute format(
      'create policy %I on %I for all to authenticated using ((select es_admin())) with check ((select es_admin()))',
      t || '_admin', t);
  end loop;
end $$;

drop policy if exists admins_self on admins;
create policy admins_self on admins for select to authenticated using ((select es_admin()));

-- Lectura pública de lo que se muestra a todos
drop policy if exists fotos_publicas on fotos;
create policy fotos_publicas on fotos for select to anon, authenticated using (not oculta);
drop policy if exists mensajes_publicos on mensajes;
create policy mensajes_publicos on mensajes for select to anon, authenticated using (not oculto);

-- ── Funciones para invitados ────────────────────────────────────────────────
create or replace function invitacion(p_codigo text) returns json
language plpgsql security definer set search_path = public as $$
declare g grupos; r json;
begin
  select * into g from grupos where codigo = upper(trim(p_codigo));
  if not found then return null; end if;
  update grupos set abierta_at = coalesce(abierta_at, now()) where id = g.id;
  select json_build_object(
    'grupo', json_build_object('codigo', g.codigo, 'nombre', g.nombre, 'pases', g.pases,
                               'estado', g.estado, 'mensaje', g.mensaje, 'cancion', g.cancion,
                               'respondido_at', g.respondido_at),
    'personas', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'nombre', p.nombre, 'es_nino', p.es_nino, 'asistira', p.asistira,
        'restriccion', p.restriccion, 'mesa', m.nombre) order by p.created_at)
      from personas p left join mesas m on m.id = p.mesa_id where p.grupo_id = g.id), '[]'::json)
  ) into r;
  return r;
end $$;

-- p_personas: [{ id?, nombre, asistira, restriccion }]
create or replace function responder_invitacion(
  p_codigo text, p_personas json, p_mensaje text default null, p_cancion text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare g grupos; x json; n_si int; n_total int;
begin
  select * into g from grupos where codigo = upper(trim(p_codigo)) for update;
  if not found then raise exception 'Invitación no encontrada'; end if;
  if json_array_length(p_personas) > g.pases then
    raise exception 'La invitación tiene % pases', g.pases;
  end if;

  for x in select * from json_array_elements(p_personas) loop
    if nullif(x->>'id', '') is not null then
      update personas set
        nombre = coalesce(nullif(left(trim(x->>'nombre'), 80), ''), nombre),
        asistira = (x->>'asistira')::boolean,
        restriccion = nullif(left(trim(x->>'restriccion'), 200), '')
      where id = (x->>'id')::uuid and grupo_id = g.id;
    elsif nullif(trim(x->>'nombre'), '') is not null then
      insert into personas (grupo_id, nombre, asistira, restriccion)
      values (g.id, left(trim(x->>'nombre'), 80), (x->>'asistira')::boolean,
              nullif(left(trim(x->>'restriccion'), 200), ''));
    end if;
  end loop;

  select count(*) filter (where asistira), count(*) into n_si, n_total
  from personas where grupo_id = g.id;

  update grupos set
    estado = case when n_si = 0 then 'declinado' when n_si < n_total then 'parcial' else 'confirmado' end,
    mensaje = nullif(left(trim(p_mensaje), 1000), ''),
    cancion = nullif(left(trim(p_cancion), 200), ''),
    respondido_at = now()
  where id = g.id;

  return invitacion(p_codigo);
end $$;

create or replace function verificar_clave_album(p_clave text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ajustes where clave = 'clave_album' and valor = upper(trim(p_clave)));
$$;

create or replace function registrar_foto(
  p_clave text, p_ruta text, p_autor text, p_momento text, p_ancho int, p_alto int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not verificar_clave_album(p_clave) then raise exception 'Clave del álbum incorrecta'; end if;
  if p_ruta !~ '^fotos/[A-Za-z0-9/_.-]+$' then raise exception 'Ruta inválida'; end if;
  insert into fotos (ruta, autor, momento, ancho, alto)
  values (p_ruta, nullif(left(trim(p_autor), 60), ''), nullif(left(trim(p_momento), 30), ''), p_ancho, p_alto)
  returning id into v;
  return v;
end $$;

create or replace function firmar_libro(p_autor text, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_autor, ''))) < 2 or length(trim(coalesce(p_texto, ''))) < 2 then
    raise exception 'Escribe tu nombre y tu mensaje';
  end if;
  insert into mensajes (autor, texto) values (left(trim(p_autor), 60), left(trim(p_texto), 600));
end $$;

revoke execute on function invitacion(text), responder_invitacion(text, json, text, text),
  verificar_clave_album(text), registrar_foto(text, text, text, text, int, int),
  firmar_libro(text, text), es_admin() from public;
grant execute on function invitacion(text), responder_invitacion(text, json, text, text),
  verificar_clave_album(text), registrar_foto(text, text, text, text, int, int),
  firmar_libro(text, text) to anon, authenticated;
grant execute on function es_admin() to authenticated;

-- ── Storage: bucket del álbum ───────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('album', 'album', true, 26214400,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists album_subir on storage.objects;
create policy album_subir on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'album' and name like 'fotos/%');

drop policy if exists album_admin_borrar on storage.objects;
create policy album_admin_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'album' and (select es_admin()));

-- ── Tiempo real (álbum en vivo) ─────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table fotos;
exception when duplicate_object then null; end $$;

-- ── ÚLTIMO PASO (a mano): registrar a los administradores ──────────────────
-- 1. Authentication → Users → «Add user» con su correo y contraseña.
-- 2. insert into admins (email) values ('correo-del-novio@ejemplo.com');
-- 3. Authentication → Sign In / Providers → desactivar «Allow new users to sign up».
