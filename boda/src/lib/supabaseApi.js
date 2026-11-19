import { createClient } from '@supabase/supabase-js';
import { prepararFoto, portadaDeVideo } from './imagen';
import { nuevoCodigo } from './codigo';
import { tokenGuardado, guardarToken } from './yo';

const URL_SB = import.meta.env.VITE_SUPABASE_URL;
const KEY_SB = import.meta.env.VITE_SUPABASE_ANON_KEY;
// En modo demo no hay proyecto: el cliente no se crea y este módulo no se usa.
const sb = URL_SB && KEY_SB ? createClient(URL_SB, KEY_SB) : null;

const ok = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};
// Las funciones que anotan un intento fallido (clave o código malos) no pueden
// lanzar un error —deshacería la anotación—: devuelven { error } y acá se lanza.
const okSinError = (r) => {
  const data = ok(r);
  if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string') {
    throw new Error(data.error);
  }
  return data;
};
const leerLS = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const guardarLS = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* privado */ } };
// Subir un archivo que ya está (la respuesta del primer intento se perdió) no es un error.
const yaExiste = (error) => /exists|duplicate/i.test(error?.message || '') || String(error?.statusCode) === '409';

// Columnas explícitas: nada de select('*').
const COLS = {
  fotos: 'id, ruta, miniatura, autor, momento, ancho, alto, oculta, privada, created_at',
  mensajes: 'id, autor, texto, audio, oculto, created_at',
  grupos: 'id, codigo, nombre, pases, lado, telefono, etiqueta, notas, estado, mensaje, cancion, respondido_at, '
    + 'std_enviado_at, invitacion_enviada_at, abierta_at, llegada_at, letra_grande, created_at',
  personas: 'id, grupo_id, nombre, es_nino, asistira, restriccion, mesa_id, agregado_por_invitado, created_at',
  mesas: 'id, nombre, capacidad, forma, x, y, created_at',
  avisos: 'id, texto, created_at',
};
const PAGINA = 500; // menor que el techo de 1000 filas de PostgREST

const urlPublica = (ruta) => sb.storage.from('album').getPublicUrl(ruta).data.publicUrl;
// `mini` es la miniatura (para mosaicos); sin ella, la grande.
const conUrl = (f) => ({ ...f, url: urlPublica(f.ruta), mini: f.miniatura ? urlPublica(f.miniatura) : urlPublica(f.ruta) });

// Las fotos ocultas viven en el bucket privado «ocultas»: el panel las ve con
// enlaces firmados de 1 hora.
async function conUrlFirmada(fotos) {
  const rutas = fotos.flatMap((f) => [f.ruta, f.miniatura].filter(Boolean));
  if (!rutas.length) return fotos;
  const firmadas = ok(await sb.storage.from('ocultas').createSignedUrls(rutas, 3600));
  const url = Object.fromEntries(firmadas.filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
  return fotos.map((f) => ({ ...f, url: url[f.ruta] ?? null, mini: url[f.miniatura] ?? url[f.ruta] ?? null }));
}

// Recorre una tabla por cursor (created_at, id) descendente: sin offset (que se
// corre si entra una fila nueva mientras se pagina) y sin tope silencioso.
async function todasPorCursor(tabla, filtrar) {
  const todas = [];
  let ultimo = null;
  for (;;) {
    let q = sb.from(tabla).select(COLS[tabla])
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(PAGINA);
    if (filtrar) q = filtrar(q);
    if (ultimo) {
      q = q.or(`created_at.lt."${ultimo.created_at}",and(created_at.eq."${ultimo.created_at}",id.lt.${ultimo.id})`);
    }
    const filas = ok(await q);
    todas.push(...filas);
    if (filas.length < PAGINA) return todas;
    ultimo = filas[filas.length - 1];
  }
}

// ── Token del teléfono ─────────────────────────────────────────────────────
// Votar canciones, jugar y firmar exigen un token que emite la base
// (emitir_token_dispositivo). El parámetro `votante`/`jugador` que pasan las
// páginas se ignora acá: manda el token. Si la base no lo reconoce (se borró o
// es de otro proyecto), se pide uno nuevo y se reintenta una vez.
let token = null;
let pidiendoToken = null;
async function miToken(renovar = false) {
  if (!renovar) {
    token ||= tokenGuardado();
    if (token) return token;
  }
  pidiendoToken ||= sb.rpc('emitir_token_dispositivo').then(ok)
    .then((t) => { token = t; guardarToken(t); return t; })
    .finally(() => { pidiendoToken = null; });
  return pidiendoToken;
}
async function conToken(fn) {
  try {
    return await fn(await miToken());
  } catch (e) {
    if (!/Dispositivo desconocido/i.test(e.message)) throw e;
    return fn(await miToken(true));
  }
}

// ── Invitados ──────────────────────────────────────────────────────────────
export const getInvitacion = async (codigo) => ok(await sb.rpc('invitacion', { p_codigo: codigo }));

// Cada acompañante nuevo lleva un id generado acá y estable por (código, nombre)
// mientras dure la página: si la respuesta se pierde y se reintenta, la base
// reconoce el id y no lo agrega dos veces.
const idsNuevos = new Map();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    return (c === 'x' ? r : (r % 4) + 8).toString(16);
  }));
