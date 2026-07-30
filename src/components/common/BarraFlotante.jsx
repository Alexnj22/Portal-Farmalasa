import React, { memo, useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import useMediaQuery from '../../hooks/useMediaQuery';
import Contador from './Contador';
import ModalShell from './ModalShell';

/**
 * BarraFlotante — los controles de la vista, al alcance del pulgar. Solo táctil.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 * En una vista de captura larga —el conteo son 2,500 renglones— los controles
 * viven arriba: se llega a ellos volviendo al principio de la página. En
 * escritorio no molesta porque el filtro está a la vista con la tabla; en un
 * teléfono, después de tres pantallas de scroll el filtro y el botón de agregar
 * ya no existen.
 *
 * ── Anatomía: un clúster de íconos, no una barra de borde a borde ──────────
 * Elegida sobre cinco alternativas mockupeadas. Gana porque es la más compacta
 * (94px con rótulos, pegada a la derecha) y por lo tanto la que menos lista
 * tapa, que en una
 * pantalla de captura es lo que más importa.
 *
 * Dos reglas la sacan de ser el antipatrón de "tres íconos iguales":
 *
 * 1. **La acción principal se ve distinta.** Rellena y más grande. Crea algo;
 *    las otras dos ABREN algo. Dibujarlas iguales las hace leer como una familia
 *    de pares cuando una es la principal.
 * 2. **Los disclosures llevan su estado.** Un ícono dice dónde está el control,
 *    no qué está aplicado — y "verlos siempre" era justamente el pedido. Así que
 *    el buscador se estira a campo y muestra el término, y las acciones llevan
 *    `Contador`. Sin esto la barra muestra la puerta y esconde el contenido.
 *
 * El costo que no se puede diseñar afuera: **lupa y filtros significan casi lo
 * mismo** para quien está contando — los dos son "achicar la lista". Cuesta un
 * toque perdido cada tanto, y es el precio de ser la más compacta.
 *
 * ── El buscador se ESTIRA, no cambia de modo ──────────────────────────────
 * Al tocar la lupa el campo crece en el lugar y los otros botones se quedan. La
 * alternativa era una fila propia arriba, que se descartó por lo mismo que se
 * descartó otra variante: dos anatomías en la misma barra.
 *
 * Medido, el área de tecleo: **160px a 390px de viewport, 90px a 320px**. Los 90
 * de un iPhone SE son ~6 caracteres a la vista, y es lo que da la física con tres
 * controles rotulados en 320px. Alcanza porque esto es búsqueda incremental —se
 * teclean cuatro o cinco letras, no el nombre entero— y el texto se desplaza
 * dentro del campo. Queda expandido mientras tenga texto, así que el término
 * sigue visible con el teclado cerrado, que era el requisito.
 *
 * Y el panel del buscador NO es una hoja: mientras se escribe hay que ver la
 * lista filtrarse, o no se sabe cuándo parar de teclear. Los filtros sí van en
 * hoja, porque se aplican y se cierran.
 *
 * ── Va por portal al `body`, y no es un detalle ────────────────────────────
 * Un `position: fixed` dentro de un ancestro con `transform`, `filter` o
 * `z-index` propio queda contenido por ese ancestro y deja de estar pegado al
 * viewport. Este proyecto ya se tropezó con eso: el comentario de la nav inferior
 * de `AppLayout` dice textual *"hermano directo del root (SIN ancestros con
 * z-index/overflow que creen contexto de apilamiento — el fixed anidado era lo
 * que standalone no pintaba)"*.
 *
 * ── El corte es 719px, el mismo de `FilterBar` ─────────────────────────────
 * No `md` (768). Una vista que use esto le pasa `soloEscritorio` a su `FilterBar`,
 * y si los cortes divergen queda una franja de 50px con las dos cosas visibles o
 * ninguna. Una sola fuente de verdad.
 *
 * ── z-header y no z-modal ──────────────────────────────────────────────────
 * Es cromo de la vista, no un diálogo: va DEBAJO de cualquier hoja que se abra
 * desde ella (`z-modal` = 100) y encima del encabezado pegajoso de una tabla
 * (`z-base` = 10). `z-header` (40) es la capa donde ya vive la nav del layout.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *   <BarraFlotante
 *       buscador={{ value: q, onChange: setQ, placeholder: 'Buscar…' }}
 *       acciones={[{ key: 'filtros', icon: SlidersHorizontal, label: 'Filtros',
 *                    badge: 2, panel: <>…controles…</>, tituloPanel: 'Filtros' }]}
 *       principal={{ icon: Plus, label: 'Agregar', onClick: abrir }}
 *   />
 */

// Cuánto hay que mover el dedo para que la barra reaccione. Sin umbral, el
// rebote elástico de iOS y cualquier micro-scroll la hacen titilar.
const UMBRAL = 8;
// Arriba de la página nunca se esconde: si el usuario está en el principio, no
// está leyendo hacia abajo, está por empezar.
const ZONA_SEGURA = 96;

const BarraFlotante = memo(({
    buscador = null,
    acciones = [],
    principal = null,
    autoOcultar = true,
    // Los rótulos bajo los íconos aparecen solos cuando hay MÁS DE UN botón: con
    // uno solo el ícono no compite con nada y el rótulo es ruido. Se puede forzar.
    mostrarRotulos,
    ariaLabel = 'Acciones de la vista',
}) => {
    const compacto = useMediaQuery('(max-width: 719px)');
    const [visible, setVisible] = useState(true);
    const [abierta, setAbierta] = useState(null);   // key de la acción con panel abierto
    const [buscando, setBuscando] = useState(false);
    const ultimaY = useRef(0);
    const inputRef = useRef(null);

    useEffect(() => {
        if (!compacto || !autoOcultar) return undefined;
        ultimaY.current = window.scrollY;
        let pendiente = false;
        const alScrollear = () => {
            if (pendiente) return;
            pendiente = true;
            // Una lectura por frame: el handler se dispara docenas de veces por
            // gesto y `scrollY` fuerza layout.
            requestAnimationFrame(() => {
                pendiente = false;
                const y = window.scrollY;
                const dy = y - ultimaY.current;
                if (Math.abs(dy) < UMBRAL) return;
                ultimaY.current = y;
                setVisible(y < ZONA_SEGURA || dy < 0);
            });
        };
        window.addEventListener('scroll', alScrollear, { passive: true });
        return () => window.removeEventListener('scroll', alScrollear);
    }, [compacto, autoOcultar]);

    const abrirBusqueda = useCallback(() => {
        setBuscando(true);
        // El foco va después del render, o el navegador no levanta el teclado.
        setTimeout(() => inputRef.current?.focus(), 60);
    }, []);

    if (!compacto) return null;

    const conTexto = !!buscador?.value;
    const campoAbierto = !!buscador && (buscando || conTexto);
    const botones = (buscador ? 1 : 0) + acciones.length + (principal ? 1 : 0);
    const rotulos = mostrarRotulos ?? botones > 1;
    const panelAbierto = acciones.find((a) => a.key === abierta && a.panel);

    return createPortal(
        <>
            <div
                role="toolbar"
                aria-label={ariaLabel}
                className={`fixed inset-x-0 bottom-0 z-header
                    px-3 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]
                    flex justify-end pointer-events-none
                    transition-transform duration-200 ease-out
                    ${visible || campoAbierto ? 'translate-y-0' : 'translate-y-[135%]'}`}
            >
                {/* El clúster: una sola pieza con su propio material, para que los
                    controles no compitan con el texto de la lista que pasa por
                    detrás. `items-start` para que los rótulos queden alineados
                    aunque el botón principal sea más alto. */}
                {/* Al buscar el clúster toma todo el ancho disponible en vez de
                    ajustarse a su contenido, así el campo se queda con todo lo que
                    sobra sin mover ni esconder los otros dos botones. */}
                <div className={`pointer-events-auto flex items-start gap-1.5 p-1.5
                    rounded-[1.75rem] bg-surface-card border border-border-card shadow-lg
                    ${campoAbierto ? 'w-full' : 'max-w-full'}`}>

                    {buscador && (campoAbierto ? (
                        <div className="flex items-center gap-1.5 h-11 min-w-0 flex-1 px-3
                            rounded-full bg-surface-input border border-brand/40
                            outline-solid outline-2 outline-offset-0 outline-brand/25">
                            <Search size={14} strokeWidth={2.5} className="text-brand-text shrink-0" />
                            <input
                                ref={inputRef}
                                // `text` y no `search`: WebKit le dibuja al segundo su
                                // PROPIA ✕ de limpiar, así que salían dos —la nativa
                                // gris y la del portal—. Es la regla cero-nativo: el
                                // cromo del navegador no se estiliza, se evita.
                                // `inputMode="search"` conserva la tecla Buscar del
                                // teclado sin traer la decoración.
                                type="text"
                                inputMode="search"
                                value={buscador.value}
                                onChange={(e) => buscador.onChange?.(e.target.value)}
                                onBlur={() => setBuscando(false)}
                                placeholder={buscador.placeholder || 'Buscar...'}
                                aria-label={buscador.placeholder || 'Buscar'}
                                // 16px como mínimo: por debajo, iOS hace zoom al enfocar
                                // y descuadra toda la vista (DESIGN.md §32).
                                className="flex-1 min-w-0 bg-transparent border-none outline-none
                                    text-body-xl font-bold text-content placeholder:text-content-3"
                            />
                            {conTexto && (
                                <button type="button" aria-label="Limpiar la búsqueda"
                                    onClick={() => { buscador.onChange?.(''); setBuscando(false); }}
                                    className="w-8 h-8 -mr-1 shrink-0 rounded-full flex items-center justify-center
                                        text-danger-text hover:bg-danger/15 transition-colors duration-150">
                                    <X size={14} strokeWidth={3} />
                                </button>
                            )}
                        </div>
                    ) : (
                        <Boton icon={Search} label="Buscar" rotulo={rotulos} onClick={abrirBusqueda} />
                    ))}

                    {acciones.map((a) => (
                        <Boton
                            key={a.key}
                            icon={a.icon}
                            label={a.label}
                            rotulo={rotulos}
                            badge={a.badge}
                            activo={a.activo ?? (a.badge > 0)}
                            onClick={() => (a.panel ? setAbierta(a.key) : a.onClick?.())}
                        />
                    ))}

                    {principal && (
                        <Boton
                            icon={principal.icon}
                            label={principal.label}
                            rotulo={rotulos}
                            principal
                            onClick={principal.onClick}
                        />
                    )}
                </div>
            </div>

            {/* El panel de una acción: hoja inferior. Los filtros se aplican y se
                cierran, así que atenuar la lista no molesta — al contrario, enfoca. */}
            {acciones.some((a) => a.panel) && (
                <ModalShell
                    open={!!panelAbierto}
                    onClose={() => setAbierta(null)}
                    align="bottom"
                    maxWidthClass="max-w-none"
                    surface={null}
                    ariaLabel={panelAbierto?.tituloPanel || panelAbierto?.label || 'Panel'}
                >
                    <div data-surface="modal" className="max-h-[85dvh] overflow-y-auto rounded-t-modal
                        px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
                        <div aria-hidden="true" className="w-9 h-1 rounded-full bg-content-3/40 mx-auto mb-3" />
                        <h2 className="text-body-lg font-black text-content mb-3">
                            {panelAbierto?.tituloPanel || panelAbierto?.label}
                        </h2>
                        {panelAbierto?.panel}
                    </div>
                </ModalShell>
            )}
        </>,
        document.body,
    );
});

/**
 * Un botón del clúster. `principal` lo hace relleno y más grande — es lo que
 * distingue "esto crea algo" de "esto abre algo".
 *
 * El rótulo va DEBAJO del ícono y no en un `title`: en táctil no hay hover, así
 * que un `title` no existe. Igual se emite `aria-label` porque el rótulo puede
 * estar apagado (un solo botón).
 */
const Boton = memo(({ icon: Icono, label, rotulo, badge, activo, principal, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        aria-label={label}
        // Ancho fijo por columna: el rótulo es más ancho que el ícono ("AGREGAR"
        // mide más que sus 48px) y sin esto se desbordaba del clúster y quedaba
        // cortado contra el borde de la pantalla. 60px entra "FILTROS" en
        // text-micro; el ícono queda centrado dentro.
        className="shrink-0 w-[60px] flex flex-col items-center gap-1 group/bf"
    >
        <span className={`relative grid place-items-center rounded-full
            transition-[background-color,border-color] duration-150
            ${principal
                ? 'w-12 h-12 bg-chart-9-solid text-white shadow-md'
                : `w-11 h-11 border ${activo
                    ? 'bg-brand/12 border-brand/40 text-brand-text'
                    : 'bg-surface-card-hover border-border-card text-content-2'}`}`}
        >
            <Icono size={principal ? 22 : 17} strokeWidth={principal ? 2.5 : 2.2} />
            {badge > 0 && (
                <Contador valor={badge} tono="brand" max={9}
                    className="absolute -top-0.5 -right-0.5 ring-2 ring-surface-card"
                    aria-label={`${badge} aplicado${badge === 1 ? '' : 's'}`} />
            )}
        </span>
        {rotulo && (
            <span className={`text-micro font-black uppercase leading-none text-center w-full truncate
                ${principal ? 'text-chart-9-text' : activo ? 'text-brand-text' : 'text-content-3'}`}>
                {label}
            </span>
        )}
    </button>
));
Boton.displayName = 'BarraFlotante.Boton';

BarraFlotante.displayName = 'BarraFlotante';
export default BarraFlotante;
