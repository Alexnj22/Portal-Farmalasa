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
- Escala: 0.75 (versalitas) · 1.0625 · 1.25 · 2–3.25rem (filas) · clamp(3.4rem, 13vw, 8.5rem) (títulos) · clamp(4.6rem, 21.5vw, 17rem) (nombres).
- Sin letra manuscrita. Mayúsculas espaciadas sólo para fechas y horas cortas.

## Layout
- Encabezado de sección alineado a la izquierda, título grande y un filete; en escritorio, título a la izquierda (columna de 1/3) y contenido a la derecha.
- Ritmo: secciones con `clamp(72px, 12vw, 152px)` de aire; grupos internos apretados.
- Filas separadas por filetes en lugar de tarjetas. Tarjetas sólo en el panel.
- Botones y selectores en píldora; campos con 14px; fotos con 18px.
- Portada a pantalla completa con la foto debajo de la navegación (transparente arriba, lino al bajar).

## Components
- **Botón**: rectangular, 48px de alto, radio 4px. Primario oliva sobre lino; sobre oliva, lino.
- **Selector asiste / no asiste**: dos segmentos con texto (nunca sólo color), el elegido relleno y con ✓.
- **Fila de persona**: nombre a la izquierda, selector a la derecha; debajo, campo de alergias que se abre sólo si hace falta.
- **Resumen de confirmación**: barra fija al pie del formulario con «Asisten 2 de 4» y el botón con la acción exacta.

## Motion
Curva `cubic-bezier(0.22, 1, 0.36, 1)`. Nada rebota y todo se apaga con `prefers-reduced-motion`.
- **Telón** (`Telon.jsx`): monograma y «Para …», sube a los 2 s. Una vez por visita y sin bloquear toques.
- **Portada**: los nombres suben letra por letra; la foto se acerca despacio y baja más lento que la página (paralaje). El paralaje es una animación CSS ligada al scroll (`animation-timeline`), que el navegador corre fuera del hilo principal; donde no existe, un rAF escribe una variable CSS. Nunca estado de React por cuadro.
- **Cinta** oliva con los nombres y la fecha en movimiento continuo.
- **Frase** (`FraseRevelada.jsx`): las palabras se iluminan al leer bajando.
- **Galería** (`GaleriaHorizontal.jsx`): tira que se desliza de lado con el dedo (scroll nativo con imán), flechas en computadora. Bajar nunca mueve las fotos de lado: el usuario lo encontró raro.
- Nada corre en cada cuadro de scroll salvo la frase. El grano de papel sólo en computadora (en el teléfono costaba cada cuadro).
- **Sobre** (`Sobre.jsx`): en `/i/CODIGO` reemplaza al telón. Escena oscura cálida con luces que flotan y polvo dorado; el sobre se mece y un brillo lo cruza. Al tocar el sello: vibración, el lacre se parte en dos, la solapa gira en 3D, la tarjeta sube y se acerca hasta llenar la pantalla entre confeti y pétalos (`lib/confeti.js`, un solo lienzo y un solo rAF que se apaga solo). Una vez por visita; nunca en modo fácil ni con movimiento reducido. Es la única licencia dorada del sitio: dura tres segundos.
- **Presentación** (`Presentacion.jsx`): fundido y acercamiento lento (cuatro recorridos que alternan). En vertical, la foto entera sobre una copia desenfocada.

## La app (barra de pestañas)
`AppMarco.jsx` envuelve las rutas de invitados: una barra flotante abajo (píldora lino translúcida, 68 px, área segura del iPhone) con cinco pestañas que cambian con la fase; la del centro es el botón principal en un círculo oliva que sobresale. Cada pantalla usa `PaginaApp`: cabecera fija con la marca, título grande con la última palabra en cursiva, y el contenido. La portada mantiene su diseño y termina en accesos (`.acceso`): filas de 84 px con ícono, título serif y flecha; el que falta hacer va en oliva. Íconos de trazo en `Iconos.jsx`. `/pantalla`, `/dj` y `/admin` quedan fuera de la barra.

## Modo fácil (letra grande)
Clase `facil` en `<html>`: texto al 125 %, `--tinta-suave` y `--linea` más oscuros, ninguna animación, sin sobre ni barra de pestañas. Reemplaza el sitio por `AppFacil.jsx`: una sola columna con el saludo por nombre, la tarjeta de fecha y lugar, un botón de 104 px para confirmar y una lista de botones de 76 px con ícono (Escuchar, Cómo llegar, Llamar, WhatsApp, Fotos). Cada acción abre su propia pantalla con un «Volver» de 60 px. Lo enciende la invitación (`grupos.letra_grande`) o el botón «Aa»; la elección del botón manda. La confirmación cambia a `PasoAPaso`: una pregunta por pantalla, dos botones de 68 px y una revisión final antes de enviar.

## En vivo
Rojo de «en vivo» `oklch(0.62 0.17 30)` sólo para el punto que late; nada más usa ese color. El aviso de los novios es una banda oliva noche bajo la navegación, que se cierra con ×.
