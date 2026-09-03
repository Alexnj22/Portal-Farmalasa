> **BORRADOR.** Lo redactó el portal con lo que el sistema hace hoy, medido el
> 2026-09-03. **No tiene valor hasta que el regente lo revise, lo ajuste y lo
> firme y selle.** Lo que va entre `[corchetes]` es una decisión o un dato que
> sólo la empresa puede poner.

---

# Procedimiento para el manejo de documentación digital

| | |
|---|---|
| **Código** | `[FLS-PRO-01]` |
| **Versión** | 1.0 |
| **Fecha de emisión** | `[dd/mm/aaaa]` |
| **Elaborado por** | `[nombre y cargo]` |
| **Revisado y autorizado por** | `[nombre del regente]` · JVPM `[n.º]` |
| **Próxima revisión** | `[dd/mm/aaaa]` |

---

## 1 · Objeto

Establecer cómo se generan, conservan, consultan e imprimen los registros que
este establecimiento lleva en forma digital, de manera que cumplan lo exigido
por el **RTS 11.02.04:24, numeral 6.1.14**: que sean **atribuibles, legibles,
contemporáneos, originales y precisos**.

## 2 · Alcance

Aplica a los registros que se llevan en el sistema informático del
establecimiento (en adelante, «el sistema»):

| registro | frecuencia | conservación |
|---|---|---|
| Temperatura y humedad relativa de sala de ventas y bodega | 3 veces al día | **2 años** (RTS 6.2.16) |
| Limpieza y orden por área | por turno | `[1 año]` |
| Dispensación bajo receta (libro foliado) | por dispensación | **1 año** (Guía BPAD 3.12) |
| Cierre mensual y su autorización | mensual | `[2 años]` |

**No aplica** a la bitácora de visitas del regente, que este establecimiento
lleva en **libro físico** por decisión propia (Guía 2.23 · RTS 6.3.7), ni a la
documentación que por su naturaleza es un original en papel (licencias,
facturas, certificados, contratos).

## 3 · Responsabilidades

| quién | qué |
|---|---|
| **Personal de sala y bodega** | Anotar la lectura o la limpieza **en el momento en que se realiza**, desde el sistema, con su propia cuenta |
| **Jefe/a de sala** | Verificar diariamente que no queden casillas sin anotar y firmar la hoja impresa del mes |
| **Regente** | Revisar el mes, autorizar su cierre en el sistema, y firmar y sellar la hoja impresa |
| **Administración del sistema** | Alta y baja de cuentas, respaldo, y la evaluación periódica descrita en el `[FLS-PRO-02]` |

## 4 · Desarrollo

### 4.1 · Cómo se registra

La lectura se anota **directamente en el sistema**, en el momento en que se
toma. No se transcribe de un papel: el registro del sistema **es el original**.

Cada anotación queda con:

- el **valor** medido (temperatura en °C y humedad relativa en %),
- el **área** y la **franja horaria** a la que corresponde,
- la **fecha y la hora reales** de la anotación,
- la **persona** que la realizó, identificada por su propia cuenta.

La franja horaria y el estado de la anotación los determina **el servidor**
contra la hora oficial de El Salvador, no el reloj del equipo desde el que se
anota. Una anotación hecha fuera de su franja **queda marcada como tal** y no se
puede presentar como hecha a tiempo.

### 4.2 · Cuando el valor está fuera del rango permitido

El sistema **no acepta** una lectura fuera del rango sin que se anote la acción
correctiva tomada. La acción queda unida a la lectura y se imprime al pie de la
hoja del mes, conforme al numeral 5.6.5.

### 4.3 · Correcciones

**Ningún dato se borra ni se sobrescribe.** Corregir una lectura **agrega** un
registro de corrección que conserva el valor anterior, el valor nuevo, el motivo
y la persona que corrigió, con su fecha y hora. El valor original sigue siendo
consultable.

### 4.4 · Cierre mensual

Terminado el mes, el regente revisa el resumen —cumplimiento, casillas sin
anotar, desviaciones y su acción correctiva— y **autoriza el cierre en el
sistema**. El cierre es el equivalente digital de su firma y sello (numeral
6.1.12) y queda registrado con su nombre, fecha y hora.

Un mes cerrado **no admite anotaciones nuevas**. Reabrirlo exige un motivo
escrito y queda registrado.

### 4.5 · Impresión

El numeral 6.1.14 **prefiere la documentación física**. Por eso el mes se
imprime en formulario controlado, en tamaño carta, **una hoja por área**, con:

- el código y la versión del formulario,
- el establecimiento, el área, el mes y el rango permitido,
- el instrumento con el que se mide,
- cada día con su valor, la persona y la hora,
- las desviaciones con su acción correctiva,
- la firma del jefe de sala y la firma y sello del regente.

**Se imprime y se archiva el mes cerrado**, y se conserva por el plazo del
punto 2. La copia impresa se entrega a la autoridad cuando la requiera, sin
necesidad de acceder al sistema.

### 4.6 · Consulta

Cualquier persona autorizada consulta los registros desde el sistema. La
autoridad reguladora los recibe en la copia impresa del punto 4.5 o, si lo
solicita, en archivo.

## 5 · Cómo se cumple el numeral 6.1.14

| lo que exige | cómo se cumple |
|---|---|
| **Atribuible** | Toda anotación lleva la persona que la hizo, identificada por su cuenta. Nadie anota por otro |
| **Legible** | El mes se imprime en formulario controlado, y el sistema lo muestra en pantalla |
| **Contemporáneo** | Se anota en el momento; la hora la fija el servidor y una anotación tardía queda marcada |
| **Original** | El registro del sistema es el primario; el papel es su copia impresa, no al revés |
| **Preciso** | Nada se borra: las correcciones se agregan con valor anterior, motivo y autor |

## 6 · Documentos relacionados

- `[FLS-PRO-02]` — Protocolo de supervisión del sistema electrónico (RTS 6.1.15)
- Formularios `FLS-BIT-00` a `FLS-BIT-03` — hojas impresas del mes

## 7 · Referencias

- RTS 11.02.04:24, numerales 6.1.12, 6.1.14, 6.1.15, 6.2.11, 6.2.15, 6.2.16, 6.2.21
- Guía de Verificación de Buenas Prácticas de Almacenamiento y Dispensación de
  Establecimientos que Dispensan Medicamentos, ítems 1.12, 2.27, 2.34, 3.6

## 8 · Control de cambios

| versión | fecha | qué cambió |
|---|---|---|
| 1.0 | `[dd/mm/aaaa]` | Emisión inicial |

---

**Revisado y autorizado por:**

<br/><br/>

`________________________________`
`[Nombre del regente]` · JVPM `[n.º]`
Firma y sello · `[dd/mm/aaaa]`
