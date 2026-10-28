# La retención de IVA en los libros — hallazgo y decisión, 2026-08-12

**Disparador:** la contadora llamó porque el total de contribuyentes de Salud 3
no le cuadraba contra el Corte Z. Tirando de ese hilo aparecieron **dos defectos
distintos**: uno del documento que emite la sucursal y otro nuestro, en lo que se
declara.

Todos los montos de este documento se pueden reproducir con las consultas del
final.

---

## 1. Los tres números de julio, y de dónde sale cada uno

| Número | Qué es | Quién lo tenía |
|---|---|---|
| $241,836.14 | Lo **cobrado** (todo neto de retención) | El portal, antes |
| $241,839.73 | Mezcla: contribuyentes al valor, consumidores a lo cobrado | La contadora |
| **$241,879.06** | El **valor de las ventas** en los dos libros | Lo correcto |

La diferencia entre el primero y el tercero son los **$42.92** de retención del
período. La de la contadora estaba en el medio porque **ella ya aplicaba el
criterio correcto en contribuyentes** y usó, para consumidores, el número que le
dábamos nosotros.

---

## 2. Lo que dicen los artículos (textual)

### Art. 162 CT — crea la retención

> «…DEBERÁN RETENER **EN CONCEPTO DE ANTICIPO** DEL IMPUESTO… EL UNO POR CIENTO
> **SOBRE EL PRECIO DE VENTA** DE LOS BIENES TRANSFERIDOS…»
>
> «…LOS CONTRIBUYENTES QUE SEAN SUJETOS DE LA RETENCIÓN DEBERÁN **CONSIGNAR EN
> LOS DOCUMENTOS LEGALES QUE EMITAN EL VALOR DEL IMPUESTO RETENIDO**.»

Dos consecuencias:

1. Es un **anticipo del impuesto**, no una venta menor.
2. Se calcula **sobre el precio de venta**, o sea que el precio de venta existe
   con independencia de ella y no se reduce.

Por eso el DTE lleva `ivaRete1` en un campo **separado** de `totalGravada`: la
ley obliga a consignarla aparte, no a descontarla.

El **inciso 3** es el que explica el caso del ISSS: órganos del Estado,
municipalidades e **instituciones oficiales autónomas** retienen «AUNQUE NO SEAN
CONTRIBUYENTES DE DICHO IMPUESTO» — por eso hay retención sobre facturas de
consumidor final, que parecía una anomalía y no lo es.

Otras dos reglas del mismo artículo, verificadas en los documentos reales: la
base va **sin IVA** y sólo aplica desde **$100**.

### Art. 83 RCT — columnas del libro de consumidor

> d) **Valor de ventas exentas**
> e) **Valor de ventas gravadas por operaciones locales**
> f) Valor de exportaciones
> g) **Total de ventas diarias**
> h) …por cuenta de terceros

Dice «**valor de ventas**», no «lo cobrado». Y **no hay columna de retención**.

### Art. 85 RCT — columnas del libro de contribuyentes

> f) exentas · g) **gravadas** · h) **débito fiscal** · i) terceros · j) su
> débito · k) **Impuesto percibido** · l) **Total de ventas por documento**

La única columna de impuesto es «**percibido**», que es la operación contraria
(cuando nosotros percibimos de un comprador). **Retenido no aparece.**

---

## 3. El defecto nuestro: el libro de consumidor restaba la retención

`sales_invoices.total` es lo **cobrado** (`totalPagar` del DTE), ya neto de
retención. El libro de contribuyentes usa `subtotal` e `iva`, que la retención no
toca, así que salió bien. El de consumidor usaba `total` en sus tres columnas de
dinero y arrastraba la resta.

**El caso que lo prueba** — factura al ISSS, Salud 3, 06/07/2026
(`a84578c9-d502-43e6-a1a3-f90a20e17e60`). El DTE sellado dice:

| Campo del DTE | Valor |
|---|---|
| `totalGravada` | **$120.00** |
| `montoTotalOperacion` | $120.00 |
| `totalIva` | $13.81 |
| `ivaRete1` | $1.06 |
| `totalPagar` | $118.94 |

La columna del libro se llama «ventas gravadas» y el campo del documento se llama
`totalGravada`. El CSV escribía **$118.94**; ahora escribe **$120.00**.

### Alcance: $41.53 declarados de menos

