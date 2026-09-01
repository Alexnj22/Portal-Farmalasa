# Los puntos se mudan al portal — plan listo para ejecutar

**2026-09-01.** MariaDB va a dejar de existir. Este documento tiene **todo el SQL
escrito y en orden** para que el día que se confirme, el trabajo en Supabase sea
pegar cuatro migraciones y correr una verificación. No aplicar nada hasta esa
confirmación.

El circuito actual, qué es cada tabla del otro lado y las trampas que ya costaron
una corrección están en `PUNTOS-EL-CIRCUITO-Y-LO-QUE-FALTA-2026-08-29.md`. Acá
sólo la mudanza.

---

## 0. Lo que YA está en el portal, y por eso esto es más chico de lo que parece

Medido contra producción el 2026-09-01:

| pieza | estado |
|---|---|
| `sales_invoices` + `sales_invoice_items` | 360,492 facturas desde 2025-05-01 |
| `product_precios_history` (`valid_from`/`valid_until`) | el precio 3 **vigente ese día**, que es la regla 3 |
| `customers` | 28,110 fichas · 28,109 acumulan · 16,696 con DUI y teléfono |
| `branches.codigo_puntos` / `codigo_puntos_previo` | el código de sala, incluido el `FLP` viejo |
| `puntos_enviados` | 360,490 filas — la bitácora del puente, y el mapa de la migración |
| `puntos_vencimiento_log` | ya existe |
| **`ventas_para_puntos()`** | **las tres reglas de elegibilidad, completas y andando** |

Esa última es la noticia: **el motor de acumulación no hay que escribirlo.** Ya
resuelve `FINALIZADA`, `total > 1`, el código de vendedor que cabe en un `int`,
`customers.acumula_puntos`, `laboratorios.acumula_puntos`, y el piso del precio 3
con su historia por fecha y el margen de 2%. Lo único que hoy vive del otro lado
es **el libro mayor**: quién tiene cuántos puntos, de qué compra vinieron y
cuándo vencen.

Ritmo actual, medido sobre los últimos 7 días: **~700 facturas y ~7,500 puntos
por día** — unos **$75 diarios** de deuda nueva.

---

## 1. Las cuatro tablas

El modelo es un **libro de lotes**, no un saldo. El vencimiento es por compra, así
que hay que saber de qué compra vino cada punto — un saldo suelto no puede
contestar «¿cuáles se me vencen en marzo?».

```
puntos_cuenta      una por cliente · el saldo mantenido y el estado
puntos_lote        cada ENTRADA · de qué venta vino, cuándo se ganó, cuándo vence
puntos_salida      cada SALIDA  · canje, anulación, vencimiento o ajuste, con motivo
puntos_salida_lote qué lote pagó cuánto de cada salida · el FIFO, auditable
```

Tres decisiones que ya están tomadas y esto las respeta:

- **La resta es una salida con su motivo, nunca un borrado.** Es la decisión del
  usuario del 2026-08-29 («así se usa eso, y el motivo es por anulación»). El
  saldo baja y queda **una línea que lo explica** en el estado de cuenta. Borrar
  le dejaba al cliente menos puntos y ninguna explicación.
- **Los asientos manuales son lotes.** Las 4,772 cortesías de cumpleaños y las
  promos de Navidad entran como `puntos_lote` con `origen='ajuste'` y su motivo.
  No necesitan tabla propia, y así también vencen.
- **El saldo se mantiene, no se deriva.** Con 1.7M de movimientos, sumar el libro
  en cada consulta es lo que hace lenta la pantalla del cliente. Se mantiene y se
  **cuadra** contra el libro con una función de reconciliación (§4).

### Migración 1 — las tablas

