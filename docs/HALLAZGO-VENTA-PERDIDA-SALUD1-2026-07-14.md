# La diferencia de $9.00 del Corte Z de Salud 1 — julio 2026

**Auditado el 2026-08-03.** Conclusión: **el portal tiene razón y el origen
perdió el registro de una venta que sí existe y está sellada por Hacienda.**

---

## El documento

| | |
|---|---|
| Código de generación | `C8AC7997-6649-4636-840B-ACB15DFE0BA1` |
| Número de control | `DTE-01-S003P001-000000000032552` |
| Sello de Hacienda | `2026FFE6A1A47EBA4DF2A05026F2FD8AAEBDIGQS` |
| Emitido | 2026-07-14 **08:10:17**, FARMACIA LA SALUD 1 |
| Cliente | EVER ELIEZAR MENDOZA GUTIERREZ |
| Detalle | COLITISIL X 48 TABLETAS · 36 × $0.25 |
| Total | **$9.00** |
| Id interno del origen | 328969 · correlativo 0000077195 |

## Qué se verificó, y en qué orden

**1. La diferencia es de un solo día.** Comparado el libro de consumidor del
origen contra el portal, día por día, los 31 días de julio de Salud 1: **30
cuadran al centavo** y solo el 14/07 difiere — origen $1,921.40, portal
$1,930.40. Los créditos fiscales cuadran exactos ($517.79 los dos lados), así
que los $9.00 están enteros en la línea de factura.

**2. La venta es real y está sellada.** `dteqr_json.php` devuelve el DTE
completo, con su sello de recepción, su número de control y su único ítem. No es
un documento fantasma del portal: existe en Hacienda.

**3. Es de Salud 1, y está en secuencia.** El número de control dice
`S003P001`, que es el establecimiento y punto de venta de Salud 1 (verificado
contra los otros 134 documentos de la sucursal). El correlativo 77195 encaja sin
hueco entre el 77194 (08:08:59) y el 77196 (08:13:21).

**4. El origen ya no lo tiene.** Buscado por id, por correlativo y por código de
generación en `descarga_dte_emitidos_json.php`:
- el **14/07 en las 7 sucursales** — no aparece;
- **julio completo de Salud 1** (4,352 ventas) — no aparece;
- **agosto de Salud 1** — no aparece.

El portal tiene 4,353 documentos de julio en esa sucursal y el origen 4,352:
**exactamente uno menos, y es este.**

**5. No fue anulado.** El anexo de anulados del origen trae 16 filas para julio
de Salud 1 —las mismas 16 que tiene el portal— y ninguna es esta. Un documento
invalidado **sigue apareciendo** en el listado del origen con estado
`DTE INVALIDADO EN MH`; este no aparece de ninguna forma.

**6. El propio libro del origen se contradice.** Su fila del 14/07 declara el
rango de ids internos **328931 → 329608**, que **contiene** al 328969, y acto
seguido reporta un total que lo excluye.

**7. La causa, a la vista.** `dteqr_pdf.php` no puede generar el PDF de este
documento: responde con un error de PHP,
`Undefined offset: 0 in .../downloads/dteqr_pdf.php on line 38`. O sea que el
generador busca el registro **en la base de datos del origen y no lo encuentra**.
El JSON sí sale porque se guardó como archivo en disco al emitirlo.

**Conclusión: la fila de la venta desapareció de la base de datos del origen.**
Todo lo que lee la base —el listado de emitidos, el libro, el Corte Z, el
generador de PDF— la omite. Lo único que sobrevive es el DTE que se escribió a
disco en el momento de emitir, y el sello de Hacienda.

## Cuándo pasó

El portal lo capturó el **2026-07-14 a las 14:11:03 UTC** (08:11 hora local), un
minuto después de la emisión — el sync corre cada minuto. La fila del portal no
tiene **ni un solo cambio** en su historial: el origen nunca reportó que pasara
nada con este documento. Simplemente dejó de devolverlo.

## Alcance: ¿pasa seguido?

**No. Es 1 documento de 44,239.** Cotejados los ids del origen contra los del
portal en **junio y julio, las 7 sucursales**:

| | |
|---|---|
| Documentos en el origen | 44,238 |
| Documentos en el portal | 44,239 |
| Sucursal-mes con la huella idéntica | **11 de 12** |

La única que difiere es Salud 1 julio, y la diferencia entre las sumas de ids es
**328,969** — exactamente este documento. No hay ningún otro faltante ni
sobrante, ni intercambios que se compensen.

## Lo que el sistema ya hacía bien

