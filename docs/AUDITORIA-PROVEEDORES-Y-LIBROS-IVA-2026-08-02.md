# Auditoría — Maestro de Proveedores y Libros de IVA

Fecha: 2026-08-02 · Alcance: los 7 RPC de libros, `LibrosIvaView`, `librosIva.js`,
`proveedores.js`, `ProveedoresView`, `FormProveedorDetail`, `sync-erp-purchases`,
`sync-dte-sales`, `upsert_proveedor_from_dte`, los dos cuadres diarios, y el
esquema/RLS de `purchase_receipts`, `proveedores_maestro`, `suppliers`,
`sales_invoices`, `purchase_dte_documents`.

**Qué se verificó y qué no.** Todo lo de acá se midió contra la base de
producción. **No se descargó ningún CSV del ERP en esta pasada**: la afirmación
"coincide con el origen" sigue apoyada en la verificación del 2026-08-02
(`LIBROS-IVA-FORMATO-Y-HALLAZGOS-2026-08-01.md` §6), no en esta auditoría. Lo que
sí se hizo acá es mirar el otro lado: si el dato que el portal guarda **puede**
ser fiel, y qué lo rompe.

---

## Resumen

Lo que está bien es la mitad que suele estar mal: los gates de permiso, el
aislamiento por sucursal en los RPC de lectura, la aritmética de los libros y los
avisos de la vista. El advisor de seguridad sigue en **0 ERRORES**.

Los hallazgos se concentran en el **dato base de compras** y en un **agujero
estructural del join** que hoy no está disparado pero que nadie impide.

| # | Hallazgo | Gravedad |
|---|---|---|
| A1 | Un `supplier_id` repetido duplica filas del libro de compras | **Crítico** |
| A2 | `documento_numero` truncado a 20 caracteres en 87-90% del libro | **Crítico** |
| A3 | 22 ventas con `recibido_mh = 'undefined'` fuera del libro | Alto |
| A4 | `docs_count` del maestro inflado ~2× | Medio |
| A5 | El cuadre de ventas solo mira en una dirección | Medio |
| A6 | La precisión se pierde en `subtotal`, no en `percepcion_iva` | Medio |
| A7 | `get_notas_credito_compras` sin scope de sucursal | Bajo |
| A8 | `get_libro_sujeto_excluido` sin GRANT — se rompe si se recuelga | Bajo |
| A9 | Dos ramas del RLS de compras/ventas sin scope de sucursal | Bajo |

---

## A1 — Un `supplier_id` repetido duplica filas del libro de compras

**CRÍTICO. No está disparado hoy, y nada impide dispararlo.**

`get_libro_compras`, `get_libro_percepcion` y `get_libro_retencion` hacen los tres:

```sql
LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
```

`proveedores_maestro.supplier_id` tiene un índice **no único**
(`idx_proveedores_maestro_supplier`) y ninguna restricción. O sea que el join no
está garantizado 1:1 — es 1:N. Dos fichas apuntando al mismo proveedor del ERP
**multiplican cada compra de ese proveedor**.

Medido simulando el join con una ficha clonada sobre junio 2026, sin escribir
nada:

| | Filas | Total |
|---|---|---|
| Hoy | 389 | $203,947.07 |
| Con **una** ficha duplicada | **503** | **$295,805.25** |

Son **+114 filas y +$91,858 de crédito fiscal fantasma**, sin error, sin
advertencia y sin que ningún aviso de la vista lo note: `comprasSinSincronizar` y
`comprasSinNrc` cuentan faltantes, no sobrantes. El libro cuadraría consigo mismo
— el mismo modo de fallo del §7 del documento de hallazgos, pero al revés.

**Cómo se llega ahí.** Dos caminos, los dos abiertos:

1. **Desde la UI.** `FormProveedorDetail.jsx:142` llama `setProveedorSupplier`, y
   el RPC (`set_proveedor_supplier`) valida el permiso y nada más: no chequea que
   ese `supplier_id` ya esté tomado. Son dos clics.
