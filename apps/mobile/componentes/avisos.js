// Las notificaciones nativas del teléfono (2026-09-29, pedido del usuario).
//
// Los avisos los manda `send-push-notification`, el mismo que usa el
// navegador: mismos destinatarios, mismo horario laboral, mismo texto. La app
// sólo tiene que (1) registrar el teléfono a nombre de quien entró, (2)
// soltarlo al salir y (3) abrir la pantalla del aviso al tocarlo.
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '@nucleo/supabaseClient';
import { abrirRuta } from '../pantallas';

let tokenActual = null;

// Con la app abierta el aviso también se muestra arriba, como en Mensajes.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

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

/** Tocar un aviso abre su pantalla: nativa si ya la hay, el portal si no. */
export function escucharToques() {
  const abrir = (resp) => {
    const url = resp?.notification?.request?.content?.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) abrirRuta(url);
  };
  // El aviso que abrió la app desde cerrada.
  Notifications.getLastNotificationResponseAsync().then(abrir).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(abrir);
  return () => sub.remove();
}
