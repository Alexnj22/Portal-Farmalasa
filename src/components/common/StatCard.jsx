import { Loader2, X } from 'lucide-react';

/**
 * StatCard -- tarjeta de metrica reutilizable.
 *
 * USO en el padre:
 *   <div className="flex items-stretch gap-3 flex-wrap">
 *     <StatCard ... />
 *     <StatCard ... />
 *   </div>
 *
 * La card tiene flex-1 basis-0 min-w-[150px] para que todas las cards de
 * una misma fila flex se repartan el espacio por igual, sin importar el
 * largo del texto (fix del problema de anchos disparejos).
 * El padre DEBE usar items-stretch para igualar alturas entre cards.
 *
 * Props:
 *   icon       (component, obligatorio) -- icono Lucide
 *   iconBg     (string)                 -- clases Tailwind para el squircle, ej. 'bg-danger/10'
 *   iconCls    (string)                 -- clases para el icono, ej. 'text-danger'
 *   label      (string, obligatorio)    -- etiqueta superior
 *   value      (string|number, oblig.)  -- numero/valor principal
 *   valueCls   (string)                 -- color del numero, ej. 'text-danger'
 *   sub        (string, opcional)       -- texto terciario; altura SIEMPRE reservada
 *   active     (boolean)               -- estado seleccionado
 *   onClick    (fn, opcional)           -- si se pasa: card clickable con hover lift
 *   activeBg   (string)                 -- clases de fondo activo
 *   inactiveBg (string)                 -- clases de fondo inactivo
 *   loading    (boolean)               -- muestra skeleton en numero y label
 */
export default function StatCard({
    icon: Icon,
    iconBg     = 'bg-surface-card-hover',
    iconCls    = 'text-content-3',
    label,
    value,
    valueCls   = 'text-content',
    sub,
    active     = false,
    onClick,
    activeBg   = 'bg-brand/5 border-brand/30 shadow-md',
    // Sin override: data-surface="card" (reactivo por tema). Con override
    // (4 call sites con tinte de hover propio, ej. TabReglas.jsx), se
    // respeta la clase pasada tal cual — data-surface no se añade porque
    // ganaría por cascade layers y taparía ese tinte custom.
    inactiveBg,
    loading    = false,
}) {
    const isClickable = !!onClick;
    const Tag = isClickable ? 'button' : 'div';
    const hasCustomInactiveBg = inactiveBg !== undefined;

    const colorCls = active ? `${activeBg} -translate-y-px` : (inactiveBg ?? '');

    // Hover solo en clickable. Nota: el scope @media (hover:hover) es
    // trabajo transversal pendiente (B2); las clases hover: de Tailwind
    // se disparan en todos los dispositivos por ahora.
    const hoverCls = isClickable && !active ? 'hover:shadow-md hover:-translate-y-px' : '';

    return (
        <Tag
            type={isClickable ? 'button' : undefined}
            onClick={onClick}
            disabled={isClickable && loading ? true : undefined}
            {...(!active && !hasCustomInactiveBg ? { 'data-surface': 'card' } : {})}
            className={`
                flex-1 basis-0 min-w-[150px] h-full
                flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border
                transition-[box-shadow,border-color,background-color,transform] duration-200
                ${isClickable ? 'cursor-pointer' : 'cursor-default select-none'}
                ${isClickable && loading ? 'disabled:opacity-60 disabled:cursor-wait' : ''}
                ${colorCls}
                ${hoverCls}
            `.replace(/\s+/g, ' ').trim()}
        >
            {/* Squircle de icono */}
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
                {loading
                    ? <Loader2 size={14} strokeWidth={2} className="animate-spin text-content-3" />
                    : <Icon size={15} strokeWidth={1.5} className={iconCls} />
                }
            </div>

            {/* Bloque de texto */}
            <div className="flex flex-col min-w-0 flex-1 text-left">

                {/* Label -- arriba del numero */}
                {loading
                    ? <div className="skeleton h-[9px] w-14 mb-1.5 rounded" />
                    : <span className="text-[10px] font-bold uppercase tracking-wider text-content-3 leading-none mb-1 truncate">
                        {label}
                      </span>
                }

                {/* Valor / numero principal */}
                {loading
                    ? <div className="skeleton h-[22px] w-12 rounded" />
                    : <span className={`text-[18px] font-black tabular-nums leading-none truncate ${valueCls}`}>
                        {value ?? 0}
                      </span>
                }

                {/*
                    Sub-texto terciario.
                    La altura se reserva con min-h-[13px] puro -- no se
                    renderiza ningun caracter de relleno. Cards con y sin
                    `sub` tienen exactamente la misma altura total.
                */}
                <span className="block text-[9px] text-content-3 font-medium leading-none mt-0.5 min-h-[13px] truncate">
                    {!loading ? sub : ''}
                </span>
            </div>

            {/* X al activar -- solo en clickable */}
            {active && isClickable && (
                <X size={11} className="text-content-3 ml-auto shrink-0" />
            )}
        </Tag>
    );
}
