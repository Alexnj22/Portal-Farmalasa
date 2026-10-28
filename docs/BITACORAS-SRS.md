# Bitácoras SRS — el módulo, su estado y lo que falta

**Vigente al 2026-10-28.** Reúne en un solo lugar lo que estaba repartido en
cuatro documentos (el diseño del 16-ago, los dos del 3-sep sobre «sólo digital»
y la auditoría de producción del 28-oct). **Cuando dos de ellos no coinciden,
manda la auditoría del 28-oct**, que midió octubre en producción; lo pendiente se
volvió a cotejar contra `CHANGELOG.md`, `supabase/migrations/` y `src/` el mismo
día.

> ⚠️ **La numeración del RTS es la del publicado, no la de los documentos
> viejos.** El RTS 11.02.04:24 que rige es el del **Diario Oficial del 8-oct-2025**
> (Tomo 449, N.º 189), en vigencia desde el **8-abr-2026**. Su §6.1 se renumeró
> respecto de la copia de consulta de 2024, que es la que citan los documentos
> de agosto y septiembre. Acá se usa siempre la oficial:
>
> | tema | consulta 2024 | **publicado 2025** |
> |---|---|---|
> | registro de visitas del regente | 6.3.7 | **6.1.3** |
> | supervisión del sistema electrónico | 6.1.15 | **6.1.4** |
> | archivo de inspecciones (3 años) | 6.1.3 | **6.1.5** |
> | procedimiento de limpieza y mantenimiento | 6.1.11 | **6.1.13** |
> | procedimientos firmados por el regente | 6.1.12 | **6.1.14** |
> | listado de antibióticos | 6.1.13 | **6.1.15** |
> | documentación digital (ALCOA) | 6.1.14 | **6.1.16** |
>
> La §6.2 (ambiente y refrigerador) no cambió. La §6.4 (antibióticos) se cita
> con los números de la consulta: el publicado es un escaneo sin texto y esa
> sección no se cotejó línea por línea. Tabla y fuentes en `docs/legal/README.md`.

> ⚠️ **Del RTS sólo nos obliga el §6** (farmacias y botiquines). El §5 es de
> laboratorios, droguerías y centros de almacenamiento. Citarlo ya costó dos
> veces: la calibración de los termómetros de ambiente (5.6.14) y la «acción
> correctiva» por desviaciones (5.6.5). Ninguna de las dos es exigencia nuestra.

---

## 1 · Qué es el módulo

`/bitacoras` lleva, por sala y **sólo en digital**, los registros que la SRS
revisa en una inspección: **temperatura y humedad** de sala de ventas y bodega
(tres franjas al día), **temperatura del refrigerador** (dos al día, donde hay
uno), **limpieza** por área y turno con el detalle de mobiliario, y el **libro
bajo receta** (antibióticos y, aparte, otros controlados), más el **cierre de
mes** que firma el regente y convierte el mes en un expediente imprimible. La
quinta bitácora, la de **inyecciones aplicadas**, vive en `/inyecciones` (pestaña
Bitácora) porque nació del cobro de la aplicación, pero se audita con las demás.
La bitácora de **visitas del regente** se decidió llevar en **libro físico**. La
norma permite lo digital (RTS **6.1.16**) con dos condiciones que no son
software: procedimientos escritos y firmados por el regente, y un sistema que
pruebe ALCOA. El portal cumple la segunda; la primera está en borrador.

---

## 2 · Estado en una pantalla

Medido sobre **octubre de 2026 en producción** (auditoría del 28-oct).

