# Plan — un núcleo que no conoce al navegador (2026-09-24)

**Estado:** F0, F1, F2, U1, U2 y **F3 cerradas** · sigue **F4** (reglas de D2 y D3, con el usuario).

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
