# Auditoría de permisos por vista — 2026-08-03

Disparada por el pedido de hacer **canónicos** los permisos de las vistas
(descargar, ver cards, ver pestañas, y lo que cada vista necesite), después de
partir `facturas_compra_archivos` en `_abrir` + `_descargar` (v2.354.1).

Estado: **auditoría cerrada, ejecución pendiente de decisión del usuario.**
Ninguna clave se creó, borró ni modificó como parte de este documento.

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
| `schedules_tab_catalog` | 3 roles | no | no | Huérfana: rename fallido de `schedules_tab_shifts`. **Las dos viven en la BD**, y la que el código lee (`_shifts`) tiene MENOS roles en true (4) que la muerta (6) — o sea que el rename le quitó el acceso a alguien sin avisar. |
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

## 8. Decisiones pendientes del usuario

1. **Alcance de la ejecución**: (a) limpiar la deriva del §3, (b) `_descargar` en
   las 12 vistas del §4, (c) `_ver_montos` en las 9 del §5, (d) pestañas de
   Libros IVA y Compras.
2. **`staff_salary`**: implementarlo de verdad (frontend + server-side, porque
   hoy el salario viaja al navegador de cualquiera que abra el expediente), o
   borrarlo para que la pantalla deje de prometer un control que no existe.

Cualquier creación de claves nuevas debería seguir el patrón de v2.354.0:
**backfill en `true`** a los roles que ya tienen el módulo, para que el día del
despliegue nadie pierda acceso, y que el apagado sea una decisión explícita.
