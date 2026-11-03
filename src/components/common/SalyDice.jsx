import React from 'react';
import SalyAvatar from './SalyAvatar';
import { ANIMOS_DE_SALY } from '@nucleo/utils/saly';

// Lo que Saly dice: su forma, su nombre, qué siente, y
// el texto en un globo. Es el mismo marco en todos los lugares donde habla,
// para que se la reconozca sin leer el rótulo.

/**
 * @param {{ animo?: string, titulo?: React.ReactNode, children: React.ReactNode,
 *           pie?: React.ReactNode, tamano?: 'md' | 'lg', className?: string }} props
 */
export default function SalyDice({ animo = 'atencion', titulo = null, children, pie = null, tamano = 'md', className = '' }) {
    const a = ANIMOS_DE_SALY[animo] ? animo : 'atencion';
    const grande = tamano === 'lg';
    return (
        <div className={`flex items-start gap-3 ${className}`}>
            <SalyAvatar animo={a} size={grande ? 56 : 40} />
            <div className="min-w-0 flex-1 space-y-1.5">
                <p className="flex flex-wrap items-baseline gap-x-1.5 text-body-sm">
                    <span className="font-black text-content">Saly</span>
                    <span className="text-content-3">{ANIMOS_DE_SALY[a].frase}</span>
                    {titulo && <span className="text-content-3">· {titulo}</span>}
                </p>
                <div data-animo={a} className="saly-toque rounded-2xl rounded-tl-md px-3.5 py-2.5">
                    <div className={`${grande ? 'text-body' : 'text-body-sm'} text-content leading-relaxed`}>{children}</div>
                </div>
                {pie && <div className="text-micro text-content-3">{pie}</div>}
            </div>
        </div>
    );
}
