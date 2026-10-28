# App del personal — auditoría de paridad con el portal (2026-10-15)

Reemplaza la lista de pendientes de `PLAN-APP-NATIVA-PARIDAD-2026-10-06.md`,
que quedó vieja: casi todo lo que decía «sigue en el portal» ya es nativo.

**Meta del usuario:** la app tiene TODAS las funciones e información de la web
(no tiene que verse igual). La app es sólo para empleados (TestFlight interno /
Play pista interna; no se publica en las tiendas).

**Cómo se hizo:** lectura del código de las dos puntas, módulo por módulo, en
siete grupos. No se abrió ninguna de las dos en un teléfono: lo marcado `(?)` no
se pudo confirmar leyendo. Leyenda: A = uso diario o acción importante,
M = media, B = baja. ☐ pendiente · ✅ hecho.

## Resumen

| grupo | A | M | B |
|---|---:|---:|---:|
| Personas | 1 | 18 | 20 |
| Caja y ventas | 4 | 17 | 19 |
| Inventario | 6 | 26 | 35 |
| Compras y fiscal | 0 | 6 | 6 |
| Clientes y comercial | 1 | 22 | 25 |
| Sistema y marco | 0 | 6 | 10 |
| Torogoz | 0 | 1 | 5 |
| **total (líneas del documento)** | **12** (11 distintos) | **95** | **114** |

Todas las pantallas son nativas: el único salto al portal incrustado es
«Armar envío» de Gestión de stock. Lo que falta es lo de ADENTRO de cada
pantalla: acciones, filtros, columnas, exportaciones.

## Plan de corrección

Decisión del usuario (2026-10-15): «crea plan, y corrige todo». Se corrige
TODO lo marcado ☐, por fases, y cada línea se tilda ✅ con su versión al cerrar.

**Estado al 2026-10-15 (v2.1294.3 → v2.1294.9):** F0–F3 cerradas en código —
todas las líneas tildadas salvo dos a medias (◐). **Nada probado todavía en
simulador ni teléfono**: falta F4 (probar contra pruebas y subir el build).

Diferencias deliberadas con la web, anotadas por quien las hizo:
- Personal: al editar, sala/cargos/ingreso/contrato/salario quedan bloqueados
  como en la web (antes la app sí dejaba). La foto y documentos que no son el DUI
  se suben después del alta, desde el Expediente. Sin PDF de bienvenida: la app
  muestra y copia la contraseña temporal.
- Clima: la app no muestra nombres en el detalle por pregunta ni en los
  tableros de jefes (sólo cuentas); la web sí.
- Min·Máx: «Crítico A» en la app muestra sólo los A sin stock o bajo el mínimo.
- Facturas de compra: «Detectar código» lee el PDF en el teléfono con `fflate`;
  si el PDF dibuja el texto por glifos, dice «Sin código».
- Bitácoras: desde el folio se puede completar un renglón pendiente, no rehacer
  uno completo.
- Solicitudes de datos: el período es por atajos, no rango libre.

| fase | qué | cómo se cierra |
|---|---|---|
| F0 | las 4 fugas de permiso + los textos viejos «en el portal» | commit propio, enseguida |
| F1 | las 11 A | una tanda por grupo |
| F2 | las M, grupo por grupo | ídem |
| F3 | las B, grupo por grupo | ídem |
| F4 | compilar y subir UNA vez (iOS TestFlight + Play interna) | build al cerrar la fase, no por cambio |

Reglas de trabajo (las mismas del plan del 6-oct):
- Lógica nueva al núcleo (`src/utils`, `src/data`) y el portal pasa a usarla;
  antes de crear un archivo del núcleo, `ls`: si existe se le agrega.
- Cada grupo trabaja en su propio worktree para no pisar otras sesiones; se
  integra a `main` grupo por grupo con `git fetch` antes.
- Se prueba en el simulador / Expo web contra el entorno de pruebas. Nada se
  escribe en producción sin consentimiento.
- Al cerrar cada grupo: `npm run gate:app-nativa`, `gate:nucleo`, `gate:alias`
  y los gates que toque el cambio.
- Acciones de dinero de Torogoz: siguen apagadas (`ACCIONES_DE_DINERO`); lo
  que se corrige ahí es lo que falta aunque se enciendan.

### Primero: la app muestra o permite lo que la web NO

Son fugas de permiso, no faltantes. Van antes que todo lo demás.

- **Inicio · meta del mes**: muestra montos (vendido, meta, falta) a quien no
  tiene `dash_meta_sala_vista_completa`; la web sólo da porcentajes —
  `src/views/dashboard/WidgetMetaSala.jsx`.
- **Ventas perdidas**: el CSV de la app no exige `ventas_perdidas_descargar` —
  `apps/mobile/app/ventas-perdidas.js:168`.
- **Compras**: las pestañas Facturas y Productos no miran `compras_tab_*` —
  `src/views/ComprasView.jsx:464`.
- **Facturas de sala** (?): el monto se muestra sin mirar
  `facturas_sala_ver_montos`. → no aplica: el widget del portal hace lo mismo.

✅ **F0 cerrada**: meta, ventas perdidas y compras corregidas; los once
comentarios de `pantallas.js` y el texto de `Renglones.js` actualizados.

### Las A (uso diario)

1. **Reservas — revisar receta** (aprobar, pedir otra foto, rechazar; avisos de
   receta urgente). Aparece en Inicio y en Ofertas para clientes: es el mismo
   faltante.
