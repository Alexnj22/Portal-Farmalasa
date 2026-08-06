import React, { memo, Children, isValidElement, useState, useEffect, useLayoutEffect, useId, useRef, useCallback, createContext, useContext } from 'react';
import AsaHoja from './AsaHoja';
import { createPortal } from 'react-dom';
import { X, SlidersHorizontal, MoreHorizontal, Building2 } from 'lucide-react';
import useLayoutCompacto from '../../hooks/useLayoutCompacto';
// El anclaje de los paneles de esta barra vive en `hooks/` desde que son tres
// (desborde, otros, y el de borradores que TabMinMax mete como ranura).
import useAnclaje from '../../hooks/useAnclaje';
import Contador from './Contador';
import BarraFlotante from './BarraFlotante';
import TabBarAction from './TabBarAction';
import SegmentedControl from './SegmentedControl';
import LiquidSelect from './LiquidSelect';
import LiquidTooltip from './LiquidTooltip';
import { useBuscadorDeVista, usePublicarBarraFlotante } from './CanalDeVista';

/**
 * FilterBar — la píldora donde vive TODO el filtro de la vista actual.
 *
 * Canónico creado el 2026-07-27. Ya existía un `FilterPill`, pero vivía en
 * `views/pedidos/tabpedidos/` y estaba **clavado a los filtros de Pedidos**
 * (sucursal, fecha, estado): no era un contenedor, era esa barra concreta. Por
 * eso las otras 13 vistas lo reescribieron.
 *
 * ── Reglas de uso (ver DESIGN.md §17) ────────────────────────────────────
 * Va SIEMPRE a la derecha, en la fila del título. Una sola por vista. Nunca
 * dentro de una tarjeta ni de una tabla — filtra la vista entera.
 *
 * El ORDEN de las ranuras no es libre. De ámbito más amplio a más angosto:
 *   1 ámbito (sucursal)  2 entidad (laboratorio, categoría)
 *   3 tiempo (período)   4 estado (chips)   5 limpiar
 * Es el orden en que una persona lo diría en voz alta: "las ventas de La
 * Popular, de Bayer, de julio, sin las anuladas". Si la vista tiene selector
 * de sucursal, va primero SIEMPRE: es el filtro que cambia el significado de
 * todos los demás — "julio" no quiere decir lo mismo en una sucursal que en
 * toda la red.
 *
 * ── Lo que se corrigió en v2, sobre la revisión del usuario ───────────────
 * · El filtro aplicado era un fondo teñido que llegaba hasta el divisor con la
 *   esquina recta: leía como "un botón cortado". Ahora es un CHIP completo, con
 *   su propio radio y aire alrededor — la misma forma que badges, segmentados y
 *   botones, así que pertenece.
 * · Faltaba limpiar todo. Ahora aparece con 2+ filtros aplicados.
 * · El alto NO era fijo: de las 14 barras del portal, 12 tenían alto automático,
 *   una `h-14` y otra `h-[4rem]`, así que se veía distinta en cada vista. Ahora
 *   son 52px pase lo que pase, y la barra se alinea con el título en todas.
 *
 * ── Los BOTONES DE ACCIÓN también viven acá (2026-07-30) ─────────────────
 * `FilterBar` lleva los filtros de la vista **y sus acciones**. La píldora del
 * header es navegación y buscador, nada más.
 *
 * Hasta esta fecha las acciones vivían en `ViewTabBar.trailingActions`, y esa
 * ranura se había vuelto un cajón de sastre: además de acciones de verdad
 * ("Nuevo Empleado", "Publicar", "Exportar") guardaba **filtros** —el rango de
 * fechas de `TabHistory`, el `SegmentedControl` de tipo de
 * `EmployeeAnnouncementsView`, el selector "Copiar desde…" de `PermissionsView`—.
 * O sea que el header terminó filtrando, que es justo lo que §17 dice que no
 * hace. Juntar filtro y acción en un solo contenedor cierra esa puerta: no
 * queda otro sitio donde poner un filtro por descuido.
 *
 * Las acciones son DESCRIPTORES, no JSX, porque el mismo botón tiene que
 * dibujarse de dos maneras muy distintas: `TabBarAction` en la píldora de
 * escritorio y un botón del clúster en la barra flotante táctil. Con JSX suelto
 * la barra flotante solo podría re-renderizarlo tal cual, que es como se llegó
 * a tener controles de 44px fuera del viewport a 390px.
 *
 *   <FilterBar
 *       activeCount={n} onClear={limpiar}
 *       acciones={[
 *           { key: 'nuevo',  icon: Plus,     label: 'Nuevo Empleado', variant: 'primary', onClick: crear },
 *           { key: 'export', icon: Download, label: 'Exportar', tone: 'success', onClick: exportar },
 *       ]}
 *   >
 *       <FilterBar.Section label="sucursal">…</FilterBar.Section>
 *   </FilterBar>
 *
 * `accionesExtra` es la escotilla para lo que no entra en un descriptor (un
 * `Badge` de estado, un `LiquidSelect` de "copiar desde"). Va al final de la
 * píldora en escritorio y a la hoja de acciones en táctil.
 *
 * ── Móvil ────────────────────────────────────────────────────────────────
 * Bajo 720px `FilterBar` **es** la barra flotante (§17.3), con los tres
 * elementos juntos al alcance del pulgar: buscador, filtros y acción principal.
 *
 * El buscador NO hay que pasárselo: lo publica `ViewTabBar` por el canal de
 * `CanalDeVista` y esta barra lo encuentra sola. Cuando era una prop opt-in la
 * pasaba **1 vista de 22** — y en las 5 pestañas de Productos era imposible,
 * porque el estado del buscador vive en la vista padre.
 */

/**
 * Si la barra está colapsada en hoja inferior. Lo necesita `Section` porque su
 * alto NO puede ser el mismo en los dos modos:
 *
 * En la píldora de escritorio el `h-9` fijo es lo que hace que la barra mida
 * 52px tenga una ranura o cinco. En la hoja del teléfono las ranuras se apilan
 * en columna, y ahí ese mismo `h-9` recorta: un control más alto que 36px —un
 * `SegmentedControl` en bloque de dos filas, por ejemplo— se desborda de su
 * ranura y **se solapa con la de arriba**. No se ve en escritorio porque ahí
 * todo control de filtro es de una fila.
 */
const BarraCtx = createContext({ compacto: false });