| bitácora | octubre | veredicto |
|---|---|---|
| **Temperatura y humedad**, salas y bodegas de sala | 81/81 lecturas por área (3 × 27 días), con hora y persona | ✅ cumple RTS 6.2.16 / 6.2.21 (Guía 2.27 CRÍTICO, 2.34). Dos humedades imposibles (0 % y 3 %): desde hoy la base las rechaza; las dos de octubre se arreglan con «Corregir» |
| **Temperatura**, Bodega central | 62 de 69 lecturas | ⚠️ faltan 7 en 23 días |
| **Refrigerador**, Bodega central | 42 lecturas, **las 42 en 8.0 °C exactos**; sin fecha de calibración | ❌ Guía 2.32 CRÍTICO (termómetro calibrado, RTS 6.2.19). 42 lecturas idénticas en el borde del rango no son creíbles como medición («preciso», RTS 6.1.16) |
| **Refrigerador**, salas | **no existe** | ❌ las 6 salas tienen eritropoyetina en existencia y varias tienen insulinas (2–8 °C). RTS 6.2.18–6.2.20, Guía 2.32/2.33 CRÍTICOS |
| **Limpieza** | 2 turnos por día en cada área, completos | ✅ el registro cumple. Falta el procedimiento firmado (RTS 6.1.13, Guía 1.11/1.12) — borrador E escrito el 28-oct |
| **Libro bajo receta** | 537 renglones, **0 completados**; 0 recetas, 0 médicos, 0 fotos, 0 acciones en `audit_logs` | ❌ nunca se usó. **Reiniciado limpio para el 1-nov** |
| **Inyecciones** | 945 aplicaciones; **618 (65 %) marcadas por Dependientes (472) o Jefes de Sala (146)**; dosis en 22 de 993, lote y vencimiento en ninguna | ❌ ver §3, ítems 14–16 |
| **Cierre de mes** | sólo La Popular cerró agosto; **septiembre y octubre no los cerró nadie** | ❌ el rol `Regente` tiene **0 personas** y desde el 3-sep sólo él puede cerrar |
| **Respaldo** | semanal, 35 tablas, último el 25-oct, sin errores | ✅ bitácoras, recetas, médicos y clases adentro. **Falta `inyeccion_aplicaciones`** |

**Lo aplicado el 28-oct** (v2.1357.13):

1. **El libro arranca limpio el 1-nov.** `branches.libro_receta_desde =
   2026-11-01` en las 6 salas; se borraron los 537 renglones de ago–oct (ninguno
   completado, ninguno con receta: quedan en el respaldo del 25-oct) y los folios
   volvieron a 0. El primer renglón real será el `2026-00001`. Octubre no se
   puede reconstruir: no se guardó ni una receta.
2. **Una lectura imposible no entra** — migración
   `20261028163232_bitacoras_una_lectura_imposible_no_entra`
   (`bitacora_validar_lectura`): temperatura fuera de −20…50 °C o humedad fuera
   de 10…100 % se rechaza al anotar y al corregir. El rango de **aviso** de cada
   área no cambió.

**Por qué el libro nunca se usó:** cero intentos. No falla nada; la sala no lo
llena. Si el 1-nov arranca igual, noviembre va a repetir octubre (ítem 6).

---

## 3 · Lo que falta

Una sola lista, sin repetir. Cada ítem dice qué norma lo pide y **quién lo
destraba**. «Usuario» es la decisión de la empresa; «regente» es el químico
farmacéutico que firma; «portal» es trabajo de código.

### Bloqueantes legales — sin esto el registro digital no está autorizado

1. **Nombrar al Regente en el portal.** El rol `Regente` existe con todos sus
   permisos y tiene 0 personas (no confundir con `Regente de Enfermería`, 7
   personas). Es quien firma los procedimientos y el único que puede cerrar el
   mes (`20260903215815_bitacoras_el_mes_lo_cierra_el_regente`). RTS **6.1.14**,
   Guía 1.12 MAYOR. *Destraba: usuario.*
2. **Firmar y sellar los procedimientos** de `docs/legal/procedimientos/`. Siguen
   en borrador; A y B desde el 3-sep (sus numerales ya se pasaron al RTS
   publicado el 28-oct), E desde el 28-oct. Cada uno tiene `[corchetes]` que sólo
   la empresa llena (códigos, fechas, nombre y JVPQF del regente, productos de
   limpieza). *Destraba: regente.*
   - **A** — manejo de documentación digital (RTS **6.1.16**);
   - **B** — protocolo de supervisión del sistema electrónico (RTS **6.1.4**, Guía
     3.6 MAYOR);
   - **C** — hoja de contingencia (la manda el A §4.7; una copia impresa en cada
     sala, junto al instrumento);
   - **E** — limpieza y mantenimiento de áreas y mobiliario (RTS **6.1.13**, Guía
     1.11 MAYOR).

   El **D** (solicitudes de datos personales) está en la misma carpeta pero no es
   de bitácoras: lo firma la empresa como responsable del tratamiento, no el
   regente.
3. **Cerrar septiembre y octubre** en las 6 salas, en cuanto exista el regente.
   El cierre acepta un mes imperfecto pero exige motivo escrito si quedan
   renglones del libro sin completar (§5.4). *Destraba: regente.*
4. **Refrigerador en cada sala que venda producto de frío.** Decidido el
   2026-10-28: **se compran** (uno de uso exclusivo por sala). Cuando llegue
   cada uno, se activa en Bitácoras → Configuración con su fecha de
   calibración, y desde ese día la sala anota 2×/día entre 2 y 8 °C. RTS 6.2.18
   (uso exclusivo), 6.2.19 (termómetro calibrado), 6.2.20; Guía 2.29–2.33, los
   de calibración y registro **CRÍTICOS**. Mientras no esté, el producto de frío
   de esa sala sigue siendo el hallazgo más pesado de una inspección.
   *Destraba: usuario (compra y certificado de calibración).*
