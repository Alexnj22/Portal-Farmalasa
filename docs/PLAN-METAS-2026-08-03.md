# Plan — Módulo de Metas y Bonificaciones de Ventas

**Estado: FASE 1 COMPLETADA (v2.363.0 BD + v2.364.0 frontend, 2026-08-03).**
Mockup aprobado por el usuario antes de construir; QA Playwright 14/14 en
verde con los tres tramos del bono verificados contra ventas reales de julio.
Quedan las fases 2-5 (§10). Notas de lo construido:

- `comingSoon` se quitó en la FASE 1 (no en la 3 como decía §9 original): un
  módulo `comingSoon` no tiene `<Route>` — nadie podía entrar. El acceso lo
  controla `can_view` (el admin asigna en Permisos; el rol QA id=33 ya tiene
  metas por el barrido 60/60).
- El «hoy» de los RPC es el día de negocio SV (`America/El_Salvador`), no la
  fecha UTC (migración 20260804032349).
- Backtest de la proyección contra julio real: error medio ~3% (cortes 15 y
  22 jul; Salud 3 -9% por mayoreo atípico de fin de mes).
- **Pedido del usuario (2026-08-03): al FINALIZAR el módulo, agregar GRÁFICAS
  al Tablero** (tendencia de cumplimiento por mes, meta vs venta). Cargar el
  skill `dataviz` cuando se construyan.
- Pendiente del usuario: asignar permisos reales (Supervisor/a de Ventas =
  editar, Gerente General = aprobar) e ingresar sus metas históricas con
  «Agregar meta».

**El ciclo en una frase:** el día 25 el sistema calcula la meta propuesta del
mes siguiente por sala y notifica al supervisor; el supervisor ajusta y
confirma; el gerente aprueba; el día 1 cada sala ve su meta oficial en el
portal.

---

## 1. Contexto y regla de negocio

El negocio asigna una **meta mensual de venta por sala** y paga **bono por
cumplimiento**. Regla dictada por el usuario (2026-08-03, verbatim: «100% es
cumplido, 95% es se cumplió al 50%, y menos 95% nada. es porque se daba bono
por venta»):

| Cumplimiento del mes | Bono |
|---|---|
| ≥ 100% de la meta | Bono completo |
| ≥ 95% y < 100% | Medio bono (50%) |
| < 95% | Sin bono |

- Los umbrales (100 / 95) y sus pagos (100% / 50% / 0%) viven en
  **configuración en BD**, no harcodeados — pero cada mes cerrado congela su
  resultado (meta, venta real, %, bono logrado): el histórico NO se recalcula
  si una regla cambia después.
- El usuario **tiene el histórico de metas asignadas** (formato por confirmar,
  §8.4) — hay que importarlo para que el cumplimiento histórico exista desde
  el día uno.

## 2. Lo que ya existe y se aprovecha (verificado en prod 2026-08-03)

- **No hay ninguna tabla** de metas/goals/bonos — terreno limpio.
- **`sales_daily_stats` (date, branch_id, count_valid, sum_total)** — venta
  diaria por sala, refrescada cada 15 min (cron `refresh-sales-daily-stats`,
  ventana 3 días) + refresh completo diario (365 días). Es la fuente de
  cumplimiento y proyecciones; no hay que calcular nada nuevo de ventas.
  OJO: confirmar la base (§8.1) — `sum_total` es el total facturado.
- **Roles exactos del flujo**: `Supervisor/a de Ventas` (roles.id=13) y
  `Gerente General` (roles.id=2). Las salas: `Jefe/a de Sala` (19),
  `Subjefe/a de Sala` (20), `Dependiente de Farmacia` (30).
- **El módulo ya está anunciado**: `moduleMap.js` tiene `metas` con
  `comingSoon: true`, path `/metas`, y `permissionModules.js` lo describe
  («Dashboard de metas de ventas por sucursal con proyecciones y gráficas»).
  Quitar el `comingSoon` es parte de la Fase 1/3.
- **Notificaciones**: usar la arquitectura existente (tabla `notifications` +
  campana). El push llega a 4 de 59 dispositivos (problema conocido,
  `project_auditoria_notificaciones_2026_08_01`) — el diseño NO depende del
  push.
- Sucursales de venta: las 6 de `erp_sucursal_map WHERE NOT es_bodega`
  (La Popular, Salud 1-5). Bodega y Administración no llevan meta.
