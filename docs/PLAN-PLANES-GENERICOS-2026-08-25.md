# Plan — las funciones que nunca ven sus argumentos (2026-08-25)

Nació del corte de hoy 20:25–20:32 UTC: **161 peticiones caídas** con
`Timed out acquiring connection from connection pool`, todo el portal a la vez,
por **una sola función de lectura**. El arreglo está en producción
(`20260825205448`, v2.767.1) y el detalle completo en el changelog.

Este plan es sobre **las otras**: hay **69 funciones `LANGUAGE sql` con
parámetros y CTEs** sin la protección que se le puso a esa.

---

## 0 · La conclusión que hay que leer antes que nada

**El barrido de las 69 es la respuesta equivocada, y ya está medido por qué.**

Al ordenar `pg_stat_statements` por costo salen 19 funciones "caras". Pero ese
promedio se calculó sobre una ventana que **contiene el corte**, y durante el
corte todas hacían cola. Midiendo cada una *fuera* de esa ventana:

| función | promedio real | lo que decía `pg_stat_statements` | veredicto |
|---|---:|---:|---|
| `get_product_sales_total` | 1,972 ms | 2,893 ms | **lenta de verdad** |
| `get_product_sales_agg_jsonb` | 1,300 ms | 4,864 ms | **lenta de verdad** |
| `get_faltantes_con_stock_en_otra_sala` | 540 ms | 553 ms | **lenta de verdad** |
| `get_ventas_stats` | 242 ms | 324 ms | aceptable |
| `get_traslado_disponibilidad` | 239 ms | 347 ms | aceptable |
| `get_product_drill_lines` | **192 ms** | 4,189 ms | **hacía cola** |
| `buscar_inventario_global_v2` | 74 ms | 47 ms | sana |
| `get_puntos_canjeados` | **5–11 ms** | 831 ms | **hacía cola** |

`get_puntos_canjeados` es el caso que enseña la lección entera. Figura con 831 ms
de promedio; medida ahora con cuatro rangos reales da **5 a 11 ms**, y aplicarle
la corrección **la empeora** (10.9 → 16.2 ms en el rango largo). Su cerca
`MATERIALIZED` de julio funciona perfecto. Si el plan hubiera sido "corregir el
top 19", se habrían tocado funciones sanas y al menos una habría quedado peor.

> **La regla:** un promedio de `pg_stat_statements` medido sobre una ventana con
> saturación de pool dice **quién estaba esperando**, no **quién estaba lento**.
> Es la misma familia que [[feedback_un_gate_que_no_pudo_medir_no_puede_dar_verde]]:
> el instrumento contestó, pero no contestó lo que se le preguntó.

---

## 1 · Qué es el defecto, exactamente

Una función `LANGUAGE sql` **con cláusula `SET`** (todas la tienen: la regla 4 de
`CLAUDE.md` exige `SET search_path`) cae en la peor combinación posible:

1. El `SET` **impide que Postgres la inlinee** — pasa a ser una llamada opaca.
2. Y su cuerpo **se planifica una vez con los argumentos como `Params`**, sin
   llegar a ver un valor nunca. No existe el "plan personalizado" que pedir.

El resultado típico: el planificador estima un CTE en ~1 fila y elige *nested
loops sobre CTE scans*. En `get_conteo_products_count` fueron ~21 millones de
comparaciones donde el plan que conoce los argumentos hace dos hash joins —
**2,606 ms contra 56 ms**.

### Dos cosas que NO son la corrección

- **`MATERIALIZED` como cerca no alcanza.** Esa función ya tenía **cinco** CTE
  materializados y estaba 46× lenta igual. La cerca fija el orden de join *a
  través* de ella; no le arregla la estimación de filas al CTE, y el planificador
  termina eligiendo nested loops **sobre los CTE scans mismos**.
- **`plan_cache_mode = 'force_custom_plan'` a secas no hace nada.** Medido sobre
  la función tal cual estaba: 2,025 ms contra 1,969. Mientras sea `LANGUAGE sql`
  no hay plan personalizado que pedir.

### La corrección que sí funciona

Pasar la función a **`plpgsql`** —que sí entra al caché de planes— y ahí sí
`SET plan_cache_mode TO 'force_custom_plan'`. **El cuerpo no se toca.**

