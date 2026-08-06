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
