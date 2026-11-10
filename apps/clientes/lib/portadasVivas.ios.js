// Las portadas VIVAS de Sonidos (videos en bucle, 3:4 y 1:1) sólo viajan en
// el paquete de iPhone: Android no tiene dónde mostrarlas. El gemelo
// `portadasVivas.js` exporta un objeto vacío. Se generan con el script
// Swift descrito en modules/portada-viva/ios/PortadaVivaModule.swift.
export default {
  lluvia: [require('../assets/sonidos/vivas/lluvia-alto.mp4'), require('../assets/sonidos/vivas/lluvia-cuadrado.mp4')],
  olas: [require('../assets/sonidos/vivas/olas-alto.mp4'), require('../assets/sonidos/vivas/olas-cuadrado.mp4')],
  fuego: [require('../assets/sonidos/vivas/fuego-alto.mp4'), require('../assets/sonidos/vivas/fuego-cuadrado.mp4')],
  noche: [require('../assets/sonidos/vivas/noche-alto.mp4'), require('../assets/sonidos/vivas/noche-cuadrado.mp4')],
  ventilador: [require('../assets/sonidos/vivas/ventilador-alto.mp4'), require('../assets/sonidos/vivas/ventilador-cuadrado.mp4')],
  blanco: [require('../assets/sonidos/vivas/blanco-alto.mp4'), require('../assets/sonidos/vivas/blanco-cuadrado.mp4')],
  rosa: [require('../assets/sonidos/vivas/rosa-alto.mp4'), require('../assets/sonidos/vivas/rosa-cuadrado.mp4')],
  cafe: [require('../assets/sonidos/vivas/cafe-alto.mp4'), require('../assets/sonidos/vivas/cafe-cuadrado.mp4')],
};
