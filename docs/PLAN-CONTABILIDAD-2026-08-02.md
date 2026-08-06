# Proveedores y Libros de IVA — auditoría completa y plan

Fecha: 2026-08-02 · Sucede a `AUDITORIA-PROVEEDORES-Y-LIBROS-IVA-2026-08-02.md`,
que quedó **incompleta y con dos conclusiones equivocadas**. Este documento es el
que manda.

**H15 quedó CERRADO el mismo día** — ver Parte 4: se bajó el CSV por el botón real
con Playwright y se comparó byte a byte contra el archivo del ERP. Resultado:
donde los dos difieren, **el portal tiene razón en todos los casos adjudicables**.

---

# Parte 0 — Qué faltaba, y qué estaba mal

## La primera pasada no fue una auditoría completa

Cubrí la superficie estructural —los 7 RPC, el esquema, el RLS, los permisos— y
declaré hallazgos sobre eso. Pero **seis archivos los toqué solo con `grep`**, y
tres de ellos resultaron tener hallazgos propios:

| Archivo | Primera pasada | Qué apareció al leerlo |
|---|---|---|
| `verificar-csv-libros/index.ts` (240) | no leído | **H10** — el verificador no puede ver sobrantes |
| `generar_csv_libro` (SQL, 5.7 kB) | no leído | **H11** — no es una segunda implementación |
| `check-purchases-reconciliation` (248) | no leído | H14 — cap de 1000 sin paginar |
| `ProveedoresView.jsx` (481) | grep | confirma la vía de A1 |
| `FormProveedorDetail.jsx` (374) | grep | confirma la vía de A1 |
| `sync-numero-control` (242) | no leído | H12 — la cola y el libro usan poblaciones distintas |
| `csvExport.js` (32) | no leído | H15 — el archivo real nunca se comparó |
| `sync-erp-purchases` (714) | 130 líneas | el sync **ya sabía** de la truncación |

**Además usé el acceso al ERP que me diste** para resolver tres dudas que la
primera pasada dejó abiertas o resolvió mal. Las tres respuestas cambiaron el
diagnóstico.

## Dos conclusiones de la primera pasada eran incorrectas

### A3 estaba mal diagnosticado — no es plata que falta en el libro

Dije: *"22 ventas con `recibido_mh='undefined'` quedan fuera del libro de meses
cerrados"*, insinuando ingreso no declarado por culpa del filtro.

Consulté los 6 primeros contra `dteqr_json.php`:

```
9f1e3a3e-… → sello = "undefined"        ← el ERP mismo devuelve la cadena
1e7e3dc5-… → BODY VACIO                 ← el ERP no conoce el documento
b9497a67-… → BODY VACIO
6dffc754-… → BODY VACIO
f49c05c1-… → BODY VACIO
be0a21cd-… → BODY VACIO
```

**El portal no inventó nada: copió un `undefined` que el ERP serializa.** Y cinco
de seis documentos **no existen en el servicio de consulta del ERP**. No son
ventas selladas que el libro pierde — son ventas del POS cuyo DTE nunca se
completó.

Eso da vuelta el hallazgo, y para mejor y para peor:

- **Para mejor:** el filtro del sello está BIEN. Excluirlas es correcto.
- **Para peor:** son **24 documentos y $288.60 de venta cobrada que nunca se
  declaró** (2025-05: 1 · 2025-08: 2 · 2026-05: 21, casi todas del 7 de mayo).
  Hoy desaparecen en silencio. Nadie las ve nunca.

No es un bug del libro. Es un **problema operativo que el libro esconde**.

### Los 316 números de control duplicados: el portal copia bien

Encontré 316 `numero_control` repetidos y sospeché del backfill. Me equivoqué dos
veces antes de llegar al fondo:

**Primero:** 312 de los 316 son de años distintos. El correlativo de la sucursal
27 corre 1 → 28,098 durante 2025 y **reinicia en 1 el 2026-01**. Es un reinicio
anual del ERP, copiado fielmente.

**Segundo, los 4 restantes** —todos de hoy— sí comparten año. Sospeché que
`dteqr_json.php` devolvía el documento equivocado. Lo probé:

```
pedido 662A67E5-… → devuelve 662A67E5-… · nc DTE-01-S003P001-000000000035120 · 07:21:49
pedido E33B700A-… → devuelve E33B700A-… · nc DTE-01-S003P001-000000000035120 · 07:31:41
```

**El ERP devuelve el código correcto y el mismo número de control para dos DTE
distintos.** El portal copió bien las dos veces.

El patrón es limpio y los cuatro casos son idénticos: el documento **sin sello**
y el documento **con sello** comparten número de control, con 2 a 10 minutos de
diferencia. Es la firma de un envío que falló y se reintentó: el POS generó un
código de generación nuevo pero reusó el correlativo. El bueno es el sellado.

**Consecuencia:** no hay nada que arreglar en el portal, pero sí hay que dejar de
asumir que `numero_control` identifica un documento. No es único ni entre años ni
—cuando hay reintentos— dentro del día.

---

# Parte 1 — El cuadro completo

16 hallazgos. Los que llevan ✅ están verificados contra el ERP en esta sesión.

## Críticos

### H1 · Un `supplier_id` repetido duplica el libro de compras
*(sin cambios respecto de la primera pasada, y ahora peor: ver H10)*

`proveedores_maestro.supplier_id` no tiene índice único, y los tres RPC de
compras hacen `LEFT JOIN … ON pm.supplier_id = pr.supplier_id`. Simulado sobre
junio: **389 → 503 filas, $203,947 → $295,805**. Dos vías abiertas: el select
"Match ERP" de `FormProveedorDetail.jsx:259` (sin chequeo alguno) y el `LIMIT 1`
sin `ORDER BY` de `upsert_proveedor_from_dte`.

Hoy: 0 duplicados. Está limpio por suerte.

### H10 · El verificador no puede ver un sobrante ✅

`verificar-csv-libros`, modo `porConjunto` — el que se usa para separar
diferencias de contenido de diferencias de orden:

```ts
veredicto: (lineasErp.length > 0 && enBolsa === lineasErp.length) ? 'IDENTICO' : …
```

Comprueba que **cada línea del ERP exista en el portal**. Nunca comprueba lo
inverso. Con el portal emitiendo 503 líneas contra las 389 del ERP, las 389 se
encuentran igual y el veredicto sale **IDENTICO**.

**La red de seguridad tiene exactamente el mismo punto ciego que H1.** Los dos
juntos son el hallazgo grave: no es que el libro se pueda inflar, es que se puede
inflar *y pasar la verificación*.

### H11 · `generar_csv_libro` no es una segunda implementación ✅

El comentario dice: *"Si dos implementaciones independientes coinciden entre sí Y
con el archivo del origen, la prueba vale mucho más que reusar el mismo código
para verificarse a sí mismo."*

Leí las dos. `generar_csv_libro` **transcribe las mismas reglas**: el mismo
`length(recibido_mh)=40`, el mismo `subtotal − percepcion_iva`, el mismo
`LEFT JOIN proveedores_maestro ON supplier_id`. Hereda H1 y H2 enteros.

Lo que sí es evidencia real —y es fuerte— es la comparación contra el archivo del
ERP. Lo que no aporta casi nada es la "segunda implementación". La confianza está
puesta en el lugar equivocado.

### H12 · La cola del número de control y el libro no piden lo mismo ✅

| | Población |
|---|---|
| `get_libro_ventas_consumidor` | COF + FINALIZADA + **sello de 40** |
| `_docs_sin_numero_control` | COF + FINALIZADA (**sin filtro de sello**) |

Los extremos del día se calculan sobre conjuntos distintos, así que **la cola
puede traer el número de un documento que el libro no usa, y no traer el que sí**.

Medido en 2026-08-01, sucursal 4: la cola pide el id 6656172, el libro necesita el
6656178. Hoy no rompió por casualidad. Es el patrón de
`feedback_snapshot_and_live_read_need_same_key`, y la corrección es de una línea:
que `_docs_sin_numero_control` use el mismo filtro.

## Altos

### H2 · `documento_numero` truncado a 20 — **es del ERP** ✅

Bajé el libro de compras real de Bodega, junio:

```
01/06/2026;4;;2ACF88E7-2990-49D2-B;06140312700042;COFARSAL DE R.L.;…
```

**El archivo del ERP trae el mismo corte de 20 caracteres.** El portal replica
fielmente. Queda descartado que sea del sync.

Pero el problema fiscal no desaparece — se muda: **el libro de compras del ERP no
puede identificar sus propios documentos.** 339 de 389 filas de junio y 422 de 467
de julio están en el tope. El `2ACF88E7-2990-49D2-B` es el código de generación
`2ACF88E7-2990-49D2-B84D-3A048EEC4F0D` cortado, y el dato completo está en
`purchase_dte_documents`.

`sync-erp-purchases:334` ya lo sabía —*"el número truncado a 20 no siempre es
único"*— y lo trató como una molestia para cruzar, nunca como un defecto del dato
declarado.

