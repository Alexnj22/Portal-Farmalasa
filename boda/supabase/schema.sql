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

-- Permisos de subida al álbum. El invitado pide uno con la clave del álbum y
-- recibe una ruta generada acá; el almacenamiento sólo acepta archivos en una
-- ruta con permiso vigente. Sin esto, la clave se revisaba DESPUÉS de subir y
-- cualquiera con la clave pública del sitio podía llenar el espacio.
create table if not exists subidas (
  ruta text primary key,                -- archivo principal
  miniatura text not null unique,       -- versión chica (jpg)
  usada boolean not null default false, -- ya se registró la foto
  created_at timestamptz not null default now()
);
create index if not exists subidas_fecha_idx on subidas(created_at);

-- Columnas agregadas después de la primera versión (el script se puede volver a correr).
alter table fotos  add column if not exists miniatura text;
alter table grupos add column if not exists llegada_at timestamptz;  -- registrada en la entrada
-- Acompañante que escribió el propio invitado al confirmar: es el único que
-- el invitado puede renombrar o quitar. A los que cargaron los novios sólo
-- puede marcarlos como «no asiste».
alter table personas add column if not exists agregado_por_invitado boolean not null default false;

-- Clave del álbum (va en el QR de las mesas). Cambiarla desde el panel.
insert into ajustes (clave, valor) values ('clave_album', upper(substr(md5(random()::text), 1, 6)))
on conflict (clave) do nothing;
-- Fecha límite y zona horaria: las copia el panel desde src/config.js cada vez
-- que se abre (el archivo es la única fuente; esto es lo que la base hace cumplir).
insert into ajustes (clave, valor) values
  ('confirmar_antes_de', '2099-12-31'),
  ('zona_horaria', 'America/El_Salvador'),
  ('moderar_mensajes', 'no')
on conflict (clave) do nothing;

create or replace function ajuste(p_clave text) returns text
language sql stable security definer set search_path = public as $$
  select valor from ajustes where clave = p_clave;
$$;

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
alter table subidas  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ajustes','mesas','grupos','personas','fotos','mensajes','subidas'] loop
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
-- ¿Ya pasó la fecha límite para confirmar? Se juzga con la hora del LUGAR de la
-- boda, no con la del teléfono del invitado.
create or replace function plazo_vencido() returns boolean
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce(ajuste('zona_horaria'), 'America/El_Salvador'))::date
         > coalesce(ajuste('confirmar_antes_de'), '2099-12-31')::date;
$$;

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
    'limite', ajuste('confirmar_antes_de'),
    'personas', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'nombre', p.nombre, 'es_nino', p.es_nino, 'asistira', p.asistira,
        'restriccion', p.restriccion, 'mesa', m.nombre, 'agregado', p.agregado_por_invitado) order by p.created_at)
      from personas p left join mesas m on m.id = p.mesa_id where p.grupo_id = g.id), '[]'::json)
  ) into r;
  return r;
end $$;

