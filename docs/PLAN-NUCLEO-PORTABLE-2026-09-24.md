# Plan — un núcleo que no conoce al navegador (2026-09-24)

**Estado:** F0 hecha · **F1 en curso** (2 de ~6 pasos; 359 → 237).

### Bitácora

- **F0 — `npm run gate:nucleo`** (2026-09-24). Baseline **359 usos en 64
  archivos** (`scripts/nucleo-baseline.json`): 331 de navegador, 11 de
  `import.meta.env`, 17 de pantalla. Son más que los «55 archivos» de la
  medición de abajo porque ésa no contaba los íconos (`lucide-react`,
  `framer-motion`): 9 archivos más, todos reales. Verificado de tres formas:
  (1) cruzado contra el tokenizador de `espree` en los 258 archivos, **0
  diferencias**; (2) una regresión fabricada en `semana.js` —`window`,
  `localStorage`, `import.meta.env` e import de un componente— falla en las
  tres categorías; (3) la misma palabra dentro de un comentario o de un texto
  NO cuenta. La primera versión se desfasaba en las plantillas anidadas de
  `bitacoraPapel.js` y acusaba a un comentario; la segunda contaba `'window'`
  dentro de una cadena. Las dos se corrigieron antes de fijar el baseline.
- **Entorno de pruebas en línea** (2026-09-24): `dev.farmasalud.lat` sigue a la
  rama `sesion/nucleo` y compila con las variables *Preview* de Vercel, que
  apuntan a la base de pruebas (`wqmsadndftaudblohgws`). Verificado leyendo el
  bundle publicado. Cada paso se prueba ahí antes de ir a `main`.
- **F1 paso 1 — v2.1056.1**: `src/plataforma/{almacen,eventos,navegacion}.js`
  y `systemSlice` sin navegador. 359 → 306.
- **F1 paso 2 — v2.1058.1**: `cicloDeVida`, `config`, `dispositivo` y
  `AuthContext` sin navegador (queda su import de `AvisoDeInactividad`, que va
  con F2). 306 → 237. El cierre por inactividad se verificó con
  `tests/e2e/inactividad.spec.js` contra la base de pruebas con el límite en 5
  minutos (el mínimo que acepta `roles_idle_limit_min_check`), y se devolvió a
  720.
- **F1 paso 3 — v2.1060.11**: el reloj de marcación del kiosco.
- **Rutas — v2.1061.3 y v2.1061.4** (salieron al pasar por `routeOptimizer`):
  reordenar una ruta no volvía a medir los tramos, y «Crear ruta» se recargaba
  sin fin. La matemática quedó sin navegador y la tabla de Google en
  `plataforma/mapas.js`. Prueba de punta a punta: `tests/e2e/crear-ruta.spec.js`.
- **Tandas A y B — v2.1061.11 y v2.1061.12**: diecisiete archivos a los
  adaptadores; lo que es propio de la web (`cajaNegra`, push, hooks de UI,
  `ThemeContext`) se muda a `src/plataforma/`.
- **Tanda B2 — v2.1062.2 a v2.1062.5**: descargas por un solo camino (nueve
  eran frágiles, la planilla del banco incluida), una sola forma de achicar
  fotos (eran cuatro), la impresión y el tema a su capa.
- **Tanda C — v2.1064.3**: siete catálogos guardan el ícono por NOMBRE; los
  complementos de `components/common/catalogos/` le vuelven a pegar el
  componente. 440 comparaciones viejo/nuevo idénticas.
- **F1 cerrada — v2.1064.4**: el aviso de inactividad sale de `AuthContext`.
  **`gate:nucleo` en 0.**
- **U1 paso 1 — «hoy» (v2.1073.1)**: `utils/fecha.js`. Eran ~60 sitios, no
  20: 33 usaban UTC y daban mañana después de las 6 pm (fecha de baja y de
  ingreso por defecto, vigencia de permisos, calibraciones, nombres de CSV).
  `gate:hora` vigila el día con cuatro categorías nuevas.
- **U1 paso 2 — mostrar una fecha (v2.1073.2)**: `fechaTexto`/`fechaNumerica`.
  133 fechas y 20 copias. Un día leído con `new Date()` retrocedía: el mes de
  apertura de 5 de 7 sucursales, el vencimiento de lotes. Quedan 47 sobre
  objetos `Date` bajo trinquete (`scripts/fecha-baseline.json`). Sigue:
  calendario (`rangoDelMes`, `correrMes`…) y dinero.
