// Extensión de servicio de avisos (iOS). Corre al llegar cada aviso con
// `mutableContent` y lo convierte en aviso de COMUNICACIÓN: la foto de quien lo
// origina en lugar del ícono, como en Mensajes. Plan:
// docs/PLAN-AVISOS-NATIVOS-2026-09-30.md (N3).
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'notification-service',
  name: 'Avisos',
  bundleIdentifier: '.avisos',
  deploymentTarget: '16.0',
  frameworks: ['Intents', 'SwiftUI', 'UIKit'],
};