El cuadre diario (`check-sales-reconciliation`, cron 07:30 UTC) **lo detectó y
avisó**: `sync_alert_log` tiene la alerta `ventas-cuadre` para `4|2026-07-14`
con `-9.00`, enviada el 2026-08-02. La herramienta funcionó.

## Las otras tres alertas abiertas son OTRO problema — y es del portal

> **Corrección.** La primera lectura fue que eran ventas sin sello todavía, o
> sea retraso que se corrige solo. **Era falsa**, y la delató medir en vez de
> suponer: el exceso del libro del origen coincide al centavo con otra cosa.

`4|2026-08-02` ($6.95), `29|2026-08-01` ($12.50) y `28|2026-08-01` ($62.60) van
en la dirección contraria: el origen tiene **más**. Y su feed de documentos
coincide **exacto** con el portal en los tres días (98/$1,018.70,
159/$1,351.89, 41/$477.30). Lo que difiere es su **libro**.

**El exceso es, en los tres, el documento `NULA` del día, al centavo:**

| Sucursal | Día | Exceso del libro | Documento anulado |
|---|---|---|---|
| Salud 1 | 02/08 | $6.95 | $6.95 (1) |
| Salud 4 | 01/08 | $62.60 | $62.60 (1) |
| Salud 5 | 01/08 | $12.50 | $12.50 (1) |

Y esos documentos **tienen sello de Hacienda** y **no están en el anexo de
anulados** —verificado con una ventana de dos meses, no solo el día—, así que
**nunca se invalidaron ante Hacienda**. Para Hacienda esas ventas siguen
vigentes.

**Entonces acá el que se equivoca es el portal:** filtra el libro por
`estado = FINALIZADA` y las deja fuera. El origen las incluye, y tiene razón.

No es un estado de paso: de los 6 documentos `NULA` con sello de toda la
historia, dos son de agosto de 2025 y uno de febrero de 2026 — **siguen igual
once y cinco meses después**.

| | Documentos | Monto |
|---|---|---|
| `NULA` con sello, toda la historia | 6 | $99.80 |
| …de esos, en el período contable | **3** | **$82.05** |

**Es una decisión del contador, no del portal**, y por eso no se cambió el
filtro: o esas ventas se invalidan ante Hacienda como corresponde, o el libro
tiene que llevarlas. Mientras tanto el libro declara **$82.05 de menos** en el
período contable.

Aparte, y sin efecto: 120 documentos sin sello de los últimos 3 días
($1,630.36) —eso sí es retraso normal, y se resuelve— más 2 de agosto de 2025
($38.00) que nunca lo recibieron. **Cero pendientes de más de tres días dentro
del período contable.**

## Qué hacer

1. **No tocar el documento del portal.** La venta existe, está sellada y el
   Art. 83 obliga a registrarla. Nuestro libro la incluye; el del origen no. La
   diferencia de $9.00 en la tarjeta del Corte Z es correcta y va a quedarse.
2. **Reportarlo al proveedor del origen** con los datos de arriba —sobre todo
   el error de `dteqr_pdf.php` y el rango del libro que contiene un id cuyo
   monto no suma—, que es lo que permite ubicar el registro perdido.
3. Los 2 documentos de agosto de 2025 sin sello ($38.00) quedan anotados: son
   anteriores al período contable y no afectan ninguna declaración.
4. ~~Decidir qué se hace con las 3 ventas anuladas sin invalidar.~~ **Decidido el
   2026-08-04**: las de agosto de 2026 son período activo y quedan a la vista sin
   urgencia (Salud 5 `342802`, Salud 4 `342407`, Salud 1 `343519` · $82.05); las
   anteriores se dan por cerradas —ya no hay forma de corregirlas y quedaron
   solventadas en el sistema de origen— y además caen fuera del alcance del
   cuadre, que solo mira el mes en curso y el anterior. Detalle en
   `RETENCION-IVA-VENTAS-2026-08-04.md`.

## Lo que quedó automatizado (v2.363.0)

Los siete pasos de arriba son mecánicos y ahora los hace el cuadre diario: al
encontrar un día que no cuadra baja al documento, lo clasifica y guarda el
resultado en `ventas_cuadre_hallazgos`. El panel «Por qué difiere» del Corte Z
lo muestra en vez de mandar a comparar a mano.

Corrido sobre julio y agosto, los cuatro días quedan **explicados al centavo**
(`sin_explicar = 0` en los cuatro): uno `origen_perdio_fila` y tres
`anulado_sin_invalidar`. Ese contador de «sin explicar» es a propósito — un
diagnóstico que dice «ya está» sobre una diferencia todavía abierta es peor que
no diagnosticar, y fue justo lo que delató que la primera lectura de las tres
alertas de agosto estaba mal.
