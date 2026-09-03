> **BORRADOR.** Lo redactó el portal con lo que el sistema hace hoy, medido el
> 2026-09-03. **No tiene valor hasta que el regente lo revise, lo ajuste y lo
> firme y selle.** Lo que va entre `[corchetes]` es una decisión o un dato que
> sólo la empresa puede poner.
>
> ⚠️ **Revisado contra la norma y contra producción el 2026-09-03** — el informe
> está en `docs/VERIFICACION-PROCEDIMIENTOS-DIGITALES-2026-09-03.md`. Quedan
> **dos correcciones de sistema pendientes**, marcadas abajo con `⛔`: anular una
> limpieza hoy la BORRA sin dejar rastro, y corregirla pisa el valor anterior.
> **Este documento no se puede firmar hasta que las dos estén hechas**, porque el
> punto 4.3 diría lo contrario de lo que el sistema hace.

---

# Procedimiento para el manejo de documentación digital

| | |
|---|---|
| **Código** | `[FLS-PRO-01]` |
| **Versión** | 1.0 |
| **Fecha de emisión** | `[dd/mm/aaaa]` |
| **Elaborado por** | `[nombre y cargo]` |
| **Revisado y autorizado por** | `[nombre del regente]` · JVPM `[n.º]` |
| **Sustituye a** | — (emisión inicial) |
| **Próxima revisión** | `[dd/mm/aaaa]` |

---

## 1 · Objeto

Establecer cómo se generan, conservan, consultan e imprimen los registros que
este establecimiento lleva en forma digital, de manera que cumplan lo exigido
por el **RTS 11.02.04:24, numeral 6.1.14**: que sean **atribuibles, legibles,
contemporáneos, originales y precisos**.

Y de manera que el archivo electrónico cumpla los mínimos que la
**Ley de Firma Electrónica (D.L. 133/2015), Art. 13-A** exige para conservar por
cuenta propia un documento que la ley manda guardar por un plazo: que pueda
**consultarse en cualquier momento**, que se **conserve el formato** en que se
generó (o una reproducción exacta), y que se mantenga **íntegro, legible,
completo y sin alteraciones**.

## 2 · Alcance

Aplica a los registros que se llevan en el sistema informático del
establecimiento (en adelante, «el sistema»):

| registro | frecuencia | conservación |
|---|---|---|
| Temperatura y humedad relativa de **sala de ventas** y **bodega** | **no menos de dos veces al día** (RTS 6.2.16); este establecimiento realiza **tres** | **2 años** (RTS 6.2.16) |
| Temperatura del **refrigerador** de medicamentos (2 °C a 8 °C) | **dos veces al día** (RTS 6.2.20) | **2 años** (RTS 6.2.16) |
| Limpieza y orden de **sala de ventas, bodega, vitrinas y servicio sanitario** | por turno | `[1 año]` |
| Dispensación bajo receta (libro foliado) | por dispensación | **1 año** (Guía BPAD 3.12) |
| Cierre mensual y su autorización | mensual | `[2 años]` |

La frecuencia se declara con su piso normativo a propósito: hacer más que el
mínimo está bien, pero un día con dos lecturas de sala no incumple el RTS y sí
incumpliría este procedimiento si acá dijera «3» a secas.

**El refrigerador se registra en las salas que lo tienen** y donde se conservan
medicamentos que lo requieren (RTS 6.2.18). Su termómetro debe estar **calibrado**
si se manejan productos de cadena de frío (RTS 6.2.19 · Guía 2.32, CRÍTICO).

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
La única excepción es la contingencia del punto 4.7.

Cada anotación queda con:

- el **valor** medido (temperatura en °C y humedad relativa en %),
- el **área** y la **franja horaria** a la que corresponde,
- la **fecha y la hora reales** de la anotación,
- la **persona** que la realizó, identificada por su propia cuenta.

La franja horaria y el estado de la anotación los determina **el servidor**
contra la hora oficial de El Salvador, no el reloj del equipo desde el que se
anota. Una anotación hecha fuera de su franja **queda marcada como tal** y no se
puede presentar como hecha a tiempo.