- **U1 paso 3 — calendario (v2.1074.3)**: meses, días y semanas. Las cinco vistas
  de libros repetían cuatro funciones; Facturación contaba un día de menos de
  00:00 a 06:00. `gate:hora` suma `calendario-a-mano`. Sigue: dinero.

## Para qué

El usuario quiere que el portal pueda tener apps que **se sientan nativas**, con
los controles de cada sistema. La conclusión de la conversación que abrió este
plan:

- Reescribir las 233,000 líneas en Swift **y** Kotlin es escribir el portal
  dos veces más y mantener tres copias de cada regla. Este repo ya sabe lo que
  cuesta una regla dicha dos veces (`turnoDelDia` y `turno_del_dia`,
  `distrito.ts` y `bloque.py`).
- El camino elegido es **React Native con Expo**: pinta los controles reales de
  cada sistema (UIKit/SwiftUI, Material/Compose, con `@expo/ui` cuando hace
  falta el componente exacto) y **reutiliza la lógica en JavaScript tal cual**.
  Lo que exige nativo puro (la ticketera por Bluetooth, el escáner, la
  biometría del kiosco) se escribe como módulo Swift/Kotlin.
- La app del teléfono **no es el portal entero**: es lo que se hace de pie en
  la sala (unas 20–30 pantallas). Libros, planilla, MIN·MAX y configuración
  siguen en la web.

Este plan es la preparación: dejar la lógica separada del navegador **antes** de
que exista la app, para que el día que se escriba la app solo haya que hacer
las pantallas. Todo lo de acá **mejora la web por sí solo** (lógica que se
puede probar, vistas que solo pintan) y no cambia nada de lo que ve la gente.

## Lo medido

| capa | archivos | líneas |
|---|---:|---:|
| `src/data` | 87 | 15,184 |
| `src/utils` | 116 | 22,150 |
| `src/store` | 14 | 8,185 |
| `src/hooks` | 30 | 5,052 |
| `src/context` + `src/constants` | 11 | 2,926 |
| **lógica, total** | **258** | **53,497** |
| `src/views` + `src/components` (pantallas) | — | 178,590 |

De los 258 archivos de lógica, **184 ya son puros**: ni navegador ni React. Se
llevan a otra plataforma sin tocarlos.

### A. La lógica que toca el navegador: 55 archivos

Contando **uso real** (sin comentarios): `window`, `document`,
`localStorage`/`sessionStorage`, `import.meta.env`, `navigator`, o importar de
`react-router`/`components/`. Los que más pesan:

| archivo | usos | qué toca |
|---|---:|---|
| `context/AuthContext.jsx` | 76 | almacenamiento (47), `window`, `document`, env |
| `store/slices/systemSlice.js` | 53 | almacenamiento (36), `window` (17) |
| `utils/cajaNegra.js` | 49 | todo: es el registro de errores del navegador |
| `hooks/useTimeClockEngine.js` | 20 | `window` (timers, visibilidad) |
| `utils/routeOptimizer.js` | 17 | Google Maps por `window` + env |
| `hooks/usePushSubscription.js` | 13 | Web Push (`navigator.serviceWorker`) |
| `utils/ticketPrint.js` | 9 | ventana de impresión + ajustes locales |
| `plataforma/useAnclaje.js`, `plataforma/ThemeContext.jsx` | 9 c/u | `window`/`document` |
| 46 archivos más | 1–8 | la mayoría, almacenamiento o `document` para un PDF/foto |

Por tipo, lo que hay detrás son **cinco adaptadores**, no 55 arreglos:

| adaptador | qué reemplaza | en la web | en el teléfono |
|---|---|---|---|
| **almacenamiento** | `localStorage`/`sessionStorage` (22 archivos) | igual que hoy | SecureStore / MMKV |
| **configuración** | `import.meta.env` (5 archivos) | Vite | `expo-constants` |
| **cliente de Supabase** | `supabaseClient.js` como singleton que lee env y guarda en `localStorage` (lo importan **96** archivos) | fábrica que recibe los dos de arriba | la misma fábrica |
| **ciclo de vida** | `document.visibilitychange`, `window` focus/online (los hooks de refresco, el kiosco) | `document`/`window` | `AppState`/`NetInfo` |
| **periféricos** | impresión, cámara/foto, GPS, push | lo de hoy + Capacitor | módulos nativos |

### B. Dependencias al revés: la lógica importa pantallas

| archivo | importa |
|---|---|
| `components/cortes/useResolverCorte.jsx` | `components/cortes/CerrarElDiaAhora`, `EntregaDeCaja` |
| `plataforma/usePaginaEnUrl.js` | `components/common/TablePagination` |
| `plataforma/useMontadoParaSalida.js` | `components/common/gotaApertura` |
| `context/AuthContext.jsx` | `components/common/AvisoDeInactividad` |

