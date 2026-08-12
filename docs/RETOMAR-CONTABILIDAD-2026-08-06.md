# Retomar — contabilidad y pendientes (2026-08-06)

Estado al cierre de la sesión del 2026-08-05/06. **Empezar por acá**; los planes
grandes (`PLAN-CONTABILIDAD-2026-08-02.md`, `AUDITORIA-COMPLETA-2026-07-30.md`)
siguen valiendo, pero varias de sus conclusiones cambiaron y este documento dice
cuáles.

---

## 0. Lo único que quedó a medias, y es de un minuto

**`Resumen Fiscal` (v2.406.0) nunca se abrió en el navegador.** Compila, los tres
gates pasan en verde y el RPC responde bien —incluido el `FORBIDDEN` a quien no
tiene permiso—, pero **la regla del proyecto es que eso no prueba nada sobre lo
que se ve**. Los números están verificados contra la base; el render no.

**Primer paso al retomar:** abrir *Datos Contables → Resumen Fiscal*, revisar el
DOM pintado más `title`/`aria-label`/`placeholder`, y confirmar que ningún texto
nombra el sistema de origen.

**Y lo segundo, que tiene fecha de vencimiento:** las **13 facturas de agosto sin
sello** (§8.2). Si obtienen el suyo antes de que agosto se declare, no hay
exposición de ningún tipo. Después, sí. Ver §7 y §8 completos — el incidente de
los sellos es lo más denso de este documento.

---

## 1. El cambio de encuadre más importante de la sesión

> **Alex, 2026-08-05:** *«el sistema de origen no registra todas. El contador
> rearma el libro de IVA, anexando eso, las retenciones y las notas de crédito a
> mano. Los descarga de Facturas de Compras.»*

Esas dos frases invalidan la lectura con la que se venía trabajando:

| Lo que se creía | Lo que es |
|---|---|
| Los 400 CCF sin registrar son **crédito fiscal que se pierde** ($5,825) | **No se pierde**: la contadora los anexa a mano. Es la lista del trabajo manual, no una pérdida |
| Las 128 notas de crédito no restadas son **riesgo de multa** | **No hay riesgo**: las resta a mano al declarar. Se cae el único punto sancionable del plan |
| El libro del portal es el libro | **Es un insumo.** El que se presenta se arma afuera, a mano, cada mes |
| Habría que averiguar de dónde saca los documentos | **De Facturas de Compras, el módulo del portal.** O sea que trabaja sobre el mismo conjunto que tenemos |

**Y una cosa que esto empeora, no mejora:** si el libro declarado se arma a mano y
por fuera, **no existe en ningún sistema**. No se puede reproducir ni probar qué
se declaró. La deriva ya está medida (H30: el libro de junio cambió después de
junio). El **Bloque D deja de ser opcional** — ver §4.

---

## 2. Lo que se hizo (todo aplicado y pusheado)

| # | Qué | Versión |
|---|---|---|
| Seguridad | Las 2 policies `WITH CHECK (true)` (`audit_logs`, `attendance`) + la autoría del log sale de la sesión, no de localStorage | v2.397.1 |
| Seguridad | El enrutador de aprobadores dejó de consultar `is_admin` (columna inexistente) → `system_role IN ('ADMIN','SUPERADMIN')` | v2.397.1 |
| Seguridad | `get_kiosk_coverage_employees` era **anon, sin token, y devolvía el `kiosk_pin`** de cualquier sucursal. Ahora exige `device_id`/`device_token` y el PIN no viaja | v2.397.1 |
| Rendimiento | Fase B: B1 (CSP en Report-Only), B3 (catálogo del tablero al primer tecleo), B4 (dos escrituras por carga), B5 (el `await` que serializaba el arranque) | v2.397.2 |
| Contabilidad | **E1 — el costo de venta se congela al insertar la línea** | v2.398.0 |
| Higiene | Los **28 `error-ignorado` → 0**, 13 edge functions redesplegadas | v2.398.2 |
| Contabilidad | **Resumen Fiscal** — movimiento del mes + pago a cuenta | v2.406.0 |