- `close_ventas_month` (cron mensual existente) es de otro dominio
  (facturación/vendedores) — no se toca ni se reusa.

## 3. Los tres cálculos

### a) Cumplimiento del mes en curso
`venta acumulada de la sala (sales_daily_stats) ÷ meta oficial`. En vivo
(frescura 15 min). Semáforo: verde en camino al 100%, amarillo rozando 95%,
rojo por debajo.

### b) Proyección de cierre del mes en curso
No regla de tres simple — perfil por día de semana:

```
proyección = acumulado + Σ (para cada día que falta del mes)
             promedio de venta de ese día-de-semana en esa sala,
             últimas 8 semanas (sales_daily_stats)
```

Los sábados no venden como los martes; la regla de tres plana se equivoca
sistemáticamente según en qué día de la semana caiga el corte. Mostrar
siempre como «proyección: $X (Y% de la meta)».

### c) Meta propuesta del mes siguiente

```
base        = venta del MISMO MES del año anterior (estacionalidad)
crecimiento = venta últimos 3 meses cerrados ÷ venta de esos mismos 3 meses
              el año anterior
propuesta   = base × crecimiento, redondeada a $100
fallback    = promedio de los últimos 3 meses cerrados
              (si no existe el mismo mes del año pasado — el histórico de
              ventas del portal arranca 2025-05)
```

Es un punto de partida: el supervisor SIEMPRE puede ajustar el monto antes de
confirmar. La propuesta y el ajuste quedan ambos guardados (auditoría de
quién decidió qué).

## 4. Flujo de confirmación

```
Día 25, 8:00 AM SV → cron genera propuestas de las 6 salas
                     → notificación al Supervisor/a de Ventas
        ↓
Supervisor          → revisa, ajusta montos, CONFIRMA
                     → notificación al Gerente General
        ↓
Gerente General     → APRUEBA  (o DEVUELVE con nota → re-notifica al supervisor)
        ↓
Día 1               → cada sala ve su meta oficial al entrar al portal
```

**Estados de una meta:** `propuesta` → `confirmada_supervisor` → `oficial`
(+ `devuelta` como paso intermedio si el gerente la regresa).

**Recordatorios:** día 28 si sigue en `propuesta` (al supervisor); día 30 si
sigue en `confirmada_supervisor` (al gerente). Si llega el día 1 sin
`oficial`: comportamiento por decidir (§8.3; recomendado: la sala ve
«pendiente» y los recordatorios siguen — el sistema no oficializa solo).

Cada transición → `appendAuditLog` + fila de auditoría en la tabla (quién,
cuándo, monto).

## 5. Modelo de datos (borrador)

```sql
metas_sucursal (
  id              bigint PK,
  branch_id       int  NOT NULL REFERENCES branches,
  year_month      text NOT NULL,            -- 'YYYY-MM', mismo formato que product_sales_monthly_agg
  monto_propuesto numeric,                  -- lo que calculó el sistema
  monto_meta      numeric NOT NULL,         -- el vigente (ajustado por supervisor; congelado al oficializar)
  estado          text NOT NULL,            -- propuesta | confirmada_supervisor | oficial | devuelta
  nota_devolucion text,
  propuesta_at    timestamptz, 
  supervisor_por  bigint REFERENCES employees, supervisor_at timestamptz,
  gerente_por     bigint REFERENCES employees, gerente_at    timestamptz,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (branch_id, year_month)
)

metas_config (umbral_bono_total numeric DEFAULT 100,
              umbral_bono_medio numeric DEFAULT 95,
              dia_propuesta int DEFAULT 25, ...)
```

Reglas de la casa que aplican (CLAUDE.md «Estructura BD»): RLS con policy
explícita (SELECT authenticated; escrituras SOLO vía RPCs SECURITY DEFINER que
validan permiso con `(SELECT auth_*())` envuelto), índice en la FK, montos
nunca escritos con update directo del cliente, autoría resuelta server-side
(nunca del parámetro del cliente). El histórico importado entra con estado
`oficial` y sus fechas en NULL o con nota «importado».

Cumplimiento: RPC/vista que junta `metas_sucursal` con el mensual de
`sales_daily_stats` — no se guarda la venta real por mes (se deriva), solo se
congela el RESULTADO del bono al cerrar el mes (columna o tabla
`metas_resultado` a definir en implementación).

## 6. Pantallas (4) y permisos

1. **Tablero** (supervisor + gerente): 6 tarjetas de sala — meta, acumulado,
   %, proyección de cierre, semáforo de bono.
