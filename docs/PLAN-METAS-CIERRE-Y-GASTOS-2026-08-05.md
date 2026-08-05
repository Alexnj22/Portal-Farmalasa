# Plan — Metas: cierre de la auditoría + Gastos por recuperar

**Fecha:** 2026-08-05 · **Estado: los 6 bloques de código, CERRADOS el mismo día.**

| Bloque | Versión | Commit |
|---|---|---|
| A1 — candado de estado en el ingreso manual | v2.372.2 | `13cb85b5` |
| A7 — bitácora `metas_historial` | v2.372.3 | `51f2f539` |
| A3+A4+A5 — lote del gerente, avisos, aviso en Bono | v2.373.0 | `fbc6f8eb` |
| B — gastos por recuperar (motor) | v2.374.0 | `4c85f8e9` |
| B — gastos por recuperar (pantallas) | v2.376.0 | `52c3e2b1` |
| A2 — congelar el resultado del mes | v2.378.0 | `b87fba61` |

**Sigue ABIERTO, y depende del usuario, no del código:** A6 (permisos de sala —
26 personas sin `overview` no ven su widget), A8 (período de prueba: 2 de 35 con
`hire_date`), A9 (gráficas del Tablero), el tramo 90-95% de la jefatura, la
cobertura de horarios, y las Fases 4 y 5 del plan original.

Correcciones del usuario al mockup, ya aplicadas: el vacío de Gastos no explica
la regla, y **el desglose de la meta es solo administrativo** — vive en Tablero y
Confirmación, y el widget de la sala muestra únicamente su meta.
**Antecede:** `docs/planes-cerrados/PLAN-METAS-2026-08-03.md` (diseño del módulo, Fases 1-3 hechas).
Este documento es el que manda de acá en adelante para Metas.

Dos cosas distintas viven acá porque se tocan:

- **Parte A** — los 9 hallazgos de la auditoría del 2026-08-05 (módulo entero:
  8 pantallas, 16 RPC leídos del catálogo de prod, policies, cron y datos).
- **Parte B** — funcionalidad nueva pedida por el usuario el 2026-08-05:
  cargar **gastos por recuperar** a una o varias salas, que se suman a su meta
  convertidos a venta por un margen de ganancia.

Se tocan porque los dos escriben sobre `metas_sucursal.monto_meta`: la Parte B
agrega una columna que el hallazgo A2 (congelar el resultado) tiene que
congelar también, y el hallazgo A1 (el modal que saltea el flujo) es
exactamente el agujero por el que un gasto podría entrar sin aprobación.

---

# PARTE A — Los 9 hallazgos

## Lo que la auditoría confirmó que está bien

Para que no se relea: RLS activa en las dos tablas con policy explícita de
SELECT y **cero** policies de escritura (todo pasa por RPC `SECURITY DEFINER`
que validan permiso con `auth_has_module_permission`); índices de FK completos;
`gate:design` en verde; advisors de seguridad en **0 errores** (los WARN de
«authenticated puede ejecutar una función DEFINER» son por diseño — cada una
valida permiso adentro); el flujo confirmar→aprobar/devolver tiene candado de
estado real (`SELECT … FOR UPDATE` + validación de `estado`); el histórico
tiene 20 meses × 6 salas cargados (ene-2025 → jul-2026); y el bono está
verificado al centavo contra el Excel de La Popular de julio.

**Corregido de la sesión anterior:** el Gerente General **sí tiene** el permiso
de Metas — `role_permissions` lo registra otorgado el 2026-08-04 a las
17:59:17 UTC, dos minutos antes de que el usuario confirmara las 6 metas de
agosto (18:01:36–18:01:57). Rutilio Aleman tiene login. Agosto no está
bloqueado por permisos: está esperando que entre y apruebe.

---

## 🔴 A1 — «Agregar meta» saltea el flujo entero

`upsert_meta_manual` no mira el estado de la fila que pisa:

```sql
ON CONFLICT (branch_id, year_month) DO UPDATE
SET monto_meta = EXCLUDED.monto_meta,
    estado     = 'oficial',        -- ← sin importar en qué estado estaba
    ...
```

Y `MetaModal.jsx:35-43` ofrece todos los meses desde mayo-2025 hasta el mes
siguiente, con las 6 salas, tenga o no meta ya.

