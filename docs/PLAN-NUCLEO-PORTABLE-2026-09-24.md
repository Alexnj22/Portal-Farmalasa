# Plan — un núcleo que no conoce al navegador (2026-09-24)

**Estado:** F0 a F6, U1 y U2 **cerradas** · F7 paso 1 hecho (paso 2 pospuesto) · **F8 en curso**: la app entra y abre las 58 pantallas (mixta); Bitácoras y Pedir a otra sala ya son nativas; siguen efectivo y pedidos.

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
- **U1 paso 4 — dinero (v2.1075.1)**: `formato-cifra` ahora ve cualquier `$${…}`
  que no sea `formatMoney` (el salario de la ficha salía crudo). **U1
  cerrada.** La boleta y la planilla impresas pasaron también a llevar
  separador de miles (v2.1075.2, pedido del usuario); el archivo del banco no.
- **U2 — una sola definición de venta en la base (2026-09-26)**. Decisión del
  usuario: un estado desconocido NO cuenta, y se le avisa. Tres migraciones:
  `venta_valida`/`venta_fiscal` + el vigilante horario (150011); 59 funciones
  reescritas desde su definición viva con 80 reemplazos, abortando si el
  conteo no daba (150848); y dos que quedaron —una porque otra sesión reaplicó
  su copia 38 s después— (151127). Verificado: las 59 definiciones idénticas
  byte por byte a las generadas fuera, cada una reversible a la original; 43
  resultados medidos como la cuenta de QA y el servidor, y cada diferencia
  comparada con la versión vieja lado a lado sobre los mismos datos: idénticas
  (las diferencias venían de ventas nuevas). Quedan fuera, a propósito, las 4
  del circuito de Hacienda. `migration-gate` rechaza el filtro a mano en el
  pre-commit.
- **F3 — las pantallas dejan de ser el núcleo (2026-09-26, v2.1075.26 a .33)**.
  `gate:consultas` nuevo y en **0**: ninguna pantalla le habla directo a la
  base (58 consultas a `src/data`). `usePedidosData` y `useMinMaxData` a
  `src/hooks/`, sin navegador: el rastreo GPS, que estaba escrito dos veces,
  pasa a `plataforma/ubicacion.js`, y el scroll del panel a la pantalla. La
  lógica pura de seis pantallas a `src/utils/` (libro de IVA, textos de
  movimientos y traslados, promociones, metas, quincena). Los catálogos que
  traían el ícono adentro se parten: el núcleo tiene claves, textos, estados y
  permisos con el ícono por NOMBRE, y la pantalla pone ícono y color (motivos de
  pausa, estados de MIN·MAX, etapas de bolsas, familias de solicitud). De paso,
  **el mapa de salas estaba copiado siete veces**; hoy todas leen
  `constants/erp.js`. Lo que queda en `views/`/`components/` como `.js` es
  mecánica de pantalla (animación de diálogos, hojas, gestos) o estilo, y se
  queda ahí a propósito.
- **F4 — las reglas y la bitácora (2026-09-28, v2.1075.36 a v2.1077.0)**. D2:
  cinco reglas quedan en JavaScript compartido y el diagnóstico de cortes se
  enfrenta a su gemelo de la base en `gate:cortes`; los avisos de pedido pasan a
  la base (`20260928153240`). D3 «la mezcla»: la base anota sola el dinero y lo
  fiscal (`bitacora_de_dinero`, 13 tablas) y la entrada legible sale de
  `src/data` en todos los módulos.
- **F5 — la base como contrato (2026-09-28)**. `src/types/database.ts` (tipos
  de producción, `npm run tipos:base`), el cliente de Supabase declarado con
  ellos y `tsc --checkJs` sobre el núcleo (`tsconfig.nucleo.json`). Lo vigila
  `npm run gate:tipos`: trinquete por archivo (530 avisos de forma en 84
  archivos al arrancar, sólo bajan) y `--remoto` compara los tipos con
  producción. Fabricadas las dos regresiones: una columna mal escrita suma un
  aviso en su línea y un parámetro de `.rpc()` mal escrito lo nombra. El primer
  día cazó un defecto real: la bitácora de cotizaciones leía `cliente_nombre`,
  que no existe (es `customer_name`), y el cliente salía vacío desde siempre.
