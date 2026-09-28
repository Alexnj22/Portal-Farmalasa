// En la versión web de la app (sólo para desarrollo) no hay WebView ni forma de
// prestarle la sesión a otra página: se abre el portal en la misma pestaña.
import { useEffect } from 'react';
import { PORTAL_URL } from '@plataforma/config';

export default function PortalIncrustado({ ruta }) {
  useEffect(() => { window.location.assign(PORTAL_URL + ruta); }, [ruta]);
  return null;
}
