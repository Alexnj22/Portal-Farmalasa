import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { reclamarPushSubscription, soltarPushSubscription } from '../data/pushSubscriptions';
import { reclamarPushDelEquipo } from '../utils/pushEquipo';
import { useToastStore } from '../store/toastStore';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// ── En iPhone los avisos EXISTEN sólo con la app agregada a inicio ────────────
//
// iOS entrega avisos con la app cerrada únicamente cuando el portal está
// agregado a la pantalla de inicio. Abierto como una página más del navegador,
// `Notification` ni siquiera existe.
//
// Eso no era un detalle teórico: hoy hay **4 suscripciones sobre 50 empleados
// activos, las 4 de Administración** (medido el 2026-08-08; la última es del 23
// de julio). No es un defecto —el portal todavía no está habilitado para las
// sucursales— pero cuando se habilite, el primero que lo abra en su teléfono va
// a entrar por el navegador, y hasta hoy no veía **nada**: el aviso que ofrece
// activarlas exige `permission === 'default'` y ahí el valor es `unsupported`.
// Ni oferta, ni explicación, ni forma de enterarse de que faltaba un paso.
//
// Por eso «no se puede» y «falta instalar la app» dejan de ser el mismo estado.
export const esIOS = () => typeof navigator !== 'undefined'
    && (/iPad|iPhone|iPod/.test(navigator.userAgent)
        // iPadOS se hace pasar por Mac desde iOS 13; el táctil lo delata.
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const esApp = () => typeof window !== 'undefined'
    && ((window.matchMedia?.('(display-mode: standalone)').matches)
        || window.navigator.standalone === true);

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// El equipo se reclama, no se da de alta: en una computadora compartida el
// `endpoint` puede venir ya ligado a quien estuvo antes, y entonces el upsert
// directo lo rechazaba la RLS — o sea que apretar «Activar» fallaba justo en el
// caso para el que existe el botón. El empleado lo resuelve el servidor desde el
// token; por eso `saveSubscription` ya no recibe un id.
async function saveSubscription(sub) {
  const { endpoint, keys: { p256dh, auth } } = sub.toJSON();
  const { error } = await reclamarPushSubscription({ endpoint, p256dh, auth });
  if (error) throw new Error(error.message);
}

const SYNC_EVENT = 'push-subscription-changed';

// Returns { permission, subscribed, subscribe, unsubscribe }
export function usePushSubscription() {
  const { user } = useAuth();
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(false);
  // ¿Este navegador está ligado en la base al empleado que tiene la sesión? Es
  // una pregunta distinta de «el navegador tiene suscripción», y hay que
  // separarlas: en un equipo compartido el navegador puede tener una que quedó
  // de otra persona. Si el reclamo falla, decir «avisos activos» sería mentir.
  const [ligado, setLigado] = useState(true);

  // `Notification` entra en la cuenta: `subscribe` lo llama en su primera línea,
  // así que sin él «soportado» era una promesa que el propio hook no cumplía —
  // la llamada tiraba una excepción que el `catch` mandaba a la consola y el
  // usuario se quedaba mirando un botón que no hacía nada.
  const isSupported = 'serviceWorker' in navigator
    && 'PushManager' in window
    && typeof Notification !== 'undefined'
    && !!VAPID_PUBLIC_KEY;

  // El caso que hay que EXPLICAR, no esconder: iPhone, todavía en el navegador.
  const necesitaInstalar = !isSupported && esIOS() && !esApp();

  const refresh = useCallback(async () => {
    if (!isSupported) return;
    setPermission(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    setSubscribed(!!existing);
  }, [isSupported]);

  // On mount, check if already subscribed
  useEffect(() => {
    refresh(); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de estado de suscripción
  }, [refresh]);

  // Sync across all hook instances when any instance subscribes/unsubscribes
  useEffect(() => {
    window.addEventListener(SYNC_EVENT, refresh);
    return () => window.removeEventListener(SYNC_EVENT, refresh);
  }, [refresh]);

  // Al entrar, este equipo pasa a ser de quien entró (ver `utils/pushEquipo.js`).
  // Va acá y no en los cuatro caminos de login porque así cubre también la
  // sesión restaurada al recargar, que es como llega la mayoría de las visitas.
  useEffect(() => {
    if (!user?.id) return;
    let vivo = true;
    reclamarPushDelEquipo(user.id).then(ok => {
      if (vivo && ok !== null) setLigado(ok);
    });
    return () => { vivo = false; };
  }, [user?.id]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !user) return;
    try {
      // Request notification permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      await saveSubscription(sub);
      setSubscribed(true);
      setLigado(true);
      window.dispatchEvent(new Event(SYNC_EVENT));
    } catch (err) {
      // Un `console.error` en un teléfono no lo lee nadie: el usuario apretaba
      // «Activar», no pasaba nada, y no había forma de saber que había fallado.
      // Es la misma lección que ya costó un canal caído siete meses
      // (`feedback_silence_is_not_success_in_alerts`).
      console.error('Push subscribe error:', err);
      useToastStore.getState().showToast(
        'No se pudieron activar los avisos',
        'Vuelve a intentarlo. Si sigue igual, revisa que los avisos estén permitidos para el portal.',
        'error',
      );
    }
  }, [isSupported, user]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await soltarPushSubscription(sub.toJSON().endpoint);
      }
      setSubscribed(false);
      window.dispatchEvent(new Event(SYNC_EVENT));
    } catch (err) {
      console.error('Push unsubscribe error:', err);
    }
  }, [isSupported]);

  // `subscribed` contesta «¿me van a llegar los avisos?», no «¿este navegador
  // tiene suscripción?». En un equipo compartido las dos respuestas se separan.
  return { permission, subscribed: subscribed && ligado, ligado, subscribe, unsubscribe, isSupported, necesitaInstalar };
}
