# Los puntos: el circuito, lo que se descubrió y lo que falta

**2026-08-28 / 29.** El portal reemplazó al Apps Script que mandaba las ventas al
sistema de puntos, y de paso quedó a la vista buena parte de cómo funciona ese
sistema. Este documento es para quien retome: qué está vivo, qué no, y las
trampas que ya costaron una corrección.

La **política de vencimiento** —que está en decisión, no implementada— vive
aparte, en el manual publicado como artefacto: *Puntos que Vencen*.

---

## 1. Cómo se llega a la base de puntos

**Por la IP, nunca por el dominio.** `farmalasa.com:3306` da `timeout`: ese
nombre resuelve a un intermediario que no expone MySQL. La IP del servidor
contesta en 107 ms.

Se separó con una sonda que prueba **el 443 del mismo host como control**: si los
dos fallaran, el problema sería del portal; con el 443 abierto y el 3306 cerrado,
el bloqueo está del otro lado; y con la IP, ninguno de los dos falla. Sin ese
control, un firewall ajeno y un runtime que no permite sockets se leen igual.

Credenciales en los secretos `PUNTOS_MYSQL_HOST/USER/PASS/DB`. La base es
**MariaDB 11.8**, se llama `u651865694_puntossalud`.

> Un puente PHP se llegó a escribir para evitar el puerto cerrado. Se descartó al
> descubrir lo de la IP. No queda rastro en el repo salvo esta línea, para que
> nadie lo reconstruya creyendo que el 3306 es inalcanzable.

---

## 2. Qué es cada tabla de allá

| tabla | qué es |
|---|---|
| `admin_factura` | **NO es una cola.** Es el registro de ventas válidas contra el que la aplicación de puntos verifica un ticket cuando el cliente lo presenta. |
| `Ventas` | cada acumulación (`Tipo` = `P`). Un punto por dólar. |
| `Canjes` | cada canje (`Tipo` = `C`). `PuntosCanjeados` es **unsigned**. |
| `Clientes` | la ficha. `Puntos` es el saldo, **mantenido** — no derivado. |
| `VW_CardexPuntos` | el estado de cuenta del cliente: la unión de compras y canjes. |
| `Sucursales` | `Abreviatura` = el código (`FLS1`…`FLP1`). |

### `aplicado`, que es el corazón del asunto

`admin_factura.aplicado` tiene **default 1** y el circuito viejo insertaba **0**:

- `0` = el ticket todavía se puede canjear
- `1` = sus puntos ya se entregaron

Sólo el 6% está en 1 — la mayoría de los tickets no se presenta nunca.

**Por eso `aplicado` NUNCA se toca en un UPDATE.** El script viejo escribía
`aplicado = VALUES(aplicado)` con un 0 fijo: reenviar una factura ya procesada la
devolvía a «sin aplicar» y **habilitaba cobrar los puntos del mismo ticket dos
veces**. En la ventana de 7 días había 178 filas expuestas a eso.

### La convención del asiento manual

`TicketFactura` y `TKT` —que normalmente llevan el número del ticket— guardan
**el motivo en texto** cuando la línea se carga a mano. Así se registraron 4,772
«Cortesía cumpleaños» (238,600 puntos), las promos de Navidad y varias
«Autorizado. Carlos R.».

En tres años **no hay un solo número negativo** en ninguna de las dos tablas, ni
un asiento que mencione resta, anulación o corrección. Restar nunca se había
hecho.

---

## 3. Lo que está construido y andando

Cron `sync-puntos-1min`, cada minuto. Medido: 33 ms por corrida en régimen.

### Qué ventas ganan puntos

Tres condiciones, todas decididas mirando datos reales:

1. **`estado = 'FINALIZADA'`.** Hay TRES estados y DOS son anulación: «NULA» (9
   en toda la historia) y «DTE INVALIDADO EN MH» (1,024, **todas con sello de
   Hacienda** — se enviaron y después se anularon ante Hacienda). El circuito
   viejo descartaba sólo por la palabra NULA, así que las 1,024 ganaron puntos
   estando anuladas.
2. **`total > 1`.**
3. **Ningún renglón por debajo del precio 3 vigente ESE DÍA.**

> **La regla 3 es un PISO, no una coincidencia exacta.** Se midió: la
> coincidencia exacta castiga las ventas a precio lleno. STORVAS 20MG se vendió a
> $31.10 contra un precio 3 de $31.05 —afuera por cinco centavos— y SKAR 10MG a
> $34.05 con un precio 1 de $30.00, o sea *arriba* de todo. El piso deja pasar
> esas dos y sigue descartando las que importan. 601 facturas contra 591, sin
> perder ninguna de las 591.
>
> El margen es 2% y **no puede crecer**: la distancia entre el precio 3 y el 4
> tiene mediana 2.91%, así que con 5% el filtro deja pasar el precio de clínica
> en dos tercios del catálogo — o sea, deja de filtrar.