2. **Reservas — reservar con anticipo** en el mostrador (?).
3. **Bolsas — la sala no ve «Diferencias»** ni puede anotar la causa.
4. **Gestión de stock — «Armar envío»** abre el portal.
5. **Pedidos/Rutas — «No se pudo entregar»** en una parada.
6. **Min·Máx — motivo del ajuste a mano** (la app guarda sin motivo).
7. **Min·Máx — «0 en todas las salas»** con motivo.
8. **Bitácoras — corregir una lectura** de temperatura/humedad.
9. **Bitácoras — corregir o anular una limpieza**.
10. **Personal — detectar recontratación/duplicado** y enlazar con la ficha
    existente al dar de alta.
11. **Inicio — fuga de la meta** (arriba).

### Textos viejos que dicen «en el portal» de algo que ya es nativo

`apps/mobile/pantallas.js` (comentarios de /laboratorios, /cuentas-por-pagar,
/cierre-periodo, /libros-iva, /corte-z, /metas, /cargos, /permisos, /sesiones,
/carnes-del-dia, /auditoria-del-sistema) y la frase visible «El MIN/MAX se
corrige en el portal» en `apps/mobile/componentes/pedidos/Renglones.js`.

### Torogoz: escrito y apagado a propósito

Las acciones de dinero y Hacienda tienen código nativo completo y están detrás
de `ACCIONES_DE_DINERO = false` (`apps/mobile/componentes/torogoz/soloConsulta.js`),
por decisión del 2026-10-07, hasta probarlas en sala. No cuentan como
faltantes.

---

## Personas

### /personal — Gestión de personal
- ✅ [A] Alta/edición: detectar a quien ya trabajó o puede estar duplicado y enlazar con la ficha existente (`enlazar_con_id`) — src/components/forms/EmployeeFormModal.jsx
- ✅ [M] Seguro de vida colectivo: franja del directorio y vista completa (póliza, pago del año, cubiertos/sin cubrir, pagos anteriores, comprobante) — src/views/personal/SeguroDeVidaColectivo.jsx, EquiposView.jsx
- ✅ [M] (?) Bajas en apartado propio por sala (hoy salen mezcladas con el equipo activo) — src/views/personal/EquiposView.jsx
- ✅ [M] Ficha: «Tardanzas (mes)» — src/views/EmployeeDetailView.jsx
- ✅ [M] Ficha: reimprimir el carné de plástico con PIN permanente — EmployeeDetailView.jsx (reimprimirCarne)
- ✅ [M] Alta/edición: ISSS, AFP, lugar y fecha de expedición del DUI, documento alterno — EmployeeFormModal.jsx
- ✅ [M] Alta/edición: estado civil, tipo de sangre, varios teléfonos, correos y direcciones (con mapa), contactos de emergencia — EmployeeFormModal.jsx
- ✅ [M] Alta/edición: dependientes económicos — EmployeeFormModal.jsx
- ✅ [M] Alta/edición: contrato del Art. 23 (estipulación, forma y periodo de pago, firma, ejemplar MTPS, prórrogas) — EmployeeFormModal.jsx
- ✅ [M] Alta/edición: acreditaciones (dependiente de farmacia con su carné) — EmployeeFormModal.jsx
- ✅ [M] Expediente: DUI por caras con lector automático, documentos de varias hojas y «Otros documentos» — EmployeeFormModal.jsx
- ✅ [B] Filtro de sala no considera a quien cubre varias salas (`assigned_branch_ids`) — EquiposView.jsx
- ✅ [B] Ficha: edad — EmployeeDetailView.jsx
- ✅ [B] Ficha: almuerzo/receso de cada día en el horario — EmployeeDetailView.jsx
- ✅ [B] Alta/edición: condiciones crónicas y certificación de discapacidad — EmployeeFormModal.jsx
- ✅ [B] Alta/edición: vehículos y licencias — EmployeeFormModal.jsx
- ✅ [B] Alta/edición: herramientas y materiales entregados — EmployeeFormModal.jsx
- ✅ [B] Alta/edición: habilidades — EmployeeFormModal.jsx
- ✅ [B] (?) Alta/edición: salas que cubre — EmployeeFormModal.jsx
- ✅ [B] (?) Alta/edición: seguridad del kiosco (ver/copiar PIN) y acceso a la app — EmployeeFormModal.jsx
- ✅ [B] (?) Cambiar el usuario (la app manda al portal) — EmployeeFormModal.jsx

### /monitor — Monitor en tiempo real
✅ completo

### /auditoria-de-tiempos — Auditoría de tiempos
- ✅ [M] CSV de la quincena (`time_audit_descargar`) — src/views/AttendanceAuditView.jsx
- ✅ [M] Turnos extra: editar las horas declaradas antes de aprobar — AttendanceAuditView.jsx
- ✅ [M] Turnos extra: rechazar uno sin horas declaradas (apps/mobile/componentes/personas/Quincena.js:193) — AttendanceAuditView.jsx:1153
- ✅ [B] Atajo «Ver planilla» con la quincena cerrada — AttendanceAuditView.jsx:1025

### /horarios — Horarios
- ✅ [B] Catálogo: sugerencias por sala («Crear este turno» / «Ignorar aviso») — src/views/schedule-tabs/TabShifts.jsx
- ✅ [B] Atajo «Expandir análisis» al Monitor de ventas — schedule-tabs/components/ScheduleChart.jsx:58

### /vacaciones · /nomina · /mi-perfil · /carnes-del-dia
✅ completos

### /cargos — Cargos
- ✅ [B] Exportar el organigrama como PNG — src/views/RolesView.jsx