-- p_personas: [{ id?, nombre, asistira, restriccion, quitar? }]
--   · con id: actualiza a esa persona (el nombre sólo si la agregó el invitado);
--   · con id y quitar=true: borra a un acompañante que agregó el invitado;
--   · sin id y con nombre: agrega un acompañante (cuenta contra los pases).
create or replace function responder_invitacion(
  p_codigo text, p_personas json, p_mensaje text default null, p_cancion text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare g grupos; x json; n_si int; n_total int; n_nuevas int;
begin
  select * into g from grupos where codigo = upper(trim(p_codigo)) for update;
  if not found then raise exception 'Invitación no encontrada'; end if;
  if plazo_vencido() then
    raise exception 'El plazo para confirmar ya terminó. Escríbenos directamente.';
  end if;
  if json_typeof(p_personas) <> 'array' or json_array_length(p_personas) > 60 then
    raise exception 'Respuesta inválida';
  end if;

  -- Primero se quitan los acompañantes que el invitado retiró: liberan su pase.
  delete from personas
  where grupo_id = g.id and agregado_por_invitado
    and id in (select (e->>'id')::uuid from json_array_elements(p_personas) e
               where nullif(e->>'id', '') is not null and coalesce((e->>'quitar')::boolean, false));

  -- Los pases se cuentan contra lo GUARDADO más lo nuevo: contar sólo lo que
  -- llega en cada envío dejaba sumar acompañantes de a uno, sin límite.
  select count(*) into n_nuevas from json_array_elements(p_personas) e
  where nullif(e->>'id', '') is null and nullif(trim(e->>'nombre'), '') is not null;
  select count(*) into n_total from personas where grupo_id = g.id;
  if n_total + n_nuevas > g.pases then
    raise exception 'La invitación tiene % pases', g.pases;
  end if;

  for x in select * from json_array_elements(p_personas) loop
    if coalesce((x->>'quitar')::boolean, false) then
      continue;
    elsif nullif(x->>'id', '') is not null then
      update personas set
        nombre = case when agregado_por_invitado
                      then coalesce(nullif(left(trim(x->>'nombre'), 80), ''), nombre) else nombre end,
        asistira = (x->>'asistira')::boolean,
        restriccion = nullif(left(trim(x->>'restriccion'), 200), '')
      where id = (x->>'id')::uuid and grupo_id = g.id;
    elsif nullif(trim(x->>'nombre'), '') is not null then
      insert into personas (grupo_id, nombre, asistira, restriccion, agregado_por_invitado)
      values (g.id, left(trim(x->>'nombre'), 80), (x->>'asistira')::boolean,
              nullif(left(trim(x->>'restriccion'), 200), ''), true);
    end if;
  end loop;

  select count(*) filter (where asistira), count(*) into n_si, n_total
  from personas where grupo_id = g.id;
  if n_total = 0 then raise exception 'Indica quién asistirá'; end if;

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

-- Paso 1 de una subida: con la clave del álbum, la base inventa la ruta.
create or replace function autorizar_subida(p_clave text, p_ext text) returns json
language plpgsql security definer set search_path = public as $$
declare v_ext text := lower(trim(p_ext)); v_base text; v_ruta text; v_mini text;
begin
  if not verificar_clave_album(p_clave) then raise exception 'Clave del álbum incorrecta'; end if;
  if v_ext not in ('jpg','jpeg','png','webp','heic','heif','mp4','mov') then
    raise exception 'Ese tipo de archivo no se puede subir';
  end if;
  -- Freno contra abuso: muy por encima de lo que sube un salón lleno.
  if (select count(*) from subidas where created_at > now() - interval '10 minutes') >= 1500 then
    raise exception 'Hay demasiadas fotos subiéndose en este momento. Intenta en unos minutos.';
  end if;
  delete from subidas where created_at < now() - interval '1 day';
  v_base := 'fotos/' || to_char(now() at time zone coalesce(ajuste('zona_horaria'), 'UTC'), 'YYYY-MM-DD')
            || '/' || gen_random_uuid();
  v_ruta := v_base || '.' || v_ext;
  v_mini := v_base || '_m.jpg';
  insert into subidas (ruta, miniatura) values (v_ruta, v_mini);
  return json_build_object('ruta', v_ruta, 'miniatura', v_mini);
end $$;

-- La consulta la policy del almacenamiento: ¿hay permiso vigente para este nombre?
create or replace function subida_autorizada(p_nombre text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from subidas
    where not usada and created_at > now() - interval '30 minutes'
      and (ruta = p_nombre or miniatura = p_nombre));
$$;

-- Paso 3: el archivo ya está; se registra la foto y el permiso se gasta.
drop function if exists registrar_foto(text, text, text, text, int, int);
create or replace function registrar_foto(
  p_ruta text, p_autor text, p_momento text, p_ancho int, p_alto int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare s subidas; v uuid;
begin
  select * into s from subidas where ruta = p_ruta and not usada for update;
  if not found then raise exception 'El permiso de subida venció. Intenta de nuevo.'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'album' and name = s.ruta) then
    raise exception 'El archivo no llegó completo. Intenta de nuevo.';
  end if;
  update subidas set usada = true where ruta = s.ruta;
  insert into fotos (ruta, miniatura, autor, momento, ancho, alto)
  values (s.ruta,
          case when exists (select 1 from storage.objects where bucket_id = 'album' and name = s.miniatura)
               then s.miniatura end,
          nullif(left(trim(p_autor), 60), ''), nullif(left(trim(p_momento), 30), ''), p_ancho, p_alto)
  returning id into v;
  return v;
end $$;

revoke execute on function invitacion(text), responder_invitacion(text, json, text, text),
  verificar_clave_album(text), autorizar_subida(text, text), subida_autorizada(text),
  registrar_foto(text, text, text, int, int), es_admin(),
  ajuste(text), plazo_vencido() from public, anon, authenticated;
grant execute on function invitacion(text), responder_invitacion(text, json, text, text),
  verificar_clave_album(text), autorizar_subida(text, text), subida_autorizada(text),
  registrar_foto(text, text, text, int, int) to anon, authenticated;
grant execute on function es_admin() to authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- Segunda ronda: modo «letra grande», el día en vivo, canciones, mensajes de
-- voz y el juego del salón.
-- ═════════════════════════════════════════════════════════════════════════════

-- Invitación que se abre sola en modo fácil (abuelos): letra grande, sin
-- animaciones, confirmación de a una pregunta. La marcan los novios.
alter table grupos add column if not exists letra_grande boolean not null default false;

-- invitacion() con la marca de letra grande (misma firma que arriba).
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
                               'respondido_at', g.respondido_at, 'letra_grande', g.letra_grande),
    'limite', ajuste('confirmar_antes_de'),
    'personas', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'nombre', p.nombre, 'es_nino', p.es_nino, 'asistira', p.asistira,
        'restriccion', p.restriccion, 'mesa', m.nombre, 'agregado', p.agregado_por_invitado) order by p.created_at)
      from personas p left join mesas m on m.id = p.mesa_id where p.grupo_id = g.id), '[]'::json)
  ) into r;
  return r;