2. **Desde el sync.** `upsert_proveedor_from_dte` resuelve el proveedor del ERP
   por NRC normalizado:

   ```sql
   SELECT id INTO v_supplier_id FROM public.suppliers
     WHERE regexp_replace(nrc,'[^0-9]','','g') = regexp_replace(v_nrc,'[^0-9]','','g')
     LIMIT 1;
   ```

   `LIMIT 1` **sin `ORDER BY`** — resultado no determinista si hay dos. Y si dos
   NIT distintos comparten NRC, las dos fichas se llevan el mismo `supplier_id`.
   Es exactamente el caso "dos AGUA FRIA que son contribuyentes distintos" ya
   anotado en memoria.

**Estado hoy:** 0 `supplier_id` duplicados, 0 NIT duplicados, 0 NRC compartidos.
Está limpio por suerte, no por construcción.

**Arreglo:** índice único parcial sobre `supplier_id WHERE supplier_id IS NOT
NULL`. Una línea, y convierte un libro silenciosamente inflado en un error de
escritura en el momento en que alguien se equivoca.

---

## A2 — `documento_numero` truncado a 20 caracteres

**CRÍTICO. Está disparado ahora, en los dos meses cerrados.**

La columna que identifica cada documento de compra ante Hacienda está cortada.
Ningún valor guardado en `purchase_receipts.documento_numero` pasa de **20
caracteres** — 1,212 filas están exactamente en 20 y 73 en 19; no hay ninguna
arriba. Eso es un techo, no una casualidad.

Cruzado contra el DTE real que llegó por correo (`purchase_dte_documents`):

| Portal (20) | El documento de verdad (31/36) |
|---|---|
| `2ACF88E7-2990-49D2-B` | cód. gen. `2ACF88E7-2990-49D2-B84D-3A048EEC4F0D` |
| `DTE-03-M001P001-0000` | nº control `DTE-03-M001P001-000000000010685` |
| `03-M001P001-00000000` | nº control `DTE-03-M001P001-000000000011313` |
| `4999COBE-B307-4596-8` | cód. gen. `4999C**0**BE-B307-4596-8FBB-C30477845DFD` |

Tres cosas salen de esa tabla:

1. **Está truncado**, y ni siquiera de un campo consistente: unas filas son el
   código de generación cortado y otras el número de control cortado. Alguien lo
   escribe a mano en el ERP y el campo tiene tope 20.
2. **Tiene erratas de tipeo.** La cuarta fila trae letra `O` donde el DTE tiene
   cero `0`.
3. **El dato bueno existe.** `purchase_dte_documents` guarda el número de control
   y el código de generación completos de los DTE que llegan por correo, y el
   cruce ya está construido (86.7% de cobertura hoy).

**Alcance:** 339 de 389 filas de junio (87%) y 422 de 467 de julio (90%) están en
el tope de 20.

Lo que hace grave esto es que **ningún aviso lo ve**: `comprasSinSincronizar`
chequea `documento_numero == null`, y un valor truncado no es null — parece un
número de documento válido. Un libro que no puede identificar sus documentos pasa
por completo.

**Qué no sé:** si el CSV del ERP también lo emite truncado. Si lo emite igual, el
portal replica fielmente un archivo que ya viene mal, y el arreglo es del lado del
ERP más completar desde `purchase_dte_documents`. Es la primera cosa que hay que
mirar y se mira bajando un CSV.

---

## A3 — 22 ventas con `recibido_mh = 'undefined'` fuera del libro

`sync-dte-sales` ya tiene el guard correcto (`selloValido`, líneas 68-80 y 198), y
está bien escrito: atrapa la **cadena** `"undefined"`, que es truthy y por eso el
`??` no la agarraba.

Lo que nunca se hizo es **limpiar las filas que entraron antes del guard**. Siguen
ahí: 22 documentos COF FINALIZADA con `recibido_mh = 'undefined'`, entre
2025-05-16 y 2026-05-29, $250.60.

Como los tres libros de ventas filtran por `length(recibido_mh) = 40`, esos 22
documentos **no salen en ningún libro de consumidor** de meses ya declarados. Se
concentran en pocos días (2026-05-07: 13 documentos entre dos sucursales;
2026-05-29: 4; 2026-05-26: 3).