Detalle de cada uno en `CHANGELOG.md`.

---

## 3. Preguntas para la contadora — la lista viva

Dos de las que estaban abiertas **ya se respondieron** (ver §1). Estas quedan, en
orden de valor:

### 3.1 · La comparación de un mes — es la prueba que vale

Tomar **un mes ya declarado** (junio o julio) y cruzar **su libro** contra el que
arma **Compras Completo**, línea por línea.

- Si cuadran → el portal puede reemplazar el armado manual. Ese trabajo ya está
  construido; no hay que pedirle que cambie de método, sólo que lo contraste.
- Si no cuadran → **la diferencia es exactamente lo que hoy no ve nadie**.

**Lo que hace falta para hacerlo: su archivo de junio o julio.** Con eso el cruce
se hace en una sesión.

### 3.2 · El salto de percepción en junio

La percepción pasa de **6-9 documentos por mes** (feb-may) a **226-249**
(jun-jul), con el conteo de compras estable (326-467). Dos explicaciones y no se
decide desde la base:

1. Los proveedores **empezaron** a percibir en junio, o
2. el campo **empezó a capturarse** en junio.

**Importa en plata**: la percepción es un anticipo que reduce lo que se paga. Si
existía antes y no se registraba, se pagó de más.

### 3.3 · Las notas de crédito, ahora que sabemos que las resta a mano

Ya no es «¿quiere que el libro las reste?» sino **«¿quiere que el portal le
entregue el libro ya armado —documentos anexados, notas restadas, retenciones
sumadas— en vez de armarlo a mano cada mes?»**.

### 3.4 · Confirmar la tasa del régimen

El portal usa **1.75%** (Art. 151 CT, verificado en `docs/legal/`). Confirmar que
es el régimen de la empresa y no otro.

### 3.5 · El anticipo del 2% por tarjeta (Art. 162-A)

Apareció leyendo el Código y **no estaba en ningún cálculo previo**. En julio son
**$407.15** sobre $20,357.62 cobrados con tarjeta. Lo retiene el procesador, así
que el portal sólo puede estimarlo. **¿Se está acreditando?** Se confirma en el
estado de cuenta del procesador, no en la base.

---

## 4. Bloque D — por qué ahora es prerrequisito y no mejora

`Resumen Fiscal` calcula el **movimiento del mes**. No puede dar el **saldo a
pagar** porque le falta una sola línea: **el remanente de crédito fiscal del mes
anterior**. El impuesto es encadenado y ese saldo sólo existe en lo que se
declaró — que hoy no se guarda en ningún lado.

Con el cierre de período en pie, la cadena se cierra sola: el remanente del mes
cerrado es el punto de partida del siguiente.

**Alex lo dejó explícitamente sin aplicar el 2026-08-05.** Queda escrito acá para
que, cuando se retome, no haya que volver a descubrir por qué importa.

---

## 5. Lo demás que sigue abierto

**Del plan de contabilidad:** C4 (2 vs 4 decimales, espera al contador) · E3
(anexo de retención de Renta construido, **0 proveedores marcados** — necesita
que ella diga cuáles de los 14 candidatos aplican) · las 4 «cosas chicas»
aprobadas y no hechas.

**De la auditoría del 2026-07-30:** Fase B — **B2** (separar vendors del entry) y
**B6** (que la ruta no suspenda), los dos piden medición antes y después. Fase C
— **C2** (login y recarga arman el perfil por caminos distintos), **C3** (medir
el preloader en un teléfono real), **C4** (ventana mínima en el refresco por
`visibilitychange`). **C1 quedó cerrado.**

**Del barrido de autorización:** `notify_branch` / `notify_employees` (cualquier
autenticado puede notificar a una sucursal entera con texto libre) y
`resumen_ventas_diario` (lee cualquier sucursal sin mirar alcance). Ninguna
filtra credenciales. Además las **6 cuentas `@staff.local`** y **2
`@farmalasa.app`** huérfanas en `auth.users`.