### /permisos — Permisos
- ✅ [B] Al encender «Delegar», decir a quién le llegan las decisiones — src/views/PermissionsView.jsx
- ✅ [B] Cuántos módulos ve cada cargo — PermissionsView.jsx

### /mis-documentos — Mis documentos
- ✅ [M] Respuesta de quien aprobó (`approver_note`) — src/views/employee/EmployeeDocumentsView.jsx
- ✅ [B] Rango desde/hasta del pasado — EmployeeDocumentsView.jsx

### /encuesta — Clima organizacional
- ✅ [M] Filtro por sucursal para alcance ALL — src/views/EncuestaView.jsx
- ✅ [M] Por pregunta: texto de cada opción y quiénes la eligieron — EncuestaView.jsx (PreguntaRow)
- ✅ [M] Bloque 2: «Empleados evaluando a su jefe de sala» y «Jefes evaluando a su jefe inmediato» — EncuestaView.jsx
- ✅ [B] «¿A quién va dirigido?» y cuántas preguntas tiene cada bloque — EncuestaView.jsx

### /encuesta-admin — Gestión de encuestas
- ✅ [M] Quien sólo lee no ve las respuestas de una persona ni su comentario — src/views/EncuestaAdminView.jsx
- ✅ [B] Puntaje por bloque de cada persona — EncuestaAdminView.jsx
- ✅ [B] Descripción, año y atajo «Ver análisis» en la tarjeta — EncuestaAdminView.jsx

**Total del grupo: A 1 · M 18 · B 20**

## Caja y ventas

### /inicio — Inicio
- ✅ [A] **Fuga de permiso**: la meta del mes muestra montos (vendido, meta, falta) aunque la persona no tenga `dash_meta_sala_vista_completa`; la web sólo muestra porcentajes — src/views/dashboard/WidgetMetaSala.jsx
- ✅ [A] Reservas: falta «Revisar receta» de las que están `en_revision` (aprobar, pedir otra foto, rechazar) — src/views/dashboard/RevisarReceta.jsx, WidgetReservas.jsx
- ✅ [A] Reservas: falta «Reservar con anticipo» en el mostrador (≥50 %, 7 días, constancia con código de barras); `abono-apartado` parece otro flujo (?) — src/views/dashboard/NuevaReservaSucursal.jsx
- ✅ [M] Meta del mes: falta «hoy llevas $X», la proyección de cierre ($ y %) y el ritmo diario necesario — WidgetMetaSala.jsx
- ✅ [M] Meta del mes: falta selector de sala para alcance ALL — src/views/DashboardView.jsx (`meta_sala`)
- ✅ [M] Consulta de inventario: falta «faltantes de mi sala con existencia en otra sala» y pedir desde el renglón, incluidos los vencidos de Bodega — src/views/dashboard/inventario/PanelDeInventario.jsx
- ✅ [B] Quién está vendiendo: falta «total / por día trabajado» y el promedio — WidgetVendedores.jsx
- ✅ [B] Tendencia de asistencia: no se puede ir a semanas anteriores — DashboardView.jsx
- ✅ [B] «Cortes de caja del mes»: sin selector de sala para alcance ALL — DashboardView.jsx (`cortes_sala`)
- ◐ [B] Falta «Personalizar» (encender/apagar, acomodar, redimensionar widgets; publicar acomodo temático) · **a medias**: encender/apagar sí (misma preferencia `user_dashboard_prefs.widgets`); acomodar y redimensionar no aplican — el Inicio de la app se ordena solo por uso — src/views/dashboard/AcomodarModal.jsx

### /ventas — Ventas
- ✅ [M] Filtro por estado de puntos y «canjeó puntos» desde la tarjeta Pts. Canjeados — src/views/VentasView.jsx
- ✅ [M] Período libre; la app sólo ofrece Hoy, Ayer, 7 días, Este mes y Mes anterior — VentasView.jsx
- ✅ [M] Tipo de precio cobrado por renglón (VIP, Clínica, Mayoreo, Premium, P7, Viñeta, Especial…) — VentasView.jsx (`detectTier`)
- ✅ [M] «Cambios registrados» de la factura con valor anterior y nuevo — VentasView.jsx (`changelogCache`)
- ✅ [M] Drill de producto: filtros por tipo de documento y «precio cambió» — VentasView.jsx (TabProductos)
- ✅ [B] Aviso de cobros que no son venta de productos (AvisoSinProducto) — VentasView.jsx
- ✅ [B] Estado de puntos en la fila de la lista — VentasView.jsx
- ✅ [B] Ordenar la lista por columna — VentasView.jsx
- ✅ [B] Productos: KPI Costo y columnas Costo y Última venta — VentasView.jsx
- ✅ [B] Vendedores: variación % de facturas contra el período anterior — VentasView.jsx

### /caja — Efectivo
- ✅ [M] Movimientos: rango libre; la app sólo ofrece Hoy, Ayer y 7 días — src/views/CortesView.jsx
- ✅ [M] Movimientos: faltan los totales «Entró» y «Salió» — CortesView.jsx (`resumenMovs`)
- ✅ [B] Movimientos: quién anotó cada movimiento hecho desde el portal — CortesView.jsx
- ✅ [B] Diferencias: buscador por sala, fecha, responsable o monto — src/components/cortes/DiasConDiferencia.jsx