Sólo Salud 3, que es la única con clientes que retienen sobre factura.

| Período | Declaraba | Se vendió | Falta |
|---|---|---|---|
| Junio 2026 | $247.79 | $250.00 | $2.21 |
| Julio 2026 | $4,404.73 | $4,444.05 | $39.32 |

Verificado sucursal por sucursal antes y después: **las otras cinco no se
movieron ni un centavo.**

---

## 4. El defecto del Corte Z: resta la retención dos veces

Es del documento que emite la sucursal, no de nuestra lectura del mismo. Se
confirmó que el Corte Z se trae del sistema donde se emite (`POST reportez.php`
con `process=imprimir_gz`) y que el ticket se guarda **crudo**; la resta está
impresa en el original, que se puede abrir desde «Ver el original».

Su línea **VENTAS GRAVADAS ya viene neta** de retención —es la suma de lo
cobrado, con IVA— y su línea **TOTAL se la vuelve a restar**:

```
VENTAS CON CREDITO FISCAL
VENTAS GRAVADAS:      $ 980.33      ← ya neto: coincide con el portal
RETENCION:            $   3.60
TOTAL:                $ 976.73      ← resta otra vez; no es ninguna cantidad real
```

Medido: **GRAVADAS = `sum(sales_invoices.total)` con diferencia 0.00 en los 12
meses-sucursal cargados**, en las dos secciones. Por eso el cotejo se ancló en
GRAVADAS (v2.571.7).

**No se puede corregir desde el portal** — hay que reportarlo al proveedor del
sistema. La evidencia está armada: el ticket original, el DTE sellado y las once
columnas cuadrando.

---

## 5. Qué se cambió y qué NO

| | Estado |
|---|---|
| Libro de consumidor (vista y CSV) | **Corregido** → `subtotal + iva` |
| Bloque «Para la declaración» del Corte Z | **Corregido** → mismo criterio |
| Libro de contribuyentes | **No se toca** — ya era correcto |
| Cotejo del Corte Z | **No se toca** — sigue en lo cobrado |

**Por qué el cotejo sigue en lo cobrado:** su trabajo es cuadrar contra el Corte
Z, que reporta caja. Son dos preguntas distintas —«¿coincide con el documento de
la sucursal?» y «¿qué se declara?»— y la retención es exactamente la distancia
entre las dos. La tarjeta muestra las tres cosas.

**Por qué el libro de contribuyentes no se toca:** verificado columna por columna
contra el DTE sellado de BANCO PROMERICA (CCF 0000000220, 06/07,
`5978aa98-11f2-4447-ae89-f4b2363c499b`): número de control, código de generación,
fecha, receptor, NRC, NIT, `totalGravada` 359.79, tributo 46.77,
`montoTotalOperacion` 406.56, `ivaRete1` 3.60 y `totalPagar` 402.96 — **las once
coinciden** con el libro del portal.

Migraciones: `20260812172655_libro_consumidor_no_resta_la_retencion` y
`20260812172845_corte_z_declaracion_al_valor_de_la_operacion`.

---

## 6. Las guardas que quedaron

`get_cortes_z` devuelve seis comprobaciones que se muestran en la tarjeta y en el
PDF **pasen o no** — una comprobación que sólo aparece cuando falla no deja
constancia de que se hizo:

| Comprobación | Qué verifica |
|---|---|
| Cotejo | El libro coincide con el Corte Z, anclado en ventas gravadas |
| Retención | La del Corte Z es la que el libro suma documento por documento |
| Coherencia | exentas + gravadas + débito = total, en las dos secciones |
| IVA | El débito es el 13% de la base, **documento por documento** |
| Sello | Ninguna venta quedó fuera del libro sin querer |
| Ticket | El total del Corte Z se explica **exactamente** por su retención |

La del **ticket** es la que habría atrapado el defecto: no alerta por el desfase
conocido, exige que sea *exactamente* la retención que el propio ticket declara.

La del **sello** nace de un bug real —182 facturas de la historia figuran
vendidas con `recibido_mh` inválido y el libro no las lleva, en silencio—. En
junio y julio 2026 son cero: los 155 documentos excluidos del período son
anulaciones legítimas, y ahora se informan con su monto.

La del **IVA** se mide por documento y no sobre el total: el precio al consumidor
lleva el IVA adentro y se redondea, así que el agregado deriva por acumulación de
centavos ($1.05 sobre 3,878 documentos en julio de Salud 3) y un umbral sobre la
suma daría falsos positivos.

