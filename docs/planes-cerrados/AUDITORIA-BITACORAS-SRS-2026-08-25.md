# Bitácoras contra la SRS y el RTS — qué cubre el portal y qué falta

**Fecha:** 25 de agosto de 2026 · **Versión del portal:** v2.766.6

Cruce ítem por ítem de los dos documentos que rigen la inspección contra lo que
el portal registra hoy. No sale de memoria: los dos se leyeron completos y cada
afirmación de acá cita el ítem que la respalda.

**Las fuentes** (las dos en `docs/legal/`, con su `.txt` al lado):

| Documento | Qué es |
|---|---|
| **RTS 11.02.04:24** (osartec.gob.sv) | El reglamento técnico. Pone los números y los plazos |
| **Guía de Verificación de BPAD** (srs.gob.sv) | La lista con la que el inspector camina la sala, cada ítem con su peso: CRÍTICO / MAYOR / MENOR |

**Un recorte que cambia todo y conviene tener presente antes de leer nada más:**
el RTS tiene dos secciones y **sólo una nos aplica**.

- La **sección 5** es «para laboratorios, droguerías y centros de
  almacenamiento».
- La **sección 6** es «para farmacias, botiquines y otros establecimientos que
  dispensan productos regulados» — la nuestra.

Confundirlas hace pedir cosas que a una farmacia no se le exigen. Pasó en esta
misma sesión: el portal pedía certificado de calibración para el termómetro de
la sala y de la bodega, y ese requisito (5.6.14) vive en la sección 5. Para una
farmacia, la calibración se exige **en un solo lugar**: el refrigerador.

---

## 1 · Lo que el portal ya cubre

| Ítem | Peso | Qué exige | Dónde vive |
|---|---|---|---|
| **Guía 2.27** · RTS 6.2.16 | CRÍTICO | Registros de temperatura **al menos dos veces al día**, una a media mañana y otra a media tarde | Registro diario. El portal pide **tres** franjas, una más de la exigida |
| **Guía 2.33** · RTS 6.2.20 | CRÍTICO | Temperatura del refrigerador **dos veces al día**, entre 2 y 8 °C | Registro diario, cuando la sucursal enciende el refrigerador |
| **Guía 2.32** · RTS 6.2.19 | CRÍTICO | Refrigerador con **termómetro calibrado** | Configuración → tarjeta del refrigerador: instrumento, última calibración y vencimiento. La fecha se pide **antes** de encenderlo |
| **Guía 2.34** · RTS 6.2.21 | MAYOR | Fecha y **persona** que realiza la lectura | Cada registro guarda quién y a qué hora; la grilla lo muestra con su foto y su nombre |
| **Guía 2.26** · RTS 6.2.15 | CRÍTICO | Temperatura **no mayor a 30 °C** en sala de ventas y bodega | Es el rango que traen esas áreas; fuera de rango exige anotar la acción correctiva |
| **Guía 1.11 / 1.12** · RTS 6.1.11 / 6.1.12 | MAYOR | Procedimiento escrito de limpieza y mantenimiento «aplicable a las áreas **y mobiliario**», autorizado por el regente | El procedimiento es papel del regente; su **registro** es el turno de limpieza por área, con el detalle mueble por mueble cuando la sala lo configura |
| **RTS 5.5.5** | — | Programas de limpieza «con sus respectivos registros» | Ídem |
| **Guía 3.12** | MAYOR | Copia de la receta resguardada **al menos 1 año** | Foto de la receta en bucket privado, ligada al folio |
| **Guía 3.17 / 3.21** | MAYOR / MENOR | Cantidad dispensada y **pendiente**, con correlativo | El folio del libro y el estado de la receta (parcial / completa) |
| **RTS 6.1.14** | — | Registro digital **atribuible, legible, contemporáneo, original y preciso** | El estado de cada franja lo calcula la base contra la hora de El Salvador, nunca el reloj del navegador; corregir agrega y no pisa; todo registro lleva su firma |
| **RTS 6.2.16** | — | Conservar **dos años** los registros de temperatura y humedad | Verificado el 25-ago: los únicos crons de purga son de carnés temporales, cola de impresión y sesiones. **Ninguno toca las bitácoras** |

---

## 2 · Lo que falta

### CRÍTICO

**Registro trazable de antibióticos — guía 3.3 y 3.4.**

> 3.3 · ¿Se lleva un registro trazable de los antibióticos que se manejan y
> dispensan en el establecimiento? **CRÍTICO**
>
> 3.4 · ¿Las existencias físicas de antibióticos concuerdan con las detalladas
> en el registro electrónico o físico? **CRÍTICO**

El portal registra la **salida**: el libro bajo receta, con folio, lote,
vencimiento, paciente y médico. Lo que no existe es el registro completo que
pide el 3.5 — entrada/adquisición con fecha y cantidad, denominación genérica,
presentación, forma farmacéutica, laboratorio, lote, vencimiento, salida,
cantidad dispensada, **devuelta y destruida**, y el nombre de quien hizo cada
movimiento.

Los datos existen repartidos (compras, inventario con lote, ventas). Lo que no
existe es **el registro que se le pone enfrente al inspector**, y el 3.4 pide
además que las existencias cuadren contra él.

### MAYOR

