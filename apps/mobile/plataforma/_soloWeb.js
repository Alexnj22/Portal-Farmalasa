// El sustituto de un paquete que sólo existe en la web (ver `metro.config.js`,
// `SOLO_WEB`). Cualquier uso lanza en vez de devolver un vacío que parezca dato.
const { pendiente } = require('./_pendiente');

module.exports = new Proxy({}, {
  get(_, nombre) {
    if (nombre === '__esModule' || nombre === 'then') return undefined;
    throw pendiente(`el paquete web (${String(nombre)})`);
  },
});