2. ~~**Mi sala** (scope BRANCH): su meta grande, avance, proyección. Solo la
   suya.~~ **RETIRADA — es un widget del Inicio, ver §11** (2026-08-04).
3. **Histórico**: por mes y sala — meta, venta real, %, bono logrado. Incluye
   «Agregar meta de un mes anterior» (can_edit) para el ingreso manual de las
   metas históricas (decisión §8.4).
4. **Confirmación** (supervisor edita, gerente aprueba): propuestas del mes
   siguiente con contexto al lado (mismo mes año pasado, tendencia 3 meses),
   monto editable, botones confirmar/aprobar/devolver.

**Permisos** (`role_permissions`, módulo `metas`): `can_view` todos los del
módulo (scope BRANCH limita a su sala) · `can_edit` = Supervisor/a de Ventas
(proponer/ajustar/confirmar) · `can_approve` = Gerente General (en
`permissionModules.js` el módulo hoy tiene `hasApprove:false` — cambiarlo).

Todo con los canónicos de DESIGN.md (LiquidSelect, StatCard/CarrilCards,
DataTable, filter pills) y `gate:design` en verde. **Mockup visual ANTES de
implementar** (regla de la casa, `feedback_show_redesign_before_implementing`).

## 7. Crons nuevos

| Cron | Cuándo | Qué hace |
|---|---|---|
| `metas-proponer-mensual` | día 25, 8:00 SV (14:00 UTC) | calcula propuestas + notifica supervisor |
| `metas-recordatorios` | diario 28-31, 8:00 SV | recordatorio según estado pendiente |

(El cierre del mes no necesita cron propio si el resultado se congela con la
primera lectura después del día 1 — decidir en implementación; si se congela
con cron, va junto al de recordatorios.)

## 8. DECISIONES — CERRADAS con el usuario (2026-08-03)

1. **Base: CON IVA (total facturado).** El usuario preguntó qué es lo correcto
   contablemente; la respuesta que quedó: contablemente el ingreso real es la
   venta SIN IVA (el 13% se recauda para el Estado, no es ingreso), **pero
   para el bono las dos bases dan el mismo % de cumplimiento** — casi toda la
   venta de farmacia lleva el mismo 13%, así que meta y venta suben y bajan
   proporcionales mientras se midan en la misma base. Elegida la base CON IVA
   porque es el número que la sala VE en su corte del día y puede perseguir
   sin hacer cuentas; las metas históricas del negocio también estaban
   expresadas así. `sales_daily_stats.sum_total` ya es esa base. La
   contabilidad formal sigue midiendo ingreso neto en su propio módulo — son
   dos preguntas distintas y cada una usa su número.
2. **Solo por sala** en v1; por vendedor queda como fase futura.
3. **Día 1 sin aprobar → «meta pendiente»** y siguen los recordatorios. El
   sistema NUNCA oficializa una meta solo.
4. **Histórico: INGRESO MANUAL del usuario** — no hay archivo que importar.
   La pantalla Histórico (§6.3) incluye «Agregar meta de un mes anterior»
   (permiso can_edit): mes + sala + monto, entra como `oficial` con nota
   «histórico ingresado a mano» y su autoría. El cumplimiento histórico se
   calcula solo contra las ventas ya sincronizadas (desde 2025-05).

## 9. BONIFICACIONES — los otros dos tipos (agregado 2026-08-03)

El usuario amplió el alcance con capturas de su sistema anterior en Excel
(«cavernícola»): además del bono por cumplimiento de meta (§1), existen **bono
por producto(s)** y **bono por venta de laboratorio(s)**. Contexto CLAVE:
**las bonificaciones están SUSPENDIDAS hoy** — se construye la capacidad
completa, pero con un interruptor general apagado; **las metas corren SIEMPRE**
(el flujo §4 no depende de las bonificaciones: sirve para seguir el progreso
de cada sala aunque no haya bono).

Es el sucesor del módulo Promociones RETIRADO el 2026-07-28
(`project_promotions_module`: 6 tablas dropeadas, solo tuvo una promo de
prueba; quedó escrito «Bonificaciones se construirá de cero, con su propio
esquema»). No reusar nada de aquel; sí su lección: nada de caches que nunca se
llenan — todo se deriva de las ventas reales.

### 9a. Bono por producto(s)

