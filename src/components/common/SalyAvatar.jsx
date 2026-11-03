import React, { useId } from 'react';
import { ANIMOS_DE_SALY, SALY_TAMANO_MINIMO } from '@nucleo/utils/saly';

// Saly, la IA del portal. No es una persona ni tiene género (usuario,
// 2026-11-03: «es una IA, es una emoción, algo abstracto»): es un espíritu
// de luz nocturna —una llama suave con cola, un anillo que la orbita y motas
// que titilan—. El tono místico lo pidió el usuario
// («que se vea más mística»); la inspiración es la ATMÓSFERA de un cuento de
// noche, no un personaje: el dibujo es propio.
//
// Lo que siente se ve en tres cosas a la vez —su COLOR, su FORMA y su
// gesto—: alegría es cálida y se estira; atención es violeta y serena;
// preocupación es azul de medianoche y se encoge; cuando piensa, mira hacia
// arriba y las motas titilan rápido.
//
// Colores `--saly-*` de index.css: IDENTIDAD y no tema, iguales en los cuatro.
// La emoción la decide quien la usa (`animoDeSaly` del núcleo), nunca la IA.

const RASGO = { stroke: 'var(--saly-rasgo)', strokeWidth: 1.9, strokeLinecap: 'round', fill: 'none' };

// Una llama de luz con la cola hacia abajo y a la derecha.
const FORMA = 'M32 9 C42.5 9 50.5 17 50.5 27.5 C50.5 38 44 44 39 49 C36 52 36.5 56 40 59.5 C33 59 29 54.5 29.5 48.5 C20 46.5 13.5 38.5 13.5 27.5 C13.5 17 21.5 9 32 9 Z';

// Cómo se para cada emoción: estirada, serena, encogida o inclinada.
const POSTURA = {
    alegria:      'translate(0 -1.5) translate(32 30) scale(1 1.05) translate(-32 -30)',
    atencion:     '',
    preocupacion: 'translate(32 52) scale(1.06 0.9) translate(-32 -52)',
    pensando:     'rotate(-8 32 30)',
};

const MOTAS = {
    alegria:      [[9, 17, 1.4], [56, 31, 1.1], [7, 40, 1], [55, 49, 1.3], [17, 57, 0.9]],
    atencion:     [[9, 19, 1.2], [56, 36, 1], [12, 52, 0.9]],
    preocupacion: [[8, 30, 0.9], [57, 44, 0.8]],
    pensando:     [[10, 15, 1.3], [57, 28, 1.1], [6, 38, 1], [54, 52, 1.2], [18, 58, 0.9]],
};

function Cara({ animo }) {
    if (animo === 'alegria') {
        return (
            <g>
                <g {...RASGO}>
                    <path d="M22.8 26.6 Q25.6 23.2 28.4 26.6" />
                    <path d="M35.6 26.6 Q38.4 23.2 41.2 26.6" />
                </g>
                <path d="M27 32 Q32 38.5 37 32 Q32 34 27 32 Z" fill="var(--saly-rasgo)" />
            </g>
        );
    }
    const m = animo === 'pensando' ? { dx: 1.3, dy: -1.8 } : { dx: 0, dy: 0 };
    return (
        <g>
            {animo === 'preocupacion' && (
                <g {...RASGO} strokeWidth={1.6}>
                    <path d="M22 20.8 Q25 20.4 28.4 18.6" />
                    <path d="M35.6 18.6 Q39 20.4 42 20.8" />
                </g>
            )}
            <g className="saly-ojos">
                <ellipse cx={25.6 + m.dx} cy={26 + m.dy} rx="2.6" ry="3.4" fill="var(--saly-rasgo)" />
                <ellipse cx={38.4 + m.dx} cy={26 + m.dy} rx="2.6" ry="3.4" fill="var(--saly-rasgo)" />
                <circle cx={26.5 + m.dx} cy={24.7 + m.dy} r="0.95" fill="var(--saly-brillo)" />
                <circle cx={39.3 + m.dx} cy={24.7 + m.dy} r="0.95" fill="var(--saly-brillo)" />
                <circle cx={24.7 + m.dx} cy={27.6 + m.dy} r="0.45" fill="var(--saly-brillo)" opacity="0.7" />
                <circle cx={37.5 + m.dx} cy={27.6 + m.dy} r="0.45" fill="var(--saly-brillo)" opacity="0.7" />
            </g>
            {animo === 'preocupacion' && <path d="M27.5 35 Q29.8 33.1 32 34.7 Q34.2 36.3 36.5 34.4" {...RASGO} />}
            {animo === 'pensando' && <circle cx="33.6" cy="34" r="1.6" fill="var(--saly-rasgo)" />}
            {animo === 'atencion' && <path d="M28.4 33 Q32 35.8 35.6 33" {...RASGO} />}
        </g>
    );
}

