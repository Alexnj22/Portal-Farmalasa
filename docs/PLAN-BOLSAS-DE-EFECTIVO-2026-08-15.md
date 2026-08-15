# Bolsas de efectivo — control de custodia entre el corte y administración

**Estado: F1 EN PRODUCCIÓN (v2.620.0). F2 a F5 sin implementar.** Escrito el
2026-08-15 a pedido del usuario.

Lo que ya corre: la tabla `bolsas` y sus funciones, los tres papeles del rollo
(`bolsaComprobante.js`), y la baldosa **Bolsas de efectivo** del Inicio — guardar
la bolsa de un corte confirmado, ver lo que espera el retiro, la alarma de los 4
días y la etiqueta impresa. **Todavía no hay pantalla propia**: eso llega con el
retiro (F2) y el conteo (F3).

**Falta la prueba física**, y es lo que hay que hacer antes de construir F2 y F3
encima: cerrar una bolsa real, pegarle la etiqueta y contarla contra el papel.
Ahí se confirma o se cae la fórmula del monto de la §5.1.

---

## 1. Qué se pidió

Cuando una sala confirma un corte, el efectivo se guarda en una bolsa. Dos
cortes en el día = dos bolsas. Cada ~3 días alguien pasa a retirarlas. Y cuando
hay que hacer una remesa y la caja no alcanza, **se saca dinero de una bolsa y
se deja un papel escrito con el monto**.

Hoy el rastro de todo eso es una cinta pegada con la fecha y el monto, más un
papel adentro. El pedido es que el portal sea ese rastro:

1. Control de bolsas: qué días se retiran, cuántas hay, cuánto suman por sala y
   en total.
2. Confirmar la entrega (sala) y la recepción (administración).
3. Conteo manual en administración: total por sucursal y por sala; confirmar lo
   que cuadra —y con eso quedan cerrados esos días— y marcar lo que no, con
   aviso a la sala, comentarios y reposición.
4. Widget «Entrega de remesas»: sugiere la bolsa más antigua, descuenta el
   monto, registra tipo + proveedor + número de boleta + foto + quién, e imprime
   un comprobante en la ticketera. Y también salidas por otra causa.
5. Los tickets reemplazan a la cinta: fecha, hora, monto, responsables, la lista
   de lo que se sacó y **cuánto efectivo queda de verdad adentro**.

---

## 2. Lo que ya existe y no se rehace

| Pieza | Dónde | Qué aporta acá |
|---|---|---|
| Captura de cortes | `cortes_caja` + `sync-cortes-caja` (cada 30 s) | La bolsa nace de un corte confirmado; su monto sale de ahí |
| Tramo del día | `conTramoPorSalaYDia` / `corte_tramo` | Los cortes son acumulativos: el monto embolsado es la RESTA |
| Resolver diferencias | `cortes_caja_diferencias`, `resolver_diferencia_corte`, `useResolverCorte` | El mismo mecanismo REPONE/RETIRA/JUSTIFICA + personas + firma |
| Bitácora | `cortes_caja_eventos` | El patrón de «quién, cuándo, por qué», ya probado |
| Ticketera | `imprimirDocumento` + `corteComprobante.js` | Motor y reglas del rollo (ASCII, 54 columnas, sin tema) |
| Avisos a la sala | `notify_employees` + `destinatarios_de_cortes(branch_id)` | Los mismos destinatarios, ya afinados |
| Fotos | bucket privado `payment-proofs` + `getSignedFileUrl` | La foto del comprobante de remesa entra ahí, sin bucket nuevo |

**Nada de esto escribe en el sistema de origen** y esto tampoco lo hará —
decisión del usuario del 2026-08-14, vigente.

---

## 3. La pieza que falta

Entre «el corte cuadró» y «el dinero llegó a administración» hoy no hay ningún
registro. Ese hueco dura hasta tres días, contiene todo el efectivo de seis
salas, y adentro se le saca dinero sin dejar más rastro que un papel suelto.

**La bolsa es el objeto que falta.** Una bolsa es una cantidad de efectivo bajo
la custodia de una persona, con un origen (un corte), un saldo que se mueve, y
una cadena de custodia que termina en un conteo.

---

## 4. Seis correcciones a la idea

Antes del modelo, lo que hay que cambiar de cómo se planteó — cada una porque
si se hace literal, rompe algo.

### 4.1 El dinero NO se descuenta del corte. Se descuenta de la bolsa.

Se pidió «el dinero se descuenta de ese corte». El corte es un registro fiscal
capturado del origen y es la referencia contra la que se verifica todo lo demás
(la suma de sus tramos, el cierre Z, las facturas por forma de pago). Si el
portal lo edita, deja de coincidir con el origen y se pierde la única
verificación independiente que hay.

Lo que baja es el **saldo de la bolsa**. El corte queda intacto y sigue diciendo
cuánto se contó ese día. En pantalla se dice «se descuenta de la bolsa del corte
de las 19:01», que es lo mismo que se quiso decir.

### 4.2 Quien entrega no puede confirmar la recepción

Dos confirmaciones firmadas por la misma persona no son un control, son dos
clics. La regla va en el servidor, no en la pantalla: `recibido_por <>
entregado_por`, y el que rompe la regla recibe un error que lo dice.

**Todos tienen cuenta en el portal** (usuario, 2026-08-15), incluido el que
recolecta. Entonces la regla es exigible de verdad y ninguna firma es texto
escrito a mano: la sala entrega con su cuenta, el que recolecta confirma con la
suya **ahí mismo en la sala**, y en administración firma un tercero. Todos los
campos de persona son `employee_id`, nunca un nombre tecleado — un nombre a mano
no se puede cruzar con nada y se desincroniza del registro.

