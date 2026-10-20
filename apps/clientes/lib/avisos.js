// Los avisos al teléfono del cliente. Se piden SÓLO cuando la persona lo activa
// en «Cuenta» —nunca al abrir la app—: el permiso del sistema se pregunta una
// vez, y gastarlo antes de que sepa para qué es lo pierde.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { sinBloquear } from './bloqueo';

// Con la app ABIERTA, el aviso lo presenta la propia app con su banner
// (componentes/AvisoEnApp.js) en vez del del sistema (2026-10-09): se ve con
// los colores y el ícono de la bandeja, se toca para ir y se desliza para
// cerrar. Sólo mientras ese banner está montado y puede mostrarse (con sesión
// y sin el bloqueo encima); si no, sale el del sistema — nunca se pierde.
// En los dos casos queda en el centro de notificaciones (`shouldShowList`).
let bannerPropio = false;
export function usarBannerPropio(activo) { bannerPropio = !!activo; }

// El chat abierto (2026-10-12): sus respuestas no sacan banner encima (ya se
// ven en la conversación) y la pantalla se recarga al llegar el push.
let chatAbierto = false;
export function marcarChatALaVista(v) { chatAbierto = !!v; }
export function chatALaVista() { return chatAbierto; }
/** ¿Es la respuesta del chat? El push trae `tipo: 'chat'` y `url: '/chat'`. */
export function esAvisoDeChat(a) {
  return a?.tipo === 'chat' || (typeof a?.url === 'string' && a.url.startsWith('/chat'));
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: !bannerPropio, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
  }),
});

// ── Avisos con el nombre de un producto (2026-10-15) ────────────────────────
// Decisión del dueño: el producto no se lee con el teléfono bloqueado. El
// servidor (supabase/functions/_shared/avisoPrivado.ts) los manda con estos
// dos nombres; si se cambian acá, se cambian allá.
//   · iPhone: la categoría `privado` muestra el TÍTULO (genérico) aunque la
//     vista previa esté oculta, y en lugar del cuerpo pone «Toca para ver el
//     detalle». Con «Mostrar vista previa: Al desbloquear», desbloqueado se ve
//     entero. Se registra al arrancar —antes de que llegue un aviso— y volver
//     a registrarla es inofensivo (la reemplaza).
//   · Android: el canal `privados` (pantalla bloqueada: privada). El cuerpo ya
//     llega sin el producto; el texto entero viene en `data.cuerpo` y lo pinta
//     el banner de la app. Un canal no se puede cambiar una vez creado: por eso
//     es uno nuevo y no `ofertas`. Se crea junto con el token (abajo).
//   · Android, formato 2 (2026-10-20, «que no aparezcan en la pantalla
//     bloqueada, y desbloqueado se vean completos»): el canal `ocultos`, con
//     visibilidad SECRETA — suena, pero bloqueado no se pinta. Como ahí el
//     aviso llega ENTERO, la app sólo declara `formato: 2` si el canal se creó;
//     el servidor no se lo manda a quien no lo dijo.
export const CATEGORIA_PRIVADA = 'privado';
const CANAL_PRIVADO = 'privados';
const CANAL_OCULTO = 'ocultos';
if (Platform.OS === 'ios') {
  Notifications.setNotificationCategoryAsync(CATEGORIA_PRIVADA, [], {
    showTitle: true, previewPlaceholder: 'Toca para ver el detalle',
  }).catch(() => { /* sin la categoría iOS esconde título y cuerpo: nunca peor */ });
}

// Responder el chat DESDE EL AVISO (2026-10-20, «como las apps de mensajería»):
// la categoría `chat` lleva el botón «Responder» con campo de texto —sin abrir
// la app— y, en iPhone, la misma privacidad que `privado`. Se declara al
// servidor (`responde`) sólo si se registró: a una app vieja le sigue llegando
// el aviso de siempre.
export const CATEGORIA_CHAT = 'chat';
export const ACCION_RESPONDER = 'responder';
const categoriaChat = Platform.OS === 'web' ? Promise.resolve(false)
  : Notifications.setNotificationCategoryAsync(CATEGORIA_CHAT, [{
    identifier: ACCION_RESPONDER, buttonTitle: 'Responder',
    textInput: { submitButtonTitle: 'Enviar', placeholder: 'Escribe tu respuesta' },
    options: { opensAppToForeground: false },
  }], Platform.OS === 'ios' ? { showTitle: true, previewPlaceholder: 'Toca para ver el detalle' } : undefined)
    .then(() => true).catch(() => false);

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
      // `data.cuerpo`: el texto entero de un aviso con producto (en Android el
      // `body` llega genérico). Con la app abierta el teléfono está desbloqueado.
      const cuerpo = typeof c.data?.cuerpo === 'string' && c.data.cuerpo ? c.data.cuerpo : (c.body ?? '');
      const aviso = { id: n?.request?.identifier ?? String(Date.now()), titulo: c.title ?? '', cuerpo, url: c.data?.url ?? null, tipo: c.data?.tipo ?? null };
      for (const f of oyentes) { try { f(aviso); } catch { /* un oyente roto no tapa a los demás */ } }
    });
  }
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}