function conIdEstable(codigo, p) {
  if (p.id || p.quitar || !p.nombre?.trim()) return p;
  const k = `${codigo.trim().toUpperCase()}|${p.nombre.trim().toLowerCase()}`;
  if (!idsNuevos.has(k)) idsNuevos.set(k, uuid());
  return { ...p, id: idsNuevos.get(k) };
}

export const responder = async (codigo, { personas, mensaje, cancion }) =>
  okSinError(await sb.rpc('responder_invitacion', {
    p_codigo: codigo, p_personas: personas.map((p) => conIdEstable(codigo, p)), p_mensaje: mensaje, p_cancion: cancion,
  }));

export const verificarClaveAlbum = async (clave) =>
  ok(await sb.rpc('verificar_clave_album', { p_clave: clave }));

// ── Álbum ──────────────────────────────────────────────────────────────────
export async function listarFotos({ incluirOcultas = false } = {}) {
  const filas = await todasPorCursor('fotos', incluirOcultas ? null : (q) => q.eq('oculta', false));
  const privadas = filas.filter((f) => f.privada);
  const firmadas = privadas.length ? await conUrlFirmada(privadas) : [];
  const porId = Object.fromEntries(firmadas.map((f) => [f.id, f]));
  return filas.map((f) => porId[f.id] ?? conUrl(f));
}

// Tres pasos: la base da el permiso (y la ruta), se suben archivo y miniatura,
// y la base registra la foto gastando el permiso. Ver autorizar_subida.
//
// Reanudable: un reintento con el MISMO archivo (o con el mismo `id` de la cola
// de subidas, aunque se haya recargado la página) conserva el permiso y salta lo
// que ya se hizo; registrar_foto devuelve la foto existente si ya se registró.
// Devuelve el id de la foto.
const subidasEnCurso = new WeakMap();
const LS_SUBIDA = 'boda-subida-';
export async function subirFoto(file, { autor, momento, clave, id } = {}) {
  let st = subidasEnCurso.get(file);
  if (!st) {
    st = {};
    if (id) { try { Object.assign(st, JSON.parse(leerLS(LS_SUBIDA + id) || '{}')); } catch { /* roto: se empieza de nuevo */ } }
    subidasEnCurso.set(file, st);
  }
  const recordar = () => {
    if (id) guardarLS(LS_SUBIDA + id, JSON.stringify({ permiso: st.permiso, pedido: st.pedido, principal: st.principal, mini: st.mini }));
  };

  const video = file.type.startsWith('video/');
  if (!st.p) {
    st.p = video
      ? { blob: file, tipo: file.type, ext: (file.name.split('.').pop() || 'mp4').toLowerCase(), ...(await portadaDeVideo(file)) }
      : await prepararFoto(file);
  }
  const p = st.p;
  // El permiso vale 30 minutos para SUBIR; si el archivo ya subió, sirve para registrar.
  if (!st.permiso || (!st.principal && Date.now() - st.pedido > 25 * 60e3)) {
    st.permiso = okSinError(await sb.rpc('autorizar_subida', { p_clave: clave, p_ext: p.ext }));
    st.pedido = Date.now(); st.principal = false; st.mini = false;
    recordar();
  }
  const bucket = sb.storage.from('album');
  if (!st.principal) {
    const { error } = await bucket.upload(st.permiso.ruta, p.blob, { contentType: p.tipo, cacheControl: '31536000' });
    if (error && !yaExiste(error)) {
      st.permiso = null; // puede haber vencido: el próximo intento pide otro
      recordar();
      throw new Error(error.message);
    }
    st.principal = true; recordar();
  }
  if (p.miniatura && !st.mini) {
    // Si la miniatura falla no se pierde la foto: el álbum usa la grande.
    const { error } = await bucket.upload(st.permiso.miniatura, p.miniatura, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (error && !yaExiste(error)) console.warn('La miniatura no subió; el álbum usará la foto grande.', error.message);
    st.mini = true; recordar();
  }
  const fotoId = ok(await sb.rpc('registrar_foto', {
    p_ruta: st.permiso.ruta, p_autor: autor, p_momento: momento,
    p_ancho: p.ancho ?? null, p_alto: p.alto ?? null,
  }));
  subidasEnCurso.delete(file);
  if (id) guardarLS(LS_SUBIDA + id, null);
  return fotoId;
}

export function suscribirFotos(alLlegar) {
  const canal = sb.channel('fotos-en-vivo')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fotos' },
      (p) => { if (!p.new.oculta) alLlegar(conUrl(p.new)); })
    .subscribe();
  return () => sb.removeChannel(canal);
}

