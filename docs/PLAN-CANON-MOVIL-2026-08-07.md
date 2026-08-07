# PLAN — El canon móvil, y cómo se verifica solo

**Estado:** abierto · **Abierto el** 2026-08-07 · **Antecesor:** `PLAN-MOBILE-2026-07.md`
(aquél arregla lo que hay; **éste evita que vuelva a pasar en lo que venga**).

## 0. Qué resuelve y qué no

**Resuelve:** que al construir una vista o un módulo nuevo, la variante móvil de
cada elemento esté **decidida de antemano** y **verificada por una máquina**, en
vez de re-decidirse en cada pantalla y descubrirse abriendo el teléfono.

**No resuelve** la deuda visual pendiente (acuse del toque, pestañas internas sin
mirar, tema oscuro). Eso es la Fase 4 del plan anterior y sigue viva.

---

## 1. Por qué ahora — la evidencia

Tres cosas medidas esta semana, y las tres son de gobierno, no de código:

1. **El canon existe y está desactualizado.** `DESIGN.md §32` es el estándar
   móvil y hoy afirma que *«`DataTable` no se convierte en lista de fichas; no
   existe una variante móvil»*. Es exactamente lo que se construyó en v2.480.0.
   Un canon que miente **enseña la deuda** al que lo lee para hacer algo nuevo.

2. **Los canónicos móviles existen pero nadie los enumera.** Hay al menos nueve
   —`ExpedienteMovil`, `HojaMovil`, `AsaHoja`, `BarraFlotante`, `SelectorTactil`,
   `CarrilCards`, `FichasMovil` dentro de `DataTable`, `.blanco-tactil`, el
   colapso de `ViewTabBar` a `LiquidSelect`— y ninguna lista dice *cuál
   corresponde a qué*. Se descubren leyendo el componente.

3. **La adopción a medias no se nota.** `DataTable` traía su modo ficha y
   Personal seguía en tabla: el canónico estaba importado y no adoptado. Nada
   avisó. El aviso que lo explicaba vivía dentro del componente que **sólo se
   monta cuando el problema no ocurrió**.

---

## 2. El canon — qué usa cada necesidad en el teléfono

Esta tabla es el entregable central. Verificada contra el código el 2026-08-07.

| Necesidad de la vista | Escritorio | En el teléfono (<1024px) |
|---|---|---|
| Lista de registros | `DataTable` + `DataRow`/`DataCell` | **el mismo**: cae solo a fichas. No se escribe una lista aparte |
| Detalle de una fila | fila expandida o modal | **`ExpedienteMovil`** — `variante="auto"` (hoja que crece) o `"pantalla"` |
| Cuerpo de un modal | `LiquidModal` / `ModalShell` | **`HojaMovil`** (entra desde abajo) + **`AsaHoja`** como tirador |
| Controles de la vista | header + botones | **`BarraFlotante`**, al alcance del pulgar. Sólo táctil |
| Filtros | `FilterBar` | **el mismo**: publica sus ranuras en `BarraFlotante` |
| Pestañas de la vista | `ViewTabBar` | **el mismo**: bajo `lg:` colapsa a `LiquidSelect` |
| Elegir de una lista larga | `LiquidSelect` | **`SelectorTactil`** |
| Métricas de cabecera | fila de `StatCard` | **`CarrilCards`** — desliza; dos por pantalla |
| Elegir 1 de N | `SegmentedControl` | **el mismo**: envuelve y sube a 44pt |
| Interruptor | `Switch` | **el mismo** + área de impacto de 44 |
| Control cuyo tamaño **es** el diseño | — | **`.blanco-tactil`**: separa el área de impacto del tamaño pintado |
| Tabla que **no** es una lista de registros | `DataTable` | `movil={false}` → tabla en carril. **Es la excepción y se justifica en el código** |

**Las dos reglas que no son componentes:**
- Ningún `<input>`/`<textarea>` de texto por debajo de `text-[16px]` (zoom de iOS).
- Ningún blanco táctil por debajo de 44pt, salvo que **no quepa** — y eso se mide,
  no se declara: `(ancho − huecos) / columnas < 44`.

---

## 3. Tres capas, y qué puede ver cada una

La distinción importa: la mitad de esto **no se puede verificar leyendo código**.

| Capa | Corre | Ve | NO ve |
|---|---|---|---|
| **A · El documento** (`DESIGN.md §32` + esta tabla) | — | la decisión y su motivo | nada por sí solo |
| **B · Gate estático** (`gate:design`, nuevo `gate:movil`) | cada commit | qué se importa, qué se escribe a mano, `text-` chico en inputs, `<table>`/`<select>` crudos | si el canónico **se adoptó** o sólo se importó |
| **C · Barrido dinámico** (Playwright + `medicion-movil.js`) | a pedido / CI | desborde, recortes, blancos <44pt, zoom, tabla en el teléfono, vista reventada | lo que no abrió: pestañas internas, modales, otros temas |

