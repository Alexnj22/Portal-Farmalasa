// Las notificaciones nativas del teléfono (2026-09-29, pedido del usuario).
//
// Los avisos los manda `send-push-notification`, el mismo que usa el
// navegador: mismos destinatarios, mismo horario laboral, mismo texto. La app
// sólo tiene que (1) registrar el teléfono a nombre de quien entró, (2)
// soltarlo al salir y (3) abrir la pantalla del aviso al tocarlo.
import { Alert, Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '@nucleo/supabaseClient';
import { despacharTraslado, rechazarTraslado, MOTIVOS_RECHAZO } from '@nucleo/data/traslados';
import { cargarFilaDeAviso, paraDecidir } from '@nucleo/data/solicitudDeAviso';
import { decidirSolicitud } from '@nucleo/hooks/useDecidirSolicitud';
import { useToastStore } from '@nucleo/store/toastStore';
import { abrirRuta } from '../pantallas';

let tokenActual = null;

// Con la app abierta el aviso también se muestra arriba, como en Mensajes.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// Los botones de cada tipo de aviso (2026-09-30, pedido del usuario). El
// servidor elige la categoría (`send-push-notification`, `categoryId`) y sólo
// se la pone a un traslado que sigue pendiente. Los dos piden desbloquear el
// teléfono (Face ID): nadie despacha desde un teléfono ajeno sobre la mesa.
// Abren la app para hacer el trabajo acá, con la sesión y las funciones del
// portal (`despacharTraslado`, `rechazarTraslado`), que son las que aplican
// los permisos: el botón no decide nada que el portal no decidiría.
async function declararCategorias() {
  await Notifications.setNotificationCategoryAsync('traslado', [
    { identifier: 'enviar', buttonTitle: 'Enviar todo', options: { opensAppToForeground: true, isAuthenticationRequired: true } },
    { identifier: 'rechazar', buttonTitle: 'Rechazar…', options: { opensAppToForeground: true, isAuthenticationRequired: true, isDestructive: true } },
  ]);
  // Toda otra solicitud (descarte, carga, facturación, caja, abonos, Min/Max,
  // las personales): la MISMA regla que el portal (`decidirSolicitud`).
  await Notifications.setNotificationCategoryAsync('solicitud', [
    { identifier: 'aprobar', buttonTitle: 'Aprobar', options: { opensAppToForeground: true, isAuthenticationRequired: true } },
    { identifier: 'rechazar', buttonTitle: 'Rechazar…', options: { opensAppToForeground: true, isAuthenticationRequired: true, isDestructive: true } },
  ]);
}

/** Pide permiso (la primera vez), saca el token y lo liga a quien tiene la sesión. */
export async function registrarAvisos() {
  try {
    if (!Device.isDevice) return null;   // el simulador no recibe avisos
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Avisos', importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return null;
    await declararCategorias();
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc('registrar_dispositivo_push', { p_token: token, p_plataforma: Platform.OS });
    if (error) { console.warn('registrar_dispositivo_push', error.message); return null; }
    tokenActual = token;
    return token;
  } catch (e) {
    console.warn('avisos', e?.message);
    return null;
  }
}

/** Antes de cerrar sesión: el teléfono deja de recibir los avisos de esta persona. */
export async function soltarAvisos() {
  if (!tokenActual) return;
  try { await supabase.rpc('soltar_dispositivo_push', { p_token: tokenActual }); } catch { /* sin red: se reasigna al próximo que entre */ }
  tokenActual = null;
}

const avisar = (titulo, texto) => new Promise((listo) => Alert.alert(titulo, texto, [{ text: 'Entendido', onPress: listo }]));

async function enviarTraslado(d) {
  if (d.prueba) { await avisar('Prueba', 'Así se vería: el traslado se envía completo y la sala que pidió recibe el aviso. No se envió nada.'); return; }
  const r = await despacharTraslado(d.solicitud);
  if (!r?.ok) { await avisar('No se pudo enviar', r?.error ?? 'Inténtalo desde el traslado.'); abrirRuta(d.url); return; }
  // El ticket de la bolsa lo imprime la computadora de la sala: desde acá no hay
  // impresora. Decisión del usuario del 2026-09-30.
  await avisar('Traslado enviado', 'El ticket para la bolsa se imprime desde la tarjeta del traslado en la computadora de la sala.');
}

// El motivo sale de la MISMA lista cerrada que valida la base
// (`validar_rechazo_traslado`); «Otro» exige escribir cuál.
function pedirMotivo() {
  return new Promise((listo) => Alert.alert('¿Por qué lo rechazas?', undefined, [
    ...MOTIVOS_RECHAZO.map((m) => ({ text: m, style: m === 'Otro' ? 'default' : 'destructive', onPress: () => listo(m) })),
    { text: 'Cancelar', style: 'cancel', onPress: () => listo(null) },
  ]));
}

function pedirTexto(titulo = '¿Cuál es el motivo?') {
  if (Platform.OS !== 'ios') return Promise.resolve(null);   // Alert.prompt sólo existe en iOS
  return new Promise((listo) => Alert.prompt(titulo, undefined, [
    { text: 'Cancelar', style: 'cancel', onPress: () => listo(null) },
    { text: 'Rechazar', style: 'destructive', onPress: (v) => listo(String(v ?? '').trim() || null) },
  ]));
}

async function rechazar(d) {
  const motivo = await pedirMotivo();
  if (!motivo) return;
  let texto = '';
  if (motivo === 'Otro') {
    texto = await pedirTexto();
    if (!texto) { abrirRuta(d.url); return; }   // en Android se escribe en la pantalla del traslado
  }
  if (d.prueba) { await avisar('Prueba', `Así se vería: rechazado por «${motivo}${texto ? `: ${texto}` : ''}». No se rechazó nada.`); return; }
  const { error } = await rechazarTraslado(d.solicitud, motivo, texto);
  if (error) { await avisar('No se pudo rechazar', error.message ?? String(error)); abrirRuta(d.url); return; }
  await avisar('Traslado rechazado', 'La sala que lo pidió recibe el aviso con tu motivo.');
}

// La solicitud se relee al apretar (el aviso es una foto del momento en que
// salió), con las mismas funciones que la campana del portal.
async function traerSolicitud(d) {
  const minmax = String(d.solicitud).startsWith('minmax:');
  const aviso = { metadata: { request_id: minmax ? String(d.solicitud).slice(7) : d.solicitud, request_type: minmax ? 'MINMAX' : null } };
  const fila = await cargarFilaDeAviso(aviso);
  return paraDecidir(fila, minmax);
}

// El detalle de por qué no entró lo deja el store en su única ranura de toast
// (la app no dibuja toasts): se lee de ahí para decirlo en la alerta.
const ultimoMotivo = () => {
  const t = useToastStore.getState();
  return t.isOpen ? [t.title, t.message].filter(Boolean).join(': ') : null;
};

async function decidirDesdeAviso(d, modo, userId) {
  if (!userId) { abrirRuta(d.url); return; }
  let nota = '';
  if (modo === 'reject') {
    nota = await pedirTexto('¿Por qué la rechazas?');
    if (!nota) { if (Platform.OS !== 'ios') abrirRuta(d.url); return; }
  }
  if (d.prueba) { await avisar('Prueba', modo === 'approve' ? 'Así se vería: aprobada. No se aprobó nada.' : `Así se vería: rechazada («${nota}»). No se rechazó nada.`); return; }
  let req;
  try { req = await traerSolicitud(d); } catch (e) { await avisar('No se pudo abrir la solicitud', e?.message ?? String(e)); return; }
  if (!req) { await avisar('Ya no está', 'Esta solicitud ya no está disponible.'); return; }
  if (req.status && req.status !== 'PENDING') { await avisar('Ya estaba resuelta', 'Alguien más la decidió mientras tanto.'); return; }
  const r = await decidirSolicitud({ req, modo, nota, aceptadas: null, userId });
  if (r.ok) { await avisar('Listo', r.mensaje); return; }
  await avisar('No se pudo', (r.yaAvisado && ultimoMotivo()) || r.error);
  abrirRuta(d.url);
}

// Cada toque se atiende una vez: el aviso que abrió la app desde cerrada vuelve
// a aparecer en `getLastNotificationResponseAsync` mientras nadie lo limpie, y
// despachar dos veces es justo lo que no puede pasar.
const atendidos = new Set();

/** Tocar un aviso abre su pantalla; sus botones hacen su trabajo. */
export function escucharToques(userId) {
  const abrir = async (resp) => {
    if (!resp) return;
    const clave = `${resp.notification?.request?.identifier}|${resp.actionIdentifier}`;
    if (atendidos.has(clave)) return;
    atendidos.add(clave);
    Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
    const d = resp.notification?.request?.content?.data ?? {};
    if (d.tipo === 'traslado' && resp.actionIdentifier === 'enviar') return enviarTraslado(d);
    if (d.tipo === 'traslado' && resp.actionIdentifier === 'rechazar') return rechazar(d);
    if (resp.actionIdentifier === 'aprobar') return decidirDesdeAviso(d, 'approve', userId);
    if (d.tipo !== 'traslado' && resp.actionIdentifier === 'rechazar') return decidirDesdeAviso(d, 'reject', userId);
    const url = d.url;
    if (typeof url === 'string' && url.startsWith('/')) abrirRuta(url);
  };
  // El aviso que abrió la app desde cerrada.
  Notifications.getLastNotificationResponseAsync().then(abrir).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(abrir);
  return () => sub.remove();
}