### La reversión de una venta anulada

Tres caminos, y confundirlos fue un defecto real que el usuario levantó viendo la
pantalla:

| estado | qué pasó | qué hace |
|---|---|---|
| `retirado` | los puntos **nunca se canjearon** | borra la fila; **ningún saldo cambia** |
| `devuelto` | los puntos **ya se entregaron** | canje `Anul <correlativo>` + baja el saldo + borra la fila |
| `sin_enviar` | no está del otro lado | sólo lo anota |

> «Retirados» y «Devueltos» decían lo mismo hasta que el usuario preguntó si se
> le habían quitado puntos a clientes que nunca canjearon. **No** —los 796 eran
> retiros y las restas son cero— pero la pantalla daba a entender que sí. Un
> rótulo que obliga a preguntar «¿le sacamos algo a alguien?» ya falló, aunque la
> respuesta sea que no.

**La devolución es un CANJE con su motivo, no un borrado** (decisión del usuario:
«así se usa eso, y el motivo es por anulación»). Encaja con la base: el saldo sale
de *registrados − redimidos*, `PuntosCanjeados` es unsigned —un negativo ni
cabría— y la venta original queda intacta con la baja visible en el estado de
cuenta. Borrar la venta le dejaba al cliente menos puntos y **ninguna línea que
lo explicara**.

**Sólo resta con vínculo inequívoco.** Exige encontrar *exactamente una* venta de
puntos para ese ticket y esa sala. `TicketFactura` se escribe en el mostrador: de
26 casos históricos, **dos no cierran** —una factura de Salud 4 con dos cobros a
nombre de dos personas distintas, y otra cobrada sin venta detrás—. Esos se
avisan y no se tocan.

**Resta hasta cero y nunca deja debiendo.** Si el cliente ya gastó esos puntos,
se resta lo que hay y se anota lo no recuperado.

> Se verificó que la tabla acepta el canje **sin escribir nada**: se hizo dentro
> de una transacción y se deshizo. El saldo bajó de 1,195 a 1,194 y volvió, con
> los 1,697 canjes intactos. Una función nueva no prueba que la tabla la acepte.

### En pantalla

- **Ventas** — columna «Puntos» con los cinco estados y filtro por cada uno.
- **Ficha del cliente** — panel con saldo, totales reales y movimientos.
- **`/mis-puntos`** — pública, sin sesión: DUI + teléfono.

---

## 4. La pantalla del cliente

Primera puerta del portal alcanzable desde internet sin credenciales. Tres reglas
la hacen publicable, y **las tres se probaron**:

1. **Freno por IP** — 8 fallos en 15 minutos. Verificado con once intentos
   seguidos: bloquea desde el octavo y **también al que acierta el par**.
2. **Respuesta idéntica** para «no existe», «DUI inexistente» y «DUI real con
   teléfono ajeno». Verificado con los tres. Si no, sería un detector de «este
   documento es cliente».
3. **El DUI no se guarda**, sólo su huella.

Muestra saldo y movimientos y **nada que no se pueda deshacer**: no canjea, no
edita, no devuelve el documento con el que se entró.

> ⚠️ DUI + teléfono es proporcionado para *mostrar* el saldo propio. **El día que
> esta pantalla permita canjear, ya no lo será** — ahí hay que pasar a código por
> SMS. Esa decisión se toma antes de construir el canje, no después.

---

## 5. Trampas que ya costaron una corrección

**La Popular tuvo otro código.** 41,078 filas bajo `FLP` (hasta el documento
240,699) y `FLP1` desde marzo de 2026. La siembra buscó sólo por el código nuevo
y dejó **32,837 ventas marcadas «sin enviar» que sí tenían sus puntos**. Hoy el
código anterior vive en `branches.codigo_puntos_previo`, no en una constante.

**`puntos_enviados.sucursal` es el código bajo el que esa venta vive REALMENTE
del otro lado**, no el vigente de la sala. Todo lo que viene después usa esa
columna como clave.

**Una fila «sin enviar» no puede ser una condena.** `ventas_para_puntos`
descartaba todo lo que ya tuviera fila en la bitácora; al sembrar una fila por
cada venta, eso excluyó **para siempre** a 613 que sí cumplían las reglas. Hoy
manda la regla, no la bitácora.