### 4.3 El conteo no se edita: se resuelve

Se pidió que al reponer «vuelva a la cantidad esperada». Si eso se hace
sobreescribiendo lo contado, el faltante desaparece de la historia y con él la
razón por la que alguien repuso dinero. Quedan **dos números para siempre**: lo
que se contó y lo que se resolvió. La bolsa muestra el saldo bueno; la bitácora
guarda que hubo un faltante de $X, quién lo repuso y cuándo.

### 4.4 La etiqueta se vuelve mentira en cuanto sale plata

Es el problema central del pedido 5. Una etiqueta impresa al cerrar la bolsa
deja de ser cierta la primera vez que alguien saca $200 para una remesa, y en la
mesa de administración se ven iguales.

Tres reglas:
- Cada impresión lleva **número de etiqueta**: `ETIQUETA #2 - ANULA LA ANTERIOR`.
- Toda salida marca la bolsa como **etiqueta desactualizada**, y la sala lo ve
  en su baldosa hasta que reimprime.
- La etiqueta imprime **siempre el estado de hoy**, nunca una foto guardada.

### 4.5 El control no es un visto: es quién se llevó el dinero

Escrito al revés en la primera versión —«sacar dinero necesita autorización»— y
corregido por el usuario el 2026-08-15: **ninguna salida necesita la aprobación
de un segundo.** Tiene sentido, porque el que aprueba no ve nada que el que
registra no vea, y una remesa se paga con el cliente enfrente.

Lo que sí hace falta es **saber quién se llevó los billetes**, amarrado a una
persona del portal y no a una firma ilegible. En la remesa, quien recibe es el
cliente y lo identifica la boleta del POS. En cualquier otro vale —un anticipo,
un gasto, efectivo que se manda a otra sala— quien retira el efectivo se
identifica en el portal antes de que se imprima el papel (§8.1).

### 4.6 De qué bolsa sale el dinero

Regla del usuario (2026-08-15): **la más vieja que alcance sola**. O sea, no se
parte una remesa en dos bolsas para vaciar la más antigua: se busca desde la más
vieja hacia adelante la primera que cubra el monto entero. Así cada remesa deja
un solo vale y una sola bolsa tocada, que es lo que se puede controlar en papel.

El caso que igual hay que resolver: **cuando ninguna alcanza sola.** Ahí sí se
combinan, desde la más vieja, y eso produce **una remesa con dos vales** — que
es exactamente el caso «se tomaron 2 bolsas» que preguntó el usuario. Se modela
en la §5.3: la remesa es un hecho, los vales son de dónde salió la plata.

---

## 5. El modelo

### 5.1 Cuánto dinero entra a la bolsa

Los cortes son **acumulativos dentro del día**: el de la noche contiene al de la
mañana. Entonces lo que se embolsa en el corte N es:

```
monto = total_declarado(N) − total_declarado(último corte C CONFIRMADO anterior del mismo día)
```

Y de ahí sale el invariante que hace verificable todo el sistema:

```
Σ bolsas de una sala en un día  ==  total_declarado del ÚLTIMO corte C confirmado de ese día
```

**Medido, no supuesto:** en los 24 cortes confirmados del 13 y 14 de agosto los
24 incrementos son positivos, de $145.27 a $1,272.92 — consistente con que la
sala cuenta el acumulado (cajón + lo ya embolsado) y con que el declarado es
efectivo puro (`tk_efectivo == total_declarado` en todas las filas de la
muestra). No está probado: lo prueba la primera bolsa real contada contra su
etiqueta, y ese es el primer trabajo de la fase 1.

**Los $150 del fondo de cambio no entran en la fórmula** (usuario, 2026-08-15:
«si quedan 150 siempre, esos no se cuentan para la caja»). Y los datos dicen lo
mismo desde el otro lado: lo que el corte espera es `ingresos + venta − vales +
cobros de crédito`, que es puro movimiento del día y no tiene ningún término de
fondo inicial; `tk_saldo_inicial` y `tk_saldo_caja_chica` vienen en `0.00` en
todas las filas capturadas. O sea que el fondo vive **afuera del corte**, y por
lo tanto afuera de la bolsa: la fórmula queda como está y el invariante también.

Consecuencia que sí hay que cuidar: si el fondo se rompe (alguien saca cambio de
ahí y no lo repone), nada de este circuito lo ve — el corte no lo mira y la
bolsa tampoco. Es un control aparte, y por ahora queda fuera de alcance; lo que
NO puede pasar es taparlo sacando dinero de una bolsa para rellenar el cajón
(§8, `REPOSICION_CAJA`).

**El vale ocupa el lugar del billete, así que el corte siguiente sigue
cuadrando.** Ese es el motivo de fondo por el que este registro tiene que existir
aparte: **un descuadre de bolsa es invisible para el corte de caja.** Ninguna de
las cuentas que ya hace el portal lo puede detectar.

**El monto lo calcula el servidor**, como `corte_tramo`, y rechaza si no
coincide con el que vio la pantalla. Es la misma razón de siempre: es la cifra
que después se le reclama a alguien.

### 5.2 Tablas

Prefijo `bolsas_*`, español de negocio, como `pedidos` y `traslados`.

**`bolsas`** — una bolsa física.

