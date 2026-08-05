# Auditoría de permisos por vista — 2026-08-03

Disparada por el pedido de hacer **canónicos** los permisos de las vistas
(descargar, ver cards, ver pestañas, y lo que cada vista necesite), después de
partir `facturas_compra_archivos` en `_abrir` + `_descargar` (v2.354.1).

Estado: **auditoría cerrada y EJECUTADA** (v2.356.1, v2.360.0 y v2.361.0).
El canon vive en §7-bis, la matriz por vista en §7-ter, y desde v2.361.0 lo
vigila **`npm run gate:permisos`** (`scripts/permissions-gate.mjs`), que corre
solo en el pre-commit cuando el commit toca `src/`.

Queda abierto un único hallazgo, por decisión explícita del usuario:
`staff_salary` (ver §8). El gate lo imprime como aviso en cada corrida en vez de
silenciarlo o de quedarse rojo para siempre.

---

## 1. Método, y una trampa que casi arruina el informe

Se cruzaron TRES fuentes, no dos:

| Fuente | Qué es | Cómo se obtuvo |
|---|---|---|
| **Registro** | lo que se puede repartir en Permisos | 91 claves con `label:` en `src/constants/permissionModules.js` |
| **Código** | lo que la app realmente consulta | 85 claves (ver abajo) |
| **Base** | lo que existe en prod | 105 `module_key` distintos en `role_permissions` |

**La trampa.** El primer barrido —`grep "hasPermission('clave')"`— dio **42
claves registradas y nunca consultadas**, y era falso. El código gatea de tres
maneras distintas y solo una es un literal:

```js
hasPermission('facturas_compra_abrir')                  // literal  → sí lo ve el grep
hasPermission(`ventas_tab_${t.key}`)                    // plantilla → NO lo ve
showWidget('minmax_req', 'dash_minmax_req')             // indirecta → NO lo ve
<PermissionGuard moduleKey="ventas">                    // ruta      → NO lo ve
```

Expandiendo los patrones (los `TABS` de cada vista, el registro de widgets de
`DashboardView`, los `PermissionGuard` de `App.jsx`) la lista de "muertas" cae de
42 a **2 reales**. Es el mismo error que la memoria
`feedback_structural_grep_over_manual_dictionary` ya advierte: un grep literal
sobre un identificador construido dinámicamente **prueba ausencia de la cadena,
no ausencia del uso**.

Las 7 dudosas se verificaron una por una, incluida la base:

```sql
-- ¿alguna función o policy consulta la clave?
select p.proname from pg_proc p ... where pg_get_functiondef(p.oid) like '%staff_salary%'
```

Eso rescató a `conteo_ver_sistema` (la gatea la función `conteo_puede_ver_sistema`,
no el frontend) y confirmó que `staff_salary` no lo consulta **nadie**.

---

## 2. El hallazgo estructural: "Pestañas" es un cajón con dos cosas adentro

El registro tiene un único grupo `tabs:` por módulo, y ahí conviven pestañas
reales con capacidades que no son pestañas:

| Clave | ¿Pestaña? | Qué gatea de verdad |
|---|---|---|
| `ventas_tab_ventas`, `productos_tab_inventario`, … | sí | una pestaña |
| `minmax_ver_costos` | **no** | columnas de costo de compra/venta |
| `productos_tab_catalogo_costos` | **no**, y se llama `tab` | columnas de costo del catálogo |
| `conteo_ver_sistema` | **no** | la existencia del sistema (rompe el conteo ciego) |
| `facturas_compra_ver_montos` | **no** | las cards con `$` |
| `facturas_compra_abrir` / `_descargar` | **no** | abrir y descargar el archivo |

Por eso no hay canon: cada capacidad nueva se nombró como se pudo, y el peor
caso es `productos_tab_catalogo_costos`, que dice `tab` y gatea una columna.

---

## 3. Deriva entre registro, código y base