const Section = memo(({
    children,
    // `active` + `onClear` son lo que convierte la ranura en chip. No se
    // deducen solos a propósito: solo la vista sabe cuál es el valor "sin
    // filtrar" de su propio control (a veces es '', a veces 'all', a veces el
    // mes en curso).
    active = false,
    // Y otra, `prioridad` (número, 0 por defecto): cuál cede primero cuando
    // faltan ranuras. Hasta el 2026-08-05 cedía la ÚLTIMA del orden de §17, y
    // ese orden es de lectura —ámbito → entidad → tiempo → estado—, no de
    // importancia: en MIN·MAX dejaba a la vista la matriz ABC y escondía
    // «Estado», que es el filtro que la gente usa. El orden de dibujo no se
    // toca; lo que se ordena es la cola de a quién se le quita el sitio.
    //
    // Hay una prop más, `fija`, que NO se lee acá: la lee la píldora sobre
    // `s.props.fija` al repartir el ancho, y significa "esta ranura no se va al
    // control de desborde ni estando vacía". Es para la que además de filtrar
    // lleva la ACCIÓN principal de la pantalla adentro —hoy solo los borradores
    // de MIN·MAX, cuyo panel tiene el «Publicar todo»—: sin ella, a 1280px la
    // barra la escondía tras «más filtros» y publicar pasaba a ser dos clics a
    // ciegas (medido en captura). Opt-in y ha de seguir siendo rara — una barra
    // con todas las ranuras fijas ya no puede degradar.
    onClear,
    label,
    className = '',
}) => {
  const { compacto } = useContext(BarraCtx);
  // `h-9` y no `h-full`: desde que la píldora puede envolver (las acciones entran
  // en el mismo contenedor) su alto ya no es fijo, y un `height:100%` contra un
  // contenedor de alto automático es indefinido — la ranura se colapsaba a 0.
  // Los 36px son los mismos de antes: 52 = 36 + 8 + 8.
  return (
    <div data-pieza={compacto ? undefined : 'ranura'}
        className={`flex items-center min-w-0 ${compacto ? 'h-auto w-full px-2' : 'h-9 px-1'} ${className}`}>
        <div className={`flex items-center gap-1 px-0.5 rounded-btn border transition-[background-color,border-color] duration-[var(--dur-base)]
            ${compacto ? 'min-h-9 h-auto w-full flex-wrap' : 'h-9'}
            ${active ? 'bg-brand/10 border-brand/30' : 'border-transparent'}`}>
            {children}
            {active && onClear && (
                <button type="button" onClick={onClear}
                    title={label ? `Quitar ${label.toLowerCase()}` : 'Quitar este filtro'}
                    aria-label={label ? `Quitar ${label.toLowerCase()}` : 'Quitar este filtro'}
                    className="w-[18px] h-[18px] mr-1 shrink-0 rounded-full flex items-center justify-center
                        text-brand-text/60 hover:text-danger-text hover:bg-danger/15 transition-colors duration-[var(--dur-fast)]">
                    <X size={11} strokeWidth={3} />
                </button>
            )}
        </div>
    </div>
  );
});
Section.displayName = 'FilterBar.Section';

/**
 * FilterBar.Chip — un filtro que se prende y se apaga, no una opción de N.
 *
 * Es la cuarta ranura del orden (§17): "¿cómo está?" — anuladas, pendientes,
 * vencidos. NO es `SegmentedControl`: varios pueden estar prendidos a la vez, y
 * cada uno es independiente. Confundirlos daría un `radiogroup` donde el lector
 * de pantalla anunciaría "1 de 3" para algo que no es excluyente.
 *
 * Cuando está prendido muestra su × adentro, para que apagarlo sea un clic y no
 * "buscar dónde estaba el filtro".
 */
