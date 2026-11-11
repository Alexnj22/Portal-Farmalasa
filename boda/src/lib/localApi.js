// MODO DEMO: misma interfaz que supabaseApi, guardado en localStorage. Sirve
// para ver y probar el sitio completo sin crear nada. Nada sale del navegador.
import { comprimirImagen, blobADataUrl } from './imagen';
import { boda } from '../config';
import { ahora as reloj } from './reloj';
import { nuevoCodigo } from './codigo';

const CLAVE = 'boda-demo-v2';
// randomUUID sólo existe en https o localhost; abierto desde el teléfono por la
// red de la casa (http://192.168…) no está, y la demo no puede depender de eso.
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    return (c === 'x' ? r : (r % 4) + 8).toString(16);
  }));
const ahora = () => new Date().toISOString();

// Invitaciones de prueba: cada una cubre un caso del flujo de confirmación.
// El panel de pruebas las lista con su descripción (ESCENARIOS).
export const ESCENARIOS = [
  { codigo: 'DEMO01', caso: 'Familia de 4 pases con 3 nombres: confirmar a algunos y agregar un acompañante.' },
  { codigo: 'DEMO02', caso: 'Una sola persona, 1 pase.' },
  { codigo: 'DEMO03', caso: 'Pareja que ya confirmó y tiene mesa: ver la respuesta y cambiarla.' },
  { codigo: 'DEMO04', caso: 'Familia con un niño: confirmar menos personas que pases.' },
  { codigo: 'DEMO05', caso: 'Invitada con «+1» sin nombre: escribir a su acompañante.' },
  { codigo: 'DEMO06', caso: 'Familia que ya dijo que no puede ir.' },
  { codigo: 'DEMO07', caso: 'Invitación de 2 pases sin ningún nombre cargado.' },
  { codigo: 'DEMO08', caso: 'Abuela marcada con «letra grande»: se abre sola en modo fácil.' },
];

function semilla() {
  const mesas = [
    { id: uid(), nombre: 'Mesa principal', capacidad: 12, forma: 'rectangular', x: 50, y: 14 },
    ...[1, 2, 3, 4, 5, 6].map((n, i) => ({
      id: uid(), nombre: `Mesa ${n}`, capacidad: 10, forma: 'redonda',
      x: 18 + (i % 3) * 32, y: 45 + Math.floor(i / 3) * 32,
    })),
  ].map((m) => ({ ...m, created_at: ahora() }));
  const g = (codigo, nombre, pases, lado, nombres, extra = {}) => {
    const id = uid();
    return {
      grupo: { id, codigo, nombre, pases, lado, telefono: '', etiqueta: '', notas: '', estado: 'pendiente',
        mensaje: null, cancion: null, respondido_at: null, std_enviado_at: null, invitacion_enviada_at: null,
        abierta_at: null, llegada_at: null, created_at: ahora(), ...extra },
      personas: nombres.map((n) => {
        const [nombre, nino] = Array.isArray(n) ? n : [n, false];
        return { id: uid(), grupo_id: id, nombre, es_nino: nino, asistira: null, restriccion: null, mesa_id: null,
          agregado_por_invitado: false, created_at: ahora() };
      }),
    };
  };
  const lista = [
    g('DEMO01', 'Familia Martínez', 4, 'novio', ['Carlos Martínez', 'Ana de Martínez', 'Sofía Martínez']),
    g('DEMO02', 'Tía Rosa', 1, 'novia', ['Rosa Hernández']),
    g('DEMO03', 'Luis y Andrea', 2, 'ambos', ['Luis Pérez', 'Andrea López']),
    g('DEMO04', 'Familia Rivera', 3, 'novia', ['Jorge Rivera', 'Marta de Rivera', ['Diego Rivera', true]]),
    g('DEMO05', 'Carla Méndez', 2, 'novia', ['Carla Méndez']),
    g('DEMO06', 'Familia López', 2, 'novio', ['Pedro López', 'Elena de López']),
    g('DEMO07', 'Los Castillo', 2, 'ambos', []),
    g('DEMO08', 'Abuelita Carmen', 2, 'novia', ['Carmen de Hernández'], { letra_grande: true }),
  ];
  // DEMO03: ya respondida, con mesa
  lista[2].grupo.estado = 'confirmado';
  lista[2].grupo.respondido_at = ahora();
  lista[2].grupo.cancion = 'Vivir mi vida – Marc Anthony';
  lista[2].personas.forEach((p) => { p.asistira = true; p.mesa_id = mesas[1].id; });
  lista[2].personas[1].restriccion = 'Vegetariana';
  // DEMO06: no asisten
  lista[5].grupo.estado = 'declinado';
  lista[5].grupo.respondido_at = ahora();
  lista[5].personas.forEach((p) => { p.asistira = false; });
  return {
    claveAlbum: 'BODA27',
    ajustes: { moderar_mensajes: 'no' },
    mesas,
    grupos: lista.map((x) => x.grupo),
    personas: lista.flatMap((x) => x.personas),
    fotos: fotosDeMuestra(),
    mensajes: [
      { id: uid(), autor: 'Andrea', texto: '¡Los queremos mucho! Que sea el inicio de una vida llena de amor.', oculto: false, created_at: ahora() },
    ],
    avisos: [],
    canciones: [
      { id: uid(), titulo: 'Vivir mi vida', artista: 'Marc Anthony', pedido_por: 'Luis', votos: 3, tocada: false, oculta: false, created_at: ahora(), votantes: ['a', 'b', 'c'] },
      { id: uid(), titulo: 'La bicicleta', artista: 'Carlos Vives y Shakira', pedido_por: 'Andrea', votos: 2, tocada: false, oculta: false, created_at: ahora(), votantes: ['a', 'b'] },
      { id: uid(), titulo: 'Perfect', artista: 'Ed Sheeran', pedido_por: null, votos: 1, tocada: false, oculta: false, created_at: ahora(), votantes: ['a'] },
    ],
    juego: { pregunta: -1, fase: 'cerrado', respuestas: [] },
    fotosMuestra: true,
  };
}