**Verificación de exactitud.** La temperatura se teclea a mano, así que el valor
depende de quien lee el instrumento. La revisión diaria del jefe/a de sala
descrita en el punto 3 es la segunda mirada sobre ese dato.

### 4.2 · Cuando el valor está fuera del rango permitido

El rango permitido lo fija la norma: **no más de 30 °C** en sala de ventas y
bodega (RTS 6.2.15) y **de 2 °C a 8 °C** dentro del refrigerador (RTS 6.2.20), o
lo que declare el empaque del producto.

El sistema **no acepta** una lectura fuera de ese rango sin que se anote la acción
correctiva tomada. La acción queda unida a la lectura y se imprime al pie de la
hoja del mes.

La acción correctiva debe dejar constancia de:

- **qué se hizo** para devolver el área a su rango,
- **qué productos y lotes** estuvieron expuestos,
- **cuántas horas** estuvieron fuera de rango y **a qué temperatura** (si no hay
  registrador continuo, se cuenta desde la última lectura buena),
- la **decisión del regente**: si el producto se sigue dispensando o se separa.

`[El regente define el criterio de decisión.]` Mientras esa decisión no esté
tomada y anotada, **el producto afectado no se dispensa**.

### 4.3 · Correcciones

**Corregir una lectura no la pisa: agrega.** La corrección de una lectura de
temperatura o humedad **agrega** un registro que conserva el valor anterior, el
valor nuevo, el motivo y la persona que corrigió, con su fecha y hora. El valor
original sigue siendo consultable, y la corrección se imprime en la hoja del mes.

**Un mes ya cerrado no admite correcciones**: hay que reabrirlo (punto 4.4).

⛔ **Pendiente de corrección en el sistema — sin esto, este punto no es cierto:**

| lo que falta | hoy | cómo debe quedar |
|---|---|---|
| Corregir una **limpieza** | pisa lo anterior; sólo quedan quién, cuándo y por qué | conservar también el valor anterior, como en las lecturas |
| Anular una **limpieza** | **la borra**: pide motivo, no lo guarda, y la fila desaparece sin rastro | marcarla como anulada con motivo, autor y fecha, sin borrar la fila (como ya se hace con la dispensación) |

Un borrado sin rastro contradice el numeral 6.1.14 («originales y precisos») y
hace perder al archivo el valor legal que le da el **Art. 14 de la Ley de Firma
Electrónica**, cuyo último inciso dice que la alteración que afecte la integridad
del documento almacenado le quita ese valor.

La **dispensación bajo receta** no se borra: se **anula** dejando el motivo, el
detalle, quién la anuló y cuándo.

### 4.4 · Cierre mensual

Terminado el mes, el regente revisa el resumen —cumplimiento, casillas sin
anotar, desviaciones y su acción correctiva— y **autoriza el cierre en el
sistema**. El cierre queda registrado con el nombre de quien lo hizo, la fecha y
la hora.

**Qué vale como firma, y qué no.** Lo que cumple el numeral **6.1.12** —«revisado
o autorizado por el regente, con su **firma y sello profesional**»— es **la hoja
impresa del mes, firmada y sellada por el regente**. El cierre en el sistema es
un control interno y, ante la ley, una **firma electrónica simple**: tiene la
misma validez jurídica que la autógrafa, pero **no la misma fuerza probatoria**
(Ley de Firma Electrónica, Art. 6). El sello profesional, además, es del
colegiado y no del sistema.

Por eso el mes **no queda cerrado del todo hasta que la hoja está impresa,
firmada y sellada** (punto 4.5).

Un mes cerrado **no admite anotaciones nuevas ni correcciones**. Reabrirlo exige
un motivo escrito, sólo lo puede hacer quien tenga esa facultad según el
`[FLS-PRO-02]`, y queda registrado con su nombre, fecha y hora.

### 4.5 · Impresión

El numeral 6.1.14 **prefiere la documentación física**. Por eso el mes se
imprime en formulario controlado, en tamaño carta, **una hoja por área**, con:

- el código y la versión del formulario,
- el establecimiento, el área, el mes y el rango permitido,
- el instrumento con el que se mide y, cuando corresponde, su calibración
  (`[hay que cargarlo en la configuración de cada área: hoy está en blanco en las
  14 áreas que miden temperatura]`),
