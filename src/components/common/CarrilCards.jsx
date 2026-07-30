import React, { memo, Children, isValidElement, cloneElement, useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * CarrilCards — la fila de tarjetas de métrica de una vista. UNA sola fila.
 *
 * ── Por qué existe (2026-07-30, aprobado sobre mockup) ────────────────────
 * Las `StatCard` vivían en un `flex-wrap`, y eso hacía dos cosas mal:
 *
 * · **Envolvían.** Medido antes: Ventas daba 1, 2, 3 y 4 tarjetas por fila entre
 *   1280 y 1920px; Personal 2, 3, 4 o 5. La misma vista se veía distinta en cada
 *   monitor, y la fila empujaba la tabla hacia abajo un alto distinto cada vez.
 * · **La tarjeta huérfana de la última fila crecía hasta llenarla sola.** En
 *   Personal a 1920px había cuatro de 172px y **una de 726**.
 *
 * Acá no envuelven: entran las que quepan y el resto se alcanza deslizando. El
 * alto de la fila es constante, que es lo que hace que la vista se vea igual en
 * todas partes.
 *
 * ── El sobrante NO se tira: asoma la siguiente ────────────────────────────
 * La pista ocupa TODO el carril, así que lo que queda después de las tarjetas
 * enteras se ve como el borde de la próxima. Un asomo dice "hay más" mejor que
 * las flechas solas — y las flechas, además, no siempre están.
 *
 * ── Las flechas FLOTAN, no ocupan ─────────────────────────────────────────
 * En el flujo se comían 64px de los 438 disponibles a 1512px: media tarjeta.
 * Flotando sobre el borde no cuestan ancho, y es donde el ojo las busca.
 * Aparecen solo si hay algo que deslizar, y cada una se apaga en su extremo.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *   <CarrilCards>
 *       <StatCard … />
 *       <StatCard … />
 *   </CarrilCards>
 *
 * `compacta` se le inyecta a cada hija: el carril es quien sabe el ancho real,
 * y bajo 176px la línea de detalle se corta a mitad de palabra.
 */

// El umbral bajo el cual la tarjeta suelta su línea de detalle. Ver `StatCard`.
const ANCHO_CON_DETALLE = 176;

const CarrilCards = memo(({ children, className = '', ariaLabel = 'Métricas de la vista' }) => {
    const pistaRef = useRef(null);
    const [desliza, setDesliza] = useState(false);
    const [alInicio, setAlInicio] = useState(true);
    const [alFinal, setAlFinal] = useState(false);
    const [compacta, setCompacta] = useState(false);

    const tarjetas = Children.toArray(children).filter(isValidElement);

    const medir = useCallback(() => {
        const el = pistaRef.current;
        if (!el) return;
        // 2px de tolerancia: los anchos fraccionarios de flex dejan sobrantes de
        // menos de un píxel que si no harían aparecer las flechas sin motivo.
        const hayDeMas = el.scrollWidth - el.clientWidth > 2;
        setDesliza(hayDeMas);
        setAlInicio(el.scrollLeft <= 2);
        setAlFinal(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
        const primera = el.firstElementChild;
        if (primera) setCompacta(primera.getBoundingClientRect().width < ANCHO_CON_DETALLE);
    }, []);

    useEffect(() => {
        const el = pistaRef.current;
        if (!el) return undefined;
        medir();
        // `ResizeObserver` sobre la pista y no un listener de `resize` de la
        // ventana: el carril también cambia de ancho cuando el sidebar se
        // colapsa o cuando la píldora de al lado gana una ranura, y eso no
        // dispara `resize`.
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        [...el.children].forEach(h => ro.observe(h));
        el.addEventListener('scroll', medir, { passive: true });
        return () => { ro.disconnect(); el.removeEventListener('scroll', medir); };
    }, [medir, tarjetas.length]);

    const correr = (dir) => {
        const el = pistaRef.current;
        if (!el) return;
        const paso = (el.firstElementChild?.getBoundingClientRect().width ?? 148) + 8;
        el.scrollBy({ left: dir * paso * 2, behavior: 'smooth' });
    };

    return (
        <div className={`relative min-w-0 ${className}`}>
            <div
                ref={pistaRef}
                role="group"
                aria-label={ariaLabel}
                className="flex items-stretch gap-2 overflow-x-auto scroll-smooth
                    [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-0.5"
            >
                {tarjetas.map((t, i) => cloneElement(t, { key: t.key ?? i, compacta }))}
            </div>

            {/* Las flechas van por encima del borde, fuera del flujo. `-left-3`
                las saca media unidad sobre el aire que ya hay entre el carril y
                el borde de la vista, así que no tapan la primera tarjeta. */}
            {desliza && !alInicio && (
                <button type="button" onClick={() => correr(-1)} aria-label="Ver las métricas anteriores"
                    className="absolute -left-3 top-1/2 -translate-y-1/2 z-content
                        w-7 h-7 rounded-full grid place-items-center
                        bg-surface-card border border-border-card shadow-[var(--shadow-glass-1)]
                        text-content-2 hover:bg-brand hover:border-brand hover:text-white
                        transition-[background-color,border-color,color] duration-150">
                    <ChevronLeft size={14} strokeWidth={2.5} />
                </button>
            )}
            {desliza && !alFinal && (
                <button type="button" onClick={() => correr(1)} aria-label="Ver las métricas siguientes"
                    className="absolute -right-3 top-1/2 -translate-y-1/2 z-content
                        w-7 h-7 rounded-full grid place-items-center
                        bg-surface-card border border-border-card shadow-[var(--shadow-glass-1)]
                        text-content-2 hover:bg-brand hover:border-brand hover:text-white
                        transition-[background-color,border-color,color] duration-150">
                    <ChevronRight size={14} strokeWidth={2.5} />
                </button>
            )}
        </div>
    );
});

CarrilCards.displayName = 'CarrilCards';
export default CarrilCards;