| columna | tipo | nota |
|---|---|---|
| `id` | bigint PK | |
| `folio` | text unique | `S3-1042` — la sucursal y un correlativo; ver §5.2-bis |
| `branch_id` | int FK | |
| `corte_id` | bigint FK null | de qué corte nació |
| `origen` | text | `CORTE` \| `MANUAL` (con motivo obligatorio) |
| `monto_inicial` | numeric(12,2) | lo que se guardó, calculado por el servidor |
| `fecha`, `hora` | date, time | las del corte — es como la sala la nombra |
| `cerrada_por`, `cerrada_at` | uuid, timestamptz | quién metió el dinero |
| `estado` | text | `ABIERTA` → `ENTREGADA` → `RECIBIDA` → `CONTADA`; + `ANULADA` |
| `retiro_id` | bigint FK null | en qué retiro se fue |
| `contado_efectivo` | numeric(12,2) null | los billetes que contó administración — **no se edita nunca** |
| `contado_boletas` | numeric(12,2) null | lo que amparan las boletas que estaban adentro (§9.1) |
| `contado_por`, `contado_at` | uuid, timestamptz | |
| `etiqueta_version` | int default 0 | cuántas veces se imprimió |
| `etiqueta_impresa_at` | timestamptz null | contra `ultimo_movimiento_at` decide si está vieja |

Índice único parcial sobre `corte_id where estado <> 'ANULADA'`: una bolsa por
corte. El `saldo` no es columna — es `monto_inicial + Σ movimientos`, y se
expone por vista/RPC para que no puedan divergir.

**`bolsas_operaciones`** — el hecho: una remesa, un pago, un gasto. Ver §5.3.

**`bolsas_movimientos`** — de qué bolsa salió (o entró) la plata, **con signo**.

`id`, `bolsa_id` FK, `operacion_id` FK null, `monto` (negativo = sale),
`vale_folio`, `registrado_por`, `registrado_at`, `impreso_at`,
`anulado_at`/`anulado_por`/`anulado_motivo`.

Con signo y no una tabla de «salidas» porque hay tres casos que no son salidas y
tienen que caber: la **reposición de un faltante** que entra a una bolsa ya
cerrada, la **devolución** de un dinero que salió y volvió, y la anulación de un
vale mal registrado.

**`bolsas_tipos_movimiento`** — el catálogo (§8). Es tabla y no una lista en el
código porque de él sale el formulario: qué campos exige cada tipo son datos,
no `if`s. Regla del proyecto: *una lista de opciones que existe como tabla no se
escribe a mano.*

**`bolsas_retiros`** — una pasada del que recolecta.

`id`, `folio`, `fecha`, `recolector_employee_id`, `estado` (`EN_RUTA` →
`RECIBIDO` → `CONTADO` → `CERRADO`), `recibido_por`, `recibido_at`,
`cerrado_por`, `cerrado_at`.

**Los días de retiro no son fijos** (usuario, 2026-08-15), así que no hay
calendario ni retiros programados por adelantado: no existe el estado
`PROGRAMADO` ni una tabla de días. Un retiro **nace cuando pasa**, de una de dos
formas: el que recolecta anuncia que sale —y las salas lo ven y preparan las
bolsas— o simplemente se crea solo con la primera entrega que se firma. La
pregunta original («saber qué días retira la persona») se contesta con lo que sí
se sabe: cuándo fue el último retiro de cada sala y cuántos días lleva
acumulando, que es lo que dispara la alarma de los 4 días (§10).

**`bolsas_entregas`** — el apretón de manos en cada sala. Los conteos se
derivan de las bolsas; lo que **no** se deriva es quién firmó.

`id`, `retiro_id` FK, `branch_id`, `entregado_por`, `entregado_at`,
`recolector_confirmo_at`, `comprobante_folio`.

**`bolsas_diferencias`** — gemela de `cortes_caja_diferencias`: `bolsa_id`,
`monto` con signo, `via` (`REPONE`/`RETIRA`/`JUSTIFICA`), `causa`, quién, cuándo,
anulación. Y `bolsas_diferencia_personas` igual que la de cortes.

Tabla aparte y no una columna en `cortes_caja_diferencias`: es otro hecho. Un
faltante de corte pasó **durante** el turno; un faltante de bolsa pasó **después
de que el corte cuadró**, o sea entre el sello de la bolsa y la mesa donde se
contó. Lo que sí se comparte es el componente de resolución, el comprobante
impreso y el hook de escritura — que en cortes ya se duplicó tres veces antes de
extraerse a `useResolverCorte`.

**`bolsas_eventos`** — la bitácora, calcada de `cortes_caja_eventos`. Acá vive
además el hilo de comentarios entre administración y la sala (`nota`), y los
casos que no mueven dinero: «se abrió para cambiar sencillo», «se reimprimió la
etiqueta».

### 5.2-bis El folio lleva la sucursal, en LETRAS

Decisión del usuario (2026-08-15): *«el folio debe llevar la sucursal para
saber»*. La primera versión usaba una secuencia pelada —`B-1042`— por miedo a
que un prefijo numérico (`B27-`) se leyera como el número de la sala; es la
confusión que ya costó una vez, ver
[[feedback_la_numeracion_de_sala_del_erp_no_es_su_nombre]]. **Con letras ese
riesgo no existe**: `S3` es Salud 3 y `LP` es La Popular, no hay ningún número
que confundir. El folio queda `S3-1042`.