### /cortes — Cortes
- ✅ [M] Fichas de apertura (quién abrió cada caja, hora, monto, cruce con marcación, piezas del cajón) — src/components/cortes/FichasDeCaja.jsx
- ✅ [B] Confirmar o descartar desde la tarjeta de la lista — src/components/cortes/TarjetaCorte.jsx

### /bolsas — Bolsas (y bolsas de sala)
- ✅ [A] La sala no ve la etapa «Diferencias» ni puede «Anotar la causa» (`bolsas` can_edit) — src/views/bolsas/CircuitoDeBolsas.jsx
- ✅ [M] «Contar de nuevo» una bolsa que no cuadró — CircuitoDeBolsas.jsx
- ✅ [M] Métrica «El corte y su bolsa» (cortes confirmados que nunca llegaron a una bolsa) — CircuitoDeBolsas.jsx
- ✅ [M] Administración: filtros de período (Contadas fijo en 30 días), sucursal y buscador — src/views/BolsasView.jsx
- ✅ [B] Finalizadas: filtros «solo sin resolver» y por tanda de conteo — BolsasView.jsx
- ✅ [B] «Entregar dinero» con alcance ALL no está enlazado desde `/bolsas` (?) — CircuitoDeBolsas.jsx

### /cuentas-por-cobrar — Cuentas por cobrar
✅ completo

### /metas — Metas
- ✅ [B] Pago semestral: buscar persona por nombre o código — src/views/metas/TabSemestral.jsx

### /corte-z — Corte Z
- ✅ [M] «Ver día por día»: ventas con factura por día con documentos, total y rango de N.º de control — src/views/contabilidad/CorteZView.jsx
- ✅ [B] Filtro por sucursal — CorteZView.jsx

### /facturas-sala — Facturas de sala
La app sólo trae la versión «widget» (tomar/soltar las de mi sala, 30 días); el panel de supervisión no existe.
- ✅ [M] Panel por estado (Sin cargar, Atrasadas, Cargadas, Liberadas) con conteos, monto atrasado y aviso — src/views/purchases/FacturasSalaView.jsx
- ✅ [M] Liberar una factura tomada por cualquier sala (`facturas_sala` can_edit) — FacturasSalaView.jsx
- ✅ [B] Período 30/90/365 días y columna «La tomó» — FacturasSalaView.jsx
- ✅ [B] El monto se muestra sin mirar `facturas_sala_ver_montos` (?) — FacturasSalaView.jsx · **no aplica**: el widget del portal (`WidgetFacturasSala.jsx`) también lo muestra sin ese permiso; la app es el widget

**Total del grupo: A 4 · M 17 · B 19**

## Inventario

### /productos — Productos
- ✅ [M] Filtro por laboratorio en la lista — src/views/productos/TabCatalogo.jsx
- ✅ [M] Badges de la fila: margen (pérdida/bajo), «Pérd. <precio especial>», «cambios», «ND», «Receta» — TabCatalogo.jsx
- ✅ [B] Ordenar por laboratorio, categoría o estado — TabCatalogo.jsx
- ✅ [B] Acción en lote «Enriquecer SRS» — src/components/srs/SrsEnriquecerModal.jsx
- ✅ [B] Buscador SRS al editar principios activos — TabCatalogo.jsx
- ✅ [B] Badge «Receta» en la ficha — TabCatalogo.jsx
- ✅ [B] (?) Foto: pegar, recortar y ampliar — TabCatalogo.jsx

### /laboratorios — Laboratorios
✅ completo

### /pedidos — Pedidos
- ✅ [A] Rutas: falta «No se pudo entregar» en una parada (`marcarParadaNoEntregada`) — src/views/pedidos/TabRutas.jsx
- ✅ [M] Rutas: «Cerrar ruta» con motivo cuando quedan paradas pendientes — TabRutas.jsx
- ✅ [M] Generar: paso «Revisa antes de confirmar» con resumen por sala — src/views/pedidos/TabGenerar.jsx
- ✅ [M] Generar: tabla «Productos sin stock en Bodega» — TabGenerar.jsx
- ✅ [M] Buscador en la lista de pedidos — src/views/pedidos/TabPedidos.jsx
- ✅ [M] Recepción: lotes asignados a cada renglón — src/views/pedidos/RecepcionModal.jsx
- ✅ [M] Recepción: «¿Necesitas un producto ya?» (busca en todas las hojas) y buscador dentro de una hoja — RecepcionModal.jsx
- ✅ [B] Rutas: iniciar una ruta pendiente también para quien gestiona rutas (en la app sólo el conductor) — TabRutas.jsx
- ✅ [B] Rutas: indicadores «En la calle / Por salir / Completadas hoy» y filtros — TabRutas.jsx
- ✅ [B] Generar: «N bajo mínimo · N en cero» y «Último pedido hace X» por sala — TabGenerar.jsx
- ✅ [B] Lista en vivo y aviso de pedido nuevo — TabPedidos.jsx
- ✅ [B] (?) Recepción: elegir presentación del conteo — RecepcionModal.jsx
- ✅ [B] Reglas de despacho: ordenar por columna — src/views/pedidos/TabReglas.jsx

### /gestion-stock — Gestión de stock
- ✅ [A] «Armar envío» abre el portal; en la web es `EnviarProductoModal` precargado, ofrece poner Min/Max en 0/0 y anota `ENVIO_SUGERIDO_SIN_VENTA` — src/views/inventario/TabParados.jsx
- ✅ [M] CSV en «Sin venta» y «Sin Min/Max» — TabParados.jsx, TabSinMinMax.jsx
- ✅ [M] «Sin venta»: tarjetas «A otra sala» y «A Bodega» que filtran — TabParados.jsx
- ✅ [B] «Sin venta»: filtro «Con Min/Max» — TabParados.jsx
- ✅ [B] Aviso de que no se puede armar envío desde esa sala (la app sólo oculta el botón) — TabParados.jsx
- ✅ [B] «Sin Min/Max»: indicadores y orden — TabSinMinMax.jsx

