/**
 * La superficie donde se encuadra el documento: la foto, sus cuatro esquinas y
 * los dedos.
 *
 * ── Por qué esto reemplaza al recuadro de proporción fija ───────────────────
 *
 * Antes el recorte era una CAJA con forma predeterminada (4:3, «hoja de pie»,
 * «tira») y lo que se movía era la foto debajo. De ahí venía casi toda la
 * torpeza que reportó el usuario: había que elegir de una lista la forma que
 * más se pareciera al papel, y como un papel fotografiado de frente casi nunca
 * es un rectángulo perfecto —está en perspectiva—, ninguna forma calzaba y
 * siempre sobraba escritorio o faltaba una esquina.
 *
 * Un papel tiene cuatro esquinas. Marcarlas describe exactamente lo que hay que
 * recortar, incluida la perspectiva, y no hace falta ninguna lista de formas: la
 * proporción del resultado sale del papel medido. Es como funciona cualquier
 * escáner de teléfono, y es lo que hace que se sienta directo en vez de
 * aproximado.
 *
 * ── Tres gestos que conviven ────────────────────────────────────────────────
 *
 *  1. **Arrastrar una esquina** — un dedo sobre una manija. Mueve ESA esquina.
 *  2. **Mover la vista** — un dedo en cualquier otro lado. Corre la foto para
 *     poder llegar a una esquina que quedó fuera de la pantalla.
 *  3. **Pellizcar y girar** — dos dedos. Acerca y endereza la VISTA.
 *
 * El tercero es el que faltaba y el que más se nota: sin pellizco, poner una
 * esquina con precisión en un teléfono es imposible, y el editor se siente roto
 * antes que impreciso.
 *
 * ⚠️ Girar con los dedos NO gira el resultado. Gira cómo se ve la foto mientras
 * se trabaja, que es lo que hace cómodo marcar una esquina de un papel
 * acostado. La orientación del documento la deciden las esquinas —cuál es la de
 * arriba a la izquierda— y el botón de un cuarto de vuelta. Si el gesto girara
 * el resultado, dos personas con el mismo papel guardarían documentos
 * distintos según cómo hayan sostenido el teléfono.
 *
 * ── La lupa ─────────────────────────────────────────────────────────────────
 *
 * El dedo TAPA la esquina que está colocando. Es el problema clásico del
 * arrastre en pantallas táctiles y la solución conocida es mostrar en otro lado
 * lo que está debajo del dedo, ampliado. Sin ella, marcar la esquina de un
 * papel en un teléfono es a ciegas.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import useGestos, { useRueda } from '../../hooks/useGestos';

const NOMBRES = ['arriba a la izquierda', 'arriba a la derecha',
    'abajo a la derecha', 'abajo a la izquierda'];

const acotar = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const ESCALA_MIN = 0.5;
const ESCALA_MAX = 8;
const LUPA = 104;          // lado de la lupa, en píxeles de pantalla
const AUMENTO = 2.6;

/* El lienzo de la lupa se pinta con `ctx`, así que sus colores no pueden ser
 * clases: hay que darle un valor. Se LEEN del tema en vez de escribirlos, para
 * que la lupa no sea el único trozo del portal que no acompaña al tema activo.
 * `getComputedStyle` sobre la raíz devuelve el valor ya resuelto. */
const delTema = (token) => {
    if (typeof window === 'undefined') return '';
    return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
};

/**
 * @param {HTMLImageElement} imagen   ya cargada (se necesita su tamaño natural)
 * @param {{x:number,y:number}[]} esquinas  cuatro puntos en fracciones, orden ↖ ↗ ↘ ↙
 * @param {Function} alCambiarEsquinas
 * @param {string} [ayuda]  la línea de instrucción, si hay que darla
 */
