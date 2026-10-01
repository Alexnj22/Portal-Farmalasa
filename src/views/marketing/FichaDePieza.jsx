import React from 'react';
import { Megaphone, MessageSquare } from 'lucide-react';
import Badge from '../../components/common/Badge';
import { clickable } from '@nucleo/utils/clickable';
import { formatoDe, estadoDe } from '@nucleo/utils/marketing';
import { hora12 } from '@nucleo/utils/hora';
import { ICONOS_FORMATO, ICONO_DESCONOCIDO, puntoDeMarca } from './iconos';
import { UltimoCambio } from './Historial';

/**
 * La pieza dentro del día: formato, marcas, título y cómo va. En grande (el
 * flujo, la agenda del teléfono) lleva además el último cambio con la foto y
 * el nombre de quién lo hizo.
 */
export default function FichaDePieza({ pieza, marcas = [], comentarios, cambio, personas, onAbrir, arrastrable = false, grande = false }) {
    const formato = formatoDe(pieza.formato);
    const Icono = ICONOS_FORMATO[formato.icono] || ICONO_DESCONOCIDO;
    const est = estadoDe(pieza.estado);
    const pendientes = comentarios?.cambiosAbiertos || 0;
    return (
        <div {...clickable(onAbrir, { label: `Abrir ${pieza.titulo}` })}
            draggable={arrastrable || undefined}
            onDragStart={arrastrable ? (e) => { e.dataTransfer.setData('text/pieza', pieza.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
            data-surface="card"
            className={`min-h-[var(--tap-min)] rounded-md px-1.5 py-1 flex flex-col gap-0.5 active:scale-[0.97] ${grande ? 'p-3 gap-1.5' : ''}`}
            title={`${formato.label} · ${pieza.titulo} · ${est.label}`}>
            <div className="flex items-center gap-1 min-w-0">
                <span className="flex -space-x-0.5 shrink-0" aria-hidden>
                    {marcas.map((m) => <span key={m.id} className={`w-1.5 h-1.5 rounded-full ${puntoDeMarca(m.color)}`} />)}
                </span>
                <Icono size={grande ? 14 : 11} className="text-content-3 shrink-0" aria-hidden />
                {pieza.hora && <span className="text-micro tabular-nums text-content-3 shrink-0">{hora12(pieza.hora)}</span>}
                <span className={`${grande ? 'text-body-sm' : 'text-micro'} font-semibold text-content truncate`}>{pieza.titulo}</span>
            </div>
            <div className="flex items-center gap-1 min-w-0">
                <Badge variant={est.variant} size="sm" uppercase={false}>{est.label}</Badge>
                {pieza.pautar && <Megaphone size={11} className="text-warning shrink-0" aria-label="Se pauta" />}
                {pendientes > 0 && (
                    <span className="flex items-center gap-0.5 text-micro text-warning shrink-0" aria-label={`${pendientes} cambios sin resolver`}>
                        <MessageSquare size={10} />{pendientes}
                    </span>
                )}
                {grande && marcas.length > 0 && (
                    <span className="text-micro text-content-3 truncate ml-auto">{marcas.map((m) => m.nombre).join(' · ')}</span>
                )}
            </div>
            {grande && <UltimoCambio cambio={cambio} personas={personas} />}
        </div>
    );
}
