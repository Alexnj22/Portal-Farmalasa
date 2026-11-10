import { createClient } from '@supabase/supabase-js';
import { comprimirImagen } from './imagen';
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
const conUrl = (f) => ({ ...f, url: urlPublica(f.ruta) });

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

export async function subirFoto(file, { autor, momento, clave }) {
  const video = file.type.startsWith('video/');
  const { blob, ancho, alto } = video ? { blob: file } : await comprimirImagen(file);
  const ext = video ? (file.name.split('.').pop() || 'mp4').toLowerCase() : 'jpg';
  const ruta = `fotos/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  ok(await sb.storage.from('album').upload(ruta, blob, {
    contentType: video ? file.type : 'image/jpeg', cacheControl: '31536000',
  }));
  ok(await sb.rpc('registrar_foto', {
    p_clave: clave, p_ruta: ruta, p_autor: autor, p_momento: momento,
    p_ancho: ancho ?? null, p_alto: alto ?? null,
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
export const firmar = async ({ autor, texto }) => ok(await sb.rpc('firmar_libro', { p_autor: autor, p_texto: texto }));

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
  ok(await sb.storage.from('album').remove([foto.ruta]));
  ok(await sb.from('fotos').delete().eq('id', foto.id));
}
export const ocultarMensaje = async (id, oculto) => ok(await sb.from('mensajes').update({ oculto }).eq('id', id));

export async function leerClaveAlbum() {
  return ok(await sb.from('ajustes').select('valor').eq('clave', 'clave_album').maybeSingle())?.valor ?? '';
}
export const cambiarClaveAlbum = async (valor) =>
  ok(await sb.from('ajustes').upsert({ clave: 'clave_album', valor: valor.toUpperCase().trim() }));

export const reiniciarDemo = () => {};
