> **BORRADOR.** Lo redactó el portal con lo que el sistema hace hoy, medido el
> 2026-09-03. **No tiene valor hasta que el regente lo revise, lo ajuste y lo
> firme y selle.** Lo que va entre `[corchetes]` es una decisión o un dato que
> sólo la empresa puede poner.
>
> ⚠️ **Revisado contra la norma y contra producción el 2026-09-03** — el informe
> está en `docs/VERIFICACION-PROCEDIMIENTOS-DIGITALES-2026-09-03.md`.
>
> **Antes de firmarlo hay que resolver el punto 2.3** (quién puede cerrar el mes)
> y **correr el respaldo una vez** para poder llenar la constancia del punto 5:
> las 7 tablas de bitácoras entraron al respaldo el 2026-09-03 y **todavía no ha
> corrido ni una vez con ellas adentro**.

---

# Protocolo de supervisión del sistema electrónico

| | |
|---|---|
| **Código** | `[FLS-PRO-02]` |
| **Versión** | 1.0 |
| **Fecha de emisión** | `[dd/mm/aaaa]` |
| **Elaborado por** | `[nombre y cargo]` |
| **Revisado y autorizado por** | `[nombre del regente]` · JVPM `[n.º]` |
| **Sustituye a** | — (emisión inicial) |
| **Próxima revisión** | `[dd/mm/aaaa]` |

---

## 1 · Objeto y alcance

Dar cumplimiento al **RTS 11.02.04:24, numeral 6.1.15**, que exige, para la
documentación digital, un procedimiento de supervisión del sistema electrónico
que incluya **nivel de acceso, resguardo de datos, forma de registro de datos,
respaldo y evaluación periódica**. Es el documento que verifica el ítem **3.6**
de la Guía de Verificación.

Aplica al sistema informático donde este establecimiento lleva los registros
descritos en el `[FLS-PRO-01]`.

Las **cinco secciones que exige el 6.1.15** son los puntos 2, 3, 4, 5 y 8, y
llevan a propósito el nombre que les da la norma. Los puntos **6 (control de
cambios)** y **7 (incidentes)** van de más: no los pide el RTS, pero sí los piden
los marcos con los que se mide un sistema de registros farmacéuticos —el
**Anexo 11 de las BPM de la Unión Europea**, §10 y §13, y el **21 CFR Part 11**
de la FDA, §11.10(k)— y sin ellos la evaluación periódica del punto 8 no tendría
contra qué comparar.

**Identificación del sistema**

| | |
|---|---|
| Nombre | `[Portal Farmalasa]` |
| Responsable | `[nombre y cargo]` |
| Proveedor de infraestructura | Supabase (base de datos PostgreSQL y almacenamiento) |
| Ubicación de los datos | Estados Unidos, región `us-east-1` |
| Contrato con el proveedor | `[referencia y fecha]` |
| Responsable del contrato | `[cargo]` |

**El almacenamiento es por cuenta propia.** La empresa guarda sus propios
registros; no ofrece almacenamiento ni certificación a terceros. Bajo el
**Art. 12 de la Ley de Firma Electrónica (D.L. 133/2015)**, quien almacena por
cuenta propia **no tiene obligación de acreditarse** ante la Unidad de Firma
Electrónica del Ministerio de Economía.

**Qué responde el proveedor y qué responde la empresa.** El proveedor responde
por la disponibilidad de la base de datos y del almacenamiento; **la empresa
responde por el contenido de los registros, por quién accede a ellos, por el
respaldo y por su conservación**. `[Revisar el contrato y detallarlo. Definir
también qué se hace con los datos si el servicio termina: extracción, formato y
plazo.]`

**Como el archivo electrónico vive fuera del país**, la copia impresa mensual del
`[FLS-PRO-01]` se archiva **dentro de cada establecimiento**, que es lo que exige
el numeral 6.1.14.

---

## 2 · Nivel de acceso

### 2.1 · Cómo se entra

Cada persona entra con una **cuenta propia y una contraseña propia**. No existen
cuentas compartidas para anotar registros: la anotación queda a nombre de quien
entró.

En sala, el personal también puede identificarse con su **carné con código de
barras**, que resuelve a la misma persona. `[Describir aquí si se usa o no.]`

La sesión **se cierra sola por inactividad**: a los **5 minutos** para los cargos
de sala y bodega, y a las **12 horas** para los cargos administrativos.

### 2.2 · Qué puede hacer cada quien

