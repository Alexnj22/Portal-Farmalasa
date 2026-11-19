# Design

## Visual theme
Moderno y minimalista, beige lino con verde oliva. Estrategia de color **Committed**: el oliva cubre superficies enteras (portada, confirmación, pie) y el beige es el papel. Tema claro: el invitado lo lee de día en el teléfono. La pantalla en vivo del salón es la excepción (oliva muy oscuro).

## Color (OKLCH; tokens en `src/styles.css`)
| token | valor | uso |
|---|---|---|
| `--lino` | `oklch(0.955 0.017 85)` | fondo |
| `--arena` | `oklch(0.915 0.026 82)` | fondo alterno, campos sobre oliva |
| `--linea` | `oklch(0.84 0.024 85)` | filetes |
| `--tinta` | `oklch(0.26 0.022 110)` | texto |
| `--tinta-suave` | `oklch(0.45 0.022 100)` | texto secundario |
| `--oliva` | `oklch(0.45 0.072 118)` | acento, botones |
| `--oliva-profundo` | `oklch(0.33 0.055 118)` | superficies oliva (texto lino encima: 10.6:1) |
| `--oliva-noche` | `oklch(0.2 0.03 118)` | pantalla en vivo |
| `--oliva-claro` | `oklch(0.88 0.04 112)` | selección, fondos suaves |
| `--terracota` | `oklch(0.5 0.12 40)` | errores |

## Typography
- **Instrument Serif** (display, con cursiva): nombres, títulos de sección, números grandes. El último término de cada título va en cursiva («Nuestra *historia*»). Nunca por debajo de 1.75rem.
- **Hanken Grotesk** (texto e interfaz): 400 / 500 / 600. Cuerpo 1.0625rem, interlineado 1.6, máximo 68ch.
- Escala: 0.8125 (versalitas y rótulos de pestaña: nada por debajo de 13 px) · 1.0625 · 1.25 · 2–3.25rem (filas) · clamp(3.4rem, 13vw, 8.5rem) (títulos) · clamp(4.6rem, 21.5vw, 17rem) (nombres).
- Sin letra manuscrita. Mayúsculas espaciadas sólo para fechas y horas cortas.
- Las fuentes viven en el sitio (`@fontsource`, sólo latín), no en Google Fonts. Instrument Serif normal y cursiva se precargan desde el HTML. Mientras bajan, `Instrument Serif Respaldo` y `Hanken Grotesk Respaldo` (Times New Roman y Arial con `size-adjust`/`ascent-override` medidos) ocupan lo mismo: los nombres no saltan.

## Layout
- Encabezado de sección alineado a la izquierda, título grande y un filete; en escritorio, título a la izquierda (columna de 1/3) y contenido a la derecha.
- Ritmo: secciones con `clamp(72px, 12vw, 152px)` de aire; grupos internos apretados.
- Filas separadas por filetes en lugar de tarjetas. Tarjetas sólo en el panel.
- Botones y selectores en píldora; campos con 14px; fotos con 18px.
- Portada a pantalla completa con la foto debajo de la navegación. La navegación es transparente sólo con la portada quieta arriba; en cuanto algo pasa por debajo (un centinela con IntersectionObserver), vidrio lino con desenfoque fuerte. En el teléfono la portada deja libre el alto de la barra de pestañas y el área segura (entera a la vista en 390×844, 375×667 y 360×740); acostado, el alto manda sobre el tamaño de los nombres.
- **Computadora (≥ 1024 px)**: no hay barra de teléfono; la navegación va en la cabecera (`NavEscritorio`, la acción principal en píldora oliva). Las páginas de la app van en dos columnas: título fijo a la izquierda (1/3) y contenido a la derecha (2/3).
- Capas por escala (`--z-base` … `--z-grano` en `:root`), nunca un z-index suelto. Toque mínimo 44 px (`--toque`) en todo lo que se toca, incluidos «Aa», idioma y `.btn.chico`. Foco: doble anillo (lino por dentro, oliva por fuera; al revés sobre oliva).