/**
 * Saly.
 * @param {{ animo?: 'alegria' | 'atencion' | 'preocupacion' | 'pensando', size?: number, className?: string, decorativa?: boolean }} props
 */
export default function SalyAvatar({ animo = 'atencion', size = 40, className = '', decorativa = false }) {
    const a = ANIMOS_DE_SALY[animo] ? animo : 'atencion';
    const px = Math.max(Number(size) || 0, SALY_TAMANO_MINIMO);
    const id = `saly-${useId().replace(/:/g, '')}`;
    const rotulo = decorativa ? {} : { role: 'img', 'aria-label': `Saly, ${ANIMOS_DE_SALY[a].frase}` };
    const [c1, c2, c3] = [1, 2, 3].map(n => `var(--saly-${a}-${n})`);
    const anillo = { fill: 'none', stroke: c1, strokeWidth: 1.2, strokeLinecap: 'round', strokeDasharray: '3 4', className: 'saly-anillo' };
    return (
        <svg viewBox="0 0 64 64" width={px} height={px} className={`shrink-0 overflow-visible ${className}`}
            {...rotulo} aria-hidden={decorativa || undefined} focusable="false">
            <defs>
                <radialGradient id={`${id}-cuerpo`} cx="42%" cy="34%" r="70%">
                    <stop offset="0%" style={{ stopColor: c1 }} />
                    <stop offset="48%" style={{ stopColor: c2 }} />
                    <stop offset="100%" style={{ stopColor: c3 }} />
                </radialGradient>
                <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%">
                    <stop offset="35%" style={{ stopColor: c2, stopOpacity: 0.45 }} />
                    <stop offset="100%" style={{ stopColor: c3, stopOpacity: 0 }} />
                </radialGradient>
                <filter id={`${id}-brillo`} x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="2.6" />
                </filter>
            </defs>

            {/* el halo y el resplandor: la luz que la rodea */}
            <circle cx="32" cy="32" r="31" fill={`url(#${id}-halo)`} />

            {/* la mitad de atrás del anillo, que pasa detrás de ella */}
            <g transform="rotate(-14 32 42)" opacity="0.75">
                <path d="M7 42 A25 6 0 0 1 57 42" {...anillo} />
            </g>

            <g className="saly-cuerpo">
                <g transform={POSTURA[a]}>
                    <path d={FORMA} fill={c2} filter={`url(#${id}-brillo)`} opacity="0.7" />
                    <path d={FORMA} fill={`url(#${id}-cuerpo)`} stroke={c1} strokeOpacity="0.55" strokeWidth="0.8" />
                    <Cara animo={a} />
                </g>
            </g>

            {/* la mitad de adelante del anillo */}
            <g transform="rotate(-14 32 42)">
                <path d="M7 42 A25 6 0 0 0 57 42" {...anillo} />
            </g>


            <g fill="var(--saly-luna)">
                {MOTAS[a].map(([x, y, r]) => (
                    <circle key={`${x}-${y}`} cx={x} cy={y} r={r}
                        className={`saly-mota${a === 'pensando' ? ' saly-mota-viva' : ''}`} />
                ))}
            </g>
        </svg>
    );
}
