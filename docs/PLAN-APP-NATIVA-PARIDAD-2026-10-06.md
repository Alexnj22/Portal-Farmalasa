# App nativa — paridad con el portal (2026-10-06)

Pedido del usuario: «pasa todas a nativas. aun así, necesito que verifiques que
las vistas nativas ofrezcan las mismas opciones, información, y que se vea
moderno, nativo, con las gráficas que hayan, y mucho mejor».

El plan anterior (`PLAN-APP-NATIVA-RESTANTES-2026-10-05.md`) llevó 60 de 70
rutas a nativo, pero muchas son una versión de CONSULTA: 38 acciones todavía
abren el portal («… (portal)»), y no se comparó pantalla por pantalla que la app
muestre todo lo del portal. El caso que lo destapó fueron las notificaciones:
la tarjeta nativa dibujaba un resumen y el portal todo (corregido en v2.1221.0).

## Fase A — lo que falta pasar a nativo

| ruta | qué es | estado |
|---|---|---|
| `/notificaciones` | historial de avisos (leídos y quitados), con la tarjeta nueva | |
| `/ofertas-clientes` | ofertas de la app de clientes | |
| `/cargar-compra` | revisar la compra armada desde la factura del correo y confirmar el diccionario | |
| `/objetos-huerfanos` | archivos sin dueño en Storage | |
| `/impresion` | ajustes de impresión de esta computadora: en el teléfono, mostrar y probar lo que aplique | |
| `/prueba-ios` | diagnóstico: en la app, un diagnóstico nativo (versión, sesión, push, red) | |
| `/torogoz/*` | la distribuidora: 18 secciones + venta. Fase propia (D) | |

## Fase B — auditoría de paridad de las 60 nativas

Por cada pantalla nativa, contra su vista del portal:
- **información**: cada dato, columna, KPI y estado que el portal muestra;
- **opciones**: filtros, pestañas, búsquedas, ordenamientos y ACCIONES (crear,
  editar, aprobar, exportar…); las 38 que abren el portal entran acá;
- **gráficas**: toda gráfica del portal tiene su equivalente nativo;
- **diseño**: moderno y nativo (vidrio, segmentos, menú de filtros, píldoras,
  hápticos, deslizar, búsqueda en la barra), sin texto cortado ni datos
  amontonados.

Grupos (la auditoría corre en paralelo, una por grupo):
1. Ventas y caja: inicio, ventas-hoy, monitor-ventas, ventas, efectivo/caja, cortes, corte-z, bolsas-sala, bolsas, facturas-sala.
2. Inventario: inventario, productos, minmax-producto, traslados, pedidos, conteos, gestion-stock, ventas-perdidas, inyecciones, bitacoras.
3. Clientes y comercial: clientes, cuentas-por-cobrar, puntos, promociones, cotizaciones, metas, encuestas-clientes, encuestas-aplicar, marketing, galeria.
4. Compras y fiscal: compras, facturas-compra, proveedores, laboratorios, cuentas-por-pagar, facturacion, libros-iva, resumen-fiscal, cierre-periodo, libro-compras-completo.
5. Personas: personal, horarios, vacaciones, monitor, auditoria-de-tiempos, nomina, encuesta, encuesta-admin, cargos, permisos.
6. Sistema y autogestión: solicitudes, gestionar-avisos, mis-documentos, mi-perfil, sesiones, carnes-del-dia, solicitudes-datos, actualizacion-de-datos, mantenimiento, auditoria-del-sistema, sucursales.

## Fase C — cerrar las brechas

Con la lista de la fase B, por prioridad: primero lo que se usa a diario
(caja, traslados, pedidos, solicitudes, inventario), después lo demás.

## Fase D — Torogoz nativo

## Reglas de trabajo
- Lo que se mude de lógica va al núcleo (`src/utils`/`src/data`) y el portal
  pasa a usarlo. **Antes de crear un archivo del núcleo, `ls`: si existe, se
  le agrega una sección, nunca se reescribe** (v2.1219.0 pisó `utils/bitacora.js`).
- Cada pantalla se prueba en el simulador contra el entorno de pruebas; los
  datos de prueba se borran al terminar.
- Escrituras en producción, nunca sin consentimiento.
- Se publica de a una pantalla (o tanda chica), con su prueba.
