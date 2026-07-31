import React, { memo, useRef, useLayoutEffect } from 'react';
import useMediaQuery from '../../hooks/useMediaQuery';

/**
 * HojaMovil — el CUERPO canónico de un modal en el teléfono.
 *
 * `ModalShell` ya resuelve *cómo entra* (desde abajo, en táctil, desde
 * v2.265.0). Lo que faltaba es *cómo se ve por dentro*: cada modal seguía
 * rendeando el cuerpo que se escribió para un panel centrado de escritorio —
 * ícono grande centrado, título centrado, botones en fila— y eso en una hoja se
 * lee mal por tres razones concretas:
 *
 * · **El título centrado no tiene con qué alinearse.** Una hoja ocupa el ancho
 *   entero; el ojo entra por el borde izquierdo, que es donde arranca la lectura.
 *   La hoja de filtros y la de acciones ya ponen su título a la izquierda.
 * · **Los botones en fila se reparten el ancho**, así que en 390px quedan dos
 *   blancos de ~180px con el texto apretado. Apilados son dos objetivos de ancho
 *   completo, que es lo que el pulgar acierta sin mirar.
 * · **El ícono de 64px centrado** es la mitad del alto útil de una hoja corta.
 *   Al lado del título dice lo mismo ocupando una línea.
 *
 * ── El material sale de los TOKENS, no de clases sueltas ──────────────────
 * `data-surface="modal"` aplica fondo, borde, sombra, radio y `backdrop-filter`
 * desde `index.css`, así que la hoja responde a los cuatro temas sola. Es la
 * misma lección que ya está escrita en `GlassViewLayout` y en `BarraFlotante`:
 * con `bg-surface-*` a mano se obtiene un translúcido, no vidrio.
 *
 * ── Nace del control que la abrió ─────────────────────────────────────────
 * Con `origenX`, la hoja se despliega desde la x de ese botón en vez de subir
 * desde el centro: lo que se lee es "este botón se abrió", no "algo entró por
 * abajo". El `transform-origin` va en línea porque el valor es una medida del
 * DOM, no una constante de diseño.
 *
 * Es un `transform` PROPIO, así que no rompe el `backdrop-filter` de la hoja —
 * solo un ancestro lo haría. Por eso `ModalShell` recibe `animacionPropia` y
 * apaga la suya: si animara el envoltorio, ese sí sería ancestro.
 *
 * ── `data-hoja`, para que `ModalShell` no la parchee ──────────────────────
 * `ModalShell` le corrige al hijo las esquinas de abajo y el área segura, porque
 * los 17 llamadores traen cuerpos pensados para un panel centrado. Esta hoja ya
 * hace las dos cosas bien, así que se marca y el parche la saltea.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *   <ModalShell open={abierto} onClose={cerrar} surface={null}>
 *       <HojaMovil titulo="¿Publicar 12 borradores?" icono={Upload} tono="brand"
 *           pie={<><Button …>Publicar</Button><Button variant="secondary" …/></>}>
 *           …contenido…
 *       </HojaMovil>
 *   </ModalShell>
 */

const TONO = {
    brand:   'text-brand-text bg-brand/12',
    danger:  'text-danger-text bg-danger/12',
    warning: 'text-warning-text bg-warning/12',
    success: 'text-success-text bg-success/12',
};

