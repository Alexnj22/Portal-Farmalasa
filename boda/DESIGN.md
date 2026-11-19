# Design

## Visual theme
**Cinematográfico, sobrio y caro.** Una sala a oscuras: fondo noche, letra lino, Bodoni enorme y una sola nota de champán. Lo que se busca es la contención de una joyería o un hotel de lujo: pocos elementos, mucho aire y **una sola cosa dominante por pantalla**. Las fotos dan la emoción. La interfaz se aparta.

Hay **un solo tema** para los invitados. El antiguo tema nocturno automático (`html[data-tema=noche]`) se quitó porque el sitio ya es oscuro. Se quedan claros sólo el **modo fácil** y el **panel** (`/admin`), porque ahí mandan el contraste máximo y la lectura de trabajo (ver «Ámbito claro»).

## Color (OKLCH; tokens en `src/styles.css`)
Las pantallas usan sólo los tokens de **rol**. La paleta fija (`--c-*`) existe para los pocos sitios que necesitan un color que no cambie con el ámbito.

| rol | valor | uso |
|---|---|---|
| `--fondo` | noche `oklch(0.16 0.008 105)` | fondo |
| `--fondo-hondo` | `oklch(0.12 0.006 105)` | pie, mesa del sobre, velo |
| `--superficie` / `--superficie-2` | `oklch(0.2 …)` / `oklch(0.24 …)` | campos, resumen flotante, esqueletos |
| `--texto` | lino `oklch(0.93 0.018 85)` | texto (15.8:1 sobre noche) |
| `--texto-2` | lino al 66 % | texto secundario (6.8:1 sobre noche, 6.25:1 sobre superficie-2) |
| `--linea` / `--linea-fuerte` | lino al 10 % / 24 % | filetes entre filas / bordes de píldora |
| `--acento` | champán `oklch(0.76 0.07 80)` | **sólo** filetes de 1 px, números romanos, versalitas, el punto de la pestaña activa y un acento de CTA (9:1 sobre noche) |
| `--acento-2` | oliva `oklch(0.66 0.06 115)` | secundario y escaso (6.3:1) |
| `--error` | `oklch(0.74 0.1 35)` | errores |
| `--vivo` | `oklch(0.65 0.17 30)` | sólo el punto que late «en vivo» |
| `--boton` / `--sobre-boton` | lino / noche | botón primario relleno |

Prohibido: el dorado brillante, los degradados decorativos y el champán como relleno de superficies grandes. La única excepción es el botón del resumen de confirmación, porque es la acción del momento. Los degradados que quedan son **iluminación** (el velo sobre la foto de portada, la luz cenital de la mesa del sobre), nunca adorno.

## Typography
- **Bodoni Moda** (display, eje de tamaño óptico: a tamaño grande usa el corte de alto contraste). Peso 400 y `letter-spacing: -0.02em`. El «&» y la **última palabra de cada título** van en cursiva («Nuestra *historia*», «Pide tu *canción*»). Nombres, títulos, números grandes de la cuenta regresiva.
- **Inter Tight** (texto e interfaz) en 300, 400 y 500. Cuerpo de 17 px con interlineado 1.6 y máximo 68ch.
- **Versalitas** (`.versalita`): mayúsculas con un espaciado de .32 a .4em y **nunca menos de 12–13 px**. Sirven para rótulos de capítulo, fechas y horas cortas.
- Escala: versalitas 0.75–0.8125rem · cuerpo 1.0625rem · filas 1.6–2.4rem · títulos de página `clamp(3rem, 12vw, 6.5rem)` · nombres `clamp(…, 17–19vw, …)`.
- Las fuentes viven en el sitio (`@fontsource-variable`, sólo latín, `src/estilos/fuentes.css`). Bodoni normal y cursiva se precargan desde el HTML (`vite.config.js`). Mientras bajan, `Bodoni Respaldo` e `Inter Respaldo` ocupan exactamente lo mismo: son Times New Roman y Arial con `size-adjust`/`ascent-override` medidos con fontTools, así que los nombres no saltan.