**El código es una COLUMNA de `branches` (`codigo`), no algo derivado del
nombre.** Derivarlo («Salud 3» → `S3`) sería la trampa de siempre: el día que
renombren la sala, los folios nuevos dejarían de coincidir con los viejos y nada
avisaría. Sembrado por `id`: LP, S1, S2, S3, S4, S5, BOD, ADM.

Una sucursal nueva sin código **no bloquea** el guardado: sale `B-1050`, sigue
siendo único, y se nota al primer papel que salga así.

### 5.3 La remesa es un hecho; los vales son de dónde salió la plata

La primera versión de este documento metía el proveedor, la boleta y la foto
adentro de cada salida. Está mal, y lo destapó la pregunta del usuario: *«se
sacó dinero y se tomaron 2 bolsas, ¿cómo sería el control?»*.

Una remesa es **una** operación: un cliente, un monto, una boleta del POS, una
foto, una persona que la entregó. De qué bolsa salieron los billetes es otra
cosa, y puede ser más de una. Si la boleta y la foto viven en cada salida, dos
bolsas significan dos copias del mismo dato — y dos copias se desincronizan.

```
bolsas_operaciones (la remesa)          bolsas_movimientos (los vales)
  id, folio                     ◄────┐    bolsa_id  → S3-1042   -300.00
  tipo  REMESA                       ├──  bolsa_id  → S3-1051   -200.00
  monto 500.00                       │
  banco / red, numero_boleta         │    (dos vales, uno en cada bolsa)
  foto_url                           │
  registrado_por                     │
  recibido_por / _metodo / _texto ───┘
```

`recibido_por` es `employee_id` y `recibido_metodo` dice cómo se probó que era
él: `CARNE` (escaneado) o `CLAVE` (usuario y contraseña). **No hay campo de
texto libre**: quien retira efectivo se identifica o no se lleva el dinero
(§8.1).

Reglas:

- **`Σ movimientos == monto` de la operación.** Lo verifica el servidor; si no
  cierra, no se registra. Sin eso, un vale puede quedar por menos de lo que se
  sacó.
- **Un vale por bolsa**, y cada vale se queda físicamente en SU bolsa. El papel
  lo dice: *«Este vale queda dentro de la bolsa S3-1042»*. Un vale que
  cambia de bolsa deja un hueco y un sobrante.
- **Una operación puede no tocar ninguna bolsa.** Si la remesa se pagó con el
  efectivo del cajón, la operación existe igual, con su boleta y su foto, y con
  cero movimientos. Con eso, el registro de remesas es completo aunque el
  control de bolsas sólo mire una parte.
- La lista de operaciones **es** el registro de remesas: cuántas, por cuánto,
  por banco, por sala, por período.

### 5.4 Estados y quién los mueve

```
                 sala                    recolector            administración
  corte
CONFIRMADO ──► ABIERTA ──────────────► ENTREGADA ──────────► RECIBIDA ──► CONTADA
               (cierra la              (firma la sala,        (acusa       (cuenta
                bolsa, imprime          firma quien            recibo,      el dinero)
                la etiqueta)            retira)                sin contar)
                  │
                  └─ movimientos (remesas, otras salidas, reintegros)
```

- **`ABIERTA` es el único estado que acepta movimientos.** Una vez entregada, la
  bolsa no está en la sala: registrar una salida ahí es imposible en el mundo
  real y el servidor lo rechaza.
- `RECIBIDA` y `CONTADA` son dos actos distintos a propósito: el recuento de
  bolsas se hace al recibir la valija —rápido, y es lo que se pidió en el punto
  2— y el conteo del dinero puede ser al otro día.
- `CONTADA` con diferencia deja la bolsa marcada hasta que se resuelva, pero
  **no bloquea el cierre del retiro**: se pidió explícitamente poder confirmar
  lo que cuadra y dejar marcado lo que no.

---

## 6. Los tres papeles

Todos por `imprimirDocumento`, con las reglas del rollo: **sólo ASCII**, 54
columnas en letra chica, sin tema ni fondos, el ancho no se pasa. Anclados en
pruebas unitarias como `corteComprobante.test.js`. Sin QR ni código de barras:
el camino sin diálogo manda texto plano.

### A. La etiqueta — va PEGADA AFUERA, reemplaza la cinta

Implementada en `src/utils/bolsaComprobante.js`. Esto es lo que sale del rollo,
renderizado por el mismo camino que usa la ticketera de la sala:

```
        Farmacias La Popular y La Salud
             NIT 0401-210685-101-0
______________________________________________________
BOLSA DE EFECTIVO

Bolsa: S3-1042
Sala: Salud 3
Corte del: 14/08/2026  19:01
Caja: MI CAJA LA SALUD 3
Guardo: Jose Rivaz Pena
Cerrada: 14/08/2026, 07:12 p. m.
Guardado al cerrar: $716.92
______________________________________________________
SE SACO PARA                   FECHA    HORA   SALIO
______________________________________________________
Remesa entregada a un clien.   14/08   20:15  200.00
Pago a proveedor               15/08   09:40  150.00
______________________________________________________
EFECTIVO QUE DEBE HABER          $366.92
VALES ADENTRO (2)                $350.00

ETIQUETA #3 - ANULA LA ANTERIOR
15/08/2026, 09:41 a. m.

Si sale mas dinero, imprimir otra etiqueta.
```

Es lo que se pidió: fecha, hora, monto, responsables, la lista de lo que salió y
**el monto nuevo sin los vales**.

