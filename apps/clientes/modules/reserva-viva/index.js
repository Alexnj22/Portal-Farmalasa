// La reserva en la pantalla bloqueada (2026-10-15): «Tu reserva R-001234 ·
// Lista para retirar en Salud 3 · quedan 23 h», sin abrir la app.
//   · iPhone: una Live Activity con su Dynamic Island (targets/saldo/Reserva.swift).
//   · Android: una notificación fija con la cuenta regresiva del sistema.
// Las dos las maneja el módulo nativo de esta carpeta; acá se decide CUÁNDO.
//
// ── De dónde salen los cambios ────────────────────────────────────────────
// Sólo de la app: al cargar Mis reservas, al volver a primer plano (si hay
// alguna en pantalla) y al llegar un aviso de reserva con la app abierta. Los
// avisos salen por Expo y no hay llave de APNs de la app para empujarle un
// cambio a la Live Activity con la app cerrada: entre una apertura y otra, lo
// que se mueve solo es el reloj (la cuenta regresiva y el vencimiento son del
// sistema). Por eso tampoco se programa nada en segundo plano: nada despierta
// a la app para esto.
//
// ── Privacidad ────────────────────────────────────────────────────────────
// La pantalla bloqueada la ve cualquiera: nunca el nombre del producto ni la
// palabra «receta». Sólo el código, la sucursal, el estado y el plazo.
//
// ── Cuándo NO se muestra ──────────────────────────────────────────────────
// Si la persona apagó los avisos en Cuenta (la misma marca de lib/avisos.js),
// si el sistema no deja (Live Activities apagadas en Ajustes; notificaciones
// del teléfono o el canal «Reservas en curso» apagados en Android), y si quitó
// ESA reserva de la pantalla: no se vuelve a poner hasta que cambie de estado.
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { useSesion } from '../../lib/sesion';
import { alLlegarAviso, CLAVE_AVISOS } from '../../lib/avisos';

const N = Platform.OS === 'ios' || Platform.OS === 'android' ? requireOptionalNativeModule('ReservaViva') : null;

// APAGADA (2026-10-20, decisión del dueño): «eso para cuando tengamos
// domicilio». El módulo nativo se queda compilado; mientras esto sea `false`
// no se pone nada en la pantalla bloqueada y lo que hubiera quedado de una
// versión anterior se quita al arrancar y al leer Mis reservas.
const ENCENDIDA = false;
let limpiada = false;
function quitarLoQueQuedo() {
  if (limpiada || !N) return Promise.resolve();
  limpiada = true;
  return (async () => {
    try { if (activas().length) await N.terminarTodas(); } catch { /* nada que quitar */ }
    await SecureStore.deleteItemAsync(CLAVE_MOSTRADAS).catch(() => {});
  })();
}

// `CLAVE_AVISOS` (lib/avisos.js): '0' = la persona apagó los avisos en este teléfono.
// Qué estado se mostró por última vez de cada reserva: { 'R-001234': 'lista' }.
const CLAVE_MOSTRADAS = 'puntos_salud_reservas_en_pantalla';

const ABIERTOS = ['en_revision', 'pendiente', 'lista'];
const ms = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? t : null; };
const claveDe = (r) => r.pedido ?? r.codigo ?? `R-${String(r.id).padStart(6, '0')}`;