- **F6 — los tokens del diseño en JSON (2026-09-28)**. `src/constants/tokens.json`
  sale de `src/index.css` con `npm run tokens:exportar` y NO se edita a mano:
  los cuatro temas (`liquid`, `dark`, `solid`, `solid-dark`; 286–297 tokens
  cada uno, compuestos en el orden del documento como los compone el
  navegador y con los `var()` resueltos) y cuatro variantes (`compacto`,
  `ultra`, `tactil`, `telefono`) con sólo lo que cada consulta de medios pisa.
  En el teléfono aplica `tactil` (blanco de dedo 44px). Lo que no se resuelve
  fuera de un navegador (`env()`, `color-mix()`) sale como texto. Lo vigila
  `npm run gate:tokens`, también en el pre-commit: falla si el JSON no es el
  que sale del CSS, si un token apunta a una variable que no existe, y si
  aparece una consulta de medios que el export no conoce. Cazó un defecto real
  el primer día: desde v2.139.0 `--chart-8` y `--chart-8-text` (el neutro)
  apuntaban a `--content-3`/`--content-2`, que sólo existen como
  `--color-content-*` del puente de Tailwind — en los cuatro temas el valor era
  inválido y los fondos `chart-8/…` salían transparentes. Corregido a
  `--text-tertiary`/`--text-secondary`, que es lo que el cambio original quiso
  decir.
- **F7 paso 1 — las importaciones por alias (2026-09-28)**. Todo lo que cruza
  el borde del núcleo va por `@nucleo/…` (desde las pantallas y las pruebas) o
  `@plataforma/…` (desde el núcleo hacia los adaptadores, que pone cada app).
  1,939 importaciones en 526 archivos, reescritas por
  `scripts/nucleo-alias.mjs --escribir`; los alias viven en `vite.config.js` y
  `tsconfig.nucleo.json`. **La compilación salió idéntica byte a byte** a la de
  antes (464 archivos), 2,903 pruebas en verde y los gates igual. Se le fabricó
  una consulta a una pantalla importada por alias y `gate:consultas` la cazó.
  `routeImporters.js` salió de `constants/` a `src/`: son las rutas de las
  pantallas web, no núcleo, y era lo único del núcleo que importaba pantallas
  (71 importaciones). `npm run gate:alias`, también en el pre-commit, falla si
  una importación nueva cruza el borde por ruta relativa. **Paso 2**: mudar las
  carpetas a `packages/core` y apuntar `@nucleo` ahí — ya no toca pantallas.
  **Pospuesto por decisión del usuario** (2026-09-28): se muda cuando ninguna
  otra sesión esté usando esos archivos. La app no lo necesita: Metro resuelve
  `@nucleo` a `src/`.
- **F8 paso 1 — la app arranca con el núcleo del portal (2026-09-28)**.
  `apps/mobile`, Expo 57 con expo-router. Metro lee el núcleo de `src/` sin
  copiarlo (55 archivos del portal en el paquete, una sola copia de React
  —verificado en el mapa de fuentes—). Doce adaptadores en
  `apps/mobile/plataforma/` con los nombres de los de la web; lo que todavía no
  existe en el teléfono (descargas, fotos) LANZA en vez de devolver un vacío.
  `supabaseClient.js` ahora toma URL, llave y almacén de la sesión de
  `@plataforma/config`, así es el mismo archivo en las dos apps. Pantallas:
  entrada (con el cambio obligatorio de contraseña, cuyas reglas se unificaron
  en `utils/contrasena.js`: estaban copiadas en la entrada y en Personal con
  textos distintos) e inicio con los módulos que el cargo puede ver, sacados de
  `MODULE_MAP` + `hasPermission`. Probado con la cuenta de pruebas en un iPhone
  13 simulado (web de Expo): entra y lista **58 módulos**, sin errores en
  consola. Compila también para Android. **Falta**: probarla en un teléfono de
  verdad, y las pantallas — hoy las 58 dicen «pronto».