**Camino real hoy**, con solo `can_edit`: Tablero → mes actual → «Agregar
meta» → una sala que está en «Espera aprobación» → escribir un monto →
**queda `oficial`**, sin gerente, sin notificación y sin rastro fuera del
`appendAuditLog` del navegador. Todo el trabajo de las v2.366→v2.372 se evita
con un modal. El mismo camino reescribe la meta de un mes cerrado y ya pagado.

**Arreglo.** El RPC decide según el estado de destino:

| Estado actual de la fila | Qué hace |
|---|---|
| No existe | INSERT como hoy (`oficial`, es el ingreso del histórico) |
| `oficial` de un mes **cerrado** | Permitido, pero deja rastro (ver A7) y exige nota |
| `oficial` del mes **en curso o futuro** | `ESTADO_INVALIDO` — se corrige devolviéndola, no pisándola |
| `propuesta` / `devuelta` | Actualiza el monto **conservando el estado** — no oficializa |
| `confirmada_supervisor` | `ESTADO_INVALIDO` — esa meta ya es del gerente |

Y el modal deja de ofrecer meses/salas que no corresponden, con el motivo
escrito en pantalla en vez de un error al guardar.

---

## 🔴 A2 — Nada se congela: el histórico se recalcula solo

`get_metas_historico` calcula `bono_tier` en vivo:

```sql
CROSS JOIN public.metas_config c
...
WHEN venta / m.monto_meta * 100 >= c.umbral_bono_total THEN 'completo'
```

No existe ninguna tabla de resultado. **Cambiar `bono_pct_venta` (0.5%) o
`umbral_bono_medio` (95) reescribe el resultado de los 20 meses cerrados**,
incluidos los bonos que ya se pagaron. El plan original lo decidió al revés
(§1: «el histórico NO se recalcula si una regla cambia después»).

**Arreglo.** Tabla `metas_resultado`, una fila por (sala, mes) congelada la
primera vez que se lee un mes ya cerrado — o por el cron del día 1, que es más
predecible que «la primera lectura»:

```sql
metas_resultado (
  branch_id, year_month,           -- PK
  monto_base, monto_recuperacion, monto_meta,   -- la meta como estaba
  venta_total, pct_cumplimiento, bono_tier,
  -- las reglas vigentes ESE mes, copiadas:
  umbral_total, umbral_medio, bono_pct_venta, pago_medio_pct, margen_pct,
  bolsa, congelado_at
)
```

`get_metas_historico` lee de ahí para los meses congelados y sigue derivando
solo el mes en curso. Un mes ya congelado no se vuelve a calcular jamás.

---

## 🟠 A3 — Falta el lote del lado del gerente

Hay «Confirmar las N · $total» (v2.372.1) para el supervisor. No hay
**«Aprobar las N»** para el gerente, ni **«Registrar la autorización» en
lote**. Agosto son 6 aprobaciones una por una; por el camino de la
autorización verbal, 6 veces eligiendo persona y escribiendo la nota.

**Arreglo.** Simétrico al que ya existe, mismo patrón: `aprobar_metas_lote`
y `aprobar_metas_por_autorizacion_lote` que recorren la función individual
dentro de una transacción, y el botón en el encabezado del grupo con la cuenta
y el total. La autorización en lote pide **una sola vez** quién autorizó y
cómo, y la aplica a todas.

---

## 🟠 A4 — El cron avisa todos los días, sin memoria

`metas_ciclo_diario` manda «La meta de X sigue pendiente» a supervisor **y**
gerente cada día que el mes en curso no esté oficial, y `metas_notificar_rol`
inserta sin deduplicar nada.

**Medido:** hoy 2026-08-05 a las 14:00 UTC entraron 3 notificaciones (2 de
«sigue pendiente» + 1 de «Metas por aprobar», porque el día ≤ 5 también
dispara el recordatorio del gerente). Ninguna leída. Mañana entran 2 más, y
así hasta que agosto se apruebe.

**Arreglo.** Dos capas:

1. **Ritmo**: el aviso de «mes en curso sin oficializar» no es diario — día 1,
   día 3 y después una vez por semana. Un recordatorio que llega todos los
   días deja de leerse en tres días.
2. **Dedupe**: `metas_notificar_rol` no inserta si ya existe una notificación
   **sin leer** del mismo `type` + `title` para esa persona. Es una guarda
   general que sirve para todo el módulo, no un parche del cron.