const Chip = memo(({ active, onToggle, tone = 'danger', children, ...rest }) => (
    <button type="button" onClick={onToggle} aria-pressed={active}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-btn shrink-0
            text-caption font-black uppercase tracking-widest border whitespace-nowrap
            transition-[background-color,border-color,color] duration-[var(--dur-base)]
            ${active
                ? (tone === 'danger'  ? 'bg-danger/12 border-danger/30 text-danger-text'
                 : tone === 'warning' ? 'bg-warning/12 border-warning/30 text-warning-text'
                 : tone === 'success' ? 'bg-success/12 border-success/30 text-success-text'
                 :                      'bg-brand/12 border-brand/30 text-brand-text')
                : 'bg-transparent border-transparent text-content-3 hover:bg-surface-card-hover hover:text-content-2'}`}
        {...rest}>
        {children}
        {active && <X size={9} strokeWidth={3} aria-hidden="true" />}
    </button>
));
Chip.displayName = 'FilterBar.Chip';


/**
 * FilterBar.Opciones — un filtro de UNA de N opciones, sin que la vista tenga
 * que elegir el control.
 *
 * **Hasta 3 opciones es `SegmentedControl`; de 4 en adelante, `LiquidSelect`.**
 * Los dos son lo mismo semánticamente —uno de N— y la diferencia es de ancho:
 * un segmentado de 5 opciones se come la píldora entera y deja a las demás
 * ranuras sin sitio, que es lo que pasaba en "Mis Documentos" (Todos + los 4
 * estados). El umbral es del canónico y no del llamador por el mismo motivo de
 * siempre: si es una decisión que se toma vista por vista, se toma distinto en
 * cada vista.
 *
 * `umbral` existe para el caso raro de etiquetas larguísimas donde ya con 3 no
 * entra — bajarlo a 2 es legítimo; subirlo, casi nunca.
 */
const Opciones = memo(({
    options = [],
    value,
    onChange,
    label,
    icon,
    placeholder = 'Todos',
    umbral = 3,
    ancho = '170px',
}) => {
    if (options.length <= umbral) {
        return <SegmentedControl size="sm" options={options} value={value} onChange={onChange} label={label} />;
    }
    return (
        <div style={{ width: ancho }}>
            <LiquidSelect
                value={value}
                onChange={onChange}
                options={options}
                placeholder={placeholder}
                icon={icon}
                label={label}
                clearable={false}
                compact bare
            />
        </div>
    );
});
Opciones.displayName = 'FilterBar.Opciones';

/**
 * FilterBar.Sucursal — la ranura de ámbito, que es la primera de §17 y la que
 * más se repetía a mano.
 *
 * Estaba escrita en 9 vistas con 4 textos distintos ("Todas las Sucursales",
 * "Todas las sucursales", "Todas", ninguno) y anchos entre 150 y 220px, así que
 * la misma ranura se veía diferente en cada pantalla. El texto canónico es
 * **"Sucursales"**: nombra el filtro en vez de describir su estado vacío, que es
 * lo que hace que se lea igual esté puesto o no — y de paso ocupa la mitad, que
 * es lo que le devuelve el espacio a la píldora.
 */
const Sucursal = memo(({ value, onChange, options = [], ancho = '150px', ...rest }) => {
    // La opción "todas" también se normaliza, y es la mitad del arreglo: casi
    // todas las vistas la traen DENTRO de `options` con su propio texto ("Todas
    // las Sucursales", "Todas las sucursales", "Todas"), así que el select
    // mostraba ese label y no el placeholder — y "Todas las Sucursales" en 150px
    // se corta a "Todas las Suc…". El valor no se toca, solo cómo se lee.
    const opciones = options.map(o =>
        /^todas?\b/i.test(String(o?.label ?? '')) ? { ...o, label: 'Sucursales' } : o);

    return (
        <div style={{ width: ancho }}>
            <LiquidSelect
                value={value}
                onChange={onChange}
                options={opciones}
                placeholder="Sucursales"
                label="Sucursal"
                icon={Building2}
                clearable={false}
                compact bare
                {...rest}
            />
        </div>
    );
});
Sucursal.displayName = 'FilterBar.Sucursal';
// El ícono de esta ranura, para cuando es la única y se dibuja como botón del
// clúster en el teléfono. Estático y no prop: la vista no debería tener que
// declarar dos veces algo que el control ya sabe.
Sucursal.iconoRanura = Building2;

/**
 * PanelDesborde — las ranuras que no entran en la píldora, tras un ícono.
 *
 * La píldora tiene un presupuesto FIJO de ranuras visibles (`MAX_RANURAS`), y no
 * un ancho que crezca con lo que cada vista quiera meterle. Antes crecía: medida
 * a 1512px iba de 189px (Solicitudes) a 782px (Auditoría), así que la misma
 * píldora se veía distinta en cada pantalla y le robaba a las tarjetas un ancho
 * distinto en cada vista.
 *
 * **Las ranuras APLICADAS nunca se esconden.** Es la regla que hace que esto no
 * rompa §17 —"el lugar único donde el usuario mira para saber qué está
 * filtrando"—: si se ocultara un filtro activo, la vista mostraría datos
 * recortados sin nada visible que lo explicara. Se esconden las vacías, y el
 * botón lleva un `Contador` con cuántas quedaron guardadas.
 *
 * Va por portal y se posiciona contra el botón: dentro de la píldora quedaría
 * recortado por su propio `overflow`.
 */
// El ícono y el rótulo de una ranura, para cuando hay UNA sola y se dibuja como
// botón del clúster. Se leen del control que la ranura ya contiene en vez de
// pedirle una prop nueva a cada vista: `FilterBar.Sucursal` pasa `Building2` y
// `FilterBar.Opciones` recibe el suyo, así que el dato ya existe.
const iconoDeSeccion = (sec) => {
    const ctrl = sec?.props?.children;
    // `FilterBar.Opciones` recibe su ícono por prop; `FilterBar.Sucursal` lo tiene
    // adentro y lo publica como estático, que es la forma de que el dato salga sin
    // pedirle nada nuevo a la vista.
    return ctrl?.props?.icon ?? ctrl?.type?.iconoRanura;
};
const rotuloDeSeccion = (sec) => {
    // El VALOR gana sobre el nombre del filtro. Un botón que dice "Período" te
    // obliga a abrirlo para saber cuál; uno que dice "Este mes" ya contestó. Lo
    // calcula el control —`PeriodPicker.textoRanura`— y no la vista, por lo mismo
    // que el ícono: un dato que el control ya sabe no se declara dos veces.
    const ctrl = sec?.props?.children;
    const valor = ctrl?.type?.textoRanura?.(ctrl.props);
    if (valor) return valor;
    const l = sec?.props?.label;
    return l ? l.charAt(0).toUpperCase() + l.slice(1) : undefined;
};

const PanelDesborde = memo(({ secciones, aplicadas }) => {
    const [abierto, setAbierto] = useState(false);
    const cerrar = useCallback(() => setAbierto(false), []);
    const id = useId();
    const { btnRef, caja } = useAnclaje(abierto, cerrar, id);

    return (
        <>
            <span aria-hidden="true" className="h-[22px] w-px bg-divider shrink-0" />
            <div className="flex items-center h-9 px-1">
                {/* Tiene la MISMA forma que una ranura —36px de alto, píldora,
                    mismo relleno— y no un cuadrito aparte: es una ranura movida
                    de sitio, no otro tipo de control. Se tiñe de marca cuando lo
                    que guarda está aplicado, igual que una ranura activa, para
                    que se vea desde lejos que hay filtro puesto aunque su control
                    no esté a la vista. La cuenta va al lado del ícono y no como
                    burbuja encima: acá el número es el contenido, no un aviso. */}
                <button ref={btnRef} type="button" onClick={() => setAbierto(v => !v)}
                    aria-expanded={abierto} aria-haspopup="dialog"
                    aria-label={aplicadas > 0
                        ? `Más filtros: ${secciones.length} guardados, ${aplicadas} aplicado${aplicadas === 1 ? '' : 's'}`
                        : `Más filtros (${secciones.length})`}
                    className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-btn shrink-0 border
                        transition-[background-color,border-color,color] duration-[var(--dur-base)]
                        ${aplicadas > 0 || abierto
                            ? 'bg-brand/10 border-brand/30 text-brand-text'
                            : 'bg-surface-card-hover border-border-card text-content-2 hover:text-content'}`}>
                    <SlidersHorizontal size={14} strokeWidth={2.5} />
                    <span className="text-body-sm font-bold tabular-nums">{secciones.length}</span>
                </button>
            </div>

            {abierto && caja && createPortal(
                <div data-panel={id} role="dialog" aria-label="Más filtros"
                    data-surface="dropdown"
                    style={{ top: caja.top, right: caja.right }}
                    className="fixed z-dropdown w-[280px] p-3 flex flex-col gap-3
                        animate-in fade-in zoom-in-95 duration-[var(--dur-fast)] ease-out">
                    {secciones.map((s, i) => (
                        <div key={i} className="flex flex-col gap-1.5">
                            {s.props?.label && (
                                <span className="text-caption font-black uppercase tracking-widest text-content-3">
                                    {s.props.label}
                                </span>
                            )}
                            <div className="[&_*]:!max-w-full">{s}</div>
                        </div>
                    ))}
                </div>,
                document.body,
            )}
        </>
    );
});
PanelDesborde.displayName = 'FilterBar.PanelDesborde';