### El tell que ahorra media hora de diagnóstico

| síntoma | qué es |
|---|---|
| 5 llamadas rápidas y **la sexta** lenta | el caché pasó al plan genérico: `plpgsql`, un `PREPARE`, o el prepared statement de PostgREST |
| lenta **desde la primera**, en toda sesión | es `LANGUAGE sql`: nunca hubo plan personalizado |

---

## 2 · Cuándo NO se aplica

**La corrección no es gratis.** Forzar el plan personalizado obliga a
replanificar en cada llamada. Medido hoy sobre un join de tres tablas:
**+0.54 ms por llamada** (3.76 → 4.30 ms); en consultas más pesadas llega a ~3 ms.

Entonces hay un punto de equilibrio, y hay funciones donde la corrección es una
**regresión**:

- `insert_missing_products` — **35,454 llamadas a 4 ms**. Sumarle 0.5 ms es un
  12% peor, sin ninguna ganancia si su plan no depende de los valores.
- Cualquiera que ya esté por debajo de ~50 ms y se llame seguido.

**Criterio de entrada, y las tres condiciones son necesarias:**

1. Su tiempo **medido fuera de una ventana con saturación** supera 200 ms, **o**
   corre en un cierre fiscal donde un plazo vencido cuesta el trámite.
2. La medición contra su cuerpo con literales **diverge más de 3×**. Si no
   diverge, el plan genérico está bien y no hay nada que corregir.
3. La ganancia medida supera con holgura el costo de replanificar.

Una función que no cumple las tres **se declara sana con su medición escrita**,
no se toca. Y una que no se pudo medir **no se declara nada** — queda como deuda
declarada, que es distinto de un número inventado.

---

## 3 · El instrumento

Dos scripts nuevos bajo `scripts/planes/`. Sin ellos esto no es auditable: son
69 funciones y a ojo no se distingue "lenta" de "hacía cola".

### 3.1 · `argumentos.json` — el fixture, y por qué es a mano

Para medir una función hay que llamarla con **argumentos realistas**, y esos no
salen de ningún lado automáticamente: `pg_stat_statements` los normaliza y los
cuerpos de los POST de PostgREST no se registran.

Un archivo por función, con 3–6 juegos de argumentos y **su motivo escrito**
(por qué ése es el caso representativo: el rango que usa la pantalla, el mes de
cierre, el conteo grande). Es el mismo estilo que el manifiesto `CRONS` de
`gate:eficiencia`.

> **Sin argumentos declarados, la función no se mide, y sin medición no se
> corrige.** Esa es la mitad que evita que este plan se convierta en un barrido.

### 3.2 · `medir.mjs` — separa lenta de encolada

Para cada función declarada:

1. La llama 6 veces para pasar el escalón del plan genérico (así se mide lo que
   sufre producción, no la primera llamada afortunada).
2. Mide la función.
3. Mide **el mismo cuerpo como función temporal de sesión** (`pg_temp.<nombre>`,
   `plpgsql` + `force_custom_plan`) — que es la corrección, sin tocar producción.
4. Reporta el par y la razón.
5. **Rechaza medir si hay saturación en curso**: si `pg_stat_activity` muestra
   consultas de más de 5 s, aborta y lo dice. Ésa es la trampa de hoy, cerrada
   por construcción.

### 3.3 · `equivalencia.mjs` — que dé lo mismo

La candidata `pg_temp` se enfrenta a la original sobre **todo el producto
cartesiano de los argumentos declarados**, y compara el resultado completo — no
un conteo de filas: el `md5` del `json_agg` ordenado, que sí detecta una columna
cambiada.

**Cero diferencias es requisito para aplicar.** En el caso de hoy fueron 21 de 21.

La técnica `pg_temp` es la pieza clave y por eso se automatiza: una función
temporal de sesión **desaparece al cerrar la conexión**, así que la candidata se
prueba contra datos reales de producción sin dejar nada, sin migración y sin
ventana.

---

## 4 · Las fases

Cada fase cierra con: medición antes/después escrita, equivalencia en cero,
migración con su archivo local en el mismo commit, y `gate:perf` +
`gate:eficiencia`.

