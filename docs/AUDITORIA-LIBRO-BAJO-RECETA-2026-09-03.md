# El libro «Bajo receta» contra la SRS — qué mide, qué le falta y qué lo invalida

**2026-09-03** · `/bitacoras?tab=libro` · versión del portal v2.970.3

Auditoría de la pestaña **Bajo receta** (el libro foliado de dispensación) contra
el **RTS 11.02.04:24 §6** y la **Guía de Verificación de BPAD** de la SRS. Todo
número de acá sale de una consulta a producción hecha hoy; los ítems se citan
del texto de la norma, no de memoria.

**Las dos fuentes están vigentes y son las del repo.** Se volvió a bajar la Guía
de srs.gob.sv (`/wp-content/uploads/2025/10/…`) y es **byte por byte idéntica**
a `docs/legal/srs_guia_verificacion_bpad.pdf` (md5 `8e10db10…`). O sea que la
copia local no está vieja.

> ⚠️ No se pudo abrir la vista en el navegador: la extensión de Chrome no está
> conectada en esta sesión. Todo lo de abajo se verificó contra el **código
> desplegado** y contra la **base de producción**, que es donde viven los
> defectos que siguen. Lo que falta comprobar mirando es la parte visual.

---

## 0 · El veredicto en una línea

El libro está **bien construido y mal alimentado**. La mitad que llena la
máquina es de las mejores del portal —421 renglones foliados, 100% con lote,
vencimiento, presentación y hora—. La mitad que llena la persona **está en cero
desde que el módulo existe**, y la lista que decide qué entra al libro deja
afuera **cuatro de cada cinco** antibióticos que la farmacia dispensa.

Hoy, ante una inspección, el libro **falla los dos ítems CRÍTICOS** de la
sección 3 de la Guía (3.3 y 3.4) y no puede sostener 3.12, 3.14 ni 3.17.

---

## 1 · Lo que se midió

| | |
|---|---:|
| Renglones foliados (3-jul → 3-sep) | **421** |
| … con lote / vencimiento / presentación / hora | **421 (100%)** |
| … con vendedor · con ficha de cliente | 420 · 419 |
| **… completos (paciente + médico + foto)** | **0** |
| … pendientes de completar | **414** |
| … anulados (DTE invalidado) | 7 |
| Recetas registradas (`recetas`) | **0** |
| Médicos registrados (`medicos`) | **0** |
| Salas que alimentan el libro | 6 de 6 |

Las seis salas cargan. Nadie completó nunca un renglón: no es una sala que se
atrasó, es el proceso que no arrancó.

---

## 2 · Hallazgo CRÍTICO 1 — el libro ve el 19.6% de lo que debería ver

**Guía 3.3 (CRÍTICO)** · «¿Se lleva un registro trazable de los antibióticos que
se manejan y dispensan?»
**Guía 3.4 (CRÍTICO)** · «¿Las existencias físicas concuerdan con las detalladas
en el registro?»
**RTS 6.4.2** · «registro trazable (físico o digital) del movimiento de los
medicamentos antibióticos **que se manejan en el establecimiento**».

Lo que decide si una venta entra al libro es una sola condición, dentro de
`sincronizar_bitacora_dispensaciones`:

```sql
WHERE p.es_antibiotico
```

`products.es_antibiotico` viene del ERP (`sync-products`) y es una **lista
mantenida a mano: 79 productos de 5,219**. Medido contra el catálogo real,
restringido a antibacterianos **sistémicos** (ATC J01, sin tópicos ni
oftálmicos ni intestinales):

| ventas 1-jul → 3-sep | renglones | |
|---|---:|---:|
| entran al libro | 444 | **19.6%** |
| **NO entran** | **1,827** | **80.4%** |

Los que faltan no son marginales — son los de más volumen:

| producto | ventas | en el libro |
|---|---:|---|
| AMOXICILINA 500 MG X 30 CAP MK | 783 | ❌ |
| AMOXICILINA 500MG X 100 CAPS. SAIMED | 259 | ❌ |
| TETRACICLINA 500MG X 100 CAP MK | 152 | ❌ |
| CIPROFLOXACINA 500MG X100 TAB GAMMA | 98 | ❌ |
| TRIMETOPRIMA FORTE X 50 TAB MK | 67 | ❌ |
| AMPICILINA 500 MG X 50 CAPS MK | 62 | ❌ |
| CEFADROXILO 500 MG X 30 CAPS MK | 43 | ❌ |
| METRONIDAZOL 500 MG X 40 TAB MK | 38 | ❌ |