### H3 · 24 ventas cobradas sin DTE sellado ✅
*(reemplaza al A3 de la primera pasada)*

$288.60 en 24 documentos que el libro descarta en silencio. Ver Parte 0.

### H13 · El sello de compras SÍ está en el origen ✅

La primera pasada repitió lo que decía el doc: *"no viene en la fuente que
alimenta Compras"*. **Es falso.** El archivo del ERP lo trae en la última columna:

```
…;1;1;2;5;3;4.5900;2026F5659810C3274DC6BDDC1E602CDF5A28Z1LQ
```

Y el anexo de percepción también, en la columna 6. **`fastBackfill` ya descarga
los dos archivos** (`LIBRO_CSV`, línea 391) y lee las columnas 3 y 21 — el sello
es la 22. Está a un índice de distancia.

Eso además abre H16.

## Medios y menores

| # | Hallazgo | Nota |
|---|---|---|
| **H4** | `docs_count` inflado ~2× (COFARSAL 460 vs 230) | `+1` incondicional, no idempotente |
| **H5** | El cuadre de ventas solo recorre los días del ERP | un sobrante es invisible |
| **H6** | La precisión se pierde en `subtotal numeric(12,2)` ✅ | ver abajo — **el plan del doc anterior era el doble de trabajo del necesario** |
| **H7** | `get_notas_credito_compras` sin scope de sucursal | hay motivo, falta escribirlo |
| **H8** | `get_libro_sujeto_excluido` sin GRANT a `authenticated` | código muerto que falla si se recuelga |
| **H9** | Dos ramas del RLS de compras/ventas sin scope | `minmax_ver_costos`, `productos_tab_catalogo_costos` |
| **H14** | `check-purchases-reconciliation` lee sin paginar | `.select('total')` con cap de 1000; Bodega ya va en 414/mes |
| **H15** | El CSV que baja el navegador nunca se comparó | BOM + CRLF que el verificador no ve |
| **H16** | El orden del archivo exportado ≠ el del verificado ✅ | ver abajo |

### H6, resuelto con el archivo real ✅

El anexo de percepción del ERP, junio, Bodega:

```
1;01/06/2026;LETERAGO…;06142505071078;03;52805657-6F79-4956-A;2026…KDDT;571.9915;5.7200
5;01/06/2026;COFARSAL…;06140312700042;03;5AD19685-47F0-44B0-A;2026…X8NK;463.566;4.6400
```

Dos cosas quedan claras y ninguna estaba dicha:

1. **La percepción SIEMPRE tiene 2 decimales reales** (`5.7200`, `4.6400`): los
   cuatro son relleno. `percepcion_iva` no necesita ningún cambio.
2. **El único campo con precisión perdida es `subtotal`.** `571.9915 + 5.72 =
   577.7115` es `sumas_gravadas`; `numeric(12,2)` lo redondea a `577.71` al
   insertar.

Y el **libro** de compras del ERP presenta gravadas con 2 decimales (`571.99`),
idéntico al portal. **La diferencia solo existe en el anexo de percepción.**

El arreglo es una columna: `ALTER TABLE purchase_receipts ALTER COLUMN subtotal
TYPE numeric(14,4)` + re-sync. El documento anterior estimaba tocar dos columnas y
"rehacer el histórico" — es la mitad, y el libro no se toca.

### H16 · El archivo verificado y el exportado ordenan distinto ✅

| | Orden |
|---|---|
| `get_libro_compras` → lo que descarga la contadora | `branch_id, **fecha**, erp_purchase_id` |
| `generar_csv_libro` → lo que verifica el verificador | `branch_id, erp_purchase_id` |

Medido sobre junio: **148 de 389 líneas de compras (38%) y 95 de 226 de percepción
(42%) caen en otra posición.**

Así que el "226/389 idénticas línea por línea" **no se midió sobre el archivo que
se presenta**. Y explica el misterio que el doc anterior dejó abierto como *"orden
residual en 3 sucursales, sin resolver"*: no es un criterio desconocido del ERP,
son dos implementaciones del portal que no coinciden entre sí.

## Lo que se revisó y está bien

- **Permisos**: los 6 RPC de escritura validan con `auth_can_edit_any`; los de
  lectura llevan el gate en initplan `(SELECT …)`. Advisor: **0 ERRORES**.
- **Aritmética de ventas**: `subtotal + iva = total` en el 100% de junio-julio.
  Cero exentas mal clasificadas. Cero duplicados de `erp_invoice_id` o de
  `codigo_generacion`.
- **NRC del receptor en CCF: 100% completo** en mayo, junio y julio (140 CCF).
  El aviso `ccfSinNrc` está en cero — el doc que dice *"el portal todavía no
  captura el receptor"* quedó viejo.
- **NIT de proveedores**: quedan 3 filas de 1 proveedor (PEPSI, $103.12), no
  "15 de 67".
- **Retención**: 0 filas en toda la historia, consistente con el ERP.
- **El filtro del sello es correcto** — lo confirma H3 por el camino largo.
- **Los avisos de la vista** son específicos y bien escritos. Cubren lo que falta;
  no lo que sobra (H1) ni lo que viene cortado (H2).

---
# Parte 2 — Plan de ejecución

**Reescrito el 2026-08-02 tras la Parte 4.** El objetivo no es "arreglar 21
hallazgos" sino uno solo, que los ordena a todos:

> Que un mes cierre **correcto y solo**, y que si algo sale mal, alguien se
> entere sin haber ido a mirar.

Hoy el módulo no puede ser autónomo, y no por los bugs: **por los puntos ciegos
de sus verificaciones**. Automatizar un cierre cuyos controles no pueden fallar
no da autonomía, da confianza falsa. Por eso el orden es: primero que nada pueda
empeorar (A), después que las alarmas puedan sonar (B), después completar el dato
(C), y recién ahí congelar el mes (D).

## Cinco condiciones para que un mes cierre solo

| # | Condición | Hoy | Bloque |
|---|---|---|---|
| 1 | El dato llega completo | cuadres diarios ✅, pero ciegos de un lado | B |
| 2 | El dato no se corrompe en silencio | `supplier_id` sin candado | A |
| 3 | El libro sale bien armado | orden divergente, identificadores cortados | B, C |
| 4 | Si algo falla, suena una alarma **que puede sonar** | el verificador no ve sobrantes | B |
| 5 | Lo declarado queda congelado y la deriva se detecta | **no existe** | D |

---

## Bloque A — Los candados · ✅ HECHO el 2026-08-02 (v2.339.0)

Migraciones `20260802201721`, `20260802201854` y `20260802202628`. Verificado
contra prod bajo `BEGIN … ROLLBACK`: el índice rechaza el duplicado, la RPC
responde con el nombre de la otra ficha, y liberar y reasignar sigue andando.
A6 fue primero a staging; después de aplicar, `count()` de 23,617 filas de
`sales_invoices` en 27 ms — el initplan intacto.

Un hallazgo que salió al hacerlo: **el candado podía romper el sync de correos**.
`upsert_proveedor_from_dte` asignaba `supplier_id` sin mirar si ya estaba
tomado, así que con el índice puesto el `INSERT` habría fallado con 23505 y se
habría caído el sync entero — el candado rompiendo justo el camino automático
que venía a proteger. Por eso A3 se aplicó **antes** que A1, en la misma
migración.

<details><summary>El plan original del bloque</summary>


Va primero porque **hoy la base está limpia**: aplicar el candado ahora no
requiere reparar nada. Cada semana que pasa es una oportunidad de que alguien
haga el clic que lo ensucia y entonces sí haya que limpiar antes.

| | Qué | Dónde |
|---|---|---|
| A1 | Índice único parcial en `proveedores_maestro(supplier_id) WHERE supplier_id IS NOT NULL` | migración |
| A2 | `set_proveedor_supplier` atrapa el `23505` y devuelve *"ese proveedor del ERP ya está vinculado a X"* | RPC + `FormProveedorDetail` |
| A3 | `ORDER BY id` en el lookup por NRC de `upsert_proveedor_from_dte` (H1b) | RPC |
| A4 | `fetchAllRows` en `check-purchases-reconciliation` (H14) | edge function |
| A5 | `GRANT EXECUTE … TO authenticated` en `get_libro_sujeto_excluido` (H8) | migración |
| A6 | Scope de sucursal en las ramas `minmax_ver_costos` / `productos_tab_catalogo_costos` de las policies de `purchase_receipts` y `sales_invoices` (H9) | migración · **tablas calientes: `lock_timeout`, ventana 06:00–11:59 UTC, staging primero** |
| A7 | Comentario explícito de por qué `get_notas_credito_compras` no lleva scope (H7) | RPC |

**Verificación del bloque:** intentar vincular dos fichas al mismo proveedor y
recibir el mensaje, no un error crudo.

</details>

---

## Bloque B — Que las alarmas puedan sonar · ✅ HECHO el 2026-08-02 (v2.341.0)

Migración `20260802205606` · `_shared/compararLibros.ts` + su test ·
`scripts/verificar-libros.mjs`.