### Fase 1 — las tres que están lentas de verdad *(≈1 sesión)*

| función | ahora | dónde se nota |
|---|---:|---|
| `get_faltantes_con_stock_en_otra_sala` | 540 ms | **widget del tablero, al entrar** — la paga todo el mundo, todos los días |
| `get_product_sales_agg_jsonb` | 1,300 ms | ficha de producto |
| `get_product_sales_total` | 1,972 ms | ficha de producto |

Empieza por la del tablero: es la única que pagan las 42 personas cada vez que
abren el portal.

⚠️ Ojo con el nombre: el portal llama a `get_product_sales_agg_**jsonb**`, no a
`get_product_sales_agg`. Son el par del Patrón C de `CLAUDE.md` (envoltorio
`RETURNS json`). **Hay que corregir la que el portal llama**, y verificar cuál es
antes de tocar nada.

#### Resultado de la fase 1 — **las tres están sanas, no se tocó ninguna** (2026-08-25)

Medidas con la base en reposo (0 consultas largas, 0 locks), 6 llamadas de
calentamiento para pasar el escalón del plan genérico, y la candidata `pg_temp`
enfrentada a la original:

| función | casos | resultado | vieja | nueva | veredicto |
|---|---|---|---:|---:|---|
| `get_faltantes_con_stock_en_otra_sala` | 7 sucursales | **7/7 idéntico** | 128–191 ms | 126–216 ms | **sana** — no mejora; en la sala 3 la corrección va **peor** (135 → 216 ms) |
| `get_product_sales_total` | 5 rangos | **5/5 idéntico** | 15–237 ms | 8–235 ms | **sana** — 1.0×; el único caso que mejora va de 21 a 8 ms |
| `get_product_sales_agg_jsonb` | 3 rangos | — | 715 ms (1ª–5ª) → **426 ms (6ª–8ª)** | — | **sana** — no hay escalón: *mejora* después de la sexta |

**Las tres fallan la condición 2 del criterio** (divergir 3× contra el cuerpo con
literales). Se declaran sanas y no se tocan. La fase 1 se cierra **con cero
migraciones**.

Y los tres números del triage que las habían puesto acá resultaron ser de red y
serialización, no de base: la del tablero mide **140 ms** de función contra los
540 ms del log, y `get_product_sales_total` mide 15–237 ms contra 1,972.

> **Conclusión que hay que tener presente: `get_conteo_products_count` era la
> única.** El triage acertó al descartar 16 de 19; se equivocó al dejar estas
> tres adentro, y por el mismo motivo — el promedio del log no es el tiempo de
> la función. **El único juez es medir la función contra su cuerpo con
> literales.** Todo lo anterior es para elegir a quién medir primero.

**Anotado y fuera de alcance:** `get_product_sales_agg_jsonb` devuelve **1.77 MB
de JSON** (2,376 productos) en la carga de Ventas sin filtro. Eso no es este
defecto —es tamaño de respuesta— y se atiende aparte, con su propia verificación.

### Fase 2 — las que se llaman y están en la frontera *(≈1 sesión)*

`get_ventas_stats` (242 ms), `get_traslado_disponibilidad` (239 ms),
`get_product_drill_summary`, `get_product_trend`, `get_invoice_observations`,
`get_libro_compras_completo`, `get_minmax_contexto_producto`,
`get_top_supplier_per_product`, `get_cuentas_por_pagar`.

Se miden todas; se corrigen **sólo** las que crucen el criterio de §2. Lo
esperable es que la mayoría se declare sana — y ese resultado también hay que
escribirlo, porque es lo que evita que la próxima sesión las vuelva a mirar.

### Fase 3 — las 19 que no se llamaron nunca *(≈1 sesión)*

`get_libro_compras_declarable`, `get_ccf_con_problema`, `get_corte_z_dias`,
`get_bolsas_invariante`, `get_stagnant_inventory`, `get_no_sales_products`,
`get_products_sold_no_minmax`, `get_pedido_sucursal_stats`, `get_corte_eventos`,
`calc_credito_declarable`, `get_documentos_por_barrer`, `empleados_en_turno`,
`verificar_hojas_pedido`, `session_idle_limit_minutes`, `es_dui_valido`,
`search_inventory_descripcion_ids`, `get_stock_analysis`,
`get_pedido_diferencias_stats`, `get_corte_z_dias`.