**El patrón se lee solo:** lo marcado son las marcas comerciales (AXTAR, DENVAR,
KLARICID, ELEQUINE, FIXIM, ZIBAC…) y lo no marcado son los **genéricos de casa**
(MK, SAIMED, ECOMED, GAMMA), que es justo lo que más se vende. La lista se
escribió una vez mirando el estante caro y nunca se volvió a mirar.

Y tiene basura en el otro sentido: **RANITIDINA 50MG AMPOLLA** está marcada como
antibiótico y aparece en el libro. No lo es.

Es exactamente `feedback_lista_a_mano_se_desincroniza_del_registro`, aplicado al
catálogo que decide el contenido de un registro sanitario.

### La lista NO se inventa: la emite la SRS

**RTS 6.4.3** — «La dispensación de antibióticos se debe realizar solamente si
se presenta una receta médica, **según el listado emitido oficialmente por
SRS**.»
**RTS 6.1.13** — «El establecimiento debe disponer del acceso al listado de
antibióticos de acuerdo al reconocimiento de la clasificación de antibióticos
por parte de la Autoridad Reguladora.»

Ese listado existe y es descargable: **Listado Oficial de Medicamentos 2025**,
SRS, firmado por el Superintendente
(`srs.gob.sv/wp-content/uploads/2025/03/LISTADO-OFICIAL-DE-MEDICAMENTOS-2025.pdf`).
Su capítulo **J01 · ANTIBACTERIANOS PARA USO SISTÉMICO** trae 40 entradas con su
código ATC, y **la clasificación AWaRe viene marcada en el propio código**:

- `*(1)` → **GRUPO ACCESO** (Access) — doxiciclina, amoxicilina, ampicilina,
  penicilina, cefazolina, TMP-SMX, clindamicina, gentamicina, amikacina,
  metronidazol, nitrofurantoína, fosfomicina, amoxicilina+clavulánico…
- `*(2)` → **GRUPO PRECAUCIÓN** (Watch) — ceftriaxona, claritromicina,
  ciprofloxacino, vancomicina, piperacilina+tazobactam.

Eso cierra de una sola vez **dos** ítems:

- **Guía 1.13 (MAYOR)** — «¿Se dispone del listado de antibióticos que maneja el
  servicio farmacéutico e **incluye la clasificación AWaRe** recomendada por OMS
  (Reserva, Vigilancia y Acceso) para cada antibiótico?» → hoy **no existe** en
  ningún lado del portal.
- **3.3 / 3.4** — el criterio de qué entra al libro deja de ser una opinión y
  pasa a ser el listado del regulador.

**La corrección propuesta:** una tabla `antibioticos_oficiales` (principio
activo, código ATC, grupo AWaRe) sembrada del LOM 2025, y `es_antibiotico`
derivado del **principio activo** del producto contra esa tabla — no una casilla
en el ERP. Con revisión humana para lo que no matchea, que es donde el dato
sucio se ve.

### Y el principio activo tampoco está

**Guía 3.5** pide que el registro incluya la **denominación genérica**. De los 79
productos marcados hoy, **sólo 18 tienen `principio_activo` cargado**. Los otros
61 son marcas (AXTAR, DENVAR, KOPTIN, ZIBAC…) y el libro no puede decir qué
principio activo se dispensó — que además es la llave para derivar AWaRe.

---

## 3 · Hallazgo CRÍTICO 2 — cero renglones completos en 63 días

**Guía 3.14 (CRÍTICO)** · «¿La dispensación de antibióticos se realiza solamente
si se presenta una receta, orden o prescripción médica?»
**Guía 3.12 (MAYOR)** · copia de la receta resguardada **al menos 1 año**.
**Guía 3.9 / 3.10 / 3.11 / 3.13** · datos del paciente y del prescriptor.
**RTS 6.4.4** · «Deberá quedar una copia física o digital de la receta como
registro en el establecimiento.»

414 de 421 renglones dicen «Sin completar». **0 recetas, 0 médicos, 0 fotos.**

El portal no es el culpable: el formulario existe, la búsqueda en el registro
del CSSP existe, la foto se sube a un bucket privado, el permiso está dado —
`puedeCompletar` sale de `bitacoras.can_edit`, que lo tienen los 21 Dependientes
de Farmacia, los 6 Jefes de Sala y los 7 Regentes de Enfermería. **Lo que no
existe es la rutina.**