| Clave | En BD | Registrada | Consultada | Veredicto |
|---|---|---|---|---|
| `staff_salary` | 2 roles en true | sí | **no** | **Decorativa.** Cero referencias en `src/`, en funciones y en policies. El toggle "Salarios e Ingresos (datos sensibles)" no hace nada: el salario lo ve cualquiera que abra el expediente. |
| `dash_distribution` | 5 roles | sí | **no** | Widget eliminado — ya no está en `ALL_WIDGET_IDS` de `DashboardView`. Quedó el permiso. |
| `maintenance` | 2 roles | **no** | sí (`AppLayout`) | Se usa pero **no se puede repartir** desde Permisos. |
| `emp_home` | 4 roles | no | no | Huérfana |
| `emp_schedule` | 2 roles | no | no | Huérfana |
| `promociones`, `promociones_tab_activas`, `promociones_tab_bonificaciones`, `promociones_tab_historial` | 2 roles c/u | no | no | Huérfanas — módulo retirado (`project_promotions_module`) |
| `pedidos_tab_diferencias`, `pedidos_tab_en_curso`, `pedidos_tab_recepcion` | 2-3 roles | no | no | Huérfanas — rediseño de las pestañas de Pedidos |
| `schedules_tab_catalog` | 3 roles en true | no | no | Huérfana: rename fallido de `schedules_tab_shifts`. **Las dos vivían en la BD.** ~~El rename le quitó el acceso a 2 roles~~ — **CORREGIDO al aplicar la migración**: eso salió de comparar filas totales (6 contra 4) en vez de filas en `true` (3 contra 3). Las filas de más tenían `can_view=false` y no cargaban ningún acceso; el merge fue un no-op verificado. La clave muerta se borró igual. |
| `metas`, `bonificaciones`, `entrevistas` | sí | sí | no | **Legítimas**: `comingSoon: true` |
| `conteo_ver_sistema` | sí | sí | no en `src/` | **Legítima**: la gatea `conteo_puede_ver_sistema()` en la base |

**9 filas huérfanas**, 2 claves muertas registradas, 1 usada sin registrar.

---

## 4. Descargar — 13 lugares, 1 gateado

Facturas de Compra es hoy **la única** vista del portal con permiso de descarga.
El resto exporta o imprime sin más control que entrar al módulo.

| Vista | Qué se lleva | Sensibilidad | Permiso |
|---|---|---|---|
| `PayrollView` | boletas y planilla completas | **salarios** | — |
| `StaffManagementView` | CSV de personal | datos personales | — |
| `LibrosIvaView` | CSV de los 7 libros + paquete | fiscal | — |
| `LibroComprasCompletoView` | CSV del libro | fiscal | — |
| `CorteZView` | PDF por sucursal y de todas | fiscal | — |
| `AttendanceAuditView` | CSV de marcaciones por quincena | laboral | — |
| `CotizacionesView` | PDF de la cotización | precios | — |
| `productos/TabMinMax` | CSV de min/max | costos | — |
| `VentasPperdidasView` | CSV | — | — |
| `branch-tabs/TabHistory` | CSV de historial de sucursal | — | — |
| `inventario/ConteoDetailView` | hoja de conteo impresa | rompe el ciego | — |
| `pedidos/` (TabGenerar, LlegadaModal, FinalizarCajasModal) | impresión del pedido | — | — |
| `purchases/FacturasCompraView` | JSON / PDF / ZIP | fiscal | ✅ `facturas_compra_descargar` |

Nota: el `canvas.toBlob` de `productos/TabCatalogo.jsx:649` **no** es una
exportación — es compresión de la foto del producto. No cuenta.

---

## 5. Cards de monto — 3 gateadas, 9 no

Con gate: `facturas_compra_ver_montos`, `minmax_ver_costos`,
`productos_tab_catalogo_costos`.

Sin gate, mostrando `$` en cards o columnas: `CorteZView`, `LibrosIvaView`,
`LibroComprasCompletoView`, `VentasView`, `FacturacionView`, `ClientesView`,
`ConteoInventarioView`, `productos/TabInventario`, `productos/TabSinVenta`.

---

## 6. Pestañas — 6 de 36 vistas las filtran

| Filtran | No filtran, y sí importa |
|---|---|
| Facturación, Min/Max, Pedidos, Productos, Horarios, Ventas | **Libros IVA** (7 libros fiscales distintos en una vista) y **Compras** (Facturas / Productos) |

En el resto las pestañas son cortes de los mismos datos y no ameritan permiso.

---

## 7. Propuesta: vocabulario de cinco sufijos