---

## 🟠 A5 — La pestaña Bono calcula sobre una meta no aprobada, sin decirlo

`get_bono_meta_sala` devuelve `estado_meta` en su JSON. `TabBono.jsx` **no lo
usa nunca** (`sinMeta` solo mira si `meta` es null). Ahora mismo agosto está en
`confirmada_supervisor` y la pestaña muestra bolsa, jefatura, equipo y el
reparto persona por persona como si la meta fuera definitiva. El Tablero sí
pinta «Pendiente de aprobar»; la pantalla del dinero, no.

**Arreglo.** Aviso arriba de la tabla cuando `estado_meta <> 'oficial'`: la
meta todavía no es definitiva, así que el reparto puede cambiar. Mismo texto y
mismo tono que el badge del Tablero.

---

## 🟡 A6 — Las salas siguen sin ver su meta

El widget «Meta del mes» vive en el Inicio y necesita **dos** permisos:
`overview.can_view` para abrir el Inicio y `dash_meta_sala.can_view` para ver
el widget. Medido en prod:

| Rol | Activos | `overview` | `dash_meta_sala` |
|---|---|---|---|
| Jefe/a de Sala | 6 | ❌ | ❌ |
| Dependiente de Farmacia | 20 | ❌ | ❌ |

**26 personas no pueden ver su meta** — que era exactamente el motivo de
haberla hecho widget («la sala debería verla todos los días sin ir a
buscarla»). Es una asignación de permisos, no código: se hace desde la
pantalla de Permisos y necesita las dos llaves.

**Decisión pendiente del usuario:** ¿se les abre el Inicio a los roles de
sala? Abrirlo trae consigo el resto de los widgets que tengan permiso (hoy
ninguno), así que el riesgo es bajo, pero es su llamada.

---

## 🟡 A7 — Sin bitácora del lado del servidor

Las transiciones solo se anotan con `appendAuditLog` desde el navegador. Un
RPC llamado por fuera del portal no deja nada; `monto_meta` se sobrescribe en
sitio (el valor anterior se pierde) y las columnas `supervisor_por`/
`gerente_por` guardan solo al **último** actor. El plan original (§4) pedía
«fila de auditoría en la tabla (quién, cuándo, monto)».

**Arreglo.** `metas_historial` append-only (sin policy de DELETE, como el
resto del historial de negocio): `meta_id, evento, estado_antes, estado_despues,
monto_antes, monto_despues, actor, nota, at`. La escriben los propios RPC. Es
también lo que hace defendible el A1 (pisar la meta de un mes cerrado deja de
ser invisible).

---

## 🟡 A8 — «En prueba» está muerto

La mitad del bono para quien lleva menos de 3 meses sale de `hire_date`.
Medido: **2 de 35** empleados de sala la tienen (La Popular 1, Salud 1 1, el
resto en cero). El badge existe y casi nunca se enciende.

Sigue esperando la decisión del usuario, ya registrada en el plan anterior
(§12b.1): un estado propio del empleado, o completar las fechas de ingreso.
**No se toca hasta que eso se decida** — implementar sobre un dato que no
existe es inventar.

---

## 🟡 A9 — Lo ya sabido, sin arrancar

Sin novedad respecto del plan anterior, listado para que no se pierda:

- **Gráficas del Tablero** (pedido del usuario 2026-08-03): tendencia de
  cumplimiento por mes, meta vs. venta. Cargar el skill `dataviz`.
- **Tramo 90-95%** de la jefatura (§12b.2): sin definición, no se inventa.
- **Cobertura de horarios** (§12a): los $11,875 de Salud 2 vendidos por
  personal asignado a otra sala esperan al módulo de horarios.
- **Fases 4 y 5**: bonos por producto y por laboratorio, liquidación mensual.

---

# PARTE B — Gastos por recuperar

## B0. La regla, en una frase

Un gasto de la empresa se le carga a una o varias salas y **se convierte en
meta**: no se suma como venta, se suma como **ganancia a recuperar**. Con un
margen de 25%, recuperar $1,000 exige **$4,000** de venta.

```
venta a agregar = monto del gasto ÷ (margen ÷ 100)

$1,000 ÷ 0.25 = $4,000
```

Repartido en N meses, cada mes carga su parte:

```
Gasto $1,000 en Salud 3, a 4 meses, margen 25%

           gasto/mes   venta que agrega   meta base   meta total
sep-2026     $250          $1,000          $40,000     $41,000
oct-2026     $250          $1,000          $41,500     $42,500
nov-2026     $250          $1,000          $42,000     $43,000
dic-2026     $250          $1,000          $44,000     $45,000
```

## B1. Las cuatro decisiones, cerradas con el usuario (2026-08-05)

1. **El margen es fijo y vive en configuración** — un solo número
   (`metas_config.margen_recuperacion_pct = 25`), editable por quien
   administra. Todos los gastos usan el mismo. **Se congela en el gasto al
   crearlo**: cambiar el 25% mañana no reescribe lo ya cargado (misma regla
   que A2 — lo decidido no se recalcula).
2. **El cumplimiento y el bono se miden contra la meta TOTAL** (base +
   recuperación). Es lo que hace que el gasto realmente empuje: con meta base
   $40,000 y $4,000 de recuperación, vender $41,000 es **93.2%** y no hay
   bono, aunque contra la base habría sido 102.5%.
   *(Nota: la bolsa del bono ya se calcula sobre lo vendido, no sobre la meta
   — eso no cambia. Lo que cambia es el umbral que hay que cruzar.)*
3. **Solo se cargan gastos a meses que todavía no arrancaron.** Nadie ve su
   meta moverse a mitad de mes. El RPC valida `year_month > mes actual SV`.
4. **El monto de cada sala se define a mano.** Se eligen las salas y se
   escribe cuánto le toca a cada una — nada de reparto automático.

## B2. Consecuencia de la decisión 3, resuelta acá

Un mes futuro puede tener su meta ya `confirmada_supervisor` u `oficial` (las
propuestas salen el día 25). Si se le carga un gasto, el número que el gerente
aprobó cambia después de aprobado.

**Regla:** cargar un gasto a una meta que ya está `confirmada_supervisor` u
`oficial` la **devuelve a `propuesta`**, con nota automática («se agregó
$X de recuperación de gastos»), y vuelve a pasar por confirmar → aprobar. El
supervisor y el gerente reciben el aviso. Nadie cambia una meta aprobada sin
que el gerente la vuelva a ver — es la misma promesa que defiende A1.

Si la meta del mes todavía no existe, la cuota queda esperando y
`generar_propuestas_metas` la suma al crear la fila.

## B3. Modelo de datos

Todo con las reglas de la casa: PK, `created_at`, RLS con policy explícita de
SELECT, escrituras solo por RPC `SECURITY DEFINER` con permiso y autoría
resuelta en el servidor, índice en cada FK.

```sql
-- El gasto, una vez
metas_gasto (
  id            bigint PK,
  concepto      text NOT NULL,        -- «Aire acondicionado Salud 3»
  monto_total   numeric NOT NULL,     -- suma del reparto, verificado
  margen_pct    numeric NOT NULL,     -- copiado de metas_config al crear
  meses         int NOT NULL,         -- en cuántos se reparte (1 = todo junto)
  ym_inicio     text NOT NULL,        -- primer mes ('YYYY-MM')
  nota          text,
  estado        text NOT NULL,        -- activo | anulado
  creado_por    uuid, created_at, anulado_por uuid, anulado_at, anulado_nota
)

-- Cuánto le toca a cada sala (a mano, decisión 4)
metas_gasto_sala (
  gasto_id, branch_id, monto,  PK (gasto_id, branch_id)
)

-- La cuota por sala y mes: es lo que se suma a la meta.
-- Se MATERIALIZA para congelar margen y reparto del momento en que se cargó.
metas_gasto_cuota (
  id, gasto_id, branch_id, year_month,
  monto_gasto  numeric,   -- la parte del gasto de ese mes/sala
  monto_venta  numeric,   -- monto_gasto ÷ (margen_pct/100) — lo que suma a la meta
  estado       text,      -- pendiente | aplicada | anulada
  UNIQUE (gasto_id, branch_id, year_month)
)
```

**En `metas_sucursal`, tres columnas explícitas** en vez de derivar:

```sql
monto_base         numeric   -- lo que se propuso/confirmó como venta
monto_recuperacion numeric NOT NULL DEFAULT 0   -- suma de cuotas de ese mes/sala
monto_meta         numeric   -- base + recuperación ← sigue siendo LA verdad
```

