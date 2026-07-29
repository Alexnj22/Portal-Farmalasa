# Plan Supabase → 100% — 2026-07-29

Continuación de `AUDITORIA-SUPABASE-2026-07-29.md`. La auditoría ya tiene cerrados
S1 (fuga anon), P1, P3, P4 y P5. Este plan cubre **todo lo que queda**, medido
contra la base hoy, no contra el texto del informe.

## Antes de empezar: qué significa "100%"

Hay que separar tres cosas, porque no son el mismo tipo de trabajo:

| | qué es | quién puede |
|---|---|---|
| **F1–F5** | deuda técnica concreta, acotada, verificable | yo, ahora |
| **F6–F7** | decisiones de facturación (PITR, compute) | **vos**, en el dashboard |
| **F8** | construir el POS: kardex, pagos, caja, emisión DTE | proyecto de semanas |

**F8 no es "corregir Supabase", es construir el sistema de ventas.** Decir que
Supabase queda "al 100%" cuando F8 está abierto sería mentir sobre el alcance.
Lo que F1–F5 logran es: *la base queda correcta y eficiente para lo que el
portal hace hoy, y lista para que encima se construya el POS.*

---

## ✅ F1 — Realtime: está roto, no solo caro *(APLICADO v2.195.0)*

**El informe (P6) decía**: "10 tablas en la publicación, incluidas
`role_permissions` y `stock_config`, que casi nunca cambian pero obligan a
decodificar el WAL igual" → sacarlas.

**Medido, eso es incorrecto en dos puntos.**

Comparando lo que el frontend consume contra lo que la publicación emite:

| tabla | suscrita en el código | en la publicación | |
|---|---|---|---|
| `inventory_sync_log` | ✅ `useSyncMonitor` | ❌ | 🔴 **evento que nunca llega** |
| `pedido_items` | ✅ vista de pedidos | ❌ | 🔴 **evento que nunca llega** |
| `ventas_perdidas` | ✅ | ❌ | 🔴 **evento que nunca llega** |
| `stock_config` | ❌ nadie | ✅ | 🟡 sobra |
| `role_permissions` | ✅ `AuthContext` | ✅ | ✅ el informe proponía sacarla — **se usa** |
| otras 8 | ✅ | ✅ | ✅ |

Y el costo: los 5,808 s / 18.4% son **651,041 llamadas** de la función de sondeo
de Realtime (`wal->>...`), a 8.9 ms cada una. Es un poll de fondo constante,
independiente de si algo cambió — las 10 tablas de la publicación suman apenas
**241 escrituras en total**. Sacar tablas casi no mueve la aguja: el gasto es
*mirar*, no *decodificar*.

**Acciones:**
- **F1.1** — Decidir, para las 3 suscripciones muertas: o se agregan a la
  publicación (si la función en vivo se quiere) o se borra el código muerto y se
  pasa a polling explícito. Hoy es lo peor de ambos: código que aparenta ser
  reactivo y no lo es.
- **F1.2** — Sacar `stock_config` de la publicación.
- **F1.3** — Medir el poll después. Si sigue en ~18%, la palanca real es la
  configuración de Realtime (intervalo de sondeo), no la lista de tablas — y eso
  se documenta como límite del plan Pro, no como pendiente.

**Aplicado** (`20260729_realtime_publication_fix`, idempotente porque la
publicación de staging no coincide con la de prod): se agregaron las 3 tablas
rotas y se sacó `stock_config`. Verificado: **12 de 12 tablas alineadas**, toda
suscripción publicada y nada publicado sin suscriptor. Las 3 tienen RLS con
policy de SELECT, así que Realtime filtra por suscriptor; no se tocó
`REPLICA IDENTITY` para no inflar el WAL.

**F1.3 queda abierto**: falta medir si el poll baja. La expectativa medida es que
**no** baje — el gasto es el sondeo, no las tablas.

---

## F2 — Escritura abierta (S2)