El guard impide que crezca; no repara lo que hay. Un `sync-dte-sales` acotado a
esos días diría si el sello existe del lado del ERP —y entonces se recupera— o si
esos documentos nunca llegaron a Hacienda, que también es una respuesta y hay que
saberla antes de cerrar el año.

(Los 63 documentos sin sello del 2026-08-01 son normales: es el día vivo, el sello
todavía no llegó.)

---

## A4 — `docs_count` del maestro está inflado ~2×

`upsert_proveedor_from_dte` hace `docs_count = p.docs_count + 1` incondicional. No
es idempotente: cada vez que un documento se vuelve a procesar, vuelve a contar.

| Proveedor | `docs_count` | Documentos reales |
|---|---|---|
| COFARSAL | 460 | 230 |
| MONTREAL | 228 | 114 |
| DROGUERÍA AMERICANA | 117 | 57 |
| BANCO PROMERICA | 160 | 93 |

No toca ningún libro —es un campo del módulo de Proveedores— pero es el número que
se mira para decidir si un proveedor es importante, y hoy miente por el doble.

Se arregla derivándolo (`count(*)` sobre `purchase_dte_documents`) en vez de
acumulándolo. Mientras siga siendo un contador incremental, cualquier re-proceso
lo vuelve a romper.

---

## A5 — El cuadre de ventas solo mira en una dirección

`check-sales-reconciliation` está bien construido y usa **exactamente el mismo
filtro** que el libro (`resumen_ventas_diario` y `get_libro_ventas_consumidor`
coinciden en `tipo_documento='COF' AND estado='FINALIZADA' AND
length(recibido_mh)=40`). Eso es lo correcto y no es obvio: si el cuadre midiera
con otro criterio, avisaría de diferencias falsas todos los días.

El hueco está en el recorrido (`index.ts:108`):

```ts
for (const [dia, totalErp] of porDiaErp) { … }
```

Itera **los días del ERP**. Detecta lo que motivó su creación —al portal le falta
una venta— pero no ve el caso inverso: un día que existe en el portal y no en el
ERP, o un documento de más. Un duplicado en `sales_invoices` sería invisible para
este cuadre.

Recorrer la unión de las dos claves en vez de solo una cierra el otro lado.

---

## A6 — La precisión se pierde en `subtotal`, no en `percepcion_iva`

Corrección al §8 del documento de hallazgos, que propone "cambiar la precisión con
la que el sync guarda `subtotal` **y** `percepcion_iva`".

Los tipos reales de `purchase_receipts`:

- `subtotal numeric(12,2)` → **redondea en el INSERT**, lo mande el sync como lo
  mande. Acá está la pérdida.
- `percepcion_iva numeric` **sin precisión** → puede guardar 4 decimales hoy
  mismo. No hace falta tocarla.

Verificado sobre los datos: ninguna fila de percepción tiene escala mayor a 2
(636 con 2, 68 con 1, 1 con 0). O sea que el ERP manda dos decimales en ese campo,
y los cuatro del anexo salen de `sumas_gravadas − percepción`, donde el que trae
los cuatro es `sumas_gravadas`.

**Consecuencia práctica:** si el contador responde "el anexo va con 4 decimales",
el cambio es **una sola columna** (`ALTER TABLE purchase_receipts ALTER COLUMN
subtotal TYPE numeric`) más el re-sync del histórico. Es bastante menos trabajo
del que el documento estima. La pregunta al contador sigue siendo la misma y
sigue siendo lo primero.

Los totales de junio quedan verificados: 226 filas de anexo, monto sujeto
$153,148.40, percepción $1,531.44 — los tres idénticos a lo documentado.

---

## A7, A8, A9 — Menores

**A7 · `get_notas_credito_compras` no aplica scope de sucursal.** Tiene el gate de
`libros_iva.can_view` pero, a diferencia de los otros seis, no chequea
`auth_module_scope`. Un usuario con acceso a una sola sucursal ve todas las notas.
Hay una razón real —estos documentos llegan por correo y no traen sucursal, y la
vista lo dice— pero conviene que sea una decisión escrita en la función y no una
línea que falta.