**Proveedores — ninguno se arregla con código:** `BANCO PROMÉRICA` no tiene
contraparte en el origen, así que no hay a qué vincularlo. `PROVEEDOR PRUEBA`
**existe en el origen** (id 53459), así que borrarlo del portal lo traería de
vuelta en el próximo sync: hay que borrarlo allá. Mientras tanto es inerte (0
compras, 0 documentos).

**Cerrados por decisión, no por trabajo:** H5b (`categoria_id` en los documentos
de compra) — ya estaba fuera de alcance desde el 2026-07-29, este módulo captura
y conserva, no procesa. Metas A6/A8/A9 y el Bloque D: Alex dijo que no se
aplican por ahora.

---

## 6. Datos que no hace falta volver a descubrir

- **El lado de ventas está completo**: las 22,429 facturas de julio tienen sello
  de 40 caracteres. El filtro del libro no deja ninguna afuera.
- **`sales_invoice_items.id_presentacion` está en NULL en las 584,750 filas.** Es
  columna muerta. El cruce de costo va por `(erp_product_id, factor_unidades)`
  contra `product_precios(product_id, factor)` — 96.8% resuelto.
- **La captura de documentos de compra arrancó el 2026-05-13.** No hay historia
  anterior; por eso mayo tiene 11 CCF sin cruce y junio 166.
- **Julio compró más de lo que vendió** ($234,534 gravadas contra $214,046). Puede
  ser reabastecimiento y ser normal — es lo primero que conviene que ella mire.
- Los libros de ventas y los cortes Z **no tocan ninguna tabla de compras**
  (verificado sobre los 7 RPC). Lo de compras no los afecta; se encuentran recién
  en la declaración.
- **La cuota del mes ya está medida** (2026-08-11): de los $12,331.29 de junio, el
  IVA se reproduce a $5.38 de lo declarado y el 59% depende de la planilla, que
  sigue en cero filas. Y el residuo del IVA apunta al crédito fiscal de compras —
  389 documentos nuestros contra 489 recibidos, más 58 notas de crédito que no
  entran a ningún libro. Está en `CONTABILIDAD-ALCANCE-2026-08-01.md` §5, y la
  conciliación de los anexos contra los archivos del contador en
  `ANEXOS-HACIENDA-2026-08-11.md` §8.

---

## 7. La venta que se transmite tarde — a qué mes pertenece (2026-08-06)

Pregunta de Alex: *«si una venta se efectuó en julio pero no se transmitió a
Hacienda, y la retransmito ahora, ¿dónde entra?»*

**Entra en JULIO.** El período lo fija la **fecha de emisión**, no la de
transmisión, y el documento conserva su fecha y su código de generación
originales (guía técnica: el lote de contingencia se manda «utilizando para cada
DTE el detalle de los códigos de generación previamente notificados»).

### Lo que dice la norma

- **Art. 119-D CT**: el documento adquiere el carácter de DTE **cuando obtiene el
  sello de recepción**. Antes del sello **no es un documento tributario**. Por eso
  los libros del portal filtran por sello de 40 caracteres — no es una decisión
  de diseño, es la definición legal.
- **Art. 119-F CT (contingencia)**: ante fuerza mayor que impida transmitir, se
  entrega igual el documento al cliente, se transmite después un **evento de
  contingencia** listando los no transmitidos, y luego **la totalidad de esos
  documentos**, ambos dentro del plazo que fije Hacienda. Hecho así, **no aplica
  la sanción** del Art. 239-A literales g) y h).

### Las dos ramas, y la consecuencia de cada una

| | Qué pasa |
|---|---|
| **Llega el sello** | El documento entra al libro de **julio**. Si julio ya se declaró, la declaración quedó corta → **modificatoria de julio** |
| **No llega el sello** | Nunca fue documento tributario. Hay una venta comercial sin documento fiscal válido. Es problema para la contadora, no de sistema |

### La consecuencia que sí es del portal

**El libro de julio se reconstruye entero cada vez que se exporta.** El día que
llegue ese sello, julio sale distinto de como salió ayer, **sin que nada avise**.
Lo mismo vale para `Resumen Fiscal`, que recalcula el mes desde cero.