- **F8 paso 2 — estrategia MIXTA, todas abren desde hoy (2026-09-28)**.
  Decisión del usuario, con la interfaz medida en ~175,000 líneas: las
  pantallas que todavía no son nativas se abren como **el portal dentro de la
  app, con la misma sesión** (`componentes/PortalIncrustado.js`), y las nativas
  las van reemplazando una por una (`apps/mobile/pantallas.js`). Tres piezas:
  1. **La sesión se presta, no se vuelve a pedir**: el script de entrada copia
     las tres claves que escribe el mismo `AuthContext` (sesión de auth-js,
     `sb_user`, `sb_last_activity_at`) al almacenamiento del portal.
  2. **Un solo renovador a la vez**: si la app y el portal renuevan el MISMO
     token de refresco, Supabase detecta el reuso y cierra la sesión de los
     dos. Mientras el portal está abierto la app deja de renovar
     (`stopAutoRefresh`) y adopta cada token que el portal renueva
     (`postMessage` → `setSession`); si el portal cierra sesión, la app
     también.
  3. **Una sola barra**: con `data-en-la-app` en el `<html>` el portal esconde
     su encabezado y sus pestañas móviles (final de `index.css`); lo marcan el
     script de la app y, por si el WebView arma el documento después,
     `main.jsx`.
  Probado en un **emulador de Android** (Pixel 7, Android 15, Expo Go) contra
  la base de pruebas y el portal local: entra, lista 58 módulos y abre
  «Solicitudes de sucursal» del portal sin volver a pedir usuario, con una sola
  barra. En producción el portal es `portal.farmasalud.lat`
  (`EXPO_PUBLIC_PORTAL_URL`); `dev.farmasalud.lat` NO sirve para esto porque
  está detrás del inicio de sesión de Vercel. **Falta**: probar la renovación
  del token con una sesión de más de una hora, un teléfono físico, y empezar
  las pantallas nativas por las más usadas en sala.
- **F8 paso 3 — Bitácoras, la primera pantalla nativa (2026-09-28)**. El orden
  sale del uso: en 30 días, bitácoras la usaron 34 personas (~2,000 registros),
  traslados 36, efectivo 34 y pedidos 23. La pestaña «Registro diario» es
  nativa con la misma información que la versión de teléfono del portal (las
  cuatro cifras, un bloque por momento, las áreas en pausa, la ronda); las
  otras tres pestañas abren el portal en esa pestaña. **Antes de dibujarla se
  sacó la lógica de las pantallas web al núcleo** —`utils/rondaDeBitacora.js`:
  momentos del día, resumen por momento, agrupar la ronda, armar el envío,
  frenar la lectura fuera de rango sin acción, los muebles de la limpieza—, y
  `TabHoy`, `PasarLaRonda`, `PuntosDeLimpieza` y `BitacorasView` la usan: la
  web y la app mandan lo mismo por construcción (10 pruebas). Probado en el
  emulador contra la base de pruebas: una ronda con 26 °C, 32 °C (frenada hasta
  escribir la acción) y una limpieza entró con la acción guardada, y la
  pantalla web de la misma sala muestra lo mismo. Dos hallazgos: «atrás» en
  Android cerraba la ronda y tiraba lo escrito (ahora pregunta), y la sala
  propia se escribía `user.branchId ?? user.branch_id` en ~60 sitios — la app
  la escribió con una sola y salió vacía; hoy hay `utils/salaDelUsuario.js`,
  usado en Bitácoras y la app. **Pendiente**: pasar las otras ~58 copias al
  canónico.
