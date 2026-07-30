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
 * ── MEDIDAS CANONICAS (2026-07-30, aprobadas sobre mockup) ─────────────────
 *   minimo 148px · maximo 200px · el detalle cede bajo 176px
 *
 * Antes era `flex-1 basis-0 min-w-[150px]`, o sea que se repartia el espacio
 * disponible — y eso hacia que la MISMA card midiera distinto en cada vista y en
 * cada monitor. Medido: en Ventas 2 por fila a 1512px y 4 a 1920; en Personal 2,
 * 3, 4 o 5 segun la pantalla. Y la card HUERFANA de la ultima fila crecia hasta
 * llenarla sola: en Personal a 1920px habia cuatro de 172px y **una de 726**.
 *
 * El maximo es lo que mata a la huerfana; el minimo es lo que deja entrar cinco
 * en 772px. Entre los dos crecen PAREJO, asi que dentro de una fila todas miden
 * igual.
 *
 * `compacta` esconde la linea de detalle. Es el primer dato que cede cuando falta
 * ancho —es terciario— y lo decide `CarrilCards`, que es quien conoce el ancho
 * real. Sin el, bajar de 176px cortaba el texto a mitad de palabra.
 *
 * Las cards NO envuelven: van en una sola fila y, si no entran, `CarrilCards`
 * las desliza. El padre DEBE usar items-stretch para igualar alturas.
 *
 * ── Nada se sale de la tarjeta ────────────────────────────────────────────
 * Los tres textos truncan. Antes iban con `whitespace-nowrap` a secas, o sea que
 * EMPUJABAN el ancho — y con la tarjeta ya topada en 200px lo que hacían era
 * desbordar y montarse sobre la de al lado. El `aria-label` de la tarjeta lleva
 * el texto entero, así que a un lector de pantalla no le falta nada.
 *
 * ── El radio sale del TOKEN (§8) ──────────────────────────────────────────
 * `rounded-card`, no `rounded-2xl`. Con el radio fijo la tarjeta medía 1rem
 * mientras cualquier bloque con `data-surface="card"` media 1.75 en vidrio: en la
 * misma fila convivían dos formas distintas y se veía. Y en el tema sólido el
 * token baja a 0.75rem, que es la forma recta que ese tema quiere.
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
    // `className` y `style` existen por el stagger de entrada de TabSinVenta:
    // sus tarjetas escalonan la aparición con `animationDelay`. Sin esto la
    // migración habría tenido que elegir entre el canónico y la animación.
    className  = '',
    // Sin la linea de detalle. Lo decide el carril a partir del ancho real.
    compacta = false,
    style,
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
            // El DOM dice "12, Vencidos" porque el valor va primero; esto lo
            // devuelve al orden en que una persona lo diría.
            // Mientras carga NO puede quedarse sin nombre: el contenido es un
            // spinner, así que el botón se anunciaba como "botón" a secas
            // (encontrado el 2026-07-28 barriendo nombres accesibles en vivo).
            // `aria-busy` es lo que hace que el lector avise que está cargando.
            aria-label={loading ? `${label}: cargando` : `${label}: ${value ?? 0}${sub ? `, ${sub}` : ''}`}
            aria-busy={loading || undefined}
            disabled={isClickable && loading ? true : undefined}
            {...(!active && !hasCustomInactiveBg ? { 'data-surface': 'card' } : {})}
            className={`
                basis-[148px] grow shrink-0 min-w-0 max-w-[200px] h-full
                flex items-center gap-3 pl-3 pr-4 py-3 rounded-card border
                transition-[box-shadow,border-color,background-color,transform] duration-200
                ${isClickable ? 'cursor-pointer' : 'cursor-default select-none'}
                ${isClickable && loading ? 'disabled:opacity-60 disabled:cursor-wait' : ''}
                ${colorCls}
                ${hoverCls}
                ${className}
            `.replace(/\s+/g, ' ').trim()}
            style={style}
        >
            {/* Squircle de icono */}
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
                {loading
                    ? <Loader2 size={14} strokeWidth={2} className="animate-spin text-content-3" />
                    : <Icon size={15} strokeWidth={1.5} className={iconCls} />
                }
            </div>

            {/* Bloque de texto — EL VALOR VA ARRIBA.
                Hasta el 2026-07-28 este canónico ponía la etiqueta primero. Al
                medir las tarjetas de métrica escritas a mano en el portal
                aparecieron **10, y las 10 ponen el valor arriba**; ninguna la
                etiqueta. O sea que el canónico había elegido un orden que no
                usaba nadie más — el mismo hallazgo que con los aros de foco y
                con los ejes que le faltaban a `Button`.
                Y el orden importa: un tablero se ESCANEA, el ojo salta de
                número en número y la etiqueta confirma. Con la etiqueta
                primero hay que leer para encontrar el dato.
                Lo que se pierde así es el orden de lectura de un lector de
                pantalla ("12, Vencidos"), y por eso la tarjeta lleva
                `aria-label` con el orden natural. */}
            <div className="flex flex-col min-w-0 flex-1 text-left">

                {/* Valor / numero principal */}
                {loading
                    ? <div className="skeleton h-[22px] w-12 rounded" />
                    // Sin `truncate`: un número cortado no comunica nada — se
                    // vio en Inventario, donde "$331,327.89" se leía "$331,3…".
                    // La tarjeta tiene `flex-1 basis-0` y `min-w` es un mínimo,
                    // no un máximo: que crezca es exactamente lo correcto.
                    // `truncate` también en el valor. El comentario de arriba
                    // decía que un número cortado no comunica nada, y es cierto —
                    // pero la alternativa medida era peor: con `nowrap` a secas el
                    // número SE SALÍA de la tarjeta y se montaba sobre la de al
                    // lado. Contenido y cortado se lee mal; desbordado rompe la
                    // fila. Con 200px de máximo el corte es el caso raro.
                    : <span className={`block truncate text-title-sm font-black tabular-nums leading-none ${valueCls}`}>
                        {value ?? 0}
                      </span>
                }

                {loading
                    ? <div className="skeleton h-[9px] w-14 mt-1.5 rounded" />
                    // Ni la etiqueta ni el subtexto se truncan, por la misma
                    // razón que el valor: "Modificados est…" no dice nada. La
                    // tarjeta crece; con `flex-1 basis-0` las anchas se llevan
                    // más espacio de la fila, que es lo que hacían las 10
                    // versiones a mano antes de migrar.
                    //
                    // 2026-07-28: "la tarjeta crece" vale mientras la FILA tenga
                    // de dónde. En un teléfono no la tiene, y el `nowrap` dejaba
                    // de empujar el ancho para pasar a cortar: medido en un
                    // iPhone 13, "precios o datos cambiados" y "< 15% en algún
                    // precio" salían cortados a mitad de palabra. Bajo 560px el
                    // texto envuelve — una etiqueta de dos líneas se lee, una
                    // cortada no.
                    : <span className="block truncate text-caption font-bold text-content-2 leading-none mt-1">
                        {label}
                      </span>
                }

                {/*
                    Sub-texto terciario.
                    La altura se reserva con min-h-[13px] puro -- no se
                    renderiza ningun caracter de relleno. Cards con y sin
                    `sub` tienen exactamente la misma altura total.
                */}
                {!compacta && (
                    <span className="block truncate text-micro text-content-3 font-medium leading-none mt-0.5 min-h-[13px]">
                        {!loading ? sub : ''}
                    </span>
                )}
            </div>

            {/* X al activar -- solo en clickable */}
            {active && isClickable && (
                <X size={11} className="text-content-3 ml-auto shrink-0" />
            )}
        </Tag>
    );
}