**Sin salidas —el caso normal— no imprime ni la tabla ni el renglón de vales**:
dice `EFECTIVO ADENTRO $716.92` y se acabó. Una etiqueta corta se lee de un
vistazo y gasta menos rollo.

**No lleva líneas de firma.** El apretón de manos tiene su propio papel (el C);
poner firmas también acá invita a firmar el que no era.

### B. El vale — va ADENTRO, reemplaza el papel escrito a mano

```
______________________________________________________
VALE DE EFECTIVO

Vale: V-S3-1052
Bolsa: S3-1042
Sala: Salud 3
Corte del: 14/08/2026  19:01
Motivo: Pago a proveedor
Banco: Drogueria Santa Lucia
No. de boleta: RC-88214
______________________________________________________
DETALLE
Pago contra entrega del pedido 4471, autorizado por
telefono.

SALE DE LA BOLSA                 $300.00
QUEDA EN LA BOLSA                $216.92

Registro: Ana Pena Nunez
15/08/2026, 09:40 a. m.
Recibe: MARIA JOSE PENA
(usuario y contrasena)

Firma ______________________

Este vale queda dentro de la bolsa S3-1042.
Parte de P-260815-7 por $500.00.
```

**`QUEDA EN LA BOLSA` es lo que hoy no existe.** El papel a mano dice cuánto se
llevaron, que es la mitad que no sirve para contar.

Los dos últimos renglones tampoco son decoración: *«Este vale queda dentro de la
bolsa X»* —un vale que cambia de bolsa deja un hueco de un lado y un sobrante
del otro— y *«Parte de P-260815-7 por $500.00»*, que aparece **sólo** cuando la
operación salió de más de una bolsa, para que ninguno de los dos papeles parezca
la operación entera.

**En una remesa no hay quien firme**: la recibe el cliente y lo identifica la
boleta del POS. El bloque de «Recibe / Firma» aparece únicamente en los otros
tipos, y dice **cómo** se comprobó que era él (§8.1).

### C. El comprobante de entrega — lo firman la sala y quien retira

```
______________________________________________________
ENTREGA DE BOLSAS

Comprobante: E-S3-1060
Sala: Salud 3
Fecha: 16/08/2026, 08:20 a. m.
______________________________________________________
BOLSA                            DEL    HORA   MONTO
______________________________________________________
S3-1042                    14/08   19:01  366.92
S3-1051                    15/08   12:40  512.30
S3-1055                    15/08   20:55  365.92
______________________________________________________
BOLSAS                                 3
EFECTIVO                       $1,245.14
VALES (en 1 bolsa)               $350.00
TOTAL SEGUN LOS CORTES         $1,595.14

Entrega: Jose Rivaz Pena
Firma ______________________

Recibe: Carlos Menendez
Firma ______________________

Dos copias: una para la sala, una para quien retira.
```

**Cierra con tres cifras y no con una** porque una bolsa puede llegar sin un
billete adentro y estar perfecta: lo que se entrega es efectivo **más** boletas
del banco, y las dos mitades tienen que viajar declaradas. El folio queda en
`bolsas_entregas`.

#### Lo que se aprendió imprimiéndolos (2026-08-15)

Dos defectos que sólo aparecen en el papel, los dos anclados en
`tests/unit/bolsaComprobante.test.js`:

1. **`EFECTIVO` mide 8 y su columna mide 8**, así que el encabezado se pegaba al
   de al lado y salía `HORAEFECTIVO`. Quedó en `MONTO`.
2. **El relleno del rollo recorta por la IZQUIERDA lo que no entra**
   (`padStart(8).slice(-8)`). Con `-1,234.56` se perdía el primer carácter, que
   es el signo: **un faltante impreso como sobrante.** Por eso los importes de
   esa columna van sin `$` y sin signo —la dirección la declara el encabezado— y
   sueltan el separador de miles antes que perder un dígito.

---

## 7. Las pantallas

### 7.1 En la sala

- **Baldosa del Inicio «Bolsas en sala»**: cuántas hay, cuánto suman, cuál es la
  más vieja y **hace cuántos días fue el último retiro** (no «cuándo pasa el
  próximo»: los días no son fijos). Y las tres alarmas: *bolsa sin cerrar* (hay
  un corte confirmado sin su bolsa), *etiqueta desactualizada* y *bolsa de 4
  días o más*.
- **Al confirmar un corte**, ahí mismo: «Guardar en bolsa $716.92» → imprime la
  etiqueta. Cerrar la bolsa es un acto físico de una persona, así que es un
  segundo toque y no un efecto automático del corte. Si no se hace, el corte
  aparece como *pendiente de embolsar* — que es lo que alimenta el invariante
  de la §5.1.
- **Widget «Entrega de remesas»**: monto → el portal elige **la bolsa más vieja
  que alcance sola** y lo dice («sale de la bolsa del corte del 14/08 19:01;
  quedan $366.92») → banco, número de boleta del POS, foto → **quién se lleva el
  efectivo**, salvo que sea remesa (§8.1) → imprime el vale y la etiqueta nueva.
  Si ninguna bolsa alcanza, propone la
  combinación desde la más vieja y avisa que van a ser dos vales. Si no hay
  bolsas, la remesa se registra igual y queda como pagada con el efectivo del
  cajón (§5.3).

### 7.2 En administración

Módulo nuevo, tres pestañas:

- **En sala** — por sucursal: bolsas, efectivo, vales, días desde el último
  retiro. Y el total de todas, que es lo que se pidió saber.
