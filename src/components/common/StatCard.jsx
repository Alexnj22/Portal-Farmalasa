import { Loader2, X } from 'lucide-react';

/**
 * StatCard — tarjeta de métrica reutilizable.
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
 * ⚠️  THEMING PENDIENTE — fondo no tokenizado:
 * El default de `inactiveBg` usa bg-white border-slate-200 hardcodeado.
 * Cuando se agregue el token [data-surface="card-flat"] a index.css,
 * reemplazar ese default por el atributo selector. Hasta entonces el fondo
 * solo funciona correctamente en tema claro.
 *
 * Props:
 *   icon       (component, obligatorio) — ícono Lucide
 *   iconBg     (string)                 — clases Tailwind para el squircle, ej. 'bg-red-50'
 *   iconCls    (string)                 — clases para el ícono, ej. 'text-red-500'
 *   label      (string, obligatorio)    — etiqueta superior
 *   value      (string|number, oblig.)  — número/valor principal
 *   valueCls   (string)                 — color del número, ej. 'text-red-600'
 *   sub        (string, opcional)       — texto terciario; espacio SIEMPRE reservado
 *   active     (boolean)               — estado seleccionado
 *   onClick    (fn, opcional)           — si se pasa → card clickable con hover lift
 *   activeBg   (string)                 — clases de fondo activo
 *   inactiveBg (string)                 — clases de fondo inactivo
 *   loading    (boolean)               — muestra skeleton en número y label
 */
export default function StatCard({
    icon: Icon,
    iconBg     = 'bg-slate-100',
    iconCls    = 'text-slate-500',
    label,
    value,
    valueCls   = 'text-slate-700',
    sub,
    active     = false,
    onClick,
    activeBg   = 'bg-[#0052CC]/5 border-[#0052CC]/30 shadow-md',
    inactiveBg = 'bg-white border-slate-200', // ⚠️ TODO: [data-surface="card-flat"]
    loading    = false,
}) {
    const isClickable = !!onClick;
    const Tag = isClickable ? 'button' : 'div';

    // Estado de color: active > inactive
    const colorCls = active ? `${activeBg} -translate-y-px` : inactiveBg;

    // Hover (solo clickable, solo en dispositivos pointer — nota: el scope
    // @media (hover:hover) es trabajo transversal pendiente B2)
    const hoverCls = isClickable && !active ? 'hover:shadow-md hover:-translate-y-px' : '';

    return (
        <Tag
            type={isClickable ? 'button' : undefined}
            onClick={onClick}
            disabled={isClickable && loading ? true : undefined}
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
            {/* ── Squircle de ícono ─────────────────────────────────────── */}
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
                {loading
                    ? <Loader2 size={14} strokeWidth={2} className="animate-spin text-slate-300" />
                    : <Icon size={15} strokeWidth={1.5} className={iconCls} />
                }
            </div>

            {/* ── Bloque de texto ───────────────────────────────────────── */}
            <div className="flex flex-col min-w-0 flex-1 text-left">

                {/* Label — arriba del número */}
                {loading
                    ? <div className="skeleton h-[9px] w-14 mb-1.5 rounded" />
                    : <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 leading-none mb-1 truncate">
                        {label}
                      </span>
                }

                {/* Valor / número principal */}
                {loading
                    ? <div className="skeleton h-[22px] w-12 rounded" />
                    : <span className={`text-[22px] font-black tabular-nums leading-none ${valueCls}`}>
                        {value ?? 0}
                      </span>
                }

                {/*
                    Sub-texto terciario.
                    min-h-[13px] se reserva SIEMPRE — aunque `sub` sea undefined —
                    para que cards con y sin sub tengan exactamente la misma altura
                    y el bloque no colapse ni desplace el número.
                */}
                <span className="block text-[9px] text-slate-400 font-medium leading-none mt-0.5 min-h-[13px] truncate">
                    {!loading ? (sub ?? ' ') : ''}
                </span>
            </div>

            {/* ── X al activar (solo en clickable) ─────────────────────── */}
            {active && isClickable && (
                <X size={11} className="text-slate-400 ml-auto shrink-0" />
            )}
        </Tag>
    );
}
