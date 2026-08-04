# Plan — Módulo de Metas de Ventas por Sala

**Estado: DISEÑO PROPUESTO** — aprobación conceptual del usuario pendiente de 4
decisiones (ver §8). No se ha construido nada. Diseñado el 2026-08-03, en la
misma sesión que cerró la auditoría de Ventas > Productos (v2.355.1–v2.359.0).

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
2. **Mi sala** (scope BRANCH): su meta grande, avance, proyección. Solo la
   suya.
3. **Histórico**: por mes y sala — meta, venta real, %, bono logrado.
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

## 8. DECISIONES PENDIENTES del usuario (bloquean Fase 1)

1. **¿Meta con IVA o sin IVA?** Recomendado: CON IVA (total facturado — el
   número del corte del día de la sala). `sales_daily_stats.sum_total` ya es
   esa base.
2. **¿Solo por sala, o también por vendedor?** Recomendado: por sala en v1;
   por vendedor como fase futura.
3. **¿Qué pasa si el día 1 no está aprobada?** Recomendado: la sala ve
   «pendiente» y siguen los recordatorios (no se oficializa sola).
   Alternativa: la propuesta entra automática.
4. **¿En qué formato está el histórico de metas asignadas?** (Excel, papel,
   sistema anterior…) Define cómo se construye la importación.

## 9. Orden de construcción

- **Fase 1**: tabla + config + import del histórico + RPCs de cumplimiento y
  proyección + pantallas Tablero e Histórico. (Ya con esto el cumplimiento
  real es visible.)
- **Fase 2**: propuestas + flujo de confirmación completo + notificaciones +
  crons.
- **Fase 3**: vista «Mi sala» + quitar `comingSoon` + pulido + QA navegador.

Cada fase con su verificación (los cálculos de proyección contra datos reales
de `sales_daily_stats` antes de mostrar nada) y las reglas de siempre:
migraciones con archivo local + gates, mockup antes de UI, bump por commit.
