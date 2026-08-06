import React, { memo } from 'react';
import { Inbox, Loader2, Sparkles } from 'lucide-react';

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
    // El halo del estado vacío es el VERDE DEL LOGO, no el azul funcional:
    // un vacío es un momento en que la app habla de sí misma, no un estado
    // del dato. Se puede sobreescribir cuando la vista tiene una razón.
    glowClass = 'bg-logo-green/30',
    compact = false,
    className = '',
}) => (
    <div className={`flex flex-col items-center justify-center ${compact ? 'min-h-[200px]' : 'min-h-[400px]'}
        animate-in fade-in zoom-in-95 duration-[var(--dur-lento)] ease-[var(--ease-spring)] ${className}`}>
        <div className="relative group flex flex-col items-center text-center">
            <div className={`absolute top-2 ${compact ? 'w-20 h-20' : 'w-28 h-28'} rounded-full blur-[40px] opacity-30 ${glowClass}`} />
            <div className={`relative z-base ${compact ? 'w-16 h-16 rounded-2xl mb-4' : 'w-24 h-24 rounded-modal mb-6'}
                flex items-center justify-center bg-surface-card border border-border-card
                shadow-[var(--shadow-elevation-md)] transition-all duration-[var(--dur-lento)] ease-[var(--ease-spring)]
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
                <div data-surface="card" className="relative px-10 py-8 shadow-[var(--card-shadow)] flex flex-col items-center gap-3">
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

/* ── AiThinking ───────────────────────────────────────────────────────────
   El TERCER estado de espera, distinto de los otros dos (A12, 2026-07-27).

     contenido con forma conocida  → skeleton
     acción disparada por el click → spinner dentro del botón
     proceso largo e indeterminado → esto

   Una generación de IA no tiene forma predecible —puede devolver dos párrafos
   o quince, una tabla o una lista— así que un skeleton mentiría sobre lo que
   viene. Y tarda segundos, no milisegundos: el usuario necesita ver que algo
   sigue trabajando, no un placeholder inmóvil.

   El patrón estaba copiado a mano en 7 archivos (17 instancias) con tamaños,
   colores y duraciones distintas en cada uno. Los anillos usan --chart-3 y
   --chart-9, no los morados crudos que traía cada copia.

   `steps` rota mensajes: en una espera larga, un texto fijo se lee como
   colgado. */
export const AiThinkingState = memo(({
    title = 'Procesando',
    steps,
    size = 'md',
    className = '',
}) => {
    const box = size === 'sm' ? 'w-16 h-16' : 'w-24 h-24';
    const icon = size === 'sm' ? 18 : 28;
    return (
        <div className={`flex flex-col items-center justify-center text-center
            animate-in fade-in duration-[var(--dur-lento)] ${size === 'sm' ? 'py-10' : 'py-20'} px-6 ${className}`}>
            <div className={`relative ${box} flex items-center justify-center mb-6`}>
                <div className="absolute inset-0 border-2 border-chart-3/30 rounded-full animate-ping [animation-duration:2s]" />
                <div className="absolute inset-1 border-t-2 border-b-2 border-logo-green rounded-full animate-spin [animation-duration:1.5s]" />
                <div className="absolute inset-3 border-l-2 border-r-2 border-logo-magenta rounded-full animate-spin [animation-duration:2.5s]" />
                <Sparkles size={icon} strokeWidth={2.5} className="text-logo-magenta relative z-base" />
            </div>
            <h3 className={`font-black uppercase tracking-widest text-logo-magenta
                ${size === 'sm' ? 'text-body-sm' : 'text-title-sm'}`}>{title}</h3>
            {steps && (
                <p className="text-caption font-bold text-content-3 mt-1.5 opacity-80">{steps}</p>
            )}
        </div>
    );
});

export default { Skeleton, SkeletonText, EmptyState, LoadingState, AiThinkingState };