/**
 * PanelAcciones — «Otros»: las acciones secundarias tras un solo control.
 *
 * Es el mismo repliegue que el clúster táctil ya hacía con `MoreHorizontal`
 * («de dos secundarias para arriba se agrupan»), traído a la píldora de
 * escritorio. Hasta el 2026-08-05 la barra solo sabía ceder el TEXTO de las
 * acciones; cuando ni los íconos entraban, lo siguiente que cedía era una
 * RANURA — o sea que la píldora escondía un filtro para dejar tres íconos a la
 * vista, que es al revés de lo que la barra es.
 *
 * La acción principal nunca entra acá: es la que la pantalla existe para que
 * se apriete. Lo que se agrupa son las de solo ícono —exportar, configurar,
 * paneles— que ya venían sin rótulo.
 */
const PanelAcciones = memo(({ acciones, extra }) => {
    const [abierto, setAbierto] = useState(false);
    const cerrar = useCallback(() => setAbierto(false), []);
    const id = useId();
    const { btnRef, caja } = useAnclaje(abierto, cerrar, id);

    // Un panel abierto adentro (config, laboratorios) tiene que verse desde
    // afuera: si no, agrupar convierte un interruptor encendido en un estado
    // invisible. Es la misma regla que «una ranura aplicada no se esconde».
    const activas = acciones.filter(a => a.activo).length;

    return (
        <>
            {/* `div` con la ref y no la ref en el botón: `TabBarAction` es un
                `memo` sin `forwardRef`, y clonar sus 12 clases acá para poder
                medirlo sería tener dos botones que hay que mantener iguales. */}
            <div ref={btnRef} className="flex">
                <TabBarAction size="sm" soloIcono icon={MoreHorizontal}
                    label={activas > 0 ? `Otros (${activas} abierto${activas === 1 ? '' : 's'})` : 'Otros'}
                    onClick={() => setAbierto(v => !v)}
                    aria-expanded={abierto} aria-haspopup="dialog"
                    aria-pressed={activas > 0}
                    className={activas > 0 || abierto ? '!bg-brand/10 !border-brand/30 !text-brand-text' : ''} />
            </div>

            {abierto && caja && createPortal(
                <div data-panel={id} role="dialog" aria-label="Otras acciones"
                    data-surface="dropdown"
                    style={{ top: caja.top, right: caja.right }}
                    className="fixed z-dropdown w-[240px] p-2 flex flex-col gap-2
                        animate-in fade-in zoom-in-95 duration-[var(--dur-fast)] ease-out">
                    {acciones.map(a => (
                        <TabBarAction key={a.key} size="sm" icon={a.icon} tone={a.tone}
                            as={a.as} href={a.href} target={a.target} rel={a.rel}
                            disabled={a.disabled}
                            onClick={a.disabled ? undefined : () => { a.onClick?.(); cerrar(); }}
                            aria-pressed={a.activo != null ? !!a.activo : undefined}
                            className="w-full justify-start">
                            {a.label}
                        </TabBarAction>
                    ))}
                    {extra && <div className="flex flex-col gap-2 [&>*]:w-full">{extra}</div>}
                </div>,
                document.body,
            )}
        </>
    );
});
PanelAcciones.displayName = 'FilterBar.PanelAcciones';

// ── El reparto del ancho (2026-07-30, aprobado sobre mockup) ─────────────
// El cupo de ranuras NO es un número fijo: es el que entre en el ancho REAL.
// Antes eran 3 a secas, y eso escondía filtros en un monitor de 27" teniendo
// 1.400px libres — el usuario lo señaló mirando el mockup.
//
// Y NO se estima: se MIDE. El primer intento modelaba cada acción en 150px y se
// equivocaba por 62 en una sola píldora — medidas reales en Personal: "Nuevo
// Empleado" 166, "Nuevo Practicante" 186, "Exportar" (solo ícono) 36. El ancho
// de una acción es el de su rótulo, así que ninguna constante lo puede
// representar. Lo único que sí es fijo es la forma degradada: un botón sin
// rótulo mide `w-9` = 36px, siempre.

const PX = {
    divisor: 1,      // el <span> de 1px; el aire lo pone el px-1 de cada ranura
    limpiar: 45,
    accionIcono: 36,
    accionGap: 4,
    relleno: 12,     // el px-1.5 del contenedor, a los dos lados
    desborde: 62,    // el control de «más filtros»: h-9 px-2.5 + ícono + cuenta
};

// Lo que el carril de tarjetas se queda siempre: dos tarjetas y su separación.
// Es lo que hace que se LEA como deslizable — una sola tarjeta cortada parece un
// error de maquetación, no un carril.
const RESERVA_CARRIL = 2 * 148 + 8 + 10;

/**
 * Mide el ancho que la FILA le deja a la píldora, y cuántas tarjetas tiene al lado.
 *
 * Se observa al ABUELO, no al padre. El padre es el envoltorio que ajusta al
 * contenido —o sea a la píldora— así que medirlo es un bucle: la píldora crece,
 * el padre crece, entra otra ranura, crece otra vez. Se midió: con el padre la
 * píldora quedaba clavada en 748px y 2 ranuras a TODO ancho, de 1280 a 2240.
 * El abuelo es la fila, y su ancho lo decide la página, no la píldora.
 */
function useMedidaFila(ref, activo) {
    const [medida, setMedida] = useState({ ancho: null, fila: null, tarjetas: 0 });
    useEffect(() => {
        const padre = ref.current?.parentElement;
        const fila = padre?.parentElement ?? padre;
        if (!activo || !fila) return undefined;
        const medir = () => {
            const carril = fila.querySelector('[role="group"]');
            // El carril sólo descuenta ancho si REALMENTE está al lado. Antes
            // bastaba con que existiera entre los descendientes del abuelo, y
            // eso es falso en las tres vistas donde la píldora y el carril van
            // en renglones separados a propósito porque no entran juntos
            // (medido el 2026-08-06: AttendanceAudit necesita 1257px y tiene
            // 1182 aun a 1600; TabInventario necesita 1337 y tiene 772). Ahí la
            // píldora perdía 314px de presupuesto por un vecino que no tenía al
            // lado, y degradaba ranuras sin motivo — en silencio, que es lo
            // peor: el layout no fallaba, sólo repartía mal.
            // Se compara por CENTRO vertical y no por solapamiento de bandas:
            // dos bloques apilados con márgenes negativos se solapan unos
            // píxeles y un test de bandas los daría por vecinos.
            let tarjetas = 0;
            if (carril && ref.current) {
                const rp = ref.current.getBoundingClientRect();
                const rc = carril.getBoundingClientRect();
                const centro = (r) => r.top + r.height / 2;
                const compartenFila =
                    Math.abs(centro(rp) - centro(rc)) < Math.min(rp.height, rc.height) / 2;
                if (compartenFila) tarjetas = carril.children.length;
            }
            setMedida({
                ancho: fila.clientWidth - (tarjetas ? RESERVA_CARRIL : 0),
                fila: fila.clientWidth,
                tarjetas,
            });
        };
        medir();
        const ro = new ResizeObserver(medir);
        ro.observe(fila);
        return () => ro.disconnect();
    }, [ref, activo]);
    return medida;
}