// Fotos de ejemplo para que el álbum, la pantalla y la presentación no estén vacíos.
function fotosDeMuestra() {
  const autores = ['Andrea', 'Luis', 'Tía Rosa', 'Marta', 'Carlos', 'Sofía'];
  return (boda.galeria || []).map((g, i) => {
    const src = typeof g === 'string' ? g : g.src;
    return { id: `muestra-${i}`, ruta: `muestra/${i}.jpg`, url: src, mini: src.replace(/w=\d+/, 'w=600'),
      autor: autores[i % autores.length], momento: boda.momentos[i % boda.momentos.length], oculta: false,
      created_at: new Date(Date.now() - (i + 1) * 6e5).toISOString() };
  });
}

function leer() {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE));
    // Demo guardada antes de que existieran estas partes: se completan.
    if (s) {
      const c = { avisos: [], canciones: [], juego: { pregunta: -1, fase: 'cerrado', respuestas: [] }, ...s };
      if (!c.fotosMuestra) { c.fotos = [...fotosDeMuestra(), ...c.fotos]; c.fotosMuestra = true; }
      // Escenario nuevo (la abuela con letra grande) en una demo ya empezada.
      if (!c.grupos.some((g) => g.codigo === 'DEMO08')) {
        const n = semilla();
        const g = n.grupos.find((x) => x.codigo === 'DEMO08');
        c.grupos.push(g); c.personas.push(...n.personas.filter((p) => p.grupo_id === g.id));
      }
      return c;
    }
  } catch { /* estado roto: se reinicia */ }
  const s = semilla();
  guardar(s);
  return s;
}
function guardar(s) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(s));
  } catch {
    throw new Error('El modo demo se quedó sin espacio en el navegador (las fotos ocupan mucho). Reinicia la demo desde el panel.');
  }
  oyentes.forEach((f) => f(s));
}
const oyentes = new Set();
const espera = (v) => new Promise((r) => setTimeout(() => r(v), 150));
const clonar = (v) => JSON.parse(JSON.stringify(v));

export function reiniciarDemo() {
  localStorage.removeItem(CLAVE);
  leer();
}

// ── Invitados ──────────────────────────────────────────────────────────────
// Mismo juicio que plazo_vencido() en la base: la fecha del LUGAR de la boda.
function plazoVencido() {
  const hoy = reloj().toLocaleDateString('en-CA', { timeZone: boda.zonaHoraria });
  return hoy > boda.confirmarAntesDe;
}

