# Historia — §32 Móvil y responsive

Narrativas e incidentes que sostienen las reglas de `DESIGN.md` §32. Las reglas
viven allá; acá queda el porqué, tal como se midió.

## Origen del estándar (2026-07-10)

Se agregó durante la auditoría de diseño/UX de la Fase 4 (`AUDITORIA-2026-07.md`).
Antes no había un estándar móvil único: los patrones existían por componente.

## Breakpoints: `md` vs `lg` (Fase T2, 2026-07-23)

La sección decía «un solo breakpoint `md:768`», pero el shell real
(`AppLayout.jsx`) usa `lg:1024` como frontera móvil/escritorio desde el
rediseño del shell móvil (v2.30–v2.32.x). Viewports auditados en la Fase 4:
390×844 (teléfono) y 768×1024 (tablet). Verificados en Fase T2: 1024×768
(ultra), 1366×768 a 125% (~1093×614) y 1440×900 (cómoda).

`--font-data` existió en la tabla de densidad y se eliminó de `index.css`
(era una preocupación tipográfica metida en el sistema de densidad).

## La tabla del canon (2026-08-07)

Los canónicos móviles ya existían —nueve— y ninguna lista decía cuál
corresponde a qué: se descubrían leyendo el componente, así que cada vista nueva
volvía a decidirlo. Plan: `docs/planes-cerrados/PLAN-CANON-MOVIL-2026-08-07.md`.

## El encabezado en dos columnas (2026-08-09)

Pedido del usuario: *«el selector de tab está abajo del título, mejor que esté a
la par, así se tienen 2 columnas en móvil, se ahorra espacio vertical»*.

Antes eran dos renglones siempre, y no por falta de sitio: el título llevaba
`basis-[60%]`, y el reparto de líneas de un `flex-wrap` se decide con el tamaño
**hipotético** de cada hijo. 60% de 374px son 224 que, más los ~168 del selector
y el hueco, dan 404 > 358 — el selector bajaba aunque el título midiera 75px.
Sin que el selector cediera ancho, el título de Pedidos se quedaba con 85px y
«Sucursales» no entraba ni partido. `truncate` producía «Pedidos a Sucur…», que
es lo que A2 corrigió el 2026-07-26.

Medido en WebKit iPhone 13 sobre 18 rutas: 18 de 18 en una fila, 0 títulos
recortados, 0 rótulos de pestaña recortados. El encabezado mide 84px con
pestañas y 68px sin ellas; la variante que dejaba caer el selector medía 124px.

## Blancos táctiles

**2026-07-15 (Bloque 5.3, `PLAN-EJECUCION-2026-07.md`).** Re-auditado con
Playwright (25 rutas × 2 viewports). 36 cajas de impacto reales arregladas en 24
archivos — sobre todo 22 vistas que duplicaban el botón de búsqueda de
`ViewTabBar` con el tamaño viejo (`w-10 h-10 md:w-11 md:h-11`), más 7 enlaces
«Ver» del tablero y CTAs sueltos a pocos px de 44. Se declararon «gaps
residuales» deliberados: píldoras de filtro con texto (~130), grupos densos de
botones de ícono en tarjetas (Roles, Sucursales), insignias de hover de tamaño
fijo, el aspa y el chevron internos de `LiquidSelect`, ítems indentados del
sidebar (~36px). El argumento era «agrandar la caja invisible arriesga
solaparse con el vecino».

**2026-08-07 — varios de esos gaps dejaron de existir.** Barrido de las 37
vistas en WebKit iPhone 13: cero blancos bajo 44pt. Lo que los cerró fue separar
el área de impacto del tamaño pintado con `.blanco-tactil`, justo lo que se
daba por imposible. Casos: las 50 cajas de MIN·MAX (36×23), el interruptor `sm`
(32×16), el aspa y el chevron de `LiquidSelect`. El encabezado de sección de
Laboratorios sí creció, porque ahí el tamaño era un descuido.