**A8 · `get_libro_sujeto_excluido` no tiene GRANT a `authenticated`.** La pestaña
se retiró el 2026-08-02 y `fetchLibroSujetoExcluido` (`librosIva.js:61`) y
`COLS_EXCLUIDO` (`LibrosIvaView.jsx:299`) quedaron como código muerto. El comentario
dice "se conserva para volver a colgarlo": si se recuelga, falla con permission
denied, porque el GRANT no está. Trampa de bajo costo — o se agrega el GRANT, o el
comentario dice que también hay que agregarlo.

**A9 · Dos ramas del RLS sin scope de sucursal.** En `purchase_receipts_select` y
`sales_invoices_select`, las ramas `OR auth_has_module_permission('minmax_ver_costos',…)`
y `OR …('productos_tab_catalogo_costos',…)` no llevan la condición de `branch_id`
que sí llevan las ramas de `compras`/`ventas`. Quien tenga esos permisos lee las 7
sucursales. No afecta a los libros —sus RPC son DEFINER y aplican el scope ellos
mismos— pero es una vía lateral a los mismos datos.

---

## Lo que se revisó y está bien

Vale escribirlo, porque es donde suelen estar los problemas y acá no están.

- **Permisos de escritura.** Los seis RPC de escritura del maestro
  (`set_proveedor_categoria`, `set_proveedor_supplier`, `update_proveedor_manual`,
  `set_proveedores_categoria_bulk`, `apply_proveedores_categoria_sugerida`,
  `set_purchase_dte_proveedor`) validan **todos** con `auth_can_edit_any` y
  levantan `FORBIDDEN`. Ninguno con `USING (true)`.
- **Los 7 RPC de lectura** llevan el gate envuelto en `(SELECT …)` — el initplan
  del incidente 2026-07-08 — y aplican `auth_module_scope` (salvo A7).
- **Advisor de seguridad: 0 ERRORES.** 95 WARN, todos de categorías conocidas y
  aceptadas.
- **Aritmética de ventas:** en junio-julio, `subtotal + iva = total` en el 100% de
  las filas; 0 documentos con IVA nulo; ninguna venta se clasifica como exenta por
  error (la única con `iva=0` tiene también total 0).
- **Número de control:** completo en los 366 extremos de día de junio-julio. 0
  faltantes en el "del" y 0 en el "al".
- **NIT de proveedores:** el §6 del documento anterior dice "15 de 67 proveedores".
  **Ya no**: en junio-julio quedan 3 filas sin NIT, de 1 solo proveedor (PEPSI,
  $103.12). Ese dato está desactualizado a favor del portal.
- **Sin duplicados** de `erp_purchase_id`+sucursal en compras. Los 10 grupos que
  parecían duplicados son consecuencia de A2: números distintos que colisionan al
  cortarlos en 20.
- **Los avisos de la vista** (`LibrosIvaView.jsx:1021-1091`) son correctos y
  específicos: NRC faltante, documentos sin sincronizar, número de control
  faltante, notas de crédito fuera del libro. Cubren todo lo que puede faltar.
  No cubren lo que puede **sobrar** (A1) ni lo que puede estar **cortado** (A2).
- **Los tres crons** están activos: `sync-numero-control-daily` (07:00),
  `check-purchases-reconciliation-daily` (07:20),
  `check-sales-reconciliation-daily` (07:30).
- **Notas de crédito de julio:** $1,745.73 de IVA en NC menos $68.12 en ND =
  **$1,677.61** neto. Confirma el número que hay que declarar.

---

## Orden sugerido

1. **A1** — el índice único. Es una línea y cierra un agujero de $91,858 en un
   mes cualquiera. Primero porque es barato y porque hoy la base está limpia:
   aplicarlo ahora no requiere reparar nada.
2. **A2** — bajar un CSV de compras del ERP y ver si el número viene truncado del
   origen. De esa respuesta depende si el arreglo es del ERP, del portal, o
   completar desde `purchase_dte_documents`. Es el hallazgo que más pesa sobre la
   fidelidad del libro.
3. **A3** — re-sincronizar los 6 días con `'undefined'` y saber si esos 22
   documentos tienen sello.
4. **A6** — preguntarle al contador por los decimales, ya sabiendo que el cambio
   es una sola columna.
5. **A4, A5, A7, A8, A9** — cuando toque el módulo.