```sql
SET lock_timeout = '5s';

-- ── La cuenta ───────────────────────────────────────────────────────────────
CREATE TABLE public.puntos_cuenta (
  customer_id  bigint PRIMARY KEY REFERENCES public.customers(id) ON DELETE RESTRICT,
  saldo        integer     NOT NULL DEFAULT 0 CHECK (saldo   >= 0),
  ganados      integer     NOT NULL DEFAULT 0 CHECK (ganados >= 0),
  usados       integer     NOT NULL DEFAULT 0 CHECK (usados  >= 0),
  activa       boolean     NOT NULL DEFAULT true,
  migrada_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Las entradas ────────────────────────────────────────────────────────────
CREATE TABLE public.puntos_lote (
  id          bigserial PRIMARY KEY,
  customer_id bigint  NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  origen      text    NOT NULL CHECK (origen IN ('venta','ajuste','migracion')),
  invoice_id  bigint  REFERENCES public.sales_invoices(id) ON DELETE RESTRICT,
  sucursal    text,
  puntos      integer NOT NULL CHECK (puntos > 0),
  restantes   integer NOT NULL CHECK (restantes >= 0),
  ganado_el   date    NOT NULL,
  vence_el    date    NOT NULL,
  motivo      text,
  creado_por  uuid    REFERENCES public.employees(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (restantes <= puntos),
  CHECK (vence_el >= ganado_el),
  -- un lote de venta SIEMPRE nombra su venta; uno que no es de venta, nunca
  CHECK ((origen = 'venta') = (invoice_id IS NOT NULL)),
  -- un ajuste sin motivo es un punto que nadie puede explicar
  CHECK (origen <> 'ajuste' OR motivo IS NOT NULL)
);

-- El freno estructural al doble crédito. En la base vieja hay 27 tickets con
-- los puntos cobrados DOS veces (2,142 facturas viven bajo FLP y FLP1 a la vez).
-- Acá eso no es un bug que haya que cazar: la tabla no lo acepta.
CREATE UNIQUE INDEX puntos_lote_una_por_venta
  ON public.puntos_lote (invoice_id) WHERE invoice_id IS NOT NULL;

-- ── Las salidas ─────────────────────────────────────────────────────────────
CREATE TABLE public.puntos_salida (
  id             bigserial PRIMARY KEY,
  customer_id    bigint  NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  tipo           text    NOT NULL CHECK (tipo IN ('canje','anulacion','vencimiento','ajuste')),
  puntos         integer NOT NULL CHECK (puntos > 0),
  monto          numeric(10,2) CHECK (monto IS NULL OR monto >= 0),
  invoice_id     bigint  REFERENCES public.sales_invoices(id) ON DELETE RESTRICT,
  sucursal       text,
  motivo         text,
  autorizado_por uuid    REFERENCES public.employees(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- una anulación SIEMPRE nombra la venta que se anuló
  CHECK (tipo <> 'anulacion' OR invoice_id IS NOT NULL),
  CHECK (tipo <> 'ajuste'    OR motivo     IS NOT NULL)
);

-- ── El FIFO, escrito ────────────────────────────────────────────────────────
-- Sin esta tabla, «te vencieron 33 puntos» no se puede demostrar: se sabría el
-- número y no de dónde salió.
CREATE TABLE public.puntos_salida_lote (
  salida_id bigint  NOT NULL REFERENCES public.puntos_salida(id) ON DELETE RESTRICT,
  lote_id   bigint  NOT NULL REFERENCES public.puntos_lote(id)   ON DELETE RESTRICT,
  puntos    integer NOT NULL CHECK (puntos > 0),
  PRIMARY KEY (salida_id, lote_id)
);

-- ── Índices ─────────────────────────────────────────────────────────────────
-- El primero es EL índice del canje: los lotes vivos de una persona, del más
-- viejo al más nuevo. Sin él, cada canje barre la tabla entera.
CREATE INDEX puntos_lote_fifo   ON public.puntos_lote (customer_id, ganado_el, id)
  WHERE restantes > 0;
CREATE INDEX puntos_lote_vencen ON public.puntos_lote (vence_el)
  WHERE restantes > 0;
CREATE INDEX puntos_lote_cliente ON public.puntos_lote (customer_id);
CREATE INDEX puntos_lote_creador ON public.puntos_lote (creado_por) WHERE creado_por IS NOT NULL;
CREATE INDEX puntos_salida_cliente ON public.puntos_salida (customer_id, created_at DESC);
CREATE INDEX puntos_salida_venta   ON public.puntos_salida (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX puntos_salida_autoriza ON public.puntos_salida (autorizado_por) WHERE autorizado_por IS NOT NULL;
CREATE INDEX puntos_salida_lote_lote ON public.puntos_salida_lote (lote_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Leer: quien ya puede abrir la ficha de un cliente. No se inventa un permiso
-- nuevo — es la misma decisión que se tomó para `puntos-consulta`.
-- Escribir: NADIE por la API. Todo pasa por las funciones DEFINER de §3, que
-- son las que saben mantener el saldo y el FIFO en la misma transacción.
ALTER TABLE public.puntos_cuenta      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_lote        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_salida      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_salida_lote ENABLE ROW LEVEL SECURITY;

-- El wrapper `(SELECT …)` no es estilo: sin él Postgres evalúa la función POR
-- FILA y consulta employees+role_permissions en cada una. Fue la causa del
-- outage del 2026-07-08 (un count de 27K filas: 25,000 ms → 19 ms).
CREATE POLICY leer_cuenta ON public.puntos_cuenta FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));
CREATE POLICY leer_lote ON public.puntos_lote FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));
CREATE POLICY leer_salida ON public.puntos_salida FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));
CREATE POLICY leer_salida_lote ON public.puntos_salida_lote FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));

REVOKE ALL ON public.puntos_cuenta, public.puntos_lote,
              public.puntos_salida, public.puntos_salida_lote FROM anon;
GRANT SELECT ON public.puntos_cuenta, public.puntos_lote,
                public.puntos_salida, public.puntos_salida_lote TO authenticated;
```

