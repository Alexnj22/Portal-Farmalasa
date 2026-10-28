# Caja, cortes y bolsas de efectivo

Escrito el 2026-10-28. Junta en un solo lugar lo que vivía repartido en tres
documentos —cómo funciona el corte (14-ago), la auditoría del corte hecho desde
el portal (2-sep) y el plan de las bolsas (15-ago)— más los dos planes ya
cerrados de la caja en el portal (28-ago) y de ingresos con forma de pago
(17-oct). Los estados se verificaron contra `CHANGELOG.md`, `src/` y
`supabase/` el mismo día; **no se midió contra la base**. Las reglas de
CLAUDE.md sobre cuentas por cobrar, el cobro en efectivo y el cierre del día son
la versión que manda: acá se resumen y se apunta a ellas.

---

## 1. El circuito del dinero

El dinero entra a la caja con una **venta** en efectivo (o un ingreso, o un cobro
de crédito); la sala lo cuenta en un **corte** C, que es acumulativo dentro del
día; lo que cada corte confirmado agrega sobre el anterior se guarda en una
**bolsa** con su etiqueta; las bolsas se **entregan** a quien recolecta, se
**reciben** y se **cuentan** en administración, y de ahí salen al **depósito**
en el banco. El día lo cierra un **Z**, que cuenta lo vendido, no el efectivo.
El portal **lee** del sistema de la caja el tiquete de cada corte, los
movimientos (ingresos y vales) y las facturas con su forma de pago; **calcula**
él mismo la diferencia buena (desde el tiquete), el tramo de cada corte, el
monto de cada bolsa, la corrección por los cobros de crédito en efectivo hechos
desde el portal, y los tres frenos del cierre. Y desde v2.851.0 también
**escribe** en la caja: abre, anota ingresos y vales, corta y cierra el día desde
Mi caja.

---

## 2. Estado en una pantalla

| pieza | estado | evidencia |
|---|---|---|
| Captura de cortes, movimientos y facturas | en uso | `sync-cortes-caja` cada 30 s; `desaparecido_at` marca lo que el origen borró |
| Diferencia del corte: **el tiquete siempre gana** | en uso | v2.931.1 quitó la excepción a favor de la guardada; medido sobre 485 cortes |
| Mi caja: abrir, anotar, cortar a ciegas, cerrar el día | en uso | v2.851.0; turno desde el campo escondido v2.913.4; espera visible v2.1218.1 |
| Corte Z desde el portal | en uso | se manda como viene y se comprueba el tipo; defectos del primer cierre real en migración `20260902032330` |
| Cierre automático del día que nadie cerró | en uso | v2.1035.0, `cierre-automatico-caja` + `caja_cierre_automatico_decidir` |
| Tres frenos del cierre | en uso | v2.1022.0 y siguientes; `caja_falta_por_contar` |
| Cobro de crédito en efectivo sumado al esperado | en uso | `cortes_caja.cobros_portal_efectivo` sellado por trigger; `gate:cortes` |
| Ingresos con forma de pago (tarjeta/transferencia fuera del cajón) | en uso | v2.1304.0 |
| Mapfre (pago del asegurado) y reservas con anticipo | en uso | Mapfre 19-oct; Reservas v2.1319.0 → v2.1357.x |
| Bolsas: cerrar, etiqueta, sacar dinero, entregar, recibir, contar, diferencias | en uso | módulo `/bolsas` (v2.743.6), `src/data/bolsas.js` |
| Depósito al banco con remanente y aporte | en uso | v2.1088.1, v2.1223.2 (DEP-261005-1, $25,145) |
| Salida de bolsa sin comprobante → autorización | en uso | v2.1344.0 |
| App del personal: efectivo, cortes y bolsas | en uso | v2.1129.0, v2.1226.2 |