| | Qué quedó | Verificado con |
|---|---|---|
| B1 | El veredicto exige que al portal no le sobre nada | test de 503 líneas contra 389 → `DIFIERE` |
| B2 | El cuadre recorre la unión de los días | — |
| B3 | Mismo orden en lo verificado y lo presentado | 335/335 y 211/211 en la misma posición |
| B4 | La cola usa el filtro del libro que la consume | 3 documentos que el libro necesitaba y no se pedían |
| B5 | Las diferencias de formato decimal se cuentan | `formato_decimal` en la respuesta |
| B6 | `npm run verificar:libros` baja el archivo por el botón | BOM sí · CRLF · sin salto final · 467 líneas |
| + | Detector de fichas de proveedor duplicadas | arranca en 0 |

**Pendiente de B6:** el script mide el formato y ya baja el archivo real, pero la
mitad de contenido necesita `ADMIN_INVOKE_SECRET` (o la service key) en el `.env`
local para poder pedirle el archivo al ERP. Sin eso dice explícitamente que el
contenido **no** se verificó, en vez de declarar algo que no midió.

<details><summary>El plan original del bloque</summary>

Es el bloque que convierte "anda bien" en "me entero si deja de andar bien".
Ninguno de estos es un bug del libro: son **defectos de los instrumentos**.

| | Qué | Por qué |
|---|---|---|
| B1 | `porConjunto` bidireccional: el veredicto exige que la bolsa quede **vacía** (H10) | hoy sobrar es gratis, y es justo el modo de fallo de A1 |
| B2 | Cuadre de ventas sobre la **unión** de los días, no solo los del ERP (H5) | un día que solo existe en el portal es invisible |
| B3 | Unificar el orden de `generar_csv_libro` con el de los RPC (H16) y **re-correr la verificación** | 38% de las líneas de compras se comparaban contra otra posición |
| B4 | `_docs_sin_numero_control` con el **mismo filtro de sello** que el libro (H12) | la cola pide un documento y el libro necesita otro |
| B5 | `normalizar()` deja de tapar: las diferencias de formato decimal se reportan aparte en vez de desaparecer (H21) | así se ven, y se decide si importan |
| B6 | **Jubilar `generar_csv_libro` como "segunda implementación"** (H11) y reemplazarla por el camino de la Parte 4: bajar el CSV real con Playwright y compararlo contra el del ERP | dos copias de la misma regla no son dos testigos; el navegador sí es un testigo distinto |

**B6 es el más importante y el que menos parece.** La verificación que corrí en la
Parte 4 ya existe como script; hay que convertirla en algo que se pueda correr
solo (un `npm run verificar:libros` que baje los dos archivos y escupa la tabla de
diferencias por columna). Con eso, la pregunta *"¿el libro de este mes coincide con
el origen y donde no, por qué?"* se responde en un comando en vez de en una
sesión de auditoría.

**Verificación del bloque:** simular una ficha duplicada en staging y confirmar
que B1 lo reporta como DIFIERE. Hoy diría IDENTICO.

</details>

---

## Bloque C — Que el libro sea mejor que su origen · ~3-4 días

Después de la Parte 4 esto dejó de ser "mejoras" y pasó a ser lo que le falta al
libro para estar completo. De las 5 clases de diferencia contra el ERP, **4 ya las
gana el portal**; esta es la única que pierde.

| | Qué | Nota |
|---|---|---|
| C1 | **`purchase_receipts.sello_recibido`** desde la columna 22 del libro y la 6 del anexo, que `fastBackfill` ya descarga (H13) | **con validación (H19)**: solo si mide exactamente 40 alfanuméricos; si no, NULL + marca. 6 de 331 vienen con texto pegado a mano |
| C1b | **Del mismo archivo, la columna 4: el NIT del proveedor** (H22) | mismo código, un índice más. Ver Parte 5 |
| C8 | ~~**Ficha automática para los 21 proveedores con compras y sin ficha**~~ (H22) | ✅ hecho v2.348.4, pero **el agujero ya lo había cerrado E4**: quedaban 3 filas y un proveedor, cuyo NIT el origen tampoco tiene. Ver el estado al inicio del documento |
| C2 | Cruce `purchase_receipts` ↔ `purchase_dte_documents` **por sello** | clave exacta; reemplaza el 86.7% difuso |
| C3 | Exportar el **número de control real** del DTE en vez del stub de 20 del ERP (H2), con respaldo al del ERP cuando no haya cruce | acá el portal deja de copiar y empieza a corregir |
| C4 | `subtotal` a `numeric(14,4)` + re-sync (H6) | **bloqueado por la respuesta del contador** |
| C5 | `docs_count` derivado, no acumulado (H4) | hoy dice el doble |
| C6 | Aviso *"N ventas del período, $X, sin DTE sellado — no entran al libro"* (H3) | $288.60 que hoy nadie ve |
| C7 | Documentar en `DESIGN.md`/el doc de formato la decisión de BOM + CRLF + sin salto final (H20) | no es un error; es una decisión sin escribir |

**Verificación del bloque:** re-correr B6 y que la columna 22 pase de 331
diferencias a 0, y la 4 y la 5 sigan en "el portal acierta".

---

## Bloque D — El cierre de período · ~3 días

**Es lo que hace que "autónomo" sea comprobable en vez de una promesa.** Hoy no
existe registro de qué se declaró: cualquier mes se re-exporta y puede salir
distinto, y el archivo que bajó la contadora hace dos semanas no se puede
reproducir.

| | Qué |
|---|---|
| D1 | Tabla `libros_iva_cierres`: período, libro, **los bytes exactos del CSV**, su SHA-256, quién y cuándo |
| D2 | Un período cerrado se **lee del snapshot**, no de la tabla viva |
| D3 | Cron diario: recalcular el libro de los meses cerrados y comparar el hash. Si cambió, avisar con el detalle (*"junio cambió después de declararse: +1 documento, +$45.98"*) |
| D4 | En la vista: sello visible de *"declarado el DD/MM por X"* y bloqueo de la re-exportación silenciosa |

**D3 es la pieza de autonomía.** Con eso, el mes no solo cierra: se queda vigilado
solo. Y la deriva —que hoy ocurre y nadie ve— pasa a ser un aviso.

---

## Bloque E — Fuera del camino del mes, pero urgente por otra razón

| | Qué | Por qué no espera |
|---|---|---|
| **E1** | **Empezar a guardar el costo unitario por línea vendida** | **Es lo único irreversible de todo el documento.** El resto se puede hacer en dos meses sin perder nada; esto no: lo que no se capture hoy no existe mañana, y sin él no hay costo de ventas ni Estado de Resultados. Aunque nada lo consuma todavía, hay que empezar a escribirlo. |
| E2 | Notas de crédito: vista "libro ajustado" con las dos verdades lado a lado; y capturarlas donde nacen | $1,677.61 de julio se declara estos días |
| E3 | Anexo de retención de Renta (Art. 156); alarma de sujeto excluido (Art. 119) | `retiene_renta` existe y no se usa en ningún lado |
| ~~**E4**~~ | ~~**Barrido del maestro de proveedores del ERP**~~ | ✅ **HECHO** el 2026-08-02 (v2.340.0). Ver Parte 6 |

---

## Cronograma

| Semana | Bloques | Qué queda logrado |
|---|---|---|
| 1 | **A** + **E1** + las 3 decisiones | Nada puede empeorar. El reloj irreversible arranca. |
| 2 | **B** | Las alarmas pueden sonar. `npm run verificar:libros` responde en un comando. |
| 3 | **C** | El libro es mejor que su origen en **todas** sus columnas. |
| 4 | **D** | El mes cierra, se congela y se vigila solo. |
| después | **E2**, **E3** | Lo que hoy no se declara y debería. |

## DÓNDE QUEDÓ ESTO — al cierre del 2026-08-03

**Leé esto antes que el resto del documento.** Lo de abajo se escribió el 2026-08-02
y varias de sus cifras ya no son ciertas; acá está el estado real.

| Bloque | Estado | Dónde |
|---|---|---|
| **A** — los candados | ✅ **Hecho** | v2.339.x |
| **E4** — barrido del maestro de proveedores | ✅ **Hecho** | v2.340.0 |
| **B** — que las alarmas suenen | ✅ **Hecho** | incl. las 3 alarmas de CCF y el cron de repaso 22:00 |
| **C** — que el libro sea mejor que su origen | ✅ **Hecho, menos C4** | C1 y C2 v2.348.0 · C3 v2.348.2 · C5 v2.347.2 · C6 y C7 v2.348.1 · C1b y C8 v2.348.4 |
| **C4** — `subtotal` a `numeric(14,4)` | ⏸️ **Bloqueado** | espera al contador: ¿2 o 4 decimales? |
| **D** — el cierre de período | 📄 **Documentado, pendiente de confirmación** | `docs/BLOQUE-D-CIERRE-DE-PERIODO.md` — diseño cerrado + la deriva MEDIDA + 4 decisiones abiertas |
| **E3** — anexo de retención de Renta | ✅ Construido, ❌ **sin dato** | hay **0** proveedores marcados `retiene_renta`; el anexo sale vacío hasta que el contador marque cuáles de los 14 candidatos aplican |
| **Cosas chicas** (Parte 3 §6) | ⬜ **Aprobadas, no hechas** | las 4 |
| Los DTE de gastos fuera del libro | ✅ **Investigado el 2026-08-05** | el número mezclaba documentos de signo opuesto. Ver «Parte 10» al final |