Y hay dos cosas del diseño que la esconden:

1. **El widget de Inicio sólo mira 30 días atrás** (`DIAS_ATRAS = 30` en
   `WidgetRecetasPendientes.jsx`). Los 259 renglones de julio ya salieron de esa
   ventana: son invisibles y no van a volver. Un pendiente que envejece
   desaparece en vez de escalar — al revés de lo que debería.
2. **Nada escala, y ya se cobró su primera víctima.** No hay aviso al jefe de
   sala ni al regente por antigüedad, y el cierre de mes **no exige** que el
   libro esté completo: `cerrar_mes_bitacora` no menciona
   `bitacora_dispensaciones` ni una vez. Pero `completar_dispensacion` **sí**
   rechaza escribir en un mes cerrado.

   Las dos mitades juntas hacen esto — medido hoy, no hipotético:

   > **La Popular cerró agosto el 3-sep a las 16:23 con 39 renglones
   > pendientes.** Esos 39 ya no se pueden completar: hay que reabrir el mes,
   > lo que deja su propia fila de reapertura con motivo en la bitácora de
   > cierres.

   O sea que la única puerta que podía exigir el libro completo es justamente
   la que lo sella incompleto.

**Sin esto, el libro no prueba lo que la norma le pide probar.** Con paciente,
médico y foto vacíos, el renglón demuestra que *se vendió* un antibiótico —
nunca que se vendió *contra receta*. Un inspector lee ese libro como la
confesión escrita de 414 dispensaciones sin receta.

---

## 4 · Lo que sí está bien, y conviene no romper

| ítem | cómo se cumple |
|---|---|
| **3.5** — lote, fecha de expiración, fecha y cantidad dispensada, laboratorio, presentación | 421/421 completos, tomados de la venta. No se teclean |
| **3.5** — nombre de quien realizó | `vendedor_nombre` en 420/421; `completada_por` al completar |
| **3.7 espejo / 3.6** — control de correcciones | anular deja el renglón con motivo y firma; **nunca se borra** |
| **3.17 / 3.21** — cantidad dispensada y **pendiente**, con correlativo | `prescrito` / `entregado_total` por renglón, y el folio `2026-00007` |
| **3.19** — pendientes por agotamiento | `motivo_pendiente` en la receta, y la receta queda `abierta` |
| **3.6** — nivel de acceso | RLS en las 7 tablas, escritura sólo por RPC, `bitacora_exigir_acceso` en cada lectura |
| **6.1.14** — contemporáneo | la hora sale de la base contra El Salvador, nunca del navegador |
| **6.1.14** — preferencia por el papel | el mes sale impreso, acostado, con formulario `FLS-BIT-03` |
| **3.12** — resguardo de la copia | bucket `recetas` **privado**, mime restringido, 10 MB |
| — | ningún cron purga las bitácoras: el dato primario no se pierde |

Y una decisión que vale la pena repetir: **el médico sólo se puede tomar del
registro del Consejo**, nunca escribirse a mano. Eso es lo que hace que el dato
del prescriptor (3.13) sea verificable en vez de decorativo.

---

## 5 · Lo demás que apareció midiendo

### 5.1 · El folio no es cronológico — 6 costuras, una por sala

Un libro foliado promete que el folio sube con el tiempo. Hoy, en cada sala, hay
**un salto**: el folio 21 es del 16-ago y el 22 es del 3-jul.

| sala | folio | fecha | folio anterior | su fecha |
|---|---|---|---|---|
| La Popular | 2026-00022 | 3-jul | 2026-00021 | 16-ago |
| Salud 1 | 2026-00035 | 3-jul | 2026-00034 | 16-ago |
| Salud 2 | 2026-00013 | 3-jul | 2026-00012 | 16-ago |
| Salud 3 | 2026-00019 | 3-jul | 2026-00018 | 16-ago |
| Salud 4 | 2026-00012 | 6-jul | 2026-00011 | 15-ago |
| Salud 5 | 2026-00008 | 3-jul | 2026-00007 | 13-ago |