Lo que en los documentos viejos decía «nunca corrió» (la apertura, el Z,
`depositos_bancarios` en 0 filas, 0 entregas confirmadas) **ya no es cierto**:
el CHANGELOG registra intentos reales de apertura en Salud 3 (2-sep), el primer
cierre real con sus dos defectos corregidos, y depósitos al banco por decenas de
miles de dólares. Esos números eran la foto de agosto.

---

## 3. Lo que falta

Una sola lista, sin repetir. Ninguno bloquea el uso diario.

1. **Comentario viejo en `operar-caja`.** `supabase/functions/operar-caja/index.ts`
   l. 52-56 sigue diciendo *«el Z sale de cerrar el turno, no del formulario del
   corte»*, desmentido el 1-sep y corregido más abajo en el mismo archivo. Es el
   primero que se lee. — Lo destraba: cualquier sesión, sin decisión. Evidencia:
   leído hoy.
2. **Comentario viejo en `hacer-corte-caja`.** El bloque de l. 514-522 todavía
   dice que `diferenciaDelCorte` *«tiene un caso en el que la buena es la del
   FORMULARIO»*. El segundo de los dos comentarios que denunció la auditoría
   (l. ~1728) ya se corrigió; éste no. — Cualquier sesión. Evidencia: leído hoy.
3. **Rama muerta en `notaDeCifra`.** `src/utils/cortesDiagnostico.js` l. ~897:
   `if (c.porCobrosCredito && fuente === 'guardada')`. Con `contraste` presente
   `diferenciaDelCorte` nunca devuelve `fuente: 'guardada'` (sólo la devuelve
   cuando no hay contraste, y `notaDeCifra` sale antes), así que el texto «Se
   cortó antes de los cobros de crédito» es inalcanzable y describe la regla
   que se quitó en v2.931.1. — Cualquier sesión; tocar también su prueba.
   Evidencia: leído hoy.
4. **`caja_vales` · `can_edit` con alcance ALL para Jefe/a de Talento Humano.**
   Es poder cortar o cerrar la caja de cualquiera de las siete salas, y un Z no se
   deshace. Se heredó, no se pidió. — Lo destraba: **el usuario**. Evidencia: no
   hay migración ni entrada del CHANGELOG que lo haya cambiado desde el 2-sep.
5. **El aporte del depósito no está enlazado al vale real.** Se registra como
   monto con su nota (v2.739.0: *«vincularlo exigiría adivinar con qué motivo se
   registró»*). Para cerrarlo hace falta un motivo propio en «Sacar dinero». —
   Lo destraba: el usuario (el motivo) y después código. Evidencia: sin entrada
   posterior que lo cierre.
6. **Decisiones de la §12 del plan de bolsas que no tienen registro de haberse
   tomado** (pueden estar resueltas en la práctica sin que nadie lo escribiera):
   - **Sucursal con más de una caja.** Hoy cada sala tiene una; el modelo lo
     aguanta (la bolsa cuelga del corte), pero las pantallas agrupan por sala.
   - **Seguir el reembolso del banco** de las remesas hasta que el banco paga.
     Hoy el circuito termina cuando administración recibe la boleta y deposita.

   Lo que **sí** se decidió y sale de la lista: el efectivo a quien no es de la
   empresa (pago a proveedor no pide identificación, v2.667.0), `REPOSICION_CAJA`
   (no existe a propósito), las remesas pagadas desde el cajón (salida mixta
   bolsa/cajón en `operar-caja`) y los 15/16-ago sin bolsas (son los dos días
   del arranque; el aviso los nombra como tales desde v2.800.2).

---

## 4. Cómo funciona

### 4.1 El corte

**El portal no reconstruye el corte: lo lee.** El tiquete es la fuente. La
fórmula del tiquete:

```
TOTAL CAJA = INGRESOS + VENTA − VALES + COBROS CRÉDITO
```

