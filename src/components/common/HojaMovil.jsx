import React, { memo, useRef, useLayoutEffect, useContext } from 'react';
import useMediaQuery from '../../hooks/useMediaQuery';
import { leerUltimoToque } from './ultimoToque';
import { EstadoDialogoCtx } from './estadoDialogo';

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
 * La hoja no "aparece": empieza siendo el rectángulo exacto del control que se
 * tocó y se abre hasta el panel. No hace falta pasarle nada — si nadie da un
 * `origen`, lo toma de `leerUltimoToque()`, así que la gota es canónica y no una
 * prop que alguien tenga que recordar.
 *
 * Se anima `clip-path` y NO `transform`: escalar la hoja escala también su
 * `backdrop-filter`, y a `scale(0.14)` los 24px de blur valen ~3 — el vidrio
 * llegaba al final en vez de estar desde el principio. Recortando, la hoja está
 * siempre a tamaño real y lo único que crece es la ventana por la que se la ve.
 *
 * `ModalShell` recibe `animacionPropia` para apagar la suya: si animara el
 * envoltorio, ese `transform` sí sería ANCESTRO y mataría el vidrio.
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

/**
 * El material de la capa móvil, definido UNA vez.
 *
 * La barra flotante y todas las hojas lo comparten a propósito: en el teléfono
 * son la misma capa —la barra y lo que la barra despliega—, y con superficies
 * distintas se leían como piezas de dos sistemas. `BarraFlotante` lo importa de
 * acá en vez de tener el suyo, así que cambiarlo (o revertir la prueba de
 * `card`) sigue siendo una línea, pero ahora una línea que manda sobre todo.
 */