### Cifras de este documento que quedaron desactualizadas

- **C8 / H22 — «21 proveedores con compras y sin ficha, 98 filas con NIT vacío,
  $17,757»**: era cierto al medirlo, y **E4 lo cerró antes de que C8 existiera**. Al
  2026-08-03 quedan **3 filas y un solo proveedor** (PEPSI), y su fila en el libro
  del origen trae la columna del NIT **vacía** — el origen tampoco lo sabe. No es
  recuperable por código. Ver §11 del doc de formato.
- **«los 495 DTE de gastos»**: el cruce se rehízo con el sello como camino
  adicional. Hoy son **436 / $8,184.31**.
- **C1 — el sello**: la lectura de «julio 56.7%, falta backfill» era equivocada. El
  sello **falta por SUCURSAL, no por fecha**: Bodega 63%, Salud 3 31%, y Salud 1,
  Salud 2, Salud 4 y La Popular en **cero**, porque el origen no lo emite para
  ellas. Ningún backfill lo va a completar. Ver §11 del doc de formato.
- **El aviso de «CCF sin NRC»**: más pesimista que la realidad. Los 29 nombres de
  cliente distintos de junio y julio resuelven a **exactamente una** ficha con NRC.
  Falta el vínculo, no el dato. Ver §12 del doc de formato — y por qué NO se
  arregló en el acto.

### Lo que sigue abierto y necesita una persona, no código

PEPSI sin NIT en ninguna fuente · MIO PHARMA y GENACOL comparten NIT (H26) ·
NEGOCIOS VIDZA con un NIT imposible (H25) · BANCO PROMÉRICA sin vincular · 7
totales que difieren exactamente por ÷1.13 · la cuenta `qa.test` con permisos sobre
los 60 módulos desde el 2026-07-25.

---

## Decisiones tomadas — 2026-08-02

Repasado bloque por bloque con Alex el 2026-08-02. **Lo aprobado se ejecuta; lo
demás queda escrito acá y no se vuelve a discutir hasta que él lo reabra.**

| | Decisión | Nota |
|---|---|---|
| **A, B, C, D** | ✅ **Aprobados**, en ese orden | el camino principal completo |
| **C4** (`subtotal` a `numeric(14,4)`) | ⏸️ **Bloqueado** — Alex consulta al contador si el anexo de percepción se presenta con 2 o 4 decimales | el resto de C avanza igual |
| **E1** (costo por línea vendida) | 📄 **Documentado, no se ejecuta** | queda dicho que es lo único irreversible: cada día que pasa es historia que no se recupera. La decisión es de Alex y está tomada a sabiendas |
| **E2** (notas de crédito) | 📄 Documentado | |
| **E3** (retención de Renta / sujeto excluido) | 📄 Documentado | |
| **E4** (barrido del maestro de proveedores) | ✅ **Aprobado, apenas termine A** | idea de Alex, verificada contra el ERP — ver Parte 5 |
| **Cosas chicas** (Parte 3 §6) | ✅ Aprobadas | |
| Los 495 DTE de gastos fuera del libro | 🔍 **Investigar a fondo** antes de tocar nada | Parte 5 §4 |

## Una nota de higiene

Para la verificación de la Parte 4 usé la cuenta `qa.test`, que desde el
2026-07-25 tiene permisos sobre **los 60 módulos** para poder auditar visualmente.
No la toqué, pero quedó pendiente desde entonces decidir si se le devuelve el
alcance mínimo. Con B6 convertido en script recurrente, esa cuenta va a usarse
seguido — conviene resolverlo.
# Parte 3 — Hacia dónde llevar el módulo

Dijiste que el portal va a ser el sistema principal y único de la farmacia. Eso
cambia el objetivo. Hoy el módulo es **una fotocopiadora de siete reportes del
ERP**, y esa es su techo: no puede ser mejor que el ERP, y hereda sus defectos —
la truncación de 20 caracteres, el número de control que se repite, el sello que
no publica.

Lo que sigue está ordenado por cuánto cambia eso.

## 1. Cierre de período — el hueco más grande que tiene el módulo

**Hoy no existe registro de qué se declaró.** Cualquier mes se re-exporta y los
números pueden salir distintos: un re-sync trae una compra, el número de control
se completa, alguien vincula un proveedor. El archivo de junio que bajó la
contadora hace dos semanas **no se puede reproducir hoy**.

Lo que hace falta:

- **Declarar un período congela sus bytes.** Se guarda el CSV exacto, su SHA-256,
  quién y cuándo. `libros_iva_cierres`.
- **Un período cerrado se lee del snapshot**, no de la tabla viva.
- **Deriva detectada, no aplicada**: si el libro vivo deja de coincidir con lo
  declarado, se avisa —*"junio cambió después de declararse: +1 documento,
  +$45.98"*— y contabilidad decide si va modificatoria. Hoy eso pasa y nadie se
  entera.

Sin esto, "el dato es 100% confiable" no se puede sostener: es confiable *hoy*, y
nadie puede probar qué decía ayer.

## 2. El sello como clave de identidad

Con H13 capturado, el sello (40 caracteres, único por DTE) permite:

- **Cruce exacto `purchase_receipts` ↔ `purchase_dte_documents`**, reemplazando el
  86.7% difuso por 100% donde ambos lados lo tengan.
- **Exportar el número de control REAL** en vez del stub de 20 caracteres del ERP
  (H2). Acá el portal deja de copiar y **empieza a corregir** — que es el momento
  en que deja de ser una fotocopiadora.
- **Detección de duplicados** por sello, no por número de documento truncado.

## 3. Las notas de crédito, adentro

$1,677.61 de julio y $986.70 de junio viven en una pestaña con un cartel. La
decisión de no meterlas al libro fue correcta —no crear dos verdades del mismo
período— pero es una parada, no un destino.

- **Ahora:** una vista "libro ajustado" que muestre el libro y el libro con el
  ajuste del Art. 62 lado a lado, con el neto. Que la contadora vea las dos
  verdades en pantalla en vez de hacer la resta en papel.
- **Después:** capturarlas donde nacen. El ERP tiene la pantalla.

## 4. Lo que hoy no se puede declarar y debería

- **Retención de Renta, Art. 156** — 10% sobre servicios de personas naturales.
  `proveedores_maestro.retiene_renta` existe y **no se usa en ningún lado**. Es un
  anexo entero ausente, con exposición real.
- **Sujeto excluido, Art. 119** — `regimen_fiscal` ya se calcula. Cero casos hoy;
  el valor es la **alarma** el día que aparezca uno, no el reporte vacío.
- **Percepción como control, no como copia** — el portal sabe qué proveedores
  perciben (`percibe_1`). Puede avisar cuando un proveedor que percibe emite un
  documento **sin** percepción. Eso es algo que el ERP no hace.

## 5. El costo de venta — decidilo ahora, no después

`CONTABILIDAD-ALCANCE-2026-08-01.md` lo dice: **falta el costo por línea vendida y
no es reconstruible.**

Si el portal va a ser el sistema único, esto es lo más urgente de todo lo escrito
acá, y no por lo que impide hoy sino por lo que impide para siempre:

- Sin costo por línea no hay costo de ventas, no hay margen real, no hay Estado de
  Resultados. Los libros de IVA son obligación fiscal; **esto es saber si el
  negocio gana plata.**
- **Cada día que pasa es un día de historia que no se recupera.** El resto de este
  plan se puede hacer en dos meses sin perder nada. Esto no: lo que no se capture
  hoy no existe mañana.

Empezar a guardar el costo unitario al momento de la venta —aunque nada lo
consuma todavía— es la decisión de mayor valor y menor costo del documento.

## 6. Cosas chicas que se notan todos los días

- **Ir del libro al documento**: click en una fila → el DTE. Existe de Proveedores
  a Facturas; falta desde el libro.
- **Exportar el año**: hoy es mes por mes. `librosIva.js` avisa que a un año le
  haría falta `fetchAllRows` — hacerlo antes de que alguien lo pida.
- **Un panel de salud fiscal**: los tres cuadres, los pendientes de número de
  control, las ventas sin sello, los proveedores sin NIT — en una pantalla. Hoy
  cada control avisa por push y muere ahí.
- **`numero_control` no es único** (Parte 0): documentarlo donde se use como si lo
  fuera, y no ponerle nunca una restricción de unicidad.

---

## Orden recomendado

**Esta semana:** Fase 1 completa (los candados) + la pregunta al contador sobre los
decimales + **la decisión sobre el costo de venta**.

**Este mes:** Fases 2 y 3, y el cierre de período (Parte 3 §1). Con eso el módulo
pasa de "replica bien" a "no se puede romper sin que alguien se entere".

**Después:** el sello como clave, las notas adentro, y los anexos que faltan.

