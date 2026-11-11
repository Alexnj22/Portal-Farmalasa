import { createClient } from '@supabase/supabase-js';
import { prepararFoto, portadaDeVideo } from './imagen';
import { nuevoCodigo } from './codigo';

const URL_SB = import.meta.env.VITE_SUPABASE_URL;
const KEY_SB = import.meta.env.VITE_SUPABASE_ANON_KEY;
// En modo demo no hay proyecto: el cliente no se crea y este módulo no se usa.
const sb = URL_SB && KEY_SB ? createClient(URL_SB, KEY_SB) : null;

const ok = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

const urlPublica = (ruta) => sb.storage.from('album').getPublicUrl(ruta).data.publicUrl;
// `mini` es la miniatura (para mosaicos); sin ella, la grande.
const conUrl = (f) => ({ ...f, url: urlPublica(f.ruta), mini: f.miniatura ? urlPublica(f.miniatura) : urlPublica(f.ruta) });

// ── Invitados ──────────────────────────────────────────────────────────────
export const getInvitacion = async (codigo) => ok(await sb.rpc('invitacion', { p_codigo: codigo }));

export const responder = async (codigo, { personas, mensaje, cancion }) =>
  ok(await sb.rpc('responder_invitacion', {
    p_codigo: codigo, p_personas: personas, p_mensaje: mensaje, p_cancion: cancion,
  }));

export const verificarClaveAlbum = async (clave) =>
  ok(await sb.rpc('verificar_clave_album', { p_clave: clave }));

// ── Álbum ──────────────────────────────────────────────────────────────────
// El techo de PostgREST (1000 filas) no se rodea con un .limit grande: se pagina.
export async function listarFotos({ incluirOcultas = false } = {}) {
  const todas = [];
  for (let desde = 0; ; desde += 1000) {
    let q = sb.from('fotos').select('*').order('created_at', { ascending: false }).range(desde, desde + 999);
    if (!incluirOcultas) q = q.eq('oculta', false);
    const filas = ok(await q);
    todas.push(...filas);
    if (filas.length < 1000) break;
  }
  return todas.map(conUrl);
}

// Tres pasos: la base da el permiso (y la ruta), se suben archivo y miniatura,
// y la base registra la foto gastando el permiso. Ver autorizar_subida.
export async function subirFoto(file, { autor, momento, clave }) {
  const video = file.type.startsWith('video/');
  const p = video
    ? { blob: file, tipo: file.type, ext: (file.name.split('.').pop() || 'mp4').toLowerCase(), ...(await portadaDeVideo(file)) }
    : await prepararFoto(file);
  const permiso = ok(await sb.rpc('autorizar_subida', { p_clave: clave, p_ext: p.ext }));
  const bucket = sb.storage.from('album');
  ok(await bucket.upload(permiso.ruta, p.blob, { contentType: p.tipo, cacheControl: '31536000' }));
  if (p.miniatura) {
    // Si la miniatura falla no se pierde la foto: el álbum usa la grande.
    await bucket.upload(permiso.miniatura, p.miniatura, { contentType: 'image/jpeg', cacheControl: '31536000' }).catch(() => {});
  }
  ok(await sb.rpc('registrar_foto', {
    p_ruta: permiso.ruta, p_autor: autor, p_momento: momento,
    p_ancho: p.ancho ?? null, p_alto: p.alto ?? null,
  }));
}

export function suscribirFotos(alLlegar) {
  const canal = sb.channel('fotos-en-vivo')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fotos' },
      (p) => { if (!p.new.oculta) alLlegar(conUrl(p.new)); })
    .subscribe();
  return () => sb.removeChannel(canal);
}