## Components
- **Botón**: píldora de 52 px (44 px el chico). Primario tinta sobre lino; sobre oliva, lino. Se hunde a 0.97 al tocarlo.
- **Selector asiste / no asiste**: dos segmentos con texto (nunca sólo color), el elegido relleno y con ✓.
- **Fila de persona**: nombre a la izquierda, selector a la derecha; debajo, campo de alergias que se abre sólo si hace falta.
- **Resumen de confirmación**: barra fija al pie del formulario con «Asisten 2 de 4» y el botón con la acción exacta.

## Motion
Curva `cubic-bezier(0.22, 1, 0.36, 1)`. Nada rebota.

**Regla: el estado por defecto es el FINAL.** Todo se escribe visible; las animaciones de entrada viven sólo dentro de `@media (prefers-reduced-motion: no-preference)`. Con movimiento reducido o en modo fácil no queda nada escondido esperando una animación (antes, los nombres de la portada desaparecían). Sólo se anima `transform` y `opacity`: los latidos son un `::after` que crece y se apaga, nunca `box-shadow`; los brillos cruzan con `translateX`, nunca `left`.
- **Entre pestañas**: View Transitions (`viewTransition` en cada `NavLink`). La cabecera y la barra quedan quietas; el contenido se funde y se desliza según la dirección (`html[data-dir]`); el indicador de la pestaña activa viaja como su propio grupo y el título de la página se transforma. Sin la API, el indicador se desliza con `transform`.
- **Al bajar**: `Revelar` y la frase usan `animation-timeline: view()` (sin JavaScript por cuadro) dentro de `@supports`; donde no existe, IntersectionObserver, y sólo entonces se esconde lo que todavía no se ve.
- **Microinteracciones**: botones que se hunden a 0.97 al tocarlos, «Asisten 2 de 4» con el número que rueda, palomita que se dibuja al confirmar (y una vibración de 8 ms), esqueletos con brillo mientras baja una pantalla.
- **Telón** (`Telon.jsx`): monograma y «Para …», sube a los 2 s. Una vez por visita y sin bloquear toques.
- **Portada**: los nombres suben letra por letra; la foto se acerca despacio y baja más lento que la página (paralaje). El paralaje es una animación CSS ligada al scroll (`animation-timeline`), que el navegador corre fuera del hilo principal; donde no existe, un rAF escribe una variable CSS. Nunca estado de React por cuadro.
- **Cinta** oliva con los nombres y la fecha en movimiento continuo.
- **Frase** (`FraseRevelada.jsx`): las palabras se iluminan al leer bajando.
- **Galería** (`GaleriaHorizontal.jsx`): tira que se desliza de lado con el dedo (scroll nativo con imán), flechas en computadora. Bajar nunca mueve las fotos de lado: el usuario lo encontró raro.
- Nada corre en cada cuadro de scroll salvo la frase. El grano de papel sólo en computadora (en el teléfono costaba cada cuadro).
- **Sobre** (`Sobre.jsx` + `estilos/sobre.css`, en su propio chunk): en `/i/CODIGO` reemplaza al telón. Es un `<dialog>` modal (capa superior, el resto inerte). Papel con grano SVG y pliegues con filo de luz, sombras en cuatro capas, forro oliva con rombos finos, solapa 3D con su propia sombra, lacre oliva con monograma dorado y brillo especular, tarjeta con filete dorado doble; el nombre del invitado va abajo, nunca bajo el lacre. Coreografía sin rebote: el lacre se parte (0–0.8 s), la solapa se abre (0.25–1.25 s), la tarjeta sale del bolsillo, pasa por encima y queda al centro mientras el sobre baja y se desvanece (hasta 3.4 s); a los 4.4 s los nombres de la tarjeta se vuelven los de la portada (View Transition con nombre compartido; sin la API, fundido). El polvo dorado son sprites pre-dibujados (`drawImage`, sin `shadowBlur`), el lienzo vive dentro del diálogo y se detiene con la pestaña oculta. Una vez por visita; nunca en modo fácil ni con movimiento reducido. Es la única licencia dorada del sitio.
- **Música**: un solo `<audio>` para todo el sitio (`lib/sonido.js`). Empieza dentro del toque al lacre (el iPhone no deja después), no se reinicia al cambiar de pestaña y queda el botón ♪ en la cabecera para callarla.
- **Presentación** (`Presentacion.jsx`): fundido y acercamiento lento (cuatro recorridos que alternan). En vertical, la foto entera sobre una copia desenfocada.