**Se puede aplicar a cualquier hora.** No toca ninguna de las tablas calientes
(`sales_invoices`, `sales_invoice_items`, `inventory`, `products`): son tablas
nuevas y las FK hacia `customers`/`sales_invoices` toman un lock de validación
que no bloquea lecturas. El `lock_timeout` está igual, por regla.

### Probado en el branch de pruebas, y no sólo «entra sin error»

El 2026-09-01 se corrió el DDL completo en `qvctarsqvlhbzgvwbbbt` con
`execute_sql` —nunca `apply_migration`, que dejaría una fila en el
`schema_migrations` del branch que producción jamás va a tener con ese número y
mata el `rebase` para siempre—. Entró limpio y **después se borró**: el branch
quedó sin rastro.

Pero «entró sin error» no prueba nada sobre los candados. A cada uno se le
fabricó **la regresión que debería cazar**, dentro de una transacción que al
final se deshace con un `RAISE`:

```
 1 · lote de venta ........................ ENTRA
 2 · doble credito del mismo ticket ....... RECHAZADO ✓
 3 · lote de venta SIN venta .............. RECHAZADO ✓
 4 · ajuste sin motivo .................... RECHAZADO ✓
 5 · restantes mayores que el lote ........ RECHAZADO ✓
 6 · vence antes de ganarse ............... RECHAZADO ✓
 7 · saldo negativo ....................... RECHAZADO ✓
 8 · anulacion sin nombrar su venta ....... RECHAZADO ✓
 9 · canje FIFO deja saldo 5 .............. SI ✓
10 · borrar un lote ya consumido .......... RECHAZADO ✓
```

El caso 2 es el que más importa: en la base vieja hay **27 tickets con los puntos
cobrados dos veces** porque 2,142 facturas viven bajo `FLP` y `FLP1` a la vez.
Acá eso dejó de ser un defecto que haya que salir a cazar — **la tabla no lo
acepta**.

El bloque de pruebas completo está al final de este documento (§9) para volver a
correrlo el día que se aplique de verdad. Pruebas **no trae clientes ni ventas de
muestra**, así que el bloque fabrica los suyos y se los lleva al deshacerse.

---

## 2. La elegibilidad, sin la bitácora vieja

`ventas_para_puntos()` mezcla dos cosas: **la regla** (qué venta acumula) y **la
exclusión** (cuál ya se mandó a MySQL). Para que los dos sistemas puedan correr
en paralelo y compararse, hay que separarlas — si el nuevo circuito usara la
misma exclusión, cada uno le escondería trabajo al otro y **el cuadre sería
imposible justo cuando más se necesita**.

