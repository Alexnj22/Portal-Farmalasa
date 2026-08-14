# Cortes de caja: de dónde sale cada número

Escrito el 2026-08-14, después de que el usuario preguntara «explicame bien cómo
el corte tiene los datos, cómo funciona la venta al crédito». Hasta hoy esto
vivía sólo en comentarios de código repartidos en cuatro archivos.

Todos los números de este documento son **reales**, capturados el 13 y 14 de
agosto de 2026. No hay ejemplos inventados a propósito: la mitad de las reglas
de acá se descubrieron porque un número real no cuadraba.

---

## 1. El portal no calcula el corte: lo lee

El corte lo hace el dependiente en el sistema de la caja. El portal le pide cada
pocos minutos los cortes del día **y el texto del tiquete**, lo interpreta y lo
guarda en `cortes_caja`. El tiquete es la fuente; el portal no reconstruye nada.

Los movimientos de caja del día (ingresos y vales) se capturan aparte, en
`cortes_caja_movimientos`, y sirven para **explicar** una diferencia.

---

## 2. La fórmula

Este es el tiquete real del corte 13788 — Salud 5, 14-ago, 12:40 PM:

```
 (+) INGRESOS $:            17.97
 (+) VENTA $:              225.85
_______________________________
     SUBTOTAL $:           243.82
 (-) VALES $:               15.00
_______________________________
 (+) COBROS CREDITO $:       1.25
_______________________________
     TOTAL CAJA $:          230.07
 (-) RETENCION $:            0.00
 (-) DEVOLUCIONES $:         0.00
_______________________________
     EFECTIVO $:            230.07
     DIFERENCIA $:           -6.25
VENTAS AL CREDITO
COF                           1.25
TOTAL                         1.25
```

```
TOTAL CAJA = INGRESOS + VENTA − VALES + COBROS CRÉDITO
```

**`TOTAL CAJA` es lo que DEBE haber en la gaveta.** Y cada término sale de
movimientos que existen uno por uno. Los de ese día en Salud 5:

| Movimiento | Monto | Dónde cae |
|---|---|---|
| `tigo #74836006 b: 000315` | $16.97 | INGRESOS |
| `aplicacion/sarai` | $1.00 | INGRESOS |
| `POR ABONO A CREDITO` | $1.25 | **COBROS CRÉDITO** (línea propia) |
| `vale para pastel de merlyn` | $15.00 | VALES |

16.97 + 1.00 = **17.97** exacto. El abono a crédito **no** se mezcla con los
ingresos: tiene su propia línea en la fórmula.

### La línea `EFECTIVO` no es efectivo

Es la **suma de tres casillas que el dependiente teclea**: efectivo, tarjeta y
cheque. Nada del lado del servidor la recalcula — la diferencia se calcula en el
navegador del dependiente (`js/funciones/funciones_corte_caja.js`) y se manda
como parámetro.

Consecuencia práctica: **inflando la casilla de tarjeta, la diferencia queda en
cero y el efectivo se va**, y el sistema no dice nada. Es exactamente por eso que
el portal existe como control, y por eso la cifra que usa sale del tiquete y se
contrasta contra los movimientos del día. Ver la memoria
`feedback_client_side_credentials_are_decorative`.

---

## 3. El origen produce DOS diferencias, y no siempre coinciden

1. **La guardada** — `total_declarado − esperado`, con el `esperado` que calculó
   el servidor al abrir el formulario.
2. **La del tiquete** — `total_declarado − TOTAL CAJA`.

**Manda la del tiquete.** Medido sobre los 24 cortes del 13-ago: el desvío entre
las dos es SIEMPRE un múltiplo entero exacto de los cobros de crédito de esa
sala, y las salas sin cobros coinciden al centavo en los 10 cortes. O sea que el
`esperado` del origen cuenta mal los cobros de crédito, un número entero de veces
de más o de menos.

**La única excepción**: cuando la brecha es de exactamente `+1×` el cobro, manda
la guardada — significa que el tiquete sumó cobros del día que al momento del
corte todavía no habían entrado.

Cuando las dos discrepan y **no** es por los cobros de crédito, el portal **no
elige**: muestra las dos y avisa que no conviene dar por bueno un faltante así.

El código: `contraste()` y `diferenciaDelCorte()` en
`src/utils/cortesDiagnostico.js`.

---

## 4. Los cortes son acumulativos, y sólo un CONFIRMADO corre la base

El corte de la noche **contiene** al de la mañana. Así que la diferencia que
señala a un turno no es la del corte: es cuánto se movió **desde el corte
anterior**. Eso es el «tramo».

**Regla del usuario (2026-08-14): sólo un corte CONFIRMADO corre la base.**

Importa porque **el sistema no anula cortes**: cuando la sala encuentra el error,
REHACE el corte. Un corte repetido es la corrección del anterior, no un tramo
nuevo. Con la base corriendo en cualquier corte, el portal le restaba al corte
bueno la diferencia del que vino a reemplazar e inventaba un faltante igual y
opuesto.

El caso que lo destapó — **Salud 5, 14-ago**:

| | 12:36 | 12:40 |
|---|---|---|
| efectivo declarado | 230.07 | **230.07** (idéntico) |
| venta del tiquete | 225.85 | **225.85** (idéntica) |
| cobros de crédito | — | **1.25** |
| TOTAL CAJA | 228.82 | 230.07 |
| diferencia del corte | **+1.25** | **exacto** |

El portal mostraba «FALTANTE −$1.25» sobre el corte de las 12:40, que cuadra.
Los descartados nunca corren la base.

---

## 5. La venta al crédito: dos momentos distintos

**Momento 1 — se vende.** Sale el producto, no entra dinero.

→ **NO suma a `VENTA`.** Aparece sólo listada al pie del tiquete, como
información.

Verificado contra las facturas: la suma de las ventas **en efectivo** de un día
da exactamente el `VENTA` del último corte de caja, en las 6 salas. Si el crédito
estuviera adentro de `VENTA`, toda sala con ventas al crédito mostraría un
faltante por ese monto todos los días.

**Momento 2 — el cliente paga.** Entra dinero sin venta asociada.

→ Suma como **`COBROS CRÉDITO`**, que puede ser el mismo día o semanas después.

Los dos momentos pueden caer el mismo día, y ahí está la trampa: en Salud 5 el
billete de $1.25 ya estaba en la caja a las 12:36 pero el abono no estaba
registrado, así que el sistema esperaba $228.82 y había $230.07. **Un cobro sin
anotar se ve exactamente igual que un sobrante.**

---

## 6. El cierre del día (Z) da VENTAS, no efectivo

Su monto es **todo lo vendido**, sumando todas las formas de pago. Se desglosa
por tipo de documento (tiquetes / facturas / fiscales), no por cómo pagaron — al
pie trae sólo los totales de tarjeta y de crédito, que no son todas (ver abajo).

Salud 1, 13-ago:

| | |
|---|---|
| Total del Z (135 documentos) | **$1,628.75** |
| Pagos con tarjeta | −$202.55 |
| Ventas al crédito | −$13.00 |
| **Efectivo que debió entrar** | **$1,413.20** |

Y ese $1,413.20 es exactamente el `VENTA` del último corte de caja de esa sala.
**Verificado contra las facturas en las 6 salas: las 6 cuadran al centavo.**

**Ni la tarjeta ni el crédito pasan por la caja**: la tarjeta se cobra por el POS
y el crédito entra recién cuando el cliente paga. Los cortes del día sólo cuentan
el efectivo.

### Sí hay transferencias, y el tiquete no las nombra

Lo primero que escribí acá fue que no existían: de los 42 tiquetes capturados,
ninguno nombra transferencia, cheque ni depósito. **Era cierto del tiquete y
falso del negocio.**

`sales_invoices.tipo_pago` sí las trae. **Salud 2, 13-ago: una transferencia de
$2.20.** Y esos mismos $2.20 los había visto antes como «descuadre contra el
último corte» y los expliqué como ventas posteriores al conteo — la hipótesis
cómoda, que además encajaba. No lo eran.

Por eso el desglose **sale de las facturas y no del tiquete**, y pinta las formas
que vengan en vez de dos escritas a mano: una forma nueva tiene que aparecer
sola, no esconderse dentro del efectivo. Cuando desaparece dentro del efectivo es
peor que un error visible — el número sigue cuadrando y dice de más.

Ver `feedback_el_residuo_sin_explicar_delata_el_diagnostico`.

---

## 7. Qué agrega el portal encima

- **Reabrir** un corte ya firmado, con motivo, y toda decisión en bitácora
  (`cortes_caja_eventos`). Lo puede hacer la propia sala.
- **Resolver la diferencia**: se repone el dinero, se retira el sobrante, o ya se
  encontró la causa (`cortes_caja_diferencias`). Una reposición la aportan varias
  personas, con su parte cada una.
- **Dos papeles**, y ninguno reemplaza al otro: el de la reposición lo firma quien
  entrega el dinero; el del ingreso o vale acumulado se anexa a ese documento y
  lo desarma diferencia por diferencia.
- **Un solo asiento**: varias diferencias se marcan con el mismo número de ingreso
  o de vale. Acá el detalle, allá un documento por el total.

**El monto que se cobra lo calcula el servidor**, no el navegador, y se rechaza
si no coincide con el que se vio en pantalla.

**El portal NO escribe en el sistema de origen** (decisión del usuario,
2026-08-14). Observa, verifica y respalda; el movimiento lo hace una persona
allá.

---

## 8. Dónde está cada cosa

| Qué | Dónde |
|---|---|
| La aritmética del corte y del tramo | `src/utils/cortesDiagnostico.js` |
| Los dos comprobantes en papel | `src/utils/corteComprobante.js` |
| Las pruebas que anclan los números | `tests/unit/cortesDiagnostico.test.js`, `tests/unit/corteComprobante.test.js` |
| La captura desde el sistema | `supabase/functions/sync-cortes-caja/` |
| El cálculo del lado del servidor | `corte_diferencia` / `corte_tramo` en Postgres |

⚠️ **`corte_tramo` (SQL) y `conTramo` (JS) son dos implementaciones de la misma
regla.** Al tocar una hay que tocar la otra. Lo que convierte una divergencia
futura en un error visible —y no en un cobro equivocado— es que el servidor
rechaza cuando su monto no coincide con el de la pantalla.