Programa con vigencia (inicio–fin), **1 o más productos**, y tres montos por
unidad vendida: bono al **vendedor**, aporte al fondo de **Administración** y
aporte al fondo de **Bodega** (en su Excel: $1.00 / $0.25 / $0.25).

Definiciones cerradas con el usuario (2026-08-03):
- **El bono principal va AL VENDEDOR que hizo cada venta** — el portal ya lo
  sabe (`sales_invoices.cod_vendedor` → employees.code, el mismo join del
  drill de Ventas > Productos). Nada de conteo manual.
- **ADM y Bodega son FONDOS**: se acumula (unidades × monto) y el total se
  reparte entre las personas del área al fin de mes.
- Las unidades se cuentan en **unidades base** (una caja de 10 cuenta 10 — la
  misma lógica factor de Ventas > Productos, con factor 0 = 1). El campo
  «Factor» del Excel muere; queda `unidades_por_bono` (default 1) por si un
  bono es «$1 por cada 2 unidades».
- Anuladas/invalidadas descontadas solas (mismos filtros de estado de todo el
  módulo de ventas).

### 9b. Bono por venta de laboratorio(s)

Programa mensual con **1 o más laboratorios** y **niveles**: si la venta
mensual de esos laboratorios en la sala alcanza el umbral del nivel, cada
**persona base** de la sala gana el monto del nivel.

Definiciones cerradas con el usuario (2026-08-03):
- **Montos por nivel GLOBALES del programa** (ej. $10/$20/$30/$40 para todas
  las salas); lo que varía por sala es el **UMBRAL de venta** de cada nivel —
  exactamente como su Excel (Salud 4 necesita $4,250 para el nivel 1, Salud 5
  $1,800).
- **Cantidad de niveles flexible** (no fija en 4).
- **«Persona base» = todo empleado ACTIVO asignado a esa sala** en el mes
  (employees.branch_id + status).
- La venta por laboratorio por sala se deriva de las ventas reales
  (products.laboratorio_id) — la matriz del Excel se llena sola.

### 9c. Transversal a los 3 tipos

- **Interruptor general** `bonificaciones_activas` (hoy: apagado). Programas
  se pueden crear/configurar/simular igual; todo se calcula y muestra en
  **modo informativo** («esto se habría ganado») sin generar nada para pago.
- **Liquidación mensual unificada**: una pantalla de cierre — por persona:
  bono de meta + bonos de producto + bono de laboratorio = total; fondos ADM y
  Bodega con su total y reparto. El gerente aprueba → congelada y exportable
  para planilla. Suspendidas → la liquidación existe como informativa.
- **Simulador de costo** al crear un programa: «si hubiera corrido el mes
  pasado habría costado $X» con datos reales (sugerencia aceptada).
- **Sin retroactividad**: editar un programa aplica desde el día del cambio;
  lo ya ganado no se reescribe. Todo a bitácora.
- **Motivación en la vista de sala**: «te faltan $X para el siguiente nivel»
  (laboratorio) y barra de avance con proyección (meta).

### 9d. Modelo de datos adicional (borrador)

```sql
bono_programas (id, tipo 'producto'|'laboratorio', nombre,
                estado 'borrador'|'activo'|'suspendido'|'finalizado',
                inicio date, fin date,                 -- vigencia (producto)
                bono_vendedor numeric, unidades_por_bono int DEFAULT 1,
                bono_adm_unidad numeric, bono_bod_unidad numeric,
                comentarios, created_by, created_at)
bono_programa_productos    (programa_id, erp_product_id)
bono_programa_laboratorios (programa_id, laboratorio_id)
bono_niveles        (programa_id, nivel, monto_por_persona)   -- global del programa
bono_niveles_umbral (programa_id, nivel, branch_id, umbral_venta)
bono_liquidaciones  (year_month, estado 'borrador'|'aprobada', informativa bool,
                     aprobada_por, aprobada_at)
bono_liquidacion_detalle (liquidacion_id, employee_id NULL para fondos,
                          area 'vendedor'|'sala'|'adm'|'bodega',
                          tipo, programa_id, monto, detalle jsonb)
```

Mismas reglas de la casa que §5 (RLS, escrituras vía RPC DEFINER con permiso,
autoría server-side, resultados congelados).

## 10. Orden de construcción (actualizado)

- **Fase 1 — HECHA (v2.363.0 + v2.364.0)**: metas — tabla + config + ingreso
  manual del histórico + RPCs de cumplimiento y proyección + pantallas
  Tablero e Histórico.