// ── Libro de firmas ────────────────────────────────────────────────────────
export const listarMensajes = async ({ incluirOcultos = false } = {}) =>
  todasPorCursor('mensajes', incluirOcultos ? null : (q) => q.eq('oculto', false));

// Devuelve true si el mensaje ya se ve; false si espera aprobación.
// Con `audio` (Blob de la grabación): permiso → subida → firma, como las fotos.
// La voz exige la clave del álbum o el código de la invitación; si la página no
// los pasa, se usan los que este teléfono ya recuerda.
export async function firmar({ autor, texto, audio, clave, codigo }) {
  let ruta = null;
  if (audio) {
    const ext = extAudio(audio.type);
    ruta = okSinError(await sb.rpc('autorizar_voz', {
      p_ext: ext,
      p_clave: clave || leerLS('boda-clave-album') || null,
      p_codigo: codigo || leerLS('boda-codigo') || null,
    })).ruta;
    ok(await sb.storage.from('album').upload(ruta, audio, { contentType: audio.type || 'audio/webm', cacheControl: '31536000' }));
  }
  return conToken(async (t) => ok(await sb.rpc('firmar_libro', {
    p_autor: autor, p_texto: texto, p_audio: ruta, p_dispositivo: t,
  })));
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
  reiniciarCanciones();
}
export const logout = async () => {
  const { error } = await sb.auth.signOut();
  reiniciarCanciones();
  if (error) throw new Error(error.message);
};
export async function sesion() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw new Error(error.message);
  if (!data.session) return null;
  return ok(await sb.rpc('es_admin')) ? data.session.user.email : null;
}

export async function listarGrupos() {
  const grupos = [];
  for (let desde = 0; ; desde += PAGINA) {
    const filas = ok(await sb.from('grupos').select(`${COLS.grupos}, personas(${COLS.personas})`)
      .order('created_at').order('id').range(desde, desde + PAGINA - 1));
    grupos.push(...filas);
    if (filas.length < PAGINA) break;
  }
  grupos.forEach((g) => g.personas.sort((a, b) => a.created_at.localeCompare(b.created_at)));
  return grupos;
}

// Un upsert parcial choca con los NOT NULL (Postgres arma la fila completa
// antes de decidir que es un UPDATE): con id se actualiza, sin id se inserta.
// Una fila nueva lleva su id generado acá: si la respuesta se pierde y el
// panel reintenta, el segundo insert choca con la clave y no la duplica.
async function guardar(tabla, { id, ...cambios }, alCrear = {}) {
  if (id) return ok(await sb.from(tabla).update(cambios).eq('id', id).select(COLS[tabla]).single());
  const fila = { id: uuid(), ...alCrear, ...cambios };
  const { data, error } = await sb.from(tabla).insert(fila).select(COLS[tabla]).single();
  if (!error) return data;
  if (String(error.code) === '23505') {
    const ya = ok(await sb.from(tabla).select(COLS[tabla]).eq('id', fila.id).maybeSingle());
    if (ya) return ya;
  }
  throw new Error(error.message);
}