---

# Parte 4 — La verificación que faltaba (H15), hecha

2026-08-02. `verificar-csv-libros` declara en su encabezado lo que **no** puede
probar: *"que el navegador escriba el archivo igual (BOM, CRLF, escape de
comillas)"*. Eso nunca se había medido. Acá está.

## Cómo

**El archivo del portal se bajó por el botón real**, con Playwright contra
`vite preview` (build de producción, `OUT_DIR=dist-verif`, puerto 4174, cuenta
`qa.test`): login → `/libros-iva` → retroceder al mes con el stepper de la vista →
clic en Exportar → capturar la descarga y leer los **bytes crudos**. Es el único
camino que ejercita a la vez el RPC, el mapeo de columnas de `LibrosIvaView` y
`exportCsv`. No se reimplementó nada.

**El archivo del ERP** se bajó con `erp-csv-probe` vía `pg_net` desde SQL, para
no sacar el secreto de la bóveda.

Comparado: **libro de compras, Bodega (branch 30 = el id más alto, o sea el último
bloque del archivo), junio 2026, 335 filas**, y **libro de consumidor, sucursal 2,
junio 2026, 30 filas**.

## Resultado 1 — El formato de archivo difiere en tres cosas

| | ERP | Portal |
|---|---|---|
| BOM UTF-8 | no aparece | **SÍ** (`EF BB BF`) |
| Fin de línea | **LF** (`\n`) | **CRLF** (`\r\n`) |
| Salto al final | **SÍ** | **NO** |
| Comillas | nunca, en 335 filas | RFC 4180 cuando hace falta (4 filas) |
| Decimales | **inconsistente** — `1166` en 10 filas y `1166.00` en 20, misma columna | siempre 2 |

Las tres primeras nunca estuvieron documentadas y **ninguna es un error del
portal**: el BOM es deliberado (sin él Excel en es-SV rompe los acentos de
"Droguería"), y el CRLF es la convención CSV. Pero son una decisión que hoy no
está escrita en ningún lado, y si algún día el archivo se sube a un sistema
externo, es lo primero que hay que confirmar.

*(El BOM del ERP no se pudo determinar: `Response.text()` lo elimina al decodificar
según la especificación. Se declara como no medido en vez de suponerlo.)*

## Resultado 2 — Libro de compras: 329 de 335 filas idénticas

| Filtro | Idénticas |
|---|---|
| Byte a byte | 4 / 335 |
| Ignorando NIT (col 4), sello (col 22) y espacios en col 3 | **329 / 335** |

Y las diferencias, una por una:

**Col 22, el sello — 331 filas.** El ERP lo trae, el portal lo deja vacío. Es
**H13** y es la única diferencia donde al portal le falta el dato.

**Col 4, el NIT — 19 filas, 6 proveedores. El portal acierta en los 6.**
Adjudicado contra el DTE firmado que el proveedor emitió y Hacienda aceptó
(`purchase_dte_documents.emisor_nit`), que es la fuente con autoridad:

| Proveedor | ERP | Portal = DTE firmado |
|---|---|---|
| PHARMALAND | `111` | `06141210161052` |
| GUARDADO | `06142808921106` | `06142808921104` |
| LABORATORIOS VIJOSA | `04142407750010` | `06142407750010` |
| DROGUERÍA DROMEDIC | `06141907740020` | `06142602241077` |
| VITAL MEDICAL | `06141303151077` | `06141303151073` |
| PROQUIFAR | *(vacío)* | `06142710811041` |

**El maestro de proveedores del ERP tiene 6 NIT equivocados** —dos con el dígito
verificador cambiado, uno con el código de municipio, uno con basura (`111`), uno
completamente distinto y uno vacío— y el portal ya los tiene bien.

**Col 5, el nombre del proveedor — 6 filas. El ERP le borra las comas.**

```
ERP    : OPERADORA DEL SUR S.A. DE C.V. (WALMART  DESP…
portal : OPERADORA DEL SUR S.A. DE C.V. (WALMART, DESP…
ERP    : DNA PHARMACEUTICALS  S.A. DE C.V.
portal : DNA PHARMACEUTICALS, S.A. DE C.V.
```

El ERP reemplaza `,` por espacio —presumiblemente para no romper algún CSV suyo—
y con eso **muta la razón social** del proveedor. El portal escribe el nombre real
y, cuando el nombre trae comillas (`JOSE SALVADOR GUEVARA "AGUA FRIA"`, 4 filas),
las escapa como manda RFC 4180. El ERP no comilla nunca.

**Col 3, el nº de documento — 2 filas, y solo por espacios** (` 6144BD51-…` contra
`6144BD51-…`). Descontando espacios: **0 diferencias reales**. El truncado a 20 es
idéntico de los dos lados, que es lo que ya sabíamos (H2).

## Resultado 3 — Libro de consumidor: 30 de 30

| Filtro | Idénticas |
|---|---|
| Byte a byte | 0 / 30 |
| Ignorando cols 7-8 y el formato decimal | **30 / 30** |

Las dos únicas causas:

1. **Cols 7 y 8, los códigos de generación** — las 30 filas. Es §4.1: el ERP
   reporta los del medio del día y el portal los correctos. La divergencia es
   deliberada y está documentada.
2. **Col 14 (gravadas), 10 filas de formato decimal**: el ERP escribe `1166` en
   unas filas y `1166.00` en otras, **en la misma columna del mismo archivo**. Como
   número son idénticas en las 30 filas (`float(erp) == float(portal)` en las tres
   columnas de dinero).

**Todos los montos del libro de consumidor coinciden exactamente.**

## Hallazgos nuevos que salieron de acá

| # | Hallazgo |
|---|---|
| **H17** | El ERP **muta la razón social** de los proveedores: reemplaza las comas por espacios. El portal las tiene bien. |
| **H18** | El maestro del ERP tiene **6 NIT equivocados**, verificado contra el DTE firmado. El portal los tiene bien. |
| **H19** | La columna del sello del ERP está **contaminada**: 6 de 331 no miden 40 caracteres — hay un código de generación (36), uno con un espacio adentro (41), y tres con texto pegado a mano (`…FFEFGbenicar`, `…RVBD C-2274298`). **Capturar el sello exige validarlo**, no copiarlo. |
| **H20** | El formato del archivo (BOM, CRLF, salto final) difiere del ERP y **nunca estuvo documentado**. |
| **H21** | El ERP escribe **decimales inconsistentes** dentro de una misma columna. `normalizar()` del verificador lo tapa, y por eso nunca se vio. |

## Qué significa para el criterio "no replicar lo que el ERP hace mal"

El resultado es el mejor posible, y no era obvio: **de las 5 clases de diferencia
del libro de compras, 4 son defectos del ERP que el portal ya corrige** —el NIT,
la razón social, las comillas, el formato decimal— y **1 sola es un dato que al
portal le falta**: el sello.

Dicho de otro modo: si alguien hubiera "arreglado" el portal para que coincidiera
al 100% con el ERP, habría metido 6 NIT equivocados y 6 razones sociales mutiladas
en un libro fiscal.

**Eso reordena la Fase 3.** Capturar el sello (H13) deja de ser una mejora y pasa
a ser *lo único* que le falta al libro de compras para ser mejor que su origen en
todas sus columnas. Con H19, la regla de captura es: tomar el sello del ERP **solo
si mide exactamente 40 caracteres alfanuméricos**; si no, dejarlo vacío y
marcarlo, porque un sello con `benicar` pegado atrás no es un sello.

---

# Parte 5 — Los proveedores que el portal no tiene (2026-08-02)

Alex propuso barrer el maestro de proveedores del ERP por
`editar_proveedor.php?id_proveedor=N` para obtener el id del ERP y enlazarlo con
el portal. Lo probé contra el ERP. **Funciona, pero la premisa se corrige en un
punto y el alcance crece en otro.**

## 1. El id del ERP ya lo tenemos — lo que falta es la ficha

`suppliers.erp_supplier_id` guarda el id del ERP de los 89 proveedores a los que
alguna vez se les compró. Para eso no hace falta barrer nada. El hueco real es
otro:

| | |
|---|---|
| Fichas en `proveedores_maestro` | 107 (68 con `supplier_id`, 39 sin) |
| `suppliers` con compras | 89 |
| **Con compras y SIN ficha** | **21 · 142 compras · $33,900** |
| Ids del ERP entre 1 y 138 que el portal nunca vio | 49 |

`get_libro_compras` saca el NIT **solo** de `pm.nit`, sin fallback. Entonces esos
21 proveedores salen en el libro **con el NIT en blanco**:

| Últimos 12 meses | 98 filas · $17,757 |
|---|---|
| 2025-09 | 33 filas · $7,023.88 |
| 2026-06 | 2 filas · $75.12 |
| 2026-07 | 1 fila · $28.00 |

Y **ninguno de los 21 tiene un DTE en el portal** (0 coincidencias por NRC, con y
sin normalizar). O sea: el portal no tiene de dónde sacar su NIT por su cuenta.

## 2. H22 · El NIT viaja en un archivo que ya bajamos y no leemos