`TOTAL CAJA` es lo que debe haber en la gaveta. La línea `EFECTIVO` del tiquete
**no es efectivo**: es la suma de tres casillas que el dependiente teclea
(efectivo, tarjeta, cheque), y la diferencia la calcula el navegador del
dependiente. Inflando la casilla de tarjeta se tapa un faltante sin que el
sistema diga nada — por eso el corte desde el portal manda **tarjeta y cheque
en cero** en el C, y por eso el conteo es **a ciegas**: el esperado no viaja al
navegador hasta después de teclear el efectivo.

**Las dos diferencias.** El origen produce dos y no siempre coinciden:

| | cuenta | |
|---|---|---|
| la guardada | `contado − total_corte` del formulario | `total_corte = tiquetes + facturas + crédito + apertura + entradas − salidas`: **no** suma los cobros de crédito y **sí** las ventas no-efectivo |
| la del tiquete | `contado − TOTAL CAJA` | cierra contra los movimientos |

**Manda la del tiquete, siempre** (v2.931.1). La excepción que daba la razón a la
guardada cuando la brecha era exactamente +1× el cobro se quitó: medido sobre
485 cortes, el tiquete cierra en el 100% y el formulario se aparta en el 23%.
Antes del portal ya discrepaban 92 de 428 cortes (21.5%), con una brecha de hasta
$970.40: **el defecto es del origen**. Decisión del usuario (2-sep): *«el error
del ERP dejalo como está… por eso en el portal lo dejamos bien»*. El registro y
el tiquete de la caja quedan con la cifra del origen; la pantalla, el papel del
portal y las bolsas llevan la buena. **No reproponer que el portal escriba un
esperado propio en la caja.**

Si las dos discrepan y **no** es por los cobros de crédito, el portal no elige:
muestra las dos y avisa.

**Acumulativo, y sólo un CONFIRMADO corre la base.** El corte de la noche contiene
al de la mañana; lo que señala a un turno es el **tramo** (cuánto se movió desde
el corte anterior). El sistema no anula cortes: la sala **rehace** el corte, y un
corte repetido es la corrección del anterior. Si cualquier corte corriera la
base, el portal inventaba un faltante igual y opuesto (Salud 5, 14-ago:
«FALTANTE −$1.25» sobre un corte que cuadraba). Los descartados nunca cuentan.
`corte_tramo` (SQL) y `conTramo` (JS) son la misma regla escrita dos veces: al
tocar una se toca la otra, y el servidor rechaza si su monto no coincide con el
de la pantalla.

**La venta al crédito son dos momentos.** Al venderse **no suma a VENTA**
(aparece al pie del tiquete, informativa; verificado contra facturas en las 6
salas). Al pagarse entra como **COBROS CRÉDITO**, el mismo día o semanas
después. Un cobro sin anotar se ve exactamente igual que un sobrante.

**El Z da VENTAS, no efectivo.** Su total es todo lo vendido; restándole tarjeta
y crédito da el `VENTA` del último corte (Salud 1, 13-ago: $1,628.75 − $202.55 −
$13.00 = $1,413.20, al centavo en las 6 salas). El desglose por forma de pago
sale de `sales_invoices.tipo_pago` y no del tiquete, que **no nombra las
transferencias** — una forma nueva tiene que aparecer sola, no esconderse en el
efectivo.

**Encima del corte, el portal agrega**: reabrir con motivo (`cortes_caja_eventos`),
resolver la diferencia (repone / retira / ya se encontró la causa, con varias
personas aportando, `cortes_caja_diferencias`), los dos papeles (reposición e
ingreso/vale acumulado) y el asiento único para varias diferencias. **El monto
que se cobra lo calcula el servidor** y se rechaza si no coincide con la
pantalla.

Archivos:

| qué | dónde |
|---|---|
| la aritmética: `contraste`, `diferenciaDelCorte`, `conTramo`, `conLaCuentaBuena`, `notaDeCifra` | `src/utils/cortesDiagnostico.js` |
| papeles del corte | `src/utils/corteComprobante.js` |
| pruebas que anclan los números | `tests/unit/cortesDiagnostico.test.js`, `tests/unit/corteComprobante.test.js` |
| captura | `supabase/functions/sync-cortes-caja/`, `sync-aperturas-caja/`, `sync-corte-z/` |
| servidor | `corte_diferencia`, `corte_tramo` en Postgres |
| pantallas | `src/views/CortesView.jsx`, `src/data/cortes.js` |