| Sufijo | Para qué | Ya existe como |
|---|---|---|
| `<modulo>_tab_<x>` | pestañas de verdad | patrón dominante (6 vistas) |
| `<modulo>_descargar` | exportar, descargar, imprimir | `facturas_compra_descargar` |
| `<modulo>_abrir` | abrir un documento/archivo en pantalla | `facturas_compra_abrir` |
| `<modulo>_ver_montos` | cards y columnas con `$` | `facturas_compra_ver_montos` |
| `<modulo>_ver_costos` | costo de compra | `minmax_ver_costos` |

Y en `permissionModules.js`, separar `tabs:` de un `capacidades:` nuevo, para que
`minmax_ver_costos` deje de aparecer disfrazado de pestaña. Renombrar
`productos_tab_catalogo_costos` → `productos_ver_costos`.

**Regla que sale de v2.354.0/1 y vale para todo lo de arriba:** un permiso de
datos que solo vive en el frontend es decorativo. `_descargar` de un CSV que se
arma en el navegador con datos que el rol ya puede leer **no** es un control de
seguridad — es orden de interfaz. El control real exige que el dato no llegue:
policy, RPC o edge function. Escribirlo en cada caso, como se hizo con
`purchase_dte_storage_select` y `export-purchase-dte-manifest`.

---

## 7-bis. EL CANON (decidido con el usuario, 2026-08-03)

### Los cinco sufijos

| Sufijo | Cuándo se usa | ¿Hace falta server-side? |
|---|---|---|
| `<modulo>_tab_<x>` | la vista tiene pestañas que son **cuerpos de datos distintos** (no cortes del mismo) | no, salvo que la pestaña traiga datos que el rol no debería leer |
| `<modulo>_abrir` | la vista muestra un **documento o archivo almacenado** | **sí** — policy de Storage |
| `<modulo>_descargar` | la vista **exporta, descarga o imprime** | **sí, si el archivo lo arma el servidor**. Si el CSV se arma en el navegador con datos que el rol ya puede leer, es orden de interfaz, no seguridad — decirlo en el comentario |
| `<modulo>_ver_montos` | hay cards o columnas con `$` **que no son el propósito de la vista** | recomendable (RPC o policy) |
| `<modulo>_ver_costos` | costo de compra | **sí** — policy |

### Las seis reglas

1. **El nombre empieza por la clave del módulo.** `facturas_compra_descargar`,
   nunca `descargar_facturas`. Así el permiso se ordena solo junto a su módulo
   y se ve de un vistazo qué vista toca.
2. **`_tab_` es SOLO para pestañas.** Una capacidad jamás se llama `tab`. Es el
   error que hay que deshacer en `productos_tab_catalogo_costos`.
3. **La clave se registra en `permissionModules.js` el mismo día que el código la
   consulta.** Lo que no está en el registro no se puede repartir — es lo que
   pasó con `maintenance` (v2.356.1) y lo que deja filas huérfanas en la base.
4. **Backfill en `true`** para todo rol que ya tiene el módulo. Nadie pierde
   acceso el día del despliegue; apagar es una decisión explícita y reversible.
5. **Si el permiso protege datos, tiene que existir del lado del servidor.** Un
   gate que solo esconde botones es decorativo
   (ver `feedback_client_side_credentials_are_decorative`).
6. **El label habla del portal**, no del sistema de origen ni de la tubería
   (regla de CLAUDE.md, "la pantalla habla del PORTAL").

### `_ver_montos` no aplica cuando el monto ES la vista

En Cotizaciones o en Ventas, esconder los `$` deja una pantalla sin sentido: el
precio es el contenido, no un adorno. El sufijo es para vistas donde el monto es
**una columna más** —Clientes, Conteo, Inventario— o donde el número es
contable y el operativo no lo necesita. Aplicarlo por simetría sería ruido.

---

## 7-ter. Matriz por vista

`TIENE` = permisos que consulta hoy · `QUITAR` = deriva a limpiar ·
`AGREGAR` = propuesta. En negrita, las de prioridad alta (datos sensibles).

