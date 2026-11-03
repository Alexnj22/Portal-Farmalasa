import { useEffect } from 'react';
import { escucharConexion, soltarConexion } from '@plataforma/conexion';
import { vaciarFotosEnEspera, alCambiarFotosEnEspera, fotosEnEspera } from '../data/fotosEnEspera';

const CADA = 60_000;

/**
 * Sube sola las fotos que quedaron esperando en este aparato (ver
 * `data/fotosEnEspera`). Se monta UNA vez, en el marco del portal: al entrar,
 * al volver la red y cada minuto mientras quede alguna.
 *
 * Con sesión y nada más: la subida va con el permiso de quien entró.
 */
export function useFotosEnEspera(conSesion) {
    useEffect(() => {
        if (!conSesion) return undefined;
        let reloj = null;
        let vivo = true;

        async function correr() {
            await vaciarFotosEnEspera();
            programar();
        }
        async function programar() {
            if (!vivo) return;
            clearTimeout(reloj);
            if (await fotosEnEspera() > 0) reloj = setTimeout(correr, CADA);
        }

        correr();
        escucharConexion(correr);
        const soltar = alCambiarFotosEnEspera(programar);   // una foto recién encolada arranca el reloj
        return () => { vivo = false; clearTimeout(reloj); soltarConexion(correr); soltar(); };
    }, [conSesion]);
}
