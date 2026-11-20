import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { boda } from '../config';
import { t } from '../lib/idioma';

const K = 'boda-recarga-por-version';
// Chrome, Safari y Firefox dicen lo mismo con distintas palabras: el pedazo de
// código que la página pedía ya no existe (hubo una versión nueva).
// La página vieja la sirve el service worker desde su caché: recargar a secas
// vuelve a traer la misma versión rota. Se le pide la nueva y se vacía la
// caché antes de recargar.
async function recargarConVersionNueva() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.update().catch(() => {}).then(() => r.unregister())));
    if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch { /* sin service worker */ }
  window.location.reload();
}

const esVersionVieja = (e) => /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch dynamically|Unable to preload CSS/i.test(String(e?.message || e));

/**
 * Lo que se ve si una pantalla falla. Si la causa es una versión nueva del
 * sitio publicada mientras la página estaba abierta, recarga UNA vez (la
 * marca en sessionStorage evita un bucle); si no, un error con salida.
 */
export default function ErrorRuta() {
  const error = useRouteError();
  const vieja = esVersionVieja(error);
  let yaRecargo = false;
  try { yaRecargo = sessionStorage.getItem(K) === '1'; } catch { /* privado */ }
  const recargar = vieja && !yaRecargo;

  useEffect(() => {
    if (recargar) {
      try { sessionStorage.setItem(K, '1'); } catch { /* privado */ }
      recargarConVersionNueva();
    } else {
      console.error(error);
    }
  }, [recargar, error]);

  if (recargar) return <div className="error-ruta" aria-busy="true" />;
  return (
    <main className="error-ruta" role="alert">
      <p className="error-mono" aria-hidden>{boda.novios.ella[0]}&amp;{boda.novios.el[0]}</p>
      <h1>{t('Algo se nos', 'Something went')} <em>{t('escapó', 'wrong')}</em></h1>
      <p>{vieja
        ? t('Hay una versión nueva del sitio. Recarga la página para verla.', 'There is a new version of the site. Reload the page to see it.')
        : t('Esta pantalla no se pudo abrir. Prueba de nuevo o vuelve al inicio.', "This screen couldn't open. Try again or go back home.")}</p>
      <div className="acciones-fila">
        <a className="btn" href="/" onClick={() => { try { sessionStorage.removeItem(K); } catch { /* privado */ } }}>{t('Volver al inicio', 'Back to home')}</a>
        <button type="button" className="btn claro" onClick={() => { try { sessionStorage.removeItem(K); } catch { /* privado */ } recargarConVersionNueva(); }}>{t('Recargar', 'Reload')}</button>
      </div>
    </main>
  );
}

/** Al cargar bien una página, la marca se borra: la próxima versión nueva vuelve a poder recargar. */
export function limpiarMarcaDeRecarga() {
  try { sessionStorage.removeItem(K); } catch { /* privado */ }
}
