# Convenios de la OIT ratificados por El Salvador

Qué obliga a esta empresa **por encima** del Código de Trabajo, y dónde toca al
portal. Escrito el **2026-08-28**.

## Antes de usar este documento: qué está verificado y qué no

**No fue posible descargar el listado oficial.** NORMLEX —la base de la OIT
donde vive la lista autoritativa— responde **403 a todo acceso automático**:
probado el 2026-08-28 contra `normlex.ilo.org`, `www.ilo.org/dyn/normlex` y
`webapps.ilo.org`, con dos clientes distintos. El sitio principal de la OIT sí
responde; la base de datos, no.

Eso significa que **este archivo no es la lista completa** y no hay que leerlo
como si lo fuera. Cada fila dice de dónde salió:

- **✅ Verificado** — abierto y leído de una fuente oficial en esta sesión.
- **⚠️ Por confirmar** — apareció en una búsqueda y **no** se pudo abrir la
  ficha de NORMLEX. La fecha puede estar mal y puede faltar el dato de si sigue
  vigente o fue denunciado.

La lista autoritativa se refresca **a mano**, desde un navegador:
<https://normlex.ilo.org/dyn/normlex/es/f?p=1000:11200:0::NO:11200:P11200_COUNTRY_ID:102835>

Un convenio **denunciado** deja de obligar, y eso NORMLEX lo dice y una búsqueda
no. Es justo el dato que este archivo no puede garantizar.

---

## 1 · Lo ratificado en 2022, que es lo más nuevo y lo que más toca al portal

✅ **Verificado** contra la nota oficial de la OIT
(<https://www.ilo.org/es/resource/news/el-salvador-reafirma-su-compromiso-con-la-oit-con-la-ratificacion-de-cinco>):
los cinco instrumentos se depositaron el **7 de junio de 2022** y entraron en
vigor para El Salvador el **7 de junio de 2023**.

| Convenio | Qué es | Qué toca acá |
|---|---|---|
| **C102** (1952) | Seguridad social, norma mínima | ISSS y AFP del expediente. El portal ya distingue los dos estados y no los confunde — ver la §ISSS/AFP de `EmployeeFormModal` |
| **C148** (1977) | Medio ambiente de trabajo: contaminación del aire, ruido y vibraciones | Nada construido. Es de higiene ocupacional; no hay módulo |
| **C154** (1981) | Negociación colectiva | Nada construido, y no aplica hoy: no hay sindicato ni contrato colectivo |
| **C183** (2000) | Protección de la maternidad | **Sí toca.** Piso de 14 semanas de licencia. El Código de Trabajo salvadoreño da **16**, así que manda el Código —el convenio es un piso, no un techo—. Ver §3 |
| **C190** (2019) | Violencia y acoso en el mundo del trabajo | **Sí toca, y es el que más deuda deja.** Ver §4 |

## 2 · Lo anterior — ⚠️ por confirmar en NORMLEX

Estas fechas salieron de una búsqueda y **no** se pudieron abrir en la ficha
oficial. Sirven para saber que el convenio existe y está ratificado; **no** para
citar una fecha en un documento formal sin volver a mirarlas.

| Convenio | Qué es | Fecha que arrojó la búsqueda |
|---|---|---|
| **C081** | Inspección del trabajo | 15-jun-1995 |
| **C087** | Libertad sindical y protección del derecho de sindicación | 06-sep-2006 |
| **C098** | Derecho de sindicación y de negociación colectiva | 06-sep-2006 |
| **C100** | Igualdad de remuneración | 12-oct-2000 |
| **C111** | Discriminación (empleo y ocupación) | 15-jun-1995 |
| **C138** | Edad mínima — **especificada en 14 años** | sin fecha confirmada |
| **C182** | Peores formas de trabajo infantil | 12-oct-2000 |

Y hay más ratificados que no entran acá porque no se pudieron enumerar: trabajo
forzoso, examen médico de menores en la industria, política de empleo, inspección
en la agricultura, fijación de salarios mínimos, organizaciones de trabajadores
rurales, desarrollo de recursos humanos. **Que falten de esta tabla no significa
que no obliguen** — significa que no se pudo abrir la lista.

---

## 3 · La regla que hay que tener en la cabeza: el convenio es un PISO

Un convenio de la OIT fija un **mínimo**. Si la ley salvadoreña da más, manda la
ley salvadoreña; si da menos, el país está en falta y lo que se le exige es el
convenio.

Es exactamente la misma mecánica que ya rige entre el Código de Trabajo y el
Reglamento Interno de esta empresa, y está escrita en CLAUDE.md:

> **la ley pone el piso; el reglamento interno pone el suyo más arriba, y manda
> el más alto.**

La OIT agrega un tercer escalón por debajo de los dos. Entonces, al resolver una
duda: **convenio ≤ Código de Trabajo ≤ Reglamento Interno**, y se aplica el más
alto de los tres.

Dos casos concretos donde eso ya está resuelto y conviene no “corregirlo”:

- **Maternidad.** C183 pide 14 semanas; el Código de Trabajo da 16. Se aplican
  16. Bajar a 14 “porque lo dice el convenio” sería reducir un derecho.
- **Edad mínima.** C138 la fija en 14 años para El Salvador. El portal ya trata
  como menor a quien no llega a 18 y le exige documento alterno de identidad
  (Art. 23 nº2 CT), además de las prohibiciones de los Arts. 114-117.

---

## 4 · C190 — violencia y acoso: lo que el portal NO tiene

Vigente para El Salvador desde el **7 de junio de 2023**, y es el convenio que
deja deuda visible.

El C190 no pide un dato en una ficha: pide que exista un **circuito** — una
política, una vía para denunciar, y que la denuncia se pueda tramitar sin que la
persona quede expuesta. Hoy el portal no tiene nada de eso:

- no hay forma de levantar una denuncia de acoso;
- no hay expediente disciplinario donde asentarla — ya está anotado aparte que
  `employee_events` sólo conoce `TRANSFER` y `PROMOTION`, y por eso tampoco se
  puede probar la reincidencia de 60 días del RIT Art. 83;
- y la bitácora de auditoría (`audit_logs`) no sirve como canal: es un registro
  técnico, no un procedimiento con garantías.

**No es un hallazgo de código, es alcance que nadie decidió todavía.** Queda
anotado acá para que la próxima vez que se toque el módulo de personal la
pregunta esté escrita, en vez de descubrirse cuando alguien la necesite.

---

## 5 · Qué NO hay en esta carpeta, y por qué

**Los textos de los convenios no están descargados.** Se intentó: NORMLEX bloquea
el acceso automático, y la copia que el MTPS publica del C190
(`sostrabajadoras.mtps.gob.sv`) devolvió **522** el 2026-08-28 — su servidor
estaba caído, no es que la dirección esté mal; vale la pena reintentarla.

Guardar un texto a medias sería peor que no guardarlo: un archivo en esta
carpeta se lee como fuente, y una fuente incompleta se cita igual que una
completa. Si hace falta el texto de un convenio, se baja a mano de NORMLEX en su
ficha `P12100_ILO_CODE:C###` y se agrega acá con su fecha de descarga, como
están el Código de Trabajo y el Reglamento Interno.