Y **13 archivos de lógica importan íconos o animación** (`lucide-react`,
`framer-motion`): `constants/moduleMap.js`, `constants/permissionModules.js`,
`constants/tipoIconos.js`, `data/constants.js`, `utils/semana.js`,
`utils/scheduleHelpers.js`, `utils/notificacionTexto.js`, entre otros. La
corrección es que la lógica diga **el nombre** del ícono y la pantalla lo
resuelva (ya existe `components/common/iconNames.js` para eso).

### C. Lógica escondida dentro de las pantallas

**25 archivos `.js` dentro de `views/` y `components/`, 6,909 líneas.** No son
pantallas, son lógica que quedó cerca de su vista:

| archivo | líneas |
|---|---:|
| `views/pedidos/tabpedidos/usePedidosData.js` | 2,020 |
| `views/productos/tabminmax/useMinMaxData.js` | 1,391 |
| `components/common/gotaApertura.js` | 590 |
| `views/contabilidad/libroIva.js` | 393 |
| `views/solicitudes/movimientoTexto.js` | 386 |
| `views/pedidos/tabpedidos/helpers.js` | 318 |
| `views/promociones/promocionesUtils.js` | 248 |
| 18 más | 27–206 |

Y **58 consultas a Supabase escritas directo en 26 pantallas**. Las más
cargadas: `VentasView.jsx` (15), `usePedidosData.js` (13), `useMinMaxData.js`
(11), `ExpandedPanel.jsx`, `RecepcionModal.jsx` (4 c/u). Las otras 718
consultas ya viven en `src/data`, que es donde tienen que estar.

### D. Reglas: quién decide

Es la parte que no es mecánica y que **necesita decisiones del usuario**. Con
dos clientes (web y teléfono), cada regla que vive sólo en el navegador es una
regla que se puede escribir dos veces distinto.

**D1 — con gemelo en la base (el servidor ya decide o revalida).** En el
teléfono se reutiliza el JavaScript para mostrar; el servidor sigue siendo el
juez. Bien como está:

- `turnoDelDia.js` ↔ `turno_del_dia` (55 casos enfrentados)
- `estadoDePersona.js` ↔ `get_estados_de_personas`
- `clienteValidacion.js` ↔ `update_customer_fiscal` / `es_dui_valido` (el
  cliente adelanta el formato; el servidor rechaza)
- `bolsasReparto.js` (el servidor revalida la suma)
- `minmaxSolicitud.js` ↔ `minmax_eff_max`
- `dteIva.js` (la misma regla que el sync, portada)

**D2 — sólo en el navegador, y deciden algo que importa.** Candidatas a
revisar una por una: ¿el servidor la revalida o confía en lo que llega?

| archivo | qué decide | líneas |
|---|---|---:|
| `utils/cortesDiagnostico.js` | `contraste`, tramos, `estadoDelDia`, sugerencias: el juez que leen **los 8 lectores de un corte**. En la base existe `corte_diferencia` para los frenos: hay que confirmar que las dos dicen lo mismo | 1,386 |
| `utils/timeClock.rules.js` + `.helpers.js` | qué marca toca, tardanza, en el kiosco | 598 |
| `views/asistencia/quincena.js` | los bordes del período que se paga | 88 |
| `views/contabilidad/libroIva.js` | las columnas del anexo que se presenta a Hacienda | 393 |
| `utils/cajasEspeciales.js` | cuántas cajas especiales tiene un despacho | 188 |
| `utils/avisosDeOperacion.js` + `notifyBranch` | los avisos de pedido **los escribe el navegador**, no la base (21 usos) | 508 |

Si el teléfono va a hacer cortes o marcaciones, **`cortesDiagnostico` y
`timeClock.rules` van en el núcleo compartido sí o sí**: son exactamente el tipo
de regla que, escrita dos veces, da dos números sobre la misma persona
([[feedback_la_misma_pregunta_respondida_cuatro_veces_da_cuatro_respuestas]]).

**D3 — obligaciones que cada cliente tiene que acordarse de cumplir.**

| obligación | usos | en |
|---|---:|---|
| `appendAuditLog` (bitácora de cada acción) | 322 | 87 archivos |
| `registrarEgreso` (toda salida de datos) | 23 | 12 archivos |
| `notifyBranch` (avisos de pedido) | 21 | 7 archivos |
| `functions.invoke` (edge functions) | 61 | 32 archivos |

