// Notificación del sistema operativo (la que sale fuera del navegador).
//
// Vivía copiada en `useSyncMonitor.js` y `useNotificationsChannel.js`, idéntica
// en las dos. Se unifica al resolver el aviso duplicado (2026-08-01): al mover
// el aviso de `announcements` a un solo suscriptor hacía falta que el store
// pudiera dispararla también, y tres copias de lo mismo era peor.
//
// Best-effort a propósito: si el permiso está revocado, el navegador no soporta
// Notification, o el constructor tira (pasa en Safari/iOS fuera de un service
// worker), no se hace nada. Nunca debe romper el flujo que la llamó.
export function fireBrowserNotif(title, body, tag, onClick) {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        const n = new Notification(title, { body, icon: '/favicon.ico', tag });
        if (onClick) n.onclick = () => { window.focus(); onClick(); };
    } catch { /* permiso revocado, navegador sin soporte, etc. */ }
}