- **Retiros** — el de hoy (qué salas faltan), los recibidos sin contar, y la
  pantalla de conteo.
- **Historial** — cerrados, con sus diferencias y cómo se resolvieron.

**La pantalla de conteo** agrupa por sala, y por bolsa muestra folio, corte,
efectivo esperado y vales adentro. Un toque «Cuadra» por bolsa; escribir sólo
cuando no. Totales por sala y total general arriba. «Confirmar conteo» cierra el
retiro. Es la misma regla que ya rige en cortes —*lo que cuadra se firma de un
clic; lo que no, se abre*— y se implementa llamando a la misma función, no
copiándola.

**«Son 5 bolsas, confirmar las 5»** (usuario, 2026-08-15): arriba de la sala hay
un botón que confirma de una vez **las que cuadran**, y dice cuántas son y por
cuánto antes de apretarlo. Las que no cuadran no las toca — quedan abiertas y a
la vista. Ese botón **llama a la misma función una vez por bolsa**, no a un
atajo propio: en recepción de pedidos, un botón «Confirmar todo» que hacía casi
lo mismo que el individual dejó de ingresar mercadería al inventario durante
semanas (ver `feedback_el_efecto_colateral_enganchado_a_un_solo_boton`).

---

## 8. Qué es una remesa acá, y los otros tipos

**Corregido el 2026-08-15 por el usuario.** No es un depósito bancario: **la
sala ENTREGA remesas a los clientes, con un POS de un banco.** El cliente llega,
la sala le paga en efectivo, el POS del banco imprime la boleta. O sea que el
efectivo sale de la sala y lo que queda en su lugar es un documento del banco.

Tres consecuencias, y las tres importan:

1. **El vale no es un pagaré interno, es un comprobante del banco.** Lo que
   queda en la bolsa vale tanto como el billete que salió, y quien lo cobra es
   administración contra el banco. Por eso una bolsa vacía de efectivo puede
   estar perfectamente cuadrada (§9).
2. **La foto y el número de boleta son del POS**, no de un recibo escrito a
   mano. Ese número es lo que permite reclamarle al banco.
3. **La liquidación con el banco queda fuera de este alcance.** El circuito de
   acá termina cuando administración recibe la boleta con la bolsa. Si más
   adelante se quiere seguir el reembolso hasta que el banco paga, se engancha a
   `bolsas_operaciones` sin rehacer nada — pero es otra decisión.

Catálogo en tabla; cada fila declara qué exige el formulario:

| Código | Etiqueta en pantalla | Banco/Prov. | Boleta | Foto | Quién lo recibe |
|---|---|---|---|---|---|
| `REMESA` | Remesa entregada a un cliente | banco | sí (POS) | sí | el cliente — lo identifica la boleta |
| `PAGO_PROVEEDOR` | Pago a proveedor | proveedor | sí | sí | se identifica (§8.1) |
| `GASTO` | Gasto o compra urgente | no | sí | sí | se identifica |
| `ENVIO_SALA` | Envío de efectivo a otra sala | no | no | sí | se identifica |
| `ANTICIPO` | Anticipo a un empleado | no | no | no | se identifica |
| `OTRO` | Otro | no | no | sí | se identifica |

**Ninguna fila pide autorización previa** (§4.5). La columna que reemplazó a esa
es la que importa: quién se llevó el efectivo.

Para `REMESA`, «el tipo de remesa» que se pidió registrar sale de la misma
tabla: si hay más de un banco o más de un producto, cada uno es una fila del
catálogo de bancos, no una lista escrita en el formulario.

Y dos que **no son salidas** y se registran igual:

- `REINTEGRO` (monto positivo): dinero que vuelve a la bolsa — una remesa que no
  se concretó, o la reposición de un faltante.
- `CAMBIO_SENCILLO`: se abre la bolsa para cambiar un billete. **No mueve el
  saldo**, pero rompe el sello, así que queda en la bitácora con quién y cuándo.
  Sin esto, cada apertura legítima se ve igual que ninguna.

**`REPOSICION_CAJA` se saca de la lista, y conviene que no exista.** Sacar
dinero de una bolsa para devolverlo al cajón lo hace reaparecer en el conteo del
corte siguiente, y de ahí se embolsa **otra vez**: el mismo billete contado dos
veces, sin que ninguna cuenta lo delate. Si al cajón le falta sencillo, eso es
`CAMBIO_SENCILLO` (neto cero) y no una salida. Falta confirmar que no pase de
otra forma (§12).

### 8.1 Quién se llevó el dinero, y cómo se amarra al portal

Pregunta del usuario (2026-08-15): *«si es otro tipo de vale requiere firma de la
persona que está retirándolo. ¿Cómo podemos hacer para amarrarlo al portal?
¿Escanear carné, poner usuario, y si no está, poner nombre - apellido?»*

**Corregido por el usuario en el momento**: la lista de empleados NO sirve.
*«Debe escribir el usuario y la contraseña, así nos aseguramos que sí sea él.»*
Y para retirar dinero, **sólo se aceptan las formas 1 y 2** — nunca un nombre
tecleado.

1. **Escanear el carné.** El más rápido, y ya existe: es el mismo lector del
   login, que trabaja por captura de teclado, sin cámara ni permisos.
2. **Escribir su usuario y su contraseña**, en el mismo formulario del vale.

La diferencia entre las dos y la lista es **exactamente** la que el usuario
señaló: elegir un nombre de una lista lo puede hacer cualquiera que sepa
escribirlo. Es identificación, no prueba. Con esto, quien firma el vale probó
que es él.