Es un artefacto de los DOS backfills del 17-ago (primero agosto, después julio),
no un defecto vivo: el sync ordena por fecha. **No se arregla renumerando** —un
libro foliado no se renumera—: se explica con una nota de apertura firmada por el
regente, que es lo que se hace con un libro de papel al que se le corrió el
orden.

**Lo que sí queda latente:** el folio se toma en el momento del *sync*, no de la
venta. Una factura que llegue tarde recibe un folio posterior a ventas más
nuevas. En tres semanas de operación viva no pasó ni una vez, pero va a pasar.

### 5.2 · 50 renglones (12%) traen dos lotes en un solo campo

`lote = '2412183_2411613'` con **una sola** `fecha_vencimiento`. El ítem 3.5 pide
lote y expiración *de lo dispensado*; con dos lotes fundidos, el libro no puede
decir cuál se llevó el paciente, y 3.4 (cuadrar existencias por lote) no cierra.

Y de ahí sale el segundo síntoma: **2 renglones muestran un lote vencido al
momento de vender** (ROCEFORT 1 GR IV, vence 1-mar-2026, despachado el 3-ago y el
25-ago). O se dispensó producto vencido —**RTS 6.6.6**, grave— o el libro está
mostrando el vencimiento del lote equivocado. Las dos posibilidades hay que
cerrarlas; hoy la fila sólo se pinta en rojo y nadie la persigue.

### 5.3 · Faltan los dos primeros días de julio

23 ventas bajo receta del **1 y 2 de julio** nunca entraron: el backfill empezó
el 3. Se cierra con una corrida:
`select sincronizar_bitacora_dispensaciones('2026-07-01','2026-07-02', null);`

**Y hay un techo detrás:** el repaso diario mira **45 días**. Lo que llegue más
tarde que eso no entra nunca, y no da error — es el hueco silencioso de siempre.

### 5.4 · El respaldo llega al renglón y no a la receta

Se corrigió hoy (v2.967.5) que las 7 tablas `bitacora_*` entren a
`backup-critical-tables`. **Pero `recetas`, `receta_items` y `medicos` NO
entraron**, y ahí viven el paciente, el prescriptor y la URL de la foto — la
mitad exacta que le importa a 3.5 y 3.12. Respaldar el renglón sin la receta
respalda la parte que se puede reconstruir del ERP y deja fuera la que no.

Dos cosas más del mismo párrafo:

- El bucket `recetas` **no se respalda** (Storage no entra en ese cron), y 3.12
  pide la copia de la receta ≥1 año.
- `RETENTION_DAYS = 60`. Como respaldo está bien; **como control declarado en el
  protocolo del 6.1.15, 60 días no es un año**. Hay que decir en el documento
  que la retención la da la base (nada la purga) y el respaldo es una ventana
  rodante de 60 días.
- La corrección es de **hoy** y el cron corre los domingos: la última corrida fue
  el **30-ago**. O sea que a esta hora las bitácoras **todavía no tienen ni un
  respaldo hecho**. Declarado ≠ demostrado, hasta el 6-sep.

### 5.5 · Un permiso que promete una distinción que el código no honra

`bitacoras_tab_libro.can_edit` está otorgado a 3 roles y **nunca se lee**: el
botón «Completar» y el RPC miran `bitacoras.can_edit`. La grilla de permisos
muestra un candado que no cierra nada.

### 5.6 · No hay rol Regente con una persona adentro

El rol **`Regente`** existe y tiene todos los permisos… y **0 empleados**.
`Regente de Enfermería` (7 personas) es otra cosa. El regente farmacéutico es
quien firma los procedimientos (**6.1.12**, Guía 1.12 MAYOR), quien cierra el
mes, y cuya presencia se verifica con la bitácora de visitas (**6.3.7**). Hoy no
tiene cuenta en el portal.

### 5.7 · El libro no se puede exportar desde su pestaña

No hay botón de imprimir ni de descargar en «Bajo receta»: sale sólo dentro del
mes completo, desde Cierre. Un inspector que pide «el libro de antibióticos de
agosto» obliga a cambiar de pestaña y a llevarse las hojas de temperatura y
limpieza pegadas. Y cuando se agregue la salida, va por `exportCsv` **con su
módulo** para que quede el egreso anotado (`registrar_egreso`).

---

## 6 · Sección 4 de la Guía — estupefacientes y psicotrópicos: no existe

Aparte del libro de antibióticos, la Guía tiene una sección propia con **tres
ítems CRÍTICOS**:

> **4.1** (CRÍTICO) recepción, registro, almacenamiento, manejo y control
> verificados por el regente · **4.2** (CRÍTICO) sistema de control **trazable y
> aprobado por la DNM** · **4.3** (CRÍTICO) área restringida bajo llave ·
> **4.4** (MAYOR) facturas que amparen la adquisición.
>
> **RTS 6.5.2** — «Debe implementarse el sistema de control para medicamentos
> estupefacientes o psicotrópicos **facilitado por la Autoridad Reguladora**.»

El catálogo tiene producto de esa familia y **ninguno está marcado**:
carbamazepina, pregabalina (7 presentaciones), quetiapina, risperidona,
sertralina, amitriptilina y **tramadol en 8 presentaciones** — todos con
`es_antibiotico = false`, o sea invisibles para el libro.

**Ojo con la conclusión:** eso **no** es un defecto del libro de antibióticos —
no van ahí. Es que la sección 4 no tiene módulo, y su sistema de control lo
**facilita la DNM**, no se construye. La acción es averiguar con la DNM cuál es
ese sistema y cuáles de estos productos están en el listado de control, antes de
escribir una línea de código.

---

## 7 · Cómo se vuelve válido ante la SRS — en orden de riesgo

**A. Cerrar los dos CRÍTICOS.**

1. **La lista.** Tabla `antibioticos_oficiales` sembrada del LOM 2025 (J01 + su
   grupo AWaRe), `principio_activo` cargado en los 79 + los que entren, y
   `es_antibiotico` derivado contra esa tabla en vez de escrito a mano. Después,
   **re-sincronizar desde el 1-jul** para que el libro tenga los 1,827 renglones
   que le faltan. Deja además resuelto el ítem 1.13.
2. **La rutina.** Que completar el renglón sea parte de la venta, no una tarea de
   después: el widget con ventana abierta (no 30 días), aviso al jefe de sala por
   antigüedad, y **el cierre de mes bloqueado si quedan renglones pendientes** —
   que es el único freno que no depende de que alguien se acuerde.

**B. Los dos documentos que firma el regente** (ya descritos en
`docs/BITACORAS-SOLO-DIGITAL-QUE-PIDE-LA-SRS-2026-09-03.md`): el procedimiento
de documentación digital (6.1.14) y el protocolo de supervisión del sistema
electrónico (6.1.15 / Guía 3.6). Sin ellos, **llevar el libro en digital no está
autorizado**, por bien construido que esté. Y hay que darle cuenta al regente
antes, porque los firma él.

**C. El procedimiento del 6.4.1 / Guía 3.1** — adquisición, suministro,
dispensación, devolución y disposición final de antibióticos. Es papel, y es
MAYOR.

**D. Lo medido acá**: los dos días de julio, la receta en el respaldo, el bucket
de recetas, los 50 lotes fundidos, los 2 vencidos, el permiso muerto, la cuenta
del regente, la salida del libro.

**E. Sección 4** (estupefacientes y psicotrópicos): consultar a la DNM cuál es su
sistema. Tres CRÍTICOS sin cubrir.

---

## 8 · Lo que esta auditoría NO pudo ver

- **La pantalla.** La extensión de Chrome no estaba conectada; no se abrió
  `/bitacoras?tab=libro` en el navegador. Falta el barrido visual y el de
  teléfono (`gate:movil` + `barrido-total-movil` sobre esa ruta).
- **Si la lista de 79 es completa hacia adentro**: se midió contra un patrón de
  nombres de principio activo. Un antibiótico cuyo nombre comercial no nombre su
  principio activo y no esté marcado **no lo detecta ni esta auditoría** — que es
  exactamente el motivo por el que la lista tiene que salir del LOM y del
  `principio_activo`, y no de leer nombres.

---

**Fuentes** · `docs/legal/rts_11020424_bpadyt.txt` (RTS 11.02.04:24 §6) ·
`docs/legal/srs_guia_verificacion_bpad.txt` (Guía de Verificación BPAD, SRS,
verificada vigente hoy) · Listado Oficial de Medicamentos 2025 (SRS) ·
Ley de Medicamentos Art. 19.
**Ver también** · `docs/AUDITORIA-BITACORAS-SRS-2026-08-25.md` (ambiente y
limpieza) · `docs/BITACORAS-SOLO-DIGITAL-QUE-PIDE-LA-SRS-2026-09-03.md`.