El CSV del libro de compras del ERP —**el mismo que `fastBackfill` descarga en
cada sync** (`LIBRO_CSV`, `sync-erp-purchases:391`)— trae el NIT en la columna 4:

```
02/09/2025;4;; 32F0F1C2-7433-4017-;06141007840010;DROGUERIA COMERCIAL SALVADOREÑA SA DE CV;…
                                   └── col 4: el NIT que al portal le falta
```

Bajado y verificado en Bodega, septiembre 2025: las 22 filas de ese proveedor lo
traen. `columnaPorNumero(csv, 3, 21)` ya recorre este archivo leyendo las
columnas 3 y 21 — **el NIT está a un índice de distancia, igual que el sello de
H13 (columna 22)**. Son la misma corrección de código.

→ Por eso C1 se amplía a C1b y aparece C8: con la columna 4 se puede crear la
ficha faltante y cerrar las 98 filas sin NIT, **sin barrer nada**.

## 3. E4 · El barrido sirve para lo que ningún CSV publica

Probado: no hay endpoint JSON (`descargar_proveedores_json.php`,
`reporte_proveedores_json.php`, `proveedores_json.php` → 404 los tres). Hay que
leer el HTML de `editar_proveedor.php`, ~41 kB por ficha. Lo que devuelve y no
está en ningún CSV: `nombre_proveedor`, `direccion`, `dui`, `giro`, `telefono1`,
`hi_percibe` (si percibe el 1%), y los selects `departamento`, `municipio`,
`distrito`, `categoria_proveedor`, `tipo`, `pais`.

La máquina ya existe: `scripts/migracion-clientes/bloque.py` hace login, cookie,
reintentos, parseo y checkpoint contra `editar_cliente.php`. Son ~140 fichas, no
27,591 — minutos, no días. **El código nuevo va en `scripts/migracion-proveedores/`**
para no colisionar con la migración de clientes, que corre en otra sesión.

### H23 · El `id_proveedor` depende de con qué cuenta del ERP entrás

Probé los mismos ids con las dos credenciales:

| `id_proveedor` | cuenta de clientes (`.env`) | cuenta de compras (`ERP_PURCHASES_CREDS`) |
|---|---|---|
| 112 | ficha vacía | **DROGUERIA COMERCIAL SALVADOREÑA** ✅ |
| 125 | **"PROVEEDOR NO DEFINIDO"** | ficha vacía |

**El mismo número apunta a proveedores distintos según la cuenta.** Es el mismo
patrón que `feedback_un_id_sin_su_numeracion_apunta_a_dos_cosas`. El barrido
tiene que usar **la cuenta de compras** — la misma que produce `proveedor.id` en
`descargar_compras_json.php`. Con la otra importaría datos de otra empresa.

### Dos reglas firmes para el barrido

1. **El ERP solo llena lo que el portal no tiene.** La Parte 4 probó que su
   maestro tiene 6 NIT equivocados y le borra las comas a las razones sociales.
   Donde el portal tenga un DTE firmado, gana el portal. Sin esta regla, importar
   el maestro del ERP **empeora** el libro fiscal.
2. **Va después de A1.** Crear ~140 fichas de golpe es exactamente el evento que
   puede generar el `supplier_id` duplicado de H1 — y hoy, sin B1, ese duplicado
   pasaría la verificación con veredicto IDENTICO.

## 4. H24 · 495 DTE de gastos que no están en ningún libro de compras

Fui a ver las **39 fichas sin `supplier_id`** esperando otro hueco de vinculación.
No lo son. Las 39 tienen `source='dte'`, cero coincidencia de NRC con algún
`supplier` libre, y son **gastos y servicios**: ANDA, CAESS, Telefónica/CTE, el
banco, Boxful, Calleja, fumigaciones, talleres, personas naturales.

Llegan por correo como DTE y **nunca pasan por el módulo de compras del ERP**, así
que no tienen contraparte en `purchase_receipts` y **no entran al libro**:

| 2026 (al 2 de agosto) | 495 documentos · 299 CCF · **$1,176.23 de IVA** · $16,584.93 |
|---|---|

Ni el portal ni el ERP los declara, porque el ERP tampoco los conoce.

**No está determinado si la contadora los declara por otra vía** — es
perfectamente posible que lleve los gastos aparte. Se declara como **no medido**
en vez de suponerlo. La decisión tomada es **investigarlo a fondo primero**
(histórico completo, separar lo que da crédito fiscal de lo que no) y recién
entonces consultarlo. **No incorporarlos al libro sin confirmar**: si ya se
declaran aparte, se duplicarían.

## Hallazgos nuevos de esta parte

| # | Hallazgo |
|---|---|
| **H22** | El NIT del proveedor viaja en la **columna 4** del CSV del libro que `fastBackfill` ya descarga, y no se lee. 21 proveedores con 142 compras salen en el libro **sin NIT** (98 filas / $17,757 en 12 meses) porque no tienen ficha. |
| **H23** | El `id_proveedor` del ERP **no es global**: el mismo número devuelve proveedores distintos según con qué cuenta se entre. El barrido exige la cuenta de compras. |
| **H24** | **495 DTE de gastos de 2026** (299 CCF, $1,176.23 de IVA) de servicios que no pasan por el módulo de compras del ERP **no aparecen en ningún libro**. Si no se declaran por otra vía, es crédito fiscal perdido. |

---

# Parte 6 — E4 hecho: el maestro de proveedores del ERP (2026-08-02)

Migraciones `20260802203718` … `20260802204432` · edge function
`scrape-erp-proveedores` · v2.340.0.

## Resultado

| | Antes | Después |
|---|---|---|
| Fichas en `proveedores_maestro` | 107 | **161** |
| Fichas con vínculo al ERP | 68 | **123** |
| **Filas del libro sin NIT (12 meses)** | **98 · $17,757** | **28 · $866.12** |
| `supplier_id` / NIT / NRC duplicados | 0 | **0** |

54 creadas, 1 ligada, 31 completadas. Lo que queda sin NIT es casi todo **PEPSI**
(27 filas, $784.93): el ERP no lo identifica con NIT, NRC ni DUI, y el CHECK
`nit IS NOT NULL OR dui IS NOT NULL` impide crearle ficha — correctamente, porque
una ficha que no identifica a un contribuyente no sirve en un libro de IVA.

## Las reglas que hacen que esto sea seguro

1. **El ERP solo llena lo vacío. Nunca pisa.** `nit` no se toca jamás en una
   ficha existente; solo se escribe al crear una, que por definición no tenía.
2. **`percibe_1` es asimétrico**: el ERP puede encenderlo, nunca apagarlo. Un
   `true` del portal salió de un DTE con percepción real; un `false` del ERP solo
   dice que nadie tildó la casilla. Y `percibe_1_override` gana siempre.
3. **Ligar antes que crear**: se busca ficha por NIT y por NRC normalizado. Si
   existe sin vínculo, se liga. Si está vinculada a otro, se reporta y no se toca.
4. **El NIT se valida por forma antes de creerle** (`nit_sv_valido`).
5. **La cuenta de compras, no la de clientes** (H23).

## Hallazgos nuevos

| # | Hallazgo |
|---|---|
| **H25** | **NEGOCIOS VIDZA tiene un NIT imposible en el ERP**: `06014018141032`, día 40 y mes 18. Y el ERP lo declara así en su libro de compras hoy. Es un séptimo NIT malo, distinto de los 6 de la Parte 4 porque éste no es "diferente del DTE" sino **demostrablemente inválido**. Queda fuera del portal. |
| **H26** | **`MIO PHARMA` y `GENACOL LATIN AMERICA` comparten NIT** (`06141006091029`) en el maestro del ERP. Son dos fichas del ERP para un mismo contribuyente, o una de las dos tiene el NIT de la otra. El barrido lo reportó como conflicto y no duplicó. **Sin resolver: hay que mirarlo en el ERP.** |
| **H27** | La ficha de `editar_proveedor.php` y el libro de compras del ERP **coinciden en 52 de 52 NIT**, errores incluidos. O sea que el maestro del ERP es internamente consistente: sus 6 NIT malos no son un desajuste entre pantallas, son el dato que declara. |

## Lo que quedó afuera, y por qué

De los 133 proveedores del catálogo del ERP, **12 no entraron**:

- **Sin NIT ni DUI utilizables (9)**: PEPSI, BRULAB, AVANT PHARMACEUTICAL, DRAGAZ,
  ADAMS, BANCO PROMÉRICA, NO DEFINIDO, INVERSIONES DROMED, GLOBAL PAY SOLUTIONS.
- **NIT con forma inválida (3)**: `PROVEEDOR PRUEBA` (`43532453245325`, mes 53),
  CACELA (`0614160758`, 10 dígitos), NEGOCIOS VIDZA (H25). PHARMALAND entró con
  su NIT bueno del DTE — el `111` del ERP se descartó.

