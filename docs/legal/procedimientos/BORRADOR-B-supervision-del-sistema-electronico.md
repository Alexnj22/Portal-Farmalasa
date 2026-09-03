> **BORRADOR.** Lo redactó el portal con lo que el sistema hace hoy, medido el
> 2026-09-03. **No tiene valor hasta que el regente lo revise, lo ajuste y lo
> firme y selle.** Lo que va entre `[corchetes]` es una decisión o un dato que
> sólo la empresa puede poner.
>
> **Antes de firmarlo hay que resolver el punto 2.3.** Hoy el cierre mensual
> —que es el equivalente de la firma del regente— lo pueden hacer **cinco
> cargos**, no sólo el regente. Este documento no se puede firmar diciendo lo
> contrario.

---

# Protocolo de supervisión del sistema electrónico

| | |
|---|---|
| **Código** | `[FLS-PRO-02]` |
| **Versión** | 1.0 |
| **Fecha de emisión** | `[dd/mm/aaaa]` |
| **Elaborado por** | `[nombre y cargo]` |
| **Revisado y autorizado por** | `[nombre del regente]` · JVPM `[n.º]` |
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

**Identificación del sistema**

| | |
|---|---|
| Nombre | `[Portal Farmalasa]` |
| Responsable | `[nombre y cargo]` |
| Proveedor de infraestructura | Supabase (base de datos PostgreSQL y almacenamiento) |
| Ubicación de los datos | Estados Unidos, región `us-east-1` |

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

### 2.3 · Lo que hay que decidir antes de firmar

**El cierre mensual es el equivalente digital de la firma y sello del regente**
(numeral 6.1.12). Hoy lo pueden hacer **cinco cargos**, y de hecho el único
cierre registrado hasta la fecha **no lo hizo el regente**.

Dos salidas, y hay que elegir una:

- **(a)** Dejar el cierre **sólo al Regente** (y, si se quiere, a un suplente
  nombrado por escrito). Es lo que hace que el cierre valga como su firma.
- **(b)** Mantener los cinco cargos, y entonces **este documento no puede decir
  que el regente autoriza el mes**: habría que declarar que el regente firma la
  hoja impresa y que el cierre en el sistema es sólo un control operativo.

`[Decisión: ____________________ ]`

### 2.4 · Alta y baja de cuentas

- **Alta** — la solicita `[cargo]` y la ejecuta `[cargo]`, asignando el cargo que
  corresponde. No se crean cuentas sin cargo.
- **Cambio de cargo** — se actualiza el cargo; los permisos cambian solos.
- **Baja** — al terminar la relación laboral, `[cargo]` **bloquea el acceso el
  mismo día**. Las anotaciones que la persona hizo **no se borran ni cambian de
  autor**: el registro histórico conserva quién lo hizo.

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
- **Toda salida de datos queda anotada**: quién exportó, qué módulo, en qué
  formato y cuántas filas.

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
- Toda acción de usuario queda en una **bitácora de auditoría** aparte, que
  registra quién hizo qué y cuándo.

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

**Cómo se restaura.** `[Describir el procedimiento: quién lo autoriza, quién lo
ejecuta, y dónde queda la constancia de la restauración.]`

**Prueba de restauración.** `[Decidir la frecuencia — se sugiere una vez al año —
y dejar constancia. Un respaldo que nunca se restauró no está comprobado.]`

---

## 6 · Evaluación periódica

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
   archivados.

**Dónde queda la constancia:** `[definir]`. Debe incluir la fecha, quién la hizo,
lo encontrado y las acciones tomadas.

---

## 7 · Referencias

- RTS 11.02.04:24, numerales 6.1.12, 6.1.14, **6.1.15**, 6.1.3, 6.2.16, 6.2.21
- Guía de Verificación de Buenas Prácticas de Almacenamiento y Dispensación de
  Establecimientos que Dispensan Medicamentos, ítem **3.6**
- `[FLS-PRO-01]` — Procedimiento para el manejo de documentación digital

## 8 · Control de cambios

| versión | fecha | qué cambió |
|---|---|---|
| 1.0 | `[dd/mm/aaaa]` | Emisión inicial |
