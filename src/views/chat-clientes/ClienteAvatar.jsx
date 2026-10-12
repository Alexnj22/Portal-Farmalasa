import React from 'react';
import LiquidAvatar from '../../components/common/LiquidAvatar';
import { inicialesDeCliente } from './etiquetas';

// La foto de perfil del cliente (la sube desde la app, es opcional) o sus dos
// iniciales. No es `AvatarConEstado`: ése es de las fichas del EQUIPO.
export default function ClienteAvatar({ conversacion, size = 'md' }) {
    const caja = size === 'lg' ? 'w-12 h-12 text-body-sm' : 'w-9 h-9 text-caption';
    if (conversacion?.foto_url) {
        return <LiquidAvatar src={conversacion.foto_url} alt={`Foto de ${conversacion.cliente ?? 'cliente'}`} className={`${caja} rounded-full shrink-0`} optimize={false} />;
    }
    return (
        <span aria-hidden="true" className={`${caja} rounded-full shrink-0 flex items-center justify-center bg-brand/12 text-brand-text font-black`}>
            {inicialesDeCliente(conversacion?.cliente)}
        </span>
    );
}