El acceso se otorga **por cargo**, no por persona. Sobre los registros de
bitácoras, hoy es así:

| lo que se puede hacer | cargos que lo tienen |
|---|---|
| **Anotar y consultar** lecturas y limpiezas | Dependiente de Farmacia, Auxiliar de Bodega, Jefe/a y Subjefe/a de Sala, Regente, Regente de Enfermería, Supervisor/a de Ventas, Gerente General, Administrador, Jefe/a de Talento Humano |
| **Consultar el libro** de dispensación bajo receta | los mismos |
| **Configurar** áreas, franjas, rangos e instrumentos | Jefe/a y Subjefe/a de Sala, Regente, Supervisor/a de Ventas, Gerente General, Administrador, Jefe/a de Talento Humano |
| **Descargar e imprimir** el mes | Jefe/a y Subjefe/a de Sala, Regente, Supervisor/a de Ventas, Gerente General, Administrador, Jefe/a de Talento Humano |
| **Cerrar el mes** | Regente, Supervisor/a de Ventas, Gerente General, Administrador, Jefe/a de Talento Humano |

Además, cada persona **sólo ve los registros de la sala o salas a las que está
asignada**. Esa restricción no la aplica la pantalla: la aplica la base de datos,
así que no se puede evitar por otro camino.

**La cuenta de pruebas.** Existe además el cargo **QA / Testing (CI)**, que tiene
los cinco permisos de la tabla de arriba y **no corresponde a ninguna persona**:
es la cuenta con la que se comprueba que el sistema funciona antes de publicar un
cambio. Está marcada como tal en el sistema (`es_cuenta_de_pruebas`) y por defecto
no tiene sala asignada. `[Decidir: dejarla declarada así, o quitarle el permiso de
cerrar el mes.]` No se omite de este documento: un cargo capaz de cerrar un mes
tiene que estar escrito acá.

### 2.3 · Qué vale como firma del regente, y lo que hay que decidir

**Lo que cumple el numeral 6.1.12** —«revisado o autorizado por el regente, con
su **firma y sello profesional**»— **es la hoja impresa del mes, firmada y
sellada por el regente.** El cierre en el sistema es un control interno.

El fundamento es la **Ley de Firma Electrónica (D.L. 133/2015), Art. 6**: la
firma electrónica **simple** tiene la misma validez jurídica que la autógrafa,
pero **no la misma validez probatoria** que la certificada — es un elemento de
prueba conforme a la sana crítica. El cierre en el sistema es una firma simple. Y
el **sello** profesional es del colegiado, no del sistema.

Escrito así, este documento es cierto con los cargos que el sistema tiene hoy.

**Lo que igual hay que decidir.** El cierre lo pueden hacer **seis** cargos
—Regente, Supervisor/a de Ventas, Gerente General, Administrador, Jefe/a de
Talento Humano y la cuenta de pruebas del punto 2.2— y de hecho el único cierre
registrado hasta la fecha **lo hizo un Supervisor/a de Ventas**. Los mensajes del
propio sistema dicen «Sólo el regente puede dar por finalizado el mes», que no es
lo que el permiso hace.

- **(a)** Dejar el cierre **sólo al Regente** (y, si se quiere, a un suplente
  nombrado por escrito). Es lo más limpio y hace que el mensaje del sistema sea
  cierto.
- **(b)** Mantenerlo en varios cargos, como control operativo, y dejar la firma
  del 6.1.12 en la hoja impresa — como quedó escrito arriba. En ese caso hay que
  **corregir el mensaje del sistema**, que hoy afirma algo falso.

`[Decisión: ____________________ ]`

### 2.4 · Alta y baja de cuentas

- **Alta** — la solicita `[cargo]` y la ejecuta `[cargo]`, asignando el cargo que
  corresponde. No se crean cuentas sin cargo.
- **Cambio de cargo** — se actualiza el cargo; los permisos cambian solos.
- **Baja** — al terminar la relación laboral, `[cargo]` **bloquea el acceso el
  mismo día**. Las anotaciones que la persona hizo **no se borran ni cambian de
  autor**: el registro histórico conserva quién lo hizo.

**Todo alta, cambio o baja de permisos queda registrado.** El sistema anota cada
cambio de permisos en su bitácora de auditoría, con quién lo hizo y cuándo
(`PERMISOS_CAMBIO`). Esa lista es una de las cosas que revisa la evaluación
periódica del punto 8.

---

## 3 · Resguardo de datos