/**
 * El permiso del sistema, preguntado sólo si todavía no está dado. Lo usan el
 * push (abajo) y el recordatorio de tomas (lib/tomas.js, 2026-10-12), que es
 * local y por eso funciona también en el simulador.
 */
export async function pedirPermisoDeAvisos() {
  if (Platform.OS === 'web') return false;
  let { status } = await Notifications.getPermissionsAsync();
  // El diálogo del permiso saca a la app del primer plano: no es «irse» (lib/bloqueo).
  if (status !== 'granted') ({ status } = await sinBloquear(() => Notifications.requestPermissionsAsync()));
  return status === 'granted';
}

/** Devuelve `{ token, formato }`, o `{ error }` con una frase que se puede mostrar. */
export async function pedirTokenDeAvisos() {
  if (Platform.OS === 'web' || !Device.isDevice) return { error: 'Los avisos sólo funcionan en un teléfono.' };
  let formato = 1;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('ofertas', {
      name: 'Ofertas y puntos', importance: Notifications.AndroidImportance.DEFAULT,
    });
    formato = await Notifications.setNotificationChannelAsync(CANAL_OCULTO, {
      name: 'Reservas y tratamientos', importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
    }).then(() => 2).catch(() => 1);
    if (formato === 2) {
      // El canal viejo ya no recibe nada: se quita para no salir dos veces en Ajustes.
      await Notifications.deleteNotificationChannelAsync(CANAL_PRIVADO).catch(() => {});
    } else {
      await Notifications.setNotificationChannelAsync(CANAL_PRIVADO, {
        name: 'Reservas y tratamientos', importance: Notifications.AndroidImportance.DEFAULT,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      }).catch(() => { /* sin el canal, el aviso sale por el de siempre: igual sin el producto */ });
    }
  }
  if (!(await pedirPermisoDeAvisos())) return { error: 'Activa las notificaciones en los ajustes del teléfono.' };
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { error: 'Los avisos todavía no están disponibles.' };
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token: data, formato, responde: await categoriaChat };
  } catch {
    return { error: 'No se pudieron activar los avisos. Intenta más tarde.' };
  }
}

// Los avisos son POR SESIÓN en el servidor: al cerrar sesión y volver a entrar,
// la sesión nueva nacía con los avisos apagados aunque la persona ya los
// hubiera aceptado en este teléfono (usuario, 2026-10-06: «los avisos en este
// teléfono se desactivan, ¿por qué?»). Se recuerda la decisión EN EL TELÉFONO
// y, si el permiso del sistema sigue dado, se vuelven a encender solos.

export const CLAVE_AVISOS = 'puntos_salud_avisos_en_este_telefono';
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
    if (r.token) await pedir('avisos', { acepta: true, push_token: r.token, formato: r.formato, responde: !!r.responde });
  } catch { /* sin red: se reintenta en la próxima apertura */ }
}

/** Al cerrar sesión, la próxima apertura vuelve a sincronizar. */
export function olvidarSincronizacion() { sincronizado = false; }

// Lo escrito en «Responder» del aviso del chat (2026-10-20): se manda sin abrir
// la app. Con la app cerrada, el sistema la despierta en segundo plano y la
// sesión tarda un momento en leerse del llavero: se la espera hasta 10 s. Si no
// sale, un aviso local lo dice (lo escrito no se pierde en silencio).
const respondidas = new Set();
export const esRespuestaDeAviso = (r) => r?.actionIdentifier === ACCION_RESPONDER;
async function responderDesdeAviso(r) {
  if (!esRespuestaDeAviso(r)) return;
  const id = r.notification?.request?.identifier ?? '';
  const texto = String(r.userText ?? '').trim().slice(0, 2000);
  Notifications.clearLastNotificationResponseAsync?.().catch?.(() => {});
  if (!texto || respondidas.has(id)) return;
  respondidas.add(id);
  // Perezoso: `sesion` importa este archivo.
  const { useSesion } = require('./sesion');
  for (let i = 0; i < 40 && !useSesion.getState().token; i += 1) await new Promise((listo) => setTimeout(listo, 250));
  const res = await Promise.resolve(useSesion.getState().pedir?.('chat_enviar', { texto })).catch(() => null);
  if (!res?.ok) {
    Notifications.scheduleNotificationAsync({
      content: { title: 'No se envió tu respuesta', body: 'Abre el chat para intentarlo de nuevo.', data: { url: '/chat', tipo: 'chat' } },
      trigger: null,
    }).catch(() => {});
  }
}
if (Platform.OS !== 'web') {
  Notifications.addNotificationResponseReceivedListener((r) => { responderDesdeAviso(r); });
  Notifications.getLastNotificationResponseAsync().then((r) => { if (r) responderDesdeAviso(r); }).catch(() => {});
}