Es la deriva de H30 con un mecanismo concreto y no hipotético — y es exactamente
para lo que sirve el **Bloque D**: sin registro de lo declarado, no hay forma de
saber si ese documento ya estaba adentro o no.

### Medido el 2026-08-06

- **Julio: 0 ventas sin sello.** Las 22,429 tienen el suyo. El caso **no ocurrió**
  en julio.
- Junio: 1 sin sello, pero su estado es **NULA** — nunca necesitó uno.
- **Agosto (mes en curso): 13 ventas FINALIZADAS sin sello**, la más vieja del
  **1 de agosto — 5 días**. $172.80 en total, **$19.89 de IVA**, repartidas en 5
  sucursales (2, 4, 27, 28, 29). Montos de $1.00 a $39.85.

**Agosto cierra en días.** Si esas 13 no obtienen su sello antes de la
declaración, son literalmente el caso de la pregunta.

### El control existe, pero supone que se arregla solo

`check-sales-reconciliation` ya detecta la causa `sin_sello` y la explica bien:
*«El portal lo tiene, pero todavía sin el sello de Hacienda, así que no entra al
libro. Se corrige solo cuando el sello llega.»*

**El hueco es el «se corrige solo».** Nada escala cuando el sello NO llega: a los
5 días se reporta igual que a las 5 horas. Falta un umbral que convierta
«transitorio» en «alguien tiene que mirar esto».

### Lo que el portal no puede distinguir

Un sello ausente en el portal puede ser (a) que el documento no se transmitió, o
(b) que se transmitió y el sello todavía no llegó al portal. **Desde la base no
se distingue** — se confirma en el origen o en el portal de Hacienda.

### 7.bis · ¿Y si el documento es de un mes ya declarado? (mayo)

Misma regla de período —entra en **mayo**— pero mayo **ya se declaró**, y eso
agrega tres cosas que julio no tenía.

**1. La modificatoria hacia arriba no tiene plazo; hacia abajo sí.**

- **Art. 101 CT**: las declaraciones «pueden ser modificadas **en cualquier
  tiempo y circunstancia** para **aumentar el impuesto** o disminuir el
  excedente a favor» — *sin perjuicio de las sanciones que correspondan*. Sumar
  ventas a mayo va en esa dirección, así que **siempre se puede**.
- **Art. 104 CT**: si la modificatoria **disminuye el impuesto o aumenta el saldo
  a favor**, hay **2 años**, exige **verificación por auditores de Hacienda**, y
  **no surte efecto alguno** mientras Hacienda no se pronuncie. La asimetría es
  el punto: corregir a favor del fisco es trámite; corregir a favor propio es
  proceso.

**2. El costo real no es mayo — es la cadena.** El IVA se arrastra: si cambia el
resultado de mayo, cambia su remanente, que es el punto de partida de junio, que
es el de julio. Una modificatoria de mayo puede arrastrar **modificatorias de
junio y julio**. Por eso un mes viejo sale caro aunque el monto sea chico.

**3. Que Hacienda lo acepte no lo dice la ley.** El Art. 119-D deja el plazo de
transmisión a «las reglas, forma, plazos y condiciones» que **establezca la
Administración Tributaria**. No está en el Código. **Hay que confirmarlo con la
contadora o en el portal de Hacienda** antes de asumir que un documento de mayo
todavía se puede sellar. Si la plataforma lo rechaza, no hay DTE — y entonces es
una venta sin documento fiscal válido, que es otro problema.

Sobre sanciones: el **Art. 119-F** dice que cumplir el proceso de contingencia
—evento + lote dentro del plazo— **exime** de la sanción del Art. 239-A literales
g) y h). No cumplirlo, no. Qué literal aplica a cada caso lo define la contadora,
no este documento.

**Medido el 2026-08-06: mayo está limpio.** 22,696 ventas finalizadas, **todas
con sello**; 70 invalidadas ante Hacienda, también selladas. **Cero sin sello.**
El caso es hipotético para mayo — lo único realmente pendiente son las 13 de
agosto.

