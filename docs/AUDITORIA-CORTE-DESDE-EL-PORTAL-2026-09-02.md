# ¿Ya funciona el corte de caja desde el portal? — auditoría del 2026-09-02

Pregunta del usuario: *«ahora sí funcionarían los cortes de caja desde el
portal? ya tenemos todo el flujo aquí»*.

**Respuesta corta: el flujo está completo, pero NO está listo para reemplazar a
la pantalla de la caja.** Falta una pieza que sí es bloqueante —el número que el
portal ESCRIBE en el sistema de la caja— y hay tres tramos del circuito que
nunca corrieron una sola vez en producción.

---

## 1. Qué corrió de verdad, medido

No es una impresión: son las filas que dejó cada acto.

| pieza | tabla que lo prueba | filas | veredicto |
|---|---|--:|---|
| abrir la caja | `caja_aperturas_del_portal` | **0** | **nunca corrió** |
| anotar entrada / salida | `caja_movimientos_portal` | **3** | dos son de $1.00 |
| vale de las salidas al cortar | `caja_vales_portal` | **1** | Salud 3, 1-sep, $119.38 ✓ |
| abono a crédito | `creditos_abonos_portal` | **3** | Salud 4, 2-sep ✓ |
| corte C | `cortes_caja` | varios | corre, con el defecto de §2 |
| **corte Z** | — | **0** | **nunca corrió** (§3) |
| cerrar el día | — | 1 | y el Z hubo que hacerlo a mano |

Que una pieza esté escrita y compile no dice nada sobre si funciona: el corte Z
salió a producción el 1-sep a las 21:44 y desde entonces **ninguna sala ha
cerrado el día desde el portal**, así que su primera corrida va a ser en vivo,
sobre un acto que no se deshace.

---

## 2. 🔴 BLOQUEANTE — el portal escribe una diferencia que sabe que está mal

### El defecto

`hacer-corte-caja` arma lo que le manda al sistema de la caja así:

```ts
const esperado   = Number(campos.get("total_corte"));   // el número del formulario
const diferencia = esZ ? 0 : Number(efectivo) - esperado;
campos.set("diferencia", dosDecimales(diferencia));
```

Y el propio archivo, sesenta líneas más arriba, dice por qué eso no sirve:

> `total_corte` del formulario **NO es el efectivo esperado** […] El sistema
> imprime la diferencia que se le manda, **sin recalcularla**, así que un
> esperado equivocado se vuelve una afirmación falsa sobre dinero en el papel.

O sea: **el portal ya sabe que ese número miente, corrigió lo que MUESTRA, y
sigue escribiendo el equivocado.**

### El tamaño, medido sobre los 486 cortes con tiquete

| | |
|---|--:|
| cortes cuyo `diferencia_erp` **no** coincide con la cuenta del tiquete | **112 (23%)** |
| la peor separación | **$970.40** |

Dos casos concretos, los dos hechos desde el portal:

| corte | el sistema guardó | la verdad del tiquete |
|---|--:|--:|
| 14319 · Salud 3 · 31-ago 12:43 | **−$411.55** | −$9.75 |
| 14378 · Salud 3 · 1-sep 21:03 | **+$66.01** | −$0.09 |

### Por qué importa aunque el portal muestre lo correcto

`conLaCuentaBuena` (MiCajaView) y `diferenciaDelCorte` corrigen la cifra para la
pantalla **y para el papel que imprime el portal**. Eso está bien y funciona.

Lo que queda mal es todo lo demás:

- el registro del sistema de la caja, que es el que ve contabilidad y cualquiera
  fuera del portal;
- **el tiquete que sale de la impresora del origen**, que lleva su `TOTAL CAJA`
  correcto y, tres renglones abajo, una `DIFERENCIA` que lo contradice;
- el mes cerrado con esas cifras.

### Por qué no tiene una corrección aritmética obvia

Lo primero que uno intenta es `esperado_real = total_corte + cobros_de_credito`.
**No alcanza**, y está medido: en el corte 14378 la corrección es exacta
(`1080.36 + 66.10 = 1146.46`, el `TOTAL CAJA` al centavo), pero en el 14319 el
propio `total_corte` venía **+5× los cobros** (`893.50` contra los `391.25` que
había leído el X de las 12:41). El número del origen se desvía por un **múltiplo
entero impredecible** de los cobros de crédito — el mismo defecto que este módulo
lleva persiguiendo desde el 13-ago.

