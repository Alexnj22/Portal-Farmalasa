import { useEffect, useState } from 'react';
import { fetchFarmaciaEstado } from '@nucleo/data/horarios';

/**
 * El estado de la farmacia como lo ve el cliente en el chat, releído cada
 * minuto: decide cuál de los dos mensajes automáticos recibe quien escribe
 * ahora. Lo calcula la base (`farmacia_estado()`), con los horarios especiales
 * y los feriados adentro.
 */
export default function useFarmaciaEstado(intervaloMs = 60_000) {
    const [estado, setEstado] = useState(null);
    useEffect(() => {
        let vivo = true;
        const leer = () => fetchFarmaciaEstado()
            .then((e) => { if (vivo) setEstado(e ?? null); })
            .catch((err) => console.error('chat: no se pudo leer el estado de la farmacia', err));
        leer();
        const t = setInterval(leer, intervaloMs);
        return () => { vivo = false; clearInterval(t); };
    }, [intervaloMs]);
    return estado;
}