5. **Calibración y revisión del refrigerador de Bodega.** Cargar la fecha de
   calibración (Configuración → Refrigerador); sin certificado, la Guía 2.32
   falla. Y revisar el termómetro: 42 lecturas en 8.0 °C significan aparato
   trabado o que se anota el límite en vez de leerlo — las dos cosas son
   hallazgo, y si es real el refrigerador está en el borde. *Destraba: usuario
   (certificado) y Bodega.*
6. **Capacitar a la sala en el libro y probar el circuito una vez en sala.** Cómo
   se completa un renglón con la receta en la mano: médico por JVPM, paciente,
   cantidad prescrita y foto, incluida la consulta al CSSP — que con la tabla de
   médicos vacía es el único camino para el primer médico de cada sala. Con
   registro de la capacitación (Guía 2.20). *Destraba: usuario + regente.*

### Procedimientos por escribir — los firma el regente

7. **Adquisición, suministro, dispensación, devolución y disposición final de
   antibióticos.** RTS 6.4.1, Guía 3.1 MAYOR. *Destraba: portal redacta el
   borrador, regente firma.*
8. **Manejo de medicamentos vencidos.** Guía 6.3. El área separada ya existe en
   Bodega; falta el escrito. *Ídem.*
9. **Farmacovigilancia**: procedimiento y registro de notificación de quejas y
   reacciones adversas. Guía 3.22 MAYOR. No hay nada en el portal. *Ídem.*

### Por construir en el portal — ordenado por riesgo

10. **Registro trazable de antibióticos.** Entradas, salidas, devoluciones y
    destrucción por lote, cuadrado contra existencias (Guía **3.3** y **3.4**, los
    dos **CRÍTICOS**; campos del 3.5). Hoy el libro registra sólo la **salida**.
    Los datos existen repartidos (compras, inventario por lote, ventas); falta el
    registro que se le pone enfrente al inspector. **Alcance: TODOS los
    antibióticos que se manejan**, no sólo los del libro — ver §4.4. *Destraba:
    portal.*
11. **Listado de antibióticos con su grupo AWaRe — construido el 2026-10-28,
    falta que el regente lo confirme.** Guía 1.13 MAYOR, RTS **6.1.15**. La
    tabla `antibioticos_aware` tiene el grupo por **molécula** (33 filas): del
    **LOM 2026** cap. J01 donde lo marca (`*(1)` Acceso, `*(2)` Precaución) y de
    la **OMS AWaRe 2023** donde no; cada fila dice de cuál salió. Secnidazol
    queda «sin clasificar». `get_listado_antibioticos()` la cruza con el
    catálogo: **104 productos activos** (29 de ellos en el libro). Se ve en
    **Bitácoras → Antibióticos** (una fila por molécula, con sus productos y
    botón Exportar). Falta: (a) que el regente confirme cada molécula —el botón
    «Confirmar» sólo lo tiene su cargo (`bitacoras_confirmar_aware`)— y (b) sacar del listado lo tópico u
    oftálmico que entró por el nombre (colirios de cloranfenicol, cremas de
    clindamicina) — el catálogo no tiene la vía. *Destraba: regente, después
    portal.*
12. **Disposición final** de antibióticos vencidos o no conformes: fecha,
    cantidad, nombre genérico y comercial, forma, lote, vencimiento. Guía 3.8.
    Va junto con las **devoluciones** por antibiótico (Guía 3.2). Puede
    engancharse a lo que el portal ya tiene de devoluciones y vencidos. *Destraba:
    portal.*
13. **Lote fundido y vencimiento en el libro.** En agosto, 12 % de los renglones
    traía dos lotes en un campo (`2412183_2411613`) con un solo vencimiento, y dos
    mostraban lote vencido al vender (ROCEFORT, RTS 6.6.6). Con datos reales desde
    noviembre, ese caso necesita dueño: quién lo mira y qué hace. *Destraba:
    portal + regente.*