Así **ningún RPC de lectura cambia su matemática**: `get_metas_dashboard`,
`get_meta_sala`, `get_bono_meta_sala` y `get_metas_historico` siguen leyendo
`monto_meta`. El desglose queda disponible para mostrarlo, que es lo único que
la UI necesita de más. Migración de las 119 filas existentes:
`monto_base = monto_meta`, `monto_recuperacion = 0`.

El redondeo del reparto en N meses: la diferencia de centavos va **al último
mes**, y la suma de las cuotas tiene que dar exacto el monto de la sala —
verificado en la migración, no asumido.

## B4. Pantallas

**Pestaña «Gastos»** en Metas (quinta), con permiso `can_edit`. Es un catálogo
con ciclo de vida propio (crear, ver, anular), y Confirmación es una mesa de
trabajo mensual: no van juntos.

- Lista de gastos con concepto, monto, en cuántos meses, desde qué mes, qué
  salas y cuánto le agrega a cada una.
- «Agregar gasto»: concepto, monto, mes de inicio, en cuántos meses, y las
  salas con su monto. **Vista previa antes de guardar**: mes por mes y sala por
  sala, cuánto le suma a la meta. Nadie carga un gasto a ciegas.
- Anular: las cuotas **futuras** se anulan y las metas se recalculan; las de
  meses ya arrancados quedan como están.

**Donde ya se ve la meta**, el desglose — Tablero, Confirmación y el widget de
la sala:

> Meta **$44,000** — $40,000 de venta más $4,000 por recuperación de gastos

El widget de la sala es el que **más** lo necesita: si la meta sube y nadie
explica por qué, la sala lo lee como que le movieron la vara.

## B5. Cómo se dice en pantalla

Regla de la casa (`feedback_la_pantalla_habla_del_portal`): en términos del
negocio, nunca de la tubería ni de la contabilidad interna.

| No | Sí |
|---|---|
| Amortización / prorrateo | **Se recupera en 4 meses** |
| Margen de contribución | **Con 25% de ganancia** |
| «Meta ajustada por CAPEX» | **Meta con gastos por recuperar** |
| Monto imputado | **Le agrega $4,000 a la meta** |

Y el número que explica la conversión, dicho una vez y claro:
«Recuperar $1,000 con 25% de ganancia pide $4,000 de venta.»

---

# Orden de ejecución

Cada bloque cierra con su commit, su bump y sus gates. Migraciones con
`SET lock_timeout = '5s'` y **archivo local en el mismo commit** con la versión
de 14 dígitos que devuelva el servidor.

| # | Bloque | Qué entra | Por qué en ese orden |
|---|---|---|---|
| 1 | **A1** | Candado de estado en `upsert_meta_manual` + modal | Es el agujero por el que un gasto entraría sin aprobación. Va antes que la Parte B, sí o sí. |
| 2 | **A7** | `metas_historial` + escribirlo desde todos los RPC | La Parte B agrega dos RPC que escriben metas; que nazcan ya con bitácora. |
| 3 | **A3 + A4 + A5** | Lote del gerente · ritmo y dedupe de avisos · aviso en Bono | Los tres son de una tarde y arreglan lo que duele esta semana con agosto. |
| 4 | **B — datos** | Tablas, columnas de `metas_sucursal`, RPC de crear/anular, recálculo | El motor completo, verificable por SQL antes de pintar nada. |
| 5 | **B — pantallas** | Pestaña Gastos + desglose en Tablero, Confirmación y widget | Mockup ANTES de implementar (regla de la casa). |
| 6 | **A2** | `metas_resultado` + congelamiento | Tiene que congelar también `monto_base`/`monto_recuperacion`, así que va después de la Parte B. |
| 7 | **A6** | Permisos de sala | Decisión del usuario, no código. |
| 8 | **A9** | Gráficas del Tablero | Cierra el módulo; `dataviz`. |

**No entran** hasta que el usuario decida: A8 (período de prueba), tramo
90-95%, cobertura de horarios, Fases 4 y 5.

## Verificación exigida en cada bloque

- La aritmética del gasto, contra números escritos a mano en este documento
  (el ejemplo de B0 es el caso de prueba: $1,000 / 4 meses / 25% → $1,000 de
  venta por mes, cuatro meses, suma exacta).
