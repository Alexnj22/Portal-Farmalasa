import React, { useEffect, useRef, useState } from "react";
import { EstadoDialogoCtx } from "./estadoDialogo";
import { useGotaApertura, tiemposGota } from "./gotaApertura";
import useMediaQuery from "../../hooks/useMediaQuery";
import { usePanelLateral } from "../../hooks/useLayoutCompacto";
import { createPortal } from "react-dom";

// Lo que un diálogo debe poder enfocar. `[tabindex="-1"]` queda fuera a
// propósito: es enfocable por código, no por Tab.
const ENFOCABLES = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',');

const visible = (el) => {
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/**
 * Envoltura canónica de TODO modal del portal (DESIGN.md §14).
 *
 * Da las cuatro cosas que un modal escrito a mano casi siempre olvida:
 * `role="dialog"` + `aria-modal` (sin eso un lector de pantalla no anuncia un
 * diálogo, solo contenido que apareció al final del `<body>`), cierre con
 * Escape, bloqueo de scroll que RESTAURA el valor previo, y la entrada/salida
 * animada que D2.4 clasifica como movimiento funcional.
 *
 * Props:
 *   open             – visibilidad controlada
 *   onClose          – Escape y clic en el fondo
 *   maxWidthClass    – ancho máximo del panel (default max-w-lg)
 *   zClass           – capa de apilamiento (default z-modal)
 *   closeOnEsc       – default true
 *   closeOnBackdrop  – default true. En false el fondo deja de ser un botón:
 *                      lo usa el editor de fotos, donde un clic afuera durante
 *                      un recorte tira el trabajo sin confirmación.
 *   lockScroll       – default true
 *   align            – "center" (default) | "top" para paletas de comandos |
 *                      "bottom" para hojas táctiles (entran deslizando desde
 *                      abajo y llegan a los bordes: sin padding en el
 *                      contenedor, el panel pone el suyo).
 *                      EN TÁCTIL, "center" se resuelve a "bottom" solo — ver la
 *                      nota en el cuerpo. "top" se respeta siempre.
 *   hojaEnTactil     – default true. En false el diálogo se queda centrado
 *                      también en táctil: es para las ALERTAS, que son una
 *                      interrupción y no un panel con el que se trabaja.
 *   scrim            – el velo. Por defecto NO hay en táctil (ver la nota en el
 *                      cuerpo); `true` lo fuerza.
 *   animacionPropia  – el hijo se anima solo. Sin esto la animación viviría en
 *                      el envoltorio, que es ancestro del vidrio.
 *   surface          – data-surface del panel (default "modal"; el ⌘K usa
 *                      "dropdown", que es lo que ese material es). En `null`
 *                      el panel no declara superficie: para los consumidores
 *                      que ya la ponen en su propio hijo y si no quedarían con
 *                      dos vidrios apilados.
 *   panelClassName   – clases extra sobre el panel (p. ej. `overflow-hidden`,
 *                      que es lo que hace que el radio recorte al contenido)
 *   ariaLabel        – nombre accesible; pasar SIEMPRE el título real
 */

// La salida dura menos que la entrada: al cerrar, el usuario ya decidió y
// esperar la misma animación se siente lento. Es el TOPE de vida del panel tras
// `open=false`, no la duración de la animación: esa la puede acortar el tema
// (`[data-theme="solid"] .animate-out { animation-duration: 130ms }`) o
// `prefers-reduced-motion` (120ms !important), y desde JS no hay forma de
// saberlo. Por eso la salida ya no depende de que los dos números coincidan
// —ver `fill-mode-forwards` abajo—: si divergen, no se ve.
// La salida tiene que durar lo suficiente para LEERSE como el camino inverso.
// Estuvo en 180ms contra los 520 de la entrada —casi 3× más rápido— y a esa
// velocidad el recorrido no se ve: la hoja parpadea y desaparece. Cerrar sigue
// siendo más rápido que abrir (abrir es una invitación, cerrar es una respuesta),
// pero la diferencia es de un tercio, no de tres veces.
// Salir dura ~70% de entrar: es la proporción que usan las guías (Material:
// 225 al entrar, 195 al salir) y la razón es de significado — entrar es una
// invitación y admite demorarse, salir es una respuesta.
// El desmontaje va DESPUÉS de la animación, no al mismo tiempo. Con los dos en
// 240ms el último tramo se cortaba —el navegador todavía estaba interpolando
// cuando el nodo desaparecía— y el cierre se leía como que la hoja simplemente se
// esfuma. 60ms de margen alcanzan y no se notan.
//
// El número base ya no vive acá: lo pone el tema, porque la salida es la gota y
// la gota cambia de reloj (`--gota-salida`: 240ms en liquid, 140 en solid). Con
// un `EXIT_MS` fijo, Solid terminaba su recorrido a los 140 y el nodo se quedaba
// 160ms más en pantalla mostrando la píldora ya encogida — o sea que acortar la
// animación habría AGREGADO una espera visible.
const MARGEN_DESMONTAJE = 60;



// Los keyframes `exit` de tw-animate-css son solo `to`, y el shorthand
// `--animate-out` trae `var(--tw-animation-fill-mode, none)`. Sin declarar el
// fill-mode, en cuanto la animación TERMINA el elemento vuelve a su estado
// natural: opacidad 1, sin transform. Y como el tema la acorta a 130ms mientras
// el desmontaje espera 180ms, quedaba una ventana de ~50ms en la que el modal
// —ya desvanecido— reaparecía entero y después desaparecía de golpe. Medido el
// 2026-07-29 sobre el modal de lote: opacidad 1.00 → 0.02 → **1.00** → nodo
// removido. Eso es lo que se reportaba como "al cerrarlo se abre y cierra dos
// veces": no había doble montaje (el MutationObserver ve un ADD y un DEL), era
// este rebote.
//
// `fill-mode-forwards` hace que la salida SOSTENGA su último fotograma hasta
// que el nodo se va, y de paso vuelve inofensiva cualquier divergencia futura
// entre la duración de la animación y la de la salida.
const HOLD_EXIT = "fill-mode-forwards";

export default function ModalShell({
  open,
  onClose,
  children,
  maxWidthClass = "max-w-lg",
  zClass = "z-modal",
  closeOnEsc = true,
  closeOnBackdrop = true,
  lockScroll = true,
  align: alignPedido = "center",
  hojaEnTactil = true,
  // El hijo se anima solo. Sin esto la animación viviría en el ENVOLTORIO, que
  // es ancestro del vidrio: `transform` ancestro = backdrop root = blur muerto.
  animacionPropia = false,
  // Sin velo. El fondo sigue siendo objetivo de cierre —invisible, no ausente,
  // así que el diálogo sigue siendo modal— pero no oscurece ni difumina.
  // Por defecto sigue la regla de abajo: en táctil, NO hay velo.
  scrim,
  surface = "modal",
  panelClassName = "",
  ariaLabel = "Ventana modal",
}) {
  // ── En táctil, TODO modal es una hoja (2026-07-30) ────────────────────
  // Centrado y con zoom es la gramática del escritorio. En un teléfono deja los
  // botones a media pantalla, lejos del pulgar, y cuando abre el teclado el
  // panel sube y se recorta. La hoja nace pegada al borde donde está la mano —
  // y es además la MISMA gramática que ya usan la hoja de filtros y la de
  // acciones de `BarraFlotante`: sin esto, dos cosas que hacen lo mismo (tapar
  // la vista hasta que la cierres) entraban de dos maneras distintas.
  //
  // Se decide por `(hover: none)` y no por ancho, igual que `TabBarAction`: lo
  // que manda es el dispositivo de entrada. `align="top"` se respeta siempre —
  // es el ⌘K, que quiere estar bajo los ojos y no bajo el pulgar.
  //
  // `hojaEnTactil={false}` es la única salida, y existe para **las alertas**: un
  // aviso corto con un botón no es un panel con el que se trabaja, es una
  // interrupción. Centrado en medio de la pantalla se lee como tal; subido desde
  // abajo se confunde con la hoja de filtros, que es algo que se usa y se
  // descarta. No es una excepción de conveniencia — es que el gesto de entrada
  // dice de qué tipo de cosa se trata.
  const sinHover = useMediaQuery("(hover: none)");
  const sinMovimiento = useMediaQuery("(prefers-reduced-motion: reduce)");
  const autoHoja = sinHover && alignPedido === "center" && hojaEnTactil;

  // ── En el teléfono la hoja NO oscurece la pantalla ────────────────────
  // El velo es una convención de escritorio: ahí el diálogo es una ventana
  // flotando sobre un lienzo grande y hay que decir cuál manda. En un teléfono
  // la hoja ya ocupa el borde inferior entero y llega desde el control que la
  // abrió — se entiende sin atenuar nada, y atenuar la vista entera hace que se
  // lea como "otra pantalla" en vez de como la misma que se desplegó.
  //
  // Se sigue pudiendo forzar con `scrim`. El diálogo sigue siendo modal, y eso
  // NO es una figura retórica: sin velo el contenedor llevaba
  // `pointer-events: none`, así que los toques lo atravesaban y **la lista de
  // atrás scrolleaba** mientras la hoja estaba abierta. Invisible no es ausente:
  // el contenedor sigue capturando, solo que sin pintar nada.
  const conVelo = scrim ?? !(autoHoja || alignPedido === "bottom");
  // ── Acostado, la hoja entra de COSTADO ────────────────────────────────
  // Medido en un iPhone 13 acostado (844 × 390): la hoja inferior ocupaba el
  // 63% del alto para mostrar dos controles en una columna de 150px, con 694px
  // de vacío al lado. El alto es lo escaso acostado y la hoja gasta justo eso.
  // De costado usa el alto completo y deja la lista entera visible al lado.
  //
  // Solo afecta a lo que YA sería hoja: `align="top"` (el ⌘K) y las alertas
  // centradas (`hojaEnTactil={false}`) siguen donde estaban, porque su posición
  // dice de qué tipo de cosa se trata y eso no cambia al girar el teléfono.
  const lateralPosible = usePanelLateral();
  const esLateral = lateralPosible && (autoHoja || alignPedido === "bottom");
  const align = esLateral ? "side" : autoHoja ? "bottom" : alignPedido;

  // `mounted` sobrevive a `open=false` el tiempo de la animación de salida.
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef(null);
  const disparadorRef = useRef(null);

  useEffect(() => {
    if (open) {
      setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect -- monta en respuesta a `open`; el estado ES la animación de entrada
      return undefined;
    }
    const t = setTimeout(() => setMounted(false), tiemposGota().salida + MARGEN_DESMONTAJE);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        if (closeOnEsc) onClose?.();
        return;
      }
      // Trampa de foco: dentro de un diálogo modal, Tab no puede salir a la
      // página de atrás — que sigue ahí, con todos sus controles enfocables e
      // invisibles bajo el scrim. Escape es la salida, y siempre está.
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const f = [...panel.querySelectorAll(ENFOCABLES)].filter(visible);
      if (!f.length) { e.preventDefault(); panel.focus(); return; }
      const primero = f[0], ultimo = f[f.length - 1];
      if (!panel.contains(document.activeElement)) { e.preventDefault(); primero.focus(); return; }
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    };

    window.addEventListener("keydown", onKeyDown);

    // ── El bloqueo de scroll, a la manera que iOS respeta ────────────────
    // `overflow: hidden` en `body` **no bloquea nada en Safari de iOS**. Es un
    // comportamiento viejo y conocido: el documento sigue desplazándose con el
    // dedo. Se reportó exactamente así — con la hoja de filtros abierta, el
    // contenido de atrás se movía.
    //
    // Lo que sí funciona es sacar el documento del flujo: `position: fixed` con
    // el desplazamiento actual como `top` negativo. La página queda congelada
    // donde estaba, y al soltar se restaura la posición — sin eso, cerrar el
    // diálogo devolvería al usuario al principio de la lista, que es peor que el
    // problema original.
    const yPrevio = window.scrollY;
    const previo = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };

    if (lockScroll) {
        document.body.style.position = "fixed";
        document.body.style.top = `-${yPrevio}px`;
        document.body.style.width = "100%";
        document.body.style.overflow = "hidden";
    }

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (lockScroll) {
          document.body.style.position = previo.position;
          document.body.style.top = previo.top;
          document.body.style.width = previo.width;
          document.body.style.overflow = previo.overflow;
          window.scrollTo(0, yPrevio);
      }
    };
  }, [open, onClose, closeOnEsc, lockScroll]);

  // Foco: entrar al abrir, y VOLVER al disparador al cerrar.
  // Lo segundo es lo que más se olvida y lo que más se nota: sin eso, cerrar un
  // modal con teclado deja el foco en el `<body>` y la siguiente tabulación
  // arranca desde el principio de la página. Medido el 2026-07-29 antes de este
  // cambio: `document.activeElement` era BODY tras cerrar los 6 modales.
  useEffect(() => {
    if (!open) return undefined;
    disparadorRef.current = document.activeElement;

    const t = setTimeout(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return; // un autoFocus ya lo movió
      const f = [...panel.querySelectorAll(ENFOCABLES)].filter(visible);
      (f[0] || panel).focus();
    }, 60);

    return () => {
      clearTimeout(t);
      const previo = disparadorRef.current;

      // Se difiere un tick: varios modales del portal se despachan desde
      // `UnifiedModal`, que al cerrar **se desmonta entero** y hace re-render
      // de la vista de atrás. Enfocando en el mismo tick, React reemplazaba el
      // nodo del disparador justo después y el foco caía al `<body>` igual.
      // Medido el 2026-07-29: 3 de 11 diálogos terminaban en BODY por esto.
      setTimeout(() => {
        if (previo && typeof previo.focus === 'function' && previo.isConnected) {
          previo.focus({ preventScroll: true });
        }
      }, 0);

      // Segunda pasada DESPUÉS de que el panel se desmonta.
      // La primera versión de este respaldo comprobaba "¿el foco quedó en el
      // body?" en el mismo tick, y ahí todavía no: el panel sigue montado lo que
      // dura la animación de salida, así que el foco seguía adentro, la
      // comprobación salía temprano, y recién al desmontarse el navegador lo
      // mandaba al body. Los 3 diálogos que fallaban seguían fallando.
      //
      // El plazo se cuenta desde el DESMONTAJE y no desde la animación: era
      // `EXIT_MS + 40` = 280ms contra un desmontaje a los 300, o sea que esta
      // pasada corría 20ms ANTES de que el panel se fuera — justo lo que el
      // comentario decía estar evitando.
      setTimeout(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        // El disparador no sobrevivió (lo reemplazó un re-render, o la vista
        // cambió). Antes que dejar el foco en `<body>` —donde la próxima
        // tabulación arranca desde el principio de la página, pasando otra vez
        // por todo el menú— se lo lleva al contenido, que es lo que recomienda
        // la APG de WAI-ARIA cuando el disparador no sobrevive.
        if (previo && typeof previo.focus === 'function' && previo.isConnected) {
          previo.focus({ preventScroll: true });
          return;
        }
        const main = document.querySelector('main') || document.querySelector('[role="main"]');
        if (!main) return;
        const habiaTabIndex = main.hasAttribute('tabindex');
        if (!habiaTabIndex) main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: true });
        if (!habiaTabIndex) {
          // se quita en cuanto suelta el foco: un `<main>` permanentemente
          // enfocable ensucia el recorrido de teclado del resto de la app
          main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
        }
      }, tiemposGota().salida + MARGEN_DESMONTAJE + 40);
    };
  }, [open]);

  // ── La gota, para TODO diálogo ────────────────────────────────────────
  // No es un gesto de las hojas: es de cualquier cosa que se abra por un toque.
  // Una alerta centrada y el ⌘K también salen de un botón, y decirlo vale igual
  // en las tres posiciones. `animacionPropia` la cede al hijo (lo usa
  // `BarraFlotante`, cuya hoja se anima ella misma).
  useGotaApertura({
    ref: panelRef,
    activo: !animacionPropia && !sinMovimiento,
    cerrando: !open,
  });

  if (!open && !mounted) return null;

  // Entrada y salida salen de tw-animate-css (ver el @import comentado en
  // index.css). Los dos gates de movimiento las alcanzan: en Solid duran
  // 130ms lineales y con prefers-reduced-motion pierden la geometría y queda
  // solo el fade.
  // ── El contenedor NO se anima cuando no hay velo ──────────────────────
  // `animate-in fade-in` le pone `opacity` entre 0 y 1 durante 500ms, y **un
  // ancestro con opacidad < 1 es un backdrop root**: mientras dura el fade, el
  // `backdrop-filter` de la hoja está muerto y el vidrio aparece de golpe al
  // terminar. Medido: op 0 → 0.29 → 0.68 → 0.90 mientras la hoja se abría, que
  // es exactamente lo que se reportó como "se ve transparente hasta que finaliza
  // la animación". La misma regla que ya mordió por `transform`, ahora por
  // `opacity`.
  //
  // Sin velo no hay nada que desvanecer —el contenedor es transparente— así que
  // la animación no solo sobra: es la que rompe el efecto. La hoja se anima
  // sola.
  const backdropAnim = !conVelo
    ? ""
    : open ? "animate-in fade-in duration-500" : `animate-out fade-out duration-150 ${HOLD_EXIT}`;
  // Una hoja inferior no hace zoom: sube y baja. Es la misma distinción que el
  // resto del sistema hace entre movimiento decorativo y movimiento que dice de
  // dónde viene la cosa.
  // "Hoja" abarca las dos posiciones: de abajo y de costado. Son la misma pieza
  // —el panel que tapa la vista hasta que lo cerrás— y comparten sombra propia,
  // asa y arrastre; lo único que cambia es por qué borde entra.
  const esHoja = align === "bottom" || align === "side";


  // El panel NUNCA lleva su animación de clases. Dos animaciones sobre el mismo
  // elemento se pelean, y la de clases usa `opacity`, que crea un backdrop root
  // y mata el vidrio mientras dura.
  //
  // Y con `prefers-reduced-motion` tampoco: antes ahí caía en `animate-out
  // slide-out-to-bottom`, o sea que quien pidió MENOS movimiento recibía el
  // único deslizamiento del portal — y encima se leía como que el diálogo se
  // cerraba hacia abajo en vez de volver por donde vino. Sin movimiento es sin
  // movimiento: aparece y desaparece.
  const panelAnim = "";

  const alignCls =
    align === "top"    ? "items-start justify-center pt-[10vh] px-4" :
    align === "bottom" ? "items-end justify-center" :
    // De costado: pegado al borde DERECHO y de alto completo. Derecho y no
    // izquierdo porque es el lado donde ya vive el clúster flotante, o sea
    // donde está el pulgar que lo abrió — y porque el notch, cuando cae a la
    // izquierda, dejaría el asa debajo del hardware.
    align === "side"   ? "items-stretch justify-end" :
                         "items-center justify-center p-4 sm:p-6";

  return createPortal(
    <EstadoDialogoCtx.Provider value={{ cerrando: !open, salidaMs: tiemposGota().salida, alCerrar: onClose }}>
    <div
      // 🚨 FIX 1: Quitamos transition-all. Usamos animate-in fade-in.
      // Esto hace que el fondo aparezca suavemente, pero una vez que termina,
      // el navegador deja de monitorear cambios de opacidad, liberando el CPU.
      className={`fixed inset-0 ${zClass} flex ${alignCls} ${backdropAnim}
        ${conVelo ? 'bg-scrim backdrop-blur-sm' : 'bg-transparent'}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {/* El fondo es una afordancia de MOUSE: duplica lo que Escape ya hace,
          así que va fuera del árbol de accesibilidad y fuera de Tab. Dejarlo
          tabulable metía una parada de foco invisible antes del contenido del
          diálogo — el mismo criterio que los chevrons de §25.9. */}
      {closeOnBackdrop && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={onClose}
          className="absolute inset-0 cursor-default w-full h-full bg-transparent border-none outline-none"
        />
      )}

      {/* 🚨 FIX 2: ELIMINAMOS transform-gpu.
          La animación zoom-in ya usa "transform" de forma temporal.
          Al quitar transform-gpu, evitamos que todo el modal se convierta en una sola textura rígida,
          permitiendo que el scroll interno del UnifiedModal se procese de forma independiente y nativa. */}
      <div
        ref={panelRef}
        // `tabIndex={-1}`: destino de respaldo del foco cuando el diálogo no
        // tiene ningún control adentro (un visor, una confirmación sin botones).
        tabIndex={-1}
        data-surface={surface || undefined}
        // Como hoja el panel llega a los bordes: un `max-w-lg` centrado en un
        // teléfono de 390px no se nota, pero en una tablet táctil dejaría la
        // hoja flotando en el medio, que es justo lo que se quiso evitar.
        //
        // Y las dos correcciones van al HIJO, con variantes de descendiente, para
        // no tener que editar los 18 llamadores: el contenido que cada uno rendea
        // fue escrito para un panel centrado, así que trae esquinas redondeadas
        // abajo —que contra el filo de la pantalla se ven como un error— y ningún
        // respeto por el área segura: medido en un iPhone, "Cancelar" quedaba
        // debajo del indicador de inicio.
        //
        // `:not([data-hoja])` deja fuera a `HojaMovil`, que es el cuerpo canónico
        // de una hoja y ya hace las dos cosas bien. El parche es para los cuerpos
        // heredados, no para el canónico.
        // `shadow-hoja` es el eje que a la escala le faltaba: una hoja inferior
        // tiene UN solo borde visible —el de arriba— contra una lista que sigue
        // viva detrás, y sin sombra ahí el corte se lee plano. Va en el
        // envoltorio y no en la hoja porque `data-surface` fija el `box-shadow`
        // del panel y le ganaría por orden de hoja.
        // La sombra cuelga de `esHoja` y NO de `autoHoja`: las hojas que ya pedían
        // `align="bottom"` —las de `BarraFlotante`— no pasan por la conversión
        // automática, así que atarla a `autoHoja` la dejaba justamente fuera de
        // las que más se ven. Los parches del hijo sí son de `autoHoja`: existen
        // para los cuerpos heredados, no para toda hoja.
        // SIN `shadow-hoja` acá: la sombra vive en la capa `data-sombra-hoja`,
        // que es la que sabe morfar con la gota. Tenerla también en el panel
        // dejaba una sombra RECTANGULAR de ancho completo que no se animaba
        // nunca: al cerrar, la hoja se recogía en píldora y el recuadro seguía
        // ahí. Fue exactamente lo que se reportó como "trae un recuadro también".
        // El EJE por el que entra y sale, para que `useGotaApertura` y
        // `useArrastreHoja` lo lean sin que ningún llamador tenga que
        // reenviarlo. Es la misma técnica que `data-sombra-hoja`: `ModalShell`
        // es el único que posiciona paneles, así que lo escribe una vez y los
        // dos lo encuentran. Una prop de reenvío es una prop que se olvida.
        data-eje={esHoja ? (align === "side" ? "x" : "y") : undefined}
        className={`relative ${align === "side"
            // De costado: alto completo y ancho de MEDIA pantalla, con tope. El
            // punto de la posición es que la lista siga viéndose al lado, así
            // que el panel no puede crecer hasta taparla. `max-w` en px y no en
            // `%` porque lo que limita la lectura es la medida del texto, no la
            // proporción de la pantalla.
            ? 'h-full w-[47%] max-w-[420px] min-w-[280px] pr-[env(safe-area-inset-right)]'
            : 'w-full'} ${autoHoja && align !== "side"
            ? 'max-w-none [&>*:not([data-hoja])]:rounded-b-none [&>*:not([data-hoja])]:pb-[max(16px,env(safe-area-inset-bottom))]'
            : align === "side" ? '' : maxWidthClass} ${panelAnim} ease-[cubic-bezier(0.23,1,0.32,1)] outline-none ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── La sombra de la hoja, como CAPA propia ───────────────────
            Estaba como `box-shadow` del envoltorio, y eso la dejaba clavada
            mientras el dedo arrastraba la hoja: quedaba una banda de sombra en
            el sitio viejo, o sea un corte a la vista. Y al abrir aparecía de
            golpe al final, porque no había cómo animarla con la forma.

            Como capa, la gota y el arrastre la mueven y la desvanecen junto con
            el vidrio — se marca con `data-sombra-hoja` para que los dos la
            encuentren. No es ancestro de nada, así que mover ESTA no rompe
            ningún `backdrop-filter`. */}
        {esHoja && (
          <div data-sombra-hoja="true" aria-hidden="true"
            // Sin `z-index`: va ANTES que el contenido en el DOM, y eso ya la
            // deja debajo. `-z-base` no existía como utilidad —`z-base` sí, pero
            // no su negativo— así que era una clase escrita que nunca pintó nada.
            // El radio y la sombra siguen al borde por el que entra: arriba si
            // sube, a la izquierda si entra de costado. `--shadow-hoja` proyecta
            // hacia arriba (`0 -14px 44px`), que de costado apuntaría al vacío;
            // `--shadow-hoja-lateral` es la misma sombra girada 90°.
            className={`absolute inset-0 pointer-events-none ${align === "side"
              ? 'rounded-l-modal shadow-[var(--shadow-hoja-lateral)]'
              : 'rounded-t-modal shadow-[var(--shadow-hoja)]'}`} />
        )}
        {children}
      </div>
    </div>
    </EstadoDialogoCtx.Provider>,
    document.body
  );
}