### /inventario — Inventario
- ✅ [M] Filtro por laboratorio (la app manda `p_lab_id: null`) — src/views/inventario/TabInventario.jsx
- ✅ [B] «Todas las salas»: columna y orden por sucursal, sentido del orden — TabInventario.jsx

### /minmax — Min / Max
- ✅ [A] Motivo del ajuste a mano («Poner/Ver motivo») y filtro por estado del ajuste; la app guarda sin motivo — src/views/productos/tabminmax/MotivoAjusteModal.jsx, TabMinMax.jsx
- ✅ [A] «0 en todas las salas» con motivo obligatorio — src/views/productos/tabminmax/CeroEnTodasModal.jsx
- ✅ [M] Historial de cambios del MIN·MAX (quién, solicitud, motivo) — TabMinMax.jsx
- ✅ [M] Modal de la regla de despacho (propone y aplica el número que destraba) — tabminmax/ReglaDeDespachoModal.jsx
- ✅ [M] Publicar un solo producto — tabminmax/RowActions.jsx
- ✅ [M] Tarjetas de costo (Inventario, Útil, Excedente, Sin movimiento, borrador) — tabminmax/CostCards.jsx, DraftCostCard.jsx
- ✅ [M] Filtros: datos escasos, riesgo de despacho, crítico A, ver ocultos (y «Restaurar N ocultos») — TabMinMax.jsx
- ✅ [M] «Ocultar filtrados» en lote — TabMinMax.jsx
- ✅ [B] Recalcular todas las sucursales a la vez — TabMinMax.jsx
- ✅ [B] Ordenar por columna — TabMinMax.jsx
- ✅ [B] Bodega: aviso «MIN/MAX = Σ sucursales publicadas» — TabMinMax.jsx
- ✅ [B] Equivalente en presentación principal (≈ cajas) — TabMinMax.jsx

### /ventas-perdidas — Ventas perdidas
✅ completo · ✅ F0: el CSV exige `ventas_perdidas_descargar`

### /conteo-inventario — Conteo de inventario
- ✅ [M] Pestañas «Inventario» y «Área de vencidos» separadas con lo que falta de cada una — src/views/inventario/ConteoDetailView.jsx
- ✅ [M] Aviso de «Conteo parcial» en un conteo cerrado — ConteoDetailView.jsx
- ✅ [M] «Modo recuento» a ciegas de lo que tiene diferencia, en orden de estante — ConteoDetailView.jsx
- ✅ [B] «Hoja compacta» al imprimir — ConteoDetailView.jsx
- ✅ [B] «En vivo / Según la hoja» y alcance en el encabezado — ConteoDetailView.jsx
- ✅ [B] Aviso de «Conteo ciego» — ConteoDetailView.jsx
- ✅ [B] Ordenar el detalle por columna — ConteoDetailView.jsx
- ✅ [B] Buscador y filtro de sucursal en la lista — src/views/ConteoInventarioView.jsx
- ✅ [B] Eliminar un conteo desde la lista — ConteoInventarioView.jsx

### /bitacoras — Bitácoras
- ✅ [A] Corregir una lectura de temperatura/humedad ya anotada (con motivo) — src/components/bitacoras/AnotarLectura.jsx
- ✅ [A] Corregir o anular una limpieza registrada — src/components/bitacoras/AnotarLimpieza.jsx
- ✅ [M] Libro bajo receta: separar Antibióticos y Bajo receta con su cuenta (también en el CSV) — src/views/BitacorasView.jsx
- ✅ [M] Detalle de un folio: receta, venta, entregas parciales, PDF y foto — src/components/bitacoras/DetalleDeFolio.jsx
- ✅ [M] Buscador del libro (folio, medicamento, lote, paciente, médico, junta) — BitacorasView.jsx
- ✅ [B] Registro del día: quién, hora, marca de «tarde» y humedad — src/components/bitacoras/MatrizDelDia.jsx
- ✅ [B] Ordenar el libro por columna — src/views/bitacoras/TabBajoReceta.jsx

### /traslados — Traslados entre salas
- ✅ [M] Imprimir el ticket desde un traslado en camino y desde los envíos — src/views/traslados/FilasTraslado.jsx, FilasEnvio.jsx
- ✅ [M] «En camino»: agrupar lo pedido a varias salas y «Ya llegaron las N completas» — src/views/traslados/GrupoPorRecibir.jsx
- ◐ [B] Recibir por código escribiendo el número a mano y el aviso «la lectura no entró» · el número a mano sí; el aviso no aplica (diagnostica el lector USB; el teléfono lee con cámara) — ConfirmarPorCodigo.jsx, LecturaQueNoEntro.jsx
- ✅ [B] Filtro de sucursal en «En camino» para alcance ALL — src/views/TrasladosView.jsx
- ✅ [B] Historial por sucursal de origen y desenlace para alcance ALL — HistorialTraslados.jsx

**Total del grupo: A 6 · M 26 · B 35**

## Compras y fiscal

