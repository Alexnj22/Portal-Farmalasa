# Plan — una sola búsqueda en todo el portal (2026-09-25)

Nació de un reporte del usuario: *«a veces la búsqueda no es buena, deja muchas
cosas sueltas y muestra resultados incorrectos»*. La auditoría encontró que no
hay «una búsqueda» en el portal, sino **cinco formas distintas** de buscar. Cada
una tiene sus propios defectos, y los defectos más graves están en la regla,
no en la dispersión. Por eso **unificar sin cambiar la regla repartiría esos
mismos defectos por todo el portal**. Este plan define cuál es la regla correcta,
dónde vive y en qué orden se lleva a cada buscador.

Todas las cifras están medidas contra producción el 2026-09-25, con
4,397 productos activos.

---

## 1 · Lo que hay hoy

| mecanismo | dónde | cuántos | orden de palabras | tildes | código de barras | relevancia | aproximada |
|---|---|---:|---|---|---|---|---|
| **A** `smartFilter`/`tokenMatch` (navegador) | 52 buscadores | ≈52 | no importa | sí | sólo `TabPresentaciones` | **no** (sólo el respaldo aproximado ordena) | Levenshtein ≥0.72, si 0 exactos y ≥4 letras |
| **B1** `filtroProductoOCodigo` / `likePattern` (PostgREST) | catálogo, reglas, recepción, conteo manual, cotizaciones, carga de inventario | 8 | **importa** | sí | sí | no (alfabético) | **no** |
| **B2** `.ilike('%q%')` crudo | descarga de inventario, cargar compra, clientes de cotización, médicos, solicitudes de datos, notificaciones, compras, anulación | 10 | **frase exacta** | **no** | no | no | no |
| **C** RPC de búsqueda | Mín·Máx, existencias, inventario, conteo, ventas, clientes, promociones, empleados | 12 | casi todas no importa; 2 excepciones | casi todas; 2 excepciones | 3 estrategias distintas | sólo el respaldo de Mín·Máx | sólo Mín·Máx (`word_similarity` ≥0.65) |
| **D** filtro a mano (`toLowerCase().includes`, `normalizeText`, `plano`) | bitácoras, metas ×5, promociones ×2, facturas de sala ×2, compras ×2, CxP, libros ×2, Mi caja, solicitudes de datos | 17 | **frase exacta** | la mitad no | no | no | no |
| **D** componente | `LiquidSelect` (≈250 usos) y `SelectorTactil` | 2 | **frase exacta** | sí | no | no | no |

Además hay **tres normalizadores** en el navegador con reglas distintas:
`normSearch`, `normalizeText` (`utils/helpers.js:26`) y `plano`
(`MiCajaView.jsx:1426`), más los propios de `LiquidSelect` y `SelectorTactil`.
En la base, `customers` usa `translate()` en lugar de `norm_search`. El retraso
entre teclas (debounce) vive en unos 20 `setTimeout` escritos a mano con seis
valores distintos (150 / 250 / 300 / 350 / 380 / 450 ms), y el mínimo de letras
es 1, 2 o 3 según la pantalla.

Lo único que ya está bien y es igual en los dos lados: `normSearch` (JS) y
`norm_search` (SQL) hacen exactamente lo mismo.

---

## 2 · Por qué devuelve resultados incorrectos (medido)

### 2.1 La normalización destruye palabras y números
`norm_search` **borra** la puntuación en vez de reemplazarla por espacio:

| nombre real | queda como | consecuencia |
|---|---|---|
| `TEMISAR PLUS 80/12.5MG` | `80125mg` | «80» y «12.5» ya no se encuentran como tales |
| `CLIMABEL 2.5MG` | `25mg` | **«25» encuentra 33 productos que son de 2.5** |
| `VALVEY 100UI/ML` | `100uiml` | «ui» y «ml» ya no son palabras |
| `JERINGA … 1 1/2` | `1 12` | «1/2» se lee como un 12 |
| `MAGNESIA … S/MENTA` | `smenta` | «menta» sólo aparece si se busca como pedazo de otra palabra |