export const MATERIAL_HOJA = 'card';

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
    // La superficie. El MISMO material para todas: el usuario reportó que
    // "Calcular" y "Parámetros" no se veían igual que la hoja de la barra, y era
    // literal — esas usaban `modal` (85%) y la de la barra `card` (16%). Un
    // canónico con dos materiales no es un canónico.
    superficie = MATERIAL_HOJA,
    // El rectángulo del control que abrió la hoja, `{ x, y, w, h }`. Opcional:
    // sin él se usa el último toque del usuario. Ver la nota de la gota.
    origen,
    className = '',
}) => {
    const hojaRef = useRef(null);
    const cuerpoRef = useRef(null);
    const sinMovimiento = useMediaQuery('(prefers-reduced-motion: reduce)');
    const { cerrando, salidaMs } = useContext(EstadoDialogoCtx);
    // El origen se congela en el primer render: al cerrar hay que volver al MISMO
    // sitio del que se salió, y para entonces `leerUltimoToque()` ya devuelve el
    // toque que cerró (el fondo, o el botón de cancelar), no el que abrió.
    const origenFijo = useRef(null);
    if (origenFijo.current === null) origenFijo.current = origen || leerUltimoToque() || false;

    // ── La apertura, y por qué son DOS técnicas ───────────────────────────
    //
    // **Con vidrio: `clip-path`.** Escalar la hoja escala también su
    // `backdrop-filter` —a `scale(0.14)` los 24px de blur valen ~3— así que la
    // hoja arrancaba casi transparente y ganaba el efecto al crecer. Recortando,
    // está siempre a tamaño real y lo único que crece es la ventana por la que
    // se la ve. Cuesta más: animar `clip-path` obliga al navegador a rasterizar
    // cada cuadro, y encima con un `backdrop-filter` vivo detrás.
    //
    // **Sin vidrio: `transform`.** En los temas sólidos no hay `backdrop-filter`
    // que romper, así que desaparece la única razón por la que `clip-path` valía
    // la pena — y `transform` + `opacity` son las dos propiedades que el
    // compositor mueve sin volver a pintar nada. Es el camino barato, y en el
    // tema que justamente eligió no pagar por el vidrio.
    //
    // La condición NO es el nombre del tema: es si el elemento tiene vidrio. Así
    // no hay una lista de temas que actualizar cuando aparezca el quinto, y la
    // regla se lee sola — "si no hay blur que preservar, usá lo barato".
    const animarApertura = (el, desde) => {
        const conVidrio = getComputedStyle(el).backdropFilter !== 'none';
        const cuerpo = cuerpoRef.current;
        if (cuerpo) { cuerpo.style.transition = 'none'; cuerpo.style.opacity = '0'; }

        if (!conVidrio) {
            const r = el.getBoundingClientRect();
            el.style.transformOrigin =
                `${Math.round(desde.x + desde.w / 2 - r.left)}px ${Math.round(desde.y + desde.h / 2 - r.top)}px`;
            el.style.transition = 'none';
            el.style.transform = 'scale(0.94)';
            el.style.opacity = '0';
            void el.offsetWidth;
            el.style.transition = 'transform 240ms cubic-bezier(0.22,1,0.36,1), opacity 160ms ease-out';
            el.style.transform = 'scale(1)';
            el.style.opacity = '1';
            if (cuerpo) { cuerpo.style.transition = 'opacity 180ms ease-out 60ms'; cuerpo.style.opacity = '1'; }
            return () => { el.style.transform = ''; el.style.opacity = ''; el.style.transition = ''; };
        }

        const r = el.getBoundingClientRect();
        const tope = (n) => Math.max(0, Math.round(n));
        el.style.transition = 'none';
        el.style.clipPath = `inset(${tope(desde.y - r.top)}px ${tope((r.left + r.width) - (desde.x + desde.w))}px `
            + `${tope((r.top + r.height) - (desde.y + desde.h))}px ${tope(desde.x - r.left)}px round 9999px)`;

        // Fuerza el reflujo: sin esto el navegador junta el estado inicial y el
        // final en un solo estilo computado y no hay transición que interpolar.
        void el.offsetWidth;

        el.style.transition = 'clip-path 520ms cubic-bezier(0.22,1,0.36,1)';
        // El radio final se LEE del elemento: estaba quemado en 28px y eso solo
        // es cierto en los temas de vidrio (en `solid` el token baja a 12).
        const radio = getComputedStyle(el).borderTopLeftRadius || '28px';
        el.style.clipPath = `inset(0px 0px 0px 0px round ${radio} ${radio} 0px 0px)`;
        if (cuerpo) { cuerpo.style.transition = 'opacity 260ms ease-out 140ms'; cuerpo.style.opacity = '1'; }

        // El clip se retira al terminar: dejarlo puesto recortaría cualquier
        // sombra o popover que la hoja quiera sacar fuera de su caja.
        const alTerminar = () => { el.style.clipPath = ''; el.style.transition = ''; };
        el.addEventListener('transitionend', alTerminar, { once: true });
        return () => el.removeEventListener('transitionend', alTerminar);
    };

    useLayoutEffect(() => {
        const el = hojaRef.current;
        const desde = origenFijo.current;
        if (!el || !desde || sinMovimiento || cerrando) return undefined;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return undefined;
        return animarApertura(el, desde);
    }, [sinMovimiento, cerrando]);

    // ── La salida: la misma gota, al revés ────────────────────────────────
    // Una hoja que se abre con cuidado y desaparece de golpe se siente rota,
    // aunque cada mitad por separado esté bien. Vuelve al rectángulo del que
    // salió, y el contenido se va primero para no verse aplastado.
    //
    // Más rápida que la entrada a propósito: abrir es una invitación y admite
    // demorarse; cerrar es una respuesta y cualquier demora ahí se siente lenta.
    useLayoutEffect(() => {
        const el = hojaRef.current;
        const desde = origenFijo.current;
        if (!el || !cerrando || !desde || sinMovimiento) return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const cuerpo = cuerpoRef.current;
        if (cuerpo) { cuerpo.style.transition = `opacity ${Math.round(salidaMs * 0.4)}ms ease-in`; cuerpo.style.opacity = '0'; }

        // La salida usa la MISMA técnica que la entrada, por lo mismo.
        if (getComputedStyle(el).backdropFilter === 'none') {
            el.style.transition = `transform ${salidaMs}ms cubic-bezier(0.4,0,1,1), opacity ${salidaMs}ms ease-in`;
            el.style.transform = 'scale(0.96)';
            el.style.opacity = '0';
            return;
        }
        const tope = (n) => Math.max(0, Math.round(n));
        el.style.transition = `clip-path ${salidaMs}ms cubic-bezier(0.4,0,0.6,1)`;
        el.style.clipPath = `inset(${tope(desde.y - r.top)}px ${tope((r.left + r.width) - (desde.x + desde.w))}px `
            + `${tope((r.top + r.height) - (desde.y + desde.h))}px ${tope(desde.x - r.left)}px round 9999px)`;
    }, [cerrando, salidaMs, sinMovimiento]);

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
        // La sombra de arriba NO va acá: `data-surface` fija el `box-shadow` y le
        // gana por orden de hoja, igual que hace con el radio. La pone
        // `ModalShell` en el envoltorio, que calza exacto con la hoja y no tiene
        // sombra propia con la que pelearse.
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