14. **Inyecciones — hecho el 2026-10-28.** Definición del usuario:
    1. **Cualquiera registra** la aplicación (cobra y marca «aplicada»), sin
       bloqueos.
    2. **Enfermería confirma** cuáles aplicó, en la misma **Bitácora** de
       Inyecciones: «La apliqué yo» por fila o «Confirmar las N» de una vez
       (permiso `inyecciones_confirmar`; hasta `20261028200428` fue una pestaña
       aparte). Las que marca ella misma entran confirmadas solas. Plazo:
       hasta el final del día siguiente; lo que no confirma queda «no aplicada
       por enfermería» sin que nadie haga nada (el estado lo deriva
       `inyeccion_enfermeria_estado`, no un cron).
    3. **La bitácora son las confirmadas**, con la enfermera como quien aplicó.
       Lo no confirmado sigue `aplicada` y sólo lo ve administración
       (`inyecciones_ver_todas`). Cuenta desde el **1-nov-2026**.

    4. **Toda traída lleva la ficha del cliente.** Si no tiene, se le crea en
       el mismo cobro (`cliente_crear_de_mostrador`: nombre y apellido más
       teléfono o DUI; si ya existe la devuelve). `operar-caja` rechaza la
       traída sin ficha. Las 45 traídas viejas sin nombre se arreglan con
       «Asignar a un cliente» en la bitácora.

    Migraciones `20261028184212` y `20261028200428`. Reemplaza la regla de `20261028181138` («con
    enfermería conectada, sólo ella marca»), que se deshizo el mismo día.

    **Qué dice la norma (verificado el 2026-10-28):** ni el RTS 11.02.04:24 ni la
    Guía de Verificación BPAD mencionan la aplicación de inyecciones ni piden un
    registro de aplicaciones; tampoco las Directrices de Atención Farmacéutica de
    la JVPQF (oct-2023, `docs/legal/normativa/sanitaria/`). La Ley de
    Medicamentos prohibía en su Art. 79 b) los servicios de enfermería dentro de
    las farmacias, pero ese literal fue **declarado inconstitucional**. O sea: la
    bitácora de inyecciones es un **control interno** de la empresa, no un
    registro que exija la SRS, y el inspector de BPAD no la cruza contra las
    ventas. Lo que sí rige es el ejercicio profesional de enfermería (CSSP /
    JVPE), que queda fuera de esta auditoría.
15. **Inyecciones: lote y vencimiento de lo aplicado.** Hoy no se guardan, y la
    dosis sólo en 22 de 993. *Destraba: portal.*
16. ~~**Inyecciones en el respaldo.**~~ **Hecho el 2026-10-28**:
    `inyeccion_aplicaciones` entró en `backup-critical-tables` (v20) y en la
    lista blanca de `backup_dump_table` (migración `20261028174947`).
17. **Evaluación periódica del sistema.** Es la quinta sección obligatoria del
    protocolo B (RTS **6.1.4**, Guía 3.6) y no existe como práctica: definir quién
    la hace, cada cuánto, y dónde queda la constancia. *Destraba: regente define,
    portal puede dar la pantalla.*
18. **Lector de recetas.** Medido con cinco recetas reales y **sin construir**;
    llenaría médico, paciente y medicamentos desde la foto. Antes de tocarlo,
    leer `docs/LECTURA-DE-COMPROBANTES-Y-RECETAS-2026-08-20.md`, y decidir si una
    foto con dato de salud sale del portal hacia un servicio externo. El libro
    funciona sin él. *Destraba: usuario (decisión de datos), después portal.*
19. ~~**Permiso del libro que no cierra nada.**~~ **Hecho el 2026-10-28**:
    manda `bitacoras_tab_libro.can_edit` (decisión del usuario). Completar y
    anular renglones o recetas lo exigen en el servidor (`bitacora_exigir_libro`,
    migración `20261028175023`) y en la pantalla. Se encendió para los cargos de
    sala que ya completaban; Auxiliar de Bodega y Servicios Generales quedaron
    sin él (no venden con receta).

### Se quedan en papel — decisión ya tomada

20. **Bitácora de visitas del regente** — RTS **6.1.3**, Guía 2.23 MAYOR: fecha,
    horario de permanencia, actividades, firma y sello; 1 año. Es lo primero que
    pide el inspector si el regente no está. No hay tabla `regente_visitas`.
21. **Constancia del control de plagas** — RTS 6.2.22, Guía 2.35 (documento del
    proveedor autorizado).
22. **Registro de capacitación** — Guía 2.20 (con el examen del facilitador).
23. **Archivo de autoinspecciones e inspecciones** — RTS **6.1.5**, 3 años.

### Pedir a la SRS

24. **La resolución con el listado oficial de antibióticos bajo receta
    retenida.** La regla de las seis moléculas más inyectables está confirmada
    por OPS y por el reporte de la DNM de 2015, pero el PDF de la resolución no se
    consiguió. Es el papel que justifica ante un inspector qué entra al libro.
    Guardarlo en `docs/legal/normativa/sanitaria/`.