**Consecuencia de diseño:** el gate estático nunca podrá decir «esta vista se ve
bien». Su trabajo es más chico y más honesto: **que no se pueda escribir a mano
lo que ya es canónico**. Lo demás lo mide C.

---

## 4. Fases

### Fase 0 — Poner el canon al día  *(bloquea a las demás)*
`DESIGN.md §32` afirma cosas falsas hoy. Reescribir:
- «tabla → fichas no existe» → existe desde v2.480.0, y cómo se elige el papel de
  cada columna (identidad / ancla / contexto / hoja).
- Los *residual gaps* de blancos táctiles: varios se cerraron (Mín·Máx, el
  interruptor, el encabezado de Laboratorios). Los que siguen abiertos, con su
  motivo.
- `env(safe-area-*)`: dice que *«no se encontró uso en el código»*. **Falso hoy**
  — `index.css` define `--sa-top/-right/-bottom/-left` a partir de
  `env(safe-area-inset-*)`, y antes estaban escritos a mano en 14 sitios. Lo que
  sigue abierto es sólo la verificación **en dispositivo real**, no el uso.
- Incorporar la tabla de §2 de este plan.

**Aceptación:** `§32` no contiene ninguna afirmación que el código desmienta, y
la tabla de correspondencia vive ahí (este plan la referencia, no la duplica).

### Fase 1 — `gate:movil` (estático)
Un gate nuevo, con la misma forma que `gate:design` (baseline + ratchet). Reglas,
todas verificables leyendo el fuente:

1. **Tabla a mano.** Un `<table>` en `src/views/` que no venga de `DataTable` →
   hallazgo. Excepción declarada en el archivo del gate, con motivo (el
   calendario semanal de Horarios es una).
2. **Modal sin cuerpo canónico.** Un `ModalShell`/`LiquidModal` en una vista sin
   `HojaMovil` ni `ExpedienteMovil` adentro → hallazgo.
3. **Buscador a mano.** El patrón de píldora+input duplicado en vez de
   `ViewTabBar` — ya identificado en §32 como causa abierta, sin detector.
4. **`hover:` sin `active:`** en un control interactivo → es el acuse del toque,
   hoy en cientos de controles. Entra al baseline y baja por ratchet.
5. **Vista sin `BarraFlotante`** cuando declara acciones de vista.

**Aceptación:** el gate corre en pre-commit; su baseline arranca en el estado de
hoy y **ninguna categoría puede subir**. Y —lección del 2026-08-07— se verifica
que **puede fallar**: se le mete una violación a propósito y se ve en rojo.

### Fase 2 — Cerrar los huecos del barrido dinámico
Hoy cubre 37 rutas × 1 pestaña × 1 tema × 1 tamaño. Agregar, en este orden:

1. **Pestañas internas.** 37 archivos de vista declaran barra propia; sólo se
   mide la que abre por defecto. Recorrerlas todas.
2. **Modales.** 19 archivos los declaran. Abrir el primero de cada vista y medir
   adentro (el medidor ya trae `encadenan`, que sólo aplica dentro de un
   diálogo).
3. **Tema oscuro.** Todo lo medido fue en claro; el portal tiene cuatro temas.

**Aceptación:** el informe distingue *ruta · pestaña · modal · tema*, y cada
combinación nueva arranca con su propio número, no mezclada.

### Fase 3 — El checklist de vista nueva
Un archivo corto que se abre al crear un módulo. No prosa: preguntas con
respuesta verificable, cada una apuntando a su fila de la tabla de §2.
Se engancha al checklist de módulo nuevo que ya existe en memoria.

**Aceptación:** construir la próxima vista siguiéndolo, y que el barrido la
encuentre en cero **la primera vez**. Ése es el único criterio que vale: si hay
que corregirla después, el checklist no sirvió.

### Fase 4 — CI
`gate:movil` en cada commit. El barrido completo, en el pipeline (4½ minutos), no
en cada push.

---

## 5. Reglas que este plan hereda y no negocia

- **Un instrumento que no puede fallar no prueba nada.** Todo detector nuevo se
  verifica en rojo antes de darlo por bueno (2026-08-07: una prueba pasó dos
  veces con cero intercepciones; el service worker se comía la petición).
- **Cero hallazgos y cero datos se ven igual.** Todo informe lleva una prueba de
  vida: si no encontró nada, tiene que demostrar que recorrió algo.
- **El baseline no se regenera para tapar un hallazgo nuevo.**
- **La pantalla habla del portal**, nunca del sistema de origen — también en los
  textos que agregue una variante móvil.

---

## 6. Lo que este plan NO cubre

- La deuda visual abierta: acuse del toque (~200 controles), el hueco bajo el
  título en varias vistas, la barra flotante sobre estados vacíos centrados.
- Tablet (768) y horizontal: el canon habla del teléfono.
- El shell nativo de Capacitor y las safe-areas en dispositivo real — §32 lo
  marca como no verificado desde julio y sigue así.
