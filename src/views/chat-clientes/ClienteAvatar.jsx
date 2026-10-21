import React from 'react';
import LiquidAvatar from '../../components/common/LiquidAvatar';
import { inicialesDeCliente } from './etiquetas';
import { claveDeNivel } from '@nucleo/utils/chatClientes';

// La foto de perfil del cliente (la sube desde la app, es opcional) o sus dos
// iniciales, dentro del aro de su nivel. No es `AvatarConEstado`: ése es de
// las fichas del EQUIPO.
//
// El aro (2026-10-21) es el de la app de puntos: el metal de su tarjeta de
// socio —bronce, plata, oro, platino; jade, zafiro, rubí, diamante si es
// mayorista—, con el reflejo corriendo. Si es del equipo lleva un SEGUNDO aro
// afuera, rosa y negro como la tarjeta del equipo. Antes Team ganaba y tapaba
// el nivel con un solo anillo rosa plano. Todo el dibujo vive en
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
        <span className="aro-cliente" data-nivel={nivel ?? undefined} data-team={c?.es_team ? '' : undefined}
            data-tam={size} data-animado={animado ? '' : undefined}>
            {cara}
        </span>
    );
}
