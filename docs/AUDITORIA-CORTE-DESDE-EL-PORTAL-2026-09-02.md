# ¿Ya funciona el corte de caja desde el portal? — auditoría del 2026-09-02

Pregunta del usuario: *«ahora sí funcionarían los cortes de caja desde el
portal? ya tenemos todo el flujo aquí»*.

**Respuesta corta: se puede usar, con dos advertencias.** El corte C funciona y
el portal muestra e imprime la cifra correcta. Lo que queda mal es el número que
el sistema de la caja guarda — **y eso ya pasaba antes del portal**, en el 21.5%
de los cortes (§2). Lo que sí conviene no hacer todavía es **cerrar el día desde
el portal**: ese camino nunca corrió y escribe una casilla que puede declarar de
menos el Z, que no se deshace (§3).

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

## 2. 🟠 La diferencia que se escribe está mal — pero el defecto NO es del portal

### Lo que decía esta sección, y por qué estaba mal

La primera versión de esta auditoría llamó a esto «bloqueante» y dijo que el
portal *«ya sabe que ese número miente y sigue escribiendo el equivocado»*.
Medir cambió el diagnóstico. Se deja escrito porque la conclusión anterior era
razonable con lo que se sabía, y porque el error de lectura es el hallazgo.

### Qué es `total_corte`, leído del propio origen

`hacer-corte-caja` manda `diferencia = contado − total_corte`. La pregunta era
qué es ese campo. La respuesta está en el JavaScript del origen
(`js/funciones/funciones_corte_caja.js`, leído el 2-sep):

```js
total_corte = total_tike + total_factura + total_credito
            + monto_apertura + total_entrada − total_salida
diferencia  = total_efectivo − total_corte
```

O sea que el esperado del origen **no suma los cobros de crédito** y **sí suma
las ventas que no fueron en efectivo**. Por eso se aparta de su propio tiquete
—cuya cuenta es `ingresos + venta − vales + cobros`— en el 23% de los cortes.

**Y ésa es exactamente la cuenta que hace la pantalla de la caja.** El portal no
inventa nada: reproduce, campo por campo, lo que haría el dependiente.

### La medición que lo demuestra

| cortes con tiquete **anteriores** al primer corte hecho desde el portal | **428** |
|---|--:|
| de ésos, cuántos ya discrepaban de su propio tiquete | **92 (21.5%)** |
| la peor separación, sin que el portal existiera | **$970.40** |

**El defecto es del sistema de la caja y afecta a todos los cortes de la
empresa**, se hagan donde se hagan. Los $411.55 de Salud 3 no fueron un daño que
el portal causó: fueron el mismo defecto, esta vez visible porque el portal
además leyó el tiquete y mostró la cifra buena al lado.

### Dónde queda el portal, entonces

| | qué cifra lleva |
|---|---|
| la pantalla del portal | **la buena** (`diferenciaDelCorte`, del tiquete) |
| el papel que imprime el portal | **la buena** |
| el registro del sistema de la caja | la del origen |
| el tiquete que imprime el origen | la del origen |

Las dos últimas son las que quedan mal — igual que si el corte se hubiera hecho
en la caja.

### Los caminos, y el que queda

1. ~~Leer las piezas del formulario~~ — **descartado, medido.** Los campos
   existen pero llegan vacíos: los llena el JavaScript después de cargar. Con
   número vienen sólo `total_entrada`, `total_corte`, `t_factuta` y
   `total_factura`.
2. ~~Un X antes del C~~ — **descartado por el usuario**: *«el X nunca se hace,
   sólo C y Z»*.
3. ~~`process=total_sistema`~~ — el JavaScript tiene una llamada que traería el
   esperado bueno, y **está muerta**: el campo `#total_sistema` no existe en el
   formulario de hoy y el endpoint contesta **vacío** (probado en las seis salas
   el 2-sep).
4. **Que el portal calcule el esperado él mismo.** ← el único que queda.

   Tiene todas las piezas sin emitir ningún documento:

   | pieza | de dónde |
   |---|---|
   | ventas **en efectivo** | `sales_invoices.tipo_pago` (ya se usa en `fetchVentasPorPago`) |
   | ingresos y vales | el listado de movimientos del origen, que la función ya consulta |
   | cobros de crédito | ese mismo listado (`POR ABONO A CREDITO`) |
   | saldo inicial | `cortes_caja_aperturas.monto_apertura` |

   ⚠️ **Es una decisión, no un arreglo obvio**, y por eso no se hizo: rompe la
   regla fundacional del módulo —*«el esperado lo sigue calculando la caja, no
   nosotros»*— y significa que el portal deja de reproducir al origen y empieza
   a **corregirlo** en el registro del origen. El riesgo es la venta: `tk_venta`
   es la foto del momento del corte y la sincronización de facturas tiene
   retraso, así que un corte hecho al minuto podría calcular con ventas que
   todavía no llegaron.

   **Lo decide el usuario.** Mientras tanto, el portal no está peor que la
   pantalla de la caja, y en lo que se ve —su pantalla y su papel— está mejor.

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

1. **Decidir qué hacer con la diferencia que se escribe** (§2). No es un
   arreglo pendiente sino una decisión: los tres caminos que usaban números del
   origen están descartados con medición, y el que queda —que el portal calcule
   el esperado él mismo— hace que el portal deje de reproducir al origen y
   empiece a corregirlo. **Y el defecto no lo causó el portal**: ya estaba en el
   21.5% de los 428 cortes anteriores.
2. ~~Medir el cobro que no es efectivo~~ — **hecho** (§4): el origen ya lo deja
   fuera, no hay que descontar nada, y el aviso que decía lo contrario se
   corrigió.
3. **Probar el Z una vez**, con la casilla de tarjeta resuelta (§3).
4. **Abrir una caja desde el portal**, aunque sea una vez: es el único tramo del
   circuito que no tiene ni una fila.