- Los datos viven en una base de datos **PostgreSQL administrada**, con acceso
  restringido por credenciales.
- **Cada tabla tiene reglas de acceso a nivel de fila**: la base decide qué
  puede ver y escribir cada cuenta. Una consulta hecha por fuera de la pantalla
  obtiene lo mismo que la pantalla, ni más.
- **Ningún proceso automático borra los registros de bitácoras.** Los procesos de
  purga del sistema alcanzan sólo a sesiones vencidas, avisos, registros técnicos
  de sincronización y carnés temporales.
- **Conservación**: temperatura y humedad **2 años** (RTS 6.2.16); dispensación
  bajo receta **1 año** (Guía 3.12); archivo de inspecciones **3 años**
  (RTS 6.1.3).

**El medio de conservación es la base de datos viva, no el respaldo.** El
respaldo del punto 5 guarda 60 días y sirve para **recuperar ante una pérdida**;
lo que garantiza los plazos de arriba es que el registro permanece en la base y
ningún proceso lo borra. A eso se suma la **copia impresa** de cada mes cerrado,
que se archiva en el establecimiento por el mismo plazo y no depende de ningún
sistema para poder leerse.

- **La salida de datos queda anotada** —quién exportó, qué módulo, en qué formato
  y cuántas filas— en los módulos que usan la exportación estándar del portal.
  ⛔ **La descarga y la impresión del mes de bitácoras todavía no lo hacen**: hay
  que conectarlas antes de firmar este documento, o esta línea no es cierta para
  el módulo del que trata el protocolo.

---

## 4 · Forma de registro de datos

Descrito en detalle en el `[FLS-PRO-01]`, punto 4. En resumen:

- La lectura se anota **en el momento**, desde el sistema, con la cuenta de quien
  la toma.
- Quedan guardados el valor, el área, la franja, **la fecha y hora reales** y
  **la persona** (numeral 6.2.21).
- **La hora la fija el servidor**, no el equipo desde el que se anota.
- Una lectura fuera de rango **no se acepta sin su acción correctiva**.
- **Nada se borra ni se sobrescribe.** Una corrección **agrega** un registro con
  el valor anterior, el valor nuevo, el motivo y quién corrigió.
- **Cada registro lleva a su autor en su propia fila**: quién anotó, quién
  corrigió, quién cerró el mes y quién lo reabrió, siempre con fecha y hora.
- Los cambios de **configuración y de permisos** quedan además en una **bitácora
  de auditoría** aparte.
  ⛔ **Las acciones sobre las bitácoras todavía no llegan a esa bitácora
  aparte** (anotar, corregir, cerrar, reabrir). La atribución existe en cada
  fila, pero falta la pista independiente. Hay que agregarla —junto con la
  corrección del borrado descrita en el `[FLS-PRO-01]` punto 4.3— antes de firmar.

---

## 5 · Respaldo

| | |
|---|---|
| **Qué se respalda** | Las **30 tablas** de trabajo manual y configuración, incluidas las **7 de bitácoras**: áreas, lecturas, limpiezas, correcciones, cierres, dispensaciones y folios |
| **Cada cuánto** | **Semanal**, los domingos a las 02:00 hora de El Salvador |
| **Dónde queda** | Almacenamiento privado del mismo proveedor, comprimido, en carpetas por fecha |
| **Cuánto se retiene** | **60 días** de copias semanales |
| **Constancia** | Cada corrida deja registro con la fecha, si tuvo éxito, cuántas tablas se copiaron y cuántas fallaron |
| **Última corrida verificada** | `[dd/mm/aaaa]` — 30 tablas, 0 fallos |

⚠️ **Las 7 tablas de bitácoras entraron al respaldo el 2026-09-03 y el respaldo
todavía no ha corrido con ellas adentro** (corre los domingos). Antes de firmar
hay que dispararlo una vez, comprobar que las 30 tablas salen sin fallos, y
escribir esa fecha arriba. Un control declarado que nunca corrió no es un
control.

**Cómo se restaura.** `[Describir el procedimiento: quién lo autoriza, quién lo
ejecuta, y dónde queda la constancia de la restauración.]`

**Prueba de restauración.** `[Decidir la frecuencia — se sugiere una vez al año —
y dejar constancia. Un respaldo que nunca se restauró no está comprobado.]` La
prueba debe comprobar que el archivo recuperado se puede **consultar, leer y
reproducir con exactitud**, que es lo que exige el Art. 13-A de la Ley de Firma
Electrónica.