function armarInvitacion(s, g) {
  const mesas = Object.fromEntries(s.mesas.map((m) => [m.id, m.nombre]));
  return {
    grupo: { codigo: g.codigo, nombre: g.nombre, pases: g.pases, estado: g.estado, mensaje: g.mensaje,
      cancion: g.cancion, respondido_at: g.respondido_at, letra_grande: !!g.letra_grande },
    limite: boda.confirmarAntesDe,
    personas: s.personas.filter((p) => p.grupo_id === g.id).map((p) => ({
      id: p.id, nombre: p.nombre, es_nino: p.es_nino, asistira: p.asistira, restriccion: p.restriccion,
      mesa: mesas[p.mesa_id] ?? null, agregado: !!p.agregado_por_invitado,
    })),
  };
}

export async function getInvitacion(codigo) {
  const s = leer();
  const g = s.grupos.find((x) => x.codigo === codigo.trim().toUpperCase());
  if (!g) return espera(null);
  if (!g.abierta_at) { g.abierta_at = ahora(); guardar(s); }
  return espera(clonar(armarInvitacion(s, g)));
}

export async function responder(codigo, { personas, mensaje, cancion }) {
  const s = leer();
  const g = s.grupos.find((x) => x.codigo === codigo.trim().toUpperCase());
  if (!g) throw new Error('Invitación no encontrada');
  // Mismo juicio que responder_invitacion() en la base.
  if (plazoVencido()) throw new Error('El plazo para confirmar ya terminó. Escríbenos directamente.');
  const quitar = new Set(personas.filter((x) => x.id && x.quitar).map((x) => x.id));
  s.personas = s.personas.filter((p) => !(p.grupo_id === g.id && p.agregado_por_invitado && quitar.has(p.id)));
  const guardadas = s.personas.filter((p) => p.grupo_id === g.id).length;
  const nuevas = personas.filter((x) => !x.id && !x.quitar && x.nombre?.trim()).length;
  if (guardadas + nuevas > g.pases) throw new Error(`La invitación tiene ${g.pases} pases`);
  for (const x of personas) {
    if (x.quitar) continue;
    const p = x.id && s.personas.find((y) => y.id === x.id && y.grupo_id === g.id);
    if (p) Object.assign(p, { nombre: p.agregado_por_invitado ? (x.nombre?.trim() || p.nombre) : p.nombre, asistira: x.asistira, restriccion: x.restriccion?.trim() || null });
    else if (x.nombre?.trim()) {
      s.personas.push({ id: uid(), grupo_id: g.id, nombre: x.nombre.trim(), es_nino: false, asistira: x.asistira,
        restriccion: x.restriccion?.trim() || null, mesa_id: null, agregado_por_invitado: true, created_at: ahora() });
    }
  }
  const mias = s.personas.filter((p) => p.grupo_id === g.id);
  if (!mias.length) throw new Error('Indica quién asistirá');
  const si = mias.filter((p) => p.asistira).length;
  g.estado = si === 0 ? 'declinado' : si < mias.length ? 'parcial' : 'confirmado';
  g.mensaje = mensaje?.trim() || null;
  g.cancion = cancion?.trim() || null;
  g.respondido_at = ahora();
  guardar(s);
  return espera(clonar(armarInvitacion(s, g)));
}

export const verificarClaveAlbum = async (clave) => espera(leer().claveAlbum === clave.trim().toUpperCase());

// ── Álbum ──────────────────────────────────────────────────────────────────
export async function listarFotos({ incluirOcultas = false } = {}) {
  const f = leer().fotos.filter((x) => incluirOcultas || !x.oculta);
  return espera(clonar(f).sort((a, b) => b.created_at.localeCompare(a.created_at)));
}

