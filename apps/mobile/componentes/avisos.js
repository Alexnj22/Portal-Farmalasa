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
import { router } from 'expo-router';
import { abrirRuta, abrirSolicitud } from '../pantallas';
import { fetchApprovalRequestById } from '@nucleo/data/requests';
import { fallo, listo, trabajando } from './Progreso';

let tokenActual = null;

// Con la app abierta el aviso también se muestra arriba, como en Mensajes.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// Los avisos NO llevan botones (usuario, 2026-09-30: «quitemos las
// aprobaciones desde ahí, lo siento raro»): informan, y tocarlos abre la
// solicitud en la app (`app/solicitud/[id].js`), donde se decide. Una
// instalación que tuvo las categorías con botones las borra acá.
async function declararCategorias() {
  await Promise.all(['traslado', 'solicitud'].map((c) => Notifications.deleteNotificationCategoryAsync(c).catch(() => {})));
}

/** Pide permiso (la primera vez), saca el token y lo liga a quien tiene la sesión. */
export async function registrarAvisos() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Avisos', importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return null;
    await declararCategorias();
    // El simulador no tiene token de avisos; con el permiso y las categorías
    // igual se prueban los avisos que se le mandan a mano (`simctl push`).
    if (!Device.isDevice) return null;
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

// Qué se está decidiendo, para la capa de progreso: la línea de contexto de la
// tarjeta («Anular en La Popular»), si vino.
const deQue = (d) => d?.tarjeta?.contexto ? ` · ${d.tarjeta.contexto}` : '';

/** Enviar todo el traslado. Devuelve `true` si salió. */
export async function enviarTraslado(d) {
  if (d.prueba) { listo('Prueba', 'Así se vería: traslado enviado. No se envió nada.'); return false; }
  trabajando(`Enviando traslado${deQue(d)}…`);
  const r = await despacharTraslado(d.solicitud);
  if (!r?.ok) {
    // ¿Entró igual y se perdió la respuesta? Se relee antes de decir que no.
    const { data: fila } = await fetchApprovalRequestById(d.solicitud).catch(() => ({ data: null }));
    if (fila?.status !== 'APPROVED') { fallo('No se pudo enviar', r?.error ?? 'Inténtalo desde el traslado.'); return false; }
  }
  // El ticket de la bolsa lo imprime la computadora de la sala: desde acá no hay
  // impresora. Decisión del usuario del 2026-09-30.
  listo('Traslado enviado', 'El ticket de la bolsa se imprime desde la tarjeta del traslado en la sala.');
  return true;
}

// El motivo sale de la MISMA lista cerrada que valida la base
// (`validar_rechazo_traslado`); «Otro» exige escribir cuál.
function pedirMotivo() {
  return new Promise((ok) => Alert.alert('¿Por qué lo rechazas?', undefined, [
    ...MOTIVOS_RECHAZO.map((m) => ({ text: m, style: m === 'Otro' ? 'default' : 'destructive', onPress: () => ok(m) })),
    { text: 'Cancelar', style: 'cancel', onPress: () => ok(null) },
  ]));
}

function pedirTexto(titulo = '¿Cuál es el motivo?') {
  if (Platform.OS !== 'ios') return Promise.resolve(null);   // Alert.prompt sólo existe en iOS
  return new Promise((ok) => Alert.prompt(titulo, undefined, [
    { text: 'Cancelar', style: 'cancel', onPress: () => ok(null) },
    { text: 'Rechazar', style: 'destructive', onPress: (v) => ok(String(v ?? '').trim() || null) },
  ]));
}

/**
 * Rechazar un traslado. `motivo`/`texto` llegan ya elegidos cuando vienen de un
 * botón de la notificación; si no, se preguntan. Devuelve `true` si se rechazó.
 */
export async function rechazarTrasladoDesdeAviso(d, motivo = null, texto = '') {
  if (!motivo) motivo = await pedirMotivo();
  if (!motivo) return false;
  if (motivo === 'Otro' && !texto) {
    texto = await pedirTexto();
    if (!texto) { abrirRuta(d.url); return false; }   // en Android se escribe en la pantalla del traslado
  }
  if (d.prueba) { listo('Prueba', `Así se vería: rechazado por «${motivo}${texto ? `: ${texto}` : ''}». No se rechazó nada.`); return false; }
  trabajando(`Rechazando traslado${deQue(d)}…`);
  const { error } = await rechazarTraslado(d.solicitud, motivo, texto);
  if (error) { fallo('No se pudo rechazar', error.message ?? String(error)); return false; }
  listo('Traslado rechazado', 'La sala que lo pidió recibe el aviso con tu motivo.');
  return true;
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
// (la app no dibuja toasts): se lee de ahí para decirlo.
const ultimoMotivo = () => {
  const t = useToastStore.getState();
  return t.isOpen ? [t.title, t.message].filter(Boolean).join(': ') : null;
};

/**
 * Aprobar o rechazar cualquier otra solicitud. `nota` llega escrita cuando
 * vino del campo de la notificación; si no, se pregunta. Devuelve `true` si se
 * aplicó.
 */
export async function decidirDesdeAviso(d, modo, userId, nota = '') {
  if (!userId) { abrirRuta(d.url); return false; }
  if (modo === 'reject' && !nota) {
    nota = await pedirTexto('¿Por qué la rechazas?');
    if (!nota) { if (Platform.OS !== 'ios') abrirRuta(d.url); return false; }
  }
  if (d.prueba) { listo('Prueba', modo === 'approve' ? 'Así se vería: aprobada. No se aprobó nada.' : `Así se vería: rechazada («${nota}»). No se rechazó nada.`); return false; }
  trabajando(`${modo === 'approve' ? 'Aprobando' : 'Rechazando'}${deQue(d)}…`);
  let req;
  try { req = await traerSolicitud(d); } catch (e) { fallo('No se pudo abrir la solicitud', e?.message ?? String(e)); return false; }
  if (!req) { fallo('Ya no está', 'Esta solicitud ya no está disponible.'); return false; }
  if (req.status && req.status !== 'PENDING') { fallo('Ya estaba resuelta', 'Alguien más la decidió mientras tanto.'); return false; }
  const r = await decidirSolicitud({ req, modo, nota, aceptadas: null, userId });
  if (r.ok) { listo(modo === 'approve' ? 'Aprobada' : 'Rechazada', r.mensaje); return true; }
  fallo('No se pudo', (r.yaAvisado && ultimoMotivo()) || r.error);
  return false;
}

// Cada toque se atiende una vez: el aviso que abrió la app desde cerrada vuelve
// a aparecer en `getLastNotificationResponseAsync` mientras nadie lo limpie, y
// despachar dos veces es justo lo que no puede pasar.
const atendidos = new Set();

/** Tocar un aviso abre su pantalla; sus botones hacen su trabajo. */
export function escucharToques() {
  const abrir = async (resp) => {
    if (!resp) return;
    const clave = `${resp.notification?.request?.identifier}|${resp.actionIdentifier}`;
    if (atendidos.has(clave)) return;
    atendidos.add(clave);
    Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
    const d = resp.notification?.request?.content?.data ?? {};
    // Si nombra una solicitud, se abre la solicitud nativa; si no, su pantalla.
    if (d.solicitud && !d.prueba) return abrirSolicitud(d.solicitud);
    if (d.prueba) return router.navigate('/avisos');
    const url = d.url;
    if (typeof url === 'string' && url.startsWith('/')) abrirRuta(url);
  };
  // El aviso que abrió la app desde cerrada.
  Notifications.getLastNotificationResponseAsync().then(abrir).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(abrir);
  return () => sub.remove();
}
