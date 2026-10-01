import React from 'react';
import { Bot } from 'lucide-react';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import { fraseDeHistorial } from '@nucleo/utils/marketing';

/**
 * Quién hizo un cambio: foto y nombre SIEMPRE (pedido del usuario). Sin
 * persona (`actor` vacío) es el proceso de las 8:00, y se dice así en vez de
 * dejar el hueco.
 */
export function Quien({ id, personas, px = 20 }) {
    if (!id) {
        return (
            <span className="flex items-center gap-1.5 min-w-0">
                <span className="w-5 h-5 rounded-full bg-surface-input flex items-center justify-center shrink-0" aria-hidden>
                    <Bot size={12} className="text-content-3" />
                </span>
                <span className="text-label font-semibold text-content-2 truncate">Automático</span>
            </span>
        );
    }
    const p = personas?.[id];
    return (
        <span className="flex items-center gap-1.5 min-w-0">
            <AvatarConEstado emp={p || { id }} px={px} radio="rounded-full" marco="" />
            <span className="text-label font-semibold text-content truncate">{shortEmployeeName(p?.name)}</span>
        </span>
    );
}

/** El último cambio de una pieza, en una línea, para la tarjeta del flujo. */
export function UltimoCambio({ cambio, personas }) {
    if (!cambio) return null;
    return (
        // Nombre y hora en líneas distintas: en una columna angosta del flujo,
        // juntos cortaban el nombre a una letra, y el nombre va siempre.
        <div className="flex flex-col gap-0.5 min-w-0 text-micro text-content-3">
            <Quien id={cambio.actor} personas={personas} px={16} />
            <span className="pl-[22px]">{fechaHora12(cambio.created_at, { day: 'numeric', month: 'short' })}</span>
        </div>
    );
}

/** La línea de tiempo completa de una pieza. */
export default function Historial({ entradas, personas }) {
    if (!entradas?.length) return <p className="text-body-sm text-content-3">Sin cambios todavía.</p>;
    return (
        <ol className="space-y-2.5">
            {entradas.map((h) => (
                <li key={h.id} className="flex items-start gap-2 min-w-0">
                    <div className="min-w-0 flex-1">
                        <Quien id={h.actor} personas={personas} />
                        <p className="text-body-sm text-content-2 pl-[26px]">{fraseDeHistorial(h)}</p>
                    </div>
                    <span className="text-micro text-content-3 shrink-0 tabular-nums">
                        {fechaHora12(h.created_at, { day: 'numeric', month: 'short' })}
                    </span>
                </li>
            ))}
        </ol>
    );
}