### Migración 2 — la regla sola

`ventas_para_puntos` **no se toca**: sigue alimentando a MySQL mientras exista.

```sql
SET lock_timeout = '5s';

-- La MISMA regla que `ventas_para_puntos`, sin la exclusión de la bitácora.
-- Cada consumidor aplica la suya: el circuito viejo mira `puntos_enviados`, el
-- nuevo mira `puntos_lote`. Así los dos pueden correr sobre el mismo día y sus
-- resultados se pueden restar — que es la única prueba de que el nuevo hace lo
-- mismo que el viejo.
--
-- plpgsql y no `LANGUAGE sql`: una función `sql` CON cláusula `SET` se planifica
-- UNA vez con los argumentos como Params y nunca ve un valor. Nace con el plan
-- genérico y no hay plan personalizado que pedir (medido en
-- `get_conteo_products_count`: 2,606 ms contra 56 ms).
CREATE OR REPLACE FUNCTION public.ventas_elegibles_puntos(
  p_desde date, p_hasta date, p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 100000
) RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode TO 'force_custom_plan'
AS $$
DECLARE v json;
BEGIN
  -- CUERPO: idéntico al de `ventas_para_puntos`, quitando el
  -- `LEFT JOIN public.puntos_enviados` y su condición, y agregando
  -- `si.customer_id` a la salida (el circuito nuevo liga por ficha, no por
  -- el nombre escrito en la factura — ver la regla del ERP en CLAUDE.md).
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM ( … ) t;
  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ventas_elegibles_puntos(date,date,numeric,integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ventas_elegibles_puntos(date,date,numeric,integer) TO authenticated, service_role;
```

> El cuerpo se copia **tal cual** de `pg_proc.prosrc` en el momento de aplicar,
> no de una transcripción a mano en este documento. Esa función tiene tres
> correcciones medidas encima (el piso de 2%, el `pkey` de presentación, el
> filtro del código de vendedor) y copiarla de memoria es cómo se pierden.

---

## 3. Las cuatro operaciones

Todas `SECURITY DEFINER` con `SET search_path`, todas en **una transacción**: el
lote, la salida, el enlace y el saldo se mueven juntos o no se mueve nada.

| función | qué hace |
|---|---|
| `puntos_acumular(desde, hasta, margen, tope)` | lee `ventas_elegibles_puntos`, descarta lo que ya tiene lote, inserta un lote por venta con `vence_el = ganado_el + 12 meses` |
| `puntos_registrar_canje(invoice_id)` | **detecta** el canje en una venta del ERP (§5) y lo descuenta FIFO. No autoriza nada: registra lo que ya pasó en el mostrador |
| `puntos_anular_venta(invoice_id)` | los tres caminos ya decididos: `retirado` / `devuelto` / `sin_enviar` |
| `puntos_vencer(al_dia, simular)` | barre `vence_el <= al_dia AND restantes > 0` y escribe una salida `vencimiento` |
| `puntos_cuadrar(customer_id)` | recalcula el saldo desde el libro y devuelve la diferencia |

Cuatro cosas que el modelo hereda de errores ya medidos:

1. **El canje resta hasta cero y nunca deja debiendo.** Si el cliente ya gastó
   esos puntos, se resta lo que hay y se anota lo no recuperado. La cuenta nunca
   queda negativa — el `CHECK (saldo >= 0)` lo hace imposible, no improbable.
2. **La anulación sólo resta con vínculo inequívoco.** Exige encontrar
   *exactamente un* lote para esa venta. De 26 casos históricos, dos no cierran;
   ésos se avisan y no se tocan.
3. **El mínimo de canje se lee de la configuración, no de una constante.**
   Queda en **100** por decisión del usuario (2026-09-01), y el reglamento y el
   afiche ya lo dicen. Igual va como parámetro en la base y no dentro de una
   función: el dato medido señala que **el cuello de botella es el mínimo, no el
   reloj** —3 de cada 4 clientes activos no llegan a 100 en seis meses, y alargar
   el plazo casi no lo mejora—, así que ese número se va a mover algún día y
   moverlo tiene que ser una fila, no una migración.
