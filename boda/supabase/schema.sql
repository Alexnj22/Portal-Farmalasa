-- ─────────────────────────────────────────────────────────────────────────────
-- Base del sitio de la boda. Se corre en un proyecto de Supabase NUEVO
-- (SQL Editor → pegar → Run). Es idempotente: se vuelve a correr COMPLETO cada
-- vez que cambia, y agrega lo nuevo sin borrar datos.
--
-- Modelo de acceso:
--   · anon (invitados): NO lee tablas de invitados. Todo lo que hace pasa por
--     funciones que exigen su código de invitación, la clave del álbum o un
--     token de dispositivo que emite la base.
--   · admin: usuario autenticado cuyo user_id está en `admins`.
--
-- Frenos: cada función abierta a invitados tiene un tope global, uno por IP
-- (generoso: el wifi del salón comparte IP) y, cuando hay token, uno por
-- teléfono. Los intentos fallidos de clave o código se cuentan por IP y a los
-- 20 en 10 minutos se corta. Ver `freno()`.
-- ─────────────────────────────────────────────────────────────────────────────

-- En Supabase pgcrypto ya vive en el esquema `extensions`; esto es un no-op.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ── Utilidades puras (no tocan tablas) ──────────────────────────────────────
-- Código al azar con el mismo alfabeto que src/lib/codigo.js: sin 0/O, 1/I ni L,
-- para que se dicte por teléfono sin confusiones. 31 símbolos.
create or replace function codigo_aleatorio(p_largo int default 8) returns text
language plpgsql volatile set search_path = public, extensions as $$
declare b bytea := gen_random_bytes(p_largo); r text := '';
begin
  for i in 0 .. p_largo - 1 loop
    r := r || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return r;
end $$;

create or replace function sin_tildes(t text) returns text
language sql immutable set search_path = public as $$
  select translate(lower(coalesce(t, '')), 'áéíóúüñàèìòù', 'aeiouunaeiou');
$$;

-- Una URL https sin caracteres raros y de largo razonable.
create or replace function url_segura(u text) returns text
language sql immutable set search_path = public as $$
  select case when u ~ '^https://[^\s"<>]+$' and length(u) <= 500 then u end;
$$;

-- Carátulas y muestras sólo de los catálogos que usa el buscador. Una URL
-- cualquiera dejaría a un invitado poner una imagen propia en la pantalla del DJ.
-- (itunes.apple.com: las muestras de Apple vienen de audio-ssl.itunes.apple.com.)
create or replace function url_de_catalogo(u text) returns text
language sql immutable set search_path = public as $$
  select case when url_segura(u) is not null
    and lower(substring(u from '^https://([^/:?#]+)')) ~ '(^|\.)(mzstatic\.com|dzcdn\.net|scdn\.co|ytimg\.com|itunes\.apple\.com)$'
    then u end;
$$;

-- ── Tablas ───────────────────────────────────────────────────────────────────
create table if not exists admins (
  email text primary key,
  created_at timestamptz not null default now()
);
-- El panel reconoce al admin por su user_id, no por el correo del token.
alter table admins add column if not exists user_id uuid unique references auth.users(id) on delete cascade;

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
  codigo text not null unique default codigo_aleatorio(8),
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
-- Códigos nuevos de 8 caracteres; los de 6 que ya se repartieron siguen valiendo.
alter table grupos alter column codigo set default codigo_aleatorio(8);
alter table grupos add column if not exists llegada_at timestamptz;  -- registrada en la entrada
-- Invitación que se abre sola en modo fácil (abuelos). La marcan los novios.
alter table grupos add column if not exists letra_grande boolean not null default false;

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
-- Acompañante que escribió el propio invitado al confirmar: es el único que
-- el invitado puede renombrar o quitar.
alter table personas add column if not exists agregado_por_invitado boolean not null default false;
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
alter table fotos add column if not exists miniatura text;
-- Oculta Y movida al bucket privado «ocultas»: su enlace público ya no la sirve.
alter table fotos add column if not exists privada boolean not null default false;
drop index if exists fotos_fecha_idx;
create index if not exists fotos_cursor_idx on fotos(created_at desc, id desc);

create table if not exists mensajes (
  id uuid primary key default gen_random_uuid(),
  autor text not null,
  texto text not null,
  oculto boolean not null default false,
  created_at timestamptz not null default now()
);
alter table mensajes add column if not exists audio text;   -- ruta en el bucket «album» (voces/…)
create index if not exists mensajes_cursor_idx on mensajes(created_at desc, id desc);

-- Permisos de subida al álbum. El invitado pide uno con la clave del álbum y
-- recibe una ruta generada acá; el almacenamiento sólo acepta archivos en una
-- ruta con permiso vigente.
create table if not exists subidas (
  ruta text primary key,                -- archivo principal
  miniatura text not null unique,       -- versión chica (jpg)
  usada boolean not null default false, -- ya se registró la foto
  created_at timestamptz not null default now()
);
create index if not exists subidas_fecha_idx on subidas(created_at);

create table if not exists avisos (
  id uuid primary key default gen_random_uuid(),
  texto text not null check (length(texto) between 1 and 280),
  created_at timestamptz not null default now()
);
create index if not exists avisos_fecha_idx on avisos(created_at desc);

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
alter table canciones add column if not exists portada text;   -- carátula (catálogo permitido)
alter table canciones add column if not exists enlace text;    -- Apple Music / Spotify / YouTube
alter table canciones add column if not exists muestra text;   -- vista previa de 30 s (catálogo permitido)
-- Sello de cambio: listar_canciones() manda sólo lo que cambió desde el último.
alter table canciones add column if not exists updated_at timestamptz not null default now();
create unique index if not exists canciones_unica on canciones (sin_tildes(titulo), sin_tildes(coalesce(artista, '')));
create index if not exists canciones_fecha_idx on canciones(created_at);
create index if not exists canciones_cambio_idx on canciones(updated_at);

create table if not exists canciones_votos (
  cancion_id uuid not null references canciones(id) on delete cascade,
  votante uuid not null,               -- token de dispositivo (ver dispositivos)
  created_at timestamptz not null default now(),
  primary key (cancion_id, votante)
);
create index if not exists canciones_votos_votante_idx on canciones_votos(votante);