- **F8 — probada en iOS (2026-09-28)**. Simulador iPhone 18 Pro, iOS 27, con
  Expo Go y el mismo código: entrada (el sistema ofrece guardar la contraseña
  en su llavero), Bitácoras con la barra y el gesto de volver propios de iOS,
  la ronda como hoja nativa (bajarla con algo escrito pregunta), y el portal
  incrustado con la sesión prestada. Salió un defecto que Android también
  tenía: «Salir» dejaba un Inicio vacío — la app no tenía guardia de sesión
  como la web; hoy la tiene la raíz (`GuardiaDeSesion`).
- **F8 paso 4 — Pedir a otra sala, nativo (2026-09-29)**. Es la acción de sala
  más frecuente (932 en 30 días, 36 personas). **Antes de dibujarla se sacó al
  núcleo todo lo que hacía `PedirTrasladoModal` salvo dibujar**: el hook
  `hooks/usePedirTraslado.js` (salas, lotes por estante, presentaciones,
  receta, aviso de vencimiento, reparto, composición de varias salas, envío),
  `utils/pedirTraslado.js` (clave de origen y `avisosDelPedido`, los textos de
  cada aviso) y `utils/consultaInventario.js` (el buscador resumido por
  producto). El modal web quedó en la forma (1,270 → 625 líneas). Verificado:
  el mismo pedido hecho desde la web y desde el iPhone (simulador) contra la
  base de pruebas quedó con los MISMOS campos, lote y bitácora, y el duplicado
  lo frena con su mensaje. En la app, Traslados abre nativo con «Pedir a otra
  sala»; sus cuatro pestañas siguen como el portal. De paso: en iPhone el
  teclado tapaba el campo que se escribía — hoy el formulario se corre solo.

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
| `views/contabilidad/libroIva.js` (→ `utils/`, F3) | 393 |
| `views/solicitudes/movimientoTexto.js` (→ `utils/`, F3) | 386 |
| `views/pedidos/tabpedidos/helpers.js` | 318 |
| `views/promociones/promocionesUtils.js` (→ `utils/`, F3) | 248 |
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
| `views/asistencia/quincena.js` (→ `utils/`, F3) | los bordes del período que se paga | 88 |
| `views/contabilidad/libroIva.js` (→ `utils/`, F3) | las columnas del anexo que se presenta a Hacienda | 393 |
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

*(nada pendiente de decidir por ahora)*

### Decidido (2026-09-28)

- **D2:** cinco de las seis se quedan como JavaScript compartido en el núcleo
  (diagnóstico de cortes, reloj del kiosco, quincena, libro de IVA, cajas
  especiales). El diagnóstico de cortes tiene gemelo en la base
  (`corte_diferencia`) y desde ese día `npm run gate:cortes` los enfrenta en
  cada corrida (sección F; iguales en 1,162 cortes, y una regresión fabricada
  de un centavo la caza). **Los avisos de pedido a las salas pasan a la base**,
  donde ninguna app puede olvidarlos — **hecho** en `20260928153240` (v2.1075.37):
  los 15 envíos del navegador son hoy tres disparadores y una RPC, probados en
  pruebas con un pedido completo (11 avisos, 0 fallos) y con definiciones
  idénticas byte a byte a las de producción.
- **D3 — la mezcla.** La entrada legible de la bitácora la escribe la función
  de `src/data` que guarda (así la app del teléfono la hereda), y en dinero y lo
  fiscal la base anota además por su cuenta. La mitad de la base está hecha:
  `bitacora_de_dinero` en 13 tablas (`20260928155410`, v2.1076.2); cortes y
  bolsas ya tenían su historial. **Cerrada** en v2.1077.0: la entrada legible
  sale de `src/data` en todos los módulos; quedan 24 en pantallas a propósito
  (abrir, exportar, imprimir, un error de pantalla) y las de los stores, que
  ya son lógica compartida.
- **F8:** no hay piloto de un solo flujo. Palabras del usuario: *«abrirán todas.
  Así que debe estar toda la info. No sé si necesariamente igual, pero debe
  estar todo.»* La app del teléfono tiene que cubrir todas las pantallas; la
  forma puede ser otra, el contenido no.
