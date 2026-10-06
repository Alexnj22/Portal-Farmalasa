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
| `/notificaciones` | historial de avisos (leídos y quitados), con la tarjeta nueva | ✅ v2.1225 |
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

## Resultado de la auditoría (2026-10-06)

Hecha leyendo el código de las dos puntas, seis grupos en paralelo. Ninguna
pantalla del grupo Compras/fiscal tiene gráficas en el portal; el resto sí.
**Una fuga**: Compras y Facturas de compra mostraban montos sin
`compras_ver_montos`/`facturas_compra_ver_montos` — ✅ corregida en v2.1226.

Leyenda: A = alta · M = media · B = baja. ☐ pendiente · ✅ hecho.

### Ventas y caja
- ☐ A **Efectivo**: hacer corte (`DialogoCorte`), abrir caja / iniciar turno, pedir corrección; `PanelDelDia` (abrió + vendido + ingresos − vales − bolsas = efectivo); `MovimientosDelDia` con firmas; `MetaDelDia`, `EntregaDelTurno`, `BonosPorPagar`, `FichasDeCaja`.
- ☐ A **Diferencias de caja**: reponer/retirar/justificar (`ResolverDiferencia`), responsables y abonos (`AbonosDeDiferencia`), `AsentarDiferencias`.
- ☐ A **Cortes**: métricas Sin confirmar/Cuadraron/Exceso/Faltante que filtran; estados Confirmados/Descartados; período libre; detalle paso a paso (vendido por forma de pago, lo que debía haber, acumulado) de `CorteDetalleModal`.
- ☐ A **Bolsas**: etapas En la sala y Finalizadas; métricas del circuito; detalle de bolsa (`DetalleDeBolsa`); conteos y depósitos al banco; filtros; reimprimir etiqueta.
- ☐ M **Ventas**: nivel de precio por renglón; historial de cambios de la factura; filtros laboratorio/puntos/período libre; ordenar; ocultar producto; gráficas por sucursal y tendencia mensual en la ficha de producto.
- ☐ M **Corte Z**: tabla «por día» de por qué difiere; KPI crédito fiscal; ticket por secciones; PDF; filtro de sala.
- ☐ B **Inicio**: personalizar widgets; top 10. **Facturas en sala**: resumen de antigüedad. **Bolsas sala**: detalle de bolsa. **Ventas hoy**: horas según el horario de la sala.

### Inventario
- ☐ A **Pedidos**: productos del pedido; línea de vida con personas (`LifecycleTimeline`); completados/anulados; diferencias (`DifSection`) y llegada de reenvío; filtros; métricas de tiempos; mapa de ruta.
- ☐ A **Producto**: margen por nivel y alerta de pérdida; costo por presentación; historial de compras y de precios; devolutivo, categoría, ubicaciones, principios activos; editar foto y ficha; pestaña Presentaciones.
- ☐ A **Conteos**: KPIs (abiertos/por aprobar/sin ajustar, faltante/sobrante en $); crear, aprobar, ajuste ERP, recontar, agregar renglón, corregir lote; imprimir/exportar.
- ☐ A **Min·Máx**: barras cobertura/existencia, ABC/XYZ, proyección 30/60/90, ventas y compras recientes, historial; pestaña Agotados; revisión de la sala (publicar/descartar borradores).
- ☐ M **Traslados**: historial por semana con filtros y envíos cerrados; reimprimir ticket; fotos de evidencia; trayecto con personas.
- ☐ M **Inyecciones**: KPIs de la bitácora, rango/estado/sala, Por cobrar y Precios y dosis.
- ☐ M **Inventario**: área vencidos, última sincronización, lotes de la sala. **Gestión de stock**: KPIs que faltan, CSV, armar envío nativo. **Bitácoras**: corregir/quitar, cierre de mes, matriz.
- ☐ B **Ventas perdidas**: CSV, top 5 como lista.

