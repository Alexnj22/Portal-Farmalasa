# Plan — las pantallas que faltan en la app nativa (2026-10-05)

Pedido del usuario: «sigue hasta terminar, no me preguntes 1 por 1». Este plan
se trabaja de corrido; cada fila se marca al publicarse.

## Cómo se hace cada una (la receta, siempre igual)

1. Leer la vista del portal y su capa de datos. La lógica que se repetiría
   (reglas, rótulos, cálculos) pasa a `src/utils/…` con su prueba, y el portal
   la importa de ahí.
2. Pantalla en `apps/mobile/app/…` con los componentes de la app (Vidrio,
   Segmentos, MenuDeFiltros, Kpi, Seccion/Dato, BotonGrande, Progreso) y la
   búsqueda en la barra nativa.
3. Lo que exige teclado largo, archivos de escritorio o herramientas de
   administración pesada abre **el portal dentro de la app** desde un botón
   rotulado «(portal)» — la pantalla nativa nunca esconde que existe.
4. Verificar en el simulador contra el entorno de pruebas; si no hay datos,
   sembrar con prefijo `QA` y borrar todo al terminar (también archivos y
   permisos temporales). Nunca escribir en producción.
5. `apps/mobile/pantallas.js` + publicar con `publicar.sh`.

## Orden y alcance

| # | ruta | alcance nativo | estado |
|--:|---|---|---|
| 1 | `/inicio` | ya es la pestaña Inicio: sólo el mapa | ✅ |
| 2 | `/mis-avisos` | ya es la pestaña Notificaciones: sólo el mapa | ✅ |
| 3 | `/inyecciones` | lo de la sala: lista, aplicar | ✅ |
| 4 | `/metas` | avance de metas por sala/persona | ✅ |
| 5 | `/cuentas-por-pagar` | lo que se debe, por proveedor y vencimiento | ✅ |
| 6 | `/proveedores` | directorio y ficha | ✅ |
| 7 | `/laboratorios` | directorio y ficha | ✅ |
| 8 | `/sucursales` | directorio y ficha | |
| 9 | `/compras` | lista y detalle | |
| 10 | `/cotizaciones` | lista y detalle | |
| 11 | `/promociones` | las vigentes y su detalle | |
| 12 | `/monitor` | quién está y el estado de las salas | |
| 13 | `/auditoria-de-tiempos` | marcaciones del día y sus observaciones | |
| 14 | `/nomina` | la planilla del período (lectura) | |
| 15 | `/encuesta` | responder el clima organizacional | |
| 16 | `/avisos` | gestionar avisos: lista y publicar | |
| 17 | `/facturacion` | facturas del día y su estado ante Hacienda | |
| 18 | `/libros-iva` | resumen por libro y mes | |
| 19 | `/resumen-fiscal` | el resumen del mes | |
| 20 | `/cierre-periodo` | el estado del cierre | |
| 21 | `/libro-compras-completo` | el libro del mes | |
| 22 | `/cargos` | cargos y organigrama | |
| 23 | `/permisos` | ver permisos por cargo | |
| 24 | `/sesiones` | conexiones activas | |
| 25 | `/carnes-del-dia` | los carnés del día | |
| 26 | `/entrevistas` | lista y ficha | |
| 27 | `/encuesta-admin` | resultados | |
| 28 | `/encuestas-clientes` | resultados | |
| 29 | `/encuestas-aplicar` | aplicar una encuesta a un cliente | |
| 30 | `/marketing` | piezas y calendario | |
| 31 | `/galeria` | la galería | |
| 32 | `/solicitudes-datos` | solicitudes de datos personales | |
| 33 | `/actualizacion-de-datos` | estado de la actualización | |
| 34 | `/mantenimiento` | candados por módulo | |
| 35 | `/auditoria-del-sistema` | el informe | |
| 36 | `/cargar-compra` | portal (captura de escritorio) — decidir al leerla | |
| 37 | `/impresion` | portal: prueba de la ticketera de una computadora | |
| 38 | `/prueba-ios` | portal: herramienta de diagnóstico | |
| 39 | `/objetos-huerfanos` | portal: herramienta de administración | |
