# Plan de cierre Supabase — lo que queda

Continuación de `PLAN-SUPABASE-100-2026-07-29.md`. Ahí quedaron cerrados F1, F2,
F3.1, F3.4, F4.1, F4.3, F4.4 y F4.6. Advisor de seguridad **110 → 86**;
`rls_policy_always_true` de **28 → 2**.

Este documento es solo **lo pendiente**, en orden de ejecución.

---

## C1 — `update_proveedor_manual`: overload muerto

Existen dos versiones (7 y 8 argumentos). La de 7 es código muerto de antes de
que se agregara un parámetro, y además es `SECURITY DEFINER`. Dropear la vieja.

**Riesgo**: bajo. Verificar primero que el frontend llame a la de 8.

---

## C2 — Deriva de migraciones (era F5) — **la más importante**

697 migraciones en el servidor contra 270 archivos locales. Sin esto no se puede
reconstruir el esquema, ni tener un staging fiel, ni hacer rollback dirigido.

**Es resoluble al 100%**: la tabla `supabase_migrations.schema_migrations` tiene
una columna `statements` (array de SQL) y **las 697 filas la tienen poblada**.
O sea el SQL real de cada migración está guardado — no hay que reconstruir nada
a mano, hay que volcarlo.

### Lo medido el 2026-07-29

Volcado completo vía `supabase db query` (2.9 MB de SQL, fuera del contexto).
**El desfase es peor de lo que decía el informe**, y de otra naturaleza:

| patrón de nombre local | archivos |
|---|---|
| `YYYYMMDD_nombre.sql` (solo fecha, escritos a mano) | **225** |
| timestamp completo de 14 dígitos | 81 |
| …de esos, que coincidan con una versión real del servidor | **14** |

O sea el repo local **no es un subconjunto de la historia real: es un set
paralelo mantenido a mano**. Solo 14 de 699 versiones tienen archivo
correspondiente. No es que falten 393 — es que 685 no están y las 306 que hay no
se corresponden 1:1 con nada.

**Por eso C2 no se puede resolver "agregando los faltantes".** Un primer intento
generó 685 archivos y dejó el directorio en 991, con duplicados del mismo DDL
bajo dos nombres — un `db reset` con eso aplicaría cosas dos veces. Se revirtió.

### C2 — decisión estructural pendiente (NO ejecutada)

**Opción A — rebaseline.** Archivar los 306 heredados en
`supabase/migrations-legacy/` y generar las 699 del servidor como historia
canónica. Es la solución estándar y resuelve el problema declarado: `db reset`
reproduce prod. Cuesta un diff de ~1,000 archivos y hay que **verificarlo
replayeando las 699 en un branch limpio** antes de confiar en él — si alguna
referencia a objetos creados fuera de migraciones, el reset falla y el
rebaseline da confianza falsa.

**Opción B — statu quo documentado.** Dejarlo como está y aceptar que el esquema
se reconstruye desde un dump, no desde la historia.

No se ejecuta ninguna sin tu decisión: toca 1,000 archivos y reescribe la
historia de migraciones del proyecto.

### 🔴 Hallazgo lateral: el secreto de cron está en claro en la BD

El escaneo previo (C2.2) encontró credenciales literales en los `statements`:

- **4 migraciones con un JWT** → decodificado, el claim es `role: anon`. **Es la
  anon key, pública por diseño** (vive en el bundle del frontend). No es fuga.
- **7 migraciones con el secreto de invocación de crons** (no-JWT), entre
  `20260606_cron_sync_purchases` y `add_cron_secret_header_check_sales_alerts`.

Hoy **0 de los 52 cron jobs** tiene el secreto literal y 41 usan Vault: la
migración 0B.2 funcionó. Pero **mover un secreto a Vault no lo rota**, así que
ese mismo valor sigue en texto plano dentro de
`supabase_migrations.schema_migrations`.

Alcance acotado: ese schema no está expuesto por PostgREST, así que hace falta
acceso directo a la BD para leerlo. Aun así es una credencial en claro en reposo
que autoriza invocar las edge functions de sync. **Recomendación: rotar el
secreto de cron y actualizar Vault.**

---

## C3 — Las 69 funciones `SECURITY DEFINER` que `authenticated` puede llamar

Es el hallazgo más grande que queda del advisor. `SECURITY DEFINER` significa que
la función corre con los permisos del dueño, **saltándose RLS**: si no tiene un
gate interno (`auth_can_edit_any`, `auth_has_module_permission`, o similar),
cualquier autenticado puede hacer por RPC lo que la policy le prohíbe hacer
directo sobre la tabla.

Nota honesta: este número subió de 67 a 69 en la sesión anterior, y no es un
retroceso — al cerrar `anon` hubo que hacer explícitos los `GRANT` a
`authenticated`, y el advisor cuenta grants explícitos. La exposición bajó; lo
que quedó visible es que **estas 69 nunca se revisaron**.

- **C3.1** — Clasificar automáticamente: ¿el cuerpo de la función contiene una
  llamada a `auth_*`? Las que no, son las sospechosas.
- **C3.2** — De las sospechosas, separar las que son inofensivas por naturaleza
  (lecturas agregadas sin PII, funciones de trigger) de las que escriben o
  devuelven datos sensibles.
- **C3.3** — Agregar gate interno o revocar, según el caso.

---

## C4 — 18% de rollbacks

535,671 transacciones abortadas de 2.98M. Es alto y nadie sabe de dónde vienen.
Rastrear el origen: puede ser un `ON CONFLICT` que revienta, un healthcheck que
falla, o una RPC que hace `RAISE EXCEPTION` como flujo normal.

---

## C5 — `pg_trgm` y `pg_net` en el schema `public`

Contaminan el namespace de la API REST y son las 31 funciones que `anon` todavía
puede ejecutar.

**Este es el más riesgoso del plan y puede terminar en "no se hace".** Mover
`pg_trgm` a `extensions` invalida todos los índices GIN de trigram que dependen
de sus operadores — incluidos los tres `_norm` que acabamos de poner a funcionar
para que buscar una factura tarde 313 ms en vez de 7.5 s. Requiere recrear los
índices, y hacerlo mal deja la búsqueda rota.

Se evalúa con staging primero. Si el costo/riesgo no lo justifica, se documenta
como deuda aceptada y se cierra — no se deja "pendiente" para siempre.

---

## Fuera de este plan (decisión o proyecto)

- **PITR** — add-on de pago, decisión del usuario. Recomendado antes de facturar.
- **Compute** — **no subir ahora**: los ~30 crons/minuto desaparecen cuando el
  portal reemplace al ERP. Dimensionar contra la carga del POS cuando exista.
  Pooling sí conviene ya.
- **HIBP** — **desactivado por decisión explícita del usuario.** No es pendiente.
- **Arquitectura POS** — `stock_movements`, `sale_payments`, `cash_sessions`,
  emisión DTE, particionado, offline. Proyecto de semanas.

---

## Reglas de ejecución

Staging antes que prod, `lock_timeout = '5s'`, archivo local con el mismo nombre
que `apply_migration`, y verificación **medida** antes de cerrar cada punto.