end $$;

-- ── El día en vivo: avisos de los novios ────────────────────────────────────
create table if not exists avisos (
  id uuid primary key default gen_random_uuid(),
  texto text not null check (length(texto) between 1 and 280),
  created_at timestamptz not null default now()
);
create index if not exists avisos_fecha_idx on avisos(created_at desc);
alter table avisos enable row level security;
drop policy if exists avisos_admin on avisos;
create policy avisos_admin on avisos for all to authenticated using ((select es_admin())) with check ((select es_admin()));
drop policy if exists avisos_publicos on avisos;
create policy avisos_publicos on avisos for select to anon, authenticated using (created_at > now() - interval '2 days');

-- «¿Dónde me siento?»: con la clave del álbum (va en el letrero de la entrada),
-- busca por nombre entre los que confirmaron y ya tienen mesa.
create or replace function sin_tildes(t text) returns text
language sql immutable set search_path = public as $$
  select translate(lower(coalesce(t, '')), 'áéíóúüñàèìòù', 'aeiouunaeiou');
$$;
create or replace function buscar_mesa(p_clave text, p_nombre text) returns json
language plpgsql stable security definer set search_path = public as $$
declare q text := sin_tildes(trim(p_nombre));
begin
  if not verificar_clave_album(p_clave) then raise exception 'Clave incorrecta'; end if;
  if length(q) < 3 then return '[]'::json; end if;
  return coalesce((
    select json_agg(json_build_object('nombre', p.nombre, 'mesa', m.nombre) order by p.nombre)
    from (select * from personas p
          where p.asistira and p.mesa_id is not null and sin_tildes(p.nombre) like '%' || q || '%'
          order by p.nombre limit 8) p
    join mesas m on m.id = p.mesa_id), '[]'::json);
end $$;

-- ── Canciones: los invitados piden y votan ───────────────────────────────────
create table if not exists canciones (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(titulo) between 1 and 120),
  artista text,
  pedido_por text,
  votos int not null default 0,
  tocada boolean not null default false,
  oculta boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists canciones_unica on canciones (sin_tildes(titulo), sin_tildes(coalesce(artista, '')));
create table if not exists canciones_votos (
  cancion_id uuid not null references canciones(id) on delete cascade,
  votante uuid not null,               -- id anónimo que guarda el teléfono
  created_at timestamptz not null default now(),
  primary key (cancion_id, votante)
);
alter table canciones enable row level security;
alter table canciones_votos enable row level security;
drop policy if exists canciones_admin on canciones;
create policy canciones_admin on canciones for all to authenticated using ((select es_admin())) with check ((select es_admin()));
drop policy if exists canciones_votos_admin on canciones_votos;
create policy canciones_votos_admin on canciones_votos for all to authenticated using ((select es_admin())) with check ((select es_admin()));
drop policy if exists canciones_publicas on canciones;
create policy canciones_publicas on canciones for select to anon, authenticated using (not oculta);

