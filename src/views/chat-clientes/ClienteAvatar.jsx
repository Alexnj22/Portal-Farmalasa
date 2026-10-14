import React from 'react';
import LiquidAvatar from '../../components/common/LiquidAvatar';
import { inicialesDeCliente } from './etiquetas';
import { claveDeNivel } from '@nucleo/utils/chatClientes';

// El anillo con el color de su tarjeta de socio (2026-10-14): bronce, plata,
// oro, platino; los rangos de mayoreo; Team. Clases enteras (no armadas) para
// que Tailwind las vea; los colores son tokens `--nivel-*` de index.css.
const ANILLO = {
    bronce: 'ring-2 ring-nivel-bronce', plata: 'ring-2 ring-nivel-plata', oro: 'ring-2 ring-nivel-oro',
    platino: 'ring-2 ring-nivel-platino', team: 'ring-2 ring-nivel-team', jade: 'ring-2 ring-nivel-jade',
    zafiro: 'ring-2 ring-nivel-zafiro', rubi: 'ring-2 ring-nivel-rubi', diamante: 'ring-2 ring-nivel-diamante',
};

// La foto de perfil del cliente (la sube desde la app, es opcional) o sus dos
// iniciales. No es `AvatarConEstado`: ése es de las fichas del EQUIPO.
export default function ClienteAvatar({ conversacion, size = 'md' }) {
    const caja = size === 'lg' ? 'w-12 h-12 text-body-sm' : 'w-9 h-9 text-caption';
    const anillo = ANILLO[claveDeNivel(conversacion)] ?? '';
    if (conversacion?.foto_url) {
        return <LiquidAvatar src={conversacion.foto_url} alt={`Foto de ${conversacion.cliente ?? 'cliente'}`} className={`${caja} rounded-full shrink-0 ${anillo}`} optimize={false} />;
    }
    return (
        <span aria-hidden="true" className={`${caja} rounded-full shrink-0 flex items-center justify-center bg-brand/12 text-brand-text font-black ${anillo}`}>
            {inicialesDeCliente(conversacion?.cliente)}
        </span>
    );
}
