# Gates y herramientas — corridos el 2026-09-01 ~16:10 y ~22:00 CST

| gate | resultado |
|---|---|
| gate:design, gate:movil, gate:ux, gate:data, gate:borradores, gate:rutas, gate:undefinidos, gate:permisos, gate:doc, gate:version, gate:migrations | verde |
| gate:perf | verde (productos-del-mes 59 ms / techo 1665; buscar-en-productos 202 ms / 1778) |
| gate:eficiencia | verde; 10 crons con `job startup timeout` esporádico (0.14%–0.69%) |
| gate:auditoria | verde |
| **gate:bundle** | **ROJO**: entry 297 kB (tope 296); CortesView 79 (tope 73), ConteoDetailView 71 (70), BolsasView 66 (62); MisPuntosView y PromocionesView sin techo propio |
| **vitest** | **5 tests fallan** en 4 archivos (2424 pasan): registroDePermisos (ruta repetida en MODULE_MAP: 57 módulos, 56 rutas), bandejaYCatalogosDeSala (admin por system_role), bitacoraDeAcciones ×2 (user_id desde sesión / localStorage), decisionDiferencia (esCargoDeSupervision) |
| **eslint** | **232 problemas (222 errores)** en 88 archivos. 149 = setState síncrono dentro de un efecto (React Compiler); 25 memoización no preservable; 14 refs leídos en render; 6 variable usada antes de declararse (AuthContext ×2, EncuestaView, VentasView, usePedidosData ×2); 5 componentes creados durante el render (UnifiedModal, FormWfmAnalytics, TabConfirmacion ×2, DecisionDiferencia); 4 valor inmutable modificado (UnifiedModal formData, AuthContext, DashboardView refs ×2); 2 reasignación tras render (CierrePeriodoView `entra`, CrearRutaModal `cumul`) |

## Crons sin corrida registrada aunque su horario ya pasó hoy
inventory-daily-particiones (5 6 1 * *), refresh-product-last-sale-daily (45 6 * * *), inventory-daily-snapshot (45 7 * * *), promociones-ciclo-diario (30 13 * * *) — `ultima: null`. crear-conteos-ciclicos-mensual corre el 15.

## Edge functions: repo vs producción
- En repo y NO desplegadas: puntos-motor, puntos-traer-saldos
- Desplegada y NO en repo: sync-erp-minmax (cron auto-calculate-minmax la usa?)
