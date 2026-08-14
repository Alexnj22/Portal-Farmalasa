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
 *   tono       ('brand'|'success'|'warning'|'danger') -- ver la regla de abajo
 *   loading    (boolean)               -- muestra skeleton en numero y label
 *   densa      (boolean)               -- la medida de BALDOSA (ver abajo)
 *
 * ── `densa`: la misma tarjeta dentro de una baldosa del Inicio ─────────────
 * Las medidas canónicas de arriba son las de una VISTA, donde la fila de
 * métricas manda y tiene la pantalla entera. Dentro de una baldosa del tablero
 * el presupuesto es otro: el alto es fijo y todo lo que se lleve la franja de
 * arriba se lo quita a la lista de abajo, que es a lo que la persona entró.
 *
 * Medido en la baldosa de Cortes: las tres tarjetas se llevaban 88px de un
 * tablero donde sólo entraban dos cortes. Y 13 de esos px eran la línea de
 * `sub` RESERVADA — la baldosa nunca pasa `sub`, así que reservaba altura para
 * un dato que no existe.
 *
 * `densa` no es otro diseño: es la misma anatomía —squircle, valor arriba,
 * etiqueta debajo— con el squircle y los aires de una baldosa, y sin la línea
 * terciaria. Implica `compacta`.
 *
 * ── CUÁNDO se le pone color a una tarjeta (2026-07-30) ────────────────────
 * **Por defecto NO se le pone.** Todas las tarjetas del portal comparten el
 * mismo vidrio: `data-surface="card"`, siempre, sin excepción. Que una fila
 * mezcle fondos distintos no comunica nada — hace que la fila se lea como cinco
 * componentes distintos en vez de una sola métrica repetida.
 *
 * Lo que SÍ lleva color, porque ahí el color es el dato:
 *
 *   · el NÚMERO (`valueCls`) — rojo si es una pérdida, verde si es una meta
 *   · el ÍCONO (`iconBg` + `iconCls`) — identifica la categoría de un vistazo
 *
 * Lo que NO: el fondo y el borde de la tarjeta. Para eso está `tono`, que marca
 * el estado SELECCIONADO y nada más — se dibuja con `data-tono` (index.css), o
 * sea un anillo del color pegado al borde, no un relleno. La paleta es cerrada:
 * `brand`, `success`, `warning`, `danger`.
 *
 * Antes existían `activeBg` e `inactiveBg`, que recibían clases sueltas de cada
 * vista: 19 call sites, cada uno con su propio tinte de fondo y de hover. Y
 * cuando una vista pasaba `inactiveBg`, la tarjeta **perdía `data-surface`** —
 * por eso en la misma fila había tarjetas con vidrio y tarjetas casi
 * transparentes, que es lo que el usuario reportó. Las dos props se retiraron.
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
    // El color del estado SELECCIONADO. Ver la regla del encabezado.
    tono       = 'brand',
    loading    = false,
    // `className` y `style` existen por el stagger de entrada de TabSinVenta:
    // sus tarjetas escalonan la aparición con `animationDelay`. Sin esto la
    // migración habría tenido que elegir entre el canónico y la animación.
    className  = '',
    // Sin la linea de detalle. Lo decide el carril a partir del ancho real.
    compacta = false,
    // La medida de baldosa. Ver la nota del encabezado.
    densa = false,
    style,
}) {
    const isClickable = !!onClick;
    const Tag = isClickable ? 'button' : 'div';
    // Una baldosa nunca pasa `sub`, y reservarle la línea es alto regalado.
    const sinDetalle = compacta || densa;

    // Hover solo en clickable. Nota: el scope @media (hover:hover) es
    // trabajo transversal pendiente (B2); las clases hover: de Tailwind
    // se disparan en todos los dispositivos por ahora.
    // Sin lift a mano: el elemento lleva `data-surface="card"` y el canónico ya
    // lo levanta con `--lift-card`. Cuando además traía uno acá los dos se
    // sumaban —`transform` del canónico + `translate` de Tailwind son
    // propiedades distintas— y la tarjeta se movía 3px en vez de 2 (medido el
    // 2026-08-02 en /staff, donde encima vive anidada dentro de otra tarjeta).
    const hoverCls = isClickable && !active ? 'hover:shadow-md' : '';

    return (
        <Tag
            type={isClickable ? 'button' : undefined}
            // fase E: el gel y el destello van sólo donde se apunta. Acá no
            // pasa por `clickable()` porque cuando es clicable el elemento YA
            // es un `<button>` nativo, que no necesita el contrato de teclado.
            data-interactive={isClickable ? '' : undefined}
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
            // `data-surface` SIEMPRE. Antes se le quitaba a la tarjeta activa y a
            // la que traía fondo propio, y ahí perdía el vidrio del tema: en la
            // misma fila convivían tarjetas con `backdrop-filter` y tarjetas
            // planas. El estado va por `data-tono`, que es un anillo sobre el
            // MISMO material, no otro material.
            data-surface="card"
            data-tono={active ? tono : undefined}
            // `max-sm:basis-[calc(50%-0.25rem)]` — en el teléfono la baldosa es
            // más angosta que su propio número. Con 148px de base le quedan 85
            // para el valor, y `$242,586.29` mide 90 aun con la letra ya
            // encogida: se leía «$242,5…» en Metas, «0 CCF urgen…» en
            // Facturación, «0.0h Horas reg…» en Auditoría. Dos por pantalla
            // exactas (191px) le dan 111 y entra entero. El carril sigue
            // deslizando para las que siguen.
            className={`
                ${densa
                    // 104px: tres entran en los ~330px que mide una baldosa del
                    // tablero sin que el carril tenga que deslizar. El máximo
                    // sigue siendo el que mata a la tarjeta huérfana.
                    ? 'basis-[104px] max-w-[160px]'
                    : 'basis-[148px] max-sm:basis-[calc(50%-0.25rem)] max-w-[200px]'}
                grow shrink-0 min-w-0 h-full
                flex items-center rounded-card border
                ${densa ? 'gap-2 pl-2 pr-2.5 py-2' : 'gap-3 pl-3 pr-4 py-3'}
                transition-[box-shadow,border-color,background-color,transform] duration-[var(--dur-base)]
                ${isClickable ? 'cursor-pointer active:scale-[0.97]' : 'cursor-default select-none'}
                ${isClickable && loading ? 'disabled:opacity-60 disabled:cursor-wait' : ''}
                ${active ? '-translate-y-px' : ''}
                ${hoverCls}
                ${className}
            `.replace(/\s+/g, ' ').trim()}
            style={style}
        >
            {/* Squircle de icono */}
            <div className={`${densa ? 'w-7 h-7 rounded-lg' : 'w-9 h-9 rounded-xl'}
                flex items-center justify-center shrink-0 ${iconBg}`}>
                {loading
                    ? <Loader2 size={densa ? 12 : 14} strokeWidth={2} className="animate-spin text-content-3" />
                    : <Icon size={densa ? 13 : 15} strokeWidth={1.5} className={iconCls} />
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
                    // ── El cuerpo del número se adapta a su largo ──────────
                    // `$249,417.30` no entra en 148px a `text-title-sm`, y
                    // truncado queda `$249,4…`, que no dice nada. Encoger la
                    // tipografía lo deja LEGIBLE y entero sin tocar el ancho de
                    // la tarjeta, que es lo que mantiene la fila pareja.
                    // En `densa` el techo baja un escalón: el número sigue
                    // siendo lo primero que se lee, pero en una baldosa no
                    // compite con nada más y a `text-title-sm` empujaba el alto
                    // de la franja entera.
                    : <span className={`block truncate tabular-nums font-black leading-none ${
                        String(value ?? '').length > 9 ? 'text-body'
                        : String(value ?? '').length > 6 ? 'text-body-lg'
                        : densa ? 'text-body-lg' : 'text-title-sm'} ${valueCls}`}>
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
                {!sinDetalle && (
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
