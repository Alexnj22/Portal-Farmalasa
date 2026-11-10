// MODO DEMO: misma interfaz que supabaseApi, guardado en localStorage. Sirve
// para ver y probar el sitio completo sin crear nada. Nada sale del navegador.
import { comprimirImagen, blobADataUrl } from './imagen';
import { nuevoCodigo } from './codigo';

const CLAVE = 'boda-demo-v1';
const uid = () => crypto.randomUUID();
const ahora = () => new Date().toISOString();

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
        abierta_at: null, created_at: ahora(), ...extra },
      personas: nombres.map((n) => ({ id: uid(), grupo_id: id, nombre: n, es_nino: false, asistira: null,
        restriccion: null, mesa_id: null, created_at: ahora() })),
    };
  };
  const lista = [
    g('DEMO01', 'Familia Martínez', 4, 'novio', ['Carlos Martínez', 'Ana de Martínez', 'Sofía Martínez']),
    g('DEMO02', 'Tía Rosa', 1, 'novia', ['Rosa Hernández']),
    g('DEMO03', 'Luis y Andrea', 2, 'ambos', ['Luis Pérez', 'Andrea López']),
    g('DEMO04', 'Familia Rivera', 3, 'novia', ['Jorge Rivera', 'Marta de Rivera', 'Diego Rivera']),
  ];
  // Una ya respondida, para que el panel muestre algo
  lista[2].grupo.estado = 'confirmado';
  lista[2].grupo.respondido_at = ahora();
  lista[2].grupo.cancion = 'Vivir mi vida – Marc Anthony';
  lista[2].personas.forEach((p) => { p.asistira = true; p.mesa_id = mesas[1].id; });
  lista[2].personas[1].restriccion = 'Vegetariana';
  return {
    claveAlbum: 'BODA27',
    mesas,
    grupos: lista.map((x) => x.grupo),
    personas: lista.flatMap((x) => x.personas),
    fotos: [],
    mensajes: [
      { id: uid(), autor: 'Andrea', texto: '¡Los queremos mucho! Que sea el inicio de una vida llena de amor.', oculto: false, created_at: ahora() },
    ],
  };
}

function leer() {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE));
    if (s) return s;
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
function armarInvitacion(s, g) {
  const mesas = Object.fromEntries(s.mesas.map((m) => [m.id, m.nombre]));
  return {
    grupo: { codigo: g.codigo, nombre: g.nombre, pases: g.pases, estado: g.estado, mensaje: g.mensaje,
      cancion: g.cancion, respondido_at: g.respondido_at },
    personas: s.personas.filter((p) => p.grupo_id === g.id).map((p) => ({
      id: p.id, nombre: p.nombre, es_nino: p.es_nino, asistira: p.asistira, restriccion: p.restriccion,
      mesa: mesas[p.mesa_id] ?? null,
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
  if (personas.length > g.pases) throw new Error(`La invitación tiene ${g.pases} pases`);
  for (const x of personas) {
    const p = x.id && s.personas.find((y) => y.id === x.id && y.grupo_id === g.id);
    if (p) Object.assign(p, { nombre: x.nombre?.trim() || p.nombre, asistira: x.asistira, restriccion: x.restriccion?.trim() || null });
    else if (x.nombre?.trim()) {
      s.personas.push({ id: uid(), grupo_id: g.id, nombre: x.nombre.trim(), es_nino: false, asistira: x.asistira,
        restriccion: x.restriccion?.trim() || null, mesa_id: null, created_at: ahora() });
    }
  }
  const mias = s.personas.filter((p) => p.grupo_id === g.id);
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
  s.fotos.push({ id, ruta: `fotos/${id}.jpg`, url, autor: autor?.trim() || null, momento: momento || null,
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
export async function firmar({ autor, texto }) {
  if ((autor?.trim().length ?? 0) < 2 || (texto?.trim().length ?? 0) < 2) throw new Error('Escribe tu nombre y tu mensaje');
  const s = leer();
  s.mensajes.push({ id: uid(), autor: autor.trim().slice(0, 60), texto: texto.trim().slice(0, 600), oculto: false, created_at: ahora() });
  guardar(s);
  return espera();
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