const HojaMovil = memo(({
    titulo,
    // Texto chico bajo el título. Va acá y no en el cuerpo para que el cuerpo
    // pueda scrollear sin llevarse el contexto de qué se está decidiendo.
    subtitulo,
    icono: Icono,
    tono = 'brand',
    children,
    // Las acciones. Se apilan de ancho completo en el orden en que llegan, así
    // que la principal va PRIMERA: es la que queda más arriba, más lejos del
    // borde y más cerca del pulgar en reposo.
    pie,
    // La superficie. Por defecto `modal`, que es lo que un diálogo debe ser. Las
    // hojas que abre `BarraFlotante` pasan la MISMA del clúster: son la barra
    // desplegándose, no un diálogo aparte, y con dos materiales distintos se
    // leían como dos piezas apiladas.
    superficie = 'modal',
    // El rectángulo (en px de viewport) del control que abrió la hoja:
    // `{ x, y, w, h }`. Con él la hoja no "aparece": ARRANCA SIENDO ese botón y
    // se despliega hasta su tamaño final. Ver la nota de la gota.
    origen,
    className = '',
}) => {
    const hojaRef = useRef(null);
    const cuerpoRef = useRef(null);
    const sinMovimiento = useMediaQuery('(prefers-reduced-motion: reduce)');

    // ── La gota: FLIP, no un keyframe ─────────────────────────────────────
    // Un `@keyframes` fijo solo puede escalar "un poco desde abajo": no sabe
    // dónde está el botón ni cuánto mide, así que el gesto se lee como "algo
    // entró", no como "esto se abrió". Acá se mide la hoja YA COLOCADA, se la
    // manda de vuelta al rectángulo exacto del botón —translate + scale por eje,
    // con el radio de píldora— y se la suelta. El navegador interpola el camino
    // completo: la píldora se estira y se convierte en el panel.
    //
    // El contenido entra DESPUÉS. Durante la primera mitad la hoja está
    // aplastada a la altura de un botón y el texto ahí dentro se vería
    // deformado; apareciendo a los 150ms lo que se ve es el vidrio abriéndose y
    // el contenido asentándose adentro.
    //
    // `useLayoutEffect` y no `useEffect`: el estado inicial tiene que estar
    // aplicado ANTES del primer pintado, o se alcanza a ver la hoja entera un
    // fotograma antes de encogerse.
    useLayoutEffect(() => {
        const el = hojaRef.current;
        if (!el || !origen || sinMovimiento) return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;

        const sx = Math.max(origen.w / r.width, 0.04);
        const sy = Math.max(origen.h / r.height, 0.04);
        const tx = origen.x - r.left;
        const ty = origen.y - r.top;

        const cuerpo = cuerpoRef.current;
        el.style.transformOrigin = '0 0';
        el.style.transition = 'none';
        el.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
        el.style.borderRadius = '9999px';
        if (cuerpo) { cuerpo.style.transition = 'none'; cuerpo.style.opacity = '0'; }

        // Fuerza el reflujo: sin esto el navegador junta el estado inicial y el
        // final en un solo estilo computado y no hay transición que interpolar.
        void el.offsetWidth;

        el.style.transition =
            'transform 520ms cubic-bezier(0.22,1,0.36,1), border-radius 460ms cubic-bezier(0.22,1,0.36,1)';
        el.style.transform = 'translate(0px, 0px) scale(1, 1)';
        el.style.borderRadius = '';
        if (cuerpo) {
            cuerpo.style.transition = 'opacity 260ms ease-out 150ms';
            cuerpo.style.opacity = '1';
        }
    }, [origen, sinMovimiento]);

    return (
    <div
        ref={hojaRef}
        data-hoja="true"
        data-surface={superficie}
        // `rounded-b-none!` con el modificador de importancia, no a secas: el
        // radio lo fija `[data-surface="modal"]` en index.css, que es un selector
        // de atributo —misma especificidad que una clase— y le gana por orden de
        // hoja. Sin el `!` las cuatro esquinas quedaban en 32px y las de abajo
        // dibujaban una curva contra el filo de la pantalla.
        className={`flex flex-col max-h-[88dvh] rounded-t-modal rounded-b-none! overflow-hidden ${className}`}
    >
    <div ref={cuerpoRef} className="flex flex-col min-h-0">
        {/* El asa. No arrastra —eso es un gesto que habría que implementar y
            mantener—, pero es lo que dice "esto se cierra hacia abajo", que es
            la mitad del trabajo que hace en las hojas nativas. */}
        <div aria-hidden="true" className="w-9 h-1 rounded-full bg-content-3/40 mx-auto mt-3 mb-1 shrink-0" />

        {(titulo || Icono) && (
            <div className="flex items-start gap-3 px-4 pt-3 pb-3 shrink-0">
                {Icono && (
                    <div className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${TONO[tono] || TONO.brand}`}>
                        <Icono size={18} strokeWidth={2.5} />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    {titulo && (
                        <h2 className="text-body-lg font-black text-content leading-tight text-balance">
                            {titulo}
                        </h2>
                    )}
                    {subtitulo && (
                        <p className="text-caption text-content-3 font-medium mt-0.5">{subtitulo}</p>
                    )}
                </div>
            </div>
        )}

        {/* El cuerpo es lo ÚNICO que scrollea: el título se queda arriba y las
            acciones abajo, así que en una hoja larga nunca hay que scrollear
            para volver a ver qué se estaba decidiendo ni para confirmarlo. */}
        {children != null && (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 text-body text-content-2 leading-relaxed">
                {children}
            </div>
        )}

        {pie && (
            <div className="shrink-0 flex flex-col gap-2 px-4 pt-3 border-t border-divider
                pb-[max(16px,env(safe-area-inset-bottom))] bg-surface-card-hover
                [&>*]:w-full">
                {pie}
            </div>
        )}
    </div>
    </div>
    );
});

HojaMovil.displayName = 'HojaMovil';
export default HojaMovil;
