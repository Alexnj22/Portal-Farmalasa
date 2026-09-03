# Bitácoras sólo digitales — qué pide la SRS para que funcione así

**2026-09-03.** Pregunta del usuario: *«si es sólo digital, cómo debería ser o
qué pide la SRS para que funcione de esa forma?»*

Fuentes leídas, las dos en el repo: `docs/legal/rts_11020424_bpadyt.txt`
(RTS 11.02.04:24) y `docs/legal/srs_guia_verificacion_bpad.txt` (Guía de
Verificación de BPAD).

> ⚠️ **El RTS tiene dos capítulos y sólo uno es nuestro.** §5 aplica a
> laboratorios, droguerías y centros de almacenamiento; **§6 a farmacias y
> botiquines**. Citar el §5 da respuestas que no nos obligan — ya pasó una vez
> con la calibración. Todo lo de abajo es del §6, salvo donde se diga.

---

## 1 · La respuesta corta

**Sí se puede llevar sólo digital, y la norma lo contempla explícitamente.** No
es una zona gris. Pero lo permite *con carga extra*, y esa carga son **dos
documentos escritos y firmados por el regente** más un sistema que demuestre
cinco propiedades. Ninguna de las dos cosas la reemplaza el portal: el portal
**cumple** lo que esos documentos describen; los documentos hay que escribirlos.

Y la norma sigue **prefiriendo el papel**, así que el mes tiene que poder salir
impreso igual. Eso ya está (`npm run maqueta:bitacoras`, v2.965.0+).

---

## 2 · Lo que dice la norma, palabra por palabra

### 2.1 · La cláusula que habilita lo digital

> **RTS 6.1.14** — «Toda la documentación solicitada por este reglamento debe
> estar disponible dentro del establecimiento; **preferiblemente debe estar de
> manera física**. En caso de existir documentación digital ésta debe manejarse
> conforme a un **procedimiento/protocolo/guía, previamente autorizados por el
> Regente** y debe garantizar que todos los documentos sean **atribuibles,
> legibles, contemporáneos, originales y precisos**.»

Los cinco adjetivos son **ALCOA**, el principio de integridad de datos que se usa
en toda la industria farmacéutica. No son adorno: son la vara con la que se mide
si un registro digital sirve.

### 2.2 · La cláusula que pone las condiciones

> **RTS 6.1.15** — «En el caso de documentación digital se debe disponer de un
> **procedimiento para la supervisión del sistema electrónico**, que incluya el
> **nivel de acceso**, **resguardo de datos**, **forma de registro de datos**
> (según aplique), **respaldo** y **evaluación periódica**.»

### 2.3 · El ítem con el que lo verifican

> **Guía de Verificación 3.6** — «En el caso que los registros sean
> electrónicos, ¿se dispone de un protocolo para la supervisión del sistema
> electrónico que incluye el nivel de acceso, resguardo de datos, forma de
> registro de datos y evaluación periódica del sistema?» · **MAYOR**

Ojo dónde vive: en la sección **3, ANTIBIÓTICOS**. O sea que el inspector lo
pregunta al revisar el libro de dispensación bajo receta, que es justamente el
registro que más le importa.

### 2.4 · Y el que firma

> **RTS 6.1.12** — «Toda la documentación relacionada con los procedimientos e
> indicaciones dentro del establecimiento debe estar **revisado o autorizado por
> el regente, con su firma y sello profesional**.»
>
> **Guía 1.12** — «¿Los procedimientos se encuentran autorizados por el
> regente?» · **MAYOR**

### 2.5 · El modelo de controles, escrito en detalle

Está en el capítulo de droguerías —o sea que **no nos obliga**— pero es la
descripción más explícita que da el RTS de qué significan esos controles, y es la
que conviene copiar al escribir el protocolo:

> **RTS 5.3.9** — «Los documentos y los datos pueden estar registrados en forma
> impresa, por medios electrónicos o por medio de otro sistema. En el caso de
> almacenar la información de forma electrónica deben crearse controles
> especiales que incluya los niveles de acceso, resguardo de datos, respaldo y
> evaluación periódica. **Sólo las personas autorizadas deben ingresar o
> modificar los datos** en el sistema informático y **debe existir un registro de
> los cambios**; el acceso debe estar **restringido por contraseñas** u otros
> medios.»

---

## 3 · Los dos documentos que hay que escribir

Los dos los firma y sella el regente. Ninguno es largo.

### Documento A — Procedimiento de manejo de documentación digital (6.1.14)

Qué registros se llevan en el portal, quién los anota, en qué momento, cómo se
consultan y cómo se imprimen cuando la autoridad los pida. Es el que responde
«¿por qué esta bitácora no está en un libro?».

### Documento B — Protocolo de supervisión del sistema electrónico (6.1.15 / Guía 3.6)

**Cinco secciones obligatorias**, y conviene que se llamen igual que la norma
para que el inspector las encuentre:

| sección | qué tiene que decir |
|---|---|
| **Nivel de acceso** | quién entra, con qué rol, qué puede ver y qué puede escribir; cómo se da de alta y de baja a una persona |
| **Resguardo de datos** | dónde viven los datos, quién los administra, cuánto tiempo se conservan |
| **Forma de registro de datos** | cómo se anota una lectura, qué queda guardado con ella, y **qué pasa cuando alguien corrige** |
| **Respaldo** | cada cuánto se respalda, dónde queda la copia, cuánto se retiene y **cómo se restaura** |
| **Evaluación periódica** | cada cuánto se revisa que todo lo anterior siga siendo cierto, quién la hace y dónde queda constancia |

---

## 4 · Qué de eso ya cumple el portal — medido, no supuesto

| lo que pide | cómo se cumple hoy |
|---|---|
| **Atribuible** | `registrado_por` en toda lectura y limpieza, nunca opcional; el papel imprime nombre y hora (RTS 6.2.21) |
| **Legible** | el mes sale en carta con el formulario impreso, una hoja por área |
| **Contemporáneo** | la franja la decide la **base** contra la hora de El Salvador, nunca el reloj del navegador; una carga tardía queda marcada `tarde` |
| **Original** | la lectura se anota en el portal, no se transcribe de un papel |
| **Preciso** | corregir **no pisa**: `bitacora_correcciones` guarda `temperatura_antes`, `temperatura_despues`, `motivo`, `corregido_por` y `created_at` |
| **Nivel de acceso** | RBAC por rol y módulo; toda lectura del módulo pasa por `bitacora_exigir_acceso`, y las 7 tablas tienen RLS con policy explícita |
| **Sólo autorizados modifican** | ídem, más `audit_logs` para las acciones de usuario |
| **Registro de cambios** | `bitacora_correcciones`, que es append-only |
| **Acceso por contraseña** | sí, y el kiosco por carné + PIN |
| **Resguardo** | las 7 tablas viven en Supabase con RLS; ningún cron las purga (verificado: los 7 `purge-*` tocan sesiones, notificaciones, logs de sync y carnés temporales) |
| **Respaldo** | ⚠️ **ver abajo** |
| **Evaluación periódica** | ❌ **no existe** — hay que definirla en el Documento B |

---

## 5 · El hueco que apareció midiendo

**Ninguna de las 7 tablas de bitácoras estaba en el respaldo semanal.**

`backup-critical-tables` (domingos 08:00 UTC, retención 60 días) llevaba 23
tablas: personal, roles, permisos, planilla, vacaciones, parámetros de stock,
bitácora de auditoría. **Cero de bitácoras** — ni `bitacora_lecturas`, ni
`bitacora_limpiezas`, ni `bitacora_correcciones`, ni `bitacora_cierres`, ni
`bitacora_dispensaciones`, ni `bitacora_areas`, ni `bitacora_folios`.

Y es justo el registro que la norma manda conservar más tiempo:

- **RTS 6.2.16** — los registros de temperatura y humedad se conservan **2 años**.
- **Guía 3.12 / BPAD** — la dispensación bajo receta, **1 año**.
- **RTS 6.1.3** — el archivo de inspecciones, **3 años**.

O sea que el respaldo, que es una de las cinco secciones obligatorias del
protocolo, **no cubría lo que el protocolo iba a declarar**. Corregido: las 7
tablas entran al respaldo. Pesan 1.3 MB en total, así que no cambia nada del
costo.

**La lección es la de siempre en este repo:** «hay respaldo» era cierto como
frase y falso para estas tablas, y nada lo verificaba. Antes de declarar un
control en un documento que firma el regente, **abrir la lista y mirar si el
control alcanza lo que se está declarando.**

---

## 6 · Si en cambio eligen el papel

La Guía tiene el ítem espejo del 3.6, y conviene conocerlo porque define qué es
un «libro controlado»:

> **Guía 3.7** — «En el caso que los registros sean físicos ¿se dispone con
> **libros/formatos autorizados y controlados** debidamente, que incluye
> **numeración de hoja**, **responsables de registro**, **responsables de
> autorización**, **control de correcciones**?» · **MAYOR**

De esas cuatro cosas, la hoja impresa de hoy tiene tres —código y versión de
formulario, la firma de quien registra (jefe de sala) y la de quien autoriza
(regente)— y **le falta la numeración de hoja**. Si alguna vez se decide llevar
el libro en papel como registro primario, ése es el cambio.

---

## 7 · Lo que hay que tener presente igual

**La preferencia por el papel no desaparece.** 6.1.14 dice «preferiblemente de
manera física», así que la respuesta a «muéstreme la bitácora» no puede ser
«déjeme prender la computadora». Por eso el mes se imprime, y por eso la hoja
tiene forma de formulario y no de reporte.

**La bitácora de visitas del regente sigue siendo libro físico** (Guía 2.23), y
ésa es una decisión ya tomada — ver `docs/AUDITORIA-BITACORAS-SRS-2026-08-25.md`.

**Y la Guía de Verificación es un subconjunto del RTS, no su resumen.** Su ítem
2.34 sólo pregunta por «la fecha y persona» de la lectura, y el RTS 6.2.21 exige
además la **hora**. Cumplir la guía no es cumplir la norma.
