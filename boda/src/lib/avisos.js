import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Los avisos de los novios, al día. Sólo escucha en vivo cuando `activo`
 * (el día de la boda): antes no hay nada que avisar y una conexión en vivo
 * abierta en cada teléfono no le sirve a nadie. Al volver a la pestaña o al
 * recuperar la señal, vuelve a leer (el teléfono suspende las conexiones).
 */
export function useAvisos({ activo = true } = {}) {
  const [avisos, setAvisos] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!activo) return undefined;
    let vivo = true;
    const cargar = () => api.listarAvisos()
      .then((xs) => { if (vivo) { setAvisos(xs || []); setError(''); } })
      .catch((e) => { console.error('Avisos', e); if (vivo) setError(e.message || 'Error'); });
    const alVolver = () => { if (!document.hidden) cargar(); };
    cargar();
    const cancelar = api.suscribirAvisos(cargar);
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('online', cargar);
    return () => {
      vivo = false; cancelar?.();
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('online', cargar);
    };
  }, [activo]);
  return { avisos, error };
}