**La consecuencia dura: sin carné y sin cuenta no hay entrega de efectivo.** Un
motorista de un proveedor no puede recibir el dinero directamente — lo retira un
empleado y él lo paga. Es una regla de negocio, y hay que confirmar que se puede
cumplir siempre (§12). El premio es que **desaparece el campo de texto libre**, y
con él la clase de defecto que ya rompió el registro de relevos: un nombre
tecleado no se cruza con nada, así que no se puede sumar cuánto retiró alguien,
ni cobrárselo, ni notarlo.

#### La trampa técnica: verificar a un segundo sin desloguear al primero

La pantalla está abierta con la sesión de quien registra el vale. Llamar a
`signInWithPassword` en el cliente de siempre **reemplaza esa sesión**: la sala
quedaría logueada como la persona que vino a retirar el dinero, en medio de una
operación de caja, y nadie lo notaría hasta la siguiente acción.

Se verifica en un cliente aparte, creado para eso y descartado enseguida:
`persistSession: false`, `autoRefreshToken: false` y su propio `storageKey`, de
modo que no toca el almacenamiento de la sesión viva. Se resuelve el usuario a
`employee_id`, se comprueba que esté activo, se cierra esa sesión y se guarda
sólo la persona. **La contraseña no se guarda, no se registra y no viaja a
ninguna tabla.**

Dos límites que conviene tener escritos:

- **Hay cuentas donde la contraseña ES el código del carné** (las
  `@staff.local`, creadas por el login por escaneo). Para esas personas, las
  formas 1 y 2 prueban lo mismo. No lo empeora, pero tampoco lo arregla: lo
  arregla `docs/PLAN-CREDENCIAL-DE-CARNE-2026-08-12.md`, que sigue abierto.
- **El número del carné no se guarda ni se muestra.** Es la contraseña de esa
  persona; el escaneo lo resuelve a `employee_id` en el servidor y lo descarta.

**Y el papel conserva igual su línea de firma a mano.** El vale es el documento
que queda dentro de la bolsa y lo va a leer alguien que no estuvo ahí; las dos
cosas juntas cuestan lo mismo que una sola.

---

## 9. El conteo, la diferencia y el aviso

### 9.1 Una bolsa no se cuenta en dinero: se cuenta en dinero + boletas

Es la respuesta a *«¿qué pasa si se sacó dinero y quedó una bolsa vacía por
remesas?»*. Una bolsa cuadra cuando:

```
efectivo contado  +  Σ boletas presentes  ==  monto_inicial
```

Con eso, la bolsa vacía no es un caso especial: tiene $0 de efectivo y $716.92
en tres boletas del banco, y **cuadra**. Su etiqueta lo dice antes de abrirla:

```
EFECTIVO QUE DEBE HABER                         0.00
VALES ADENTRO             3                   716.92
```

Contar sólo el dinero haría que esa bolsa apareciera con un faltante de $716.92
— y peor, que una bolsa a la que le robaron el efectivo y le sacaron las boletas
se viera igual que una legítima. Por eso el conteo confirma **las dos cosas**, y
la pantalla muestra las boletas con su número de POS para poder cotejarlas
contra el papel que se tiene en la mano.

Cuando no cuadra, la diferencia se separa en dos, porque no se investigan igual:
**falta efectivo** (alguien tocó el dinero) o **falta una boleta** (se traspapeló
un documento que el banco tiene que reembolsar).

### 9.2 El circuito de la diferencia

1. Administración marca la bolsa `NO CUADRA` y escribe **lo contado**. El
   servidor calcula la diferencia contra el saldo; el navegador no la manda.
2. Sale un aviso a la sala por `notify_employees`, a los mismos destinatarios de
   cortes, con folio, corte de origen, esperado, contado y diferencia. **Acá sí
   va el monto** —a diferencia del aviso de un corte nuevo, donde es
   provisional—: éste es un número contado y firmado, no cambia.
3. La sala abre la bolsa en el portal, ve sus vales y comenta. El hilo vive en
   `bolsas_eventos`.
4. Se resuelve por una de tres vías, igual que en cortes: **REPONE** (alguien
   pone el dinero, se imprime el comprobante y se firma), **RETIRA** (sobró),
   **JUSTIFICA** (apareció el vale que faltaba, se explica y no se mueve
   dinero). La bolsa vuelve a su saldo esperado; lo contado queda.

---

## 10. Los tres avisos automáticos

Reusando lo que ya corre para cortes (cron + `notify_employees`):

- **Corte confirmado sin bolsa** — el invariante de la §5.1 en forma de aviso.
  Es el que detecta el caso peor: efectivo contado que nunca se guardó.
- **Bolsa de 4 días o más en sala** — umbral fijado por el usuario el
  2026-08-15, contra un ciclo normal de ~3 días: al cuarto ya se pasó. Cuenta
  desde `cerrada_at` de la bolsa más vieja abierta, no desde el último retiro
  —una sala puede recibir un retiro parcial y quedarse con la bolsa vieja—.
  Avisa a la sala **y** a administración: es la medida de riesgo real, cuánto
  efectivo hay afuera y desde cuándo. Un aviso por sala y por día, con la misma
  marca `metadata.check_key` que usa `avisar_cortes_pendientes`, para que correr
  el trabajo dos veces no mande dos avisos.
- **Retiro recibido sin contar** — para que no se acumulen valijas sin abrir.

---

## 11. Infraestructura

