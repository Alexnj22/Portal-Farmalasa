// Extensión de contenido de avisos (iOS): la TARJETA que se ve al mantener
// presionado un aviso con botones (traslados y solicitudes). SwiftUI, con los
// colores del sistema. Plan: docs/PLAN-AVISOS-NATIVOS-2026-09-30.md (N3).
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'notification-content',
  name: 'Tarjeta',
  bundleIdentifier: '.tarjeta',
  deploymentTarget: '16.0',
  frameworks: ['UserNotifications', 'UserNotificationsUI', 'SwiftUI'],
};