// «hasta las 3:40 p. m.» / «hasta mañana a las 9:05 a. m.», en la hora del teléfono.
function hasta(venceMs) {
  const d = new Date(venceMs);
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  const hora = `${h % 12 || 12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
  const hoy = new Date();
  const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
  const mismoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (mismoDia(d, hoy)) return `hasta las ${hora}`;
  if (mismoDia(d, manana)) return `hasta mañana a las ${hora}`;
  return `hasta el ${d.getDate()}/${d.getMonth() + 1} a las ${hora}`;
}

// Los textos de cada estado. Son los MISMOS que dibuja la Live Activity
// (`aspecto` en targets/saldo/Reserva.swift): si se cambia uno, el otro.
function linea(v) {
  const lugar = v.domicilio ? ' a domicilio' : v.sucursal ? ` en ${v.sucursal}` : '';
  switch (v.estado) {
    case 'en_revision': return 'En revisión. Te avisamos cuando esté lista.';
    case 'lista': return `${v.domicilio ? 'Lista para entregar' : 'Lista para retirar'}${lugar}${v.vence ? ` · ${hasta(v.vence)}` : ''}`;
    case 'retirada': return v.domicilio ? 'Entregada. ¡Gracias!' : `Retirada${lugar}. ¡Gracias!`;
    case 'vencida': return 'Venció sin retirar.';
    case 'cancelada': return 'Cancelada.';
    default: return `En preparación${lugar}. Te avisamos cuando esté lista.`;
  }
}

/**
 * Un grupo de filas (un pedido del carrito o una reserva suelta) → lo que va
 * a la pantalla bloqueada. El estado del grupo es el de Mis reservas: con
 * una en revisión espera todo; lista sólo si lo están todas.
 */
function aVivo(filas) {
  const r = filas[0];
  const clave = claveDe(r);
  const abiertas = filas.filter((f) => ABIERTOS.includes(f.estado));
  const estado = abiertas.length
    ? (abiertas.some((f) => f.estado === 'en_revision') ? 'en_revision' : abiertas.every((f) => f.estado === 'lista') ? 'lista' : 'pendiente')
    : (filas.some((f) => f.estado === 'retirada') ? 'retirada' : filas.some((f) => f.estado === 'vencida') ? 'vencida' : 'cancelada');
  const lista = estado === 'lista';
  const vences = abiertas.map((f) => ms(f.vence_at)).filter(Boolean);
  const desdes = abiertas.map((f) => ms(f.lista_at)).filter(Boolean);
  const v = {
    clave,
    titulo: r.pedido ? `Tu pedido ${clave}` : `Tu reserva ${clave}`,
    estado,
    sucursal: r.sala ?? '',
    domicilio: r.entrega === 'domicilio',
    // El plazo del pedido es el del renglón que vence primero.
    desde: lista && desdes.length ? Math.max(...desdes) : null,
    vence: lista && vences.length ? Math.min(...vences) : null,
  };
  return { ...v, linea: linea(v) };
}

function agrupar(filas) {
  const m = new Map();
  for (const r of filas) { const k = claveDe(r); m.set(k, [...(m.get(k) ?? []), r]); }
  return m;
}

const activas = () => { try { return N?.activas() ?? []; } catch { return []; } };

async function permitido() {
  if (!N) return false;
  try { if (!N.disponible()) return false; } catch { return false; }
  const recordado = await SecureStore.getItemAsync(CLAVE_AVISOS).catch(() => null);
  if (recordado === '0') return false;
  // iPhone: las Live Activities tienen su propio interruptor (lo mira
  // `disponible`), pero si la persona negó las notificaciones, tampoco esto.
  if (Platform.OS === 'ios') {
    const { status } = await Notifications.getPermissionsAsync().catch(() => ({ status: 'undetermined' }));
    if (status === 'denied') return false;
  }
  return true;
}

async function leerMostradas() {
  try { return JSON.parse((await SecureStore.getItemAsync(CLAVE_MOSTRADAS)) || '{}') ?? {}; } catch { return {}; }
}

// Una sincronización a la vez: dos seguidas (la pantalla y el primer plano)
// no se pisan la lista de lo mostrado.
let cola = Promise.resolve();
let ultima = 0;

/**
 * Pone la pantalla bloqueada al día con la lista de reservas. `reservas` tiene
 * que traer TODAS las abiertas (`mis_reservas` en «todas» o «abiertas», primera
 * página): una abierta que falte se daría por terminada. Si trae las
 * terminadas, la que acaba de retirarse se queda un rato diciendo «Retirada».
 */
export function sincronizarReservasVivas(reservas) {
  if (!N || !Array.isArray(reservas)) return cola;
  if (!ENCENDIDA) return quitarLoQueQuedo();
  ultima = Date.now();
  cola = cola.then(async () => {
    try {
      if (!(await permitido())) {
        if (activas().length) await N.terminarTodas();
        return;
      }
      const abiertas = agrupar(reservas.filter((r) => ABIERTOS.includes(r.estado)));
      const cerradas = agrupar(reservas.filter((r) => !ABIERTOS.includes(r.estado)));
      const antes = await leerMostradas();
      const ahora = {};
      for (const [clave, filas] of abiertas) {
        const v = aVivo(filas);
        // Si ya se mostró ESTE estado y no está, la persona la quitó (o el
        // sistema la terminó): no se vuelve a poner hasta que cambie.
        if (antes[clave] === v.estado && !N.existe(clave)) { ahora[clave] = v.estado; continue; }
        if (await N.mostrar(v)) ahora[clave] = v.estado;
      }
      for (const clave of activas()) {
        if (abiertas.has(clave)) continue;
        const filas = cerradas.get(clave);
        await N.terminar(clave, filas ? aVivo(filas) : null);
      }
      await SecureStore.setItemAsync(CLAVE_MOSTRADAS, JSON.stringify(ahora)).catch(() => {});
    } catch { /* sin módulo o el sistema no deja: no es un error de la app */ }
  });
  return cola;
}

/** Al cerrar sesión: nada de la cuenta anterior en la pantalla bloqueada. */
export function olvidarReservasVivas() {
  if (!N) return Promise.resolve();
  cola = cola.then(async () => {
    try { await N.terminarTodas(); } catch { /* nada que quitar */ }
    await SecureStore.deleteItemAsync(CLAVE_MOSTRADAS).catch(() => {});
  });
  return cola;
}

// Lee las abiertas y sincroniza. Si Mis reservas acaba de hacerlo (se recarga
// sola al volver a primer plano), no se repite la lectura.
let temporizador = null;
function refrescarPronto({ siempre = false } = {}) {
  if (temporizador) return;
  temporizador = setTimeout(async () => {
    temporizador = null;
    // Sin nada en la pantalla bloqueada no hay nada que poner al día.
    if (!siempre && !activas().length) return;
    if (Date.now() - ultima < 20_000) return;
    const r = await useSesion.getState().pedir('mis_reservas', { estado: 'abiertas' }).catch(() => null);
    // Lo guardado sin conexión no sirve para esto: podría dar por terminada una
    // que sigue abierta, o al revés.
    if (r?.ok && !r.sinConexion && Array.isArray(r.reservas)) await sincronizarReservasVivas(r.reservas);
  }, 1500);
}

const esDeReserva = (a) => a?.tipo === 'reserva' || a?.tipo === 'receta'
  || (typeof a?.url === 'string' && a.url.startsWith('/reservas'));

/**
 * Una vez por proceso: vuelve a primer plano → si hay alguna en pantalla, se
 * pone al día; llega un aviso de reserva con la app abierta → se lee (puede ser
 * una nueva o la que quedó lista); se cierra la sesión → se quitan todas.
 * `alArrancar: false` desde Mis reservas, que ya lee la lista ella misma.
 */
let vigilando = false;
export function vigilarReservasVivas({ alArrancar = true } = {}) {
  if (vigilando || !N) return;
  if (!ENCENDIDA) { quitarLoQueQuedo(); return; }
  vigilando = true;
  AppState.addEventListener('change', (e) => { if (e === 'active') refrescarPronto(); });
  alLlegarAviso((a) => { if (esDeReserva(a)) refrescarPronto({ siempre: true }); });
  useSesion.subscribe((s, previo) => { if (previo.token && !s.token) olvidarReservasVivas(); });
  // Al arrancar la app puede haber alguna de la apertura anterior.
  if (alArrancar) refrescarPronto();
}