### /facturacion — Facturación
- ✅ [M] Falta el historial de observaciones ya solventadas en la cola Observaciones: quién, cuándo, la nota y los códigos. La app solo trae ese historial para Hacienda y Anuladas (`componentes/fiscal/Resueltas.js`) — src/views/FacturacionView.jsx (TabObservaciones, sección «N solventadas»)
- ✅ [M] En No efectivo falta la tabla de pagos ya confirmados: quién confirmó, fecha de confirmación, notas, ver el comprobante adjunto y filtros por tipo de pago y sucursal. La app solo muestra cuántos se confirmaron en el mes — src/views/FacturacionView.jsx (TabNoEfectivo, `showConfirmed` / `CONFIRMED_COLS`)
- ✅ [B] Como comprobante del pago la app solo acepta una foto (cámara o galería); la web acepta también un PDF — src/views/FacturacionView.jsx (FileField `image/*,application/pdf`)
- ✅ [B] No se puede copiar el ID interno con un toque ni existe la marca de «visitados» con su «Limpiar» en Anuladas, Pendiente MH y Observaciones — src/views/FacturacionView.jsx (`useVisitados`, `copyErpId`)

### /compras — Compras (Bodega)
- ✅ [B] La web filtra por un rango de fechas libre (desde/hasta); la app solo avanza mes a mes — src/views/ComprasView.jsx (LiquidDatePicker)
- ✅ [B] La app muestra las pestañas Facturas y Productos sin revisar los permisos `compras_tab_*`, que la web sí exige — src/views/ComprasView.jsx:464

### /cuentas-por-pagar — Cuentas por pagar
✅ completo (el comentario de `pantallas.js` «registrar un pago: portal» está viejo: la app ya lo hace en `cxp-proveedor/[nit]`)

### /cargar-compra — Cargar compra
✅ completo

### /facturas-compra — Facturas de compra
- ✅ [M] Falta «Adjuntar JSON»: unir un documento «Sin JSON» con su duplicado que sí trae el JSON (`mergePurchaseDteDocuments`) — src/views/purchases/FacturasCompraView.jsx (AttachJsonAction)
- ✅ [M] Falta «Detectar código» dentro del PDF y la unión o el emparejamiento automático con el documento encontrado, tanto en Documentos como en Revisión. En la app solo se empareja eligiendo el documento a mano — FacturasCompraView.jsx (DetectCodeAction, `mergePorCodigo` / `emparejarPorCodigo`)
- ✅ [B] Falta «Ver documento»: abrir el PDF que justificó la anulación (`invalidacion_source`) de un documento invalidado — FacturasCompraView.jsx:1073

### /libros-iva — Libros IVA
- ✅ [M] Dentro del detalle de cada libro no hay buscador — src/views/contabilidad/LibrosIvaView.jsx (`searchValue={busqueda}`)
- ✅ [B] Las columnas del detalle de cada libro no se pueden ordenar — LibrosIvaView.jsx (`onSort: alOrdenar`)

### /libro-compras-completo — Libro de compras completo
✅ completo

### /cierre-periodo — Cierre de período
✅ completo (la app ya cierra y reabre)

### /resumen-fiscal — Resumen fiscal
✅ completo

### /proveedores — Proveedores
- ✅ [M] En la ficha del proveedor no se puede vincular ni cambiar «Registrado como» (`setProveedorSupplier`), y tampoco se ve con qué proveedor registrado está vinculado: la app solo dice «Vinculado» o «Sin vincular» — src/components/forms/FormProveedorDetail.jsx:215,356

**Total del grupo: A 0 · M 6 · B 6**

## Clientes y comercial

### /clientes — Clientes
- ✅ [B] En el filtro «Duplicado», falta la insignia «Duplicado» con el nombre del cliente con el que choca (`dup_con`) — src/views/ClientesView.jsx

### /mayoristas — Clientes Mayoristas
✅ completo

### /cotizaciones — Cotizaciones
✅ completo

### /puntos — Puntos
- ✅ [M] Al abrir un aviso falta ver la venta que lo originó: sus productos y quién vendió. La app solo lleva a la cuenta del cliente — src/views/puntos/VentaDelAviso.jsx (dentro de ClientePuntosModal.jsx)
- ✅ [M] Falta el botón «Editar cliente / Ver ficha» desde la cuenta de puntos del cliente — src/views/puntos/ClientePuntosModal.jsx
- ✅ [B] Falta el filtro por motivo («Por qué no pasó») en Cuentas por asignar — src/views/PuntosView.jsx

### /inyecciones — Inyecciones
- ✅ [M] Falta exportar la Bitácora a CSV (en Por cobrar sí está) — src/views/inyecciones/TabBitacora.jsx
- ✅ [B] Bitácora: falta el filtro y las tarjetas por estado (Aplicadas / Pendientes) que sirven de filtro — src/views/inyecciones/TabBitacora.jsx
- ✅ [B] Bitácora: falta elegir un rango de fechas libre o por mes. La app solo ofrece Hoy, 7 días y 30 días — src/views/inyecciones/TabBitacora.jsx
- ✅ [B] Bitácora y Pendientes: falta el filtro por sucursal para quien ve todas las salas — src/views/inyecciones/TabBitacora.jsx, TabPendientes.jsx