**BANCO PROMÉRICA es el caso que más molesta**: el portal ya tiene su ficha por
DTE y el ERP tiene su `id_proveedor`, pero el ERP no le registra NIT, así que no
hay por dónde ligarlos automáticamente sin inventar el vínculo. Se puede resolver
a mano desde el select "Match ERP" de la ficha — que ahora, con A2, avisa si ese
proveedor del ERP ya está tomado.

## Riesgo conocido que queda abierto

Las 54 fichas nuevas llevan el NIT **del ERP**, no de un DTE firmado. Si mañana
llega un DTE de uno de esos proveedores con un NIT distinto —que es exactamente
lo que pasó con los 6 de la Parte 4—, `upsert_proveedor_from_dte` busca por NIT,
no lo encuentra, y **crea una segunda ficha**. La primera seguiría con el vínculo
al ERP, así que el libro usaría el NIT del ERP y no el firmado.

Hoy no puede pasar en silencio: el barrido dejó **0 NRC duplicados**, así que un
detector de "dos fichas con el mismo NRC normalizado" arrancaría en cero y
cualquier caso nuevo sería visible. **Va al Bloque B**, que es donde viven las
alarmas.

---

# Parte 7 — La mirada contable, y el libro de compras incompleto (2026-08-02)

Alex preguntó qué pensaría un contador viendo los libros. Al medirlo para
responder apareció el hallazgo más grande del día, y **corrige un número que yo
mismo había dado mal**.

## H28 · El libro de compras deja afuera ~$8,500 de crédito fiscal en dos meses

Antes había medido "495 DTE de gastos con $1,176 de IVA fuera del libro" (H24) y
lo presenté como el tamaño del problema. **Estaba mal**: esa consulta solo miraba
proveedores de servicios (los que no tienen ninguna compra en el ERP) y se
perdía lo más grande.

Simulando el libro completo —compras del ERP más los DTE recibidos que no tienen
compra, deduplicando por código de generación— junio-julio 2026 da:

| Clase | Docs | Crédito fiscal | Monto |
|---|---|---|---|
| **La compra FALTA de verdad** — el proveedor tiene compras en el ERP, pero ese CCF no está y no hay ninguna con ese monto ±3 días | **143** | **$7,375.57** | $65,800 aprox |
| **Gastos que nunca entran** — proveedor sin ninguna compra en el ERP | **302** | **$1,156.80** | $16,414.25 |
| El cruce falla pero la compra existe | 83 | $2,389.62 | — |
| **Total fuera del libro** | **528** | **$10,921.99** | $101,880.54 |

Contra un crédito fiscal declarado de **$49,525.79** en el mismo período.

**Dos cautelas que hay que decir con el número:**

1. *"No encontré una compra con ese monto"* no es *"no existe"*. Puede haber
   diferencias de redondeo, compras parciales o fechas corridas. El grupo de 143
   necesita revisión documento por documento antes de reclamar nada.
2. El **Art. 65-A de la Ley de IVA** pide que el gasto sea indispensable para el
   giro. No todo CCF recibido es crédito deducible. **$8,532 es el techo, no lo
   confirmado.**

## H29 · Los CCF de las 19 notas SÍ están en el portal

Los 19 CCF que las notas de crédito corrigen y que no aparecen como compra
**están en `purchase_dte_documents`** — llegaron por correo, firmados y sellados.
Lo que falta es que estén en el ERP.

Refuerza H28: el portal ya tiene el documento. El único motivo por el que no
entra al libro es que el libro se arma desde el ERP y no desde lo que el portal
sabe.

## H30 · El libro de junio ya cambió después de junio

Evidencia concreta y de hoy: junio 2026 tenía **2 filas con el NIT en blanco**;
el barrido de proveedores (E4) creó las fichas faltantes y esas dos filas **ahora
traen NIT**. Ningún monto cambió, pero cambió una columna que el Art. 86 exige.

Además hay **102 cambios registrados en ventas de junio después del 1 de julio**
(estado, sello, cliente, total), con su antes y su después en
`sales_invoice_changelog`.

Es la justificación empírica del Bloque D: **no es que el libro *pueda* cambiar
después de declararse — ya cambió.**

## H31 · El portal tiene el número completo y exporta el cortado

**778 de 875** compras de junio en adelante tienen el documento en exactamente 20
caracteres, copiado del ERP. Pero **658 de ellas tienen el código de generación
completo disponible** en `purchase_dte_documents`, porque el DTE llegó por correo.

O sea que **el 75% del H2 se puede cerrar hoy sin pedirle nada a nadie**: unir por
el código que ya está y exportar el completo.

## Lo que un contador cambiaría, en orden

Con los artículos que lo respaldan. **No es asesoría legal — hay que confirmarlo
con el contador de la empresa.**

| # | Qué | Base | Riesgo si no se hace |
|---|---|---|---|
| 1 | **Restar las notas de crédito del libro de compras** | Art. 62 Ley de IVA | Se declara crédito fiscal **de más**: $2,737.87 sobre $49,525.79 en jun-jul (5.5%). Es lo único donde el riesgo es multa, no pérdida |
| 2 | **Libro de compras completo** (ERP + DTE recibidos) | Art. 65 Ley de IVA — 3 períodos para reclamar | Hasta ~$8,500 de crédito fiscal que caduca por calendario |
| 3 | **Anexo de retención de Renta** | Art. 156 CT | Responsabilidad solidaria por el impuesto no retenido — la única exposición personal |
| 4 | **Cierre de período** (Bloque D) | Art. 139 CT | No se puede probar qué se declaró. Ya hay deriva medida (H30) |
| 5 | **Número de documento completo** | Art. 86 RCT | El libro no identifica sus propios documentos. 75% arreglable hoy (H31) |

Lo que **no** hay que cambiar: el filtro del sello, los NIT del portal, la
aritmética y la estructura de los libros. Eso está bien.

**Una observación de método:** los puntos 1 y 2 casi se compensan ($2,737 de más
contra ~$8,500 de menos) y es tentador leerlo como "queda parejo". No queda: son
dos incumplimientos distintos y solo uno de ellos se sanciona. Se arreglan por
separado.

---

# Parte 8 — El cruce del libro completo, y una corrección que estaba mal

## H28 corregido: el número era $8,532, no $10,922 — y tampoco $1,581

H28 dio **$10,921.99** de crédito fiscal fuera del libro. Al revisar el cruce
apareció que `documento_numero` no siempre guarda el código de generación:

| Forma | Compras jun-jul |
|---|---|
| Código de generación cortado a 20 | 733 |
| **Número de CONTROL** | 56 |
| **Correlativo del proveedor** | 27 |
| Otras (espacio adentro, `O` por `0`, punto final) | ~59 |

De ahí salió una "corrección" que decía que cruzando **por número de control** lo
sin registrar bajaba de $7,375 a **$1,581**. **Esa corrección era falsa**, y esta
es la parte que importa dejar escrita:

> Un número de control mide 31 caracteres y el ERP lo guarda **cortado a 20**,
> que es exactamente donde vive el correlativo. Los 1,180 DTE de junio-julio
> tienen **1,171 números de control distintos** y, truncados a 20, quedan
> **48 claves**. Cruzar por ahí junta ~25 documentos ajenos en cada una.

O sea que el "412 cruzados por número de control" eran falsos positivos masivos.
Se detectó contando las claves distintas — no leyendo el código.

## El cruce que quedó: dos caminos, y por qué no hay un tercero

| Camino | DTE jun-jul | Qué es |
|---|---|---|
| **Código de generación**, normalizado | **654** | 36 caracteres, único. La clave real |
| Número de control completo | **0** | ninguna compra lo guarda entero |
| **Proveedor + monto exacto ±3 días** | **81** | **heurística**, no prueba. Recupera $2,356.14 |
| **Sin cruce** | **445** | **$8,532.37** |

La normalización del documento del ERP (quitar espacios y puntos, `O`→`0`) es
necesaria porque hay filas tecleadas a mano: `9D063633- C6`, `13130.`,
`4999COBE-B30`. Un código de generación es hexadecimal, así que una `O` siempre
es un cero mal escrito.

**Verificado al aplicar:** la rama `registrada` da **$49,525.79**, idéntico al
libro del Art. 86 — el libro que se presenta no se movió. Y lo "sin registrar"
baja de 528 documentos a **445**: se fueron **83 falsos positivos por $2,389.62**.

## La lección de método

En una misma sesión el número pasó por **$1,176 → $10,922 → $1,581 → $8,532**, y
sólo el último está verificado en las dos direcciones. Las tres primeras veces el
error fue el mismo: **medir con una clave sin comprobar que la clave identifique
lo que se cree**. El NIT del proveedor, el número truncado a 20, el
`documento_numero` que guarda tres cosas distintas.

Antes de dar un número que salga de un cruce, hay que contar **cuántas claves
distintas produce ese cruce**. Si 1,180 documentos colapsan en 48 claves, el
cruce no identifica nada — y lo dice la aritmética, no la lectura del código.


---

# Parte 9 — Decisiones del 2026-08-02 (cierre de sesión)