create table if not exists juego_respuestas (
  pregunta int not null,
  jugador uuid not null,               -- token de dispositivo
  nombre text not null,
  opcion int not null check (opcion between 0 and 5),
  created_at timestamptz not null default now(),
  primary key (pregunta, jugador)
);
create index if not exists juego_respuestas_jugador_idx on juego_respuestas(jugador);

-- Frenos: una fila por intento contado. Se purga sola (1 día).
create table if not exists frenos (
  id bigint generated always as identity primary key,
  tipo text not null,
  clave text not null,
  created_at timestamptz not null default now()
);
create index if not exists frenos_idx on frenos(tipo, clave, created_at desc);
create index if not exists frenos_fecha_idx on frenos(created_at);

-- Teléfonos: el token que emite la base para votar y jugar. Es un uuid al azar
-- (122 bits) que sólo conoce ese teléfono: no se puede inventar uno válido.
create table if not exists dispositivos (
  id uuid primary key default gen_random_uuid(),
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists dispositivos_ip_idx on dispositivos(ip, created_at desc);

-- Auditoría de invitados, personas y ajustes: quién cambió qué.
create table if not exists cambios (
  id bigint generated always as identity primary key,
  tabla text not null,
  fila text,
  accion text not null,
  antes jsonb,
  despues jsonb,
  quien text not null,
  created_at timestamptz not null default now()
);
create index if not exists cambios_fecha_idx on cambios(created_at desc);

-- Medidas caras que se recalculan como mucho una vez por minuto (espacio usado).
create table if not exists medidas (
  clave text primary key,
  valor bigint not null,
  medido_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ── Ajustes iniciales ───────────────────────────────────────────────────────
-- Clave del álbum (va en el QR de las mesas): 8 caracteres al azar. Si ya había
-- una, se respeta (está impresa en los QR); se cambia desde el panel.
insert into ajustes (clave, valor) values ('clave_album', codigo_aleatorio(8))
on conflict (clave) do nothing;
-- La fecha límite, la zona horaria, los momentos y los segundos del juego los
-- copia el panel desde src/config.js cada vez que se abre.
insert into ajustes (clave, valor) values
  ('confirmar_antes_de', '2099-12-31'),
  ('zona_horaria', 'America/El_Salvador'),
  ('moderar_mensajes', 'no'),
  ('momentos', ''),                -- vacío = cualquier momento; si no, lista separada por |
  ('cuota_album_gb', '90'),        -- tope del bucket antes de negar permisos (pensado en Pro)
  ('juego_pregunta', '-1'), ('juego_fase', 'cerrado'), ('juego_correctas', ''), ('juego_desde', ''),
  ('juego_segundos', '20'),
  -- Palabras que no se aceptan como nombre en el juego (sin tildes, separadas por coma).
  ('groserias', 'puta,puto,pendejo,pendeja,verga,mierda,culero,culera,cabron,cabrona,marica,maricon,'
             || 'cono,joder,chinga,chingada,pinche,culo,hijueputa,hijoputa,hdp,malparido,zorra,perra,'
             || 'idiota,estupido,estupida,imbecil,mamada,polla,coger,follar,nazi')
on conflict (clave) do nothing;

-- ── Funciones de apoyo ──────────────────────────────────────────────────────
create or replace function ajuste(p_clave text) returns text
language sql stable security definer set search_path = public as $$
  select valor from ajustes where clave = p_clave;
$$;

create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = (select auth.uid()));
$$;

-- IP del invitado: primer valor de x-forwarded-for. Ojo: ese primer valor lo
-- puede escribir el propio cliente, así que el freno por IP es un freno de
-- cortesía; los topes globales son los que no se pueden esquivar.
create or replace function ip_cliente() returns text
language sql stable set search_path = public as $$
  select coalesce(nullif(trim(split_part(
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json->>'x-forwarded-for',
    ',', 1)), ''), 'sin-ip');
$$;

-- ¿Ya se pasó del tope? Sólo mira, no cuenta. Cuenta hasta p_max y para.
create or replace function excedido(p_tipo text, p_clave text, p_max int, p_ventana interval) returns boolean
language sql stable security definer set search_path = public as $$
  select count(*) >= p_max from (
    select 1 from frenos
    where tipo = p_tipo and clave = coalesce(p_clave, '') and created_at > now() - p_ventana
    limit p_max) x;
$$;

-- Freno: true = pasa (y queda contado); false = se pasó del tope.
-- Si la función que lo llama falla después, el conteo se deshace con ella.
create or replace function freno(p_tipo text, p_clave text, p_max int, p_ventana interval) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if excedido(p_tipo, p_clave, p_max, p_ventana) then return false; end if;
  insert into frenos (tipo, clave) values (p_tipo, coalesce(p_clave, ''));
  if random() < 0.002 then delete from frenos where created_at < now() - interval '1 day'; end if;
  return true;
end $$;

-- Clave del álbum. true = sirve. Un fallo queda anotado por IP (por eso NO se
-- lanza un error: deshacería la anotación); a los 20 fallos en 10 min se corta.
create or replace function revisar_clave(p_clave text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_ip text := ip_cliente();
begin
  if excedido('clave_fallida', v_ip, 20, interval '10 minutes') then
    raise exception 'Demasiados intentos con una clave incorrecta. Espera unos minutos.';
  end if;
  if exists (select 1 from ajustes where clave = 'clave_album' and valor = upper(trim(coalesce(p_clave, '')))) then
    return true;
  end if;
  insert into frenos (tipo, clave) values ('clave_fallida', v_ip);
  return false;
end $$;

-- Código de invitación. Devuelve el id del grupo o null (y anota el fallo).
create or replace function revisar_codigo(p_codigo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ip text := ip_cliente(); v uuid;
begin
  if excedido('codigo_fallido', v_ip, 20, interval '10 minutes') then
    raise exception 'Demasiados intentos con un código que no existe. Espera unos minutos.';
  end if;
  select id into v from grupos where codigo = upper(trim(coalesce(p_codigo, '')));
  if v is null then insert into frenos (tipo, clave) values ('codigo_fallido', v_ip); end if;
  return v;
end $$;

create or replace function dispositivo_valido(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_id is not null and exists (select 1 from dispositivos where id = p_id);
$$;

-- ¿Ya pasó la fecha límite para confirmar? Con la hora del LUGAR de la boda.
create or replace function plazo_vencido() returns boolean
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce(ajuste('zona_horaria'), 'America/El_Salvador'))::date
         > coalesce(ajuste('confirmar_antes_de'), '2099-12-31')::date;
$$;

-- Espacio usado por el álbum (bytes), recalculado como mucho una vez por minuto.
create or replace function uso_album() returns bigint
language plpgsql security definer set search_path = public as $$
declare m medidas; v bigint;
begin
  select * into m from medidas where clave = 'uso_album';
  if found and m.medido_at > now() - interval '1 minute' then return m.valor; end if;
  select coalesce(sum((metadata->>'size')::bigint), 0) into v
  from storage.objects where bucket_id in ('album', 'ocultas');
  insert into medidas (clave, valor, medido_at) values ('uso_album', v, now())
  on conflict (clave) do update set valor = excluded.valor, medido_at = excluded.medido_at;
  return v;
end $$;

create or replace function cuota_superada() returns boolean
language sql security definer set search_path = public as $$
  select uso_album() >= coalesce(nullif(ajuste('cuota_album_gb'), '')::numeric, 90) * 1024 * 1024 * 1024;
$$;

-- Tamaño y tipo por carpeta: voces ≤ 3 MB de audio, fotos ≤ 15 MB de imagen,
-- videos ≤ 60 MB. Al INSERTAR en storage.objects el tamaño todavía puede no
-- conocerse (metadata llega después); por eso registrar_foto y firmar_libro lo
-- vuelven a mirar con el archivo ya subido.
create or replace function archivo_permitido(p_nombre text, p_meta jsonb) returns boolean
language sql immutable set search_path = public as $$
  select case
    when p_meta is null or (p_meta->>'size') is null then
      p_nombre like 'fotos/%' or p_nombre like 'voces/%'
    when p_nombre like 'voces/%' then
      (p_meta->>'size')::bigint <= 3145728 and coalesce(p_meta->>'mimetype', 'audio/') like 'audio/%'
    when p_nombre like 'fotos/%' and p_nombre ~* '\.(mp4|mov)$' then
      (p_meta->>'size')::bigint <= 62914560 and coalesce(p_meta->>'mimetype', 'video/') like 'video/%'
    when p_nombre like 'fotos/%' then
      (p_meta->>'size')::bigint <= 15728640 and coalesce(p_meta->>'mimetype', 'image/') like 'image/%'
    else false end;
$$;

-- ── Disparadores ────────────────────────────────────────────────────────────
-- admins: con sólo el correo se resuelve el user_id (el usuario se crea antes).
create or replace function admins_resolver() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null then
    select id into new.user_id from auth.users where lower(email) = lower(new.email) limit 1;
  end if;
  return new;
end $$;
drop trigger if exists admins_resolver on admins;
create trigger admins_resolver before insert or update of email on admins
  for each row execute function admins_resolver();
-- Migración: los admins que existían sólo por correo.
update admins a set user_id = u.id from auth.users u
where a.user_id is null and lower(u.email) = lower(a.email);

-- La clave del álbum se guarda en mayúsculas y con al menos 6 caracteres.
create or replace function ajustes_clave_album() returns trigger
language plpgsql set search_path = public as $$
begin
  new.valor := upper(trim(new.valor));
  if length(new.valor) < 6 then raise exception 'La clave del álbum necesita al menos 6 caracteres'; end if;
  return new;
end $$;
drop trigger if exists ajustes_clave_album on ajustes;
create trigger ajustes_clave_album before insert or update on ajustes
  for each row when (new.clave = 'clave_album') execute function ajustes_clave_album();

create or replace function tocar_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists canciones_updated_at on canciones;
create trigger canciones_updated_at before update on canciones
  for each row execute function tocar_updated_at();

-- Auditoría. quién: 'panel' si es un admin; 'invitado:CODIGO' si viene de su
-- invitación (las funciones lo marcan con set_config); si no, 'sistema'.
create or replace function anotar_cambio() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_antes jsonb; v_despues jsonb; v_fila jsonb; v_quien text;
begin
  if TG_OP <> 'INSERT' then v_antes := to_jsonb(old); end if;
  if TG_OP <> 'DELETE' then v_despues := to_jsonb(new); end if;
  if TG_OP = 'UPDATE' and v_antes = v_despues then return null; end if;
  v_fila := coalesce(v_despues, v_antes);
  -- El juego escribe sus ajustes en cada pregunta: no es un cambio que auditar.
  if TG_TABLE_NAME = 'ajustes' and v_fila->>'clave' like 'juego\_%' then return null; end if;
  v_quien := case
    when (select es_admin()) then 'panel'
    when nullif(current_setting('boda.quien', true), '') is not null then current_setting('boda.quien', true)
    else 'sistema' end;
  insert into cambios (tabla, fila, accion, antes, despues, quien)
  values (TG_TABLE_NAME, coalesce(v_fila->>'id', v_fila->>'clave'), TG_OP, v_antes, v_despues, v_quien);
  return null;
end $$;
drop trigger if exists grupos_cambios on grupos;
create trigger grupos_cambios after insert or update or delete on grupos
  for each row execute function anotar_cambio();
drop trigger if exists personas_cambios on personas;
create trigger personas_cambios after insert or update or delete on personas
  for each row execute function anotar_cambio();
drop trigger if exists ajustes_cambios on ajustes;
create trigger ajustes_cambios after insert or update or delete on ajustes
  for each row execute function anotar_cambio();

-- ── RLS ──────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['admins','ajustes','mesas','grupos','personas','fotos','mensajes','subidas','avisos',
                           'canciones','canciones_votos','juego_respuestas','frenos','dispositivos','cambios','medidas'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
  -- El panel hace todo en estas tablas.
  foreach t in array array['ajustes','mesas','grupos','personas','fotos','mensajes','subidas','avisos',
                           'canciones','canciones_votos','juego_respuestas'] loop
    execute format('drop policy if exists %I on %I', t || '_admin', t);
    execute format(
      'create policy %I on %I for all to authenticated using ((select es_admin())) with check ((select es_admin()))',
      t || '_admin', t);
  end loop;
  -- Y sólo mira estas (las escriben las funciones).
  foreach t in array array['admins','frenos','dispositivos','cambios','medidas'] loop
    execute format('drop policy if exists %I on %I', t || '_admin', t);
    execute format('create policy %I on %I for select to authenticated using ((select es_admin()))', t || '_admin', t);
  end loop;
end $$;
drop policy if exists admins_self on admins;
drop policy if exists juego_admin on juego_respuestas;

-- Lectura pública de lo que se muestra a todos
drop policy if exists fotos_publicas on fotos;
create policy fotos_publicas on fotos for select to anon, authenticated using (not oculta);
drop policy if exists mensajes_publicos on mensajes;
create policy mensajes_publicos on mensajes for select to anon, authenticated using (not oculto);
drop policy if exists avisos_publicos on avisos;
create policy avisos_publicos on avisos for select to anon, authenticated using (created_at > now() - interval '2 days');
drop policy if exists canciones_publicas on canciones;
create policy canciones_publicas on canciones for select to anon, authenticated using (not oculta);

-- ── Funciones para invitados ────────────────────────────────────────────────
-- Arma la invitación de un grupo (interna: no se expone).
create or replace function invitacion_de(p_id uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'grupo', json_build_object('codigo', g.codigo, 'nombre', g.nombre, 'pases', g.pases,
                               'estado', g.estado, 'mensaje', g.mensaje, 'cancion', g.cancion,
                               'respondido_at', g.respondido_at, 'letra_grande', g.letra_grande),
    'limite', ajuste('confirmar_antes_de'),
    'personas', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'nombre', p.nombre, 'es_nino', p.es_nino, 'asistira', p.asistira,
        'restriccion', p.restriccion, 'mesa', m.nombre, 'agregado', p.agregado_por_invitado) order by p.created_at)
      from personas p left join mesas m on m.id = p.mesa_id where p.grupo_id = g.id), '[]'::json))
  from grupos g where g.id = p_id;