Lo que no cabe se mide: siete columnas de un gráfico en 390px dan 40px cada una.
La versión anterior de esa excepción la buscaba por un `aria-label` que empezara
con «Día: », un rótulo que ningún archivo escribía: la excepción nunca corrió y
las 14 columnas entraban como deuda en cada corrida.

**2026-08-08 — el riesgo de solaparse se midió, y no existía.** En iPad Mini,
a `TabBarAction size="sm"` le faltaban 4px por lado y el hueco al vecino era de
12px. Y el comentario de `TabBarAction` decía que `sm` no necesitaba piso táctil
«porque en táctil esta píldora no se dibuja»: a 768px con puntero grueso sí se
dibuja. `useLayoutCompacto` (`max-width: 719px`, o `hover: none` con
`max-height: 500px`) responde «¿hay sitio?», no «¿hay dedo?».

Foto al 2026-08-08: 37 rutas × 4 temas (148 pantallas) más la matriz de
5 perfiles × 7 escenarios.

```
desbordes 0 · recortes 0 · zoom de iOS 0 · scroll lateral 0 · sin acuse 0
ninguna vista reventada · matriz: 0 de 35 celdas con hallazgo
```

El tema no cambia el layout: los cuatro dan números idénticos. Las áreas seguras
siguen sin verificarse en un teléfono real (`env(safe-area-inset-*)` vale 0 en
todo emulador); guion en `docs/PRUEBA-EN-TELEFONO-REAL.md`.

## El zoom de iOS en los campos (Fase 4, 2026-07-10)

El defecto de mayor impacto de esa auditoría: ~170 inputs en ~60 archivos bajo
16px (los buscadores a 13px eran el caso más repetido, vía el buscador de
`ViewTabBar` y vistas que duplicaban el suyo). Re-auditado el 2026-07-26: 11
instancias nuevas en 8 archivos (`FormRegisterPayment`,
`FormAddCustomDocument`, `KioskConfigModal`, `EarlyExitForm`, `FacturacionView`
×3, `AttendanceMonitorView` ×2, `TabLaboratorios`). Desde esa sesión lo vigila
`small-input`. El falso positivo de `placeholder:` apareció en
`AuthPromptPanel.jsx` (un PIN gigante con placeholder chico).

## Buscadores duplicados (cerrado)

La auditoría de 2026-07 registró vistas (`BranchesView`, `ConteoDetailView`…)
que escribían su propio buscador flotante en vez de usar `ViewTabBar`, cada una
con sus propios bugs. El 2026-07-15 el tamaño del botón volvió a fallar en 22
archivos. Hoy el contrato de apertura/cierre lo exige la categoría
`search-toggle` (`useSearchToggle`) y el buscador de vista vive en `ViewTabBar`
(§24), así que la sección «Search pattern duplication» se retiró.

## Tabla → fichas y áreas seguras (2026-08-07)

La sección decía lo contrario hasta ese día: *«`DataTable` no se convierte en
lista de fichas en viewports angostos»*. Se construyó en v2.480.0 y el documento
no se enteró — un canon desactualizado enseña la deuda.

Lo mismo con las áreas seguras: decía *«no se encontró uso de
`env(safe-area-inset-*)`»*. Antes de los tokens `--sa-*` estaban escritas a mano
en 14 sitios, cada uno con su propia combinación de `max()`.

## §32.7 — mantener presionado (2026-08-08)

Nació de que eliminar un conteo desde su lista no tenía camino en el teléfono.

**El acuse que se retiró.** La primera versión encogía la tarjeta hasta
`scale(.96)`, y el usuario reportó que no decía nada nuevo y que producía un
destello en toda la vista: animar `transform` sobre un elemento con
`backdrop-filter` obliga a re-muestrear el fondo en cada cuadro, y con los blobs
de ambiente detrás se repinta la capa entera.