## Layout
- **Escenas a sangre**: portada a pantalla completa, la frase sola en una pantalla y la foto de «Nuestra historia» que se abre al bajar.
- **Títulos enormes alineados a la izquierda.** Encima va el **capítulo** (`<Capitulo>`): número romano en cursiva champán, un filete fino de champán y la versalita. En las páginas de la app el número es la posición de la pestaña (I Inicio, II Dónde, III Confirmar…).
- **Filas separadas por filetes de 1 px** (`--linea`), no por tarjetas. Las tarjetas sólo existen en el panel y en el modo fácil.
- Márgenes: `--margen` de 22 px en el teléfono y 8vw en la computadora. Aire entre secciones: `--aire = clamp(104px, 18vw, 208px)`.
- **Computadora (≥ 1024 px)**: no hay barra de teléfono. La navegación va arriba (`NavEscritorio`: versalitas, subrayado champán en la activa y la acción principal en píldora con borde champán). Las páginas de la app van en dos columnas, con el título fijo a la izquierda (1/3) y el contenido a la derecha (2/3). Lo mismo vale para las secciones de la portada (`.dividida`) y los capítulos de la historia.
- Botones y selectores en píldora. Los campos son rectángulos oscuros con 4 px de radio y las fotos casi rectas (2 px).
- Capas por escala (`--z-base` … `--z-grano` en `:root`), nunca un z-index suelto. Toque mínimo de 44 px (`--toque`) en todo lo que se toca. El foco es un anillo champán de 1 px separado del control.

## Components
- **Botón**: píldora de 52 px (44 px el chico). El primario es noche sobre lino; el secundario, transparente con borde `--linea-fuerte`. Se hunde a 0.97 al tocarlo.
- **Campos**: fondo `--campo`, borde fino; al recibir el foco, borde y anillo champán.
- **Selector asiste / no asiste**: dos segmentos con texto, **nunca sólo color**. El elegido va relleno y con ✓.
- **Resumen de confirmación**: píldora flotante (sticky) con «Asisten 2 de 4» y el botón champán con la acción exacta. En teléfonos bajos (≤ 720 px de alto) se vuelve una sola línea para no tapar la lista.
- **Accesos de la portada** (`.acceso`): filas con ícono de trazo fino, título en Bodoni y flecha. Lo que falta hacer lleva arriba la versalita champán «Falta responder».
- **Mapa**: teselas de OpenStreetMap oscurecidas con un filtro CSS (`invert + hue-rotate + grayscale`). Así no hace falta otro proveedor ni clave, y el CSP no cambia. Los marcadores son círculos noche con el número romano en champán, y los controles y la atribución van oscuros.

## Motion
Curva `--salida = cubic-bezier(0.22, 1, 0.36, 1)`. Nada rebota.

**Regla: el estado por defecto es el FINAL.** Todo se escribe visible. Las animaciones viven sólo dentro de `@media (prefers-reduced-motion: no-preference)`, y con movimiento reducido o en modo fácil todo queda visible y quieto. Sólo se anima `transform`, `opacity` y `clip-path`.

**No hay letras que se muevan**: se quitaron la cinta que corría, los nombres que subían letra por letra, la frase que se iluminaba palabra por palabra y el grano animado. El texto aparece quieto o con un fundido sereno.

- **Portada**: dos franjas de cine se retiran **una sola vez** por visita, con la marca `boda-portada-abierta` en `sessionStorage`. En las visitas siguientes, `html.ya-abierta` la pinta abierta y sin espera. Debajo, la foto se acerca despacio (Ken Burns) con un paralaje sutil ligado al scroll (`animation-timeline: scroll()`).
- **Al bajar** (`.revelar`): fundido de ≤ 20 px en 1–1.2 s con `animation-timeline: view()` dentro de `@supports`. Donde no existe, IntersectionObserver, y sólo entonces se esconde lo que todavía no se ve. Los filetes de los capítulos se dibujan solos con `scaleX`.
- **«Nuestra historia»**: la foto se abre con `clip-path: inset(24% 16%) → inset(0)`, pegada (`sticky`) en una escena de 210svh con `view-timeline`. Sin soporte, la foto aparece entera y quieta.
- **Entre pestañas**: View Transitions con un fundido sobrio, donde el contenido viejo se apaga y el nuevo sube 8 px. La cabecera y la barra quedan quietas. El punto champán de la pestaña activa viaja como su propio grupo (`punto-pestana`).
- **Cuenta regresiva**: días, horas y minutos, sin segundos, porque el número que cambia cada segundo es justo lo que no se quería. Se actualiza cada 15 s.
- **Grano**: estático y sólo en la computadora (opacidad .045). En el teléfono no se pinta.
- **Galería** (`GaleriaHorizontal.jsx`): tira que se desliza de lado con el dedo, con imán; flechas en la computadora.
- **Sobre** (`Sobre.jsx` + `estilos/sobre.css`, en su propio chunk), en `/i/CODIGO`:
  - Es un `<dialog>` modal sobre una mesa a oscuras con una sola luz cenital.
  - El sobre es **carbón** con grano y pliegues con filo de luz. El **canto de la solapa** es una línea de **lámina champán mate** por la que cruza despacio un brillo (`translateX`, cada 6.5 s). El forro es oliva hondo con rombos finos.
  - El **lacre** es oliva oscuro con el monograma en lámina.
  - La **tarjeta** es de lino, con doble filete champán, el monograma, los nombres en Bodoni, la fecha en romanos y «Para …» en cursiva.
  - **El nombre del invitado va en el bolsillo, debajo del lacre, nunca tapado por él.**
  - Coreografía sin rebote: el lacre se parte, la solapa se abre, la tarjeta sale, pasa por encima y queda al centro mientras el sobre baja y se apaga. A los 4.4 s los nombres de la tarjeta se vuelven los de la portada (View Transition con nombre compartido `nombres`; sin la API, fundido).
  - De partículas, sólo **un soplo de polvo champán, fino y breve**, al partir el lacre. Ni confeti, ni pétalos, ni polvo en espera.
  - Una vez por visita, y nunca en modo fácil ni con movimiento reducido.