409 nombres tienen `/`, 239 tienen decimales y 44 tienen un guion entre letras.

### 2.2 Los números se buscan como texto
| se escribe | encuentra como pedazo | encuentra como número completo |
|---|---:|---:|
| `500` | 193 | 161 |
| `5` | **1,487** | 252 |

«ibuprofeno 5» trae ibuprofeno de 50, de 500 y de 25.

### 2.3 Una palabra corta coincide con cualquier pedazo de otra
«sal» coincide dentro de otras palabras en 58 productos y al inicio de una
palabra en 28. Como el orden es alfabético, los primeros seis resultados de
«sal» son `ACIDO BORICO … SALUFARMA`, `ASPIRADOR NASAL`, `AVACORT SPRAY
NASAL`, `AVAMYS … NASAL`, `BETASALIC` y `BETASALIC`. **SAL ANDREWS o
SALBUTAMOL no están entre ellos.** Ésta es la queja «muestra resultados
incorrectos»: el resultado correcto sí vino, pero enterrado.

### 2.4 No hay relevancia
Salvo el respaldo aproximado, **ninguna búsqueda ordena por parecido**. El
navegador devuelve en el orden en que llegaron los datos y el servidor en orden
alfabético.

### 2.5 La búsqueda aproximada muestra otra concentración como si fuera la buscada
En el navegador, «ibuprofeno 400» cuando no existe el de 400: `400` contra
`600` difiere en un dígito y el promedio pasa de 0.72. Muestra el de 600. La
aproximada **nunca** debería comparar números.

---

## 3 · Por qué deja cosas fuera (medido)

| caso | hoy | debería |
|---|---|---|
| «90 alcohol» en los 8 buscadores B1 | **0** | 4 |
| «500mg» (pegado) | 66, pierde los 37 escritos `500 MG` | 103 |
| «amoxisilina» en Mín·Máx (servidor, `word_similarity` 0.65) | **0** (parecido 0.60) | amoxicilina |
| «omeprasol» en Mín·Máx | **0** (0.60) | omeprazol |
| «dicloefnac» en Mín·Máx | **0** (0.47) | diclofenac |
| «jose» en facturas del widget de anulación | pierde las facturas con tilde (1,089 de 61,781 en 90 días) | todas |
| «amox 500» en promociones | **0** (`get_productos_para_promocion` busca la frase entera) | amoxicilina 500 |
| código de barras en descarga de inventario, cargar compra, promociones, ventas por factura y los 7 `smartFilter` de producto | **no busca** | busca |
| «clavulanico» contra `AMOXICILINA/CLAVULANICO` si se exige inicio de palabra | se pierde (queda `amoxicilinaclavulanico`) | encuentra |

Y un defecto que no es de búsqueda, pero que la búsqueda deja ver:
**`inventory_proximos_count` e `inventory_inversion` no buscan por código**
mientras `inventory_grouped` sí. Al buscar un código en /inventario, los totales
no cuadran con la lista.

---

## 4 · La regla correcta

Una sola regla, escrita **dos veces**: en JS y en SQL. Las dos se prueban contra
los **mismos casos**, igual que `turnoDelDia` / `turno_del_dia`.

### 4.1 Normalizar (`normalizar` ↔ `norm_busqueda`)
1. Quitar tildes (`ñ` → `n`) y pasar a minúsculas.
2. **Decimal entre dígitos**: `2,5` y `2.5` quedan como `2.5`. El decimal se
   conserva.
3. **Siglas**: los puntos entre letras sueltas se quitan (`S.S.N` → `ssn`).
4. **Toda otra puntuación se reemplaza por ESPACIO**, no se borra
   (`80/12.5mg` → `80 12.5 mg`, `co-trimoxazol` → `co trimoxazol`).