### 7.ter · CORRECCIÓN — no era hipotético: pasó, y el portal lo tenía

§7 y §7.bis decían «mayo está limpio, cero sin sello, el caso es hipotético».
**Era la medición equivocada.** Alex avisó: *«no hay nada pendiente porque envié
esas facturas a Hacienda; en el portal ni en el ERP estarán pendientes. Eran
alrededor de 10 facturas.»*

Y tenía razón en lo primero: **medí el ESTADO ACTUAL cuando el evento estaba en
la HISTORIA**. Una vez que el sello llega, el estado no conserva ningún rastro de
que faltó. El rastro vive en `sales_invoice_changelog`, que registra el cambio de
`recibido_mh` con su `detected_at`.

**Lo que hay ahí, medido el 2026-08-06:**

| Venta | Facturas | Total | IVA | Sello llegó | Demora |
|---|---|---|---|---|---|
| **Mayo 2026** | **21** | $236.60 | **$27.23** | 2026-08-02 | 65 a 87 días |
| **Junio 2026** | **1** | $45.98 | **$5.29** | 2026-08-02 | 43 días |

**22 facturas, $32.52 de IVA**, todas selladas el mismo día: el **2 de agosto**.
Eran más de las ~10 que se recordaban — que es justamente para lo que sirve tener
el registro.

**No es artefacto del portal.** Las 22 estaban en `sales_invoices` **desde el día
siguiente a la venta** (`created_at` de mayo/junio) y sin sello. O sea que el
portal las tuvo 43-87 días sabiendo que les faltaba, y el sello apareció el día
de la retransmisión. El confound a descartar era el revés —que el portal las
hubiera cargado recién en agosto— y no es el caso.

**La consecuencia fiscal, en concreto:** mayo se declaró a principios de junio y
junio a principios de julio. Los dos **antes** del 2 de agosto. Así que hoy el
libro de mayo tiene **$27.23** más de débito fiscal que cuando se declaró, y el
de junio **$5.29** más. Por el Art. 101 la modificatoria hacia arriba se puede
presentar en cualquier momento; el monto decide si vale la pena, y eso lo dice la
contadora.

**Lo que esto prueba, y es más valioso que los $32.52:** el libro **sí cambia
después de declarado**, ya pasó dos veces, y el portal puede demostrarlo con
fecha. Deja de ser el argumento teórico del Bloque D y pasa a ser evidencia.

**Corrección al §7:** donde dice «el portal no puede distinguir si se transmitió o
no» — cierto sobre el estado, **falso sobre la historia**. `sales_invoice_changelog`
responde *cuándo llegó cada sello*, y esa consulta debería ser parte del cierre
de cada mes: **¿llegó algún sello de un mes ya declarado?**

### 7.quater · La exposición del incidente — qué dice el Art. 239-A

**Esto no es asesoría legal.** Es el texto de la norma con los números puestos,
para que la conversación con la contadora empiece con datos.

El **Art. 239-A** (introducido por el Decreto 487, en `docs/legal/`) tiene diez
literales y la diferencia entre ellos es enorme. Los que podrían tocar este caso:

| Literal | Supuesto | Sanción |
|---|---|---|
| **d)** | **Omitir** la transmisión | 100% del monto **de cada operación**, mínimo **9 salarios mínimos** |
| **c)** | Transmitir sin cumplir las reglas de la AT para el sello | 30% del monto **por documento**, mínimo 2 SM |
| **g)** | **Omitir** la transmisión del Evento de Contingencia | **9 salarios mínimos** |
| **h)** | Transmitir el Evento de Contingencia **fuera del plazo** | **9 salarios mínimos** |

**Dos diferencias de redacción que cambian todo:**

1. **d) y c) son POR DOCUMENTO. g) y h) NO** — dicen «multa equivalente a nueve
   salarios mínimos mensuales», sin «por cada documento». Son monto fijo. Con 22
   facturas, la diferencia entre una lectura y otra es de dos órdenes de
   magnitud.
2. **d) dice «omitir»**, y acá **no se omitió**: se transmitió tarde y las 22
   obtuvieron sello el 2026-08-02. El literal que castiga el atraso del evento es
   h), no d).