export async function subirFoto(file, { autor, momento, clave }) {
  if (!(await verificarClaveAlbum(clave))) throw new Error('Clave del álbum incorrecta');
  if (file.type.startsWith('video/')) throw new Error('En el modo demo sólo se pueden subir fotos.');
  // En la demo se guardan chicas: localStorage tiene ~5 MB.
  const { blob, ancho, alto } = await comprimirImagen(file, 900, 0.7);
  const url = await blobADataUrl(blob);
  const s = leer();
  const id = uid();
  s.fotos.push({ id, ruta: `fotos/${id}.jpg`, url, mini: url, autor: autor?.trim() || null, momento: momento || null,
    ancho, alto, oculta: false, created_at: ahora() });
  guardar(s);
}

export function suscribirFotos(alLlegar) {
  let vistas = new Set(leer().fotos.map((f) => f.id));
  const f = (s) => {
    s.fotos.filter((x) => !vistas.has(x.id) && !x.oculta).forEach((x) => alLlegar(clonar(x)));
    vistas = new Set(s.fotos.map((x) => x.id));
  };
  oyentes.add(f);
  // Otra pestaña (p. ej. la pantalla en vivo) también se entera
  const alCambiar = (e) => { if (e.key === CLAVE) f(leer()); };
  window.addEventListener('storage', alCambiar);
  return () => { oyentes.delete(f); window.removeEventListener('storage', alCambiar); };
}

// ── Libro de firmas ────────────────────────────────────────────────────────
export async function listarMensajes({ incluirOcultos = false } = {}) {
  const m = leer().mensajes.filter((x) => incluirOcultos || !x.oculto);
  return espera(clonar(m).sort((a, b) => b.created_at.localeCompare(a.created_at)));
}
export async function firmar({ autor, texto, audio }) {
  if ((autor?.trim().length ?? 0) < 2) throw new Error('Escribe tu nombre');
  if (!audio && (texto?.trim().length ?? 0) < 2) throw new Error('Escribe tu mensaje o graba uno de voz');
  const s = leer();
  const moderar = (s.ajustes?.moderar_mensajes ?? 'no') === 'si';
  const voz = audio ? await blobADataUrl(audio) : null;
  s.mensajes.push({ id: uid(), autor: autor.trim().slice(0, 60), texto: (texto || '').trim().slice(0, 600), audio: voz, oculto: moderar, created_at: ahora() });
  guardar(s);
  return espera(!moderar);
}

// ── Admin ──────────────────────────────────────────────────────────────────
const SESION = 'boda-demo-sesion';
export async function login(email, password) {
  if (password !== 'demo') throw new Error('En el modo demo la contraseña es «demo».');
  sessionStorage.setItem(SESION, email || 'demo');
}
export const logout = async () => sessionStorage.removeItem(SESION);
export const sesion = async () => sessionStorage.getItem(SESION);

export async function listarGrupos() {
  const s = leer();
  return espera(clonar(s.grupos.map((g) => ({ ...g, personas: s.personas.filter((p) => p.grupo_id === g.id) }))));
}
export async function guardarGrupo({ personas, ...g }) {
  const s = leer();
  let fila = g.id && s.grupos.find((x) => x.id === g.id);
  if (fila) Object.assign(fila, g);
  else {
    fila = { id: uid(), codigo: nuevoCodigo(), pases: 1, lado: 'ambos', estado: 'pendiente', created_at: ahora(), ...g };
    s.grupos.push(fila);
  }
  guardar(s);
  return clonar(fila);
}
export async function borrarGrupo(id) {
  const s = leer();
  s.grupos = s.grupos.filter((g) => g.id !== id);
  s.personas = s.personas.filter((p) => p.grupo_id !== id);
  guardar(s);
}
export async function actualizarGrupo(id, cambios) {
  const s = leer();
  Object.assign(s.grupos.find((g) => g.id === id), cambios);
  guardar(s);
}
export async function guardarPersona(p) {
  const s = leer();
  let fila = p.id && s.personas.find((x) => x.id === p.id);
  if (fila) Object.assign(fila, p);
  else {
    fila = { id: uid(), es_nino: false, asistira: null, restriccion: null, mesa_id: null, created_at: ahora(), ...p };
    s.personas.push(fila);
  }
  guardar(s);
  return clonar(fila);
}
export async function borrarPersona(id) {
  const s = leer();
  s.personas = s.personas.filter((p) => p.id !== id);
  guardar(s);
}
export const asignarMesa = (personaId, mesaId) => guardarPersona({ id: personaId, mesa_id: mesaId });