### Los tres caminos posibles

1. ~~**Leer las piezas del formulario, no su total.**~~ **DESCARTADO, y está
   medido** (2-sep, Salud 4, apertura 2893, vía `simular` — que no escribe nada).

   Los campos **existen**: de los 50 del formulario están `total_entrada`,
   `total_salida`, `total_cobros`, `retencion` y `monto_apertura`. Pero en el
   HTML **llegan vacíos**: los llena el JavaScript de la pantalla del origen
   después de cargar. Con número vienen sólo cuatro:

   ```
   total_entrada · total_corte · t_factuta · total_factura
   ```

   O sea que la cuenta `ingresos + venta − vales + cobros` **no se puede armar
   leyendo el formulario**.

   ⚠️ Y el primer detector que escribí para esto **se creyó el cero**: comparó
   `total_cobros` contra los abonos del portal y dictaminó «por debajo del
   efectivo», sobre un campo que no traía dato. Es
   [[feedback_un_gate_que_no_pudo_medir_no_puede_dar_verde]] otra vez — un campo
   vacío no es un cero medido. Se quitó.
2. **Un X antes del C.** ← **el que queda.** La lectura X imprime las mismas
   líneas del tiquete y **no cuenta dinero**; se lee su tiquete —que la función
   ya sabe leer, `leerTiquete`—, se calcula el esperado con la cuenta que cierra
   en el 100% de los 486, y recién ahí sale el C con la diferencia buena. Cuesta
   un documento de más por corte, y un X suelto ya confundió una vez (31-ago),
   pero desde v2.886.0 el X se captura y se muestra como lo que es.
3. **Corregir después.** Requiere un endpoint para editar un corte ya hecho. No
   se encontró ninguno.
4. **Los movimientos del origen.** `admin_movimiento_caja_dt.php` —que la
   función ya consulta para el freno del vale— lista los `POR ABONO A CREDITO`
   del día, y su suma coincide al centavo con la línea del tiquete en 47 de 48
   sala-días. Da los **cobros**, que es la pieza que más se desvía; faltarían
   venta e ingresos.

⚠️ **Mientras esto no se resuelva, un corte hecho desde el portal deja escrito en
el sistema de la caja un faltante que puede ser de cientos de dólares y que no
existe.** Es la razón por la que la respuesta a la pregunta es «todavía no».

---

## 3. 🟠 El corte Z nunca salió del portal, y zapatea dos casillas

`cerrarElDia` (v2.932.1) hace lo correcto en el orden correcto: primero el Z por
el formulario del corte con `tipo_corte = Z`, después `cerrar_turno`. **Y nunca
se ejecutó**: el único Z del 1-sep se hizo a mano, antes de que ese arreglo
existiera.

Además, en `hacer-corte-caja` estas dos líneas quedan **fuera** del `if (!esZ)`:

```ts
campos.set("total_tarjeta", "0");
campos.set("monto_ch", "0");
```

Para un corte C poner tarjeta y cheque en cero **es el control** — no pasan por
la caja y son las dos casillas por las que se tapa un faltante. Para el Z es otra
cosa: el cierre del día **es todo lo vendido, con la tarjeta y el crédito
adentro** (es exactamente lo que dice `desgloseDelCierre`, y lo que corrigió la
pantalla el 13-ago cuando decía que se contaron $1,678.83 habiendo $1,602.88 en
la caja). Un Z emitido con la tarjeta en cero declararía de menos el cierre del
día, **y un Z no se deshace.**

No está comprobado que el formulario del Z use esos campos —su efectivo viene
calculado y de sólo lectura, así que puede ignorarlos—. Pero es una casilla que
el portal escribe a propósito sobre un documento que no se puede corregir, y hoy
no hay ninguna medición que diga qué pasa.

**Antes del primer cierre real desde el portal, esto se verifica.**

---

## 4. ✅ CERRADO — el origen ya distingue el cobro que no es efectivo

Regla del usuario (2-sep): *«sólo entra en efectivo, los otros no, es como pago
con tarjeta»*.

**El sistema de la caja ya la cumple.** Medido cruzando los tres cobros que
Salud 4 hizo hoy desde el portal contra el listado de movimientos del origen:

| cobro del portal | forma | ¿aparece como movimiento de caja? |
|---|---|---|
| $11.30 | Transferencia | **no** |
| $8.55 | Efectivo | **sí** |
| $10.00 | Transferencia | **no** |

`efectivo: entran_todos_1_de_1 · no_efectivo: no_entra_ninguno_de_2`

Y esos movimientos son exactamente de donde sale la línea `COBROS CREDITO`: su
suma coincide al centavo con ella en **47 de 48 sala-días**. Entonces sólo el
efectivo llega al efectivo esperado, y **no hay nada que descontar**.

⚠️ **Descontarlo habría inventado un sobrante de $21.30.** El aviso que salió
ayer en v2.941.0 —«si el comprobante los cuenta, ahí está el faltante»— era una
hipótesis razonable y quedó desmentida por la medición del día siguiente.
Corregido en v2.945.0: `cobrosDeCredito` ahora compara contra **`enCaja`** (sólo
el efectivo) y no contra el total, y la pista que culpaba a la transferencia se
quitó, con el porqué escrito en su lugar para que nadie la vuelva a proponer.

Comparar contra el total, además, habría **denunciado una brecha falsa en cada
corte donde alguien pagó por transferencia**.

## 5. 🟡 Quién puede cortar la caja de quién

`caja_vales.can_edit` con alcance **ALL** lo tienen hoy: Administrador,
**Jefe/a de Talento Humano**, QA y Supervisor/a de Ventas. Alcance ALL significa
poder hacer el corte de **cualquiera de las siete salas**, y un corte no se
deshace.

Para Supervisor/a de Ventas tiene sentido. **Para Talento Humano, revisar si lo
necesita**: es un permiso que no se pidió, se heredó.

---

## 6. 🟡 Comentarios que ya no dicen la verdad

Tres, y todos en el lugar donde alguien va a buscar la explicación:

1. `operar-caja` líneas 50-53: *«el Z sale de cerrar el turno, no del formulario
   del corte»*. **Se desmintió el 1-sep** y el propio archivo lo corrige 770
   líneas más abajo. El de arriba es el que se lee primero.
2. `hacer-corte-caja`, dos veces: dice que `diferenciaDelCorte` *«conoce el caso
   en que la buena es la del FORMULARIO»*. Esa excepción **se eliminó** en
   v2.931.1 — hoy el tiquete siempre gana, y está medido sobre 485 cortes.
3. `notaDeCifra` conserva una rama `fuente === 'guardada'` que ya no se puede
   alcanzar: sin `contraste` no hay disputa, y con disputa la fuente es siempre
   el tiquete.

No rompen nada hoy. Pero es la clase de rastro que hace que la próxima sesión
reconstruya una regla que ya no existe.

---

## 7. Lo que SÍ quedó bien, y conviene no tocar

- **El conteo a ciegas.** El esperado no viaja al navegador hasta después de
  teclear el efectivo. Es la única mejora real sobre la pantalla de la caja, y
  vale sólo mientras el corte se haga **exclusivamente** desde el portal.
- **Tarjeta y cheque en cero en el corte C.** Son las dos casillas por las que se
  tapa un faltante.
- **El vale de las salidas se escribe ANTES del corte**, con freno de duplicado
  contra el listado del origen, y sus dos escrituras posteriores lanzan en vez de
  tragarse el error.
- **El turno sale del campo escondido del formulario**, no del `1` fijo que dejó
  a Salud 3 sin poder abrir su tercer turno.
- **Cerrar el día exige un corte CONFIRMADO**, no sólo hecho.
- **El Z se comprueba y su fallo se dice** — el aviso gana sobre el mensaje de
  éxito.
- **La lectura X ya se captura** (`["C","Z","X"]`), así que un corte que salió del
  tipo equivocado deja de ser invisible.

---

## Qué falta para poder decir que sí

En orden, y el primero es el que bloquea:

1. **Arreglar la diferencia que se escribe** (§2). El camino del formulario
   quedó descartado con medición; el que queda es **el X antes del C**.
2. ~~Medir el cobro que no es efectivo~~ — **hecho** (§4): el origen ya lo deja
   fuera, no hay que descontar nada, y el aviso que decía lo contrario se
   corrigió.
3. **Probar el Z una vez**, con la casilla de tarjeta resuelta (§3).
4. **Abrir una caja desde el portal**, aunque sea una vez: es el único tramo del
   circuito que no tiene ni una fila.