### Clientes y comercial
- ☐ A **Metas**: detalle por sala con gráficas (días, termómetro, ranking); Bono, Pago semestral, Confirmación, Gastos, Histórico.
- ☐ A **Promociones**: Seguimiento (quién vendió, bono), matriz de laboratorio, Descuentos, Excedentes, Pagos; pausar/editar/duplicar; avance del lote.
- ☐ A **Cuentas por cobrar**: refrescar contra la caja; Por vencer; orden; filtro vendedor; pedir corrección de un abono.
- ☐ A **Puntos**: KPIs, «los que más tienen», gráficas (`GraficasPuntos`), cuentas por asignar, traspasos pendientes, ajustar y código de acceso.
- ☐ M **Clientes**: KPIs, Por revisar, filtros depto/municipio, orden, valor anterior→nuevo. **Cotizaciones**: KPIs, IVA por línea, crear/editar/anular, PDF. **Encuestas de clientes**: resultados por pregunta con barras, avance, incentivos, aprobar/publicar/cerrar. **Marketing**: KPIs del mes, aprobar piezas y el mes, pestañas.
- ☐ B **Aplicar encuesta**: incentivo, modo tablet. **Galería**: marca, guardar en Fotos, compartir todo.

### Compras y fiscal
- ☐ A **Facturación**: KPIs por cola (CCF urgentes, días restantes), solventar una/todas, resolver, pestañas Saltos y No efectivo, permisos `facturacion_tab_*`.
- ☐ A **Cuentas por pagar**: registrar pago por factura, condiciones de crédito, En trámite.
- ☐ A **Facturas de compra**: KPIs crédito IVA/compras netas/sin proveedor, pestaña Revisión, orden, ZIP.
- ☐ A **Compras**: estado, pestaña Productos, filtro proveedor, KPIs.
- ☐ M **Proveedores**: contacto (tocar para llamar/escribir), crédito, clase, deducibilidad, filtros, editar. **Laboratorios**: KPIs, política de vencimiento. **Libros IVA**: detalle por renglón, avisos de cumplimiento, CSV. **Cierre de período**: cerrar/reabrir, cadena del remanente.
- ☐ B **Resumen fiscal**: KPI anticipo. **Libro de compras completo**: KPI, NRC, CSV.

### Personas
- ☐ A **Nómina**: aprobar/pagar, aviso de timesheets sin aprobar, totales completos. ✅ v2.1227: boleta con A/B/C del papel (las horas ya en dinero), sueldo de la ficha viva y PDF para compartir/imprimir.
- ☐ A **Auditoría de tiempos**: vista de quincena con KPIs, revisado/aprobar, turnos extra, cerrar quincena.
- ☐ A **Horarios**: horas vs 44 h, conflictos del día, huecos de cobertura, gráfica de transacciones, publicar, editar celda, catálogo y feriados.
- ☐ A **Personal**: mando de la sala, vistas practicantes/externos/todos, ficha nativa, alta.
- ☐ M **Vacaciones**: solicitudes de cambio con aprobar/rechazar, saldo, Gantt. **Monitor**: horas extra, marcas, tablero por estado. **Encuesta / admin**: resumen, segmentos, anillo, crear. **Cargos**: organigrama. **Permisos**: rótulos, apagadas, editar.

### Sistema
- ☐ A **Solicitudes**: aprobación parcial por línea, cancelar propia, Aprobadas/Rechazadas, «Sólo yo», semana; detalle con ContextoMinMax, venta, puntos, personas, historial.
- ☐ A **Sucursales**: kioscos N/3, Historial, Personal, Expediente, Gastos con gráfica; abrir en Maps; editar.
- ☐ M **Avisos**: leyeron/faltan con cargo, editar/eliminar, cargo/persona, programar. **Mi perfil**, **Sesiones** (bloquear, IP), **Solicitudes de datos**, **Mantenimiento** (motivo, duración, franja).
- ☐ B **Mis documentos**, **Carnés del día**, **Actualización de datos**, **Auditoría del sistema** (CSV, paginar, ficha).

### Diseño, en todas
- Flechas «‹ ›» de texto → SF Symbols; `numberOfLines={1}` que corta datos; detalles que se despliegan dentro de la tarjeta → pantalla propia; listas largas en `ScrollView`+`map`; botón «(portal)» al pie → acciones nativas.

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
