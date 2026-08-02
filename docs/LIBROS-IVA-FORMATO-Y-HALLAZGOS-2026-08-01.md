# Libros de IVA — formato de los archivos y hallazgos

Fecha: 2026-08-01 · Versiones v2.333.0 → v2.335.1

Este documento fija **el formato exacto de los archivos que el portal replica** y
deja anotados los **errores encontrados en el origen**, para no volver a
deducirlos. Todo lo de acá se verificó contra los archivos reales de junio 2026,
descargados por sucursal (`erpId` explícito), no por muestreo ni de memoria.

---

## 1. Reglas de formato comunes

| Regla | Valor |
|---|---|
| Separador | `;` |
| Encabezado | **ninguno** — los archivos arrancan directo en datos |
| Fecha | `DD/MM/YYYY` |
| Decimales | `.` (punto), 2 posiciones… salvo la percepción de compras, que va con **4** |
| Número de control | **sin guiones**: `DTE01S001P005000000000019619` |
| Código de generación | consumidor: guiones → **espacios**. Contribuyentes y anulados: **pelado** (32 caracteres) |
| NRC / NIT | **sin guiones**: `250887-5` → `2508875` |

La puntuación del código de generación **cambia entre reportes sin ninguna
lógica detrás**. Hay que copiar cada una como es.

## 2. Endpoints

| Reporte | Archivo | Estado |
|---|---|---|
| Ventas a consumidor | `libro_ventas_consumidor_csv.php` | ✅ |
| Ventas a contribuyentes | `libro_ventas_contribuyente_csv.php` | ✅ |
| Documentos anulados | `documentos_anulados_csv.php` | ✅ |
| Libro de compras | `libro_compras_iva_csv.php` | ✅ |
| Anexo de retención | `libro_retencion_iva_csv.php` | ✅ (vacío en toda la historia) |
| Anexo de percepción | `libro_percepcion_iva_csv.php` | ✅ **con datos** — pide las credenciales de COMPRAS, no las de ventas |
| Sujeto excluido | — | ❌ **no se encontró** (9 nombres probados) |

Parámetros: `?fechaInicio=YYYY-MM-DD&fechaFin=YYYY-MM-DD`. **La sucursal es
estado de sesión**, no un parámetro: hay que hacer `POST cambio_sesion.php` con
`process=set_sucursal` antes de pedir el archivo.

Herramienta para volver a mirarlos: Edge Function `erp-csv-probe`.

## 3. Mapa de columnas

### Consumidor final — 22 columnas
```
0  fecha            8  cód. generación "al"    16 0.00
1  4 (clase)        9  (vacío)                 17 0.00
2  01 (tipo)        10 ventas exentas          18 0.00
3  nº control 1º    11 0.00                    19 0.00
4  sello del 1º     12 0.00                    20 total del día
5  id interno 1º    13 0.0000                  21 2 (constante)
6  id interno últ.  14 ventas gravadas
7  cód. gen. "del"  15 0.00
```

### Contribuyentes — 19 columnas
```
0 fecha        5 cód. generación   10 0.00           15 0.00
1 4            6 id interno        11 0             16 total
2 03           7 NRC               12 gravadas      17 NIT
3 nº control   8 cliente           13 débito fiscal 18 1
4 sello        9 exentas           14 0.00
```

### Anulados — 10 columnas
```
0 nº control   3 0    6 sello
1 4            4 tipo (01/03)   7 0
2 0            5 D    8 0     9 código de generación
```
Las seis constantes se verificaron iguales en las 80 filas de junio. El anexo
**no lleva** fecha, cliente ni total.

### Percepción — 9 columnas
```
0 correlativo   3 NIT            6 sello (40)
1 fecha         4 tipo doc (03)  7 monto sujeto (4 decimales)
2 proveedor     5 nº documento   8 percepción (4 decimales)
```
**Pide las credenciales de COMPRAS.** Con las de ventas devuelve vacío, que es
indistinguible de "no hay percepción" — así se dio por vacío en la primera
pasada. El sello sale vacío del lado del portal: el anexo del ERP lo trae, pero
no viene en la fuente que alimenta Compras.