4. **`puntos_cuadrar` existe desde el día uno.** Un saldo mantenido que nadie
   compara contra su libro deja de ser cierto sin avisar — es
   `feedback_una_afirmacion_que_nadie_verifica_deja_de_ser_cierta` aplicado a un
   número que es dinero.

---

## 4. La migración de los saldos, que se simplificó sola

**14,632 cuentas y 1.7M de puntos**, deuda viva **$17,295**.

El problema conocido era que los puntos actuales **no tienen fecha individual**,
sólo un saldo por cuenta — y el modelo nuevo necesita lotes fechados.

**El reglamento ya lo resolvió.** El régimen de transición dice que todo lo
acumulado hasta el 30 de septiembre de 2026 vence el **1 de octubre de 2027**.
Entonces la migración es **un lote por cuenta**, `origen='migracion'`,
`ganado_el = 2026-10-01`, `vence_el = 2027-10-01`, y no hay que averiguar el
origen de un solo punto.

> Lo que se escribió para ser justo con el cliente —darle un año completo a lo
> que ya tenía— resultó ser también lo que vuelve trivial la migración. No fue
> planeado así.

Falta un puente de una sola vez: un volcado de `Clientes` (cuenta y saldo) desde
MySQL a una función `puntos_migrar(p_filas json)`. **Se liga por el número del
ERP, nunca por el nombre** — el nombre sale de cómo se escribió la factura, y
medido sobre 68 duplicados reales, normalizar acentos evita 0 de ellos.

Lo que **no** se migra, y hay que decirlo antes de que alguien lo note después:

- Las **50,025 facturas de $1 o menos** que la hoja de cálculo metió al registro.
  La regla del «más de $1» es nueva y sólo aplica hacia adelante.
- Las **27 cuentas con el mismo ticket cobrado dos veces**. **Decidido el
  2026-09-01: se migra el saldo tal como está.** Corregirlo sería quitarle puntos
  a 27 personas sin avisarles, y hacia adelante no puede repetirse porque la
  tabla nueva lo rechaza.
- Las **26 ventas anuladas con los puntos ya entregados** ($1,110), por decisión
  del usuario («restemos de ahora en adelante»).

---

## 5. El canje se DETECTA, no se construye

**Corregido por el usuario el 2026-09-01, y borra el bloqueante que tenía este
plan.** No hay que construir un canje en el portal ni pedirle a nadie que
programe nada:

> «los puntos se canjean en el ERP, el portal ya detecta ventas con puntos, al
> detectar una los descontará de los puntos del cliente. si el cliente no tenía
> puntos manda un aviso a la sucursal y a supervisor.»

O sea que el portal **no autoriza** el canje: lo **registra**. El mostrador sigue
funcionando igual el día que MySQL se apague, porque el mostrador nunca dependió
del portal para esto.

La detección ya está resuelta y medida (ver §5.b del documento del circuito):

```
descuento = (suma de los renglones − total) − retención
puntos    = descuento × 100
```

con `sales_invoices.has_puntos` de compuerta. Los dos conjuntos son disjuntos, así
que **la marca no tiene falsos negativos**: todo canje real está marcado. Y los
17 casos con hueco pero sin marca están explicados —son retención del ISSS por el
Art. 162, no descuento—, que es justo por qué la fórmula resta `retencion`.

### Las dos guardas, y por qué son dos

1. **`customers.acumula_puntos` cruza SIEMPRE.** Una ficha que no acumula no
   canjea, no alerta y no se registra. **Verificado el 2026-09-01: MAPFRE es la
   ÚNICA ficha marcada así** en las 28,110 — 73 ventas, 69 con la marca. Por
   convenio se le aplica el descuento y se registra igual que un canje, pero no
   tiene puntos asignados. Sin esta guarda, una detección ingenua habría
   disparado **60 alertas al año de «se dieron puntos que no tenía»** sobre la
   única ficha donde eso es normal — la forma más rápida de que una sala aprenda
   a ignorar la alerta.