// eslint-disable-next-line no-unused-vars
export const guardarGrupo = ({ personas, ...g }) => guardar('grupos', g, { codigo: nuevoCodigo() });
export const borrarGrupo = async (id) => ok(await sb.from('grupos').delete().eq('id', id));
export const actualizarGrupo = async (id, cambios) => ok(await sb.from('grupos').update(cambios).eq('id', id));

export const guardarPersona = (p) => guardar('personas', p);
export const borrarPersona = async (id) => ok(await sb.from('personas').delete().eq('id', id));
export const asignarMesa = async (personaId, mesaId) =>
  ok(await sb.from('personas').update({ mesa_id: mesaId }).eq('id', personaId));

export const listarMesas = async () => ok(await sb.from('mesas').select(COLS.mesas).order('created_at').order('id').range(0, PAGINA - 1));
export const guardarMesa = (m) => guardar('mesas', m);
export const borrarMesa = async (id) => ok(await sb.from('mesas').delete().eq('id', id));

// Ocultar una foto: primero deja de listarse (al instante) y después su archivo
// se mueve al bucket privado «ocultas», para que el enlace público ya no la
// sirva. Mostrarla hace el camino inverso. Mover lo que ya se movió no falla.
// (Un enlace que ya estaba en la caché de la CDN puede seguir sirviéndose un rato.)
async function moverArchivos(foto, haciaPrivado) {
  const [de, a] = haciaPrivado ? ['album', 'ocultas'] : ['ocultas', 'album'];
  for (const ruta of [foto.ruta, foto.miniatura].filter(Boolean)) {
    const { error } = await sb.storage.from(de).move(ruta, ruta, { destinationBucket: a });
    if (error && !/not.?found|no existe/i.test(error.message)) throw new Error(error.message);
  }
}
export async function ocultarFoto(id, oculta) {
  const foto = ok(await sb.from('fotos').select('id, ruta, miniatura, privada').eq('id', id).single());
  if (oculta) {
    ok(await sb.from('fotos').update({ oculta: true }).eq('id', id));
    try {
      await moverArchivos(foto, true);
    } catch (e) {
      throw new Error(`La foto ya no aparece en el álbum, pero su archivo sigue en la carpeta pública: ${e.message}`);
    }
    ok(await sb.from('fotos').update({ privada: true }).eq('id', id));
  } else {
    await moverArchivos(foto, false);
    ok(await sb.from('fotos').update({ oculta: false, privada: false }).eq('id', id));
  }
}
export async function borrarFoto(foto) {
  const rutas = [foto.ruta, ...(foto.miniatura ? [foto.miniatura] : [])];
  // En los dos buckets: si una mudanza quedó a medias, no queda nada colgado.
  ok(await sb.storage.from('album').remove(rutas));
  ok(await sb.storage.from('ocultas').remove(rutas));
  ok(await sb.from('fotos').delete().eq('id', foto.id));
}
export const ocultarMensaje = async (id, oculto) => ok(await sb.from('mensajes').update({ oculto }).eq('id', id));

export async function leerClaveAlbum() {
  return ok(await sb.from('ajustes').select('valor').eq('clave', 'clave_album').maybeSingle())?.valor ?? '';
}
// La base la guarda en mayúsculas y exige al menos 6 caracteres.
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
// Avisos: mientras haya una suscripción viva, la lista se mantiene con lo que
// trae cada evento de tiempo real (sin volver a pedirla). listarAvisos()
// devuelve esa copia; sin suscripción, la pide a la base.
let avisos = null;        // copia viva (null = no hay)
let canalAvisos = null;
const oyentesAvisos = new Set();
const avisarAvisos = () => oyentesAvisos.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
const pedirAvisos = async () =>
  ok(await sb.from('avisos').select(COLS.avisos).order('created_at', { ascending: false }).range(0, 19));
const ponerAviso = (a) => { if (avisos) avisos = [a, ...avisos.filter((x) => x.id !== a.id)].slice(0, 20); };