| | Decisión de Alex |
|---|---|
| **Notas de crédito (Art. 62)** | **Solo documentar.** Lo confirma con el contador antes de tocar el libro. El monto medido ($2,737.87 de IVA sobre $49,525.79 declarados en jun-jul) queda escrito en la Parte 7 |
| **Bloque D — cierre de período** | **Solo documentar**, se evalúa después. La justificación empírica ya está en H30: el libro de junio *ya cambió* después de junio |
| **E3 — retención de Renta** | ✅ **APLICADO** — ver abajo |
| Las 11 ventas de agosto sin código de generación | **Descartado.** El mes en curso lo valida Alex antes de cerrarlo |

## E3 aplicado — lo que quedó

`get_candidatos_retencion_renta` · `get_anexo_retencion_renta` ·
`update_proveedor_manual` extendido · pestaña **Renta** en Libros IVA · campo en
la ficha del proveedor.

**Por qué E3 es distinto del resto del plan:** los otros hallazgos son crédito
fiscal que se pierde o que se declara de más. Éste no — si se le paga a una
persona natural por un servicio y no se retiene el 10%, **la empresa responde
solidariamente** por el impuesto no retenido, más la multa. No es plata que se
deja de ganar: es una deuda que aparece.

**Lo que el portal puede y no puede saber.** La retención se practica **al
pagar** y el portal registra lo que se **factura**. Por eso el anexo dice *lo que
correspondería retener*, no *lo retenido* — quien declara tiene que cruzarlo con
los pagos.

Y el portal **no decide quién**: distinguir un servicio de una compra de
mercadería es una lectura del documento, no un dato. `ANA FRANCISCA CEDILLOS` es
persona natural y le compran mercadería para reventa — ahí no aplica. El portal
acorta la lista (14 personas naturales con documentos en junio-julio, de 100
proveedores con movimiento) y el contador marca.

**El caso más claro medido:** `OMAR ARNULFO SERRANO CRESPIN`, NIT `018398946`
(DUI haciendo de NIT), categoría **Alquileres**, **$2,938.00** en junio-julio.
Marcándolo, el anexo devuelve 2 documentos y **$260.00** de retención — probado
bajo `BEGIN … ROLLBACK`.

**Un error propio corregido en el camino:** la primera migración creó un setter
suelto para `retiene_renta`. La ficha ya tiene **un** camino de escritura
(`update_proveedor_manual`), y dos formas de escribir el mismo registro se
separan el día que una gane un chequeo y la otra no. El setter se eliminó y el
campo entra por el camino de siempre.

**Lo que quedó sin verificar:** el campo nuevo en la ficha del proveedor compila,
lintea y pasa los gates, y espeja exactamente el control de «Percibe 1%» de al
lado — pero **no se pudo abrir ese modal desde el chequeo automático** (la
primera celda de la fila corta la propagación del clic). La pestaña **Renta** sí
está verificada en el navegador: monta, muestra las tarjetas correctas y explica
el vacío.

---

# Parte 10 — Los DTE fuera del libro, investigados (2026-08-05)

> ## ⚠️ Leer esto antes que la medición de abajo
>
> **Alex, 2026-08-05:** *«el sistema de origen no registra todas. El contador
> rearma el libro de IVA, anexando eso, las retenciones y las notas de crédito
> a mano.»*
>
> Eso **responde la pregunta A1** de `PREGUNTAS-CONTADOR-2026-08-03.md` y cambia
> el significado de todo lo que sigue:
>
> - Los **$5,825** de CCF sin registrar **no son plata perdida**: es muy
>   probable que ya estén en el libro que se declaró, metidos a mano.
> - Las **128 notas de crédito** que el libro del portal no resta **sí se
>   restan** al declarar. O sea que **no hay crédito fiscal declarado de más**,
>   y con eso se cae el único riesgo de multa que este documento identificaba.
> - El libro que produce el portal **no es el que se presenta**. Es un insumo.
>   El libro real se arma afuera, a mano, cada mes.
>
> **Lo que la medición de abajo sigue valiendo:** ya no como «plata que se
> pierde», sino como **la lista de lo que hay que anexar a mano** — que es
> exactamente el trabajo manual que se hace hoy sin ninguna lista.
>
> **Y lo que esto vuelve más grave, no menos:**
>
> 1. **El Bloque D deja de ser opcional.** Si el libro declarado se arma a mano
>    y por fuera, entonces **no existe en ningún sistema**: no se puede
>    reproducir, ni probar qué se declaró, ni compararlo con nada. La deriva que
>    H30 midió (el libro de junio ya cambió después de junio) ocurre sobre un
>    documento del que ni siquiera hay copia.
> 2. **Nadie está verificando el armado manual.** El portal tiene los 400 CCF
>    sellados por Hacienda. Si la contadora los junta de su propio correo o de
>    lo que le mandan las sucursales, los dos conjuntos pueden no coincidir —
>    **y hoy no hay forma de saberlo**. La pregunta correcta ya no es «¿cuánto
>    se está perdiendo?» sino **«¿lo que ella anexó coincide con lo que el
>    portal tiene?»**.
> 3. **El trabajo manual es el que el portal puede hacer.** Anexar los DTE
>    recibidos, restar las notas de crédito y sumar las retenciones es
>    precisamente lo que el Bloque C construyó. No hace falta pedirle a nadie
>    que cambie de método: alcanza con darle el libro ya armado y que ella lo
>    contraste.
>
> **Siguiente paso concreto, y es barato:** tomar **un mes ya declarado** y
> comparar, línea por línea, el libro de la contadora contra el que arma el
> portal. Si coinciden, el portal puede reemplazar el armado manual con
> confianza. Si no coinciden, la diferencia es justo lo que nadie está viendo.

El pendiente decía **436 documentos / $8,184.31** y estaba marcado «sin
investigar». Al abrirlo aparece que **ese total suma documentos de signo
opuesto**, así que no es una cifra que se pueda leer como «crédito fiscal que se
está perdiendo».

Cruce de junio-julio 2026, con el método que la Parte 8 dejó verificado (código
de generación normalizado como clave real, más la heurística proveedor + monto
exacto ±3 días), **deduplicando por código de generación**:

| Tipo de DTE | Docs | Monto | «Crédito fiscal» | Proveedores |
|---|---|---|---|---|
| **03 · CCF** | **400** | $50,925.97 | **$5,825.31** | 55 |
| 05 · Nota de crédito | 128 | $23,738.72 | $2,720.23 | 21 |
| 01 · Factura consumidor | 15 | $8,143.90 | $211.55 | 8 |
| 06 · Nota de débito | 4 | $639.80 | $73.56 | 4 |
| 09 · Doc. contable de liquidación | 177 | — | 0 | 2 |
| 07 · Comprobante de retención | 1 | — | — | 1 |

**Las tres correcciones que salen de la tabla:**

1. **Sólo la fila 03 es crédito fiscal reclamable.** Son **$5,825.31**, no
   $8,184 ni $8,532.
2. **Las notas de crédito (05) van al revés.** $2,720.23 en 128 documentos que
   *reducen* el crédito, no que lo aumentan. Sumarlas al mismo total es contarlas
   con el signo cambiado — y es exactamente el mismo hallazgo que la pregunta A1
   al contador (el libro de compras no resta las notas de crédito, Art. 62).
3. **La factura de consumidor (01) no genera crédito fiscal.** Esos $211.55 no
   son reclamables por definición, estén donde estén.

**Quiénes son los 400 CCF.** El nombre del pendiente —«DTE de *gastos*»— también
engaña: los primeros de la lista son distribuidores de mercadería, no gastos
operativos.

| Emisor | Docs | Monto | Crédito |
|---|---|---|---|
| MONTREAL, S.A. DE C.V. | 47 | $19,177.23 | $2,187.30 |
| STEINER, S.A. DE C.V. | 4 | $7,199.92 | $828.30 |
| RONASA S.A. DE C.V. | 9 | $5,046.91 | $580.62 |
| OMAR ARNULFO SERRANO CRESPIN | 2 | $2,938.00 | $338.00 |
| COFARSAL | 8 | $2,902.36 | $331.09 |
| LABORATORIOS VIJOSA | 2 | $2,764.80 | $315.28 |
| Corporación CEFA | 7 | $2,204.25 | $251.37 |
| CAESS (alumbrado eléctrico) | 3 | $785.97 | $90.46 |

MONTREAL solo es el **38%** del crédito de la lista. Con VIJOSA, CEFA, RONASA,
COFARSAL y REDIFAR adentro, la mayor parte de esto **no son gastos que nunca se
registran: son compras de mercadería que no llegaron al sistema de origen** —la
clase que la Parte 7 llamaba «la compra FALTA de verdad»—. CAESS sí es un gasto
operativo puro.

**Lo que sigue sin decidirse** (y no lo decide el código): el Art. 65-A pide que
el gasto sea indispensable para el giro, así que **$5,825.31 es el techo, no lo
confirmado**. Y la cautela de la Parte 7 sigue en pie: «no encontré una compra
con ese monto» no es «no existe». Antes de reclamar nada, los 47 de MONTREAL se
revisan documento por documento — son un solo proveedor y el 38% del total, así
que es una tarde de trabajo, no un proyecto.
