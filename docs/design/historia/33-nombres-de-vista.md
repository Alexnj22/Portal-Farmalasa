# Historia — §33 Cómo se llama una vista

Narrativas que sostienen las reglas de `DESIGN.md` §33.

## Un nombre por pantalla (2026-08-12, antes §26.10)

El nombre de un módulo vivía en cinco registros y nada los cruzaba (`title=` de
la vista, `moduleMap.js`, `permissionModules.js`, los grupos del menú y
`ROUTE_TITLES`). Medido antes de unificarlos: 13 rutas se llamaban distinto
según el registro, y tres decían el nombre de OTRA pantalla — `/dashboard`
decía «Dashboard» (y era el listado de personal), `/payroll` decía «Planilla»
con el menú diciendo «Nómina», y `/monitor` decía «Asistencia», que es un grupo
del menú.

## Las direcciones que mentían (2026-08-26)

Reporte del usuario, mirando la barra de direcciones: *«¿por qué dice dashboard
si es empleados? el inicio no debería ser dashboard?»*. `/dashboard` abría el
listado de empleados y `/overview` el tablero. Arriba de `ROUTE_TITLES` había un
comentario que decía *«el path es legado: la ruta es el listado»* — una nota al
margen no falla ni avisa. El encabezado («Gestión de personal») decía lo
correcto todo el tiempo: el nombre viejo sobrevivía en el único lugar que nadie
revisaba y que el usuario sí mira.

Al medir la regla de la pestaña aparecieron dos más: `/vacation-plan` decía
«Plan de vacaciones» sobre «Plan anual de vacaciones», y `/compras` decía
«Compras» sobre «Compras (Bodega)». Faltaban 19 títulos el día que se escribió
`ROUTE_TITLES`, y volvió a faltar uno (`/carnes-del-dia`) en cuanto se agregó una
vista.

## Las redirecciones se midieron

`/dashboard` y `/overview` no los nombraba ninguna notificación (0 de 4,428),
pero `/requests` lo nombraban 3,064 — la ruta más enlazada. Tres notificaciones
apuntan a `/home`, que no existió nunca.

## Las 17 rutas renombradas (más `/dashboard` e `/overview`)

`HEREDADAS` nació con 18 rutas en inglés y quedó vacía el mismo día: el usuario
mandó arreglarlas todas («corrige los que ya están mal»).

| era | es |
|---|---|
| `/announcements` | `/avisos` |
| `/audit` | `/auditoria-de-tiempos` |
| `/auditview` | `/auditoria-del-sistema` |
| `/branches` | `/sucursales` |
| `/ios-test` | `/prueba-ios` |
| `/my-announcements` | `/mis-avisos` |
| `/my-documents` | `/mis-documentos` |
| `/orphan-objects` | `/objetos-huerfanos` |
| `/payroll` | `/nomina` |
| `/permissions` | `/permisos` |
| `/profile` | `/mi-perfil` |
| `/requests` | `/solicitudes` |
| `/requests-personales` | `/solicitudes-personales` |
| `/roles` | `/cargos` |
| `/schedules` | `/horarios` |
| `/sync-health` | `/actualizacion-de-datos` |
| `/vacation-plan` | `/vacaciones` |

`/monitor` se quedó: «monitor» es palabra española y la vista se llama «Monitor
en tiempo real».

## El encabezado que no habla como su pantalla

*«¿por qué si my-announcements dice mis avisos, announcement dice
comunicaciones?»*. La ruta se había derivado bien; el encabezado estaba mal:

| vista | dice adentro | decía su encabezado |
|---|---|---|
| `AnnouncementsView` | aviso ×34 · comunicación ×1 | «Centro de comunicaciones» |
| `RolesView` | cargo ×22 · organigrama ×11 · jerarquía ×1 | «Jerarquía institucional» |

Contar la palabra del encabezado dentro del archivo se probó y es ruido: acusó a
`AttendanceAuditView`, `OrphanObjectsView` y `EmployeeProfileView`, que están
bien — cuatro falsos positivos sobre cuatro hallazgos. El espejo menú ↔
encabezado se midió sobre las 54 vistas: sólo `/personal` no comparte palabra, y
es legítimo.

## El mapa de precarga

Al renombrar las 19 rutas, `IMPORTADOR_POR_RUTA` quedó viejo entero, y su
comentario decía que era «GENERADO leyendo las `<Route>` de App.jsx» — no hay
generador. Además `/personal` y `/sucursales` no estuvieron nunca (no se
precargaron jamás) y `cortes` figuraba como `cortes_caja`, la clave del módulo.

## La primera corrida del gate

Dos de tres hallazgos eran del detector: acusó a `/conteo-inventario/:id` de no
tener título (una ficha de detalle no lo tiene, a propósito) y leyó como
encabezado de `/encuesta` el tooltip de la flecha de volver. Sólo `/branches` era
real. Los falsos positivos están fabricados en `tests/unit/rutasGate.test.js`
junto con las cinco regresiones que el gate tiene que cazar.