- cada día con su valor, la persona y la hora,
- las desviaciones con su acción correctiva,
- la firma del jefe de sala y la firma y sello del regente.

**Se imprime y se archiva el mes cerrado**, y se conserva por el plazo del
punto 2. **El archivo queda físicamente en cada establecimiento** —`[definir el
lugar]`— porque el numeral 6.1.14 exige que la documentación esté disponible
**dentro del establecimiento**, y los datos del sistema no residen en el país.
La copia impresa se entrega a la autoridad cuando la requiera, sin necesidad de
acceder al sistema.

### 4.6 · Consulta

Cualquier persona autorizada consulta los registros desde el sistema. La
autoridad reguladora los recibe en la copia impresa del punto 4.5 o, si lo
solicita, en archivo.

### 4.7 · Cuando el sistema no está disponible

Las lecturas del punto 2 **no se suspenden** porque el sistema no esté
disponible. Si al momento de una franja el sistema no responde:

1. La lectura se toma igual y se anota en la **hoja de contingencia**
   `[FLS-BIT-99]`, en papel, con fecha, hora, valor, área y nombre de quien la
   toma. La hoja es un formulario controlado, igual que las demás.
2. **Apenas el sistema vuelve**, la misma persona la carga y **anota en el motivo
   que proviene de contingencia**, con la hora real de la lectura. Queda marcada
   como anotación tardía, que es lo correcto: se anotó después.
3. **La hoja de papel se archiva junto al mes impreso** y no se destruye. Es el
   respaldo de que la lectura se tomó a tiempo aunque se haya cargado después.

`[El regente define a quién se avisa cuando el sistema no responde y a partir de
cuánto tiempo.]`

Ésta es la única vía por la que un dato entra transcrito de papel, y por eso
queda identificada: en cualquier otro caso el registro del sistema es el
original.

## 5 · Cómo se cumple el numeral 6.1.14

| lo que exige | cómo se cumple |
|---|---|
| **Atribuible** | Toda anotación lleva la persona que la hizo, identificada por su cuenta. Nadie anota por otro |
| **Legible** | El mes se imprime en formulario controlado, y el sistema lo muestra en pantalla |
| **Contemporáneo** | Se anota en el momento; la hora la fija el servidor y una anotación tardía queda marcada |
| **Original** | El registro del sistema es el primario; el papel es su copia impresa, no al revés |
| **Preciso** | La corrección de una lectura se **agrega** con el valor anterior, el motivo y el autor; la dispensación se anula, no se borra. ⛔ Falta cerrar lo mismo para las limpiezas (punto 4.3) |

## 6 · Documentos relacionados

- `[FLS-PRO-02]` — Protocolo de supervisión del sistema electrónico (RTS 6.1.15)
- Formularios `FLS-BIT-00` a `FLS-BIT-03` — hojas impresas del mes `[adjuntar
  como anexos de este procedimiento]`
- Formulario `[FLS-BIT-99]` — hoja de contingencia (punto 4.7)
- `[Programa anual de capacitaciones]` (RTS 6.3.2) — este procedimiento es uno de
  sus temas, y su capacitación debe quedar registrada (RTS 6.3.4)

## 7 · Referencias

- RTS 11.02.04:24 — **capítulo 6** (farmacias, botiquines y otros
  establecimientos que dispensan), numerales 6.1.12, 6.1.14, 6.1.15, 6.2.11,
  6.2.15, 6.2.16, 6.2.18, 6.2.19, 6.2.20, 6.2.21, 6.3.2, 6.3.4
- Guía de Verificación de Buenas Prácticas de Almacenamiento y Dispensación de
  Establecimientos que Dispensan Medicamentos, ítems 1.12, 2.27, 2.29, 2.32,
  2.33, 2.34
- Ley de Firma Electrónica (D.L. 133/2015), artículos 6, 7, 11, 12, 13-A y 14

> El capítulo **5** del RTS es de laboratorios, droguerías y centros de
> almacenamiento: **no aplica a este establecimiento** y no se cita acá.

## 8 · Control de cambios

| versión | fecha | qué cambió |
|---|---|---|
| 1.0 | `[dd/mm/aaaa]` | Emisión inicial |
