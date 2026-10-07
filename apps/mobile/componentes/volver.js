// Volver de una pantalla de acción. Si llegó por un enlace (un aviso, el
// portal) no hay pantalla anterior y `router.back()` no hace nada —o revienta
// con «GO_BACK was not handled»—; ahí se va a la lista que corresponde.
import { router } from 'expo-router';

export function volver(siNoHayAtras = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(siNoHayAtras);
}
