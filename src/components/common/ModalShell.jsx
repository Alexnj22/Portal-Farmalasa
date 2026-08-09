import React, { useEffect, useId, useRef, useState } from "react";
import { EstadoDialogoCtx } from "./estadoDialogo";
import { useGotaApertura, tiemposGota } from "./gotaApertura";
import useMediaQuery from "../../hooks/useMediaQuery";
import { usePanelLateral } from "../../hooks/useLayoutCompacto";
import { abrirDialogo, useEsDialogoDeEncima } from "./dialogosAbiertos";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import Button from "./Button";

// Lo que un diálogo debe poder enfocar. `[tabindex="-1"]` queda fuera a
// propósito: es enfocable por código, no por Tab.
const ENFOCABLES = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',');

// Los campos donde se ESCRIBE. Es un subconjunto de `ENFOCABLES`, no otra
// lista: lo que decide es si el teclado sirve de algo apenas se abre.
// Fuera quedan los que son botones disfrazados de input (checkbox, radio,
// submit, file) y los de solo lectura, que aceptan el foco y no la escritura.
const CAMPOS_DE_TEXTO = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"])'
    + ':not([type="submit"]):not([type="reset"]):not([type="file"])'
    + ':not([readonly]):not([disabled])',
  'textarea:not([readonly]):not([disabled])',
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
// **Y es un TECHO, no una cita.** 60ms alcanzaban cuando el número era lo único
// que había; hoy la gota avisa por `onfinish` cuando su salida terminó de verdad
// y el desmontaje cuelga de ese aviso. El temporizador quedó de respaldo para lo
// que NO anima —reduced-motion, escritorio, un tema sin gota—, y por eso el
// margen puede ser generoso sin costar nada: si hay animación, nunca se lo
// espera. Medido lo justo que estaba: `transitionrun` a los 19ms pero el primer
// fotograma pintado a los 73 —54ms de los 60 gastados sólo en arrancar—, y eso
// en un emulador de escritorio. En un teléfono, con el hilo principal ocupado
// interpolando un `clip-path` sobre 30px de desenfoque, ese arranque se pasa del
// margen y el nodo se va a mitad del recorrido.
const MARGEN_DESMONTAJE = 60;
const TECHO_SALIDA = 400;



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
  // Sólo para `align="pantalla"`: el rótulo de la barra superior. Una pantalla
  // completa necesita decir dónde estás y cómo salir sin llegar al final del
  // scroll — una hoja no, porque su borde superior ya deja ver de dónde viene.
  titulo,
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
  // `pantalla` no lleva velo: el panel tapa el viewport entero, así que sería un
  // desenfoque a pantalla completa que nadie llega a ver y que el compositor
  // igual tiene que calcular.
  const conVelo = scrim ?? !(autoHoja || alignPedido === "bottom" || alignPedido === "pantalla");
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
  // ── `pantalla`: el envase de un EXPEDIENTE, no de una decisión ─────────
  // Una hoja inferior sirve para decidir algo y cerrarse. Un expediente —el
  // producto tiene siete secciones y dos listas anidadas— no se decide, se
  // recorre: pedirle a una hoja que ocupe el 90% del alto es dibujar una
  // pantalla completa con las esquinas redondeadas y un asa que miente sobre
  // lo que hay debajo.
  //
  // Va ANTES del cálculo lateral y de `autoHoja` a propósito: quien pide
  // `pantalla` lo pide para las dos orientaciones y para las dos densidades de
  // puntero. Es la única posición que no se reinterpreta.
  const esPantalla = alignPedido === "pantalla";
  const esLateral = !esPantalla && lateralPosible && (autoHoja || alignPedido === "bottom");
  const align = esPantalla ? "pantalla"
    : esLateral ? "side" : autoHoja ? "bottom" : alignPedido;

  // `mounted` sobrevive a `open=false` el tiempo de la animación de salida.
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef(null);
  const disparadorRef = useRef(null);
  // El valor de `open` legible desde un callback asíncrono (el `onfinish` de la
  // gota), que si no capturaría el del render en que se instaló.
  const abiertoRef = useRef(open);
  useEffect(() => { abiertoRef.current = open; }, [open]);

  // Mientras esté abierto, el clúster flotante se apaga: es cromo de la vista y
  // no tiene nada que hacer debajo de una hoja —transparentándose a través del
  // vidrio, que fue lo reportado—. Se cuenta en vez de encender un booleano
  // porque los diálogos se anidan.
  // ── UN SOLO DIÁLOGO A LA VISTA (2026-08-09) ───────────────────────────
  // Un diálogo sobre otro está PROHIBIDO. No es una preferencia estética: dos
  // paneles del mismo vidrio no se distinguen entre sí, así que el de abajo se
  // lee entero a través del de encima —nombre, párrafos y botones encimados—.
  // Reportado sobre Conexiones, con el bloqueo abierto sobre el detalle.
  //
  // Se resuelve acá y no en cada vista a propósito: pedirle a los 18 llamadores
  // que cierren lo suyo antes de abrir lo otro es una regla de prosa, y una
  // regla que sólo vive en prosa se rompe. Desde el canónico es estructural —
  // el que no es el de encima no pinta, y no hay forma de saltárselo.
  //
  // Se OCULTA, no se desmonta: el de abajo conserva su estado y su scroll, y
  // vuelve intacto en cuanto el de encima se va. Eso es lo que hace que
  // «Cancelar» devuelva la pantalla exactamente como estaba.
  const idDialogo = useId();
  const esTope = useEsDialogoDeEncima(idDialogo);
  const nombreRef = useRef(ariaLabel);
  useEffect(() => { nombreRef.current = ariaLabel; }, [ariaLabel]);

  useEffect(() => {
    if (!open) return undefined;
    const { cerrar, debajo } = abrirDialogo(idDialogo, nombreRef.current);
    if (import.meta.env.DEV && debajo) {
      // Que la pantalla se salve no vuelve legítimo el anidamiento: el de abajo
      // desaparece de golpe y quien lo abrió no lo pidió. El aviso nombra a los
      // dos para poder rediseñar el flujo.
      console.warn(
        `[canónico] Diálogo sobre diálogo: «${nombreRef.current}» se abrió sobre `
        + `«${debajo}». Está prohibido — el de abajo se oculta para que no se `
        + `encimen, pero el flujo hay que rehacerlo (un paso dentro del mismo `
        + `diálogo, o cerrar el primero antes de abrir el segundo).`,
      );
    }
    return cerrar;
  }, [open, idDialogo]);

  useEffect(() => {
    if (open) {
      setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect -- monta en respuesta a `open`; el estado ES la animación de entrada
      return undefined;
    }
    // El techo, no la cita: lo normal es que desmonte el `onfinish` de la gota
    // (ver `alTerminarSalida` más abajo). Esto sólo cubre el caso en que no hubo
    // animación ninguna, y por eso puede ser holgado.
    const t = setTimeout(() => setMounted(false), tiemposGota().salida + TECHO_SALIDA);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    // `esTope`: el teclado le pertenece al que se ve. Sin esto, un diálogo
    // oculto seguía atrapando el Tab —su panel mide 0×0, así que la trampa no
    // encontraba nada enfocable y devolvía el foco a sí misma, robándoselo al
    // que sí está en pantalla— y Escape cerraba los dos a la vez.
    if (!open || !esTope) return undefined;

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
  }, [open, esTope, onClose, closeOnEsc, lockScroll]);

  // Foco: entrar al abrir, y VOLVER al disparador al cerrar.
  // Lo segundo es lo que más se olvida y lo que más se nota: sin eso, cerrar un
  // modal con teclado deja el foco en el `<body>` y la siguiente tabulación
  // arranca desde el principio de la página. Medido el 2026-07-29 antes de este
  // cambio: `document.activeElement` era BODY tras cerrar los 6 modales.
  useEffect(() => {
    if (!open) return undefined;
    disparadorRef.current = document.activeElement;

    // ── Dos fotogramas, no 60ms de reloj (2026-08-09) ──────────────────
    // El plazo existía para dejar que un `autoFocus` del hijo llegue primero y
    // para que el panel esté medido. Las dos cosas pasan cuando React commitea
    // y el navegador pinta, o sea en el fotograma siguiente — no a los 60ms.
    // Un temporizador fijo era una apuesta: en una máquina rápida sobraban
    // ~45ms de espera antes de poder escribir, y en una lenta podía quedarse
    // corto igual. Dos `requestAnimationFrame` seguidos esperan exactamente
    // «después del próximo pintado», que es la condición real.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return; // un autoFocus ya lo movió
      const f = [...panel.querySelectorAll(ENFOCABLES)].filter(visible);
      // ── Al abrir, el foco va al CAMPO, no al primer enfocable (2026-08-07) ──
      // Pedido así: «que el focus al entrar a alguna sección o modal sean los
      // input, así siempre está listo para escribir». Y el primer enfocable casi
      // nunca es el campo: el encabezado canónico dibuja su botón de cerrar
      // ANTES del cuerpo, así que en la consulta de inventario el foco caía en
      // la «✕» y el buscador —que es todo el motivo de abrir ese modal— había
      // que ir a tocarlo.
      //
      // En TÁCTIL también (2026-08-07). Salió con puntero fino solamente, por
      // el teclado que se come media hoja en un modal que primero se lee. El
      // usuario lo pidió al revés y con las mismas palabras que la primera vez:
      // «que el foco en móvil también sea el input, en todos». Manda eso — la
      // hoja sube con el teclado y el campo queda listo, que es el punto.
      const campo = [...panel.querySelectorAll(CAMPOS_DE_TEXTO)].filter(visible)[0];
      (campo || f[0] || panel).focus();
    }); });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
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
    // `sinHover`: la gota es un gesto TÁCTIL. Dice "esto nació del control que
    // TOCASTE", y en escritorio no hay tal toque — hay un clic con un puntero
    // que ya está donde apunta, así que la premisa del gesto no existe. Entró
    // sin esta compuerta en v2.279.0 ("la gota para TODO diálogo") y se coló al
    // escritorio, donde la gramática es la otra: un panel que aparece.
    activo: sinHover && !animacionPropia && !sinMovimiento,
    cerrando: !open,
    // El nodo se va cuando la salida TERMINÓ, no cuando un temporizador cree que
    // debería haber terminado. `abiertoRef` porque el aviso llega de forma
    // asíncrona: si en el medio la hoja se volvió a abrir, desmontarla sería
    // cerrar la nueva.
    alTerminarSalida: () => { if (!abiertoRef.current) setMounted(false); },
  });

  if (!open && !mounted) return null;

  // Entrada y salida salen de tw-animate-css (ver el @import comentado en
  // index.css). Los dos gates de movimiento las alcanzan: en Solid duran
  // 130ms lineales y con prefers-reduced-motion pierden la geometría y queda
  // solo el fade.
  // ── El velo es una CAPA, no el fondo del contenedor (2026-08-09) ──────
  // Estaba pintado sobre el mismo div que envuelve al panel, y por eso su
  // desvanecido —`opacity` entre 0 y 1 durante 500ms— convertía al ANCESTRO
  // del vidrio en backdrop root y dejaba el `backdrop-filter` del panel muerto
  // mientras duraba. Medido: op 0 → 0.29 → 0.68 → 0.90 mientras la hoja se
  // abría, o sea "se ve transparente hasta que finaliza la animación". La
  // solución de entonces fue quitarle la animación cuando NO había velo; el
  // caso con velo se quedó roto, que es justamente el de escritorio.
  //
  // Como capa hermana el problema desaparece: el velo se desvanece solo, no es
  // ancestro de nadie, y el panel lo tiene DEBAJO en el mismo contexto de
  // apilamiento — así que su vidrio lo muestrea como muestrea el resto de la
  // página. Es la misma mudanza que ya se le hizo a la sombra de la hoja.
  // (El otro backdrop root, el `backdrop-filter` del propio velo, se fue por
  // los tokens: §5.bis de `index.css`.)
  const veloAnim = open
    ? "animate-in fade-in duration-[var(--dur-lento)]"
    : `animate-out fade-out duration-[var(--dur-fast)] ${HOLD_EXIT}`;
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
  // En ESCRITORIO el panel sí lleva su animación de clases: la gota es de
  // táctil y sin nada en su lugar el modal aparecería de golpe, que es
  // justamente lo que la nota de motion del proyecto llama "se lee como roto".
  // Es la que tenía antes de v2.279.0.
  //
  // Pero `zoom-in-95` SIN `fade-in`, y esa resta es el punto: la opacidad por
  // debajo de 1 hace que el panel componga como grupo y su propio
  // `backdrop-filter` deje de muestrear el fondo — el vidrio aparecía recién al
  // terminar. Escalar al 95% no tiene ese problema: el blur pasa de 24px a ~23,
  // que no se ve. El velo ya aporta el desvanecido por su lado.
  const panelAnim = (animacionPropia || sinMovimiento || sinHover) ? "" : open
    ? "animate-in zoom-in-95 duration-[var(--dur-base)]"
    : `animate-out zoom-out-95 duration-[var(--dur-fast)] ${HOLD_EXIT}`;

  const alignCls =
    align === "pantalla" ? "items-stretch justify-center" :
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
      // §5 · El velo es la segunda pieza de MATERIAL de un modal, junto al
      // panel — así que su color y su desenfoque salen de una regla de
      // `index.css` (`[data-velo]`), no de clases de Tailwind acá. Escrito a
      // mano era `bg-scrim backdrop-blur-sm`: un vidrio fuera de toda
      // superficie canónica, que es justo lo que el gate `vidrio-a-mano`
      // persigue. En Liquid NO oscurece —el panel ya se separa con su propio
      // blur, canto y lente— y sólo desenfoca 1px; en Solid oscurece 0.17
      // porque su panel es opaco. `--scrim` se quedó donde corresponde: el
      // fondo del sidebar móvil y los overlays de hover sobre fotos.
      className={`fixed inset-0 ${zClass} flex ${alignCls}`}
      // El que no es el de encima NO PINTA. `display:none` y no `visibility` ni
      // opacidad: hace falta que salga también del árbol de accesibilidad y del
      // recorrido de Tab, o quedarían dos `aria-modal="true"` a la vez y un
      // lector de pantalla anunciaría el diálogo tapado.
      style={esTope ? undefined : { display: 'none' }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {/* ── El velo ──────────────────────────────────────────────────────
          Capa propia y hermana del panel (ver la nota de `veloAnim`). No
          captura el puntero: el que cierra al hacer clic afuera es el botón de
          abajo, que va después y por tanto encima. */}
      {conVelo && (
        <div
          data-velo="si"
          aria-hidden="true"
          className={`absolute inset-0 pointer-events-none ${veloAnim}`}
        />
      )}

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
            // SIN relleno lateral acá. Estaba con `pr-[var(--sa-right)]`
            // y era un error de bulto: este envoltorio es TRANSPARENTE —la
            // superficie la pinta el hijo—, así que el relleno no corría el
            // contenido, encogía el panel y dejaba una franja por la que se veía
            // la lista de atrás contra el borde de la pantalla. El área segura va
            // sobre el CONTENIDO, adentro de la hoja, para que el material siga
            // llegando al filo.
            ? 'h-full w-[47%] max-w-[420px] min-w-[280px]'
            // A pantalla completa el envoltorio SÍ pinta. En las demás
            // posiciones es transparente a propósito —la superficie la pone el
            // hijo, que es una tarjeta flotando sobre la vista—, pero una
            // pantalla entera no flota sobre nada: si no pinta, se ve la vista
            // de atrás a través del expediente. Medido en los cuatro temas:
            // `background: rgba(0,0,0,0)` y el texto encima de la tabla.
            // Lleva el fondo de PÁGINA y no el de tarjeta, porque lo que se
            // está dibujando es una pantalla y adentro van tarjetas.
            : align === "pantalla" ? 'h-full w-full' : 'w-full'} ${autoHoja && align !== "side" && align !== "pantalla"
            ? 'max-w-none [&>*:not([data-hoja])]:rounded-b-none [&>*:not([data-hoja])]:pb-[max(16px,var(--sa-bottom))]'
            : (align === "side" || align === "pantalla") ? '' : maxWidthClass} ${panelAnim} ease-[var(--ease-spring)] outline-none ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
        // `--bg-page` y NO la clase `bg-surface-page`: ese token vale
        // **transparent** en Liquid (index.css:192), donde el fondo de la app lo
        // pinta un gradiente radial más arriba en el árbol. Con la clase, el
        // expediente salía transparente en los dos temas Liquid y se veía el
        // menú y el catálogo POR DEBAJO del contenido — en Solid no, porque ahí
        // `--bg-page` sí es un color plano. Es justo el tipo de diferencia que
        // sólo aparece mirando los cuatro temas, no compilando.
        style={align === "pantalla" ? { background: 'var(--bg-page)' } : undefined}
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
        {align === "pantalla" ? (
          /* ── La barra, y el scroll que le pertenece ────────────────────
             A pantalla completa el contenido puede ser largo —el expediente de
             un producto son siete secciones— y la única salida no puede estar
             al final del recorrido. La barra queda fija arriba con el nombre de
             lo que se está mirando; el que scrollea es el cuerpo, no la
             pantalla.
             `min-h-0` en el cuerpo: sin él un hijo de un flex en columna no
             baja de su tamaño de contenido y el scroll nunca aparece — la
             pantalla crece y la barra se va con ella. */
          <div className="flex flex-col h-full">
            <div className="flex-none flex items-center gap-2.5 px-3 py-2.5
                border-b border-border-card bg-surface-card"
                style={{ paddingTop: 'max(0.625rem, var(--sa-top))' }}>
              <Button variant="ghost" size="md" iconOnly icon={ArrowLeft}
                onClick={onClose} aria-label="Volver" />
              <span className="flex-1 min-w-0 truncate text-body-lg font-black
                tracking-[-0.01em] text-content">{titulo || ariaLabel}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain
              pb-[max(1rem,var(--sa-bottom))]">
              {children}
            </div>
          </div>
        ) : children}
      </div>
    </div>
    </EstadoDialogoCtx.Provider>,
    document.body
  );
}