// ── Libro de firmas ────────────────────────────────────────────────────────
export const listarMensajes = async ({ incluirOcultos = false } = {}) => {
  let q = sb.from('mensajes').select('*').order('created_at', { ascending: false }).range(0, 499);
  if (!incluirOcultos) q = q.eq('oculto', false);
  return ok(await q);
};
// Devuelve true si el mensaje ya se ve; false si espera aprobación.
// Con `audio` (Blob de la grabación): permiso → subida → firma, como las fotos.
export async function firmar({ autor, texto, audio }) {
  let ruta = null;
  if (audio) {
    const ext = extAudio(audio.type);
    ruta = ok(await sb.rpc('autorizar_voz', { p_ext: ext })).ruta;
    ok(await sb.storage.from('album').upload(ruta, audio, { contentType: audio.type || 'audio/webm', cacheControl: '31536000' }));
  }
  return ok(await sb.rpc('firmar_libro', { p_autor: autor, p_texto: texto, p_audio: ruta }));
}
const extAudio = (tipo = '') => (/mp4|m4a|aac/.test(tipo) ? 'm4a' : /ogg/.test(tipo) ? 'ogg' : /mpeg|mp3/.test(tipo) ? 'mp3' : 'webm');
export const urlAudio = (ruta) => (ruta ? urlPublica(ruta) : null);

// ── Admin ──────────────────────────────────────────────────────────────────
export async function login(email, password) {
  ok(await sb.auth.signInWithPassword({ email, password }));
  if (!ok(await sb.rpc('es_admin'))) {
    await sb.auth.signOut();
    throw new Error('Esta cuenta no es administradora de la boda.');
  }
}
export const logout = () => sb.auth.signOut();
export async function sesion() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  return ok(await sb.rpc('es_admin')) ? data.session.user.email : null;
}

export async function listarGrupos() {
  const grupos = [];
  for (let desde = 0; ; desde += 1000) {
    const filas = ok(await sb.from('grupos').select('*, personas(*)').order('created_at').range(desde, desde + 999));
    grupos.push(...filas);
    if (filas.length < 1000) break;
  }
  grupos.forEach((g) => g.personas.sort((a, b) => a.created_at.localeCompare(b.created_at)));
  return grupos;
}

// Un upsert parcial choca con los NOT NULL (Postgres arma la fila completa
// antes de decidir que es un UPDATE): con id se actualiza, sin id se inserta.
async function guardar(tabla, { id, ...cambios }, alCrear = {}) {
  const q = id
    ? sb.from(tabla).update(cambios).eq('id', id)
    : sb.from(tabla).insert({ ...alCrear, ...cambios });
  return ok(await q.select().single());
}

// eslint-disable-next-line no-unused-vars
export const guardarGrupo = ({ personas, ...g }) => guardar('grupos', g, { codigo: nuevoCodigo() });
export const borrarGrupo = async (id) => ok(await sb.from('grupos').delete().eq('id', id));
export const actualizarGrupo = async (id, cambios) => ok(await sb.from('grupos').update(cambios).eq('id', id));

export const guardarPersona = (p) => guardar('personas', p);
export const borrarPersona = async (id) => ok(await sb.from('personas').delete().eq('id', id));
export const asignarMesa = async (personaId, mesaId) =>
  ok(await sb.from('personas').update({ mesa_id: mesaId }).eq('id', personaId));

export const listarMesas = async () => ok(await sb.from('mesas').select('*').order('created_at'));
export const guardarMesa = (m) => guardar('mesas', m);
export const borrarMesa = async (id) => ok(await sb.from('mesas').delete().eq('id', id));

export const ocultarFoto = async (id, oculta) => ok(await sb.from('fotos').update({ oculta }).eq('id', id));
export async function borrarFoto(foto) {
  ok(await sb.storage.from('album').remove([foto.ruta, ...(foto.miniatura ? [foto.miniatura] : [])]));
  ok(await sb.from('fotos').delete().eq('id', foto.id));
}
export const ocultarMensaje = async (id, oculto) => ok(await sb.from('mensajes').update({ oculto }).eq('id', id));

