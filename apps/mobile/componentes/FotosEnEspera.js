// Las fotos que no subieron por falta de señal se suben solas — el gemelo de
// `useColasEnEspera` del portal, sólo con la cola de fotos.
//
// Se monta una vez, dentro de la sesión: al entrar, al volver a la app y,
// mientras quede algo, cada minuto. Lo que se sube va con el permiso de quien
// entró. `vaciarFotosEnEspera` es la del núcleo: la misma que vacía la cola del
// navegador, y la que avisa a la base (`confirmar_foto_pendiente`).
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@nucleo/context/AuthContext';
import { alCambiarFotosEnEspera, fotosEnEspera, vaciarFotosEnEspera } from '@nucleo/data/fotosEnEspera';

const CADA = 60_000;

export default function FotosEnEspera() {
  const { user } = useAuth();
  const conSesion = !!user;
  useEffect(() => {
    if (!conSesion) return undefined;
    let vivo = true;
    let reloj = null;
    const programar = async () => {
      if (!vivo) return;
      clearTimeout(reloj);
      if (await fotosEnEspera() > 0) reloj = setTimeout(correr, CADA);
    };
    async function correr() {
      try { await vaciarFotosEnEspera(); } catch { /* se reintenta en el próximo turno */ }
      programar();
    }
    correr();
    const sub = AppState.addEventListener('change', (e) => { if (e === 'active') correr(); });
    const soltar = alCambiarFotosEnEspera(programar);   // una foto recién guardada arranca el reloj
    return () => { vivo = false; clearTimeout(reloj); sub.remove(); soltar(); };
  }, [conSesion]);
  return null;
}