- **Recorrer TODAS las columnas** de lo que se replica, no los totales
  (`feedback_verificar_todas_las_columnas_no_los_totales`).
- Lo que se ve en pantalla se verifica **en el navegador**, no grepeando el
  fuente — incluidos `title`/`aria-label`/`placeholder`.
- Datos de prueba: creados y **borrados** al terminar, y dicho cuáles fueron.
  Sobre las metas reales no se toca nada sin permiso en el momento.

---

# PARTE C — La fórmula de la meta

## C1. La vigente, desde 2026-08-05 — **A PRUEBA**

Decisión del usuario. Reemplazó al cálculo con peso estacional y empuje (§C2).

> **Está a prueba, no cerrada.** El usuario la puso a consideración y avisó
> (2026-08-05): *«cuando me confirmen, te digo, nos mantenemos, o volvemos a la
> fórmula»*. Si la respuesta es volver, §C2 tiene todo lo necesario —los valores
> de configuración incluidos— y las metas de agosto tendrían que recalcularse de
> nuevo, igual que se hizo al cambiarla (§C3).

```
ritmo = (venta m-3 + venta m-2 + venta m-1) ÷ (días m-3 + días m-2 + días m-1)

Meta = ritmo × días del mes objetivo × Factor
```

El **Factor** sale de cómo cerró la sala el **mes −1** —el más reciente de los
tres que forman el ritmo, para que la fórmula use un solo conjunto de meses—:

| Cumplimiento del mes −1 | Factor |
|---|---:|
| ≥ 95% | 1.02 |
| 90% – 94.99% | 1.05 |
| < 90% | 1.10 |

**Va al revés de lo que uno esperaría, y es a propósito:** al que se quedó corto
se le pide crecer **más**. El criterio no es premiar al que cumplió, es que la
sala que bajó **recupere terreno** en vez de quedarse ahí; a la que va bien se le
pide sostenerse con un 2%.

Los tramos viven en `metas_factor_cumplimiento` (no clavados en la función), así
que se agrega o se mueve uno sin tocar código. Sin cumplimiento medible —sala
nueva, o mes sin meta— el factor es **1.00**: no se pide crecimiento sobre algo
que no se pudo medir.

Se dividen ventas entre **días** y no entre meses a propósito: así un mes de 30 y
uno de 31 no pesan distinto. Y solo entran **meses completos** — uno a medias
bajaría el ritmo sin que nadie hubiera vendido menos.

**Qué cambia de fondo, y no es aritmética:** el empuje de la fórmula vieja
empujaba en la misma dirección —exigirle más a la que viene floja— pero lo medía
por **venta por hora abierta**, un número que hay que explicar. El factor lo mide
por **cumplimiento**, que el gerente ya entiende. Medido sobre agosto 2026,
Salud 4 —que cerró julio en 94%— pasa de $41,825.10 a $42,433.87: es la que más
sube, y sube justamente por haberse quedado corta.

Efecto completo sobre agosto (para referencia; **no se regeneraron**, esas metas
ya estaban confirmadas):

| Sala | Cerró jul | Factor | Con la nueva | Tenía |
|---|---:|---:|---:|---:|
| La Popular | 108.6% | 1.02 | $41,155.66 | $41,006.81 |
| Salud 1 | 96.0% | 1.02 | $51,527.44 | $51,341.07 |
| Salud 2 | 104.4% | 1.02 | $45,028.73 | $44,865.86 |
| Salud 3 | 112.8% | 1.02 | $46,272.75 | $46,125.14 |
| Salud 4 | 94.0% | 1.05 | $42,433.87 | $41,825.10 |
| Salud 5 | 103.4% | 1.02 | $16,086.50 | $16,339.55 |

Total **$242,504.95** contra $241,503.53 — un 0.4% más. La fórmula anterior y
esta llegan casi al mismo número global; lo que cambia es **cómo se reparte**.

## C2. La anterior — vigente del 2026-08-04 al 2026-08-05

Queda escrita porque funcionó, estaba verificada al centavo, y si algún día se
quiere volver, esto es lo que hay que reponer.

```
ritmo      = (venta m-3 + m-2 + m-1) ÷ (días m-3 + m-2 + m-1)
estacional = 1 + (índice − 1) × n/(n+1)
empuje     = mín(empuje_max, máx(0, norma_por_hora ÷ su_por_hora − 1) × empuje_peso)

Meta = ritmo × días del mes × estacional × (factor_crecimiento + empuje)
```