La bitácora es la importante: hoy **la escribe el navegador**, y una pantalla
nativa que se olvide de llamarla deja una acción sin rastro, sin ningún error.
Hay dos salidas y es una decisión del usuario:
1. **Dejarla en el cliente**, pero dentro de las funciones de `src/data` que
   escriben (así la pantalla nativa la hereda al llamar a la misma función).
2. **Llevarla a la base** (trigger o dentro de la RPC), donde ningún cliente la
   puede olvidar. Es lo más sólido y lo más caro.

### E. Lo mismo escrito muchas veces (medido el mismo día, a pedido del usuario)

**E1 — funciones utilitarias copiadas en cada pantalla.** Mismo nombre y
mismo trabajo, en archivos distintos:

| familia | copias | ejemplos |
|---|---:|---|
| mostrar una fecha | 44 | `fmtFecha` (16), `fmtDate` (14), `fechaCorta`, `fechaLarga`, `formatDate` |
| «hoy en El Salvador» | 20 | `hoySV` (9), `hoyISO`, `svToday`, `svNow` |
| calendario | 24 | `rangoDelMes`, `mesActual`, `correrMes`, `correrDia`, `etiquetaMes` |
| días transcurridos | 14 | `diasDesde`, `diasHasta`, `haceCuanto` |
| montos y porcentajes | ~20 | `fmtMoney`, `fmtPct`, `pct` + dinero armado a mano en 14 archivos |
| cargar pdfmake | 5 | `getPdfMake` |
| texto | 12 | `sinTildes`, `soloDigitos`, `safeParse` |
| piezas de pantalla | 16 | `Dato` (7), `Cargando` (5), `Cifra` (4) |

**No hay un canónico de fechas**: `utils/` tiene `hora.js` y no tiene
`fecha.js`. `hoySV` está en 9 archivos: ocho restan 6 horas a mano y uno usa
la zona `America/El_Salvador`. Hoy dan lo mismo (El Salvador no cambia de
hora); el día que se corrija una copia, las otras ocho no se enteran.

**E2 — «qué es una venta» se contesta TRES veces en la base.** Las consultas
de ventas del navegador están bien centralizadas (todas en `src/data`, 7
archivos). La repetición está en la base: **~50 funciones leen
`sales_invoices`**, y cada una escribe su propio filtro de qué factura cuenta:

| criterio escrito | funciones | quiénes |
|---|---:|---|
| `estado NOT IN ('NULA','DTE INVALIDADO EN MH')` | ~33 | metas y bonos, estadísticas de Ventas, MIN·MAX, promociones, vendedores, los agregados (`refresh_sales_daily_stats`, `refresh_product_sales_*`) |
| `estado = 'FINALIZADA'` | 5 | caja (`caja_estado`, `caja_efectivo_piezas`), formas de pago, fuera del libro, actividad de clientes |
| `estado = 'FINALIZADA' AND length(recibido_mh) = 40` | 8 | libros de IVA, cortes Z, período fiscal, `resumen_ventas_diario` |
| además excluye `'ANULADA'` (un valor que no existe en la tabla) | 1 | `get_inyecciones_aplicadas` |

Medido sobre toda la tabla: hoy existen **sólo tres estados** (`FINALIZADA`
374,276 · `DTE INVALIDADO EN MH` 1,060 · `NULA` 9). Así que **las dos primeras
formas dan el mismo número hoy**, y no hay ningún total mal en pantalla. Pero
son dos reglas distintas que coinciden por casualidad: el día que el origen
mande un estado nuevo (una contingencia, una anulación con otro nombre), ~33
funciones lo van a contar como venta y otras 5 no. Nadie va a ver un error, van
a ver **metas y caja con totales distintos sobre el mismo día**.

La tercera forma sí es una diferencia legítima: una venta **fiscal** exige
sello (hoy hay 5 facturas finalizadas sin sello en 2026, $45.80). El problema
no es que existan dos definiciones, es que **no tienen nombre** y cada función
la reescribe.

**La salida:** dos definiciones con nombre, escritas una vez en la base.
- `venta_valida(estado)` → la operativa (lo que se vendió)
- `venta_fiscal(estado, recibido_mh)` → la que entra al libro

Se pueden hacer como funciones `IMMUTABLE` de SQL (se inlinean y no cambian el
plan de ninguna consulta) o como una vista `ventas_validas` con
`security_invoker`. Las ~46 funciones pasan a usarlas **de a una familia por
vez**, midiendo que cada total dé lo mismo antes y después, y con un gate que
falle si una función nueva escribe el filtro a mano. Es trabajo en la base: se
prueba en el branch de pruebas con `execute_sql`, y cada `CREATE OR REPLACE`
de una función caliente se aplica con `lock_timeout` según la regla del repo.