export const listarMesas = async () => espera(clonar(leer().mesas));
export async function guardarMesa(m) {
  const s = leer();
  let fila = m.id && s.mesas.find((x) => x.id === m.id);
  if (fila) Object.assign(fila, m);
  else { fila = { id: uid(), capacidad: 10, forma: 'redonda', x: 50, y: 50, created_at: ahora(), ...m }; s.mesas.push(fila); }
  guardar(s);
  return clonar(fila);
}
export async function borrarMesa(id) {
  const s = leer();
  s.mesas = s.mesas.filter((m) => m.id !== id);
  s.personas.forEach((p) => { if (p.mesa_id === id) p.mesa_id = null; });
  guardar(s);
}

export async function ocultarFoto(id, oculta) {
  const s = leer();
  s.fotos.find((f) => f.id === id).oculta = oculta;
  guardar(s);
}
export async function borrarFoto(foto) {
  const s = leer();
  s.fotos = s.fotos.filter((f) => f.id !== foto.id);
  guardar(s);
}
export async function ocultarMensaje(id, oculto) {
  const s = leer();
  s.mensajes.find((m) => m.id === id).oculto = oculto;
  guardar(s);
}
export const leerClaveAlbum = async () => leer().claveAlbum;
export async function cambiarClaveAlbum(valor) {
  const s = leer();
  s.claveAlbum = valor.trim().toUpperCase();
  guardar(s);
}

export async function leerAjustes() {
  const s = leer();
  return espera({ clave_album: s.claveAlbum, confirmar_antes_de: boda.confirmarAntesDe, zona_horaria: boda.zonaHoraria, moderar_mensajes: 'no', ...s.ajustes });
}
export async function guardarAjuste(clave, valor) {
  const s = leer();
  s.ajustes = { ...s.ajustes, [clave]: String(valor) };
  guardar(s);
}
export const registrarLlegada = (grupoId, llego) => actualizarGrupo(grupoId, { llegada_at: llego ? ahora() : null });

export async function grupoPorCodigo(codigo) {
  const s = leer();
  const g = s.grupos.find((x) => x.codigo === codigo.trim().toUpperCase());
  if (!g) return espera(null);
  const mesas = Object.fromEntries(s.mesas.map((m) => [m.id, m.nombre]));
  return espera(clonar({
    id: g.id, nombre: g.nombre, pases: g.pases, llegada_at: g.llegada_at ?? null,
    personas: s.personas.filter((p) => p.grupo_id === g.id).map((p) => ({ nombre: p.nombre, asistira: p.asistira, mesa: mesas[p.mesa_id] ?? null })),
  }));
}

export const urlAudio = (ruta) => ruta;   // en la demo el audio ya es un data: URL

// ── El día en vivo ─────────────────────────────────────────────────────────
function oir(alCambiar) {
  const f = () => alCambiar();
  oyentes.add(f);
  const alStorage = (e) => { if (e.key === CLAVE) alCambiar(); };
  window.addEventListener('storage', alStorage);
  return () => { oyentes.delete(f); window.removeEventListener('storage', alStorage); };
}
export const listarAvisos = async () => espera(clonar(leer().avisos).sort((a, b) => b.created_at.localeCompare(a.created_at)));
export async function publicarAviso(texto) {
  const s = leer();
  s.avisos.push({ id: uid(), texto: texto.trim().slice(0, 280), created_at: ahora() });
  guardar(s);
}
export async function borrarAviso(id) {
  const s = leer();
  s.avisos = s.avisos.filter((a) => a.id !== id);
  guardar(s);
}
export const suscribirAvisos = oir;
const sinTildes = (t = '') => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export async function buscarMesa(clave, nombre) {
  if (!(await verificarClaveAlbum(clave))) throw new Error('Clave incorrecta');
  const q = sinTildes(nombre.trim());
  if (q.length < 3) return [];
  const s = leer();
  const mesas = Object.fromEntries(s.mesas.map((m) => [m.id, m.nombre]));
  return espera(s.personas.filter((p) => p.asistira && p.mesa_id && sinTildes(p.nombre).includes(q))
    .slice(0, 8).map((p) => ({ nombre: p.nombre, mesa: mesas[p.mesa_id] })));
}