**La especificidad del filo.** Escrito sólo como
`[data-manteniendo="true"]::after` —(0,1,0)— pierde contra
`[data-surface]:not([data-surface="sheet"])::after` (0,2,0): la animación corre
y `opacity` queda en 0. Medido así antes de corregirlo. Además `filo-corre`
colgaba sólo de `:hover` dentro de `@media (hover: hover)`: en el teléfono el
canto no corría nunca. Medido en WebKit/iPhone 13: `animationName` =
`filo-corre`, duración `0.5s` leída del var, `opacity` del `::after` en 1 durante
la mantenida y 0 en reposo.

**La salida con WAAPI.** Reporte: «se cierra sin animación, sólo desaparece». El
A/B: arrastrando animaba, tocando afuera no. Tocando afuera hay que *sembrar* un
recorte intermedio, y en el Safari de iOS ese apretón «no siempre» alcanza: el
motor junta los dos extremos y salta al final. El emulador de escritorio no ve
este bug (ahí `transitionend` llega completo). El `setTimeout` que desmontaba
pasó a ser un techo: 54 de los 60ms de margen se iban en arrancar la transición.

**`if (!isOpen) return null`.** Medido en `NuevoConteoModal`: desmontaba a los
23ms contra los ~260 de una hoja que sí hace su recorrido. Es la lección de
`ModalShell` v2.238.0.

**La fila suelta.** «No parece card, sólo es texto»: `ListRow` sin contenedor
no pinta fondo ni borde.

## §32.8 — el toque de la ficha (2026-08-20)

Medido sobre las 59 tablas del portal: 16 mal, el 27% — entre ellas Facturas de
compra y las tres tablas de Ventas. Reporte del usuario:

> «cuando abro una card me da información, pero muy reducida, no puedo ver los
> productos, no puedo ver el pdf, no me deja ver nada de eso, lo mismo pasa en
> otros tipos de tablas, como la de productos mismo caso.»

## §32.9 — ficha apilada y acciones por mantenida (2026-08-20)

Reporte sobre Mín·Máx: *«¿cómo obtengo acceso a los botones de acción? los
textos se cortan en la card así que no se entiende»*. La celda de identidad de
Mín·Máx trae foto, nombre, insignias, existencias, velocidad y última venta; en
la mitad izquierda de 390px le quedan ~210, y se midieron 105px recortados por
ficha («SIMILAC 3 (PROSE…»). Mín·Máx tiene cinco acciones por fila y 25 filas.

`apilada` se decidió midiendo en WebKit iPhone 13 los píxeles recortados dentro
de cada ficha (descontando carriles con `overflow-x` y `ellipsis`):

| vista | recortaba | qué se aplicó |
|---|---|---|
| Libro de compras completo ×2 | 161px en 15 de 54 | `apilada` |
| Compras | 77px en 9 de 51 | `apilada` |
| Personal | 42px en 2 de 31 | `apilada` + `acciones: 'mantener'` |
| Productos · Mín·Máx | 105px | `apilada` + `acciones: 'mantener'` |
| Cotizaciones | — | `acciones: 'mantener'` (editar · imprimir · anular) |
| Facturas de compra | — | `acciones: 'mantener'` (ver · las tres descargas) |
| Clientes · Por revisar | — | `acciones: 'mantener'` («Ya lo revisé») |
| Ventas · Productos | — | `acciones: 'mantener'` (ocultar · mostrar) |
| Planilla | — | `acciones: 'mantener'` (imprimir boleta · editar) |

Ventas · Productos tenía su ojo de ocultar como `<button>` a mano y en la hoja
salía sin nombre; se migró a `Button`. Cinco vistas revelaban sus acciones con
`opacity-0 group-hover:opacity-100` y la hoja se abría vacía hasta que la hoja
las forzó visibles.

## Viewport meta (2026-07-15, Bloque 5.7b)

El `maximum-scale=1.0, user-scalable=no` estático bloqueaba el pellizco sin
condición — violación de WCAG 1.4.4 para quien usa el portal como sitio web. Se
resolvió con un script en línea en `index.html` que corre antes de montar React.