El informe contó "30 policies en 21 tablas". Hoy son 32 en 23, pero **no todas
son vulnerabilidad**:

| destinatario | policies | veredicto |
|---|---|---|
| `authenticated` | **26** (18 tablas) | 🔴 el problema real |
| `service_role` | 4 | ✅ **no es un problema** — `service_role` ya salta RLS; la policy es decorativa |
| `public` | 2 (`user_dashboard_prefs`) | 🟠 preferencias propias, severidad baja |

Las 18 tablas con `TO authenticated ... true`: `attendance`, `audit_logs`,
`branch_documents`, `branch_expenses`, `education_catalog_entries`,
`employee_documents`, `employee_events`, `holidays`, `kiosk_devices`,
`product_locations`, `products`, `sales_payment_confirmations`,
`schedule_coverage`, `shifts`, `survey_responses`, `timesheets`,
`vacation_plan_headers`, `ventas_perdidas`.

**Acciones:** reemplazar por `(SELECT auth_can_edit_any(ARRAY['modulo']))` — con
el wrapper `(SELECT ...)` obligatorio, que es la lección del outage del
2026-07-08. Por lotes, de mayor a menor daño:

- ✅ **F2.1 — APLICADO v2.195.0** (`20260729_write_policies_batch1`):
  `products` → `ARRAY['productos','dash_srs_inv']` (la unión, porque
  `SrsEnriquecerModal` también escribe principio activo y gatear solo a
  `productos` lo habría roto), `kiosk_devices` → `branches`,
  `timesheets` → `time_audit`, `employee_events` → `staff_detail`.
  El módulo de cada una se sacó de dónde escribe el frontend, verificado uno por
  uno con grep, no supuesto. **26 → 20 policies abiertas.**
- ✅ **F2.2 + F2.3 + F2.4 — APLICADO v2.196.0** (`20260729_write_policies_batch2`).
  **26 → 2 policies abiertas.** Dos trampas que la migración evitó:

  1. `product_locations` y `schedule_coverage` tenían UNA sola policy, `ALL` con
     `true` — y `ALL` cubre también SELECT. Reemplazarla por una gateada con
     `can_edit` habría dejado **sin lectura** a todo el que solo puede ver. Se
     partieron: SELECT permisivo (igual a la lectura efectiva de hoy) +
     INSERT/UPDATE/DELETE gateados.
  2. `user_dashboard_prefs` se llamaba `owner_*` pero sus tres policies eran
     `TO public` con `true`: **cualquiera leía y escribía las preferencias de
     cualquiera**. Ahí no corresponde módulo sino dueño real
     (`user_id = (SELECT auth.uid())`).

  Verificado además que los 15 módulos usados tengan al menos un rol con
  `can_edit` — gatear contra un módulo que nadie puede editar habría dejado a
  todos afuera.

- 🚫 **`attendance` (INSERT) queda abierta a propósito.** El kiosco marca por esa
  vía (`useTimeClockEngine` → `registerAttendance` → INSERT directo) y marca por
  **otros** empleados, porque la tablet es compartida. No sirve ni un gate por
  módulo ni uno por dueño: cualquiera de los dos rompe el marcaje de toda la
  cadena. El fix correcto es una RPC SECURITY DEFINER que valide el device token,
  como `verify_kiosk_authorization`. Es arquitectura, no una línea de policy —
  exactamente el mismo caso que `audit_logs`.
- **F2.5** — `audit_logs`: **queda como está a propósito**. Ya se decidió que el
  fix correcto es mover el logging al servidor dentro de las RPC, porque el
  `user_id` lo pone el cliente y el kiosco escribe sin sesión verificable. Es
  arquitectura, no una línea de policy. Se anota, no se parcha.

---

## F3 — Superficie de funciones (S4)

- **F3.1** — 5 funciones `SECURITY DEFINER` ejecutables por `anon`. Solo dos
  están justificadas (`get_kiosk_boot_payload`, `get_kiosk_coverage_employees`).
  Revocar el resto.