25. **Su sistema de control de estupefacientes y psicotrópicos.** Guía §4 (4.1–4.4,
    CRÍTICOS), RTS 6.5.2: el sistema lo **facilita la autoridad**, no se
    construye. Hay tramadol (8 presentaciones), pregabalina (7), carbamazepina,
    quetiapina, risperidona, sertralina y amitriptilina en catálogo sin control.
    No van al libro de antibióticos. Preguntar antes de escribir una línea.

---

## 4 · Lo que pide la norma para que sea sólo digital

### 4.1 · Las cláusulas

> **RTS 6.1.16** — «Toda la documentación solicitada por este reglamento debe
> estar disponible dentro del establecimiento; **preferiblemente debe estar de
> manera física**. En caso de existir documentación digital ésta debe manejarse
> conforme a un **procedimiento/protocolo/guía, previamente autorizados por el
> Regente** y debe garantizar que todos los documentos sean **atribuibles,
> legibles, contemporáneos, originales y precisos**.»

> **RTS 6.1.4** — procedimiento para la supervisión del sistema electrónico, que
> incluya **nivel de acceso, resguardo de datos, forma de registro de datos,
> respaldo y evaluación periódica**.

> **RTS 6.1.14** / Guía 1.12 MAYOR — los procedimientos, revisados o autorizados
> por el regente **con firma y sello profesional**.

> **Guía 3.6** MAYOR — el inspector lo verifica en la sección **3, ANTIBIÓTICOS**:
> o sea al revisar el libro, que es el registro que más le importa.

Los cinco adjetivos son **ALCOA**. Sí se puede llevar todo en digital y la norma
lo contempla; lo que cuesta son **dos documentos** (A y B) y que el mes pueda
salir **impreso** igual, porque la norma prefiere el papel: a «muéstreme la
bitácora» no se contesta «déjeme prender la computadora». El mes impreso ya
existe (Cierre de mes; formularios `FLS-BIT-00` a `FLS-BIT-03`, el libro en
`FLS-BIT-03`).

Modelo de controles para redactar el B, aunque no nos obligue: **RTS 5.3.9**
(droguerías) — sólo autorizados ingresan o modifican, registro de los cambios,
acceso por contraseña.

### 4.2 · Qué cumple el portal — medido, no supuesto

| pide | cómo se cumple |
|---|---|
| **Atribuible** | `registrado_por` en toda lectura y limpieza, nunca opcional; firma con la ficha (`auth_employee_id()`), no con la cuenta. El kiosco de marcaje no escribe bitácoras |
| **Legible** | el mes sale en carta, una hoja por área, con forma de formulario |
| **Contemporáneo** | la franja la decide la base contra la hora de El Salvador (`bitacora_ahora_sv`, `bitacora_estado_franja`), nunca el reloj del navegador; una carga tardía queda `tarde = true` |
| **Original** | se anota en el portal; no se transcribe de un papel, salvo contingencia (C), que queda marcada |
| **Preciso** | corregir no pisa: `bitacora_correcciones` guarda antes, después, motivo, quién y cuándo. Una limpieza **se anula, no se borra** (desde `20260903220101`) y su corrección conserva el valor anterior. Una lectura físicamente imposible no entra (desde el 28-oct) |
| **Nivel de acceso** | RBAC por rol y módulo; toda lectura pasa por `bitacora_exigir_acceso`; RLS con policy explícita en todas las tablas; escritura sólo por RPC; cada sala ve lo suyo |
| **Registro de cambios** | `bitacora_correcciones` (append-only) y, desde `20260903220326`, las acciones del módulo en `audit_logs` (`bitacora_auditar`) |
| **Salidas anotadas** | el libro sale por `exportCsv` con módulo `bitacoras` y el mes impreso por `registrarEgreso` → `export_log` |
| **Resguardo** | Supabase us-east-1; ningún cron de purga toca bitácoras (los `purge-*` son de sesiones, avisos, logs y carnés). Retención: ninguna — la norma pone pisos (RTS 6.2.16: 2 años ambiente; Guía 3.12: 1 año receta; RTS 6.1.5: 3 años inspecciones), no techos |
| **Respaldo** | `backup-critical-tables`, domingos 02:00 SV, ventana rodante de 60 días. Corre con bitácoras adentro (último: 25-oct). **Falta inyecciones** (ítem 16) y el bucket `recetas` (Storage no entra en ese cron) |
| **Evaluación periódica** | ❌ no existe (ítem 17) |