### Compras — 23 columnas
```
0 fecha       6 exentas    12 0.00         18 2
1 4           7 0.00       13 crédito      19 5
2 (vacío)     8 0.00       14 total        20 3
3 nº doc      9 gravadas   15 (vacío)      21 percepción (4 dec.)
4 NIT         10 0.00      16 1            22 sello
5 proveedor   11 0.00      17 1
```
**Gravadas = `subtotal − percepción`** (LETERAGO: 577.71 − 5.72 = 571.99, exacto).

### Columnas que quedaron sin identificar

Varias van en cero en **toda** la muestra disponible, así que no se pudo saber
cuál es cuál: consumidor 11-13 y 15-19, contribuyentes 10-11, compras 7-8 y
10-12. Haría falta un período con ventas exentas, exportaciones o importaciones,
y **no existe uno en el histórico**. Se escriben como constantes en cero, igual
que el origen. Las de compras 17-21 (`1;1;2;5;3`) se copian tal cual.

Esto queda dicho y no adivinado: es la contracara de la regla de verificar todas
las columnas — si una no se puede verificar, se declara.

---

## 4. HALLAZGOS — errores en el origen

### 4.1 El libro de consumidor reporta códigos de generación equivocados

**Verificado en 2 de 2 días, sucursal 2 (`erpId` 5), con el archivo filtrado por
sucursal.**

| Día | Columna | Lo que reporta | A qué documento pertenece | Cuál era el correcto |
|---|---|---|---|---|
| 01/06 | cód. gen. "del" | `010D5CAF…` | id 297861 | id 297361 (`A8AEE366…`) |
| 01/06 | cód. gen. "al" | `FF69D633…` | id 298050 | id 298111 (`E0CA8B8C…`) |
| 02/06 | cód. gen. "del" | `0042379F…` | id 298303 | id 298226 (`E989E5EC…`) |
| 02/06 | cód. gen. "al" | `FDA8EC5F…` | id 298228 | id 298920 (`D32D32DB…`) |

Los cuatro son documentos **del medio del día**. Peor: el 02/06 el que llama
"al" (correlativo `…243`) tiene correlativo **menor** que el que llama "del"
(`…258`) — o sea que ni siquiera son consistentes entre sí.

El resto de la fila **sí es correcto**: número de control, sello, IDs y montos
coinciden con el primer y último documento del día. El problema está acotado a
esas dos columnas.

**Qué hace el portal:** emite los códigos **correctos** — los del primer y
último documento del día ordenados por correlativo. No se replica el error: es
un dato que se declara, y copiar un identificador equivocado en un libro fiscal
sería copiar el error, no el formato.

**Qué conviene hacer:** reportarlo al proveedor del ERP. Mientras no se corrija,
los dos archivos van a diferir en esas dos columnas, y **la diferencia es a
favor del portal**.

### 4.2 El libro de compras no resta las notas de crédito

139 documentos (135 notas de crédito + 4 de débito), **IVA neto $2,673.84** en
dos meses y medio. Detalle en `CHANGELOG.md` v2.334.0.

El **Art. 62 de la Ley de IVA** obliga a ajustar el crédito fiscal por las notas
de crédito recibidas, en el período en que se reciben. Hoy no se está haciendo:
los documentos llegan por correo y nunca se capturan, aunque el ERP tiene la
pantalla para hacerlo (*Nota crédito compras*).

El portal **no las resta del libro** —para no crear dos verdades del mismo
período— y las muestra en sección propia con su total, para que el ajuste se
haga al declarar. La corrección de fondo es capturarlas donde nacen.

### 4.3 El sello de las compras no está en la fuente

El archivo del ERP lo trae (columna 23), pero no viene en la fuente que alimenta
el módulo de Compras del portal. En el archivo del portal esa columna sale
**vacía**, no en cero: no sabemos el valor, y escribir uno sería inventarlo.

---

## 5. Estado y pendientes

**Cerrado:** los cinco archivos con datos salen con el formato del origen,
verificados columna por columna. El número de control de ventas está completo
(7,017 documentos) y se mantiene solo.

**Pendiente, por decisión — sólo documentado:**