-- Pedir: si ya la pidió alguien, cuenta como voto.
create or replace function pedir_cancion(p_titulo text, p_artista text, p_nombre text, p_votante uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if length(trim(coalesce(p_titulo, ''))) < 1 then raise exception 'Escribe el nombre de la canción'; end if;
  if (select count(*) from canciones where created_at > now() - interval '10 minutes') >= 300 then
    raise exception 'Llegaron muchas canciones seguidas. Intenta en unos minutos.';
  end if;
  select id into v from canciones
  where sin_tildes(titulo) = sin_tildes(trim(p_titulo)) and sin_tildes(coalesce(artista, '')) = sin_tildes(coalesce(trim(p_artista), ''));
  if v is null then
    insert into canciones (titulo, artista, pedido_por)
    values (left(trim(p_titulo), 120), nullif(left(trim(p_artista), 80), ''), nullif(left(trim(p_nombre), 60), ''))
    returning id into v;
  end if;
  insert into canciones_votos (cancion_id, votante) values (v, p_votante) on conflict do nothing;
  update canciones set votos = (select count(*) from canciones_votos where cancion_id = v) where id = v;
  return v;
end $$;

-- Votar o quitar el voto. Devuelve si quedó votada.
create or replace function votar_cancion(p_id uuid, p_votante uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare votada boolean;
begin
  if exists (select 1 from canciones_votos where cancion_id = p_id and votante = p_votante) then
    delete from canciones_votos where cancion_id = p_id and votante = p_votante; votada := false;
  else
    if (select count(*) from canciones_votos where votante = p_votante) >= 50 then
      raise exception 'Ya votaste por muchas canciones';
    end if;
    insert into canciones_votos (cancion_id, votante) values (p_id, p_votante); votada := true;
  end if;
  update canciones set votos = (select count(*) from canciones_votos where cancion_id = p_id) where id = p_id;
  return votada;
end $$;

-- Qué canciones votó este teléfono (para pintar los corazones).
create or replace function mis_votos(p_votante uuid) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(cancion_id), '[]'::json) from canciones_votos where votante = p_votante;
$$;

-- ── Mensajes de voz en el libro de firmas ───────────────────────────────────
alter table mensajes add column if not exists audio text;   -- ruta en el bucket «album» (voces/…)

create or replace function autorizar_voz(p_ext text) returns json
language plpgsql security definer set search_path = public as $$
declare v_ext text := lower(trim(p_ext)); v_ruta text;
begin
  if v_ext not in ('webm','m4a','mp4','ogg','mp3') then raise exception 'Formato de audio no permitido'; end if;
  if (select count(*) from subidas where ruta like 'voces/%' and created_at > now() - interval '10 minutes') >= 200 then
    raise exception 'Llegaron muchos mensajes seguidos. Intenta en unos minutos.';
  end if;
  v_ruta := 'voces/' || gen_random_uuid() || '.' || v_ext;
  insert into subidas (ruta, miniatura) values (v_ruta, v_ruta || '.sin-miniatura');
  return json_build_object('ruta', v_ruta);
end $$;

drop function if exists firmar_libro(text, text);
create or replace function firmar_libro(p_autor text, p_texto text, p_audio text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_moderar boolean := coalesce(ajuste('moderar_mensajes'), 'no') = 'si'; v_audio text;
begin
  if length(trim(coalesce(p_autor, ''))) < 2 then raise exception 'Escribe tu nombre'; end if;
  if p_audio is null and length(trim(coalesce(p_texto, ''))) < 2 then raise exception 'Escribe tu mensaje o graba uno de voz'; end if;
  if (select count(*) from mensajes where created_at > now() - interval '10 minutes') >= 100 then
    raise exception 'Llegaron muchos mensajes seguidos. Intenta en unos minutos.';
  end if;
  if p_audio is not null then
    update subidas set usada = true
    where ruta = p_audio and ruta like 'voces/%' and not usada and created_at > now() - interval '30 minutes'
    returning ruta into v_audio;
    if v_audio is null or not exists (select 1 from storage.objects where bucket_id = 'album' and name = v_audio) then
      raise exception 'El audio no llegó completo. Intenta de nuevo.';
    end if;
  end if;
  insert into mensajes (autor, texto, oculto, audio)
  values (left(trim(p_autor), 60), coalesce(left(trim(p_texto), 600), ''), v_moderar, v_audio);
  return not v_moderar;
end $$;

-- ── El juego del salón («¿Cuánto conoces a los novios?») ────────────────────
-- Las preguntas viven en src/config.js; la base guarda la pregunta en curso,
-- su fase y las respuestas correctas (las copia el panel, como la fecha límite).
insert into ajustes (clave, valor) values ('juego_pregunta', '-1'), ('juego_fase', 'cerrado'), ('juego_correctas', '')
on conflict (clave) do nothing;

create table if not exists juego_respuestas (
  pregunta int not null,
  jugador uuid not null,
  nombre text not null,
  opcion int not null check (opcion between 0 and 5),
  created_at timestamptz not null default now(),
  primary key (pregunta, jugador)
);
alter table juego_respuestas enable row level security;
drop policy if exists juego_admin on juego_respuestas;
create policy juego_admin on juego_respuestas for all to authenticated using ((select es_admin())) with check ((select es_admin()));

create or replace function estado_juego() returns json
language plpgsql stable security definer set search_path = public as $$
declare v_p int := coalesce(ajuste('juego_pregunta'), '-1')::int;
        v_f text := coalesce(ajuste('juego_fase'), 'cerrado');
        v_c int[] := coalesce(string_to_array(nullif(ajuste('juego_correctas'), ''), ',')::int[], '{}');
begin
  return json_build_object(
    'pregunta', v_p, 'fase', v_f,
    'conteo', coalesce((select json_object_agg(opcion, n) from (
      select opcion, count(*) n from juego_respuestas where pregunta = v_p group by opcion) c), '{}'::json),
    'total', (select count(*) from juego_respuestas where pregunta = v_p),
    'ranking', coalesce((select json_agg(r) from (
      select nombre, count(*) filter (where opcion = v_c[pregunta + 1]
               and (pregunta < v_p or (pregunta = v_p and v_f in ('revelada', 'final')))) puntos
      from juego_respuestas group by jugador, nombre order by puntos desc, min(created_at) limit 10) r), '[]'::json));
end $$;

create or replace function responder_juego(p_jugador uuid, p_nombre text, p_opcion int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_p int := coalesce(ajuste('juego_pregunta'), '-1')::int;
begin
  if coalesce(ajuste('juego_fase'), 'cerrado') <> 'abierta' or v_p < 0 then
    raise exception 'Esta pregunta ya cerró';
  end if;
  if length(trim(coalesce(p_nombre, ''))) < 1 then raise exception 'Escribe tu nombre'; end if;
  insert into juego_respuestas (pregunta, jugador, nombre, opcion)
  values (v_p, p_jugador, left(trim(p_nombre), 40), p_opcion)
  on conflict (pregunta, jugador) do nothing;
  return true;
end $$;

revoke execute on function invitacion(text), sin_tildes(text), buscar_mesa(text, text),
  pedir_cancion(text, text, text, uuid), votar_cancion(uuid, uuid), mis_votos(uuid), autorizar_voz(text),
  firmar_libro(text, text, text), estado_juego(), responder_juego(uuid, text, int) from public, anon, authenticated;
grant execute on function invitacion(text), buscar_mesa(text, text),
  pedir_cancion(text, text, text, uuid), votar_cancion(uuid, uuid), mis_votos(uuid), autorizar_voz(text),
  firmar_libro(text, text, text), estado_juego(), responder_juego(uuid, text, int) to anon, authenticated;
grant execute on function sin_tildes(text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table avisos;
exception when duplicate_object then null; end $$;

-- ── Storage: bucket del álbum ───────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('album', 'album', true, 26214400,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime',
              'audio/webm','audio/mp4','audio/x-m4a','audio/ogg','audio/mpeg'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Sólo se sube a una ruta que la base autorizó (ver autorizar_subida).
drop policy if exists album_subir on storage.objects;
create policy album_subir on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'album' and public.subida_autorizada(name));

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