**60 días de respaldo no contradicen 2 años de conservación**, pero el B tiene
que decirlo: la conservación la da la base viva (nada la purga) y el respaldo es
contra pérdida. Anexo 11 §17 y 21 CFR 11.10(c) piden que el registro sea
recuperable durante todo el período de retención.

### 4.3 · Lo que el 3-sep encontró en los borradores, y dónde quedó

La verificación del 3-sep halló que A y B **no estaban listos para firmar**: una
cita del capítulo equivocado (5.6.5), el refrigerador fuera del alcance, una
contingencia inexistente, la Ley de Firma Electrónica sin citar y **cinco
afirmaciones sobre el sistema que el sistema no sostenía** («ningún dato se
borra», «conserva el valor anterior», «el instrumento», «toda salida queda
anotada», «toda acción queda en la bitácora»). Los puntos 1–6 y 8 de su lista se
cerraron ese mismo día (v2.970.7 y v2.970.12) — los cinco, arreglando el
**sistema**, no el texto — y el 7 (correr el respaldo una vez) quedó demostrado
con las corridas semanales.

Lo que sigue valiendo de ese informe al redactar o revisar:

- **Ley de Firma Electrónica (D.L. 133/2015).** Art. 6: el cierre en el sistema
  es firma electrónica **simple** — validez jurídica, menor fuerza probatoria.
  Lo que cumple el 6.1.14 es **la hoja impresa firmada y sellada por el
  regente**; el cierre digital es control interno. Art. 12: quien almacena
  **por cuenta propia** no se acredita ante la Unidad de Firma Electrónica.
  Art. 13-A / 14: íntegro, legible, completo, sin alteraciones; omitir uno hace
  perder el valor legal.
- **Frecuencia declarada.** Redactar «no menos de dos (RTS 6.2.16); este
  establecimiento realiza tres»: escrito «tres» a secas, un día con dos lecturas
  incumple el procedimiento propio. El refrigerador va con dos (6.2.20).
- **Acción correctiva.** Es decisión propia del establecimiento (buena), no
  cumplimiento de un numeral: el §6 no tiene cláusula de desviaciones. Para el
  refrigerador conviene el criterio SEFH: no dispensar el lote afectado hasta
  documentar que la desviación no afectó la calidad.
- **Antes de inspección** (no bloquean la firma): proveedor como tercero con
  responsabilidades (Anexo 11 §3.1), control de cambios e incidentes (§10, §13),
  capacitación con registro, control de copias numeradas, definiciones,
  «Sustituye a» y los formularios como anexos.
- **Cada oración en presente sobre el sistema se mide contra producción antes
  de que la firme un profesional colegiado.** Es la lección del 3-sep: las cinco
  afirmaciones falsas eran ciertas como intención.

Si alguna vez se lleva el papel como registro primario, la Guía 3.7 define el
libro controlado: numeración de hoja, responsables de registro y de
autorización, control de correcciones. La hoja de hoy tiene todo **menos la
numeración de hoja**.

### 4.4 · Antibióticos: qué entra a qué registro

- **Ningún antibiótico sistémico es de venta libre.** El listado 2026 de venta
  sin receta (`srs_venta_sin_receta_2026.txt`) sólo trae neomicina y
  sulfadiazina tópicas, y la Ley de Medicamentos llama venta libre únicamente a
  lo publicado ahí. Esto **corrige** a la auditoría del libro del 3-sep, que daba
  amoxicilina, metronidazol o ciprofloxacina oral como venta libre.
- **Libro bajo receta (receta retenida):** las seis moléculas —cefixima,
  azitromicina, claritromicina, levofloxacina, moxifloxacina, norfloxacina—
  cualquiera sea la vía, **más todo antibiótico inyectable** (RTS 6.4.3, «según
  el listado emitido oficialmente por SRS»). El resto de los antibióticos es «con
  receta» sin retención y no entra al libro.
- **Registro trazable (Guía 3.3 CRÍTICO):** **todos** los antibióticos que se
  manejan, con o sin retención. Es el ítem 10.
- **Listado AWaRe (Guía 1.13):** también todos. Es el ítem 11.
- Dos lecturas al día, 9:30–11:00 y 14:30–16:00 (la de mediodía se quitó el
  2026-10-28: la norma no la pide).

---

## 5 · Cómo está construido

Para quien vaya a trabajar en el módulo. El diseño original (16-ago) cambió en
el camino; esto es lo que existe.

### 5.1 · Pantallas y permisos

