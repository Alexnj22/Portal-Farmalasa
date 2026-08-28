/**
 * Marcar a mano las cuatro esquinas del papel.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * El portal ya sabía enderezar la perspectiva —`utils/perspectiva.js` redibuja
 * la foto como si se hubiera tomado de frente— pero las cuatro esquinas salían
 * SIEMPRE de la lectura automática. Y cuando esa lectura falla, falla en
 * silencio: el papel queda torcido, o peor, se endereza usando una esquina que
 * está en el mostrador y el documento sale deformado. El usuario lo dijo así:
 * «la IA de ajustar las esquinas no funciona del todo bien».
 *
 * La salida no es un modelo mejor: es que la persona pueda correr la esquina
 * con el dedo. Una foto de un papel tiene cuatro esquinas y quien la sacó las
 * ve; el modelo es la comodidad, no la autoridad.
 *
 * ── Por qué no se hace con el canónico de recorte ───────────────────────────
 *
 * `react-easy-crop` recorta un RECTÁNGULO: sus cuatro puntos están atados entre
 * sí, así que no puede describir un trapecio. Un papel apoyado en un mostrador
 * es justamente un trapecio — ése es el problema que se viene a resolver. Por
 * eso acá las esquinas son cuatro puntos independientes y el dibujo es un
 * polígono, no una caja.
 *
 * ── Coordenadas: fracciones, no píxeles ─────────────────────────────────────
 *
 * Se entra y se sale en fracciones de 0 a 1 sobre la imagen, que es como las
 * devuelve la lectura y como las espera `rectificar`. Los píxeles de pantalla
 * son un detalle de este componente: la misma esquina vale lo mismo en un
 * teléfono y en un monitor, y una foto de 4000 px no obliga a nada.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import Button from './Button';
import { ESQUINAS_ENTERAS } from '../../utils/perspectiva';

const NOMBRES = ['arriba a la izquierda', 'arriba a la derecha',
    'abajo a la derecha', 'abajo a la izquierda'];

const acotar = (n) => Math.min(1, Math.max(0, n));

/**
 * @param {string}   src        la imagen (URL de objeto o data URI)
 * @param {{x,y}[]}  iniciales  cuatro esquinas en fracciones, en orden ↖ ↗ ↘ ↙
 * @param {Function} onListo    recibe las cuatro esquinas ajustadas
 * @param {Function} onCancelar
 */