**Continuidad.** Si el sistema no está disponible, las lecturas **no se
suspenden**: se toman en la hoja de contingencia y se cargan al volver, según el
`[FLS-PRO-01]` punto 4.7. `[Definir a quién se avisa y en cuánto tiempo se espera
tener el sistema de vuelta.]`

---

## 6 · Control de cambios del sistema

Ningún cambio entra al sistema sin quedar registrado. Cada versión publicada lleva
su número y su descripción en el registro de cambios del portal, y todo cambio de
la base de datos entra como una **migración numerada y archivada**, que queda para
siempre y no se reescribe.

`[Definir quién autoriza una publicación que toque estos registros y dónde queda
la constancia.]`

---

## 7 · Incidentes

Un incidente es cualquier falla del sistema o error de datos que afecte a un
registro de los del `[FLS-PRO-01]`: una caída, una lectura que no se pudo anotar
a tiempo, un dato cargado mal.

`[Definir: a quién se reporta, en cuánto tiempo, dónde queda la constancia, y
quién decide la acción correctiva.]`

Un incidente que haya impedido anotar a tiempo se resuelve por la vía de
**contingencia** del `[FLS-PRO-01]` punto 4.7 —la lectura se toma en papel y se
carga al volver el sistema— y se revisa en la evaluación periódica.

---

## 8 · Evaluación periódica

`[Es la única de las cinco secciones que todavía no existe como práctica. Lo de
abajo es una propuesta: ajustar la frecuencia y los responsables.]`

**Frecuencia sugerida: semestral**, y además cada vez que cambie algo relevante
del sistema.

**Quién la hace:** `[cargo]`, con la revisión del regente.

**Qué se revisa, punto por punto:**

1. **Cuentas activas** — que toda cuenta con acceso corresponda a personal
   vigente, y que no queden cuentas de personas que ya no están.
2. **Permisos por cargo** — que lo declarado en el punto 2.2 siga siendo lo que
   el sistema tiene, en particular **quién puede cerrar el mes**.
3. **Cumplimiento del registro** — el porcentaje de casillas anotadas por sala y
   por mes, y las que faltaron.
4. **Desviaciones** — que toda lectura fuera de rango tenga su acción correctiva
   anotada.
5. **Correcciones** — cuántas hubo, sobre qué y con qué motivo.
6. **Cierres mensuales** — que todos los meses vencidos estén cerrados y por
   quién.
7. **Respaldo** — que las corridas de las últimas semanas terminaron sin fallos
   y que las tablas de bitácoras están incluidas.
8. **Impresión y archivo** — que los meses cerrados están impresos, firmados y
   sellados por el regente, y archivados en el establecimiento.
9. **Prueba de restauración** — que se hizo la del período y qué resultó.
10. **Incidentes** — los del período, su causa y qué se hizo.
11. **Cambios del sistema** — los publicados en el período que afecten estos
    registros.
12. **Capacitación** — que el personal que anota está capacitado en el
    `[FLS-PRO-01]` y que la constancia existe (RTS 6.3.2 y 6.3.4).
13. **Áreas y su instrumento** — que toda área activa tiene declarado su
    instrumento y, en el refrigerador, su calibración vigente.

**Dónde queda la constancia:** `[definir]`. Debe incluir la fecha, quién la hizo,
lo encontrado y las acciones tomadas.

---

## 9 · Referencias

- RTS 11.02.04:24 — **capítulo 6** (farmacias, botiquines y otros
  establecimientos que dispensan), numerales 6.1.3, 6.1.12, 6.1.14, **6.1.15**,
  6.2.16, 6.2.20, 6.2.21, 6.3.2, 6.3.4
- Guía de Verificación de Buenas Prácticas de Almacenamiento y Dispensación de
  Establecimientos que Dispensan Medicamentos, ítem **3.6** (y su espejo físico,
  el 3.7)
- **Ley de Firma Electrónica** (D.L. 133/2015), artículos 6, 7, 11, 12, 13-A y 14
- `[FLS-PRO-01]` — Procedimiento para el manejo de documentación digital

> El capítulo **5** del RTS es de laboratorios, droguerías y centros de
> almacenamiento: **no aplica a este establecimiento** y no se cita acá.

## 10 · Control de cambios de este documento

| versión | fecha | qué cambió |
|---|---|---|
| 1.0 | `[dd/mm/aaaa]` | Emisión inicial |