**El exculpante está en el Art. 119-F**, último inciso: transmitido el evento de
contingencia y el lote, y obtenido el sello, **«no le será aplicable la sanción
del Art. 239-A literales g) y h)»**.

### La pregunta que decide el caso

> **¿Se transmitió un Evento de Contingencia por esas 22 facturas?**

- **Sí, y en plazo** → el Art. 119-F exime de g) y h). Queda sólo lo declarativo.
- **No, o fuera de plazo** → g) o h): **9 salarios mínimos**, monto fijo.

Salario mínimo de comercio y servicios 2026: **$408.80**. Nueve son **$3,679.20**.

### El atenuante del 75% — Art. 261

> «Cuando el infractor **subsanare en forma voluntaria** los incumplimientos,
> omisiones o inexactitudes en que hubiere incurrido, **toda vez que la
> Administración Tributaria no le hubiere requerido o emplazado** […] la sanción
> será **atenuada en un setenta y cinco por ciento**.»

Si Hacienda todavía no ha requerido nada, corregir por iniciativa propia baja los
$3,679.20 a **≈$919.80**. Si Hacienda requiere primero, el atenuante cae al 30%; y
si se deja pasar el plazo que dé, **no hay atenuante**.

**El reloj corre a favor de moverse ahora**, no de esperar.

### Lo declarativo, que es un asunto aparte y chico

Mayo quedó corto **$27.23** y junio **$5.29** de débito fiscal. Eso es impuesto
más intereses, y la modificatoria hacia arriba se puede presentar en cualquier
momento (Art. 101). Si además hay multa por declaración incorrecta, sale del
Art. 238 y **no lo verifiqué** — es punto para la contadora.

### Lo que NO puedo determinar desde acá

- Si se transmitió el Evento de Contingencia (no está en el portal).
- Qué literal considera aplicable Hacienda: es interpretación, no aritmética.
- Si el Decreto 487 tuvo reformas posteriores a lo que hay en `docs/legal/`.
- Si Hacienda perseguiría un caso de $32.52 de impuesto. Eso es criterio, no norma.

### 7.quinquies · Dato de Alex: fue manual, una por una, sin evento de contingencia

> **Alex, 2026-08-06:** *«no fue por contingencia, fue manualmente uno por uno.»*

Eso responde la pregunta que decidía el caso, y en la dirección mala: **el
exculpante del Art. 119-F no aplica**, porque exige el evento de contingencia
más el lote.

**Pero mueve el caso fuera del peor literal, no hacia él.** El literal **d)**
—«omitir la transmisión»— es 100% del monto **de cada operación** con piso de 9
salarios mínimos. Haber transmitido, aunque tarde y a mano, es exactamente lo que
saca el caso de ahí. Las 22 obtuvieron sello.

**El literal que queda en juego es g)**: omitir la transmisión del Evento de
Contingencia → **9 salarios mínimos = $3,679.20**, y —esto es lo que importa—
**monto fijo, no por documento**. Con el atenuante del 75% del Art. 261 por
subsanación voluntaria: **≈$919.80**.

#### La lectura peor, y el argumento en contra

Existe una lectura más dura: el literal **c)** —transmitir «sin cumplir con las
reglas establecidas por la AT para el otorgamiento de sello de recepción»— es 30%
del monto **por documento**, con piso de **2 salarios mínimos por documento**. Con
22 documentos serían **≈$17,987**.

**El argumento en contra es fuerte y sale del propio texto:** c) castiga
transmitir *sin cumplir las reglas para el otorgamiento del sello*, **y el sello
se otorgó**. El Art. 119-D dice que con el sello «se tendrá por efectuada su
transmisión». Si la plataforma lo concedió, la transmisión cumplió sus reglas.
Lo que faltó fue el **evento**, que es g).

#### Una pregunta previa que puede cambiar el literal

El Art. 119-F abre el régimen de contingencia **«en caso se presenten situaciones
de fuerza mayor que imposibiliten la transmisión»** — caída de conexión, de
internet, de energía.

