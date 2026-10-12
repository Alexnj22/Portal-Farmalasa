import React from 'react';
import { CalendarHeart, Moon, Store } from 'lucide-react';
import Badge from '../../components/common/Badge';
import { textoDelEstado } from '@nucleo/utils/horarioDelChat';

/** La píldora del estado de la farmacia (ver `useFarmaciaEstado`). */
export default function EstadoDeLaFarmacia({ estado }) {
    const linea = textoDelEstado(estado);
    if (!linea) return null;
    return (
        <span className="inline-flex flex-wrap items-center gap-1.5 min-w-0" role="status" aria-live="polite">
            <Badge uppercase={false} variant={linea.tono} icon={estado.abierta ? Store : Moon}>{linea.texto}</Badge>
            {linea.feriado && <Badge uppercase={false} variant="warning" icon={CalendarHeart}>{`Feriado: ${linea.feriado}`}</Badge>}
        </span>
    );
}