- **Histórico 2025-05 → 2026-05** sin las 4 columnas fiscales de compras.
  Contabilidad sólo necesita junio y julio, que **están cerrados y verificados**
  (12 de 12 branch-meses idénticos en 6 medidas). La vista marca en rojo los
  meses incompletos, así que no se pueden presentar por error. Para
  completarlos: `fastBackfill: true` mes por mes.
- **Cruce compras ↔ documentos del correo**: 86.7% hoy, 91.2% alcanzable con
  tres reglas en cascada. 6 casos ambiguos se dejarían fuera a propósito.
- **Sujeto excluido**: no se encontró su archivo en el origen. Sale vacío en toda
  la historia de todas formas.
- **Anexo de retención**: usa el mismo formato que percepción por ser su
  hermano, pero **no está verificado con datos** — el archivo del ERP salió
  vacío en toda su historia (2025-01 → 2026-07, 7 sucursales).
- **Precisión de los montos de percepción**: el ERP guarda `577.7115` y el sync
  redondea a `577.71`, así que el anexo del portal sale con `571.9900` donde el
  del ERP dice `571.9915`. ~0.0015 por fila. Se corrige en el sync, no en el
  exportador.


---

## 6. VERIFICACIÓN CONTRA EL ORIGEN — junio 2026, 7 sucursales

Hecha el 2026-08-02 con `verificar-csv-libros`, que baja el archivo real por
sucursal y lo compara **línea por línea** contra una **segunda implementación**
del exportador escrita aparte en SQL (`generar_csv_libro`). Dos implementaciones
independientes que coinciden entre sí y con el origen valen más que reusar el
mismo código para verificarse a sí mismo.

### El conteo de líneas coincide EXACTO en los cinco

| Reporte | Origen | Portal |
|---|---|---|
| Consumidor | 180 | 180 |
| Contribuyentes | 49 | 49 |
| Anulados | 80 | 80 |
| Compras | 389 | 389 |
| Percepción | 226 | 226 |

Eso prueba que el filtro, el período y el universo de documentos son correctos
en las 7 sucursales.

### Filas idénticas, excluyendo las columnas con causa conocida

| Reporte | Coinciden | % |
|---|---|---|
| **Anulados** | 80 / 80 | **100%** |
| **Consumidor** | 179 / 180 | **99.4%** |
| **Contribuyentes** | 47 / 49 | **96%** |
| Compras | 226 / 389 | 58% |
| Percepción | 8 / 226 | 3.5% |

### Columnas excluidas, cada una con su motivo

| Reporte | Col | Motivo |
|---|---|---|
| Consumidor | 7, 8 | **el origen las reporta mal** (§4.1); el portal emite las correctas |
| Contribuyentes | 17 | el origen deja el NIT vacío; el portal lo tiene |
| Compras | 4 | NIT del proveedor que al portal le falta — **15 de 67 proveedores** |
| Compras | 22 | el sello, que no viene en la fuente |
| Percepción | 3, 6 | mismo NIT y mismo sello |

### Lo que todavía difiere, y por qué

**Percepción — precisión.** El origen guarda `253.4428`; el sync redondea a
`253.44` al guardarlo, así que el portal escribe `253.4400`. **No es formato: es
pérdida de precisión en el sync.** Se arregla guardando más decimales en
`purchase_receipts`, y eso merece su propia verificación porque esa columna hoy
cuadra al centavo en 12 de 12 branch-meses.

**Compras — orden residual en 3 sucursales.** Las filas quedan desplazadas una
posición (el origen trae 15/06 donde el portal trae 16/06). Como los totales
coinciden, no falta ni sobra ningún documento: es un criterio de orden que en
esas sucursales no es sólo `erp_purchase_id`. Sin resolver.

### Correcciones que salieron de esta verificación

1. **Orden por id interno** en compras, percepción, retención, anulados y
   contribuyentes. Antes iban por número de documento y eso desalineaba el
   archivo entero. Anulados pasó de 78 a **80 de 80**.
2. **Extremos del día por id interno** en el libro de consumidor. Antes se
   elegían por correlativo, que no es el mismo orden. Consumidor pasó de 130 a
   **179 de 180**. Cambiar el criterio metió 760 documentos nuevos en la cola del
   número de control, que se drenaron el mismo día.