**Si lo que falló no fue fuerza mayor** (un error del sistema, una operación mal
hecha, un lote que no salió), entonces el régimen de contingencia **no era el
camino aplicable** y difícilmente pueda reprocharse haber omitido su evento.
Saber **qué falló el 7 de mayo** es lo primero que hay que reconstruir, y no está
en el portal.

#### El orden de lo que conviene hacer

1. **Reconstruir qué falló** en las fechas afectadas (7, 9, 26 y 29 de mayo;
   20 de junio). Determina si hubo fuerza mayor y por lo tanto qué literal se
   discute.
2. **Decidir con la contadora si se subsana voluntariamente ya.** El 75% del
   Art. 261 sólo existe **mientras Hacienda no haya requerido nada**. Es la
   variable de mayor impacto y es la única que depende del reloj.
3. **Las modificatorias** de mayo ($27.23) y junio ($5.29), que son lo chico.

### 7.sexies · «Ese día falló Hacienda, salía undefined» — y la base lo prueba

Alex, 2026-08-06. **Verificado, y cierra el círculo con algo ya documentado.**

Las 22 facturas tenían, antes de su sello real del 2026-08-02, el valor
`recibido_mh = 'undefined'` — **la cadena de texto, no un sello**. `undefined` es
lo que produce JavaScript cuando una respuesta no trae el campo esperado.

**Es el mismo caso que este plan ya documentaba como A3**, en «Dos conclusiones
de la primera pasada eran incorrectas»: *«22 ventas con `recibido_mh='undefined'`»*.
Ahí se verificaron seis contra `dteqr_json.php` del origen:

```
9f1e3a3e-… → sello = "undefined"   ← el origen mismo devuelve la cadena
1e7e3dc5-… → BODY VACIO            ← el documento no existe en el servicio
b9497a67-… → BODY VACIO
6dffc754-… → BODY VACIO
f49c05c1-… → BODY VACIO
be0a21cd-… → BODY VACIO
```

**Son el mismo conjunto**: mismo tamaño (22), mismo rango de fechas (2026-05-07 a
2026-06-20), mismo desenlace (sello real el 2026-08-02).

#### Por qué esto importa para la exposición

1. **No fue omisión ni descuido: fue una falla de transmisión**, y el sistema
   registró el artefacto del error donde debía ir el sello.
2. **Hay evidencia con fecha, en dos lugares independientes**: el
   `sales_invoice_changelog` del portal (qué documento, qué valor tenía, qué día
   cambió) y la respuesta del propio servicio de consulta del origen.
3. **BODY VACIO en 5 de 6 significa que Hacienda nunca los tuvo.** La
   retransmisión manual del 2 de agosto fue la primera transmisión exitosa, no
   una duplicada.
4. Si la plataforma de Hacienda estaba fallando ese día, la premisa del régimen de
   contingencia —fuerza mayor que imposibilita transmitir— **se cumple**, y una
   falla de la plataforma de la propia Administración no es atribuible al
   contribuyente. **Esto es lo que hay que sostener ante la contadora**, con las
   dos evidencias de arriba.

#### El bug está prácticamente limpio — pero quedaron tres colgadas

Estado al 2026-08-06 de todo lo que hoy no tiene sello válido:

| Venta | Sucursal | Total | IVA | Días sin sello | |
|---|---|---|---|---|---|
| 2025-05-16 | 4 | $14.00 | $1.61 | **447** | `undefined` |
| 2025-08-29 | 25 | $7.45 | $0.86 | **342** | NULL |
| 2025-08-29 | 27 | $30.55 | $3.51 | **342** | NULL |
| 13 de agosto 2026 | 2,4,27,28,29 | $172.80 | $19.89 | 1 a 5 | NULL |

**Las tres primeras son de meses declarados hace más de un año y nadie las miró
nunca.** $5.98 de IVA — la plata no es el punto: es que llevan 342 y 447 días
invisibles, y sólo aparecieron porque se buscó a propósito.