### 4.2 Mi caja: la caja operada desde el portal

`src/views/MiCajaView.jsx`, contra dos edge functions:

- **`operar-caja`** — abrir la caja, iniciar turno, anotar ingresos y vales. El
  servidor de la caja toma `id_apertura`, `id_empleado` y `turno` **del
  formulario, no de la sesión** (probado el 28-ago): no hacen falta cuentas por
  caja, la identidad la pone el portal. El turno lo calcula la caja en el campo
  escondido `turno`; el `1` fijo dejó a Salud 3 sin su tercer turno (v2.913.4).
- **`hacer-corte-caja`** — el C y el Z. El C va con tarjeta y cheque en cero. El
  **Z se manda como vino**, cambiando sólo `tipo_corte` (su default es X); el
  portal le inventaba tres casillas y dejó de hacerlo. **El tipo que sale se
  comprueba leyendo el comprobante**: el 31-ago un «corte» salió como LECTURA X
  con `success`. Si en un cierre el Z no sale del tipo pedido, **no se cierra el
  turno**: el día abierto es lo reparable.

Lo que hace bien y no se toca: el conteo a ciegas, el vale de las salidas escrito
**antes** del corte con freno de duplicado contra el listado del origen, la
lectura X capturada (`["C","Z","X"]`) para que un tipo equivocado no sea
invisible.

**«Vale» son tres papeles distintos**, y confundirlos fue lo que hacía ilegible
el circuito:

| se llama | cuántos | ¿mueve el esperado de la caja? |
|---|---|---|
| vale de papel | uno por operación, aunque toque varias bolsas; se archiva aparte | no |
| etiqueta | una por bolsa, con `inicial − salidas = lo que queda` | no |
| **vale de caja** | uno por corte, escrito en el sistema de la caja | **sí** |

**De qué bolsa sale el dinero decide si se anota en la caja.** La plata de las
bolsas de **hoy** sigue siendo caja hasta el Z; la de un día cerrado ya no. Salida
de una bolsa del día abierto → vale de caja por el monto. Salida de una bolsa de
un día cerrado → **no se anota nada** (Salud 1, 22-ago: dos remesas de una bolsa
del 21 anotadas igual dieron +$454.00 de sobrante, tapado con un ingreso falso).
El portal sabe cuál de los dos casos es; nadie más.

**Ingresos con forma de pago** (v2.1304.0). Todo ingreso que llega al cajón la
caja lo trata como efectivo. Tarjeta y transferencia llevan foto del voucher o
comprobante y **no van a la caja**; sin foto, el ingreso existe pero queda
pendiente de autorización (por permiso, no por cadena de cargos). Un voucher
puede cubrir venta + ingreso. `caja_efectivo_piezas` filtra por forma de pago y
alimenta `caja_estado`, `caja_falta_por_contar` y `caja_falta_contra_corte`.
Mapfre (lo que paga el asegurado, desde el renglón de puntos de la factura) y el
anticipo de las reservas usan el mismo camino.

### 4.3 Bolsas de efectivo

Módulo `/bolsas` (`src/views/BolsasView.jsx`, `src/views/bolsas/`), datos en
`src/data/bolsas.js`, papeles en `src/utils/bolsaComprobante.js`, cierre en
`src/hooks/useCerrarBolsa.js`.

**Modelo.** Una bolsa nace de un corte C **confirmado** con:

```
monto = total_declarado(N) − total_declarado(último C confirmado anterior del día)
Σ bolsas de una sala en un día == total_declarado del último C confirmado
```

