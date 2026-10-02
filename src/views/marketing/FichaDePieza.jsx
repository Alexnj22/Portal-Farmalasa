import React from 'react';
import { Megaphone, MessageSquare, Send, Store } from 'lucide-react';
import { clickable } from '@nucleo/utils/clickable';
import { formatoDe, estadoDe, ROTULO_CORTO } from '@nucleo/utils/marketing';
import { hora12 } from '@nucleo/utils/hora';
import { ICONOS_FORMATO, ICONO_DESCONOCIDO, puntoDeMarca, tonoDeEstado } from './iconos';
import { FlujoMini } from './FlujoDePieza';
import { UltimoCambio } from './Historial';

/**
 * La pieza dentro del día. El ESTADO manda en cómo se ve: la franja de la
 * izquierda, el fondo y el ícono son del color de su paso en el flujo, y la
 * línea de abajo dice cuánto camino lleva (de «Pendiente» a «Publicada»). Así
 * el mes se lee de un vistazo, sin abrir nada.
 *
 * En grande (el flujo, la agenda del teléfono) lleva además las marcas por
 * nombre y el último cambio con la foto de quién lo hizo.
 *
 * El tinte va en el RELLENO, así que no lleva `data-surface` (DESIGN.md §5.1).
 */
export default function FichaDePieza({ pieza, marcas = [], comentarios, cambio, personas, onAbrir, arrastrable = false, grande = false }) {
    const formato = formatoDe(pieza.formato);
    const Icono = ICONOS_FORMATO[formato.icono] || ICONO_DESCONOCIDO;
    const est = estadoDe(pieza.estado);
    const tono = tonoDeEstado(pieza.estado);
    const IconoEstado = tono.icono;
    const pendientes = comentarios?.cambiosAbiertos || 0;
    const esperando = pieza.estado === 'finalizado' && pieza.enviada_at;
    return (
        <div {...clickable(onAbrir, { label: `Abrir ${pieza.titulo}` })}
            draggable={arrastrable || undefined}
            onDragStart={arrastrable ? (e) => { e.dataTransfer.setData('text/pieza', pieza.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
            className={`relative overflow-hidden rounded-lg border ${tono.borde} ${tono.suave}
                min-h-[var(--tap-min)] flex flex-col active:scale-[0.97] transition-shadow hover:shadow-md
                ${grande ? 'pl-4 pr-3 py-3 gap-2' : 'pl-2.5 pr-1.5 pt-1.5 pb-1.5 gap-1'}
                ${arrastrable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
            title={`${formato.label} · ${pieza.titulo} · ${est.label}`}>
            <span aria-hidden className={`absolute left-0 inset-y-0 ${grande ? 'w-1.5' : 'w-1'} ${tono.barra}`} />

            <div className="flex items-start gap-1.5 min-w-0">
                <span className={`shrink-0 flex items-center justify-center rounded-md bg-surface-card ${grande ? 'w-7 h-7' : 'w-5 h-5'}`}>
                    <Icono size={grande ? 15 : 11} className="text-content-2" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                    <p className={`${grande ? 'text-body-sm' : 'text-micro'} font-semibold text-content leading-snug line-clamp-2 break-words`}>
                        {pieza.titulo}
                    </p>
                    {(pieza.hora || grande) && (
                        <p className="text-micro text-content-3 tabular-nums truncate">
                            {pieza.hora ? hora12(pieza.hora) : ''}{pieza.hora && grande ? ' · ' : ''}{grande ? formato.label : ''}
                        </p>
                    )}
                </div>
                {marcas.length > 0 && (
                    <span className="flex -space-x-1 shrink-0 pt-0.5" aria-label={marcas.map((m) => m.nombre).join(', ')}>
                        {marcas.map((m) => (
                            <span key={m.id} className={`${grande ? 'w-2.5 h-2.5' : 'w-2 h-2'} rounded-full ring-2 ring-surface-card ${puntoDeMarca(m.color)}`} />
                        ))}
                    </span>
                )}
            </div>

            <div className="flex items-center gap-1.5 min-w-0">
                <span className={`flex items-center gap-1 min-w-0 font-semibold ${tono.texto} ${grande ? 'text-label' : 'text-micro'}`}>
                    <IconoEstado size={grande ? 13 : 11} className="shrink-0" aria-hidden />
                    <span className="truncate">{grande ? est.label : ROTULO_CORTO[pieza.estado]}</span>
                </span>
                <span className="ml-auto flex items-center gap-1 shrink-0">
                    {esperando && <Send size={grande ? 13 : 10} className="text-chart-3-text" aria-label="Enviada a revisión" />}
                    {pieza.liberada && <Store size={grande ? 13 : 10} className="text-success-text" aria-label="Liberada a las salas" />}
                    {pieza.pautar && <Megaphone size={grande ? 13 : 10} className="text-warning-text" aria-label="Se pauta" />}
                    {pendientes > 0 && (
                        <span className="flex items-center gap-0.5 rounded-full bg-warning/15 text-warning-text px-1 text-micro font-semibold"
                            aria-label={`${pendientes} cambios sin resolver`}>
                            <MessageSquare size={9} />{pendientes}
                        </span>
                    )}
                </span>
            </div>

            <FlujoMini estado={pieza.estado} />

            {grande && marcas.length > 0 && (
                <p className="text-micro text-content-3 truncate">{marcas.map((m) => m.nombre).join(' · ')}</p>
            )}
            {grande && <UltimoCambio cambio={cambio} personas={personas} />}
        </div>
    );
}