export default function LienzoDeEncuadre({ imagen, esquinas, alCambiarEsquinas, ayuda }) {
    const marcoRef = useRef(null);
    const [marco, setMarco] = useState({ w: 0, h: 0 });
    const [vista, setVista] = useState({ x: 0, y: 0, escala: 1, giro: 0 });
    const [arrastrando, setArrastrando] = useState(null);
    const [lupa, setLupa] = useState(null);       // {x, y} en pantalla, del dedo
    const lupaRef = useRef(null);

    // El tamaño del marco decide todo lo demás, y cambia al girar el teléfono.
    useLayoutEffect(() => {
        const el = marcoRef.current;
        if (!el) return undefined;
        /* ── `clientWidth`, NO `getBoundingClientRect` ───────────────────────
         *
         * Y ésta era la causa de que el recuadro no cayera sobre el documento.
         *
         * El diálogo entra con una animación de ESCALA. `getBoundingClientRect`
         * devuelve la caja YA TRANSFORMADA, así que medir durante esos
         * milisegundos daba un marco un 7 % más chico — medido: 1255×640 cuando
         * el marco real era 1348×688—. Y lo peor: `ResizeObserver` informa la
         * caja SIN transformar, o sea que al terminar la animación no cambia
         * nada y nunca vuelve a disparar. El marco se quedaba con el número
         * equivocado para siempre.
         *
         * Con eso, la foto se dibujaba a una escala y las esquinas se
         * calculaban con otra: el polígono salía corrido 47 px a la izquierda y
         * 23 hacia arriba, y encima más chico. Lo reportó el usuario con la foto
         * de un DUI: «el recorte no me sale bien».
         *
         * `clientWidth`/`clientHeight` son la caja de CONTENIDO sin transformar
         * — la misma que mira el `ResizeObserver`—, así que las dos fuentes
         * dicen lo mismo y la animación deja de existir para esta cuenta. */
        const medir = () => setMarco(prev => (
            prev.w === el.clientWidth && prev.h === el.clientHeight
                ? prev : { w: el.clientWidth, h: el.clientHeight }));
        medir();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
        ro?.observe(el);
        window.addEventListener('resize', medir);
        return () => { ro?.disconnect(); window.removeEventListener('resize', medir); };
    }, []);

    const iw = imagen?.naturalWidth || 0;
    const ih = imagen?.naturalHeight || 0;
    // El «encaje»: cuánto hay que achicar la foto para que entre entera en el
    // marco. Es la escala 1 — el punto de partida, no un tope.
    const base = (iw && ih && marco.w && marco.h)
        ? Math.min(marco.w / iw, marco.h / ih) : 0;

    /* ── De la foto a la pantalla, y de vuelta ───────────────────────────────
     * Un punto se guarda en FRACCIONES de la foto (0 a 1) y no en píxeles de
     * pantalla: así sobrevive a un giro del teléfono, a un cambio de tamaño de
     * la ventana y a un pellizco, que es exactamente lo que un píxel no hace. */
    const aPantalla = useCallback((p) => {
        const rad = vista.giro * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const lx = (p.x - 0.5) * iw * base;
        const ly = (p.y - 0.5) * ih * base;
        return {
            x: marco.w / 2 + vista.x + (lx * cos - ly * sin) * vista.escala,
            y: marco.h / 2 + vista.y + (lx * sin + ly * cos) * vista.escala,
        };
    }, [vista, iw, ih, base, marco]);

    const deltaAFraccion = useCallback((dpx, dpy) => {
        const rad = vista.giro * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const lx = (dpx * cos + dpy * sin) / vista.escala;
        const ly = (-dpx * sin + dpy * cos) / vista.escala;
        return { dx: lx / (iw * base || 1), dy: ly / (ih * base || 1) };
    }, [vista, iw, ih, base]);

    /* Acercar alrededor del punto que se pellizca —y no del centro del marco—
     * es lo que hace que el pellizco se sienta natural: lo que está entre los
     * dedos se queda entre los dedos. */
    const acercar = useCallback((factor, centro) => {
        // El rectángulo se lee ACÁ y no dentro del actualizador: un actualizador
        // de estado tiene que ser puro, y leer un ref adentro lo vuelve
        // dependiente de cuándo React decida ejecutarlo.
        const r = marcoRef.current?.getBoundingClientRect();
        const cx = (centro?.x ?? 0) - (r?.left ?? 0) - marco.w / 2;
        const cy = (centro?.y ?? 0) - (r?.top ?? 0) - marco.h / 2;
        setVista(v => {
            const nueva = acotar(v.escala * factor, ESCALA_MIN, ESCALA_MAX);
            const f = nueva / v.escala;
            return { ...v, escala: nueva, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
        });
    }, [marco]);

    useGestos(marcoRef, {
        activo: arrastrando === null,
        alMover: ({ dx, dy, escala, giro, centro }) => {
            // Igual que en `acercar`: el ref se lee fuera del actualizador.
            const r = marcoRef.current?.getBoundingClientRect();
            const cx = centro.x - (r?.left ?? 0) - marco.w / 2;
            const cy = centro.y - (r?.top ?? 0) - marco.h / 2;
            setVista(v => {
                const nueva = acotar(v.escala * escala, ESCALA_MIN, ESCALA_MAX);
                const f = nueva / v.escala;
                // Acercar y girar alrededor del centro entre los dedos; después
                // el desplazamiento del propio gesto.
                const rad = giro * Math.PI / 180;
                const cos = Math.cos(rad), sin = Math.sin(rad);
                let px = cx - (cx - v.x) * f;
                let py = cy - (cy - v.y) * f;
                const ox = px - cx, oy = py - cy;
                px = cx + ox * cos - oy * sin;
                py = cy + ox * sin + oy * cos;
                return { x: px + dx, y: py + dy, escala: nueva, giro: v.giro + giro };
            });
        },
    });
    useRueda(marcoRef, acercar, arrastrando === null);

    /* La manija se arrastra con su propio manejador y no con el gesto general:
     * mientras una esquina se mueve, la vista tiene que quedarse quieta — si se
     * moviera también, la esquina nunca llegaría a donde apunta el dedo. */
    const bajarManija = (i) => (e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setArrastrando(i);
        setLupa({ x: e.clientX, y: e.clientY });
    };
    const moverManija = (i) => (e) => {
        if (arrastrando !== i) return;
        e.stopPropagation();
        const { dx, dy } = deltaAFraccion(e.movementX ?? 0, e.movementY ?? 0);
        setLupa({ x: e.clientX, y: e.clientY });
        alCambiarEsquinas(esquinas.map((p, j) => (j === i
            ? { x: acotar(p.x + dx), y: acotar(p.y + dy) } : p)));
    };
    const soltarManija = () => { setArrastrando(null); setLupa(null); };

    // La lupa: lo que hay debajo del dedo, ampliado, dibujado desde la foto
    // original — no desde la pantalla, que ya está achicada.
    useEffect(() => {
        const cv = lupaRef.current;
        if (!cv || arrastrando === null || !imagen) return;
        const ctx = cv.getContext('2d');
        const p = esquinas[arrastrando];
        const lado = LUPA / (base * vista.escala * AUMENTO);
        /* El fondo sólo se ve si la esquina está en el filo de la foto: es el
         * «por acá ya no hay imagen». Si el token no resolviera —fuera de un
         * navegador— no se pinta nada, en vez de inventar un color: un valor
         * escrito a mano sería el único trozo del portal que no acompaña al
         * tema, y justo el que se mira de cerca. */
        const fondo = delTema('--surface-card-hover');
        if (fondo) { ctx.fillStyle = fondo; ctx.fillRect(0, 0, LUPA, LUPA); }
        else ctx.clearRect(0, 0, LUPA, LUPA);
        ctx.save();
        // La lupa se gira igual que la vista: si no, lo que se ve adentro está
        // torcido respecto de lo que se ve afuera y desorienta más que ayuda.
        ctx.translate(LUPA / 2, LUPA / 2);
        ctx.rotate(vista.giro * Math.PI / 180);
        ctx.drawImage(imagen, p.x * iw - lado / 2, p.y * ih - lado / 2, lado, lado,
            -LUPA / 2, -LUPA / 2, LUPA, LUPA);
        ctx.restore();
        // La cruz marca el punto exacto: sin ella la lupa muestra una zona, no
        // una posición.
        // La cruz va en el color de marca, el mismo de las manijas: sobre una
        // foto cualquiera, un blanco desaparece en un papel blanco.
        const marca = delTema('--brand');
        if (marca) {
            ctx.strokeStyle = marca;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(LUPA / 2, LUPA / 2 - 10); ctx.lineTo(LUPA / 2, LUPA / 2 + 10);
            ctx.moveTo(LUPA / 2 - 10, LUPA / 2); ctx.lineTo(LUPA / 2 + 10, LUPA / 2);
            ctx.stroke();
        }
    }, [arrastrando, esquinas, imagen, iw, ih, base, vista.escala, vista.giro]);

    const pts = esquinas.map(aPantalla);
    const listo = base > 0 && marco.w > 0;

    return (
        <div ref={marcoRef}
            /* `touch-none` es obligatorio: sin él el navegador se queda con el
               gesto para desplazar la página y el arrastre se corta solo. */
            className="relative w-full h-full overflow-hidden touch-none select-none
                       bg-surface-card-hover rounded-card">
            {/* La foto. Va en su propia capa transformada para que el navegador
                la componga en la GPU — mover 4 MB de imagen con `left/top` en
                cada evento de dedo es lo que se siente como tirones. */}
            {listo && (
                <img src={imagen.src} alt=""
                    draggable={false}
                    style={{
                        position: 'absolute',
                        left: '50%', top: '50%',
                        width: iw * base, height: ih * base,
                        transform: `translate(-50%, -50%) translate(${vista.x}px, ${vista.y}px)`
                                 + ` rotate(${vista.giro}deg) scale(${vista.escala})`,
                        transformOrigin: 'center',
                        willChange: 'transform',
                    }}
                    className="pointer-events-none" />
            )}

            {listo && (
                <>
                    {/* Lo que queda FUERA del documento se oscurece. Es la señal
                        de qué se va a descartar, y sin ella el polígono se lee
                        como una decoración sobre la foto. */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none"
                        aria-hidden="true">
                        <defs>
                            <mask id="mascara-documento">
                                <rect width="100%" height="100%" fill="white" />
                                <polygon points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="black" />
                            </mask>
                        </defs>
                        {/* El velo del portal, no un negro propio: es el mismo
                            token que oscurece detrás de un diálogo, y así el
                            «esto se descarta» se ve igual en los dos temas. */}
                        <rect width="100%" height="100%" fill="var(--scrim)"
                            mask="url(#mascara-documento)" />
                        <polygon points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                            fill="none" stroke="var(--brand)" strokeWidth="2" />
                    </svg>

                    {esquinas.map((_, i) => (
                        <button key={NOMBRES[i]} type="button"
                            aria-label={`Esquina ${NOMBRES[i]}`}
                            onPointerDown={bajarManija(i)}
                            onPointerMove={moverManija(i)}
                            onPointerUp={soltarManija}
                            onPointerCancel={soltarManija}
                            /* 44 pt de blanco de dedo con el punto visible chico:
                               un círculo de 44 px taparía justo la esquina que
                               hay que ver para colocarlo. */
                            className="absolute min-h-[var(--tap-min)] min-w-[var(--tap-min)]
                                       -translate-x-1/2 -translate-y-1/2 rounded-full
                                       flex items-center justify-center touch-none"
                            style={{ left: pts[i].x, top: pts[i].y }}>
                            <span className={`block rounded-full border-2 border-border-card
                                              bg-brand shadow-[var(--shadow-glass-2)]
                                              transition-all duration-[var(--dur-rapido)]
                                              ${arrastrando === i ? 'w-7 h-7' : 'w-4 h-4'}`} />
                        </button>
                    ))}

                    {/* La lupa se corre al lado contrario del dedo para no
                        quedar debajo de la mano. */}
                    {arrastrando !== null && lupa && (
                        <canvas ref={lupaRef} width={LUPA} height={LUPA}
                            className="absolute rounded-full border-2 border-border-card
                                       shadow-[var(--shadow-glass-3)] pointer-events-none"
                            style={{
                                left: pts[arrastrando].x < marco.w / 2 ? 'auto' : 12,
                                right: pts[arrastrando].x < marco.w / 2 ? 12 : 'auto',
                                top: 12,
                            }} />
                    )}
                </>
            )}

            {ayuda && arrastrando === null && (
                <span data-surface="tooltip"
                    className="absolute inset-x-0 bottom-2 mx-auto w-fit max-w-[92%]
                               px-3 py-1 text-micro font-bold text-content text-center
                               pointer-events-none">
                    {ayuda}
                </span>
            )}
        </div>
    );
}