export async function leerClaveAlbum() {
  return ok(await sb.from('ajustes').select('valor').eq('clave', 'clave_album').maybeSingle())?.valor ?? '';
}
export const cambiarClaveAlbum = async (valor) =>
  ok(await sb.from('ajustes').upsert({ clave: 'clave_album', valor: valor.toUpperCase().trim() }));

// Ajustes que la base hace cumplir (fecha límite, moderación…).
export async function leerAjustes() {
  const filas = ok(await sb.from('ajustes').select('clave, valor'));
  return Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
}
export const guardarAjuste = async (clave, valor) => ok(await sb.from('ajustes').upsert({ clave, valor: String(valor) }));

// Entrada: marca (o desmarca) que la familia ya llegó.
export const registrarLlegada = async (grupoId, llego) =>
  ok(await sb.from('grupos').update({ llegada_at: llego ? new Date().toISOString() : null }).eq('id', grupoId));

export const reiniciarDemo = () => {};

// Para la entrada: el grupo por su código, con quiénes confirmaron y su mesa.
export async function grupoPorCodigo(codigo) {
  const g = ok(await sb.from('grupos')
    .select('id, nombre, pases, llegada_at, personas(nombre, asistira, mesas(nombre))')
    .eq('codigo', codigo.trim().toUpperCase()).maybeSingle());
  if (!g) return null;
  return { ...g, personas: g.personas.map((p) => ({ nombre: p.nombre, asistira: p.asistira, mesa: p.mesas?.nombre ?? null })) };
}

// ── El día en vivo ─────────────────────────────────────────────────────────
export const listarAvisos = async () => ok(await sb.from('avisos').select('*').order('created_at', { ascending: false }).range(0, 19));
export const publicarAviso = async (texto) => ok(await sb.from('avisos').insert({ texto: texto.trim().slice(0, 280) }));
export const borrarAviso = async (id) => ok(await sb.from('avisos').delete().eq('id', id));
export function suscribirAvisos(alLlegar) {
  const canal = sb.channel('avisos-en-vivo')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'avisos' }, () => alLlegar())
    .subscribe();
  return () => sb.removeChannel(canal);
}
export const buscarMesa = async (clave, nombre) => ok(await sb.rpc('buscar_mesa', { p_clave: clave, p_nombre: nombre }));

// ── Canciones ──────────────────────────────────────────────────────────────
export const listarCanciones = async () =>
  ok(await sb.from('canciones').select('*').order('votos', { ascending: false }).order('created_at').range(0, 499));
export const pedirCancion = async ({ titulo, artista, nombre }, votante) =>
  ok(await sb.rpc('pedir_cancion', { p_titulo: titulo, p_artista: artista, p_nombre: nombre, p_votante: votante }));
export const votarCancion = async (id, votante) => ok(await sb.rpc('votar_cancion', { p_id: id, p_votante: votante }));
export const misVotos = async (votante) => ok(await sb.rpc('mis_votos', { p_votante: votante }));
export const marcarCancion = async (id, cambios) => ok(await sb.from('canciones').update(cambios).eq('id', id));
export function suscribirCanciones(alCambiar) {
  const t = setInterval(alCambiar, 5000);
  return () => clearInterval(t);
}

// ── Juego ──────────────────────────────────────────────────────────────────
export const estadoJuego = async () => ok(await sb.rpc('estado_juego'));
export const responderJuego = async (jugador, nombre, opcion) =>
  ok(await sb.rpc('responder_juego', { p_jugador: jugador, p_nombre: nombre, p_opcion: opcion }));
export async function controlarJuego({ pregunta, fase }) {
  ok(await sb.from('ajustes').upsert([{ clave: 'juego_pregunta', valor: String(pregunta) }, { clave: 'juego_fase', valor: fase }]));
}
export const reiniciarJuego = async () => {
  ok(await sb.from('juego_respuestas').delete().gte('pregunta', -1));
  await controlarJuego({ pregunta: -1, fase: 'cerrado' });
};
export function suscribirJuego(alCambiar) {
  const t = setInterval(alCambiar, 2000);
  return () => clearInterval(t);
}