2. **Si el cliente no tenía puntos, se avisa a la sala y al supervisor.** No se
   deja pasar en silencio y **no se deja la cuenta debiendo**: se resta lo que
   hay y se anota lo no recuperado. El `CHECK (saldo >= 0)` lo vuelve imposible,
   no improbable.

---

## 6. Las cuatro decisiones, tomadas

| | decisión | consecuencia |
|---|---|---|
| **El canje** | Se detecta desde la venta del ERP; el portal descuenta y avisa | **No hay paso bloqueante.** Se puede apagar MySQL en cuanto los saldos estén migrados |
| **El corte** | Limpio, sin período en paralelo | Se migra, se enciende y listo. La verificación se hace **antes** y sobre historia (§7) |
| **El mínimo** | Se queda en **100** | Cero trabajo extra, nada que reimprimir. El reglamento y el afiche ya lo dicen |
| **Doble crédito** | Las 27 cuentas se migran **como están** | Nadie pierde puntos. Hacia adelante no puede repetirse: la tabla lo rechaza |

El corte limpio fue una pregunta del usuario que resultó ser la correcta:

> «¿es necesario? ¿no es mejor al decirte iniciemos ya, migres los puntos
> asignados a cada uno, le pongas fecha de 1 de octubre, e inicies la
> automatización de acumulación, anulación y canje de puntos?»

Sí. El período en paralelo que este plan proponía servía para **comparar** los dos
motores, y esa comparación no necesita que los dos escriban: se puede hacer
**sobre la historia que ya está guardada**, de lectura, en minutos. Es lo de §7.

### El orden, entonces

```
1. Migración 1 (tablas)              ── sin riesgo, a cualquier hora
2. Migración 2 (la regla sola)       ── sin riesgo
3. Migración 3 (las funciones)       ── sin riesgo
4. Migrar los saldos · ganado_el = 2026-10-01 · vence_el = 2027-10-01
5. Encender acumulación, detección de canje y anulación
6. Apagar MySQL
```

---

## 7. La verificación que reemplaza al paralelo — ya corrida

Se corrió el motor nuevo (la regla sin la exclusión de la bitácora) sobre la
semana del **1 al 7 de julio de 2026**, ya cerrada, y se comparó contra lo que el
circuito viejo realmente mandó. **Todo de lectura: no escribió una fila.**

| | facturas | puntos |
|---|---:|---:|
| motor nuevo | 4,009 | 47,449 |
| circuito viejo | 5,265 | 54,343 |
| **coinciden** | **4,009** | |
| sólo el nuevo | **0** | |
| sólo el viejo | 1,256 | |

**Cero falsos positivos: el motor nuevo no acredita ni una factura que el viejo
no hubiera acreditado.** Y es un subconjunto estricto — las 1,256 de diferencia
son facturas que el viejo mandó y la regla de hoy rechaza. Desglosadas una por
una:

| por qué se rechaza | facturas | |
|---|---:|---|
| de **US$1.00 o menos** | 709 | la regla del «más de $1» es del portal; allá no existe |
| un renglón **bajo el precio 3** | 318 | descuento real: no debía acumular |
| **ningún producto** que acumule | 209 | ni farmacia ni cuidado personal |
| **anulada** o no finalizada | 14 | incluye las «DTE INVALIDADO EN MH», que allá acumularon |
| un renglón fuera del catálogo **de hoy** | 6 | el único caso dudoso — **0.1%** |
| código de vendedor que no cabe | 0 | |
| ficha que no acumula | 0 | |
| sin venta en el portal | 0 | |

**1,250 de 1,256 son rechazos correctos.** No es que el motor nuevo pierda
trabajo: es que el viejo acreditaba cosas que no debía, y eso ya se sabía —
*«MariaDB no tiene validaciones, es rústico, por eso lo estamos mejorando con el
portal»*.

Los **6** del catálogo son el único punto a mirar: un renglón cuyo producto hoy
no coincide con ninguna fila activa de `product_precios` por `product_id` +
presentación. Sobre 5,265 facturas es ruido, pero conviene abrirlos antes de
migrar y saber si es un producto retirado o una presentación que cambió de
nombre.