5. **Separar número de letras**: `500mg` → `500 mg`, `x30` → `x 30`.
6. Colapsar espacios.

Se guarda también una **forma compacta** (sin ningún espacio) para no perder
lo que hoy funciona por accidente: «cotrimoxazol» contra `co trimoxazol`,
«ssn» contra `s s n`.

### 4.2 Coincidir
Todas las palabras escritas tienen que aparecer, **en cualquier orden**. Cada
palabra coincide según su tipo:

| palabra escrita | coincide con |
|---|---|
| número (`500`, `2.5`) | **el número completo**: `500` encuentra `500 mg` pero no `1500` |
| 1–2 letras (`mk`, `b`) | **inicio de palabra** |
| 3+ letras | cualquier parte de una palabra, o la forma compacta |
| parece código (≥4 caracteres, empieza con dígito) | además, el código de barras |

Esto **no pierde nada** de lo que hoy se encuentra con 3+ letras. Recorta el
ruido justo donde se genera: números y palabras cortas.

### 4.3 Ordenar por relevancia
| puntaje | caso |
|---:|---|
| 100 | código de barras exacto |
| 90 | el nombre **empieza** con lo escrito |
| 80 | todas las palabras coinciden **al inicio** de una palabra |
| 70 | todas las palabras coinciden y las palabras escritas van seguidas en el mismo orden |
| 60 | todas coinciden en cualquier parte (lo que hoy es «coincide») |
| <50 | aproximada (§4.4), **siempre con el aviso** «Resultados similares para X» |

A igual puntaje, orden alfabético. Una pantalla que tenga su propio orden
elegido por el usuario (una columna de /inventario, la venta neta) lo conserva.
La relevancia manda sólo cuando nadie eligió otro orden.

### 4.4 Búsqueda aproximada, sólo como respaldo
- Entra sólo si la búsqueda normal devolvió **cero**, y sólo con ≥4 letras.
- **Nunca compara números**: un número tiene que coincidir exacto o la fila no
  entra.
- Dos formas de parecido, porque cada una caza un error distinto (medido):
  - **fonética del español** (`c/s/z`, `v/b`, `ll/y`, `h` muda, `qu/k`, letras
    dobles): caza **amoxisilina** (7 aciertos) y **omeprasol** (3), que los
    trigramas no alcanzan;
  - **distancia de edición por palabra**: caza **dicloefnac** (letras
    cambiadas de lugar) y **acetaminofem**, que la fonética no alcanza.
- En el servidor: los trigramas con un umbral bajo sólo **eligen candidatos**
  (usando el índice); el orden final lo da la distancia por palabra. Hay que
  medir antes de fijar números (§7, F1).

### 4.5 Mínimos y retraso entre teclas
- **Una sola constante** de retraso: 300 ms, y **una** de mínimo por tipo de
  fuente:
  - lista en memoria: 1 letra;
  - servidor sobre catálogo (productos, clientes): 2;
  - servidor sobre tablas grandes (ventas, facturas): 3.
- Un hook `useBusqueda(valor, { fuente })` las aplica. Se acaban los 20
  `setTimeout` escritos a mano.

---

## 5 · Dónde vive

### Navegador — `src/utils/busqueda.js` (lógica pura, pasa `gate:nucleo`)
- `normalizar`, `palabras`, `coincide(q, ...campos)`, `puntaje(q, ...campos)`,
  `filtrar(q, items, campos) → { resultados, aproximado }`.
- `smartFilter` y `tokenMatch` **quedan como envoltorios** de la nueva regla, así
  que los ≈52 buscadores A mejoran sin tocar cada archivo. `normSearch` pasa a
  llamar a `normalizar`.
- `LiquidSelect` y `SelectorTactil` usan `coincide` + `puntaje`: arregla ≈250
  selectores de una vez.
- `normalizeText` (sólo en su uso para buscar), `plano` y los normalizadores
  propios de `LiquidSelect` y `SelectorTactil` desaparecen.