- `src/views/BitacorasView.jsx` con pestañas en la URL (`usePestanaEnUrl`):
  **Registro diario** (`TabHoy`), **Bajo receta** (`TabBajoReceta`), **Cierre de
  mes** (`TabCierre`), **Configuración** (`TabConfiguracion`), en
  `src/views/bitacoras/`. Datos en `src/data/bitacoras.js`.
- Widgets del Inicio: `WidgetBitacoras` y `WidgetRecetasPendientes`. El
  pendiente del libro ya no se recorta por antigüedad (a los 31 días
  desaparecía).
- Inyecciones: `src/views/InyeccionesView.jsx` + `src/views/inyecciones/`
  (`TabBitacora`, `TabPendientes`, `TabPorCobrar`), datos en
  `src/data/inyecciones.js`; se aplica desde la caja (`DialogoAplicacion`).
- Módulos: `bitacoras`, `bitacoras_tab_libro`, `bitacoras_tab_cierre`, más
  configurar y descargar (`src/constants/permissionModules.js`). Los jefes de
  sala configuran su sala (`20260825172231`).

### 5.2 · Ambiente, refrigerador y limpieza

```
bitacora_areas        branch_id, tipo ('sala_ventas' | 'bodega' | 'refrigerador'
                      | 'vitrinas' | 'servicio_sanitario'), activa, lecturas_dia,
                      limpiezas_dia, temp_min/max, hr_min/max, calibración
bitacora_lecturas     area_id, fecha, franja (única entre las tres), temperatura,
                      humedad, registrado_por, registrado_at, tarde,
                      fuera_de_rango (calculado), accion_correctiva
bitacora_limpiezas    area_id, fecha, turno, quién, puntos (muebles), anulada_*
bitacora_correcciones antes / después / motivo / corregido_por — append-only
```

Decisiones que no se «corrigen» sin saber qué se rompe (detalle en la auditoría
del 25-ago):

- **El hueco se ve.** Las franjas del día se conocen de antemano; se pinta la
  grilla completa, no sólo lo llenado. Es lo que el inspector pregunta.
- **Fuera de rango exige la acción correctiva** o la lectura no se guarda.
- **El estado de la franja lo decide la base** contra la hora de El Salvador.
  Una franja vencida se completa, pero queda `tarde`.
- **Sólo el refrigerador declara instrumento y calibración** (RTS 6.2.19). El
  ambiente no (`20260825192751_bitacoras_el_ambiente_no_declara_su_termometro`):
  para una farmacia la Guía 2.13 sólo pregunta si **hay** termómetro y el RTS
  6.2.11 pide uno independiente por área. Si Bodega central se licenciara como
  centro de almacenamiento, le aplicaría el §5 y su termohigrómetro sí
  necesitaría certificado.
- **Los rótulos de franja son fijos** (Mañana y Tarde, en temperatura y en
  limpieza); lo que cambia por sucursal es el **horario**
  (`20260825185748`).
- **Limpieza mueble por mueble, opcional.** El registro tiene que poder mostrar
  lo que el procedimiento E promete; «11 de 26» va en neutro, no en rojo, y lo no
  marcado se escribe «no hecho», no se omite.
- Aviso de franja por vencerse: edge function `avisar-bitacora-por-vencer`.

### 5.3 · El libro bajo receta

```
dispensacion_clases      qué libro le toca a cada producto, CON el motivo escrito;
                         manda sobre products.es_antibiotico (el ERP lo reescribe)
bitacora_dispensaciones  un renglón por línea de venta bajo receta: clase, folio
                         (serie por libro: 2026-00001 / 2026-R-00001), lote,
                         vencimiento, cantidad, vendedor — copiados de la venta;
                         completada_por; anulación con motivo, nunca borrado
bitacora_folios          contadores; único (branch_id, anio, clase, folio)
recetas / receta_items   paciente, médico, fecha, foto, prescrito por producto;
                         estado abierta/cerrada y motivo_pendiente
medicos                  número de junta + junta + nombre; sólo del CSSP
```

- **La sala completa, no captura.** El portal no controla la caja: la venta
  entra sola (cron `bitacora-dispensaciones-5min` y un repaso diario de 120 días)
  y aparece como pendiente con lote, vencimiento y vendedor ya puestos. La sala
  agrega sólo paciente, médico, foto y a qué receta pertenece.
- **Parcial y total no son una casilla: son el estado de la receta.** Se derivan:
  pendiente = Σ prescrito − Σ entregado. Cubre Guía 3.17, 3.19, 3.20, 3.21.
- **El paciente no es el cliente de la factura** («CLIENTE FRECUENTE», una
  aseguradora). Se ofrece como valor inicial, editable.
