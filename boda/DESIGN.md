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
- **Italiana** (display): nombres, títulos de sección, números grandes. Nunca por debajo de 1.75rem.
- **Hanken Grotesk** (texto e interfaz): 400 / 500 / 600. Cuerpo 1.0625rem, interlineado 1.6, máximo 68ch.
- Escala: 0.875 · 1.0625 · 1.33 · 1.75 · 2.5 · clamp(2.75rem, 9vw, 6rem) · clamp(3.25rem, 15vw, 9.5rem).
- Sin letra manuscrita. Mayúsculas espaciadas sólo para fechas y horas cortas.

## Layout
- Encabezado de sección alineado a la izquierda, título grande y un filete; en escritorio, título a la izquierda (columna de 1/3) y contenido a la derecha.
- Ritmo: secciones con `clamp(72px, 12vw, 152px)` de aire; grupos internos apretados.
- Filas separadas por filetes en lugar de tarjetas. Tarjetas sólo en el panel.
- Radio pequeño: 4px en botones y campos, 2px en fotos.

## Components
- **Botón**: rectangular, 48px de alto, radio 4px. Primario oliva sobre lino; sobre oliva, lino.
- **Selector asiste / no asiste**: dos segmentos con texto (nunca sólo color), el elegido relleno y con ✓.
- **Fila de persona**: nombre a la izquierda, selector a la derecha; debajo, campo de alergias que se abre sólo si hace falta.
- **Resumen de confirmación**: barra fija al pie del formulario con «Asisten 2 de 4» y el botón con la acción exacta.

## Motion
Entradas con `cubic-bezier(0.25, 1, 0.5, 1)` (ease-out-quart), 600–900ms, desplazamiento de 16px. Portada con aparición escalonada. Nada rebota. Todo se apaga con `prefers-reduced-motion`.