Su configuración vivía en `metas_config`, en tres columnas que **esta migración
eliminó** (`20260805…_metas_formula_ritmo_por_factor_de_cumplimiento`):

| columna | valor |
|---|---:|
| `factor_crecimiento` | 1.03 |
| `empuje_peso` | 0.15 |
| `empuje_max` | 0.02 |

Se eliminaron en vez de dejarse porque ninguna pantalla las editaba y una
columna que **parece** configurar el cálculo sin hacerlo es la trampa que
`CLAUDE.md` describe con `xyz_x_cv_max`.

**El peso del mes** (`estacional`) comparaba, para cada sala, cuánto vendió el
mismo mes del año pasado contra lo que le tocaba al ritmo que traía justo antes;
de las 6 salas tomaba la **mediana** y encogía la desviación por `n/(n+1)`.

- La mediana en vez del promedio no era un detalle: para agosto 2026 la mediana
  daba 0.9845 y el promedio 1.0309 — **conclusiones opuestas** sobre si agosto es
  flojo o fuerte. Con el promedio, la meta de La Popular habría sido $42,661.55
  en vez de $41,006.81, **$1,654.74 más**, arrastrada por el agosto atípico de
  Salud 3 (+19.6% sobre su ritmo).
- El encogimiento existía porque hay **un solo agosto anterior** en la historia
  del portal (las ventas arrancan en 2025-05). Con 6 salas creía el 86% de la
  señal; con 2 habría creído el 67%.

**El empuje** comparaba la venta por **hora abierta** de cada sala contra la
mediana de las 6, y le sumaba hasta 2 puntos a la que rendía por debajo. Servía
para no castigar a la que abre menos horas (Salud 1 abre 105 h/semana, Salud 5
abre 81). Dos asimetrías conocidas: **solo sumaba, nunca restaba** —Salud 2
rendía 11% sobre la mediana y aun así le pedían exactamente el 3%— y en Salud 5
el tope hacía todo el trabajo: su empuje crudo daba 21.9% y quedaba recortado
a 2%, así que el número no reflejaba su brecha real.

**Por qué se cambió:** la fórmula era defendible pero no explicable. El peso del
mes exigía tres párrafos para entenderse, dependía de un solo año de historia, y
el empuje empujaba en la dirección contraria a la que el negocio quiere premiar.


## C3. Agosto 2026, recalculado al cambiar la fórmula

Pedido del usuario el mismo día. Las 6 metas estaban en «espera aprobación», y
ningún RPC del flujo las deja tocar en ese estado —`confirmar_meta_supervisor`
exige propuesta o devuelta, y `upsert_meta_manual` las rechaza a propósito desde
v2.372.2—. Así que el recálculo fue una **operación administrativa explícita**,
no un atajo por el flujo: migración propia, un renglón por meta en la bitácora
con el monto de antes y el de después, y aviso al supervisor y al gerente.

| Sala | Antes | Después | Factor | Cerró jul |
|---|---:|---:|---:|---:|
| La Popular | $41,006.81 | $41,155.66 | 1.02 | 108.6% |
| Salud 1 | $51,341.07 | $51,527.44 | 1.02 | 96.0% |
| Salud 2 | $44,865.86 | $45,028.73 | 1.02 | 104.4% |
| Salud 3 | $46,125.14 | $46,272.75 | 1.02 | 112.8% |
| **Salud 4** | $41,825.10 | **$42,433.87** | **1.05** | **94.0%** |
| Salud 5 | $16,339.55 | $16,086.50 | 1.02 | 103.4% |
| | $241,503.53 | **$242,504.95** | | |

**No se cambió el estado**: siguen en «espera aprobación». Quien pidió el
recálculo es el mismo supervisor que las había confirmado, así que devolverlas a
«propuesta» le habría hecho reconfirmar seis metas por una decisión suya. Lo que
sí quedó es el rastro.

También se actualizó `monto_propuesto`, no solo el monto vigente: es «lo que
propuso el sistema», y con la fórmula nueva la propuesta ES ese número. Si
hubiera quedado el viejo, el «De dónde sale» de la tarjeta mostraría un desglose
que no reproduce el monto que tiene encima — justo lo que esa comprobación
existe para evitar.
