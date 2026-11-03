import { useEffect } from 'react';
import { escucharConexion, soltarConexion } from '@plataforma/conexion';
import { vaciarFotosEnEspera, alCambiarFotosEnEspera, fotosEnEspera } from '../data/fotosEnEspera';
import { reenviarIngresosEnEspera, alCambiarIngresosEnEspera, ingresosEnEspera } from '../data/ingresosEnEspera';

/* Lo que este equipo dejó para después porque un servicio no respondía, y se
 * manda solo (2026-11-03):
 *   · las FOTOS que no subieron (`data/fotosEnEspera`), cada minuto;
 *   · los INGRESOS que la caja no recibió (`data/ingresosEnEspera`), cada dos
 *     — cada intento entra al sistema de la caja, así que no se le insiste. */
const COLAS = [
    { vaciar: vaciarFotosEnEspera, cuantos: fotosEnEspera, alCambiar: alCambiarFotosEnEspera, cada: 60_000 },
    { vaciar: reenviarIngresosEnEspera, cuantos: ingresosEnEspera, alCambiar: alCambiarIngresosEnEspera, cada: 120_000 },
];

/**
 * Se monta UNA vez, en el marco del portal: al entrar, al volver la red y,
 * mientras quede algo, cada tanto. Con sesión y nada más: lo que se manda va
 * con el permiso de quien entró.
 */
export function useColasEnEspera(conSesion) {
    useEffect(() => {
        if (!conSesion) return undefined;
        const limpiar = COLAS.map((cola) => vigilarCola(cola));
        return () => limpiar.forEach((fn) => fn());
    }, [conSesion]);
}

function vigilarCola({ vaciar, cuantos, alCambiar, cada }) {
    let reloj = null;
    let vivo = true;

    async function correr() {
        await vaciar();
        programar();
    }
    async function programar() {
        if (!vivo) return;
        clearTimeout(reloj);
        if (await cuantos() > 0) reloj = setTimeout(correr, cada);
    }

    correr();
    escucharConexion(correr);
    const soltar = alCambiar(programar);   // algo recién guardado arranca el reloj
    return () => { vivo = false; clearTimeout(reloj); soltarConexion(correr); soltar(); };
}
