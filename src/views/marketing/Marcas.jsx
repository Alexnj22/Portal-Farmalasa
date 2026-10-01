import React from 'react';

/**
 * Las marcas dibujadas sobre un diseño: un `<svg>` encima de la imagen con
 * `viewBox` de 100 de ancho y el alto en la proporción de la imagen
 * (`proporcion` = alto/ancho), así las coordenadas relativas (0–1) que guarda
 * la base caen en el mismo sitio a cualquier tamaño y un punto sigue siendo
 * redondo. El color sale del token de
 * peligro por `currentColor`: el papel de la marca es llamar la atención.
 *
 * `numero` rotula cada marca con el número de su comentario en la lista.
 */
export default function Marcas({ marcas, borrador = null, resaltada = null, proporcion = 1 }) {
    const H = 100 * (proporcion || 1);
    const todas = [...(marcas || []), ...(borrador ? [{ ...borrador, numero: '+' }] : [])];
    return (
        <svg viewBox={`0 0 100 ${H}`} className="absolute inset-0 w-full h-full pointer-events-none text-danger"
            aria-hidden>
            {todas.map((m, i) => {
                const fuerte = resaltada == null || resaltada === m.numero;
                const op = fuerte ? 1 : 0.35;
                if (m.tipo === 'recuadro') {
                    return (
                        <g key={i} opacity={op}>
                            <rect x={m.x * 100} y={m.y * H} width={m.w * 100} height={m.h * H}
                                fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                            <Rotulo x={m.x * 100} y={m.y * H} n={m.numero} />
                        </g>
                    );
                }
                if (m.tipo === 'trazo' && m.puntos?.length) {
                    const d = m.puntos.map(([x, y], k) => `${k ? 'L' : 'M'}${x * 100},${y * H}`).join(' ');
                    const [x0, y0] = m.puntos[0];
                    return (
                        <g key={i} opacity={op}>
                            <path d={d} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                                strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                            <Rotulo x={x0 * 100} y={y0 * H} n={m.numero} />
                        </g>
                    );
                }
                return (
                    <g key={i} opacity={op}>
                        <circle cx={m.x * 100} cy={m.y * H} r="1.6" fill="currentColor" />
                        <Rotulo x={m.x * 100} y={m.y * H} n={m.numero} />
                    </g>
                );
            })}
        </svg>
    );
}

function Rotulo({ x, y, n }) {
    if (n == null) return null;
    return (
        <text x={x + 1.8} y={y - 1.2} fontSize="3.4" fontWeight="700" fill="currentColor"
            style={{ paintOrder: 'stroke', stroke: 'var(--surface-sheet)', strokeWidth: 0.8 }}>
            {n}
        </text>
    );
}