**Cero llamadas en cinco días NO significa que estén sanas — significa que
todavía no les tocó.** Varias son de **cierre fiscal**: corren una vez al mes,
sobre el mes entero, que es el volumen más grande y el peor momento para un
plazo vencido. `get_stock_analysis` además es la del Patrón B, con paginación.

Se miden con argumentos de **cierre de mes real**, no con un rango de un día.

### Fase 4 — las de sincronización, aparte y al final *(≈1 sesión)*

`sync_inventory_batch` (737 s), `upsert_product_precios_batch`,
`insert_missing_products`, `upsert_products_minimal`,
`sync_purchase_receipts_batch`, `sync_purchase_receipt_items_batch`,
`sync_suppliers_batch`, `sync_laboratorios_batch`, `sync_presentaciones_batch`,
`cola_espejo_portal_erp`.

Van últimas y con otro criterio, por tres motivos:

1. **Escriben**, y sobre las tablas calientes (`inventory`, `products`,
   `sales_invoices`). Un cambio acá cae bajo la regla del incidente 2026-07-08.
2. Su costo por llamada ya es bajo (4–163 ms); varias están del lado equivocado
   del punto de equilibrio de §2.
3. Las llama un cron, no una persona. Un segundo de más no lo sufre nadie
   mirando una pantalla — y es exactamente el tipo de cambio que no vale su
   riesgo.

Lo probable es que la conclusión de esta fase sea **"no se tocan, y acá está la
medición que lo justifica"**. Escribirlo igual: una decisión sin registro se
vuelve a discutir.

### Fase 5 — el gate, para que no vuelva *(≈media sesión)*

Sección nueva en `gate:perf` (que ya mide contra producción):

- Lee de producción las `LANGUAGE sql` con parámetros y CTEs sin
  `plan_cache_mode`.
- Cruza contra un manifiesto donde **cada una va declarada con su medición y su
  motivo** — "medida en 74 ms, el plan genérico le sirve" o "corregida en la
  fase 1".
- **Una función en producción que no esté declarada FALLA el gate.** Es la misma
  forma que `auditoria/superficie-anon.json`, y por la misma razón: lo que nadie
  declara crece solo y en silencio.
- Y no falla por lentitud puntual —eso es ruido contra una base compartida—,
  falla por **estar sin declarar**.

---

## 5 · Lo que este plan NO promete

- **No promete que las 69 se corrijan.** Promete que las 69 queden **medidas y
  declaradas**, y corregidas las que lo necesiten. Hoy la evidencia dice que son
  pocas.
- **No promete mejora en las que ya están sanas.** En `get_puntos_canjeados` la
  corrección mide peor, y por eso no se aplica.
- **No toca el cuerpo de ninguna consulta.** Si al medir aparece una que es lenta
  por su SQL y no por su plan, eso es otro trabajo, con su propia verificación de
  resultados. Se anota y se sale.

---

## 6 · Estado

| fase | estado |
|---|---|
| 0 · el corte y su causa | **cerrado** — `20260825205448`, v2.767.1, verificado en producción |
| 0 · triage de las 69 | **cerrado** — medido fuera de la ventana del corte, tabla en §0 |
| 1 · las tres lentas | **cerrado** — las tres medidas y **declaradas sanas**; cero migraciones |
| 2 · la frontera | abierto |
| 3 · las que no se llamaron | abierto |
| 4 · sincronización | abierto |
| 5 · el gate | abierto |

**Medición base del portal**, tomada hoy sobre tráfico real antes y después de la
fase 0 — es contra esto que se compara cualquier fase futura:

| | p95 global | errores 5xx | peticiones |
|---|---:|---:|---:|
| antes | 12,932 ms | 175 | 33,536 |
| después | **320 ms** | **0** | 1,508 |

⚠️ Ese "después" son 40 minutos de tráfico de noche. **Hay que volver a medirlo
un día hábil a las 14:00**, que es cuando el portal tiene carga real y cuando
ocurrió el corte.