**Un código de barra en el campo del vendedor no rompe nada — y es peor.**
21 facturas tienen ahí un código de 13 a 17 dígitos. MySQL **no rechaza** un
entero que no cabe: lo **recorta**. Están allá con `cod_vendedor = 2147483647`,
acreditadas a un vendedor que no existe. En Postgres el `::int` sí lanza, por eso
el filtro `^[0-9]{1,9}$` hace falta igual.

**`Ventas.TicketFactura` se repite entre salas.** Hay que unir también por
`Sucursales.Abreviatura` — sin eso el cruce infla (32 filas donde había 26).

---

## 5.b Detectar un canje: la marca existe, pero no dice lo que parece

`sales_invoices.has_puntos` es booleana y viene poblada en las 269,206 facturas
del año. Marca **546** y de esas **546 tienen hueco** entre la suma de sus
renglones y el total; de las 267,869 sin marca, sólo 17 lo tienen. O sea que la
marca dice *cuáles* y el hueco dice *cuánto*, con precisión suficiente para que
el portal descuente un canje que él no aplicó.

**Pero la marca NO significa «canje de puntos».** Significa «esta venta salió con
un descuento de ese tipo», y el descuento de un **convenio** se registra igual:
las 69 ventas de MAPFRE la traen. Medido sobre el año:

| | facturas | monto |
|---|---:|---:|
| canjes reales (378 fichas de personas) | 486 | $4,392.20 |
| MAPFRE (convenio) | 60 | $1,432.46 |

Un cuarto del monto marcado no es un canje. Y como MAPFRE **no acumula**, una
detección ingenua habría disparado **60 alertas de «se dieron puntos que no
tenía» en un año** sobre la única ficha donde eso es normal — que es la forma
más rápida de que una sala aprenda a ignorar la alerta.

**La regla: la detección se cruza SIEMPRE con `customers.acumula_puntos`.** Una
ficha que no acumula no canjea, no alerta y no se registra. Es la misma bandera
que decide la acumulación, y tiene que decidir las dos cosas o las dos mitades
se separan.

**Otro tanto con los 17 sin marca y con hueco** ($83.18 al año, ninguno de dólar
entero): hay que mirarlos una vez antes de confiar en la marca como única señal.

---

## 6. Problemas de datos del otro sistema, sin resolver

Ninguno se tocó. Son datos de ese sistema y la decisión es del negocio.

- **2,142 facturas existen bajo `FLP` y `FLP1` a la vez**, con montos idénticos.
- De ésas, **27 tienen los puntos cobrados en las dos** — el mismo ticket
  acreditó dos veces.
- **50,025 facturas de $1 o menos** están en el registro, puestas por la hoja de
  cálculo. La regla del «más de $1» es nueva y sólo aplica hacia adelante.
- **26 ventas anuladas con los puntos ya entregados** ($1,110) quedaron anotadas
  sin restar, por decisión del usuario («restemos de ahora en adelante»).

---

## 7. Lo que falta para que los puntos vivan en el portal

Hoy el portal **lee** los puntos. Para independizarse tiene que **tenerlos**.
En este orden:

1. **Las tablas del programa** — cuentas, lotes de puntos con fecha, canjes,
   saldo.
2. **Migrar** 14,632 cuentas y 1.7M de puntos. Decisión pendiente: los puntos
   actuales no tienen fecha individual, sólo un saldo; al migrarlos hay que
   decidir qué fecha se les pone — probablemente la de la venta que los originó,
   que sí se tiene.
3. **El canje en el mostrador.** Lo más delicado: hoy lo hace la aplicación de
   ellos. Mientras no exista en el portal, **no se puede desconectar**.
4. **El vencimiento**, ya con lotes fechados. Es lo único del protocolo que
   necesita desarrollo; lo demás es decisión y comunicación.

### Y el dato que reencuadra la política

Un punto por dólar; 100 puntos, $1. La deuda viva son **$17,295**.

**Tres de cada cuatro clientes activos no llegan a 100 puntos en seis meses**, y
alargar el plazo casi no lo mejora: 25% a 6 meses, 26% a 12, 25% a 18, 36% a 24.
El cuello de botella **no es el reloj, es que hay que gastar $100 para ganar $1**.
El ajuste que de verdad cambia el programa es bajar el mínimo de canje, no
acortar el vencimiento.

---

## 8. Pendiente operativo

- **Apagar el disparador del Apps Script en Drive.** El portal ya hace ese
  trabajo; mientras el script siga vivo, los dos escriben.
- **`puntos-probe` es sólo diagnóstico** y se puede borrar.
