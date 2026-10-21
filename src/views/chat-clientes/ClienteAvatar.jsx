import React from 'react';
import { Users } from 'lucide-react';
import LiquidAvatar from '../../components/common/LiquidAvatar';
import { inicialesDeCliente } from './etiquetas';
import { claveDeNivel } from '@nucleo/utils/chatClientes';

// La foto de perfil del cliente (la sube desde la app, es opcional) o sus dos
// iniciales, dentro del aro de su nivel. No es `AvatarConEstado`: ése es de
// las fichas del EQUIPO.
//
// El aro (2026-10-21) es el de la app de puntos: el metal de su tarjeta de
// socio —bronce, plata, oro, platino; jade, zafiro, rubí, diamante si es
// mayorista—, con el reflejo corriendo. Si es del equipo, un emblema rosa en
// la esquina (antes Team tapaba el nivel con un anillo rosa plano; después
// fue un segundo aro, y era demasiado). Todo el dibujo vive en
// `.aro-cliente` (index.css). `animado`: sólo donde hay UNO a la vista (el
// encabezado del hilo); en la lista serían veinte girando a la vez.
export default function ClienteAvatar({ conversacion: c, size = 'md', animado = false }) {
    const caja = size === 'lg' ? 'w-12 h-12 text-body-sm' : 'w-9 h-9 text-caption';
    // El nivel sin mirar si es del equipo: el equipo va en el segundo aro.
    const nivel = claveDeNivel({ ...c, es_team: false });
    const cara = c?.foto_url
        ? <LiquidAvatar src={c.foto_url} alt={`Foto de ${c.cliente ?? 'cliente'}`} className={`${caja} rounded-full`} optimize={false} />
        : (
            <span aria-hidden="true" className={`${caja} rounded-full flex items-center justify-center bg-brand/12 text-brand-text font-black`}>
                {inicialesDeCliente(c?.cliente)}
            </span>
        );
    return (
        <span className="aro-cliente" data-nivel={nivel ?? undefined}
            data-tam={size} data-animado={animado ? '' : undefined}>
            {cara}
            {c?.es_team && (
                <span className="aro-cliente-team" role="img" aria-label="Del equipo">
                    <Users size={size === 'lg' ? 10 : 9} strokeWidth={3} aria-hidden="true" />
                </span>
            )}
        </span>
    );
}
