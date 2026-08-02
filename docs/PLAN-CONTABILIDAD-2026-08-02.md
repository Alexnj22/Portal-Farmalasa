# Proveedores y Libros de IVA — auditoría completa y plan

Fecha: 2026-08-02 · Sucede a `AUDITORIA-PROVEEDORES-Y-LIBROS-IVA-2026-08-02.md`,
que quedó **incompleta y con dos conclusiones equivocadas**. Este documento es el
que manda.

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

# Parte 2 — Plan de corrección

## Fase 1 — Los candados (1 día, sin riesgo)

Todo esto es defensivo: hoy la base está limpia, así que entra sin reparar nada.

1. **Índice único** `proveedores_maestro(supplier_id) WHERE supplier_id IS NOT NULL`.
   Cierra H1 de raíz. Mensaje de error propio en `set_proveedor_supplier` para que
   la UI diga "ese proveedor ya está vinculado a X" y no un `23505` crudo.
2. **`ORDER BY id`** en el lookup por NRC de `upsert_proveedor_from_dte`. Un
   `LIMIT 1` sin orden en un camino fiscal no es aceptable.
3. **Alinear `_docs_sin_numero_control`** con el filtro del libro (H12).
4. **Unificar el orden** de `generar_csv_libro` con el de los RPC (H16), y correr
   la verificación de nuevo. Los porcentajes van a moverse — ese es el punto.
5. **`fetchAllRows`** en `check-purchases-reconciliation` (H14).
6. **GRANT** a `get_libro_sujeto_excluido` (H8) y scope explícito comentado en
   `get_notas_credito_compras` (H7).

## Fase 2 — Que el verificador pueda fallar (2 días)

7. **`porConjunto` bidireccional** (H10): el veredicto exige que la bolsa quede
   **vacía** al terminar. Hoy sobrar es gratis.
8. **Cuadre de ventas bidireccional** (H5): recorrer la unión de los días.
9. **Comparar el archivo de verdad** (H15): un modo que devuelva los bytes del CSV
   del portal —BOM, CRLF, comillas— y los compare con los del ERP. Es la única
   verificación que hoy no existe en ninguna forma.
10. **Cuadre por documento y no por total** en compras: el sello (H13) es único
    por DTE, así que comparar el *conjunto de sellos* detecta un intercambio que
    el total esconde.

## Fase 3 — Capturar lo que ya está ahí (3 días)

11. **`purchase_receipts.sello_recibido`** (H13). Un índice de array en
    `fastBackfill`. Desbloquea todo lo de la Parte 3.
12. **`subtotal` a `numeric(14,4)`** (H6) — después de la respuesta del contador,
    y solo si dice "4 decimales".
13. **`docs_count` derivado** (H4), no acumulado.
14. **Aviso de "ventas sin DTE sellado"** (H3) en el libro de consumidor: *"N
    ventas del período, $X, no tienen DTE sellado y no entran al libro"*. Que deje
    de ser invisible.

## Fase 4 — Limpieza (1 día)

15. Ramas de RLS sin scope (H9); `fetchLibroSujetoExcluido`/`COLS_EXCLUIDO`
    muertos; y **corregir los tres documentos** que hoy afirman cosas falsas: el
    sello de compras "no viene en la fuente", el NRC de CCF "todavía no se
    captura", "15 de 67 proveedores sin NIT".

---

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