| Ítem | Qué falta | ¿Software o papel? |
|---|---|---|
| **Guía 2.23** · RTS 6.3.7 | **Bitácora de visitas del regente**: fecha, horario de permanencia, descripción de actividades, firma y sello. Se conserva 1 año | Decisión tomada: **libro físico**. Es lo primero que pide el inspector cuando el regente no está presente. El cierre de mes sí está en el portal |
| **Guía 3.8** | **Disposición final** de antibióticos caducados o no conformes: fecha, cantidad, nombre genérico y comercial, forma farmacéutica, lote, vencimiento | Software |
| **Guía 3.2** | **Devoluciones de antibióticos** registradas por antibiótico | Software |
| **Guía 3.22** | **Farmacovigilancia**: procedimientos y registros de notificación de quejas o reacciones adversas a la DNM | Software + papel |
| **Guía 2.20** | **Registro de capacitación** del personal, incluyendo el examen del facilitador | Software |
| **Guía 2.35** · RTS 6.2.22 | **Control de plagas**: contrato o constancia de servicio del proveedor autorizado | Documento adjunto |
| **RTS 6.1.3** | Archivo de **autoinspecciones e inspecciones**, no menos de **tres años** | Software |
| **Guía 6.3** | Procedimiento escrito para el manejo de **medicamentos vencidos** | Papel (el área separada ya existe en Bodega) |
| **Guía 3.6** · RTS 6.1.15 | **Protocolo de supervisión del sistema electrónico**: nivel de acceso, resguardo de datos, forma de registro y evaluación periódica | Papel. El sistema ya cumple las cuatro cosas; falta el documento que las describe y que el regente firma |

---

## 3 · Lo que NO aplica

- **Secciones 7 y 8 de la guía** — medicamentos magistrales y oficinales, y
  dosis unitaria. Farmalasa dispensa, no prepara.
- **Toda la sección 5 del RTS** — laboratorios, droguerías y centros de
  almacenamiento. De ahí sale el 5.6.14 (certificado de calibración para todo
  instrumento de medición) y el 5.6.2 (mapeo de temperatura de 7 días), que no
  se le exigen a una farmacia.

> ⚠️ **El matiz que hay que decidir:** si la bodega central llegara a estar
> licenciada como *centro de almacenamiento* y no como parte de la farmacia, le
> aplicaría la sección 5 y **su termohigrómetro sí necesitaría certificado
> vigente**. Hoy el portal no le pide calibración a ningún área de ambiente.

---

## 4 · Decisiones de diseño y de dónde salen

Lo que sigue no es preferencia: cada una tiene su ítem detrás. Está acá para que
no se «corrija» en el futuro sin saber qué se rompe.

**El termómetro del ambiente no se calibra ni se declara.** La calibración
obligatoria es la del refrigerador (6.2.19 / guía 2.32, CRÍTICO). Para el
ambiente, la guía sólo pregunta si **hay** termómetro (2.13, CRÍTICO) y el RTS
pide que sea **independiente por área** (6.2.11). Ningún ítem pide identificarlo
por nombre — y medido antes de sacar el campo: **cero áreas tenían instrumento
guardado** en más de una semana de uso.

**El detalle de muebles en la limpieza es opcional.** Ni el RTS ni la guía piden
identificar qué vitrina se limpió. Lo que exigen es que el **procedimiento**
cubra las áreas y el mobiliario (6.1.11), que tenga sus registros (5.5.5) y que
el local **se vea limpio** (guía 2.11, CRÍTICO). De ahí sale la única regla que
gobierna el diseño: **el registro tiene que poder mostrar lo que el
procedimiento promete**. Si el escrito que firmó el regente nombra cuatro
vitrinas, «Vitrinas ✓» no alcanza cuando el inspector cruza los dos papeles; si
dice «vitrinas», la casilla por área es exactamente lo que corresponde.

**«11 de 26» va en neutro, nunca en rojo.** No hay ítem que obligue a pasar por
todos los muebles en cada turno. Pintarlo de rojo convertía un dato en una
acusación, y una alarma que se dispara por lo normal se aprende a ignorar.

**Lo que no se marcó se escribe como «no hecho», no se omite.** El registro lo
arma la base cruzando lo que llega contra la lista del área. Si se copiara lo
que manda el navegador, «no se limpió» y «no se mandó» serían el mismo dato — y
ésa es justo la diferencia que busca un inspector.

**El estado de cada franja lo decide la base, contra la hora de El Salvador.**
Con el reloj del navegador, un equipo con la hora corrida vería abierta una
franja vencida y anotaría «a tiempo» algo que no lo está. El 6.1.14 pide que el
registro sea **contemporáneo**, y eso no se puede verificar con un reloj que
cada quien tiene distinto.

**La limpieza se corrige y se quita, siempre con motivo.** Un libro que no se
puede corregir termina diciendo algo falso, que es peor que un hueco. Quitar
borra la fila —el hueco vuelve solo— y el motivo queda en `audit_logs`.

**Los rótulos de los momentos son fijos.** Mañana, Mediodía y Tarde son los que
nombra el 6.2.16; Mañana y Tarde, los de la limpieza. Editables, cada sucursal
los llamaría distinto y el mes impreso de siete salas saldría con siete juegos
de encabezados. Lo que sí cambia por local es el **reloj**, y por eso los
horarios se configuran por sucursal.

---

## 5 · Por dónde seguir, ordenado por riesgo

1. **Registro trazable de antibióticos** (3.3 y 3.4, los dos CRÍTICOS).
2. **Bitácora de visitas del regente** (2.23) — hoy en papel; el ítem se
   verifica en toda inspección donde el regente no esté presente.
3. **Disposición final de vencidos y no conformes** (3.8).

Los demás son documentos que se adjuntan más que módulos que se construyen.

---

**Ver también:** `docs/PLAN-BITACORAS-SRS-2026-08-16.md` (la definición
original del módulo) y el `CHANGELOG.md` desde v2.758.0, donde está el detalle
de cada decisión de esta tanda con su medición al lado.