| Módulo | Tiene hoy | Quitar | Agregar |
|---|---|---|---|
| `overview` (Dashboard) | `overview` + 17 `dash_*` | `dash_distribution` (widget eliminado) | — |
| `staff_list` | `staff_list` | — | **`staff_list_descargar`** (CSV del padrón) |
| `staff_detail` | `staff_detail` | — | — (`staff_salary` queda pendiente por decisión del usuario) |
| `monitor` | `monitor` | — | — |
| `time_audit` | `time_audit` | — | `time_audit_descargar` (CSV de marcaciones) |
| `schedules` | `schedules` + 3 `_tab_` | `schedules_tab_catalog` (BD; migrar sus roles a `_shifts`) | — |
| `requests` | `requests` | — | — |
| `vacation_plan` | `vacation_plan` | — | — |
| `payroll` | `payroll` | — | **`payroll_descargar`** (boletas y planilla con salarios) |
| `ventas` | 3 `ventas_tab_*` | — | — (el monto ES la vista) |
| `facturacion` | `facturacion` + 5 `_tab_` | — | `facturacion_ver_montos` |
| `cotizaciones` | `cotizaciones` | — | `cotizaciones_descargar` (PDF) |
| `clientes` | `clientes` | — | `clientes_ver_montos` (facturación por cliente) |
| `productos` | 3 `_tab_` + `productos_tab_catalogo_costos` | el nombre `productos_tab_catalogo_costos` | `productos_ver_costos` (mismo permiso, nombre canónico) |
| `minmax` | `minmax`, 2 `_tab_`, `_tab_solicitudes`, `minmax_ver_costos` | — | `minmax_descargar` (CSV) |
| `ventas_perdidas` | — | — | `ventas_perdidas_descargar` |
| `compras` | — | — | `compras_ver_montos`, `compras_tab_facturas`, `compras_tab_productos` |
| `proveedores` | `proveedores` | — | — |
| `conteo_inventario` | `conteo_inventario`, `conteo_ver_sistema` | — | `conteo_descargar` (hoja impresa — **rompe el ciego igual que ver la existencia**), `conteo_ver_montos` |
| `laboratorios` | — | — | — |
| `pedidos` | 5 `pedidos_tab_*` | `pedidos_tab_{diferencias,en_curso,recepcion}` (BD) | `pedidos_descargar` (impresión del pedido) |
| `facturas_compra` | `facturas_compra`, `_abrir`, `_descargar`, `_ver_montos` | — | ✅ **es el modelo del canon** |
| `libros_iva` | — | — | **`libros_iva_descargar`**, `libros_iva_ver_montos`, `libros_iva_tab_<7 libros>` |
| `libro_compras_completo` | — | — | **`libro_compras_completo_descargar`**, `_ver_montos` |
| `corte_z` | — | — | **`corte_z_descargar`** (PDF), `corte_z_ver_montos` |
| `branches` | `branches` | — | `branches_descargar` (CSV de historial) |
| `roles` | `roles` | — | — |
| `announcements` | `announcements` | — | — |
| `encuesta` | — | — | — |
| `encuesta_admin` | `encuesta_admin` | — | — |
| `emp_requests` · `emp_announcements` · `emp_profile` · `emp_documents` | vía `PermissionGuard` | `emp_home`, `emp_schedule` (BD) | — |
| `kiosk_pin` · `su_pin` | ambos | — | — |
| `permissions` · `auditview` · `ios_test` · `sync_health` · `orphan_objects` | cada uno el suyo | — | — |
| `maintenance` | `maintenance` | — | ✅ registrado en v2.356.1 |
| — (retirados) | — | `promociones` + sus 3 `_tab_` (BD) | — |

**Total:** 9 filas huérfanas y 2 renombres a limpiar · 19 claves nuevas a crear,
de las cuales 4 son de prioridad alta (`payroll_descargar`,
`staff_list_descargar`, `libros_iva_descargar`, `corte_z_descargar` /
`libro_compras_completo_descargar`).

---

## 8. Decisiones pendientes del usuario

**Resueltas el 2026-08-03:**

- **`staff_salary` queda como está.** No se implementa ni se borra en este
  trabajo. Sigue siendo un hueco abierto y **el más serio del informe**: la
  pantalla ofrece un control de "datos sensibles" que no existe en ninguna capa,
  y el salario viaja al navegador de cualquiera que abra el expediente.
- **Las claves nuevas arrancan encendidas** (backfill en `true` a todo rol que ya
  tiene el módulo), igual que v2.354.0. Apagar es decisión explícita y reversible.
- **El canon quedó definido** (§7-bis) y la matriz por vista también (§7-ter).

**Sigue abierto:** el orden de ejecución de las 19 claves nuevas y de la limpieza
de las 9 filas huérfanas.