### /promociones — Promociones
- ✅ [M] Falta exportar a CSV la lista de vigentes y la de terminadas (Activas e Histórico) — src/views/promociones/PromocionesView.jsx
- ✅ [M] Falta exportar a CSV los excedentes por decidir — src/views/promociones/TabExcedentes.jsx
- ✅ [M] Falta exportar a CSV los pagos de bono — src/views/promociones/TabPagos.jsx
- ✅ [M] Descuentos: falta el filtro por sucursal para quien ve todas las salas — src/views/promociones/PromocionesView.jsx
- ✅ [B] Pagos: falta la tarjeta «A planilla» con el total de administración — src/views/promociones/TabPagos.jsx
- ✅ [B] Descuentos: falta la tarjeta «Productos» (cuántos productos distintos tienen descuento) — src/views/promociones/PromocionesView.jsx
- ✅ [B] Descuentos: falta la etiqueta que dice si la oferta está en la app de clientes («En la app» / «App: sin publicar») — src/views/promociones/TabDescuentos.jsx
- ✅ [B] Falta la opción «Vencida» en el filtro de estado — src/views/promociones/PromocionesView.jsx

### /ofertas-clientes — Ofertas para clientes
- ✅ [A] Reservas: no se pueden revisar recetas (ver la receta, aprobarla o pedir otra foto). Tampoco salen los avisos «Esperando nueva foto» ni «receta urgente» — src/views/dashboard/WidgetReservas.jsx (+ RevisarReceta)
- ✅ [M] Falta el campo «Exclusiva para» (nivel mínimo de Puntos Salud para reservar) y la insignia de nivel en las tarjetas — src/views/ofertas-clientes/OfertaModal.jsx, OfertasClientesView.jsx
- ✅ [M] Falta el panel «Entrega a domicilio»: activar el envío, su costo, el monto desde el que es gratis y la nota — src/views/ofertas-clientes/EnvioPanel.jsx
- ✅ [M] Reservas: falta la sección «Saldos a favor» con la acción «Aplicado en caja» — src/views/dashboard/WidgetReservas.jsx
- ✅ [M] Reservas: faltan los encargos de todas las salas — src/views/dashboard/WidgetReservas.jsx (WidgetEncargos)
- ✅ [B] Reservas: falta la insignia del anticipo con lo que queda por cobrar al retirar — src/views/dashboard/WidgetReservas.jsx
- ✅ [B] En una oferta que sale de un descuento, falta el precio original tachado junto al precio con descuento — src/views/ofertas-clientes/OfertaModal.jsx
- ✅ [B] Falta comprobar la medida de la imagen antes de subirla (historia 1080×1920, banner 1200×500) — src/views/ofertas-clientes/FormatoImagen.jsx

### /chat-clientes — Chat con clientes
- ✅ [M] Bandeja: falta el filtro por etiqueta — src/views/chat-clientes/ChatClientesView.jsx
- ✅ [M] Bandeja: falta el filtro «Preferentes» (Platino y Mayoristas), el orden que los pone primero y su insignia — ChatClientesView.jsx, Preferente.jsx
- ✅ [M] Falta «Ajustes del chat» para editar las respuestas automáticas (permiso de editar en `chat_clientes`) — src/views/chat-clientes/AjustesDelChat.jsx
- ✅ [M] Falta el registro de «Incumplimientos» — src/views/chat-clientes/IncumplimientosDelChat.jsx
- ✅ [B] Falta el indicador del estado de la farmacia — src/views/chat-clientes/EstadoDeLaFarmacia.jsx
- ✅ [B] Falta el resumen de calificaciones de los últimos 30 días (promedio y cuántas) — src/views/chat-clientes/Calificacion.jsx
- ✅ [B] Pestaña Cliente de la conversación: falta la insignia de nivel de puntos (?) — src/views/chat-clientes/PanelCliente.jsx

### /encuestas-clientes — Encuestas a clientes
- ✅ [M] Falta la pestaña «Plantillas». Sin ella no se puede abrir una plantilla ni llegar a «Crear encuesta con esta plantilla» — src/views/encuestas-clientes/EncuestasClientesView.jsx
- ✅ [M] «Nueva encuesta»: falta partir de una plantilla y crear una como plantilla. La app solo crea encuestas en blanco — EncuestasClientesView.jsx (NuevaEncuestaModal)
- ✅ [B] Falta «Guardar como plantilla» desde una encuesta — src/views/encuestas-clientes/EncuestaDetalle.jsx
- ✅ [B] Faltan las tarjetas Borradores / Por aprobar / Aprobadas / En campo — EncuestasClientesView.jsx
- ✅ [B] Falta el filtro por estado dentro de cada grupo — EncuestasClientesView.jsx
- ✅ [B] Falta el indicador Guardado / Guardando / Sin guardar (?) — EncuestaDetalle.jsx

### /encuestas-aplicar — Aplicar encuesta
- ✅ [M] Falta el «Modo tablet», en el que el cliente contesta solo. Además, las encuestas que solo se aplican por tablet no aparecen en la app — src/views/encuestas-clientes/AplicarEncuestaView.jsx
- ✅ [B] Falta la etiqueta del incentivo (muestra médica o N puntos) en la lista — AplicarEncuestaView.jsx

### /marketing — Marketing
- ✅ [M] Falta el informe PDF del mes, con el efecto de las piezas en las ventas — src/views/marketing/MarketingView.jsx (acción `informe`)
- ✅ [M] Falta la pestaña «Pauta»: Presupuesto del mes, Sin asignar, Gastado, Costo por mensaje y la tabla de piezas pautadas con sus resultados — TabPauta.jsx, MarketingView.jsx
- ✅ [M] Faltan las versiones de un diseño: ver V2, V3…, compararlas lado a lado y subir la siguiente — VersionesModal.jsx, Disenos.jsx
- ✅ [M] Calendario: faltan los filtros por marca, formato, liberada o no, y estado — MarketingView.jsx, TabCalendario.jsx
- ✅ [B] Faltan las fechas especiales dentro del calendario y planificar una pieza desde una de ellas. En la app solo se administran en Ajustes — TabCalendario.jsx
- ✅ [B] Falta la vista «Flujo» (tablero por estado) — TabTablero.jsx
- ✅ [B] Falta duplicar a otro mes varias piezas o el mes entero. La app duplica de a una — DuplicarModal.jsx
- ✅ [B] Falta la pestaña Galería en modo gestión, con el interruptor de liberar para todas las piezas. Está cubierta en parte: se libera desde cada pieza — Galeria.jsx

