import React from 'react';
import { Sparkles, X } from 'lucide-react';

// ============================================================================
// 🤖 BotonIA — el disparador del diagnóstico inteligente
// ============================================================================
// Existía escrito TRES veces —`BranchesView`, `TabStaff`, `TabHistory`— con el
// mismo anillo de degradado girando y las mismas cuatro capas. Y como pasa
// siempre con el código triplicado, las tres copias ya habían divergido:
//
//  · dos usaban `hover:border-purple-400` —un color CRUDO, fuera de la paleta—
//    y la tercera `chart-3`, que es el token que le corresponde;
//  · sólo una traía `aria-pressed` y `aria-label`; las otras dos se apoyaban en
//    un `title`, que un lector de pantalla no anuncia como estado;
//  · los tamaños y los tamaños de ícono se habían separado a ojo.
//
// El canónico se queda con lo mejor de cada una: el color del token, la
// accesibilidad completa y dos tallas nombradas.
//
// **Por qué el disco interior SÍ lleva `backdrop-filter`… y ya no.** Al bajar
// `vidrio-a-mano` (PLAN-MATERIALES §20) se midió: el disco es de ~30px y el
// desenfoque era de 4px, o sea imperceptible, y costaba una capa de composición
// por botón. Se retiró. Lo que hace el efecto es el degradado que gira debajo,
// no el esmerilado.

const TALLAS = {
    sm: { caja: 'w-8 h-8',  icono: 14 },
    md: { caja: 'w-10 h-10', icono: 18 },
};

const BotonIA = ({
    activo = false,
    onClick,
    disabled = false,
    talla = 'md',
    etiqueta = 'Resumen inteligente',
    etiquetaActiva = 'Cerrar el resumen',
    className = '',
    ...rest
}) => {
    const t = TALLAS[talla] || TALLAS.md;
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-pressed={activo}
            aria-label={activo ? etiquetaActiva : etiqueta}
            title={activo ? etiquetaActiva : etiqueta}
            className={`relative group/ai-btn ${t.caja} min-w-[var(--tap-min)] min-h-[var(--tap-min)]
                flex items-center justify-center rounded-full shrink-0 border-0
                transition-all duration-[var(--dur-lento)]
                shadow-[var(--shadow-glow-chart-3-md)] hover:shadow-[var(--shadow-glow-chart-3-lg)]
                ${disabled
                    ? 'opacity-50 cursor-not-allowed grayscale'
                    : 'hover:translate-y-[var(--lift-hover)] active:scale-[0.97]'}
                ${className}`}
            {...rest}
        >
            {activo ? (
                <div className="absolute inset-[1px] bg-chart-3/10 rounded-full z-0 flex items-center justify-center border border-chart-3/30">
                    <X size={t.icono} strokeWidth={3} className="text-chart-3-text transition-colors" />
                </div>
            ) : (
                <>
                    {/* El anillo que gira: es LA identidad del botón. Sólo al apuntar. */}
                    <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-500
                        opacity-20 group-hover/ai-btn:opacity-100 group-hover/ai-btn:animate-spin
                        [animation-duration:3s] transition-all duration-[var(--dur-lento)]" />
                    {/* El disco que deja ver sólo el borde del anillo */}
                    <div className="absolute inset-[1px] rounded-full bg-surface-card z-0
                        transition-colors duration-[var(--dur-slow)]" />
                    <div className="absolute inset-0 rounded-full border border-chart-3/30
                        group-hover/ai-btn:border-chart-3 transition-colors z-base" />
                    <Sparkles size={t.icono} strokeWidth={2.5}
                        className="text-chart-3-text group-hover/ai-btn:animate-pulse z-content relative" />
                </>
            )}
        </button>
    );
};

export default BotonIA;