- **Permisos**: `bolsas` (sala, `can_edit` alcance BRANCH — mismos cargos que
  `cortes_caja`), `bolsas_retiros` (administración), `bolsas_conteo`
  (administración, `can_approve` para cerrar), `dash_bolsas_sala`,
  `dash_remesas`. Son módulos distintos porque son públicos distintos: la sala
  entrega, administración cuenta.
- **RLS** en las seis tablas, policy explícita, `auth_can_edit_any([...])` para
  escritura, **toda llamada `auth_*` envuelta en `(SELECT ...)`**, índice sobre
  cada FK.
- **Fotos** al bucket privado `payment-proofs`, se guarda la URL formato-public
  y se firma al mostrar con `getSignedFileUrl`.
- **Migraciones**: `SET lock_timeout='5s'`; ninguna toca tablas calientes salvo
  el FK a `cortes_caja`, que sí lo es — probar primero en el branch de staging.
- Toda acción de usuario → `appendAuditLog`.
- Los `RAISE EXCEPTION` de las RPC salen a pantalla por `mensajeAmigable`: se
  escriben en el español del portal, sin voseo, y **el gate de diseño no los
  lee** — hay que revisarlos a mano.
- La UI no nombra el sistema de origen ni dice «sincronizar».

---

## 12. Lo que falta decidir

### Cerrado el 2026-08-15

- **El monto de la bolsa** = incremento contra el corte anterior del día. Los
  $150 del fondo de cambio quedan afuera del corte y afuera de la bolsa (§5.1).
- **Remesa** = la sala le entrega efectivo al cliente con un POS de un banco
  (§8). No es un depósito bancario.
- **El conteo es bolsa por bolsa**, con un botón que confirma de una vez las que
  cuadran (§7.2).
- **De qué bolsa sale la plata**: la más vieja que alcance sola; si ninguna
  alcanza, se combinan desde la más vieja y la remesa lleva dos vales (§4.6).

- **Todos tienen cuenta en el portal**, incluido el que recolecta: firma en la
  sala en el momento, y ninguna firma es un nombre tecleado (§4.2).
- **Los días de retiro no son fijos**: sin calendario ni retiros programados; el
  retiro nace cuando pasa (§5.2).
- **Alarma a los 4 días** de una bolsa en sala (§10).
- **Ninguna salida necesita autorización previa.** Lo que se registra es **quién
  se llevó el efectivo**, y se prueba: carné escaneado **o** usuario y
  contraseña — nunca un nombre tecleado (§4.5 y §8.1). Si algún día hace falta
  un visto —por ejemplo un tope por monto— el usuario ya definió quién lo daría:
  Jefe/a o Subjefe/a de sala.

### Abierto, y sale de la decisión de arriba

10. **Efectivo a alguien que no es de la empresa.** Con «carné o contraseña» un
    externo no puede recibir dinero: lo retira un empleado y él paga. ¿Se puede
    cumplir siempre, o hay pagos que se entregan en mano a un motorista ajeno?
    Si los hay, hace falta un camino aparte —y explícito— para ese caso.

**No queda nada bloqueando el arranque de la F1.**

### Abierto (no bloquea, se puede decidir sobre la marcha)

5. **Las otras causas** de la §8: cuáles pasan de verdad y cuál falta. Y
   confirmar que sacar dinero de una bolsa para devolverlo al cajón **no pasa**
   — es el único caso que hace que un billete se embolse dos veces.
6. **Los tipos de remesa**: ¿cuántos bancos/productos hay? Cada uno es una fila
   del catálogo.
7. **Las remesas pagadas con el efectivo del cajón** (sin tocar bolsa): el
   modelo ya las admite (operación con cero movimientos). Falta decidir si se
   exigen desde el día uno o se dejan para después.
8. **Sucursal vs sala de venta.** Hoy las seis sucursales tienen **una sola
   caja** cada una (verificado en los cortes capturados), así que los dos totales
   dan lo mismo. Si va a haber sucursales con más de una sala, el modelo lo
   aguanta —la bolsa cuelga del corte, que trae sala y caja— pero cambia cómo se
   agrupan las pantallas.
9. **El reembolso del banco**: por ahora el circuito termina cuando
   administración recibe la boleta. Seguirlo hasta que el banco paga es otra
   decisión, y se engancha a `bolsas_operaciones` sin rehacer nada (§8).

---

## 13. Fases

| Fase | Qué entrega | Sirve sola |
|---|---|---|
| **F1** | `bolsas` + cerrar la bolsa desde el corte + etiqueta impresa + baldosa de la sala | Sí: la cinta escrita a mano desaparece |
| **F2** | Retiro, entrega, recepción + comprobante de entrega | Sí: se sabe qué salió de cada sala y quién firmó |
| **F3** | Conteo en administración, diferencias, aviso, comentarios, resolución | Cierra el circuito del punto 3 |
| **F4** | Movimientos: widget de remesas, vale impreso, foto, otras causas | Cierra el punto 4 |
| **F5** | Tablero de todas las sucursales + los tres avisos automáticos | Control global y alarma de riesgo |

F4 puede adelantarse si sacar dinero de las bolsas es más urgente que el conteo
— la etiqueta de F1 ya sabe listar movimientos, sólo falta quién los crea.

**La primera prueba de F1 no es de software**: cerrar una bolsa real, pegarle la
etiqueta, y contarla en administración contra lo que dice el papel. Ahí se
confirma o se cae la fórmula del monto (§5.1), y es barato hacerlo antes de
construir F2 y F3 encima.