> **Esta comparación se vuelve a correr sobre el mes anterior al corte**, no sólo
> sobre julio. Una regla que anda en una semana de julio y nadie volvió a mirar
> es una afirmación sin verificar.

## 8. Lo que hay que hacer igual, aunque esto no arranque

Mientras los puntos vivan en MySQL, siguen valiendo:

- **Un respaldo diario de `Clientes`, `Ventas` y `Canjes` hacia Postgres.** Hoy
  el portal **no tiene ninguna copia de los saldos**: las únicas tablas de puntos
  en Postgres son la bitácora del puente y el freno de la consulta. Si esa base
  se pierde —no se cae, se pierde— los saldos no se pueden reconstruir. Es lo
  único de esta lista que protege contra el escenario que no se deshace.
- **Que `/mis-puntos` diga la verdad sin conexión.** Alguien que escanee el QR
  del afiche y vea un error genérico va a entender «perdí mis puntos».
- **Una alarma cuando el sync falle varias veces seguidas.** Hoy no hay ninguna
  en vivo, y la ventana de reintento de `sync-puntos` es de **7 días**: una caída
  más larga deja de arreglarse sola y nadie se entera.

---

## 9. El bloque de pruebas, para volver a correrlo

Se corre en el **branch de pruebas** con `execute_sql`. Fabrica sus propios
clientes y ventas —pruebas no los trae— y el `RAISE` del final deshace todo,
fixtures incluidos: no deja una fila.

Un caso nuevo se agrega acá **antes** de agregar el candado, no después. Un
`CHECK` que nadie intentó violar es una afirmación sin verificar.