export const listarAvisos = async () => (avisos ? avisos.map((a) => ({ ...a })) : pedirAvisos());
export async function publicarAviso(texto) {
  const a = ok(await sb.from('avisos').insert({ texto: texto.trim().slice(0, 280) }).select(COLS.avisos).single());
  ponerAviso(a);
  return a;
}
export async function borrarAviso(id) {
  ok(await sb.from('avisos').delete().eq('id', id));
  if (avisos) avisos = avisos.filter((a) => a.id !== id);
}
export function suscribirAvisos(alCambiar) {
  oyentesAvisos.add(alCambiar);
  if (!canalAvisos) {
    canalAvisos = sb.channel('avisos-en-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'avisos' }, (p) => {
        if (avisos) {
          if (p.eventType === 'DELETE') avisos = avisos.filter((a) => a.id !== p.old?.id);
          else if (p.new?.id) ponerAviso({ id: p.new.id, texto: p.new.texto, created_at: p.new.created_at });
        }
        avisarAvisos();
      })
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') {
          // Una lectura al conectar (y al reconectar): lo que llegó mientras no había canal.
          pedirAvisos().then((filas) => { avisos = filas; avisarAvisos(); })
            .catch((e) => console.error('Avisos', e));
        } else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') {
          avisos = null; // sin canal, la copia envejece: se vuelve a pedir
        }
      });
  }
  return () => {
    oyentesAvisos.delete(alCambiar);
    if (!oyentesAvisos.size && canalAvisos) {
      sb.removeChannel(canalAvisos);
      canalAvisos = null; avisos = null;
    }
  };
}
export async function buscarMesa(clave, nombre) {
  return okSinError(await sb.rpc('buscar_mesa', { p_clave: clave, p_nombre: nombre }));
}

// ── Canciones ──────────────────────────────────────────────────────────────
// listar_canciones(p_desde) devuelve sólo lo que cambió desde el último sello:
// cada consulta cada 5 s trae casi nada. La lista completa vive acá.
const canciones = new Map();
let selloCanciones = null;
function reiniciarCanciones() { canciones.clear(); selloCanciones = null; }
const ordenCanciones = (a, b) => b.votos - a.votos || a.created_at.localeCompare(b.created_at);
export async function listarCanciones() {
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    const r = ok(await sb.rpc('listar_canciones', { p_desde: selloCanciones }));
    if (!selloCanciones) canciones.clear();
    for (const c of r.filas) {
      if (c.titulo === undefined) canciones.delete(c.id); // oculta: llega sólo el id
      else canciones.set(c.id, c);
    }
    selloCanciones = r.sello;
    if (canciones.size === r.total) break;
    reiniciarCanciones(); // alguna se borró: se pide la lista entera una vez
  }
  return [...canciones.values()].map((c) => ({ ...c })).sort(ordenCanciones);
}
export const pedirCancion = async ({ titulo, artista, nombre, portada, enlace, muestra }) =>
  conToken(async (t) => ok(await sb.rpc('pedir_cancion', {
    p_titulo: titulo, p_artista: artista, p_nombre: nombre, p_votante: t,
    p_portada: portada ?? null, p_enlace: enlace ?? null, p_muestra: muestra ?? null,
  })));
export const votarCancion = async (id) => conToken(async (t) => ok(await sb.rpc('votar_cancion', { p_id: id, p_votante: t })));
export const misVotos = async () => ok(await sb.rpc('mis_votos', { p_votante: await miToken() }));
export const marcarCancion = async (id, cambios) => ok(await sb.from('canciones').update(cambios).eq('id', id));
export function suscribirCanciones(alCambiar) {
  const t = setInterval(alCambiar, 5000);
  return () => clearInterval(t);
}

// ── Juego ──────────────────────────────────────────────────────────────────
export const estadoJuego = async () => ok(await sb.rpc('estado_juego'));
export const responderJuego = async (_jugador, nombre, opcion) =>
  conToken(async (t) => ok(await sb.rpc('responder_juego', { p_jugador: t, p_nombre: nombre, p_opcion: opcion })));
export async function controlarJuego({ pregunta, fase }) {
  const filas = [{ clave: 'juego_pregunta', valor: String(pregunta) }, { clave: 'juego_fase', valor: fase }];
  if (fase === 'abierta') filas.push({ clave: 'juego_desde', valor: new Date().toISOString() });
  ok(await sb.from('ajustes').upsert(filas));
}
export const reiniciarJuego = async () => {
  ok(await sb.from('juego_respuestas').delete().gte('pregunta', -1));
  await controlarJuego({ pregunta: -1, fase: 'cerrado' });
};
export function suscribirJuego(alCambiar) {
  const t = setInterval(alCambiar, 2000);
  return () => clearInterval(t);
}
