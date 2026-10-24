import { useEffect, useState } from 'react';
import { fetchReglasDeReserva } from '../data/reservas';

/**
 * Las reglas de reserva que rigen HOY (reglamento v1 o v2, por fecha:
 * `reserva_reglas()` de la base), leídas UNA vez por carga de la app.
 *
 * Mientras no llegan —o si fallan— devuelve `null`, y quien la usa escribe la
 * regla v1, que es la que rige hasta `reglas_v2_desde()`. La fecha NO se
 * escribe acá: la decide la base, para que el papel, la pantalla y el servidor
 * no puedan cambiar de regla en días distintos.
 */
let promesa = null;
export function useReglasDeReserva() {
    const [reglas, setReglas] = useState(null);
    useEffect(() => {
        let vivo = true;
        if (!promesa) {
            promesa = fetchReglasDeReserva().catch((err) => {
                console.error('useReglasDeReserva: no se pudieron leer las reglas', err);
                promesa = null;
                return null;
            });
        }
        promesa.then((r) => { if (vivo) setReglas(r); });
        return () => { vivo = false; };
    }, []);
    return reglas;
}