export default function AjusteDeEsquinas({ src, iniciales, onListo, onCancelar }) {
    const [puntos, setPuntos] = useState(() =>
        (Array.isArray(iniciales) && iniciales.length === 4
            ? iniciales.map(p => ({ x: acotar(p.x), y: acotar(p.y) }))
            : ESQUINAS_ENTERAS));
    const [arrastrando, setArrastrando] = useState(null);
    const imgRef = useRef(null);
    const marcoRef = useRef(null);
    /* La caja de la IMAGEN DIBUJADA, que no es la del marco: con
     * `object-contain` sobra franja arriba y abajo (o a los lados), y medir el
     * marco pondría las esquinas corridas justo esa franja. Se remide al
     * cambiar el tamaño de la ventana porque girar el teléfono la cambia. */
    const [caja, setCaja] = useState(null);

    const medir = useCallback(() => {
        const el = imgRef.current, marco = marcoRef.current;
        if (!el || !marco) return;
        const { naturalWidth: nw, naturalHeight: nh } = el;
        const r = el.getBoundingClientRect();
        const m = marco.getBoundingClientRect();
        if (!nw || !nh || !r.width || !r.height) return;
        // `object-contain`: la imagen entra entera y sobra en UN eje.
        const escala = Math.min(r.width / nw, r.height / nh);
        const w = nw * escala, h = nh * escala;
        setCaja({
            // Relativa al MARCO (para posicionar con `absolute`) y también
            // absoluta en la ventana (para convertir el `clientX` del arrastre).
            left: r.left - m.left + (r.width - w) / 2,
            top:  r.top  - m.top  + (r.height - h) / 2,
            vLeft: r.left + (r.width - w) / 2,
            vTop:  r.top  + (r.height - h) / 2,
            w, h,
        });
    }, []);

    useEffect(() => {
        medir();
        window.addEventListener('resize', medir);
        return () => window.removeEventListener('resize', medir);
    }, [medir, src]);

    /* Un solo juego de manejadores para el dedo y para el ratón: `pointer*` los
     * unifica, y `setPointerCapture` es lo que hace que la esquina siga al dedo
     * aunque se salga del punto — sin eso, un arrastre rápido lo suelta. */
    const alBajar = (i) => (e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setArrastrando(i);
    };
    const alMover = (i) => (e) => {
        if (arrastrando !== i || !caja) return;
        e.preventDefault();
        setPuntos(prev => prev.map((p, j) => (j === i
            ? { x: acotar((e.clientX - caja.vLeft) / caja.w), y: acotar((e.clientY - caja.vTop) / caja.h) }
            : p)));
    };
    const alSoltar = () => setArrastrando(null);

    const enPantalla = (p) => (caja
        ? { left: caja.left + p.x * caja.w, top: caja.top + p.y * caja.h }
        : null);

    return (
        <div className="absolute inset-0 z-modal flex flex-col bg-surface-card">
            <div ref={marcoRef} className="relative flex-1 min-h-0">
                {/* `select-none` y `touch-none`: sin ellos, arrastrar sobre la
                    imagen selecciona la foto en escritorio y desplaza la página
                    en el teléfono, o sea que la esquina no se mueve. */}
                <img ref={imgRef} src={src} alt="" onLoad={medir}
                    className="w-full h-full object-contain select-none touch-none pointer-events-none" />

                {caja && (
                    <>
                        {/* El polígono que une las cuatro esquinas: sin él no se
                            ve QUÉ se está describiendo, sólo cuatro puntos
                            sueltos. Va detrás de los manejadores y no recibe
                            toques. */}
                        <svg className="absolute pointer-events-none"
                            style={{ left: caja.left, top: caja.top, width: caja.w, height: caja.h }}
                            viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                            <polygon
                                points={puntos.map(p => `${p.x},${p.y}`).join(' ')}
                                fill="var(--brand)" fillOpacity="0.14"
                                stroke="var(--brand)"
                                strokeWidth="0.004"
                                vectorEffect="non-scaling-stroke" />
                        </svg>

                        {puntos.map((p, i) => {
                            const pos = enPantalla(p);
                            return (
                                <button
                                    key={NOMBRES[i]}
                                    type="button"
                                    aria-label={`Esquina ${NOMBRES[i]}`}
                                    onPointerDown={alBajar(i)}
                                    onPointerMove={alMover(i)}
                                    onPointerUp={alSoltar}
                                    onPointerCancel={alSoltar}
                                    /* El blanco de dedo son 44 pt y el punto que
                                       se ve es chico a propósito: un círculo de
                                       44 px tapa justo la esquina que hay que
                                       ver para colocarlo. */
                                    className="absolute min-h-[var(--tap-min)] min-w-[var(--tap-min)]
                                               -translate-x-1/2 -translate-y-1/2 rounded-full
                                               flex items-center justify-center touch-none
                                               active:scale-[0.97] transition-transform"
                                    style={{ left: pos.left, top: pos.top }}>
                                    {/* El aro va con el token de tarjeta y no con
                                        un blanco crudo: sobre una foto oscura el
                                        punto tiene que despegarse del fondo, y en
                                        tema oscuro un blanco fijo es el único
                                        elemento que no acompaña. */}
                                    <span className={`block rounded-full border-2 border-border-card
                                                      shadow-[var(--shadow-glass-2)] transition-all
                                                      ${arrastrando === i ? 'w-6 h-6 bg-brand' : 'w-4 h-4 bg-brand'}`} />
                                </button>
                            );
                        })}
                    </>
                )}
            </div>

            <div className="shrink-0 p-3 flex flex-wrap items-center gap-2 border-t border-divider">
                <p className="flex-1 min-w-[12rem] text-caption text-content-3 font-medium leading-snug">
                    Arrastra cada punto hasta la esquina del papel. El portal lo va a redibujar
                    como si lo hubieras fotografiado de frente.
                </p>
                <Button variant="ghost" size="sm" icon={RotateCcw}
                    onClick={() => setPuntos(ESQUINAS_ENTERAS)}>
                    Toda la foto
                </Button>
                <Button variant="ghost" size="sm" icon={X} onClick={onCancelar}>
                    Cancelar
                </Button>
                <Button variant="primary" size="sm" icon={Check} onClick={() => onListo(puntos)}>
                    Enderezar
                </Button>
            </div>
        </div>
    );
}
