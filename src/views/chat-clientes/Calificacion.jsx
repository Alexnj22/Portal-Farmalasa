import React, { useCallback, useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import Badge from '../../components/common/Badge';
import LiquidTooltip from '../../components/common/LiquidTooltip';
import { fetchCalificacionesRecientes } from '@nucleo/data/chatClientes';
import { resumenDeCalificaciones } from '@nucleo/utils/chatClientes';
import { useRefrescoEnVivo } from '@nucleo/hooks/useRefrescoEnVivo';

// La calificación que deja el cliente desde la app al resolverse su
// conversación (1 a 5 estrellas y un comentario opcional), y el promedio de
// los últimos 30 días para el encabezado de la vista.

/** Cinco estrellas, `valor` de ellas llenas. Sólo lectura. */
export function Estrellas({ valor, px = 12 }) {
    const n = Math.max(0, Math.min(5, Math.round(Number(valor) || 0)));
    return (
        <span role="img" aria-label={`${n} de 5 estrellas`} className="inline-flex items-center gap-px shrink-0">
            {[1, 2, 3, 4, 5].map((i) => (
                <Star key={i} size={px} aria-hidden="true" strokeWidth={2}
                    className={i <= n ? 'text-warning fill-current' : 'text-content-3 opacity-40'} />
            ))}
        </span>
    );
}

/** La calificación en un renglón, para el encabezado del hilo: las
 *  estrellas y el comentario recortado (entero al pasar el ratón). Como bloque
 *  aparte empujaba el hilo hacia abajo en el panel de la burbuja. */
export function CalificacionEnLinea({ conversacion: c }) {
    if (!c?.calificacion) return null;
    const comentario = c.calificacion_comentario ? `«${c.calificacion_comentario}»` : '';
    return (
        <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
            <span className="text-content-3">Calificó</span>
            <Estrellas valor={c.calificacion} />
            {comentario && (
                <LiquidTooltip content={comentario} className="min-w-0 truncate">
                    <span className="italic text-content-2">{comentario}</span>
                </LiquidTooltip>
            )}
        </span>
    );
}

/** «★ 4.6 · 12 calificaciones en 30 días», para el encabezado. Nada sin datos. */
export function ResumenDeCalificaciones() {
    const [resumen, setResumen] = useState(undefined);
    const leer = useCallback(async () => {
        try {
            setResumen(resumenDeCalificaciones(await fetchCalificacionesRecientes(30)));
        } catch (err) {
            console.error('chat-clientes: no se pudo leer el promedio de calificaciones', err);
            setResumen(null);
        }
    }, []);
    useEffect(() => {
        let vivo = true;
        fetchCalificacionesRecientes(30)
            .then((filas) => { if (vivo) setResumen(resumenDeCalificaciones(filas)); })
            .catch((err) => console.error('chat-clientes: no se pudo leer el promedio de calificaciones', err));
        return () => { vivo = false; };
    }, []);
    // Reloj lento a propósito, sin canal de realtime: el promedio de un mes no
    // se mueve por minuto.
    useRefrescoEnVivo(leer, { ms: 300_000 });

    if (!resumen) return null;
    const texto = `${resumen.promedio.toFixed(1)} · ${resumen.cuantas} ${resumen.cuantas === 1 ? 'calificación' : 'calificaciones'} en 30 días`;
    return (
        <Badge uppercase={false} variant="warning" icon={Star}
            title="Promedio de las calificaciones que dejaron los clientes en los últimos 30 días">
            <span className="tabular-nums">{texto}</span>
        </Badge>
    );
}