### Base — gemelos de SQL
- `norm_busqueda(text)` y `norm_busqueda_compacta(text)`: `IMMUTABLE`, gemelos
  de `normalizar`.
- Columnas **generadas** `busq` y `busq_compacta` en `products` (nombre +
  principio activo + laboratorio), `customers` y `proveedores_maestro`, con
  índice GIN de trigramas. `inventory_grouped_mv` las lleva en su definición.
- `busqueda_coincide(q, texto)` y `busqueda_puntaje(q, texto)`.
  **El `LIKE ALL` sobre la columna indexada se queda como primer filtro**, para
  que siga entrando por el índice. La regla de números y el puntaje se aplican
  después, sobre el conjunto ya reducido. Así el plan no cambia de forma, y lo
  vigila la sección C de `gate:perf`.
- **Una sola RPC de producto**: `buscar_productos(p_q, p_limit, p_opciones jsonb)`,
  con `RETURNS json` y que devuelve el puntaje. La usan **todos** los
  selectores de producto por medio de `BuscadorDeProducto`. Reemplaza
  `filtroProductoOCodigo`, los B2 de producto, `get_productos_para_promocion` y
  el buscador propio de `CargarCompraView`, `WidgetInventoryMovement` y
  `EnviarProductoModal`. De paso saca las búsquedas del `.or()` de PostgREST,
  donde una coma parte el filtro sin avisar.
- Las demás funciones (inventario, conteo, ventas, clientes) conservan su forma
  y cambian su predicado de texto por la regla.

### Los casos de prueba — `tests/casos-busqueda.json`
Un solo archivo con los casos: los de §2 y §3 de este documento, más los que el
usuario reporte. Lo leen:
- `tests/unit/busqueda.test.js` (gemelo JS);
- `scripts/busqueda/comparar_gemelos.mjs`, que corre los mismos casos contra
  el gemelo SQL y exige **0 distintas**, igual que `comparar_matcher.mjs`.

Cambiar un gemelo exige cambiar el otro y volver a compararlos.

### El gate — `npm run gate:busqueda`
Cuenta `.ilike(` fuera del módulo de datos canónico, `toLowerCase().includes`
o `normalizeText(` dentro de un filtro de lista, `setTimeout` de búsqueda
escrito a mano, y RPC con `p_search` que no usen la regla. Baseline que
**sólo baja**. Va en el pre-commit cuando el commit toca `src/`.

---

## 6 · Riesgos y reglas del repo que aplican

- **DDL sobre tablas calientes.** Agregar una columna `GENERATED STORED` a
  `products` y `customers` **reescribe la tabla** con lock ACCESS EXCLUSIVE, y
  el sync escribe cada minuto. Se hace con `SET lock_timeout = '5s'`, entre las
  06:00 y las 11:59 UTC, y se prueba antes en el branch con `execute_sql`, nunca
  con `apply_migration`.
- **Funciones nuevas `LANGUAGE sql` + `SET` con parámetros**: la trampa 4. Las
  de búsqueda se escriben en `plpgsql` con `force_custom_plan` y se declaran en
  `scripts/planes-genericos.json`. Se miden **seis veces**, como `authenticated`,
  con `EXPLAIN (ANALYZE, TIMING OFF, BUFFERS)`.
- **`inventory_grouped_mv`**: cambiar su definición exige rehacerla con el mismo
  procedimiento de `20260818145753` (crear la `_nueva`, índices y renombrar).
- **Cambiar la normalización cambia qué encuentra cada pantalla.** Con §4.2 no
  se pierde nada de 3+ letras. Se pierde a propósito que «5» encuentre «500» y
  que «mk» encuentre la mitad de una palabra. El comparador tiene que mostrar,
  sobre el catálogo real, qué búsquedas cambian de resultado **antes** de
  publicar.
