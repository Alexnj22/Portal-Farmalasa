# Bitácoras SRS — definición del módulo (2026-08-16)

Las cuatro bitácoras que la Superintendencia de Regulación Sanitaria exige en
cada sala, y la quinta que exige y no estaba en la lista.

**Todo lo que dice este documento sobre la norma sale de dos fuentes leídas
enteras, no de memoria**: la [Guía de Verificación de BPAD de Establecimientos
que Dispensan Medicamentos](https://www.srs.gob.sv/wp-content/uploads/2025/10/Guia-de-Verificacion-de-Buenas-Practicas-de-Almacenamiento-y-Dispensacion-de-Establecimientos-que-Dispensan-Medicamentos.pdf)
—que es literalmente la lista con la que el inspector camina la sala, con cada
ítem marcado CRÍTICO / MAYOR / MENOR— y el [Reglamento Técnico Salvadoreño RTS
11.02.04:24](https://osartec.gob.sv/wp-content/uploads/download-manager-files/RTS-BPADyT_-18122024-1.pdf),
que es el que dice los números. Cada exigencia va con su número de ítem para que
se pueda volver a la fuente sin creerme.

Es la regla del proyecto aplicada a una norma en vez de a un reporte: **la lista
de columnas sale del encabezado del documento destino, no de lo que a uno se le
ocurre chequear.**

---

## 1 · Lo que la norma pide, ítem por ítem

### 1.1 · Temperatura y humedad

| | exigencia | fuente |
|---|---|---|
| frecuencia | **al menos dos veces al día**, «una a mediados de la mañana y otra a mediados de la tarde» | RTS 6.2.16 · guía 2.27 (CRÍTICO) |
| dónde | **instrumento independiente para bodega y para sala de ventas**, en un área representativa | RTS 6.2.11 |
| qué se anota | «fecha, hora y **persona** que realiza la lectura» | RTS 6.2.21 · guía 2.34 |
| límite | temperatura **no mayor a 30 °C** en sala de venta y bodega | RTS 6.2.15 · guía 2.26 (CRÍTICO) |
| humedad | se registra, pero **«el registro del parámetro de humedad relativa será informativo»** | RTS 6.2.16 |
| resguardo | **2 años** los registros; **3 años** los de áreas de almacenamiento | RTS 6.2.16 · 5.6.3 |
| desvíos | «se deben **investigar** las desviaciones de los parámetros ambientales y el impacto en la estabilidad, tomando las medidas correctivas» | RTS 5.6.5 |

Ese último renglón es el que casi siempre se olvida y es el que convierte la
bitácora en algo más que una planilla: **una lectura fuera de rango obliga a
escribir qué se hizo.** Un 32 °C sin nota al lado es peor que no tener bitácora,
porque prueba que se vio y no se actuó.

Vos dijiste tres lecturas al día. La norma pide dos. Tres cumple de sobra y lo
dejo como el valor por defecto, pero **configurable por sucursal**: el día que
sean dos, se cambia el número, no el código.

### 1.2 · Refrigerador

| | exigencia | fuente |
|---|---|---|
| frecuencia | **dos veces al día** | RTS 6.2.20 · guía 2.33 (CRÍTICO) |
| rango | **2 °C a 8 °C**, «o según se declare en el empaque» | RTS 6.2.20 |
| equipo | termómetro **calibrado**, refrigerador de **uso exclusivo** para medicamentos, limpio y ordenado | RTS 6.2.18/6.2.19 · guía 2.29-2.32 |

**La palabra «biotecnológico» no aparece en ninguno de los dos documentos.** Lo
busqué. Lo que la norma regula es la **cadena de frío**: si hay un producto que
se conserva de 2 a 8 °C, hay bitácora de refrigerador. Los biotecnológicos caen
ahí porque casi todos son termolábiles, no por ser biotecnológicos. Así que el
disparador correcto no es «¿manejamos biotecnológicos?» sino **«¿hay
refrigerador con medicamento adentro?»** — y eso ya es sí, en Bodega.

### 1.3 · Limpieza y orden

La norma **no fija una frecuencia**. Lo que exige es que exista procedimiento
escrito **con sus respectivos registros** (RTS 5.5.5, guía 1.11 MAYOR), que los
procedimientos estén **autorizados por el regente** (guía 1.12) y que el
establecimiento «se observe limpio y en condiciones adecuadas» (guía 2.11,
CRÍTICO). Las dos veces al día son el procedimiento de ustedes, y está bien que
sea así: **la frecuencia la pone la farmacia, la norma exige que se cumpla la
que se puso por escrito.**

Consecuencia de diseño: la frecuencia es un dato configurable, no una constante
en el código, y la bitácora tiene que poder mostrar **el procedimiento vigente
al lado del registro** — porque lo que el inspector cruza es una cosa contra la
otra.

### 1.4 · Dispensación bajo receta

Es la sección más larga de la guía (3.1 a 3.22) y la que tiene más ítems
CRÍTICOS. Lo que el registro debe contener, textual del ítem 3.5:

> «¿El registro físico o electrónico incluye información relacionada con la
> fecha de entrada/adquisición, cantidad adquirida, denominación genérica,
> presentación, forma farmacéutica, laboratorio farmacéutico, número de lote,
> fecha de expiración, fecha de salida/dispensación, cantidad dispensada,
> devuelta y destruida del antibiótico, así como, **nombre, firma y sello de
> quien realizó tales actividades**?»

Y sobre parcial contra total, que es tu pregunta central — ítems 3.16 a 3.21 y
RTS 6.4.4:

> «Cada vez que se dispensa antibióticos, se registra en la receta, orden o
> prescripción médica **la cantidad dispensada y la cantidad pendiente de ser
> dispensada (si aplica)**.» (3.17)
>
> «Al momento de **finalizar la entrega total** con la cantidad de antibiótico
> prescrito, se retiene una copia de la receta.» (3.20)
>
> «En caso de haber retenido la copia de la receta médica **por agotamiento de
> inventario**, esta cuenta con un **número consecutivo asignado** y está
> registrado para su gestión.» (3.21)

Tres cosas más que la norma pide y conviene tener anotadas desde ahora:

- **Registros electrónicos tienen requisito propio** (3.6, MAYOR): protocolo de
  supervisión del sistema que incluya *nivel de acceso, resguardo de datos,
  forma de registro y evaluación periódica*. O sea: elegir el camino digital
  agrega una obligación —documentar quién puede escribir qué y cómo se
  respalda— que el libro de papel no tiene. Es exactamente lo que dan los
  permisos por módulo y la bitácora de auditoría que el portal ya lleva, pero
  **hay que escribirlo en un procedimiento**, no basta con que el software lo
  haga.
- **Resguardo mínimo 1 año** de la copia de receta y del registro (3.12, RTS
  6.4.5). Un año es el piso legal; no hay razón para borrar nunca.
- **Listado de antibióticos con clasificación AWaRe de la OMS** —Acceso,
  Vigilancia, Reserva— para cada antibiótico (guía 1.13, MAYOR). Esto es un
  requisito de catálogo, no de bitácora, y hoy no existe. Ver §7.

### 1.5 · La quinta bitácora, que no estaba en la lista

**La bitácora del regente.** RTS 6.3.7 y guía 2.23 (MAYOR):

> «La presencia del regente en el establecimiento debe ser verificable mediante
> registro conforme a su horario de asistencia, el registro debe contener como
> mínimo: **fecha de visita, horario de permanencia, breve descripción de las
> actividades ejecutadas** durante ese tiempo (por ejemplo, revisión de
> productos estupefacientes y psicotrópicos, **revisión de recetas de
> antibióticos**, verificación de elementos de este reglamento, capacitación…),
> **firma y sello**. […] Se debe conservar el registro por un periodo de al
> menos 1 año.»

Y el ítem 2.23 de la guía dice, entre paréntesis, cómo se verifica cuando el
regente no está presente durante la visita: **«verificar bitácora de visitas»**.
O sea que el inspector la va a pedir sí o sí, y si el regente no estaba ese día,
esa bitácora es la única defensa.

Va en el módulo. Es la más barata de las cinco y es la que se le pide al
inspector primero.

---

## 2 · Lo que el portal ya tiene — medido hoy, no supuesto

Esto es lo que cambia el tamaño del trabajo, así que lo medí antes de diseñar.

**La venta ya trae todo lo del producto.** Sobre los últimos 90 días:

| | |
|---|---|
| líneas bajo receta | **691** |
| facturas | **632** |
| con lote | **691 / 691** |
| con fecha de vencimiento | **691 / 691** |
| con cliente ligado a su ficha | **691 / 691** |
| con vendedor identificado | **691 / 691** |

Cien por ciento en las cuatro columnas. **Lote, vencimiento, cantidad,
producto, fecha, hora, sucursal y vendedor no hay que capturarlos: ya están.**
De la lista del ítem 3.5, lo único que falta es el laboratorio (está en el
catálogo, se une) y la forma farmacéutica.

**Y el volumen es bajísimo:**

| sucursal | facturas/90d | por día | pico en un día |
|---|---|---|---|
| La Popular | 146 | 1.62 | 5 |
| Salud 1 | 139 | 1.54 | 5 |
| Salud 3 | 138 | 1.53 | 6 |
| Salud 2 | 95 | 1.06 | 6 |
| Salud 4 | 68 | 0.76 | 4 |
| Salud 5 | 46 | 0.51 | 4 |

**Entre media y dos facturas por día por sala.** Eso es lo que decide que esto
sea viable: pedirle a la sala paciente, médico y foto de la receta una o dos
veces al día es una carga real; veinte veces al día no lo sería.

**El comprobante de venta ya se sabe bajar, y hoy no se está bajando.** Existe
la función `sync-sales-dte`, que baja el JSON y el PDF del documento por código
de generación y los archiva en el bucket `sales-dte`. Tiene **10 filas, todas
del 4 de agosto**: se probó una vez y nunca se programó. Lo verifiqué hoy contra
una factura bajo receta real del 16-ago: el JSON responde 5,397 bytes y el PDF
184,764 bytes empezando en `%PDF`. **Funciona.** Adjuntar el comprobante no es
código nuevo: es programarla.

**El catálogo tiene una trampa de nombre, y vos ya la sabías.** `es_antibiotico`
son 79 productos y **no significa antibiótico: significa bajo receta.** Lo
confirmé con tu ejemplo — `RANITIDINA 50MG AMPOLLA X 2 ML VIJOSA` tiene
`es_antibiotico = true`. La columna `requiere_receta` existe y está en **0 de
5,211**: nadie la llenó nunca, y no hay que llenarla — la que manda es la otra.

El proyecto ya venía tapando esto por el lado de la pantalla (la regla del
`CLAUDE.md` obliga a rotular el badge «Bajo Receta» y **nunca** «Abx»), pero
seguía siendo un nombre que miente. Es
[[feedback_nombre_de_columna_no_es_su_tipo]] otra vez: **el concepto no es el
nombre.** No propongo renombrarla —es una migración con riesgo y sin premio—,
propongo lo del §7: agregar el dato que hoy falta de verdad, que es cuáles de
esos 79 son antibióticos y de qué clase.

**El buscador del CSSP se puede consultar.** Lo probé: es JSF/PrimeFaces, hay
que traer el ViewState y mandar un POST, pero responde. Buscando el número 5000
en la Junta Médica devuelve nombre completo, N° de junta, junta y carrera.
**Trampa medida: la búsqueda por número es por coincidencia parcial** — el 5000
devolvió también el 15000 y el 25000. Hay que filtrar por igualdad exacta o se
guarda el médico equivocado.

---

## 3 · Las cinco bitácoras y dónde vive cada una

Un módulo, `bitacoras`, con pestañas. Las tres ambientales comparten toda su
maquinaria y se diferencian sólo por su configuración.

### 3.1 · Las áreas se configuran, no se cablean

Hay 8 sucursales pero no todas son un establecimiento que dispensa: seis salas
(La Popular, Salud 1 a 5), Bodega y Administración. Y no todas tienen las mismas
áreas — hoy el refrigerador está sólo en Bodega, y eso va a cambiar.

```
bitacora_areas
  branch_id      → branches
  tipo           'sala_ventas' | 'bodega' | 'refrigerador'
  activa         boolean
  lecturas_dia   smallint      -- 3 ambiente, 2 refrigerador
  franjas        jsonb         -- [{desde:'08:00', hasta:'10:00'}, …]
  limpiezas_dia  smallint
  temp_min/max   numeric       -- null/30 ambiente · 2/8 refrigerador
  hr_min/max     numeric       -- informativo (RTS 6.2.16)
  instrumento    text          -- identificación del termohigrómetro
  calibrado_hasta date         -- RTS 5.6.14 exige certificado vigente
```

Eso es el «selector o check para activarlo en las sucursales» que pediste, y de
paso resuelve tres cosas más: la frecuencia deja de ser una constante, cada área
lleva su propio rango, y **el certificado de calibración vencido se puede
avisar** — que es un ítem CRÍTICO que hoy nadie vigila.

Administración queda sin áreas: no dispensa.

### 3.2 · La lectura ambiental

```
bitacora_lecturas
  area_id, fecha, franja        -- únicos entre los tres: una lectura por franja
  temperatura, humedad
  registrado_por, registrado_at -- «fecha, hora y persona» (RTS 6.2.21)
  fuera_de_rango   boolean      -- calculado contra el área, no escrito a mano
  accion_correctiva text        -- OBLIGATORIO si fuera_de_rango (RTS 5.6.5)
```

Dos decisiones que valen más que el resto de la tabla:

**El hueco tiene que verse.** La fila no se crea al leer: las franjas del día se
conocen de antemano, así que lo que se pinta es la grilla completa y el hueco es
un hueco. Una bitácora que sólo muestra lo que se llenó no puede responder «¿nos
falta alguna?», que es justo lo que el inspector pregunta. Es lo mismo que
`docs/CORTES-DE-CAJA-COMO-FUNCIONA-2026-08-14.md` resolvió para los cortes.

**Fuera de rango exige escribir qué se hizo.** Sin la acción correctiva, la
lectura no se guarda. La norma no pide una lectura bonita, pide una lectura
honesta con su consecuencia (RTS 5.6.5).

**No se puede llenar el viernes toda la semana.** La lectura se anota en su
franja o queda tarde, y «tarde» se ve en la bitácora. Una franja vencida se
puede completar —la realidad es que a veces se olvida— pero queda marcada con la
hora real de captura al lado de la franja a la que corresponde. Un registro que
se puede fabricar hacia atrás sin dejar rastro no es un registro, y el ítem 3.6
pide exactamente eso: que el sistema diga cómo se registran los datos.

### 3.3 · La limpieza

Misma forma, menos columnas: `area_id, fecha, turno, realizada_por,
observaciones, foto_url?`. La foto es opcional y no la pide la norma; sirve
cuando el regente supervisa a distancia.

---

## 4 · La bitácora de dispensación

### 4.1 · Por qué parcial y total NO son una casilla en la venta

Esta es la decisión de fondo del módulo, y va contra la lectura intuitiva.

Si al vender se marca «parcial» o «total», el rótulo **miente el mismo día que
se escribe**. Una receta de 21 tabletas de la que hoy se entregan 10 es parcial;
cuando el paciente vuelve el jueves por las 11 restantes, esa segunda venta no
es «total» — es la que **cierra** una receta que estuvo parcial. Y la primera
venta sigue diciendo «parcial» para siempre aunque ya no falte nada. Con dos
casillas no hay forma de contestar «¿cuántas recetas tengo abiertas hoy?», que
es la única pregunta que importa para el ítem 3.19.

**Parcial y total no son propiedades de la venta: son el estado de la receta.**
Se derivan, no se escriben. Es la misma regla que el proyecto ya aprendió con
los catálogos — un rótulo no es una clave — aplicada a un estado.

Tres tablas:

```
recetas                                    -- la prescripción, una por papel
  correlativo        -- consecutivo POR SUCURSAL (ítem 3.21)
  branch_id, paciente_nombre, paciente_edad, paciente_documento
  medico_id → medicos
  fecha_prescripcion
  foto_url           -- la copia que la norma manda retener (RTS 6.4.4)
  estado             'abierta' | 'cerrada' | 'vencida'
  motivo_pendiente   'agotamiento_inventario' | 'decision_paciente' | null

receta_items                               -- lo que el médico prescribió
  receta_id, product_id, cantidad_prescrita, forma_farmaceutica

dispensaciones                             -- cada entrega, ligada a su venta
  receta_item_id
  sales_invoice_item_id  → la línea real de la factura
  cantidad, lote, fecha_vencimiento        -- copiados de la venta, no tecleados
  dispensado_por, dispensado_at
```

Y entonces:

```
pendiente = Σ cantidad_prescrita − Σ cantidad dispensada
estado    = pendiente > 0 → parcial (receta abierta)
            pendiente = 0 → total   (receta cerrada, se retiene la copia — 3.20)
```

El correlativo consecutivo por sucursal sale de acá gratis, y es literalmente lo
que pide el ítem 3.21.

### 4.2 · La sala completa, no captura

**El portal no controla la caja.** Las ventas llegan solas cada minuto. Así que
el flujo no puede ser «antes de vender, llene esto» — sería mentira, la venta ya
ocurrió. El flujo es el que ya funciona en «Facturas de mi Sala» y que la sala
ya entiende:

1. Entra una venta con una línea bajo receta → aparece en **Bitácora pendiente**
   de esa sala, con producto, cantidad, lote, vencimiento y vendedor ya puestos.
2. La sala abre el pendiente y agrega **sólo lo que el sistema no puede saber**:
   paciente, médico, foto de la receta, y a qué receta pertenece (una nueva, o
   una ya abierta del mismo paciente).
3. Al ligarla, el parcial/total se calcula solo.

Lo que se le pide a la persona son cuatro datos, una o dos veces al día.

**El paciente NO es el cliente de la factura, y no se puede asumir.** Lo medí:
entre las facturas bajo receta de los últimos 90 días el cliente más frecuente
es «CLIENTE FRECUENTE» (31 facturas), y hay «MAPFRE SEGURO EL SALVADOR, S.A.» y
«DIOCESIS DE CHALATENANGO». El nombre del cliente se ofrece como valor inicial
porque a menudo acierta, pero es un campo propio y editable. Copiarlo en
silencio llenaría la bitácora de pacientes llamados «Cliente Frecuente».

### 4.3 · Un plazo, y qué pasa si vence

Una venta bajo receta sin bitácora es un incumplimiento con criterio CRÍTICO
(ítem 3.3). Propongo: **el pendiente vence al cierre del día siguiente**; a
partir de ahí la sala lo ve en rojo, el regente lo ve en su tablero y queda en
el resumen del mes. No se bloquea nada —bloquear una venta que ya ocurrió no
tiene sentido— pero deja de ser invisible.

---

## 5 · El médico: catálogo propio, el CSSP como ayuda

Es lo que pediste y es lo correcto: **guardamos número de junta y nombre.**

```
medicos
  numero_junta   text        -- único junto con junta
  junta          'P01'…'P07' -- Médica, Odontológica, …
  nombre, carrera
  origen         'cssp' | 'manual'
  verificado_at  timestamptz -- cuándo lo confirmó el CSSP
  agregado_por
```

El orden de resolución al escribir un número en la receta:

1. **Se busca en nuestra tabla.** Un médico que ya recetó una vez está ahí y no
   se consulta nada. Con el volumen medido, en pocas semanas la mayoría de las
   recetas van a caer acá.
2. **Si no está, se consulta el CSSP** por número y junta, en una función de
   servidor (no desde el navegador: es un sitio ajeno y hay que traer el
   ViewState). Si aparece, se guarda con `origen='cssp'` y se reusa para
   siempre. **Filtrando por igualdad exacta** — la búsqueda del CSSP es por
   coincidencia parcial y el 5000 devuelve también el 15000.
3. **Si no aparece, se agrega a mano** con `origen='manual'` y se guarda igual.

**Nada de esto traba el registro.** El CSSP es un sitio de gobierno: se cae, y
el día que cambie el formulario deja de responder. La bitácora se cierra igual,
porque lo que la norma exige (ítem 3.13, y es MENOR) es que *la receta* traiga
los datos del prescriptor — la receta que estamos fotografiando. La consulta al
CSSP es una comodidad y una verificación, no un requisito.

---

## 6 · Los dos adjuntos

**El comprobante de venta: automático, cero trabajo para la sala.** Ya está
resuelto (§2). Se programa `sync-sales-dte` para las facturas que entran a la
bitácora y el PDF queda en `sales-dte`, ligado por código de generación.

**La foto de la receta: bucket propio, privado.** No va a `inventario-evidencia`
ni a ningún bucket existente. Una receta trae nombre de paciente, diagnóstico
implícito y firma de un médico: es dato de salud de una persona identificada, y
merece su propio bucket con sus propias policies. Bucket `recetas`, privado,
límite de tamaño, `image/jpeg|png|webp` y `application/pdf`, agregado a
`PRIVATE_BUCKETS` de `src/utils/storageFiles.js` **en el mismo commit** — que es
el paso que ya se olvidó una vez con `inventario-evidencia`.

Quién la puede ver: la sala que dispensó, el regente y administración. Nadie
más, y eso lo decide la base con RLS, no la vista.

---

## 7 · Lo que falta en el catálogo (y no es bitácora)

El ítem 1.13 de la guía pide el **listado de antibióticos con su clasificación
AWaRe de la OMS** — Acceso, Vigilancia, Reserva. Hoy eso no se puede producir,
porque los 79 productos marcados son «bajo receta» y ahí adentro hay
antibióticos puros (AZITROMICINA, CEFTRIAXONA, LEVOFLOXACINA), combinaciones que
llevan antibiótico adentro (LANZOPRAL HELIPACK y METIOM son terapias para *H.
pylori*; VIGADEXA es moxifloxacino con dexametasona) y cosas que no lo son
(RANITIDINA, ESOPRASEK PLUS).

La salida más barata es **una sola columna nueva en el catálogo**:

```
products.clasificacion_aware  'Acceso' | 'Vigilancia' | 'Reserva' | null
```

No nula ⇒ es antibiótico, y ya trae su clase. Nula ⇒ bajo receta y no
antibiótico. **Un campo en vez de dos booleanos que pueden contradecirse** — y
la lista del ítem 1.13 pasa a ser una consulta en vez de un documento que
alguien mantiene aparte y se desactualiza.

Quién la llena: el regente, sobre 79 productos, una vez. No es un proyecto.

---

## 8 · Permisos, RLS y auditoría

Claves de módulo siguiendo la convención del proyecto:

```
bitacoras                      la vista
bitacoras_tab_ambiente         temperatura, humedad, limpieza
bitacoras_tab_refrigerador
bitacoras_tab_dispensacion     la bitácora bajo receta
bitacoras_tab_regente
bitacoras_configurar           áreas, franjas, rangos, calibración
bitacoras_descargar            los exportables para el inspector
dash_bitacoras_pendientes      el widget de sala
```

Y las reglas de la casa, que acá no son opcionales porque el ítem 3.6 las pide
por escrito:

- RLS en las cinco tablas. **La sala ve lo suyo**; el regente y administración
  ven todo. Nada de `USING (true)` ni `WITH CHECK (true)` — ni en los INSERT,
  que es por donde se colaron los dos casos de la auditoría del 30-jul.
- Toda llamada a `auth_*` dentro de una policy envuelta en `(SELECT …)`.
- Nada se borra. Corregir una lectura **agrega** una corrección con su motivo y
  su autor; el valor viejo queda. El ítem 3.7 pide «control de correcciones»
  para el libro de papel — el equivalente digital es que no haya UPDATE
  destructivo, y de paso es lo que hace defendible el registro.
- Todo pasa por `appendAuditLog`.
- **Retención: ninguna.** La norma pone pisos (1 año la receta, 2 años el
  ambiente, 3 años el almacenamiento); no hay techo y no hay razón para purgar.
  Es historial de negocio, como los precios.

---

## 9 · Por dónde empezar

**Fase 1 — las tres ambientales.** Configuración de áreas, la grilla con sus
huecos, la acción correctiva obligatoria, y el aviso al teléfono cuando una
franja está por vencerse. Es independiente de todo lo demás y ya deja a las seis
salas cumpliendo tres ítems CRÍTICOS.

**Fase 2 — la bitácora del regente.** Media tarde de trabajo y es lo primero que
pide el inspector cuando el regente no está.

**Fase 3 — dispensación.** Recetas, médicos, la cola de pendientes, la foto. Es
la fase grande.

**Fase 4 — los automatismos y el papel.** Programar el comprobante, la consulta
al CSSP, la clasificación AWaRe y los exportables con los que se atiende una
inspección.

---

## 10 · Lo que este módulo NO resuelve

Digo esto ahora para que no se descubra frente a un inspector:

- **El sello físico de la receta sigue siendo a mano.** El ítem 3.16 pide sellar
  y firmar el papel con «Entregado», la fecha y la cantidad. Eso es tinta sobre
  papel y ningún software lo reemplaza; la bitácora digital es el registro
  *además* del sello, no en vez de.
- **Que la cantidad prescrita concuerde con la duración del tratamiento** (ítem
  3.15, CRÍTICO) es un juicio de quien dispensa. El sistema puede mostrar lo
  prescrito y lo entregado; no puede opinar.
- **La calibración de los termómetros** (RTS 5.6.14) es un certificado que se
  compra. El portal puede avisar que venció; no puede calibrar nada.
- **Devoluciones y disposición final de antibióticos** (ítems 3.2 y 3.8) son
  registros exigidos que este plan no cubre. El portal ya tiene devoluciones y
  vencidos; hay que ver si se enganchan o si necesitan su propia bitácora.
- **El procedimiento escrito** que el ítem 3.6 exige para registros electrónicos
  —nivel de acceso, resguardo, forma de registro, evaluación periódica— es un
  documento que hay que redactar. El software lo cumple; alguien tiene que
  escribir que lo cumple.

---

## 11 · Lo que hace falta decidir

1. **Las franjas horarias exactas** de las tres lecturas y de las dos limpiezas,
   por área. Necesito los horarios reales de sala para que el aviso caiga cuando
   hay alguien.
2. **Quién es el regente** de cada sala y cuál es su horario de permanencia —
   sin eso la bitácora de visitas no tiene contra qué comparar.
3. **El plazo del pendiente de dispensación**: propuse el cierre del día
   siguiente. Es una decisión de operación, no técnica.
4. **Los rangos del ambiente.** La norma dice «no mayor a 30 °C» y no pone piso.
   ¿Se deja sólo el techo, o se define también un mínimo?