## La app (barra de pestañas)
`AppMarco.jsx` envuelve las rutas de invitados: una barra flotante abajo (píldora lino translúcida, 68 px, área segura del iPhone) con cinco pestañas que cambian con la fase; la del centro es el botón principal en un círculo oliva que sobresale. Cada pantalla usa `PaginaApp`: cabecera fija con la marca, título grande con la última palabra en cursiva, y el contenido. La portada mantiene su diseño y termina en accesos (`.acceso`): filas de 84 px con ícono, título serif y flecha; el que falta hacer va en oliva. Íconos de trazo en `Iconos.jsx`. `/pantalla`, `/dj` y `/admin` quedan fuera de la barra.

## Modo fácil (letra grande)
Clase `facil` en `<html>`: texto al 125 %, `--tinta-suave` y `--linea` más oscuros, ninguna animación, sin sobre ni barra de pestañas. Reemplaza el sitio por `AppFacil.jsx`: una sola columna con el saludo por nombre, la tarjeta de fecha y lugar, un botón de 104 px para confirmar y una lista de botones de 76 px con ícono (Escuchar, Cómo llegar, Llamar, WhatsApp, Fotos). Cada acción abre su propia pantalla con un «Volver» de 60 px. Lo enciende la invitación (`grupos.letra_grande`) o el botón «Aa»; la elección del botón manda. La confirmación cambia a `PasoAPaso`: una pregunta por pantalla, dos botones de 68 px y una revisión final antes de enviar.

## En vivo
Rojo de «en vivo» `oklch(0.62 0.17 30)` sólo para el punto que late; nada más usa ese color. El aviso de los novios es una banda oliva noche bajo la navegación, que se cierra con ×.

## Tema nocturno
El día de la boda, desde las 6 p. m. hora del lugar (`boda.zonaHoraria`) hasta las 6 a. m., y también ese día si el teléfono pide modo oscuro, `AppMarco` pone `html[data-tema=noche]`: oliva noche de papel y lino de letra, vidrio oscuro en cabecera y barra, `theme-color` oscuro. Fuera del día de la boda el sitio es siempre claro: es una invitación de papel, y el modo oscuro del teléfono no la cambia. Las superficies que ya son oscuras (portada, pie, galería, pestaña oliva, tarjetas oliva) conservan su paleta de día. Nunca en modo fácil: ahí manda el contraste máximo.

## Rendimiento y carga
- La primera carga lleva sólo React, el router, la portada y el marco. Cada pantalla es un chunk (`lib/precarga.js`) que se pide en un rato libre y al apuntar o tocar su pestaña; mientras baja, un esqueleto con la forma real. El backend (supabase-js o la demo) se carga aparte (`lib/api.js`). Leaflet baja cuando el mapa se acerca a la pantalla; el QR, la presentación, el sobre y el modo fácil, cuando hacen falta.
- Si un chunk falla por una versión nueva, la página se recarga una vez sola; si vuelve a fallar, pantalla de error con «Volver al inicio».
- Fotos de configuración con `srcset` (`lib/fotos.js`); la de portada se precarga con `fetchpriority=high`.

## La app instalable (PWA)
Manifiesto «A&E» con los colores de la marca e íconos del monograma (192, 512, enmascarable y apple-touch). El service worker (`vite-plugin-pwa`) guarda el armazón, los chunks de invitado y las fuentes; las fotos de configuración (Unsplash) en caché aparte por 30 días. Nunca guarda nada de Supabase. Una versión nueva se instala en la siguiente navegación, sin preguntar.