- **Techo de 1000 filas**: la RPC única devuelve `json` (Patrón C).
- **Auditoría**: ninguna de las áreas que toca el plan está congelada hoy
  (plataforma, facturación, compras, bitácoras, promociones, cortes, fiscal,
  metas, tablero y datos personales, entre 93 y 95%). Hay que volver a
  mirarlo antes de cada fase.
- **Gates en cada cierre**: `gate:perf`, `gate:eficiencia`, `gate:data`
  (`in-columna-repetida`), `gate:movil` si se toca un diálogo, `gate:nucleo`.

---

## 7 · Fases

| fase | qué | riesgo | depende de |
|---|---|---|---|
| **F0 · defectos sueltos** | Se arreglan con la regla actual, sin esperar a la nueva. (1) Anulación: `cliente.ilike` contra columna cruda con texto sin tildes (`facturacion.js:359`). (2) `compras.js:31`: `.or()` sin escapar la coma y sin debounce. (3) `get_productos_para_promocion`: frase entera → palabras. (4) `buscar_empleado_para_solicitud` y las B2 de médicos, solicitudes, cotizaciones y notificaciones: sin tildes. (5) `inventory_proximos_count` / `inventory_inversion`: sin código de barras, los totales no cuadran. (6) Borrar lo que ya no llama nadie: `buscarInventarioGlobal` (v1) y `searchInventory` / `search_inventory_descripcion_ids`. | bajo | — |
| **F1 · la regla** | `busqueda.js` + `casos-busqueda.json` + pruebas + gemelos SQL + comparador con **0 distintas**. Medir los umbrales de la aproximada contra el catálogo real. Informe de «qué búsquedas cambian de resultado». | nulo (no se publica nada) | — |
| **F2 · navegador** | `smartFilter`/`tokenMatch` pasan a la regla nueva (≈52 buscadores). `LiquidSelect`/`SelectorTactil` (≈250). Los 17 D. Fuera los normalizadores paralelos. `useBusqueda` + constantes únicas. | medio: cambia lo que ven muchas pantallas a la vez | F1 |
| **F3 · producto** | Columnas generadas en `products`, RPC `buscar_productos`, `BuscadorDeProducto` en todos los selectores de producto. Fuera `filtroProductoOCodigo`. | medio: DDL en tabla caliente | F1 |
| **F4 · resto del servidor** | inventario (vista materializada), conteo, ventas, clientes (`customers.busq`), proveedores. | medio: vista materializada + tablas grandes | F1, F3 |
| **F5 · gate** | `gate:busqueda` con su baseline, al pre-commit. | nulo | F2–F4 |
| ~~F6 · sinónimos~~ | **Descartada** (decisión 4, §8). | — | — |

### Avance

| fase | estado |
|---|---|
| F1 · la regla | ✅ v2.1064.0 (JS) y v2.1066.0 (gemelo SQL `busqueda_*`). `npm run busqueda:gemelos`: 0 diferencias sobre 33,810 nombres reales y 26 búsquedas de producto. |
| F2 · navegador | ✅ v2.1064.0: `smartFilter`/`tokenMatch` (≈52 buscadores), `LiquidSelect`, `SelectorTactil` y los 17 filtros D. Los catálogos marcados con `orden: 'relevancia'`: menú, sucursales, mantenimiento, permisos y laboratorios de Mín·Máx. |
| F3 / F4 · servidor + aproximada | ✅ v2.1066.0 → v2.1072.0, en horario con `lock_timeout`. Productos (una sola función, `busqueda_productos`), existencias, conteo, Mín·Máx, promociones, Ventas, clientes, facturas de la sala, personas, médicos y notificaciones. La aproximada corre sólo si lo exacto no trajo nada, y siempre con el aviso `AvisoParecidos`. |
| F5 · que no vuelva | ✅ `npm run gate:busqueda` (v2.1072.0, en el pre-commit): filtro a mano, `ilike` con el texto del usuario y `normSearch` fuera de su archivo, bloqueante en cero. `useBusqueda` (v2.1073.1): una sola espera de 350 ms para los buscadores que consultan a la base, en 13 vistas. |
| F0 · defectos sueltos | ✅ Compras ya espera y descarta las respuestas viejas (v2.1073.1). |