/**
 * Mide, UNA vez y en su estado natural, cuánto ocupa cada pieza de la píldora.
 *
 * Corre en `useLayoutEffect`, o sea antes de que el navegador pinte: el usuario
 * nunca ve el estado sin degradar aunque sea el primero que se renderiza.
 *
 * La clave la forman los rótulos: si cambian —otra vista, otro idioma, un
 * contador que crece— hay que volver a medir, y solo entonces.
 */
function useMedidaPiezas(ref, clave, activo) {
    const [piezas, setPiezas] = useState(null);
    useLayoutEffect(() => {
        if (!activo) return;
        const el = ref.current;
        if (!el) return;
        const ranuras = [...el.querySelectorAll('[data-pieza="ranura"]')]
            .map(n => n.getBoundingClientRect().width);
        const bloque = el.querySelector('[data-pieza="acciones"]');
        setPiezas({
            ranuras,
            accionesTexto: bloque ? bloque.getBoundingClientRect().width : 0,
        });
    }, [ref, clave, activo]);
    return piezas;
}

const FilterBar = memo(({
    children,
    onClear,
    // Cuántos filtros hay aplicados. Lo pasa la vista porque es la única que
    // sabe qué cuenta como "aplicado" en su dominio.
    activeCount = 0,
    title = 'Filtros',
    // ── Acciones de la vista (2026-07-30) ─────────────────────────────────
    // Descriptores, no JSX — ver el encabezado del archivo. Campos: `key`,
    // `icon`, `label`, `onClick`, `variant` ('primary' | 'quiet'), `tone`,
    // `disabled`, `activo` (para un toggle), `as`/`href`/`target`/`rel` (para
    // una acción que navega), y `soloEscritorio` para la que no tiene sentido
    // con el pulgar.
    acciones = [],
    // Escotilla para lo que no es un botón: un `Badge` de estado, un select.
    accionesExtra = null,
    // ── En táctil esto ES la barra flotante ───────────────────────────────
    // El canónico decide, no el llamador — igual que `LiquidSelect` abre
    // `SelectorTactil` solo.
    //
    // `buscador` normalmente NO se pasa: lo publica `ViewTabBar` por el canal
    // de `CanalDeVista`. Queda como override explícito para la vista que tenga
    // un buscador que no sea el del header (`ConteoDetailView` lo usaba así
    // antes de que existiera el canal).
    buscador = null,
    // Escotilla: `false` vuelve al botón + hoja inline. Hace falta si algún día un
    // `FilterBar` vive DENTRO de un modal — la barra va por portal al `body` en
    // capa 40 y quedaría detrás del modal (capa 100), invisible. Hoy ninguna lo
    // hace (verificado: los tres usos en modales son de `FilterBar.Chip`, no del
    // contenedor), pero el día que pase no se va a descubrir solo.
    flotante = true,
    className = '',
    ...rest
}) => {
    const compacto = useLayoutCompacto();
    const [abierto, setAbierto] = useState(false);
    const idHoja = useId();

    const secciones = Children.toArray(children).filter(isValidElement);
    const esFlotante = compacto && flotante;

    // Los hooks del canal van ANTES de cualquier retorno temprano.
    // Publicar que la barra flotante existe es lo que hace que `ViewTabBar`
    // suelte su lupa: si esto no se anunciara, en el teléfono habría dos
    // buscadores para el mismo término y uno de ellos se iría con el scroll.
    usePublicarBarraFlotante(esFlotante);
    const buscadorDeVista = useBuscadorDeVista();
    const buscadorEfectivo = buscador ?? buscadorDeVista;

    // Cuánto ancho le deja su contenedor. Solo importa en escritorio.
    const pildoraRef = useRef(null);
    const medidaFila = useMedidaFila(pildoraRef, !compacto);
    // La clave de medición: si cambian los rótulos, hay que volver a medir.
    // Lleva el `active` de cada ranura porque una ranura puede CAMBIAR DE ANCHO
    // al aplicarse: el «Estado» de MIN·MAX pide 104px vacío y 156 con un valor
    // puesto (el valor es "18 Sin movimiento", el vacío es una palabra). Sin
    // esto la píldora seguía repartiendo con la medida vieja.
    const claveRotulos = `${secciones.length}|${
        secciones.map(s => `${s.props?.label ?? ''}:${s.props?.active ? 1 : 0}`).join(',')
    }|${acciones.map(a => a.label).join('|')}`;
    const piezas = useMedidaPiezas(pildoraRef, claveRotulos, !compacto);

    // Escape cierra la hoja, y mientras está abierta el fondo no scrollea:
    // sin esto, arrastrar dentro de la hoja mueve la tabla de atrás y al
    // cerrarla el usuario quedó en otra parte de la lista sin haberlo pedido.
    useEffect(() => {
        if (!abierto) return;
        const alTeclear = e => { if (e.key === 'Escape') setAbierto(false); };
        const previo = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', alTeclear);
        return () => {
            document.body.style.overflow = previo;
            window.removeEventListener('keydown', alTeclear);
        };
    }, [abierto]);

    // ── Táctil: la barra flotante ─────────────────────────────────────────
    if (esFlotante) {
        // El clúster no puede crecer sin límite: a 320px entran tres columnas de
        // 60px y poco más. Así que la principal se dibuja aparte (rellena y más
        // grande, §17.3), UNA secundaria puede tener su propio botón, y de dos
        // para arriba se agrupan tras "Acciones". `accionesExtra` fuerza el
        // grupo porque es JSX y solo cabe en una hoja.
        const enTactil = acciones.filter(a => !a.soloEscritorio);
        // Por defecto la principal del clúster es la que se dibuja `primary` en
        // escritorio. `principal: false` lo desactiva: un interruptor puede
        // ponerse `primary` al encenderse (el "En vivo" de Auditoría) y no por eso
        // debe convertirse en el botón grande de crear cada vez que se prende.
        const principal = enTactil.find(a => a.principal ?? a.variant === 'primary') || null;
        const secundarias = enTactil.filter(a => a !== principal);
        const agrupar = secundarias.length > 1 || (!!accionesExtra && secundarias.length > 0);

        const botonesSueltos = agrupar ? [] : secundarias.map(a => ({
            key: a.key,
            icon: a.icon,
            label: a.label,
            activo: a.activo,
            onClick: a.disabled ? undefined : a.onClick,
        }));

        const grupo = (agrupar || (accionesExtra && !secundarias.length)) ? [{
            key: '__acciones',
            icon: MoreHorizontal,
            label: 'Acciones',
            tituloPanel: 'Acciones',
            panel: (
                <div className="flex flex-col gap-2">
                    {secundarias.map(a => (
                        <TabBarAction key={a.key} icon={a.icon} tone={a.tone}
                            as={a.as} href={a.href} target={a.target} rel={a.rel}
                            disabled={a.disabled} onClick={a.onClick}
                            aria-pressed={a.activo != null ? !!a.activo : undefined}
                            className="w-full justify-start">
                            {a.label}
                        </TabBarAction>
                    ))}
                    {accionesExtra && <div className="flex flex-col gap-2 [&>*]:w-full">{accionesExtra}</div>}
                </div>
            ),
        }] : [];

        return (
            <BarraCtx.Provider value={{ compacto: true }}>
                <BarraFlotante
                    ariaLabel={`${title} y acciones`}
                    buscador={buscadorEfectivo}
                    // El clúster decide CUÁNDO mostrarlo —cuando hay filtros con
                    // cuenta o término de búsqueda— y le suma el buscador a lo
                    // que borra. Acá solo se dice qué limpia los filtros: quién
                    // sabe si hay algo aplicado es el que dibuja las cuentas.
                    alLimpiar={onClear || null}
                    principal={principal && !principal.disabled ? {
                        icon: principal.icon,
                        label: principal.label,
                        onClick: principal.onClick,
                    } : null}
                    acciones={[...(secciones.length === 1 ? [{
                        // ── Una sola ranura se anuncia POR SU NOMBRE ──────────
                        // Con un filtro, "Filtros" es un rótulo genérico para algo
                        // que ya tiene el suyo: el botón dice "Sucursal" y lleva el
                        // ícono del control, así que se sabe qué hay adentro sin
                        // abrirlo. El ícono sale del propio control —`LiquidSelect`
                        // ya recibe uno— y no de una prop nueva en cada vista: una
                        // prop opcional es una prop que alguien va a olvidar.
                        //
                        // Y es un botón del clúster, no un select embebido: en la
                        // barra todo lo demás es un círculo con su rótulo debajo, y
                        // un select estirado ahí adentro era la única pieza con otra
                        // anatomía.
                        key: 'filtro-unico',
                        icon: iconoDeSeccion(secciones[0]) || SlidersHorizontal,
                        label: rotuloDeSeccion(secciones[0]) || 'Filtros',
                        tituloPanel: rotuloDeSeccion(secciones[0]) || title,
                        badge: activeCount,
                        panel: (
                            <div className="[&_*]:!max-w-full flex flex-col gap-3">
                                {secciones[0]}
                                {onClear && activeCount > 0 && (
                                    <button type="button" onClick={onClear}
                                        className="h-11 rounded-btn bg-danger/12 ring-1 ring-inset ring-danger/30
                                            text-danger-text text-caption font-black uppercase tracking-widest">
                                        Limpiar
                                    </button>
                                )}
                            </div>
                        ),
                    }] : []), ...(secciones.length > 1 ? [{
                        key: 'filtros',
                        icon: SlidersHorizontal,
                        // El rótulo del botón es corto y fijo: `title` puede ser
                        // "Filtros del conteo" y en una columna de 60px se corta
                        // ("FILTROS …"). El título largo se usa donde hay lugar, que
                        // es el encabezado de la hoja.
                        label: 'Filtros',
                        tituloPanel: title,
                        badge: activeCount,
                        panel: (
                            <div className="flex flex-col gap-4">
                                {secciones.map((s, i) => (
                                    // El rótulo de la ranura pasa a ser encabezado: la vista
                                    // ya lo declara para el aria del botón de limpiar, y en
                                    // la hoja apilada hace falta saber qué es cada control.
                                    <div key={i} className="flex flex-col gap-1.5">
                                        {s.props?.label && (
                                            <span className="text-caption font-black uppercase tracking-widest text-content-3">
                                                {s.props.label}
                                            </span>
                                        )}
                                        <div className="[&_*]:!max-w-full">{s}</div>
                                    </div>
                                ))}
                                {onClear && activeCount > 0 && (
                                    <button type="button" onClick={onClear}
                                        className="h-11 rounded-btn bg-danger/12 ring-1 ring-inset ring-danger/30
                                            text-danger-text text-caption font-black uppercase tracking-widest">
                                        Limpiar {activeCount} filtro{activeCount === 1 ? '' : 's'}
                                    </button>
                                )}
                            </div>
                        ),
                    }] : []), ...botonesSueltos, ...grupo]}
                />
            </BarraCtx.Provider>
        );
    }

    // ── Móvil sin flotante: botón + hoja inferior ─────────────────────────
    if (compacto) {
        return (
            <BarraCtx.Provider value={{ compacto: true }}>
                <button type="button" onClick={() => setAbierto(true)}
                    aria-expanded={abierto} aria-controls={idHoja}
                    className={`inline-flex items-center gap-2 h-[max(40px,var(--tap-min))] px-3.5 rounded-card border shrink-0
                        text-body-sm font-bold transition-[background-color,border-color] duration-[var(--dur-base)]
                        ${activeCount > 0
                            ? 'bg-brand/10 border-brand/30 text-brand-text'
                            : 'bg-surface-card border-border-card text-content-2'} ${className}`}
                    {...rest}>
                    <SlidersHorizontal size={14} strokeWidth={2.5} />
                    {title}
                    {activeCount > 0 && (
                        <Contador valor={activeCount} tono="brand" max={99}
                            aria-label={`${activeCount} filtro${activeCount === 1 ? '' : 's'} aplicado${activeCount === 1 ? '' : 's'}`} />
                    )}
                </button>

                {abierto && createPortal(
                    <div className="fixed inset-0 z-modal flex flex-col justify-end">
                        <button type="button" aria-label="Cerrar filtros"
                            onClick={() => setAbierto(false)}
                            className="absolute inset-0 bg-scrim animate-in fade-in duration-[var(--dur-base)]" />

                        <div id={idHoja} role="dialog" aria-modal="true" aria-label={title}
                            data-surface="sheet"
                            className="relative w-full max-h-[80vh] overflow-y-auto rounded-t-modal rounded-b-none
                                px-4 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]
                                animate-in slide-in-from-bottom duration-[var(--dur-slow)] ease-out">
                            {/* Tirador: no es decorativo, es lo que dice que la
                                hoja se arrastra para cerrar. */}
                            <AsaHoja className="mb-3" />

                            <div className="flex items-center justify-between gap-3 mb-3">
                                <h2 className="text-body-lg font-black text-content">{title}</h2>
                                {onClear && activeCount > 1 && (
                                    <button type="button"
                                        onClick={() => { onClear(); setAbierto(false); }}
                                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-btn
                                            bg-danger/12 ring-1 ring-inset ring-danger/30 text-danger-text
                                            text-micro font-black uppercase tracking-widest">
                                        Limpiar {activeCount}
                                    </button>
                                )}
                            </div>

                            {/* Cada ranura es una fila de 44px: el mínimo del dedo. */}
                            <div className="flex flex-col gap-2">
                                {secciones.map((s, i) => (
                                    <div key={i} className="[&_*]:!max-w-full">{s}</div>
                                ))}
                            </div>

                            {(acciones.length > 0 || accionesExtra) && (
                                <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-divider">
                                    {acciones.map(a => (
                                        <TabBarAction key={a.key} icon={a.icon} variant={a.variant} tone={a.tone}
                                            as={a.as} href={a.href} target={a.target} rel={a.rel}
                                            disabled={a.disabled} onClick={a.onClick}
                                            aria-pressed={a.activo != null ? !!a.activo : undefined}
                                            className="w-full justify-start">
                                            {a.label}
                                        </TabBarAction>
                                    ))}
                                    {accionesExtra && <div className="flex flex-col gap-2 [&>*]:w-full">{accionesExtra}</div>}
                                </div>
                            )}
                        </div>
                    </div>,
                    document.body,
                )}
            </BarraCtx.Provider>
        );
    }

    // ── Escritorio: la píldora ────────────────────────────────────────────
    // Cuántas ranuras entran, según el ancho REAL. Y el orden en que se cede:
    //   1º el TEXTO de las acciones   2º las acciones bajo «Otros»
    //   3º las ranuras vacías
    // Una ranura APLICADA no se esconde nunca — una vista que recorta datos sin
    // mostrar por qué es peor que una píldora ancha. Tampoco una `fija`.
    const anclada      = s => s.props?.active || s.props?.fija;
    const idxAncladas  = secciones.map((s, i) => [s, i]).filter(([s]) => anclada(s)).map(([, i]) => i);
    // Las que pueden ceder, de la que más aguanta a la que cede primero.
    // `sort` de arrays es estable, así que a igual prioridad manda el orden de
    // §17 — cede la última, que es lo que hacía antes de que esto existiera.
    const idxVacias    = secciones.map((s, i) => [s, i]).filter(([s]) => !anclada(s))
        .sort((a, b) => (b[0].props?.prioridad ?? 0) - (a[0].props?.prioridad ?? 0))
        .map(([, i]) => i);
    // El ✕ de «limpiar todo» solo existe con DOS o más filtros: con uno alcanza
    // la × de la propia ranura. Cobrarlo siempre costaba 54px de gusto.
    const hayLimpiar = !!onClear && activeCount > 1;

    // Con las piezas ya medidas se calcula exacto; sin medir todavía se asume que
    // entra todo, que es el estado que `useMedidaPiezas` necesita para medir.
    const anchoDe = n => n ? n * PX.accionIcono + (n - 1) * PX.accionGap + 8 : 0;

    // Qué se agrupa bajo «Otros» cuando ni los íconos entran. Mismo criterio que
    // el clúster táctil: la principal queda fuera, el resto adentro, y solo tiene
    // sentido con dos o más — agrupar una sola acción cambia un ícono por otro.
    const principalPildora = acciones.find(a => a.principal ?? a.variant === 'primary') || null;
    const agrupables       = acciones.filter(a => a !== principalPildora);
    const puedeAgrupar     = agrupables.length > 1;

    const anchoIconos   = anchoDe(acciones.length);
    const anchoAgrupado = anchoDe((principalPildora ? 1 : 0) + 1);

    // forma: 'texto' | 'iconos' | 'agrupado'
    const medirCon = (n, forma) => {
        if (!piezas) return 0;
        const ranuras = piezas.ranuras.slice(0, n).reduce((a, b) => a + b, 0)
            + Math.max(0, n - 1) * PX.divisor;
        const desborde = n < secciones.length ? PX.desborde + PX.divisor : 0;
        const limpiar = hayLimpiar ? PX.limpiar + PX.divisor : 0;
        const accs = forma === 'texto'     ? piezas.accionesTexto
                   : forma === 'agrupado'  ? anchoAgrupado
                   :                         anchoIconos;
        return PX.relleno + ranuras + desborde + limpiar + (accs ? PX.divisor + accs : 0);
    };

    const disponible = medidaFila.ancho ?? Infinity;
    let cupo = secciones.length;

    // El TEXTO de las acciones es lo último que la píldora reclama, y solo si el
    // carril de al lado ya muestra TODAS sus tarjetas. Sin esta regla la píldora
    // se lo llevaba apenas podía y el carril retrocedía al agrandar la ventana:
    // medido, a 1280px se veían 2 tarjetas y a 1440 solo 1.
    const carrilCompleto = medidaFila.tarjetas * 148 + Math.max(0, medidaFila.tarjetas - 1) * 8;
    // 24 = la separación de la fila (12) más un colchón del mismo tamaño.
    const cabenLasTarjetas = ancho =>
        !medidaFila.tarjetas || (medidaFila.fila - ancho - 24) >= carrilCompleto;

    // El orden en que la píldora cede, de lo que menos duele a lo que más:
    //   1º el TEXTO de las acciones   2º las acciones bajo «Otros»
    //   3º las ranuras vacías, al control de desborde
    // Las acciones ceden ANTES que una ranura porque esto es la barra de
    // FILTROS: esconder un filtro para dejar tres íconos a la vista invierte
    // lo que §17 dice que la barra es. Una ranura APLICADA no se esconde nunca.
    let conTextoAcciones = true;
    let agrupado = false;
    if (piezas) {
        const conTexto = medirCon(cupo, 'texto');
        conTextoAcciones = conTexto <= disponible && cabenLasTarjetas(conTexto);
        let forma = conTextoAcciones ? 'texto' : 'iconos';
        if (forma === 'iconos' && puedeAgrupar && medirCon(cupo, forma) > disponible) {
            forma = 'agrupado';
            agrupado = true;
        }
        while (cupo > idxAncladas.length && cupo > 1 && medirCon(cupo, forma) > disponible) cupo--;
    }

    // Se ELIGEN por prioridad pero se DIBUJAN en su orden original: el orden de
    // ranuras de §17 (ámbito → entidad → tiempo → estado) es el orden en que una
    // persona lo diría en voz alta, y reordenarlo porque una esté aplicada lo
    // rompería — la píldora cambiaría de forma cada vez que se toca un filtro.
    const visibles   = new Set([...idxAncladas, ...idxVacias].slice(0, Math.max(cupo, idxAncladas.length)));
    const enLinea    = secciones.filter((_, i) => visibles.has(i));
    const enDesborde = secciones.filter((_, i) => !visibles.has(i));

    return (
        <BarraCtx.Provider value={{ compacto: false }}>
        <div
            ref={pildoraRef}
            // `data-pildora` marca la raíz de la píldora. No es decorativo: es el
            // otro extremo del contrato de §17.0 —el carril se identifica con
            // `[role="group"]`— y sin él la píldora sólo se podía localizar por
            // sus clases, que cambian. Lo usa la verificación de §17.0.
            data-pildora
            // 52px: 36 del control + 8 de aire arriba y abajo. Vuelve a ser un
            // alto FIJO y una sola línea: desde que el cupo de ranuras se calcula
            // contra el ancho real, la píldora ya no puede desbordar — lo que no
            // entra se va al control de desborde en vez de envolver.
            className={`inline-flex items-center h-[52px] px-1.5 rounded-card border border-border-card
                bg-surface-card shadow-[var(--shadow-glass-1)] max-w-full
                transition-[border-color,box-shadow] duration-[var(--dur-base)] ${className}`}
            {...rest}
        >
            {enLinea.map((s, i) => (
                <React.Fragment key={i}>
                    {/* El divisor lo pone el contenedor, no cada vista. Era lo
                        que más se repetía a mano y lo que más quedaba de más:
                        un divisor colgando al final cuando una sección se
                        ocultaba por permisos. */}
                    {i > 0 && <span aria-hidden="true" className="h-[22px] w-px bg-divider shrink-0" />}
                    {s}
                </React.Fragment>
            ))}

            {enDesborde.length > 0 && (
                <PanelDesborde secciones={enDesborde}
                    aplicadas={enDesborde.filter(s => s.props?.active).length} />
            )}

            {onClear && activeCount > 1 && (
                <>
                    <span aria-hidden="true" className="h-[22px] w-px bg-divider shrink-0" />
                    <div className="flex items-center h-9 px-1">
                        {/* Ícono solo, a pedido del usuario, para ahorrar
                            espacio. El rótulo se conserva en `title` y
                            `aria-label` con la CUENTA adentro, que es lo que lo
                            desambigua de las × chicas de cada chip: acá dice
                            "Quitar los 3 filtros", no "quitar el último". */}
                        <button type="button" onClick={onClear}
                            title={`Quitar los ${activeCount} filtros`}
                            aria-label={`Quitar los ${activeCount} filtros`}
                            className="w-9 h-9 rounded-btn flex items-center justify-center shrink-0
                                text-danger-text/70 bg-danger/10 ring-1 ring-inset ring-danger/25
                                hover:bg-danger/20 hover:text-danger-text
                                transition-[background-color,color] duration-[var(--dur-base)]">
                            <X size={15} strokeWidth={2.5} />
                        </button>
                    </div>
                </>
            )}

            {/* Las acciones, después de un divisor. El orden no es libre: primero
                lo que RECORTA la lista y recién después lo que se HACE con ella
                —el usuario mira la píldora de izquierda a derecha y ese es el
                orden en que lo diría—. El divisor es lo que las separa de los
                filtros para que "Exportar" no se lea como una ranura más, que
                fue el motivo por el que en su día se las sacó de acá. */}
            {(acciones.length > 0 || accionesExtra) && (
                <>
                    <span aria-hidden="true" className="h-[22px] w-px bg-divider shrink-0" />
                    <div data-pieza="acciones" className="flex items-center gap-1 h-9 px-1">
                        {/* `useMedidaPiezas` mide esta caja UNA vez por juego de
                            rótulos, y esa primera pasada ocurre con `piezas` en
                            null — o sea con la forma completa. Por eso agrupar
                            acá no se muerde la cola: la medida de referencia ya
                            está tomada cuando esta rama puede ser cierta. */}
                        {(agrupado ? (principalPildora ? [principalPildora] : []) : acciones).map(a => {
                            // `soloIcono`: el ícono solo. Es para la acción
                            // secundaria y reconocible —ocultar montos, exportar—
                            // que con texto le come a la píldora el ancho que
                            // necesitan los filtros. En el clúster táctil sigue
                            // rotulado: ahí hay sitio y no hay hover que lo revele.
                            // El texto de las acciones es lo PRIMERO que cede
                            // cuando falta ancho: el ícono ya identifica la acción
                            // y el rótulo sigue disponible en el tooltip. Lo
                            // decide la medida de la fila, no el llamador.
                            const sinTexto = a.soloIcono || !conTextoAcciones;
                            const boton = (
                                <TabBarAction key={a.key} size="sm" icon={a.icon}
                                    variant={a.variant} tone={a.tone}
                                    as={a.as} href={a.href} target={a.target} rel={a.rel}
                                    disabled={a.disabled} onClick={a.onClick}
                                    label={a.label}
                                    title={sinTexto ? undefined : a.title}
                                    soloIcono={sinTexto}
                                    aria-pressed={a.activo != null ? !!a.activo : undefined}>
                                    {sinTexto ? null : a.label}
                                </TabBarAction>
                            );
                            // Un botón sin texto necesita que su rótulo sea
                            // DESCUBRIBLE, y el `title` del navegador no sirve: es
                            // cromo nativo —no se estiliza, tarda un segundo largo
                            // en salir y en táctil no existe—, justo lo que la regla
                            // cero-nativo evita. `LiquidTooltip` es el canónico
                            // (§15.10) y va abajo para no taparle la fila de arriba.
                            return sinTexto
                                ? <LiquidTooltip key={a.key} content={a.label} side="bottom">{boton}</LiquidTooltip>
                                : boton;
                        })}
                        {agrupado
                            ? <PanelAcciones acciones={agrupables} extra={accionesExtra} />
                            : accionesExtra}
                    </div>
                </>
            )}
        </div>
        </BarraCtx.Provider>
    );
});

FilterBar.Section = Section;
FilterBar.Chip = Chip;
FilterBar.Opciones = Opciones;
FilterBar.Sucursal = Sucursal;
FilterBar.displayName = 'FilterBar';

export default FilterBar;