**E3 — totales sumados en el navegador: 28 archivos** hacen un `reduce` sobre
`total`/`monto`. La mayoría suma una lista que ya trajo (el pie de una tabla) y
está bien. Los que valen la pena mirar son los que calculan un total **que
también existe en la base**: `DashboardView`, `VentasView`, `metas/TabTablero`,
`MiCajaView`. Si el navegador suma una cosa y la base otra, dos pantallas
muestran dos cifras distintas. Queda para revisar uno por uno en F3.

### F. Áreas auditadas

Los archivos a tocar caen en **24 áreas**; `plataforma` concentra 38 de ellos.
**Hoy no hay ningún área congelada** (todas entre 92 y 95%, ninguna con sello
de sala), así que empezar no exige desbloquear nada. Si alguna se sella
mientras tanto, se pregunta antes de tocarla.

## Las fases, en orden

Cada fase se cierra y se commitea sola. Ninguna cambia lo que se ve.

| fase | qué | tamaño | por qué en este orden |
|---|---|---|---|
| **F0** | **`gate:nucleo`**: falla si la lógica gana un uso de navegador nuevo. Baseline = los 55 de hoy, **sólo baja** | chico | sin esto, cada semana aparecen archivos nuevos que habrá que volver a limpiar |
| **F1** | los **cinco adaptadores**, como módulos con variante por plataforma (`almacen.js` para la web y `almacen.native.js` para el teléfono: Metro elige solo por la extensión, así que los 96 archivos que importan `supabaseClient` no cambian); `supabaseClient` pasa a fábrica. Empezar por `AuthContext` y `systemSlice` (129 usos entre los dos) | mediano | es lo que más reduce la cuenta del gate |
| **F2** | dependencias al revés (4 archivos) e íconos por nombre (13 archivos) | chico | desbloquea mover carpetas enteras después |
| **U1** | **canónicos que faltan** (`utils/fecha.js`, dinero en `formatNumber.js`, un cargador de pdfmake), con pruebas unitarias, y reemplazar las copias de §E1 de a una familia por vez. Gate que prohíba volver a definir una copia local | mediano | es lo más visible de unificar, y todo va al núcleo |
| **U2** | **`venta_valida` / `venta_fiscal` en la base** y migrar las ~46 funciones de §E2, midiendo cada total antes y después | mediano, en la base | es la regla más usada del portal y hoy tiene tres redacciones |
| **F3** | sacar de las pantallas las 58 consultas y los 25 archivos de lógica; `usePedidosData` y `useMinMaxData` pasan a hooks del núcleo | grande | cada pantalla nativa va a necesitar exactamente esos hooks |
| **F4** | las reglas de D2 y la decisión de D3: **con el usuario, regla por regla** | por decidir | no es mecánico: puede mover lógica a la base |
| **F5** | tipos: `// @ts-check` + `tsc --checkJs` en el núcleo y `supabase gen types` como contrato | mediano | más barato que renombrar a `.ts`; si una columna cambia, el teléfono no compila en vez de mostrar un cero |
| **F6** | los tokens de `DESIGN.md` (colores, espacios, radios) exportados a JSON | chico | la app usa los mismos colores con los controles de cada sistema |
| **F7** | mover el núcleo a `packages/core` (monorepo con workspaces) | mediano, mecánico | al final: reescribe imports en ~187 pantallas, y conviene hacerlo con el núcleo ya limpio |
| **F8** | `apps/mobile` con Expo y **un solo flujo** piloto (marcación o conteo) en TestFlight y Play interno | grande | recién acá existe la app |

**Cómo se trabaja:** F1, F3 y F7 van en un **worktree propio**
(`npm run worktree -- nucleo`), porque mueven muchos archivos y hay otras
sesiones en el árbol. Y cada fase se cierra con los gates de siempre más el
barrido de las rutas que tocó: mover lógica de lugar sin cambiarla es
justamente lo que rompe en silencio (un import que apunta al archivo viejo, un
`const` leído antes de declararse → `gate:tdz`).

## Lo que queda por decidir (del usuario)

1. **D3:** ¿la bitácora queda en el cliente dentro de `src/data`, o se lleva a
   la base?
2. **D2:** para cada una de las seis, ¿se queda como JavaScript compartido o se
   pasa a una función de la base?
3. **F8:** ¿qué flujo es el piloto? Para decidirlo con datos se puede medir qué
   vistas abren los cargos de sala desde el teléfono.