- **Música**: un solo `<audio>` (`lib/sonido.js`). Empieza dentro del toque al lacre, no se reinicia al cambiar de pestaña, y el botón ♪ de la cabecera la calla.
- **Presentación** (`Presentacion.jsx`): fundido y acercamiento lento sobre negro.

## La app (barra de pestañas)
`AppMarco.jsx` envuelve las rutas de los invitados con una **píldora oscura translúcida** abajo (64 px, respeta el área segura). Lleva cinco pestañas que cambian con la fase, con íconos de trazo fino (1.4) y la activa marcada con un **punto champán**. La del centro es la acción principal: se distingue por un anillo champán fino alrededor del ícono, **sin el círculo que sobresalía**. La cabecera lleva el monograma en Bodoni (`<Monograma>`: «A», «&» cursiva champán, «E»). Cada pantalla usa `PaginaApp`, con el capítulo romano, el título grande con la última palabra en cursiva y el contenido. `/pantalla`, `/dj` y `/admin` quedan fuera de la barra.

## Ámbito claro (modo fácil y panel)
`src/estilos/claro.css` define el ámbito `html.facil, .tema-claro, .pruebas`, que devuelve los roles a la paleta de papel: lino de fondo, tinta y oliva. También define los nombres viejos (`--lino`, `--tinta`, `--oliva`…) que usan el CSS del panel y el del modo fácil, sin tocar esas reglas. `/admin` va envuelto en `.tema-claro`.

- **Modo fácil**: clase `facil` en `<html>`, texto al 125 %, claro y de alto contraste, sin ninguna animación, sin sobre ni barra de pestañas. Reemplaza el sitio por `AppFacil.jsx`: una columna, botones de 76–104 px, y la confirmación paso a paso (`PasoAPaso`). Lo enciende la invitación (`grupos.letra_grande`) o el botón «Aa», y manda la elección del botón.

## En vivo
El rojo `--vivo` es sólo para el punto que late. El aviso de los novios es una banda oscura bajo la navegación, que se cierra con ×.

## Rendimiento y carga
- La primera carga lleva sólo React, el router, la portada y el marco: unos 89 kB gzip de JS de entrada. Cada pantalla es un chunk (`lib/precarga.js`) que se pide en un rato libre y al apuntar o tocar su pestaña; mientras baja, un esqueleto. El backend se carga aparte (`lib/api.js`). Leaflet baja cuando el mapa se acerca a la pantalla; el QR, la presentación, el sobre y el modo fácil, cuando hacen falta.
- Si un chunk falla por una versión nueva, la página se recarga una vez sola.
- Las fotos de configuración llevan `srcset` (`lib/fotos.js`) y la de portada se precarga con `fetchpriority=high`.

## La app instalable (PWA)
El manifiesto «A&E» usa `theme_color`/`background_color` noche (`#0e0d0a`). En modo fácil, el `theme-color` vuelve a ser lino. El service worker guarda el armazón, los chunks de los invitados y las fuentes, y nunca nada de Supabase.