### /galeria — Galería
- ✅ [B] Falta el filtro por marca — src/views/marketing/GaleriaView.jsx

**Total del grupo: A 1 · M 22 · B 25**

## Sistema, solicitudes y marco de la app

### /solicitudes · /solicitudes-personales
- ✅ [M] Boleta de incapacidad: la app sólo adjunta foto; la web acepta también PDF — src/views/solicitudes/ModalNuevaPersonal.jsx

### Campana / notificaciones
- ✅ [B] «Borrar todas» de una vez (la app borra una por una) — src/components/common/NotificationBell.jsx
- ✅ [B] (?) Confirmar o descartar un corte desde la tarjeta del aviso — src/components/common/TarjetaDeAviso.jsx

### /sucursales — Sucursales
- ✅ [M] «Diagnóstico Inteligente» de la sucursal (resumen con IA) — src/views/BranchesView.jsx
- ✅ [B] Historial de la ficha sin el filtro «Otros» (`DIMENSIONES_DEL_HISTORIAL.slice(0,4)`) — src/views/BranchDetailView.jsx

### /auditoria-del-sistema
- ✅ [B] Ordenar por usuario o acción — src/views/AuditView.jsx

### /actualizacion-de-datos
- ✅ [B] Historial completo paginado (la app corta en 60 corridas) — src/views/SyncHealthView.jsx
- ✅ [B] Origen de cada corrida — SyncHealthView.jsx

### /solicitudes-datos
- ✅ [M] «Descargar en archivo»: CSV de portabilidad con los datos hallados — src/views/datos/SolicitudModal.jsx
- ✅ [B] Filtros por estado y período — src/views/SolicitudesDatosView.jsx

### Marco de la app (shell)
- ✅ [M] Aviso «¿Sigues ahí?» antes del cierre por inactividad (el cierre sí funciona) — src/components/common/AvisoDeInactividad.jsx
- ✅ [M] La franja de aviso del portal (BannerPortal) no se muestra en la app — src/components/common/BannerPortal.jsx
- ✅ [M] Ver y copiar el PIN de kiosco y el PIN SU propios — src/components/common/SidebarSettingsMenu.jsx
- ✅ [B] Elegir entre los 4 temas (la app sigue claro/oscuro del sistema) — src/components/common/ThemeToggle.jsx
- ✅ [B] Resumen del estado de sincronización en el menú — src/components/common/SidebarSyncStatus.jsx
- ✅ [B] Entrar con el carné (lector o cámara) — src/views/LoginView.jsx

✅ completos: /mis-avisos, /avisos, /sesiones, /objetos-huerfanos, /mantenimiento, /impresion (la ticketera de computadora no aplica al teléfono), /prueba-ios.

**Total del grupo: A 0 · M 6 · B 10**

## Torogoz

Paridad muy alta: Inicio, Rutas, Facturación, Cuentas por cobrar, Caja y liquidación (consulta), Clientes, Catálogo, Compras, Inventario, Ventas perdidas, Reportes, Solicitudes y Empresa están ✅ completos.

### Pedidos
- ✅ [B] Adjuntar o cambiar el comprobante de pago desde el pedido: `torogoz/pedido/[id].js` no usa `componentes/torogoz/fiscal/PagosDelPedido.js` — src/views/distribucion/PedidoModal.jsx

### Venta
- ✅ [M] Crear un cliente nuevo desde la venta (la hoja `ElegirCliente` no ofrece alta) — src/views/DistribucionVentaView.jsx
- ✅ [B] Adjuntar el comprobante de pago al cobrar — DistribucionVentaView.jsx + FormasDePago.jsx
- ✅ [B] Imprimir el ticket provisional de una venta sin señal — DistribucionVentaView.jsx
- ✅ [B] Mandar el documento al cliente por correo al sellarse (`enviarDocumentoPorCorreo` existe pero `useVenta.js` no lo llama) — DistribucionVentaView.jsx

### Marco de Torogoz
- ✅ [B] El aviso «N ventas sin señal» con «Enviar» sólo aparece dentro de la venta; en la web, en todo el marco — src/views/distribucion/TorogozLayout.jsx

### Escritas y apagadas por `ACCIONES_DE_DINERO = false`
Todas tienen código nativo completo (llamada, confirmación y bitácora): facturar un pedido o desde la venta; enviar/reenviar a Hacienda; cola sin señal; reenviar en bloque; contingencia; reenviar invalidación; corregir o descartar un documento; deshacer la venta; devolución / nota de crédito; anular pedido con documento; cargar el camión con Nota de Remisión, emitir la que faltó y «Cargar más»; descargar el camión; cobrar la cartera y anular un cobro; caja del vendedor; cerrar y reabrir liquidación; depósitos y cierre del día. Encenderlas es cambiar una línea en `apps/mobile/componentes/torogoz/soloConsulta.js`, cuando se prueben en sala.

**Total del grupo: A 0 · M 1 · B 5**

