import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function saveSubscription(employeeId, sub) {
  const { endpoint, keys: { p256dh, auth } } = sub.toJSON();
  await supabase.from('push_subscriptions').upsert(
    { employee_id: employeeId, endpoint, p256dh, auth },
    { onConflict: 'endpoint' }
  );
}

// Returns { permission, subscribed, subscribe, unsubscribe }
export function usePushSubscription() {
  const { user } = useAuth();
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(false);

  const isSupported = 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC_KEY;

  // On mount, check if already subscribed
  useEffect(() => {
    if (!isSupported) return;
    navigator.serviceWorker.ready.then(async (reg) => {
      const existing = await reg.pushManager.getSubscription();
      setSubscribed(!!existing);
    });
  }, [isSupported]);

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
      await saveSubscription(user.id, sub);
      setSubscribed(true);
    } catch (err) {
      console.error('Push subscribe error:', err);
    }
  }, [isSupported, user]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.toJSON().endpoint);
      }
      setSubscribed(false);
    } catch (err) {
      console.error('Push unsubscribe error:', err);
    }
  }, [isSupported]);

  return { permission, subscribed, subscribe, unsubscribe, isSupported };
}