Ese invariante es lo que hace verificable el circuito y alimenta el aviso
«efectivo sin guardar». El fondo de cambio ($150) vive **afuera** del corte y
afuera de la bolsa. El monto lo calcula el servidor. El corte nunca se edita: lo
que baja es el **saldo de la bolsa** (`monto_inicial + Σ movimientos`, con
signo). Folio con la sucursal en letras (`S3-1042`), desde `branches.codigo`,
nunca derivado del nombre.

Estados: `ABIERTA → ENTREGADA → RECIBIDA → CONTADA`, más `ANULADA` (anular
devuelve su efectivo a la del día). **Sólo una ABIERTA acepta salidas.** Tablas:
`bolsas`, `bolsas_operaciones` (el hecho: una remesa, un pago), `bolsas_movimientos`
(de qué bolsa salió, con signo), `bolsas_entregas`, `bolsas_conteos`,
`bolsas_eventos`, `bolsas_tipos_salida`, `bolsas_entidades`, `depositos_bancarios`.

**Sacar dinero.** Regla: la bolsa **más vieja que alcance sola**; si ninguna
alcanza, se combinan desde la más vieja. Una remesa es **una** operación (boleta
del POS, foto, monto); los movimientos dicen de qué bolsa salió cada parte, y el
servidor exige `Σ movimientos == monto`. Remesa = la sala **entrega efectivo a
un cliente** con el POS de un banco; la boleta ocupa el lugar del billete.
Ninguna salida pide visto previo: lo que se registra es **quién se llevó el
efectivo**, probado con carné escaneado o usuario y contraseña (verificados en
un cliente aparte con `persistSession: false`, sin tocar la sesión viva; la
contraseña no se guarda). Excepción decidida (v2.667.0): el pago a proveedor no
pide identificación porque el cobrador no es de la empresa. `bolsas_tipos_salida`
declara qué exige cada motivo (foto `NO`/`OPCIONAL`/`OBLIGATORIA`). Sin
comprobante, la salida sale igual y queda pendiente de autorización
(v2.1344.0). **`REPOSICION_CAJA` no existe a propósito**: devolver dinero de una
bolsa al cajón lo hace embolsarse dos veces.

**Papeles** (todos por `imprimirDocumento`, ASCII, 54 columnas):

- **Etiqueta**, pegada afuera, una por bolsa: siempre el estado de hoy, numerada
  (`ETIQUETA #3 - ANULA LA ANTERIOR`); toda salida la marca desactualizada.
- **Vale de salida**: **uno por operación** con una tabla de cuatro columnas que
  dice de qué bolsa y cuánto (decisión del 28-ago; antes salía uno por bolsa con
  «Este vale queda dentro de la bolsa X», y se quitó porque los vales se archivan
  aparte).
- **Comprobante de entrega**: efectivo + boletas + total según los cortes, con
  quien entrega y quien recibe — `recibido_por <> entregado_por` lo exige el
  servidor.

Dos defectos que sólo se ven en papel y están anclados en
`tests/unit/bolsaComprobante.test.js`: el encabezado `EFECTIVO` se pegaba al de
al lado, y el relleno recorta por la izquierda — un `-1,234.56` perdía el signo
y un faltante salía como sobrante. Los importes de esa columna van sin `$` ni
signo.

**Conteo.** Una bolsa cuadra con `efectivo contado + Σ boletas == saldo`: una
bolsa vacía de efectivo puede estar perfecta. Lo contado **no se edita nunca**;
la diferencia se resuelve (REPONE / RETIRA / JUSTIFICA) y quedan los dos números.
Confirmar de una vez las que cuadran llama a la misma función una vez por bolsa,
nunca a un atajo propio.

**Depósito al banco.** Junta bolsas contadas, registra banco, boleta, lo que va
al banco, el remanente y el aporte de afuera (`registrarDeposito`). Ver §3.5 sobre
el aporte.

**Avisos**: corte confirmado sin bolsa (el invariante), bolsa de **4 días o más**
en sala (desde `cerrada_at` de la más vieja, a la sala y a administración, una
vez por sala y día con `metadata.check_key`), y lo recibido sin contar.