- **Médico:** primero la tabla propia; si no está, `consultar-profesional-cssp`
  por número y junta **con igualdad exacta** (el buscador del CSSP es por
  coincidencia parcial: el 5000 trae el 15000). La base rechaza un médico que no
  venga del CSSP.
- **Foto de la receta:** bucket `recetas` privado, 10 MB, imágenes y PDF, en
  `PRIVATE_BUCKETS`; editor canónico `EditorDeDocumento` (recorte, enderezado,
  avisos de borrosa/oscura/chica que no bloquean). El comprobante de venta lo
  baja `sync-sales-dte` al bucket `sales-dte`.
- **Apertura por sala:** `branches.libro_receta_desde`. NULL = no abrió (falla
  segura). Hoy `2026-11-01` en las 6.
- **Escalado:** `recetas-escalar-15min`; pendiente vencido en rojo para la sala
  y en el tablero del regente. No se bloquea una venta que ya ocurrió.
- Vigilancia: **`npm run gate:receta`** (contra producción) — moléculas e
  inyectables sin clasificar, libro contra ventas, motivos vacíos, deuda de
  principio activo con trinquete. Detecta por **principio activo**, nunca por
  marca.

### 5.4 · El cierre de mes

`bitacora_cierres` (sucursal + período único), `cerrar_mes_bitacora`,
`reabrir_mes_bitacora`, `get_bitacora_resumen_mes`, `get_bitacora_mes_impreso`,
`bitacora_periodo_cerrado`.

- **Lo cierra sólo el Regente** (desde el 3-sep). Hoy nadie puede cerrar.
- **Se puede cerrar un mes imperfecto, y el cierre guarda cuán imperfecto era.**
  El `resumen` se congela al cerrar (lecturas faltantes, fuera de rango con y
  sin acción, tardías, limpiezas, renglones del libro sin completar). Exigir
  perfección enseña a inventar lecturas; un mes que sabe lo que le falta es
  defendible.
- Con renglones del libro pendientes (`bitacora_libro_pendientes`, la única
  cuenta) exige **motivo escrito de ≥15 caracteres**.
- Mes cerrado = nadie agrega ni corrige ese período. Reabrir exige motivo y queda
  registrado.
- Produce **el mes impreso**: resumen adelante, una hoja por área, y dos hojas de
  libro (la de antibióticos sale siempre, aunque vacía; la otra sólo con
  renglones). Maqueta: `npm run maqueta:bitacoras`.

### 5.5 · Reglas de la casa que aplican

RLS con policy explícita y `auth_*` envuelto en `(SELECT …)`; escritura por RPC
`SECURITY DEFINER` con guarda; nada se borra; `audit_logs` para toda acción;
**ninguna purga**; toda tabla nueva del módulo entra al respaldo **y** a la lista
blanca de `backup_dump_table` en la misma migración.

---

## 6 · Fuentes

Los cuatro documentos que este reemplaza, ya en su lugar de archivo:

- `docs/planes-cerrados/PLAN-BITACORAS-SRS-2026-08-16.md` — el diseño original:
  la norma ítem por ítem, parcial/total como estado, médicos, adjuntos, cierre.
- `docs/planes-cerrados/BITACORAS-SOLO-DIGITAL-QUE-PIDE-LA-SRS-2026-09-03.md` —
  qué exige la norma para llevarlo sin papel; el hueco del respaldo.
- `docs/planes-cerrados/VERIFICACION-PROCEDIMIENTOS-DIGITALES-2026-09-03.md` —
  A y B contra la norma, la Ley de Firma Electrónica, Anexo 11 y Part 11.
- `docs/planes-cerrados/AUDITORIA-BITACORAS-PRODUCCION-2026-10-28.md` — octubre
  medido en producción; la que manda en el estado.

Archivados antes:

- `docs/planes-cerrados/AUDITORIA-BITACORAS-SRS-2026-08-25.md` — ambiente y
  limpieza contra el RTS; por qué el ambiente no se calibra.
- `docs/planes-cerrados/AUDITORIA-LIBRO-BAJO-RECETA-2026-09-03.md` — dos libros,
  `dispensacion_clases`, `gate:receta`, AWaRe (su «venta libre» quedó corregido
  en §4.4).

Relacionados: `docs/LECTURA-DE-COMPROBANTES-Y-RECETAS-2026-08-20.md` (lector de
recetas, sin construir) · `docs/legal/README.md` (normativa vigente y tabla de
renumeración) · `docs/legal/normativa/sanitaria/` (RTS publicado y de consulta,
Guía BPAD, listados SRS 2026) · `docs/legal/procedimientos/` (borradores A–E).
