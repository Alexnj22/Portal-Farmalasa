import React, { memo } from 'react';
import { Inbox, Loader2 } from 'lucide-react';

/**
 * StateViews — los tres estados que toda vista con datos necesita.
 *
 * Canónicos definidos en D2.5 (2026-07-26). Antes no existía ninguno:
 *
 *   · SKELETON — convivían dos idiomas sin criterio: la clase CSS `.skeleton`
 *     (129 usos, con su shimmer real) y `animate-pulse` a mano (99 usos en 53
 *     archivos, que solo parpadea opacidad). Los 4 componentes skeleton que
 *     existían eran locales a su archivo.
 *   · EMPTY — `DESIGN.md` §18 lo declara obligatorio en toda vista que pueda
 *     quedar sin datos, pero la única implementación era una función LOCAL
 *     dentro de `FacturacionView.jsx`. 32 archivos con textos de vacío
 *     copiaban el patrón a mano, cada uno con su propia versión.
 *   · LOADING — había tres pantallas distintas con tres spinners distintos
 *     (`RouteLoadingFallback`, `ContentLoadingFallback`, `FallbackLoader`).
 *
 * El shimmer sale de `.skeleton`, no de `animate-pulse`: comunica "esto se
 * está cargando" en vez de solo parpadear, y ya respeta
 * `prefers-reduced-motion` (index.css lo congela a un fondo sólido).
 */

/* ── Skeleton ─────────────────────────────────────────────────────────────
   Una pieza de placeholder. `w`/`h` aceptan cualquier valor CSS para poder
   estimar el ancho real del contenido — un skeleton que no se parece a lo
   que va a reemplazar produce un salto al cargar. */
export const Skeleton = memo(({ w = '100%', h = 12, rounded = '0.5rem', delayed = true, className = '', style }) => (
    <div
        className={`skeleton ${delayed ? 'skeleton-delayed' : ''} ${className}`}
        style={{ width: w, height: typeof h === 'number' ? `${h}px` : h, borderRadius: rounded, ...style }}
    />
));

/* Bloque de líneas — el caso más común (una tarjeta o fila cargando). Los
   anchos decrecen para que lea como texto y no como una barra maciza.

   `delayed` (por defecto true) hace que el placeholder exista en el DOM desde
   el principio, para que el layout no salte, pero no se vea hasta pasados
   250ms. Si la respuesta llega antes, el usuario nunca ve el skeleton: es lo
   que evita que "skeleton en todo" empeore las pantallas rápidas. Ponerlo en
   false solo donde se sabe que la espera SIEMPRE es larga. */
export const SkeletonText = memo(({ lines = 3, delayed = true, className = '' }) => (
    <div className={`flex flex-col gap-2 ${className}`}>
        {Array.from({ length: lines }, (_, i) => (
            <Skeleton key={i} h={11} delayed={delayed} w={`${[92, 78, 64, 85, 70][i % 5]}%`} />
        ))}
    </div>
));

/* ── Empty ────────────────────────────────────────────────────────────────
   Promovido desde la función local de FacturacionView, que era la única
   implementación real del patrón que §18 declara obligatorio.
   `action` permite ofrecer la salida (crear el primer registro, limpiar el
   filtro) en vez de dejar al usuario en una pantalla muerta. */
export const EmptyState = memo(({
    icon: Icon = Inbox,
    title,
    subtitle,
    action,
    iconClass = 'text-content-3',
    glowClass = 'bg-brand/30',
    compact = false,
    className = '',
}) => (
    <div className={`flex flex-col items-center justify-center ${compact ? 'min-h-[200px]' : 'min-h-[400px]'}
        animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${className}`}>
        <div className="relative group flex flex-col items-center text-center">
            <div className={`absolute top-2 ${compact ? 'w-20 h-20' : 'w-28 h-28'} rounded-full blur-[40px] opacity-30 ${glowClass}`} />
            <div className={`relative z-base ${compact ? 'w-16 h-16 rounded-2xl mb-4' : 'w-24 h-24 rounded-[2rem] mb-6'}
                flex items-center justify-center bg-surface-card backdrop-blur-xl border border-border-card
                shadow-[var(--shadow-elevation-md)] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]
                group-hover:-translate-y-2 group-hover:shadow-[var(--shadow-elevation-lg)] ${iconClass}`}>
                <Icon size={compact ? 28 : 40} strokeWidth={2} />
            </div>
            <h3 className={`font-bold ${compact ? 'text-body-xl' : 'text-title-lg'} text-content tracking-tight mb-2`}>
                {title}
            </h3>
            {subtitle && (
                <p className="font-medium text-body-lg text-content-3 max-w-[280px] leading-relaxed">{subtitle}</p>
            )}
            {action && <div className="mt-5">{action}</div>}
        </div>
    </div>
));

/* ── Loading ──────────────────────────────────────────────────────────────
   Un solo componente con tres variantes, en vez de tres pantallas sueltas.
   `route` cubre el árbol entero (tarjeta centrada); `content` solo el área
   de contenido dentro del shell; `inline` va dentro de un contenedor propio.
   El spinner es siempre Loader2 — antes coexistía con un borde rotatorio
   bespoke en UnifiedModal. */
export const LoadingState = memo(({ variant = 'content', label, className = '' }) => {
    const spinner = <Loader2 className="text-brand-text animate-spin" size={variant === 'inline' ? 16 : 28} strokeWidth={2.5} />;

    if (variant === 'route') {
        return (
            <div className={`fixed inset-0 w-full h-[100dvh] flex items-center justify-center z-header ${className}`}>
                <div className="relative bg-surface-card backdrop-blur-3xl border border-border-card rounded-[2rem]
                    px-10 py-8 shadow-[var(--card-shadow)] flex flex-col items-center gap-3">
                    {spinner}
                    <span className="text-caption font-bold uppercase tracking-[0.2em] text-content-3">
                        {label || 'Cargando…'}
                    </span>
                </div>
            </div>
        );
    }
    if (variant === 'inline') {
        return (
            <span className={`inline-flex items-center gap-2 text-content-3 ${className}`}>
                {spinner}
                {label && <span className="text-body-sm font-bold">{label}</span>}
            </span>
        );
    }
    return (
        <div className={`w-full h-full min-h-[160px] flex flex-col items-center justify-center gap-3 ${className}`}>
            {spinner}
            {label && (
                <span className="text-caption font-bold uppercase tracking-widest text-content-3">{label}</span>
            )}
        </div>
    );
});

export default { Skeleton, SkeletonText, EmptyState, LoadingState };