---

## 7. Lo que queda abierto

1. **Confirmación de la contadora.** El texto para consultarle está al final. Si
   sostiene que el libro debe registrar lo cobrado, revertir es una línea.
2. **¿Junio y julio ya se declararon con las cifras viejas?** Si es así, son
   $41.53 de ventas a corregir en Salud 3.
3. **Reportar el defecto del Corte Z** al proveedor del sistema.
4. La sección B de `PREGUNTAS-CONTADOR-2026-08-03.md` quedó **desactualizada**:
   la columna de retención ya existe (`sales_invoices.retencion`, v2.355.0), se
   sabe quiénes retienen (BANCO PROMERICA por CCF, ISSS por factura) y el anexo
   vacío ya se explicó — lista lo que la empresa practica **como agente**, no lo
   que le retienen a ella.

---

## 8. Cómo reproducir las cifras

```sql
-- Los tres totales de julio
select
  round(sum(total),2)                                            as cobrado,
  round(sum(subtotal+iva),2)                                     as valor_ventas,
  round(sum(retencion),2)                                        as retencion
from public.sales_invoices
where fecha between '2026-07-01' and '2026-07-31'
  and estado='FINALIZADA' and length(recibido_mh)=40;

-- Lo que el CSV declara, por sucursal-mes (columna T del archivo)
select b.name, m.periodo,
       round(sum(split_part(l,';',20)::numeric),2) as total_csv
from public.branches b
cross join (values ('2026-06-01'::date),('2026-07-01'::date)) m(periodo)
cross join lateral generar_csv_libro('consumidor', m.periodo,
             (m.periodo + interval '1 month - 1 day')::date, b.id) l
where b.id in (2,4,25,27,28,29)
group by b.name, m.periodo order by m.periodo, b.name;

-- Los documentos con retención del período
select tipo_documento, correlativo, fecha, cliente,
       subtotal as gravada, iva as debito, (subtotal+iva) as valor_venta,
       retencion, total as nos_pagaron
from public.sales_invoices
where retencion > 0 and fecha >= '2026-06-01' and fecha < '2026-08-01'
  and estado='FINALIZADA' and length(recibido_mh)=40
order by fecha;
```

El DTE de cualquier documento se abre por su código de generación, sin login:

```
https://clientesdte3.oss.com.sv/farma_salud/downloads/dteqr_json.php?codigoGeneracion=<UUID>
```

**Trampa:** con un código que no es nuestro contesta HTTP 200 con body vacío. Hay
que validar el contenido, no el status.

---

## 9. Texto para consultarle a la contadora

```
Buenos días. Le consulto sobre un criterio del libro de ventas, a raíz de
la diferencia que encontró en Salud 3.

Revisando, encontramos que el libro de consumidor final venía restando la
retención de IVA del Art. 162 del valor de la venta, mientras que el de
contribuyentes no la restaba.

El caso concreto es una factura al ISSS (Fondo Circulante UM Chalatenango)
del 6 de julio. El DTE sellado por Hacienda dice:

  Venta gravada .................. $120.00
  IVA ............................  $13.81
  IVA retenido (Art. 162) ........   $1.06
  Total pagado ................... $118.94

El libro venía registrando $118.94. Lo cambiamos a $120.00, por dos
razones:

1. El Art. 162 CT define la retención como anticipo del impuesto,
   calculado "sobre el precio de venta", y obliga a consignarla por
   separado en el documento legal. No la descuenta de la venta.

2. El Art. 83 del Reglamento pide "valor de ventas gravadas por
   operaciones locales" y no contempla columna de impuesto retenido —
   igual que el Art. 85 para contribuyentes, que sólo tiene "impuesto
   percibido".

Notamos además que en el libro de contribuyentes usted ya venía aplicando
ese criterio: para julio tomó $2,258.32, que es gravadas más débito fiscal
sin restar los $3.60 que retuvo Banco Promerica.

Aplicando el mismo criterio en los dos libros, el total de julio de las 6
salas queda en $241,879.06.

¿Nos confirma que ese es el criterio correcto? Si usted prefiere que el
libro registre lo efectivamente cobrado, lo revertimos sin problema.

Los montos afectados son sólo de Salud 3: $2.21 en junio y $39.32 en julio.
Quedo atento.
```
