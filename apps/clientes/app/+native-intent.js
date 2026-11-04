// Las direcciones que llegan de afuera, antes de que el enrutador las siga
// (2026-11-04). Es el archivo especial de expo-router (`+native-intent`): no
// es una pantalla.
//
// La vuelta del pago. Al cobrar en línea (Mis reservas, el carrito y Mis
// créditos) la hoja de Wompi se abre con `WebBrowser.openAuthSessionAsync(url,
// 'puntossalud://reservas')` y, al terminar, el banco vuelve a esa dirección.
// En iPhone la sesión de autenticación se la queda y el enrutador no la ve.
// En Android NO: la dirección llega además como un enlace normal, el enrutador
// la sigue y apila OTRA «Mis reservas» encima de la que ya estaba abierta —
// «Atrás» llevaba a la misma pantalla, y desde el carrito saltaba de la
// confirmación del pedido a la lista.
//
// Esas dos direcciones existen SÓLO para la vuelta del pago (el servidor no
// las manda en ningún aviso ni mensaje), así que con la app ya abierta no se
// navega: la pantalla que abrió el cobro ya está ahí y relee el estado sola.
// En el arranque en frío (`initial`: Android cerró la app mientras se pagaba)
// sí se sigue, para que la persona caiga donde estaba pagando.
const VUELTA_DEL_PAGO = /^puntossalud:\/\/\/?(reservas|creditos)(?:[/?#]|$)/i;

export function redirectSystemPath({ path, initial }) {
  try {
    if (!initial && VUELTA_DEL_PAGO.test(String(path ?? ''))) return null;
    return path;
  } catch {
    // Un error acá cerraría la app (lo advierte expo-router): ante la duda,
    // la dirección tal cual.
    return path;
  }
}