### 4.4 Cobros de crédito en efectivo

Resumen de CLAUDE.md, §«Cuentas por cobrar» y §«El efectivo del cobro entra al
cajón». El espejo `creditos_de_clientes` da la **lista**; el **cobro** relee el
origen (`supabase/functions/creditos-erp`, `src/data/creditos.js`), y
`id_factura` lleva el **ID del crédito**: mandar el de la factura abona a otra
persona sin error y el origen no deshace abonos.

Lo que toca a la caja: el cobro en efectivo hecho desde el portal entra al cajón
como `POR ABONO A CREDITO` y **el comprobante no lo suma** ni a INGRESOS ni a
COBROS CREDITO. El esperado nace corto y el conteo aparece como sobrante (Salud
4, 2-sep: +$78.40 anunciado sobre un faltante real de $9.85). La corrección se
**sella en la fila**: `cortes_caja.cobros_portal_efectivo`, mantenida por dos
triggers, y `contraste` se la suma al esperado. El corte recién hecho no tiene
fila todavía: `conLaCuentaBuena` (pegada a `contraste`) le pide el mismo dato al
canónico `cobros_portal_en_efectivo`. Cuánto contó el comprobante se **deriva**
(`total_caja − subtotal + vales`), no del renglón del papel. Lo que no es
efectivo (transferencia) no llega al cajón ni se descuenta. Lo vigila
`npm run gate:cortes` (`scripts/cortes-gate.mjs`).

### 4.5 El cierre del día

Resumen de CLAUDE.md, §«El cierre del día tiene TRES frenos» y §«El día que
NADIE cerró». Los tres frenos viven en `hacer-corte-caja`, nunca en
`operar-caja` (llegaría con el Z ya emitido), y se repiten en la pantalla:

1. ningún corte sin resolver;
2. al menos un corte **confirmado** hoy;
3. **efectivo sin contar**: `caja_falta_por_contar` compara dos **esperados**
   (el de ahora contra el que midió el último confirmado), nunca esperado contra
   conteo, y no es un cronómetro. Un solo juez para el candado y el aviso.

Una hora después del cierre, si la caja sigue abierta y hay un C cerca del
cierre, `cierre-automatico-caja` emite el Z en modo `automatico`
(`caja_cierre_automatico_decidir`, consultado por el cron y otra vez antes de
emitir). En ese modo no frena «corte sin resolver» (el C de las 21:00 nace
pendiente) pero sí «efectivo sin contar», contra ese corte cercano. A las 7:00
`avisar_dias_sin_cierre` avisa. La sección D de `gate:cortes` nombra los días que
cerraron con efectivo sin contar; `YA_PASADOS` lleva los históricos con monto.

---

## 5. Antes de tocar algo acá

Cada una ya costó dinero o un día de diagnóstico.

1. **El tiquete gana siempre.** No resucitar la excepción a favor de la guardada
   ni reproponer escribirle a la caja un esperado propio (decisión del 2-sep).
2. **Sólo un corte CONFIRMADO corre la base del tramo.** El sistema rehace, no
   anula.
3. **`corte_tramo` y `conTramo` se mueven juntos**, y el servidor recalcula todo
   monto que después se le cobra a alguien.
4. **Al juez se le dan todas sus piezas.** Un objeto armado a mano para
   `contraste` (como `conLaCuentaBuena`) no falla: se queda corto. Al agregarle
   una columna al juez, se agrega ahí.
5. **«Aparecer en la lista de movimientos» no es «estar en el esperado».** La
   auditoría del 2-sep (§4) concluyó «no hay nada que descontar» con una medición
   correcta y un salto equivocado; medio día después el sobrante falso de Salud 4
   lo desmintió. Un defecto proporcional al monto se esconde mientras los montos
   son chicos.
6. **Lo que no es efectivo no llega al cajón.** Un ingreso con tarjeta anotado
   en la caja nace como faltante que no existe.