- **Fase 2 — HECHA (v2.366.0 + v2.367.0)**: propuestas automáticas (fórmula
  con guardas: ventanas de historia completas o ritmo reciente; crecimiento
  acotado 0.80–1.25 — el backtest sin guardas explotaba +652%, con ellas
  5-7% de error), flujo confirmar→aprobar/devolver con candados de estado,
  pestaña Confirmación, ciclo diario (cron `metas-ciclo-diario` 8:00 SV) y
  notificaciones por rol. QA del ciclo entero 9/9.
- **Fase 3 — HECHA (v2.368.0 + v2.369.0)**: la meta de la sala salió como
  **widget del Inicio**, no como la pantalla «Mi sala» de §6.2 (decisión del
  usuario 2026-08-04, ver §11). `comingSoon` ya se había quitado en la Fase 1.
  Pulido: el buscador de la barra ahora filtra también en Confirmación (estaba
  puesto y no hacía nada), la leyenda de la barra de avance se alineó con las
  marcas que nombra, y la lista de salas de venta quedó en un solo lugar
  (`SALAS_VENTA` de `metasUtils`). QA de las tres pestañas en navegador con
  datos, sin errores de consola; datos de prueba borrados.
- **Fase 4**: bonificaciones — programas por producto y por laboratorio
  (config + cálculo + simulador), en modo informativo (interruptor apagado).
- **Fase 5**: liquidación mensual unificada + exportable para planilla.

Las metas van primero a propósito: son lo que está VIVO hoy (las
bonificaciones están suspendidas). Cada fase con su verificación (los cálculos
contra datos reales de `sales_daily_stats`/ventas antes de mostrar nada) y las
reglas de siempre: migraciones con archivo local + gates, mockup antes de UI,
bump por commit.

## 11. La meta de la sala es un WIDGET, no una pantalla (2026-08-04)

Decisión del usuario, reemplaza §6.2. El razonamiento: la meta es información
**ambiental** —la sala debería verla todos los días sin ir a buscarla, y el
Inicio es lo primero que abre cualquiera— y es **puntual**: importa el avance
de HOY, la proyección y cuánto falta, no una pantalla con tablas e histórico.
El módulo Metas queda entero para supervisión y gerencia.

Cómo quedó (`WidgetMetaSala.jsx` + RPC `get_meta_sala`):

- Un widget «Meta del mes» en las pestañas General y Comercial del Inicio, con
  su permiso propio `dash_meta_sala`. **Con scope ALL trae selector de sala;
  con BRANCH el RPC ignora el parámetro y devuelve la propia** — el candado no
  está en la pantalla, está en el servidor.
- Muestra: acumulado y % de la meta, la barra con los umbrales del bono y el
  rombo de la proyección, lo vendido HOY, y cuánto falta con su ritmo diario
  (`falta / días restantes`, hoy incluido). Tres estados verificados en
  navegador: con meta oficial, «Pendiente de aprobar» y «Sin meta».
- Se refresca solo cada 5 minutos y al volver a la pestaña. Un widget que dice
  «hoy llevas X» y se queda con el número de las 8 de la mañana miente.

**Por qué el RPC es SECURITY DEFINER y no reusa `get_metas_dashboard` a secas**
— es el hallazgo de la fase, y vale para cualquier dato que se le muestre a la
sala: ese RPC es INVOKER y su venta de HOY sale de `sales_invoices`, cuya
policy exige `ventas`/`minmax_ver_costos`/`dash_top_productos`. **Ningún rol de
sala tiene esos permisos**, así que la lectura no falla: devuelve cero filas y
el widget habría mostrado el mes sin el día de hoy. Medido con el JWT de una
Jefa de Sala real: por el camino ingenuo $3,667.17, por el RPC nuevo $4,145.67
— los $478.50 de ese día, en silencio. La matemática (proyección, tramo) sigue
saliendo de `get_metas_dashboard`: el envoltorio solo la deja verla.

**Pendiente de decidir**: los roles de sala (Jefe/a de Sala, Dependiente de
Farmacia) **no tienen el módulo `overview`** — no pueden abrir el Inicio, así
que otorgarles `dash_meta_sala` sin `overview` es un permiso muerto. Hoy el
widget se otorgó solo a Administrador, Gerencia, Supervisión y QA (scope ALL);
el reparto a las salas se hace desde la pantalla de Permisos y necesita las dos
llaves.