- **F3.2** — 67 `SECURITY DEFINER` ejecutables por `authenticated`. No todas
  sobran, pero ninguna se revisó nunca. Clasificar una por una: las que no las
  llama el frontend, revocar.
- **F3.3** — `update_proveedor_manual`: dos overloads (7 y 8 args). El viejo es
  código muerto → dropear.
- **F3.4** — 4 tablas con RLS activo y **cero policies**. Fallan cerrado, pero
  hay que confirmar que `login_rate_limit` se escriba con `service_role` — si el
  cliente no puede escribir ahí, **el rate limiting de login no existe**.

---

## F4 — Higiene (S5)

- **F4.1** — **42 cuentas `auth` huérfanas**: 92 usuarios para 50 empleados, solo
  22 con login en 30 días. Cuentas de ex-empleados sin revocar es la vía de
  acceso indebido más común que hay. Hay que cruzar contra `employees` y revocar,
  con lista previa para que la apruebes.
- **F4.2** — Protección de contraseñas filtradas (HIBP): **es un toggle del
  dashboard, lo tenés que activar vos**.
- **F4.3** — 2 buckets públicos listables (`photos`, `product-photos`): se puede
  enumerar todo el contenido, no solo acceder por URL conocida. Y `backups` sin
  `file_size_limit` ni `allowed_mime_types`, contra la regla #10.
- **F4.4** — 1 vista materializada expuesta en la API.
- **F4.5** — `pg_trgm` y `pg_net` en el schema `public`: contaminan el namespace
  REST. Mover a `extensions` **solo si** nada las referencia sin calificar —
  verificar antes, puede romper funciones.
- **F4.6** — FK sin índice en `sales_invoices.customer_id` (336K filas).
- **F4.7** — 18% de rollbacks (535,671 de 2.98M). Rastrear la fuente.

---

## F5 — Deriva de migraciones (G1)

663 migraciones en el servidor contra 270 archivos locales: **393 faltantes**.
No se puede reconstruir el esquema, ni crear un staging fiel, ni hacer rollback
dirigido. Para un sistema que va a facturar, es inaceptable.

- **F5.1** — Volcar del servidor las 393 que faltan a `supabase/migrations/`.
- **F5.2** — Verificar que un `db reset` desde los archivos reproduce el esquema.

---

## F6 — PITR *(decisión tuya)*

El plan Pro trae backups diarios con 7 días, **sin PITR**. Hoy, ante corrupción,
el mejor caso es **perder hasta 24 horas de ventas**. Para facturación eso no es
aceptable, y en El Salvador hay obligación de conservación fiscal.
**Es un add-on de pago (~$100/mes) — no lo puedo activar yo.**

## F7 — Compute *(decisión tuya)*

`max_connections = 60`, `shared_buffers` 256 MB, `work_mem` 3.5 MB. Los 275
fallos de cron por conexiones agotadas vienen de acá y **no cambió nada hoy**:
si no se sube el compute, van a volver. También resuelve los 7.7 GB de temp
files.

## F8 — Arquitectura del POS *(proyecto aparte)*

`stock_movements` (kardex append-only), `sale_payments`, `cash_sessions`,
emisión DTE (JSON firmado, sello de Hacienda, correlativos con bloqueo,
contingencia y anulación), idempotencia de venta, RLS de escritura en ventas,
particionado de `sales_invoices`, modo offline. Semanas de trabajo, no una
sesión.

---

## Orden de ejecución

1. **F1** — Realtime (hay funciones rotas, no solo costo)
2. **F2** — escritura abierta, por lotes
3. **F3** — superficie de funciones
4. **F4** — higiene, empezando por las 42 cuentas
5. **F5** — deriva de migraciones
6. **F6/F7** — tu decisión de facturación
7. **F8** — proyecto aparte

Cada fase: staging antes que prod, `lock_timeout = '5s'`, archivo local con el
mismo nombre que `apply_migration`, y verificación medida —no asumida— antes de
darla por cerrada.