$$;

create or replace function invitacion(p_codigo text) returns json
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := revisar_codigo(p_codigo);
  if v_id is null then return null; end if;
  perform set_config('boda.quien', 'invitado:' || upper(trim(p_codigo)), true);
  update grupos set abierta_at = now() where id = v_id and abierta_at is null;
  return invitacion_de(v_id);
end $$;

-- p_personas: [{ id?, nombre, asistira, restriccion, quitar? }]
--   · con id de una persona del grupo: la actualiza (el nombre sólo si la agregó el invitado);
--   · con id y quitar=true: borra a un acompañante que agregó el invitado;
--   · con nombre y sin id (o con un id nuevo generado en el teléfono): agrega un
--     acompañante. Con id del teléfono, un reintento no lo duplica.
-- Un código inexistente devuelve {error} en vez de lanzar, para que el fallo
-- quede anotado en el freno por IP.
create or replace function responder_invitacion(
  p_codigo text, p_personas json, p_mensaje text default null, p_cancion text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v_id uuid; g grupos; x json; v_pid uuid; n_si int; n_total int; n_nuevas int;
begin
  v_id := revisar_codigo(p_codigo);
  if v_id is null then return json_build_object('error', 'Invitación no encontrada'); end if;
  select * into g from grupos where id = v_id for update;
  perform set_config('boda.quien', 'invitado:' || g.codigo, true);
  if plazo_vencido() then
    raise exception 'El plazo para confirmar ya terminó. Escríbenos directamente.';
  end if;
  if p_personas is null or json_typeof(p_personas) <> 'array' or json_array_length(p_personas) > 60 then
    raise exception 'Respuesta inválida';
  end if;
  if exists (select 1 from json_array_elements(p_personas) e
             where nullif(e->>'id', '') is not null
               and (e->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'Respuesta inválida';
  end if;
  if exists (select 1 from json_array_elements(p_personas) e
             where coalesce(e->>'quitar', 'false') <> 'true'
               and (nullif(e->>'id', '') is not null or nullif(trim(e->>'nombre'), '') is not null)
               and coalesce(e->>'asistira', '') not in ('true', 'false')) then
    raise exception 'Indica si asiste cada persona';
  end if;

  -- Primero se quitan los acompañantes que el invitado retiró: liberan su pase.
  delete from personas
  where grupo_id = g.id and agregado_por_invitado
    and id in (select (e->>'id')::uuid from json_array_elements(p_personas) e
               where nullif(e->>'id', '') is not null and e->>'quitar' = 'true');

  -- Los pases se cuentan contra lo GUARDADO más lo nuevo. «Nuevo» = con nombre
  -- y sin id, o con un id que todavía no existe (generado en el teléfono).
  select count(*) into n_nuevas from json_array_elements(p_personas) e
  where coalesce(e->>'quitar', 'false') <> 'true'
    and nullif(trim(e->>'nombre'), '') is not null
    and (nullif(e->>'id', '') is null
         or not exists (select 1 from personas p where p.id = (e->>'id')::uuid));
  select count(*) into n_total from personas where grupo_id = g.id;
  if n_total + n_nuevas > g.pases then
    raise exception 'La invitación tiene % pases', g.pases;
  end if;

  for x in select * from json_array_elements(p_personas) loop
    if x->>'quitar' = 'true' then continue; end if;
    v_pid := nullif(x->>'id', '')::uuid;
    if v_pid is not null and exists (select 1 from personas where id = v_pid and grupo_id = g.id) then
      update personas set
        nombre = case when agregado_por_invitado
                      then coalesce(nullif(left(trim(x->>'nombre'), 80), ''), nombre) else nombre end,
        asistira = (x->>'asistira')::boolean,
        restriccion = nullif(left(trim(x->>'restriccion'), 200), '')
      where id = v_pid;
    elsif nullif(trim(x->>'nombre'), '') is not null then
      insert into personas (id, grupo_id, nombre, asistira, restriccion, agregado_por_invitado)
      values (coalesce(v_pid, gen_random_uuid()), g.id, left(trim(x->>'nombre'), 80), (x->>'asistira')::boolean,
              nullif(left(trim(x->>'restriccion'), 200), ''), true)
      on conflict (id) do nothing;
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

  return invitacion_de(g.id);
end $$;

create or replace function verificar_clave_album(p_clave text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  return revisar_clave(p_clave);
end $$;

-- Token del teléfono para votar y jugar. Freno por IP (el salón comparte wifi).
create or replace function emitir_token_dispositivo() returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; v_ip text := ip_cliente();
begin
  if not freno('dispositivo_ip', v_ip, 300, interval '10 minutes') then
    raise exception 'Demasiados teléfonos nuevos desde esta red. Intenta en unos minutos.';
  end if;
  insert into dispositivos (ip) values (v_ip) returning id into v;
  return v;
end $$;

-- Paso 1 de una subida: con la clave del álbum, la base inventa la ruta.
-- Clave mala → {error} (sin lanzar, para que el fallo quede anotado).
create or replace function autorizar_subida(p_clave text, p_ext text) returns json
language plpgsql security definer set search_path = public as $$
declare v_ext text := lower(trim(coalesce(p_ext, ''))); v_base text; v_ruta text; v_mini text;
begin
  if not revisar_clave(p_clave) then return json_build_object('error', 'Clave del álbum incorrecta'); end if;
  if v_ext not in ('jpg','jpeg','png','webp','heic','heif','mp4','mov') then
    raise exception 'Ese tipo de archivo no se puede subir';
  end if;
  if cuota_superada() then
    raise exception 'El álbum llegó a su límite de espacio. Avísales a los novios.';
  end if;
  -- Frenos contra abuso: muy por encima de lo que sube un salón lleno.
  if not freno('subida', '*', 1500, interval '10 minutes') then
    raise exception 'Hay demasiadas fotos subiéndose en este momento. Intenta en unos minutos.';
  end if;
  if not freno('subida_ip', ip_cliente(), 600, interval '10 minutes') then
    raise exception 'Hay demasiadas fotos subiéndose desde esta red. Intenta en unos minutos.';
  end if;
  if random() < 0.01 then
    delete from subidas where (not usada and created_at < now() - interval '1 hour')
                           or created_at < now() - interval '2 days';
  end if;
  v_base := 'fotos/' || to_char(now() at time zone coalesce(ajuste('zona_horaria'), 'UTC'), 'YYYY-MM-DD')
            || '/' || gen_random_uuid();
  v_ruta := v_base || '.' || v_ext;
  v_mini := v_base || '_m.jpg';
  insert into subidas (ruta, miniatura) values (v_ruta, v_mini);
  return json_build_object('ruta', v_ruta, 'miniatura', v_mini, 'vence_at', now() + interval '30 minutes');
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
-- Idempotente: si el permiso ya se usó para esta ruta, devuelve la foto existente
-- (un reintento después de perder la respuesta no falla ni duplica).
drop function if exists registrar_foto(text, text, text, text, int, int);
create or replace function registrar_foto(
  p_ruta text, p_autor text, p_momento text, p_ancho int, p_alto int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare s subidas; v uuid; v_meta jsonb; v_momento text := nullif(left(trim(p_momento), 30), '');
        v_lista text := nullif(ajuste('momentos'), '');
begin
  select * into s from subidas where ruta = p_ruta for update;
  if not found then raise exception 'El permiso de subida venció. Intenta de nuevo.'; end if;
  if s.usada then
    select id into v from fotos where ruta = s.ruta;
    if v is null then raise exception 'Esa foto ya se registró y después se borró.'; end if;
    return v;
  end if;
  select metadata into v_meta from storage.objects where bucket_id = 'album' and name = s.ruta;
  if not found then raise exception 'El archivo no llegó completo. Intenta de nuevo.'; end if;
  if not archivo_permitido(s.ruta, v_meta) then
    raise exception 'El archivo es demasiado pesado o no es del tipo permitido.';
  end if;
  if v_lista is not null and (v_momento is null or not (v_momento = any (string_to_array(v_lista, '|')))) then
    v_momento := null;
  end if;
  update subidas set usada = true where ruta = s.ruta;
  insert into fotos (ruta, miniatura, autor, momento, ancho, alto)
  values (s.ruta,
          case when exists (select 1 from storage.objects where bucket_id = 'album' and name = s.miniatura)
               then s.miniatura end,
          nullif(left(trim(p_autor), 60), ''), v_momento,
          case when p_ancho between 1 and 10000 then p_ancho end,
          case when p_alto between 1 and 10000 then p_alto end)
  returning id into v;
  return v;
end $$;

-- «¿Dónde me siento?»: con la clave del álbum, busca por nombre entre los que
-- confirmaron y ya tienen mesa. Mínimo 4 letras, máximo 5 resultados.
create or replace function buscar_mesa(p_clave text, p_nombre text) returns json
language plpgsql security definer set search_path = public as $$
declare q text := sin_tildes(trim(coalesce(p_nombre, '')));
begin
  if not revisar_clave(p_clave) then return json_build_object('error', 'Clave incorrecta'); end if;
  if not freno('mesa_ip', ip_cliente(), 120, interval '10 minutes') then
    raise exception 'Demasiadas búsquedas seguidas. Intenta en unos minutos.';
  end if;
  if length(q) < 4 then return '[]'::json; end if;
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return coalesce((
    select json_agg(json_build_object('nombre', p.nombre, 'mesa', m.nombre) order by p.nombre)
    from (select * from personas p
          where p.asistira and p.mesa_id is not null and sin_tildes(p.nombre) like '%' || q || '%' escape '\'
          order by p.nombre limit 5) p
    join mesas m on m.id = p.mesa_id), '[]'::json);
end $$;

-- ── Canciones ───────────────────────────────────────────────────────────────
-- Lista incremental: con p_desde, sólo lo que cambió desde ese sello (con 10 s
-- de solape para no perder lo que estaba a medio guardar). Una canción oculta
-- le llega al invitado como {id, oculta:true} para que la saque de su lista.
-- `total` deja al cliente notar un borrado y pedir la lista entera.
create or replace function listar_canciones(p_desde timestamptz default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean := es_admin();
begin
  return json_build_object(
    'sello', now(),
    'total', (select count(*) from canciones where v_admin or not oculta),
    'filas', coalesce((
      select json_agg(case when c.oculta and not v_admin
               then json_build_object('id', c.id, 'oculta', true)
               else json_build_object('id', c.id, 'titulo', c.titulo, 'artista', c.artista,
                      'pedido_por', c.pedido_por, 'votos', c.votos, 'tocada', c.tocada, 'oculta', c.oculta,
                      'portada', c.portada, 'enlace', c.enlace, 'muestra', c.muestra,
                      'created_at', c.created_at) end)
      from canciones c
      where (p_desde is null and (v_admin or not c.oculta))
         or (p_desde is not null and c.updated_at > p_desde - interval '10 seconds')), '[]'::json));
end $$;

-- Pedir: si ya la pidió alguien, cuenta como voto. Se recorta ANTES de comparar
-- (si no, un título de 130 letras nunca coincidía con el guardado de 120), y el
-- alta usa la clave única: dos pedidos a la vez no chocan.
drop function if exists pedir_cancion(text, text, text, uuid);
create or replace function pedir_cancion(p_titulo text, p_artista text, p_nombre text, p_votante uuid,
  p_portada text default null, p_enlace text default null, p_muestra text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; n int;
        v_t text := left(trim(coalesce(p_titulo, '')), 120);
        v_a text := nullif(left(trim(coalesce(p_artista, '')), 80), '');
begin
  if length(v_t) < 1 then raise exception 'Escribe el nombre de la canción'; end if;
  if not dispositivo_valido(p_votante) then raise exception 'Dispositivo desconocido. Vuelve a intentar.'; end if;
  if not freno('cancion_ip', ip_cliente(), 120, interval '10 minutes')
     or not freno('cancion_disp', p_votante::text, 20, interval '10 minutes') then
    raise exception 'Llegaron muchas canciones seguidas. Intenta en unos minutos.';
  end if;
  insert into canciones (titulo, artista, pedido_por, portada, enlace, muestra)
  values (v_t, v_a, nullif(left(trim(p_nombre), 60), ''),
          url_de_catalogo(p_portada), url_segura(p_enlace), url_de_catalogo(p_muestra))
  on conflict (sin_tildes(titulo), sin_tildes(coalesce(artista, ''))) do nothing
  returning id into v;
  if v is null then
    select id into v from canciones
    where sin_tildes(titulo) = sin_tildes(v_t) and sin_tildes(coalesce(artista, '')) = sin_tildes(coalesce(v_a, ''))
    for update;
    update canciones set portada = coalesce(portada, url_de_catalogo(p_portada)),
      enlace = coalesce(enlace, url_segura(p_enlace)), muestra = coalesce(muestra, url_de_catalogo(p_muestra))
    where id = v and (portada is null or enlace is null or muestra is null);
  elsif not freno('cancion', '*', 300, interval '10 minutes') then
    raise exception 'Llegaron muchas canciones seguidas. Intenta en unos minutos.';
  end if;
  -- El voto de quien la pide (salvo que ya haya votado por 50).
  if (select count(*) from canciones_votos where votante = p_votante) < 50 then
    insert into canciones_votos (cancion_id, votante) values (v, p_votante) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 then update canciones set votos = votos + 1 where id = v; end if;
  end if;
  return v;
end $$;

-- Votar o quitar el voto. Devuelve si quedó votada. El conteo es atómico.
create or replace function votar_cancion(p_id uuid, p_votante uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not dispositivo_valido(p_votante) then raise exception 'Dispositivo desconocido. Vuelve a intentar.'; end if;
  perform 1 from canciones where id = p_id and not oculta for update;
  if not found then raise exception 'Esa canción ya no está en la lista'; end if;
  if not freno('voto_disp', p_votante::text, 120, interval '10 minutes') then
    raise exception 'Muchos votos seguidos. Intenta en unos minutos.';
  end if;
  delete from canciones_votos where cancion_id = p_id and votante = p_votante;
  get diagnostics n = row_count;
  if n > 0 then
    update canciones set votos = greatest(votos - 1, 0) where id = p_id;
    return false;
  end if;
  if (select count(*) from canciones_votos where votante = p_votante) >= 50 then
    raise exception 'Ya votaste por muchas canciones';
  end if;
  insert into canciones_votos (cancion_id, votante) values (p_id, p_votante) on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then update canciones set votos = votos + 1 where id = p_id; end if;
  return true;
end $$;

-- Qué canciones votó este teléfono (para pintar los corazones).
create or replace function mis_votos(p_votante uuid) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(cancion_id), '[]'::json) from canciones_votos where votante = p_votante;
$$;

-- ── Mensajes de voz y libro de firmas ───────────────────────────────────────
-- La voz exige la clave del álbum o un código de invitación válido.
drop function if exists autorizar_voz(text);
create or replace function autorizar_voz(p_ext text, p_clave text default null, p_codigo text default null) returns json
language plpgsql security definer set search_path = public as $$
declare v_ext text := lower(trim(coalesce(p_ext, ''))); v_ruta text;
begin
  if nullif(trim(p_clave), '') is not null then
    if not revisar_clave(p_clave) then return json_build_object('error', 'Clave del álbum incorrecta'); end if;
  elsif nullif(trim(p_codigo), '') is not null then
    if revisar_codigo(p_codigo) is null then return json_build_object('error', 'Invitación no encontrada'); end if;
  else
    return json_build_object('error', 'Para dejar un mensaje de voz, abre tu invitación o el álbum.');
  end if;
  if v_ext not in ('webm','m4a','mp4','ogg','mp3') then raise exception 'Formato de audio no permitido'; end if;
  if cuota_superada() then raise exception 'El álbum llegó a su límite de espacio. Avísales a los novios.'; end if;
  if not freno('voz', '*', 200, interval '10 minutes')
     or not freno('voz_ip', ip_cliente(), 60, interval '10 minutes') then
    raise exception 'Llegaron muchos mensajes seguidos. Intenta en unos minutos.';
  end if;
  v_ruta := 'voces/' || gen_random_uuid() || '.' || v_ext;
  insert into subidas (ruta, miniatura) values (v_ruta, v_ruta || '.sin-miniatura');
  return json_build_object('ruta', v_ruta);
end $$;

drop function if exists firmar_libro(text, text);
drop function if exists firmar_libro(text, text, text);
create or replace function firmar_libro(p_autor text, p_texto text, p_audio text default null,
  p_dispositivo uuid default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_moderar boolean := coalesce(ajuste('moderar_mensajes'), 'no') = 'si'; v_audio text; v_meta jsonb;
begin
  if length(trim(coalesce(p_autor, ''))) < 2 then raise exception 'Escribe tu nombre'; end if;
  if p_audio is null and length(trim(coalesce(p_texto, ''))) < 2 then raise exception 'Escribe tu mensaje o graba uno de voz'; end if;
  if p_dispositivo is not null and not dispositivo_valido(p_dispositivo) then
    raise exception 'Dispositivo desconocido. Vuelve a intentar.';
  end if;
  if not freno('mensaje', '*', 100, interval '10 minutes')
     or not freno('mensaje_ip', ip_cliente(), 60, interval '10 minutes')
     or (p_dispositivo is not null and not freno('mensaje_disp', p_dispositivo::text, 30, interval '10 minutes')) then
    raise exception 'Llegaron muchos mensajes seguidos. Intenta en unos minutos.';
  end if;
  if p_audio is not null then
    update subidas set usada = true
    where ruta = p_audio and ruta like 'voces/%' and not usada and created_at > now() - interval '30 minutes'
    returning ruta into v_audio;
    if v_audio is null then raise exception 'El audio no llegó completo. Intenta de nuevo.'; end if;
    select metadata into v_meta from storage.objects where bucket_id = 'album' and name = v_audio;
    if not found then raise exception 'El audio no llegó completo. Intenta de nuevo.'; end if;
    if not archivo_permitido(v_audio, v_meta) then
      raise exception 'El audio es demasiado pesado o no es de un tipo permitido.';
    end if;
  end if;
  insert into mensajes (autor, texto, oculto, audio)
  values (left(trim(p_autor), 60), coalesce(left(trim(p_texto), 600), ''), v_moderar, v_audio);
  return not v_moderar;
end $$;

-- ── El juego del salón («¿Cuánto conoces a los novios?») ────────────────────
-- Las preguntas viven en src/config.js; la base guarda la pregunta en curso, su
-- fase, las respuestas correctas y los segundos (los copia el panel).
-- El conteo por opción sólo sale con la pregunta revelada: mientras está
-- abierta, ver cómo va el salón sería una pista.
create or replace function estado_juego() returns json
language plpgsql stable security definer set search_path = public as $$
declare v_p int := coalesce(ajuste('juego_pregunta'), '-1')::int;
        v_f text := coalesce(ajuste('juego_fase'), 'cerrado');
        v_c int[] := coalesce(string_to_array(nullif(ajuste('juego_correctas'), ''), ',')::int[], '{}');
begin
  return json_build_object(
    'pregunta', v_p, 'fase', v_f, 'desde', nullif(ajuste('juego_desde'), ''), 'ahora', now(),
    'conteo', case when v_f in ('revelada', 'final') then coalesce((select json_object_agg(opcion, n) from (
      select opcion, count(*) n from juego_respuestas where pregunta = v_p group by opcion) c), '{}'::json)
      else '{}'::json end,
    'total', (select count(*) from juego_respuestas where pregunta = v_p),
    'ranking', coalesce((select json_agg(r) from (
      select nombre, count(*) filter (where opcion = v_c[pregunta + 1]
               and (pregunta < v_p or (pregunta = v_p and v_f in ('revelada', 'final')))) puntos
      from juego_respuestas group by jugador, nombre order by puntos desc, min(created_at) limit 10) r), '[]'::json));
end $$;

-- Nombre para el juego: 2–24 caracteres, sin enlaces ni groserías (lista en ajustes).
create or replace function nombre_de_juego(p_nombre text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text := trim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g')); w text; s text;
begin
  if length(v) < 2 or length(v) > 24 then raise exception 'Tu nombre debe tener entre 2 y 24 letras'; end if;
  if v ~* '(https?:|www\.|\.(com|net|org|io|ly|me|co|xyz|app)\M|@)' then raise exception 'Elige otro nombre'; end if;
  s := sin_tildes(v);
  foreach w in array string_to_array(coalesce(ajuste('groserias'), ''), ',') loop
    w := sin_tildes(trim(w));
    if w <> '' and s ~ ('\m' || regexp_replace(w, '([^a-z0-9])', '\\\1', 'g') || '\M') then
      raise exception 'Elige otro nombre';
    end if;
  end loop;
  return v;
end $$;

-- Responder: con token del teléfono, dentro del tiempo (más 2 s de gracia).
create or replace function responder_juego(p_jugador uuid, p_nombre text, p_opcion int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_p int := coalesce(ajuste('juego_pregunta'), '-1')::int;
        v_desde timestamptz := nullif(ajuste('juego_desde'), '')::timestamptz;
        v_seg int := coalesce(nullif(ajuste('juego_segundos'), '')::int, 20);
        v_nombre text;
begin
  if coalesce(ajuste('juego_fase'), 'cerrado') <> 'abierta' or v_p < 0 then
    raise exception 'Esta pregunta ya cerró';
  end if;
  if v_desde is not null and now() > v_desde + make_interval(secs => v_seg + 2) then
    raise exception 'Se acabó el tiempo para esta pregunta';
  end if;
  if not dispositivo_valido(p_jugador) then raise exception 'Dispositivo desconocido. Vuelve a intentar.'; end if;
  if p_opcion is null or p_opcion not between 0 and 5 then raise exception 'Respuesta inválida'; end if;
  v_nombre := nombre_de_juego(p_nombre);
  insert into juego_respuestas (pregunta, jugador, nombre, opcion)
  values (v_p, p_jugador, v_nombre, p_opcion)
  on conflict (pregunta, jugador) do nothing;
  return true;
end $$;

-- ── Mantenimiento ───────────────────────────────────────────────────────────
-- Borra permisos vencidos y frenos viejos. NO borra archivos: borrar una fila de
-- storage.objects deja el archivo guardado (y Supabase lo impide en proyectos
-- nuevos). Los archivos huérfanos se borran con la API de almacenamiento:
-- `node scripts/limpiar-huerfanos.mjs` (usa huerfanos_album()).
create or replace function limpiar_vencidos() returns json
language plpgsql security definer set search_path = public as $$
declare n_sub int; n_fre int;
begin
  delete from subidas where (not usada and created_at < now() - interval '1 hour')
                         or created_at < now() - interval '2 days';
  get diagnostics n_sub = row_count;
  delete from frenos where created_at < now() - interval '1 day';
  get diagnostics n_fre = row_count;
  return json_build_object('subidas', n_sub, 'frenos', n_fre);
end $$;

-- Archivos del álbum sin foto ni mensaje que los use, con más de 1 hora.
create or replace function huerfanos_album(p_limite int default 500) returns setof text
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select o.name::text from storage.objects o
  where o.bucket_id = 'album' and o.created_at < now() - interval '1 hour'
    and (o.name like 'fotos/%' or o.name like 'voces/%')
    and not exists (select 1 from fotos f where f.ruta = o.name or f.miniatura = o.name)
    and not exists (select 1 from mensajes m where m.audio = o.name)
    and not exists (select 1 from subidas s where (s.ruta = o.name or s.miniatura = o.name)
                      and not s.usada and s.created_at > now() - interval '1 hour')
  order by o.created_at
  limit least(greatest(coalesce(p_limite, 500), 1), 1000);
end $$;

-- Datos personales: teléfono y notas de cada familia, restricciones de cada
-- persona, IP de los teléfonos, y lo mismo en la auditoría. Para correr a mano
-- unos 30 días después de la boda (NO está programada):
--   select purgar_datos_personales();
create or replace function purgar_datos_personales() returns json
language plpgsql security definer set search_path = public as $$
declare v_claims text := nullif(current_setting('request.jwt.claims', true), '');
        n_g int; n_p int; n_c int;
begin
  -- Sólo el panel, la service key o el SQL Editor (sin token).
  if not (es_admin() or v_claims is null or v_claims::json->>'role' = 'service_role') then
    raise exception 'Sólo los administradores pueden purgar datos';
  end if;
  update grupos set telefono = null, notas = null where telefono is not null or notas is not null;
  get diagnostics n_g = row_count;
  update personas set restriccion = null where restriccion is not null;
  get diagnostics n_p = row_count;
  update dispositivos set ip = null where ip is not null;
  delete from frenos;
  -- Al final: los disparadores de arriba acaban de anotar los valores viejos.
  update cambios set antes = antes - 'telefono' - 'notas' - 'restriccion',
                     despues = despues - 'telefono' - 'notas' - 'restriccion'
  where tabla in ('grupos', 'personas');
  get diagnostics n_c = row_count;
  return json_build_object('grupos', n_g, 'personas', n_p, 'auditoria', n_c);
end $$;

-- ── Permisos de ejecución ───────────────────────────────────────────────────
-- Todo cerrado, y se abre sólo lo que usa cada quien. (Supabase da EXECUTE a
-- anon por defecto en cada función nueva: por eso se revoca en cada corrida.)
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  invitacion(text), responder_invitacion(text, json, text, text), verificar_clave_album(text),
  emitir_token_dispositivo(), autorizar_subida(text, text), registrar_foto(text, text, text, int, int),
  buscar_mesa(text, text), listar_canciones(timestamptz),
  pedir_cancion(text, text, text, uuid, text, text, text), votar_cancion(uuid, uuid), mis_votos(uuid),
  autorizar_voz(text, text, text), firmar_libro(text, text, text, uuid),
  estado_juego(), responder_juego(uuid, text, int),
  -- Las usan las policies del almacenamiento, que se evalúan como el invitado.
  subida_autorizada(text), archivo_permitido(text, jsonb),
  sin_tildes(text)
  to anon, authenticated;
grant execute on function es_admin(), purgar_datos_personales() to authenticated;
grant execute on function limpiar_vencidos(), huerfanos_album(int), purgar_datos_personales() to service_role;

-- ── Storage ─────────────────────────────────────────────────────────────────
-- Bucket público del álbum. Al volver a correr se actualizan tamaño y tipos,
-- pero NO se toca `public`: si lo cambiaron a mano, se respeta.
-- El tope por archivo del bucket es el del video (60 MB); el de cada carpeta lo
-- aplican archivo_permitido() y las funciones de registro.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('album', 'album', true, 62914560,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime',
              'audio/webm','audio/mp4','audio/x-m4a','audio/aac','audio/ogg','audio/mpeg'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Bucket privado para las fotos ocultas: su enlace público deja de servirlas.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ocultas', 'ocultas', false, 62914560)
on conflict (id) do nothing;

-- Sólo se sube a una ruta que la base autorizó (ver autorizar_subida).
drop policy if exists album_subir on storage.objects;
create policy album_subir on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'album' and public.subida_autorizada(name) and public.archivo_permitido(name, metadata));

-- El panel lee, mueve y borra en los dos buckets.
drop policy if exists album_admin_borrar on storage.objects;
drop policy if exists album_admin on storage.objects;
create policy album_admin on storage.objects for all to authenticated
  using (bucket_id in ('album', 'ocultas') and (select public.es_admin()))
  with check (bucket_id in ('album', 'ocultas') and (select public.es_admin()));

-- ── Tiempo real ─────────────────────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table avisos;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table fotos;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ── Limpieza programada (sólo si pg_cron está activo) ───────────────────────
-- Database → Extensions → pg_cron para activarlo. Sin pg_cron no pasa nada: los
-- permisos y frenos viejos también se limpian solos de vez en cuando.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('boda-limpiar-vencidos', '*/15 * * * *', 'select public.limpiar_vencidos()');
  end if;
end $$;

-- ── ÚLTIMO PASO (a mano): registrar a los administradores ──────────────────
-- 1. Authentication → Users → «Add user» con su correo y contraseña.
-- 2. insert into admins (email) values ('correo-del-novio@ejemplo.com');
--    (el user_id se llena solo; el usuario tiene que existir ANTES)
-- 3. Authentication → Sign In / Providers → desactivar «Allow new users to sign up».