// ── Canciones ──────────────────────────────────────────────────────────────
const sinVotantes = ({ votantes, ...c }) => c;
export const listarCanciones = async () => espera(leer().canciones.filter((c) => !c.oculta).map(sinVotantes)
  .sort((a, b) => b.votos - a.votos || a.created_at.localeCompare(b.created_at)));
export async function pedirCancion({ titulo, artista, nombre, portada, enlace, muestra }, votante) {
  if (!titulo?.trim()) throw new Error('Escribe el nombre de la canción');
  const s = leer();
  let c = s.canciones.find((x) => sinTildes(x.titulo) === sinTildes(titulo.trim()) && sinTildes(x.artista || '') === sinTildes(artista?.trim() || ''));
  if (!c) {
    c = { id: uid(), titulo: titulo.trim().slice(0, 120), artista: artista?.trim().slice(0, 80) || null, pedido_por: nombre?.trim().slice(0, 60) || null,
      portada: portada || null, enlace: enlace || null, muestra: muestra || null,
      votos: 0, tocada: false, oculta: false, created_at: ahora(), votantes: [] };
    s.canciones.push(c);
  }
  if (!c.votantes.includes(votante)) c.votantes.push(votante);
  c.votos = c.votantes.length;
  guardar(s);
  return c.id;
}
export async function votarCancion(id, votante) {
  const s = leer();
  const c = s.canciones.find((x) => x.id === id);
  const ya = c.votantes.includes(votante);
  c.votantes = ya ? c.votantes.filter((v) => v !== votante) : [...c.votantes, votante];
  c.votos = c.votantes.length;
  guardar(s);
  return !ya;
}
export const misVotos = async (votante) => leer().canciones.filter((c) => c.votantes.includes(votante)).map((c) => c.id);
export async function marcarCancion(id, cambios) {
  const s = leer();
  Object.assign(s.canciones.find((c) => c.id === id), cambios);
  guardar(s);
}
export const suscribirCanciones = oir;

// ── Juego ──────────────────────────────────────────────────────────────────
export async function estadoJuego() {
  const { juego } = leer();
  const correctas = (boda.juego?.preguntas || []).map((q) => q.correcta);
  const deEsta = juego.respuestas.filter((r) => r.pregunta === juego.pregunta);
  const conteo = {};
  deEsta.forEach((r) => { conteo[r.opcion] = (conteo[r.opcion] || 0) + 1; });
  const puntos = {};
  juego.respuestas.forEach((r) => {
    const cuenta = r.pregunta < juego.pregunta || (r.pregunta === juego.pregunta && ['revelada', 'final'].includes(juego.fase));
    puntos[r.jugador] ??= { nombre: r.nombre, puntos: 0 };
    if (cuenta && r.opcion === correctas[r.pregunta]) puntos[r.jugador].puntos += 1;
  });
  return { pregunta: juego.pregunta, fase: juego.fase, desde: juego.desde || null, ahora: new Date().toISOString(), conteo, total: deEsta.length,
    ranking: Object.values(puntos).sort((a, b) => b.puntos - a.puntos).slice(0, 10) };
}
export async function responderJuego(jugador, nombre, opcion) {
  const s = leer();
  if (s.juego.fase !== 'abierta' || s.juego.pregunta < 0) throw new Error('Esta pregunta ya cerró');
  if (!nombre?.trim()) throw new Error('Escribe tu nombre');
  if (!s.juego.respuestas.some((r) => r.pregunta === s.juego.pregunta && r.jugador === jugador)) {
    s.juego.respuestas.push({ pregunta: s.juego.pregunta, jugador, nombre: nombre.trim().slice(0, 40), opcion, created_at: ahora() });
    guardar(s);
  }
  return true;
}
export async function controlarJuego({ pregunta, fase }) {
  const s = leer();
  s.juego = { ...s.juego, pregunta, fase, ...(fase === 'abierta' ? { desde: new Date().toISOString() } : {}) };
  guardar(s);
}
export async function reiniciarJuego() {
  const s = leer();
  s.juego = { pregunta: -1, fase: 'cerrado', respuestas: [] };
  guardar(s);
}
export const suscribirJuego = oir;
