// La reserva en la pantalla bloqueada y la Dynamic Island (2026-10-15): una
// Live Activity. Es una extensión aparte del widget de saldo (targets/saldo)
// porque cada extensión tiene UN solo @main; las dos conviven.
//
// La arranca y la pone al día la app (modules/reserva-viva); los datos viajan
// en la propia actividad (ReservaAttributes.swift, copia idéntica en el
// módulo), así que no hace falta App Group.
//
// iOS 17 como el widget de saldo; el módulo pide la actividad sólo desde 17.
// Al ser un bundle nuevo (lat.farmasalud.clientes.reserva), EAS pide crear su
// perfil la primera vez que se compila.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: 'widget',
  name: 'Reserva',
  bundleIdentifier: '.reserva',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
});