Medido al cerrar (`gate:perf`): `busqueda-del-tablero` 18.5 ms (techo 32),
`buscar-en-ventas` 683 ms (la versión vieja medía 702), `buscar-en-productos`
307 ms. «5» 1,487 → 294 resultados; «2.5» en Existencias 1,099 → 63 y en Ventas
4,451 → 44.

Tres trampas de rendimiento que salieron al pasar las funciones a la regla,
todas medidas:
- Una función que no es `PARALLEL SAFE` llamada **dentro** de una consulta le
  quita los workers a la consulta entera: Ventas 695 ms con los ids resueltos
  antes en un arreglo, 1,304 ms con la llamada adentro.
- `columna ~ ALL (arreglo)` no entra por el índice de trigramas; la primera
  palabra como expresión simple sí (9 → 5 ms).
- Las funciones por fila de la regla se declaran con `COST` alto para que el
  planificador aplique primero el prefiltro barato (conteo 347 → 100 ms).

Lo que midió F1 y no estaba previsto en §4: `25,000` / `2,500 UI` usan la coma
como **separador de miles** (29 productos), así que no es un decimal. Además,
juntar todas las palabras en la forma de rescate hacía que «sal» encontrara
`4 PUNTOS ALUMINIO` (puntoSALuminio). La forma de rescate ahora sólo borra la
puntuación y conserva los espacios.

F0 se puede hacer ya. Lo demás arranca por F1, porque **sin los casos de prueba
no hay forma de saber si la regla nueva es mejor**. Sólo se sabría que es
distinta.

---

## 8 · Decisiones del usuario (2026-09-25)

1. **Las pérdidas de §4.2: SÍ.** «5» deja de encontrar «500», y «mk» deja de
   encontrar la mitad de una palabra.
2. **Relevancia: SÍ, con la regla de §8.1** (catálogo por parecido, historial
   por fecha, columna elegida manda).
3. **La búsqueda aproximada va en TODOS los buscadores**, siempre con el aviso.
4. **Sin sinónimos.** *«acetaminofen es acetaminofen. si en la vista sale el
   principio activo visible, que lo busque, si no no.»* Esto se generaliza como
   regla: **se busca lo que se ve**. Los campos de búsqueda de una pantalla son
   los que la pantalla muestra, más el código de barras, que no se ve porque se
   escanea. F6 queda descartada.
   Consecuencias:
   - `buscar_productos` recibe en `p_opciones` si incluye el principio activo,
     y lo decide la pantalla según lo muestre o no.
   - Hoy hay buscadores que miran campos que no se ven: Mín·Máx busca por
     principio activo y laboratorio, y la ventana de existencias busca por
     principio activo. Cada uno se revisa contra lo que su pantalla muestra.
5. **Casos reales**: las búsquedas que salieron mal en sala entran a
   `casos-busqueda.json` tal cual. Son las que más valen.

### 8.1 · Propuesta de orden (decisión 2)
El orden por relevancia sirve para **catálogos**, donde se busca *una cosa*:
productos, clientes, empleados, proveedores, laboratorios, cargos, módulos del
menú. En **historiales**, donde se busca *qué pasó* (facturas, ventas, cortes,
movimientos, notificaciones, auditoría), lo que importa es lo más reciente, y
ordenar por parecido desordenaría las fechas.

| tipo de lista | orden al buscar |
|---|---|
| catálogo | relevancia; a igual puntaje, alfabético |
| historial | su orden de siempre (fecha, más reciente primero) |
| cualquier lista donde el usuario eligió una columna | esa columna |

La búsqueda aproximada sí va por parecido en los tres casos, porque ahí
el orden dice qué tan seguro es el resultado.