7. **Bolsa de hoy ≠ bolsa de un día cerrado.** Una salida de la primera lleva vale
   de caja; de la segunda, ninguno.
8. **El Z no se deshace.** Se manda como vino, se comprueba el tipo, y si sale
   mal el día queda abierto. Un freno del cierre en `operar-caja` llega tarde.
9. **No editar el corte para descontar una salida**: baja el saldo de la bolsa.
   El corte es la referencia independiente.
10. **No existe `REPOSICION_CAJA`.** Para sencillo, se abre la bolsa sin mover el
    saldo y queda en la bitácora.
11. **Quien se lleva efectivo se prueba, no se elige de una lista.** Y la
    verificación del segundo nunca reemplaza la sesión de quien registra.
12. **Lo contado no se sobrescribe**: se resuelve, y quedan los dos números.
13. **El papel recorta por la izquierda**: un signo en una columna angosta se
    pierde. Probar con lupa contra un ticket real.
14. **El cobro de crédito lleva el ID del crédito**, y después del abono se relee
    el origen.
15. **Una salida de dinero en la caja pasa por un solo juez** (v2.1334.0) y
    rechazar un movimiento lo anula (v2.1335.8): no escribir reglas paralelas.
16. **Al tocar consultas de caja: `npm run gate:cortes`** (necesita red, no va en
    el pre-commit). Al reescribir una función que lee `sales_invoices` o
    `caja_efectivo_piezas`, partir de la definición **viva**.
17. **La pantalla no nombra el sistema de origen.** «Caja», «comprobante»; nunca
    ERP ni «sincronizar».

Relacionado y aparte: **¿se le puede cobrar un faltante al empleado?** — la
pregunta laboral vive en
[FALTANTES-DE-CAJA-Y-DE-INVENTARIO-2026-08-27.md](FALTANTES-DE-CAJA-Y-DE-INVENTARIO-2026-08-27.md).

---

## 6. Fuentes

- [planes-cerrados/CORTES-DE-CAJA-COMO-FUNCIONA-2026-08-14.md](planes-cerrados/CORTES-DE-CAJA-COMO-FUNCIONA-2026-08-14.md)
  — la fórmula del tiquete, las dos diferencias, el tramo y el Z, con los números
  reales del 13 y 14 de agosto.
- [planes-cerrados/AUDITORIA-CORTE-DESDE-EL-PORTAL-2026-09-02.md](planes-cerrados/AUDITORIA-CORTE-DESDE-EL-PORTAL-2026-09-02.md)
  — qué es `total_corte` en el origen, la decisión de dejar su defecto, el Z
  mandado como viene. Su §4 («no hay nada que descontar») quedó corregida por
  CLAUDE.md.
- [planes-cerrados/PLAN-BOLSAS-DE-EFECTIVO-2026-08-15.md](planes-cerrados/PLAN-BOLSAS-DE-EFECTIVO-2026-08-15.md)
  — el diseño de las bolsas: las seis correcciones a la idea, el modelo, los
  papeles y la §12 de decisiones. Sus tablas `bolsas_retiros`/`bolsas_diferencias`
  no se construyeron con ese nombre.
- [planes-cerrados/PLAN-CAJA-EN-EL-PORTAL-2026-08-28.md](planes-cerrados/PLAN-CAJA-EN-EL-PORTAL-2026-08-28.md)
  — los endpoints de la caja, quién abre hoy, los movimientos borrados sin rastro
  y los tres significados de «vale».
- [planes-cerrados/PLAN-INGRESOS-Y-RESERVAS-2026-10-17.md](planes-cerrados/PLAN-INGRESOS-Y-RESERVAS-2026-10-17.md)
  — forma de pago en los ingresos, Mapfre y reservas con anticipo.
- CLAUDE.md, §«Cuentas por cobrar» y sus tres subsecciones de caja — la versión
  vigente de cobros en efectivo y cierre del día.