```sql
DO $$
DECLARE
  b bigint; c bigint; i bigint; i2 bigint; l bigint; s bigint;
  r text := ''; ok boolean;
BEGIN
  SELECT id INTO b FROM public.branches ORDER BY id LIMIT 1;
  INSERT INTO public.customers (name) VALUES ('CLIENTE DE PRUEBA') RETURNING id INTO c;
  INSERT INTO public.sales_invoices (branch_id, erp_invoice_id, fecha, hora, total, estado)
    VALUES (b,'PRUEBA-1',current_date,'10:00',15.40,'FINALIZADA') RETURNING id INTO i;
  INSERT INTO public.sales_invoices (branch_id, erp_invoice_id, fecha, hora, total, estado)
    VALUES (b,'PRUEBA-2',current_date,'10:01',20.00,'FINALIZADA') RETURNING id INTO i2;

  INSERT INTO public.puntos_lote (customer_id, origen, invoice_id, puntos, restantes, ganado_el, vence_el)
  VALUES (c,'venta',i,15,15,current_date,current_date + interval '12 months') RETURNING id INTO l;
  r := r || E'\n 1 · lote de venta ........................ ENTRA';

  BEGIN
    INSERT INTO public.puntos_lote (customer_id, origen, invoice_id, puntos, restantes, ganado_el, vence_el)
    VALUES (c,'venta',i,15,15,current_date,current_date + interval '12 months');
    r := r || E'\n 2 · doble credito del mismo ticket ....... LO ACEPTO ✗ MAL';
  EXCEPTION WHEN unique_violation THEN r := r || E'\n 2 · doble credito del mismo ticket ....... RECHAZADO ✓'; END;

  BEGIN
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el)
    VALUES (c,'venta',5,5,current_date,current_date + interval '12 months');
    r := r || E'\n 3 · lote de venta SIN venta .............. LO ACEPTO ✗ MAL';
  EXCEPTION WHEN check_violation THEN r := r || E'\n 3 · lote de venta SIN venta .............. RECHAZADO ✓'; END;

  BEGIN
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el)
    VALUES (c,'ajuste',50,50,current_date,current_date + interval '12 months');
    r := r || E'\n 4 · ajuste sin motivo .................... LO ACEPTO ✗ MAL';
  EXCEPTION WHEN check_violation THEN r := r || E'\n 4 · ajuste sin motivo .................... RECHAZADO ✓'; END;

  BEGIN
    INSERT INTO public.puntos_lote (customer_id, origen, invoice_id, puntos, restantes, ganado_el, vence_el)
    VALUES (c,'venta',i2,10,11,current_date,current_date + interval '12 months');
    r := r || E'\n 5 · restantes mayores que el lote ........ LO ACEPTO ✗ MAL';
  EXCEPTION WHEN check_violation THEN r := r || E'\n 5 · restantes mayores que el lote ........ RECHAZADO ✓'; END;

  BEGIN
    INSERT INTO public.puntos_lote (customer_id, origen, invoice_id, puntos, restantes, ganado_el, vence_el)
    VALUES (c,'venta',i2,10,10,current_date,current_date - interval '1 day');
    r := r || E'\n 6 · vence antes de ganarse ............... LO ACEPTO ✗ MAL';
  EXCEPTION WHEN check_violation THEN r := r || E'\n 6 · vence antes de ganarse ............... RECHAZADO ✓'; END;

  INSERT INTO public.puntos_cuenta (customer_id, saldo, ganados, usados) VALUES (c,15,15,0);
  BEGIN
    UPDATE public.puntos_cuenta SET saldo = -1 WHERE customer_id = c;
    r := r || E'\n 7 · saldo negativo ....................... LO ACEPTO ✗ MAL';
  EXCEPTION WHEN check_violation THEN r := r || E'\n 7 · saldo negativo ....................... RECHAZADO ✓'; END;

  BEGIN
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos) VALUES (c,'anulacion',5);
    r := r || E'\n 8 · anulacion sin nombrar su venta ....... LO ACEPTO ✗ MAL';
  EXCEPTION WHEN check_violation THEN r := r || E'\n 8 · anulacion sin nombrar su venta ....... RECHAZADO ✓'; END;

  INSERT INTO public.puntos_salida (customer_id, tipo, puntos, monto, invoice_id, motivo)
  VALUES (c,'canje',10,0.10,i,'prueba') RETURNING id INTO s;
  INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos) VALUES (s,l,10);
  UPDATE public.puntos_lote   SET restantes = restantes - 10 WHERE id = l;
  UPDATE public.puntos_cuenta SET saldo = saldo - 10, usados = usados + 10 WHERE customer_id = c;
  SELECT saldo = 5 INTO ok FROM public.puntos_cuenta WHERE customer_id = c;
  r := r || E'\n 9 · canje FIFO deja saldo 5 .............. ' || CASE WHEN ok THEN 'SI ✓' ELSE 'NO ✗ MAL' END;

  BEGIN
    DELETE FROM public.puntos_lote WHERE id = l;
    r := r || E'\n10 · borrar un lote ya consumido .......... LO ACEPTO ✗ MAL';
  EXCEPTION WHEN foreign_key_violation THEN r := r || E'\n10 · borrar un lote ya consumido .......... RECHAZADO ✓'; END;

  RAISE EXCEPTION E'%', r;
END $$;
```

> `customers.id` es `GENERATED ALWAYS`: no se le puede dar un id a mano sin
> `OVERRIDING SYSTEM VALUE`. Por eso el bloque deja que la tabla lo genere.

---

## 10. Cuando se confirme, el orden exacto de la sesión

1. `npm run gate:migrations -- --remote` para ver que el repo y prod estén parejos
   **antes** de agregar nada.
2. Copiar el cuerpo de `ventas_para_puntos` desde `pg_proc.prosrc` — **no** desde
   este documento.
3. Correr el §8 en el branch de pruebas. Si un caso sale «LO ACEPTO», parar.
4. `apply_migration` de las tres migraciones a producción, una por una.
5. **Guardar el archivo local de cada una con la versión de 14 dígitos que
   devolvió el servidor**, en el mismo commit. `apply_migration` nunca toca el
   disco y olvidarlo no da ningún error.
6. Agregar las cuatro tablas y las funciones a `auditoria/areas.mjs` — sin eso
   `gate:auditoria` falla y bloquea el commit de todo el mundo.
7. Declarar el cron nuevo en el manifiesto `CRONS` de `gate:eficiencia`, con su
   costo por corrida y el motivo escrito.
8. `npm run gate:perf`, `npm run gate:eficiencia`, `npm run gate:data`.