**Las 13 de agosto todavía están a tiempo**: si obtienen su sello antes de que se
declare agosto, no hay modificatoria, no hay cadena y no hay exposición de ningún
tipo. Ese es el caso en que la alerta paga sola.

---

## 8. Acciones pendientes del incidente de sellos

Alex pidió **sólo documentar** el 2026-08-06 — nada de esto está construido.

### 8.1 · Las tres facturas colgadas desde 2025 · **nadie las ha tocado**

| Venta | Sucursal | Total | IVA | Días |
|---|---|---|---|---|
| 2025-05-16 | 4 | $14.00 | $1.61 | 447 (`undefined`) |
| 2025-08-29 | 25 | $7.45 | $0.86 | 342 (NULL) |
| 2025-08-29 | 27 | $30.55 | $3.51 | 342 (NULL) |

Hay que decidir qué se hace: ¿se retransmiten como las 22, se invalidan, o se
dejan? **No decidir también es una decisión** — llevan más de un año así.

### 8.2 · Las 13 de agosto 2026 · **la ventana se cierra con el mes**

$172.80 · $19.89 de IVA · sucursales 2, 4, 27, 28, 29 · del 1 al 5 de agosto.
Con sello antes de que se declare agosto: **cero exposición**. Después: la
cadena de modificatorias del §7.bis.

### 8.3 · La alerta — especificación, para que no haya que volver a derivarla

**Qué vigilar.** `sales_invoices` con `estado = 'FINALIZADA'` y sello inválido.
Son **dos formas distintas** y la segunda es la peligrosa:

- `recibido_mh IS NULL` — no llegó respuesta. Se ve como lo que es.
- `recibido_mh = 'undefined'` (o cualquier largo ≠ 40) — **parece que hay
  sello**. Es la forma que produjo el incidente de mayo y la que engañó al
  módulo de facturación en su momento (ver el comentario de
  `src/data/facturacion.js`: `IS NOT NULL` **no** significa «tiene sello»).

**Dos disparadores, no uno:**

1. **Sello pendiente por más de N días.** Sugerido: 2 días hábiles para avisar, y
   un aviso más fuerte cuando falten pocos días para el cierre del mes — que es
   el punto donde el problema pasa de barato a caro.
2. **Un sello que aterriza sobre un mes ya declarado.** Consulta al
   `sales_invoice_changelog`: `campo = 'recibido_mh'`, `valor_nuevo` de 40
   caracteres, y `detected_at` en un mes posterior al de `sales_invoices.fecha`.
   Ese es el aviso de «hay que modificar una declaración», y es el que hubiera
   cantado el 2 de agosto.

**A quién.** El rol **«Sistema — Alertas Técnicas»** ya existe y ya está asignado;
es el mismo que usa el toast de sync (ver
[[project_auditoria_notificaciones_2026_08_01]]). No hay que inventar destinatario.

**Dónde.** `check-sales-reconciliation` **ya detecta** la causa `sin_sello`, pero
la trata como transitoria: *«se corrige solo cuando el sello llega»*. El hueco es
ese «se corrige solo» — a los 447 días reporta igual que a las 5 horas. Lo más
barato es agregarle el umbral ahí, no crear una función nueva.

**Por qué vale la pena.** El incidente de mayo estuvo **87 días invisible** y sólo
apareció porque se buscó a propósito. Las tres de 2025 llevan más de un año. La
alerta las hubiera cantado el día siguiente, cuando arreglarlo era gratis.

### 8.4 · Lo que hay que llevarle a la contadora

1. ¿Se hizo evento de contingencia el 2 de agosto? **(Respuesta: no — fue manual,
   una por una.)** Con eso, el literal en juego es el g) del Art. 239-A.
2. Con la evidencia del `undefined` y del `BODY VACIO`: ¿se sostiene la fuerza
   mayor por falla de la plataforma?
3. ¿Conviene subsanar voluntariamente **ya**, para asegurar el atenuante del 75%
   del Art. 261 antes de que Hacienda requiera algo?
4. Las modificatorias de mayo ($27.23) y junio ($5.29).
5. Qué se hace con las tres de 2025 (§8.1).
