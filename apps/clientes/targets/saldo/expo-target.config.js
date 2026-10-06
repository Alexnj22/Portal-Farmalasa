// El widget de la pantalla de inicio (2026-10-06): el saldo en dólares, los
// puntos, y lo que vence en los próximos 3 meses, sin abrir la app. Lee lo que
// la app deja en el App Group (`lib/widget.js`) cada vez que carga el resumen.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'Saldo',
  bundleIdentifier: '.widget',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit'],
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
