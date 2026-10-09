// Los avisos al teléfono del cliente. Se piden SÓLO cuando la persona lo activa
// en «Cuenta» —nunca al abrir la app—: el permiso del sistema se pregunta una
// vez, y gastarlo antes de que sepa para qué es lo pierde.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

// Con la app ABIERTA, el aviso lo presenta la propia app con su banner
// (componentes/AvisoEnApp.js) en vez del del sistema (2026-10-09): se ve con
// los colores y el ícono de la bandeja, se toca para ir y se desliza para
// cerrar. Sólo mientras ese banner está montado y puede mostrarse (con sesión
// y sin el bloqueo encima); si no, sale el del sistema — nunca se pierde.
// En los dos casos queda en el centro de notificaciones (`shouldShowList`).
let bannerPropio = false;
export function usarBannerPropio(activo) { bannerPropio = !!activo; }

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: !bannerPropio, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
  }),
});

// Quien quiera enterarse de un aviso que llegó con la app abierta: el banner,
// la campana (para sumar uno) y la bandeja (para recargarse si está a la vista).
const oyentes = new Set();
let escuchando = false;
/** Se suscribe a los avisos que llegan con la app abierta. Devuelve cómo desuscribirse. */
export function alLlegarAviso(fn) {
  if (!escuchando && Platform.OS !== 'web') {
    escuchando = true;
    Notifications.addNotificationReceivedListener((n) => {
      const c = n?.request?.content ?? {};
      const aviso = { id: n?.request?.identifier ?? String(Date.now()), titulo: c.title ?? '', cuerpo: c.body ?? '', url: c.data?.url ?? null, tipo: c.data?.tipo ?? null };
      for (const f of oyentes) { try { f(aviso); } catch { /* un oyente roto no tapa a los demás */ } }
    });
  }
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}

/** Devuelve el token de avisos, o `{ error }` con una frase que se puede mostrar. */
export async function pedirTokenDeAvisos() {
  if (Platform.OS === 'web' || !Device.isDevice) return { error: 'Los avisos sólo funcionan en un teléfono.' };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('ofertas', {
      name: 'Ofertas y puntos', importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return { error: 'Activa las notificaciones en los ajustes del teléfono.' };
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { error: 'Los avisos todavía no están disponibles.' };
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token: data };
  } catch {
    return { error: 'No se pudieron activar los avisos. Intenta más tarde.' };
  }
}

// Los avisos son POR SESIÓN en el servidor: al cerrar sesión y volver a entrar,
// la sesión nueva nacía con los avisos apagados aunque la persona ya los
// hubiera aceptado en este teléfono (usuario, 2026-10-06: «los avisos en este
// teléfono se desactivan, ¿por qué?»). Se recuerda la decisión EN EL TELÉFONO
// y, si el permiso del sistema sigue dado, se vuelven a encender solos.

const CLAVE_AVISOS = 'puntos_salud_avisos_en_este_telefono';
let sincronizado = false;

export async function recordarAvisos(acepta) {
  await SecureStore.setItemAsync(CLAVE_AVISOS, acepta ? '1' : '0').catch(() => {});
}

/** Una vez por apertura: re-enciende los avisos de la sesión si el teléfono ya los tenía, y refresca el token. */
export async function sincronizarAvisos(pedir, aceptaEnServidor) {
  if (sincronizado || Platform.OS === 'web' || !Device.isDevice) return;
  sincronizado = true;
  try {
    const recordado = await SecureStore.getItemAsync(CLAVE_AVISOS).catch(() => null);
    // Lo apagó a propósito en este teléfono: no se toca.
    if (recordado === '0') return;
    if (!aceptaEnServidor && recordado !== '1') return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return; // nunca se pide el permiso sin que la persona lo active
    const r = await pedirTokenDeAvisos();
    if (r.token) await pedir('avisos', { acepta: true, push_token: r.token });
  } catch { /* sin red: se reintenta en la próxima apertura */ }
}

/** Al cerrar sesión, la próxima apertura vuelve a sincronizar. */
export function olvidarSincronizacion() { sincronizado = false; }
