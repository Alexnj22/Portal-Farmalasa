# ¿Ya funciona el corte de caja desde el portal? — auditoría del 2026-09-02

Pregunta del usuario: *«ahora sí funcionarían los cortes de caja desde el
portal? ya tenemos todo el flujo aquí»*.

**Respuesta corta: el corte C se puede usar.** El portal muestra e imprime la
cifra correcta, y las bolsas no dependen de ella. El número que guarda el sistema
de la caja queda con el defecto del origen **por decisión del usuario** (§2) — ya
era así antes del portal, en el 21.5% de los cortes.

**Cerrar el día desde el portal** ya no escribe casillas que el dependiente no
escribe, y si el Z no sale del tipo pedido **no cierra el turno** (§3). Sigue sin
haber corrido nunca: el primero será en vivo, pero ahora falla a la vista y
dejando el día abierto.

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

## 2. ✅ CERRADO POR DECISIÓN — la diferencia del origen se deja como está

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

   ⚠️ **Evaluado y DESCARTADO por el usuario (2026-09-02):**

   > «el error del ERP dejalo como está, es conocido que da el resultado
   > incorrectamente de diferencias, por eso en el portal lo dejamos bien»

   **No reproponerlo.** El defecto del origen es conocido en la empresa, y el
   sitio donde el número tiene que estar bien es el portal — que ya lo está.

### Entonces, ¿qué queda bien y qué no?

| | cifra |
|---|---|
| **las bolsas** | **buena** — `bolsa_sugerida` resta de `total_declarado`, el efectivo CONTADO. Este defecto no las toca |
| la pantalla del portal | **buena** (`diferenciaDelCorte`, del tiquete) |
| el papel que imprime el portal | **buena** |
| el registro del sistema de la caja | la del origen — **a propósito** |
| el tiquete que imprime el origen | la del origen — **a propósito** |

## 3. ✅ CORREGIDO — el Z se manda como viene, y el tipo que sale se comprueba

Decisión del usuario (2026-09-02): *«todo el proceso se debe hacer desde el
portal, enviando los datos al ERP y recibiendo el resultado claro»*.

### Lo que estaba mal

El portal le escribía tres casillas al Z que el dependiente **no escribe**:

```ts
campos.set("total_tarjeta", "0");   // fuera del if (!esZ)
campos.set("monto_ch", "0");        // fuera del if (!esZ)
campos.set("diferencia", "0");
```

Para un corte C poner tarjeta y cheque en cero **es el control** — no pasan por
la caja y son las dos casillas por las que se tapa un faltante. Para el Z no:
**el cierre del día cuenta lo VENDIDO, con la tarjeta y el crédito adentro**.

Y no era lo que hace la pantalla de la caja. Leído en su JavaScript, su
`corte1()` **serializa el formulario entero y lo manda tal cual** — nadie toca
esas casillas al cerrar el día. El portal inventaba tres valores.

### Lo que hace ahora

**El Z se manda como vino**, cambiando sólo `tipo_corte` — que es lo único que
«reenviar el formulario tal cual» no puede acertar, porque su default es **X**.
El efectivo tampoco se toca: el formulario del Z lo trae calculado y de sólo
lectura. Reproducir, no mejorar: **un Z no se deshace**.

### Y el resultado se comprueba, que es la otra mitad del pedido

«Pedí un Z» y «salió un Z» no son la misma afirmación. El 31-ago el primer corte
hecho desde el portal salió una **LECTURA X**, el sistema contestó `success`, y
nadie se enteró hasta que alguien lo repitió.

Ahora la función **lee el comprobante y compara el tipo**. Si no coincide —o no
se pudo leer— contesta con aviso, y:

- **en un corte C**, el aviso sale en rojo en el panel del resultado;
- **en el cierre del día, NO se cierra el turno.** El día queda abierto, que es
  lo reparable: el Z se puede reintentar y el cierre todavía no ocurrió. Cerrando
  igual, el día quedaría cerrado y sin su Z — que es exactamente lo que pasó el
  1-sep y hubo que arreglar a mano.

⚠️ **Sigue sin correr en producción.** Esto lo deja fiel y observable, no
probado: el primer cierre real desde el portal va a ser el primero. La diferencia
es que ahora, si sale mal, se ve y el día no queda cerrado.

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

1. ~~Decidir qué hacer con la diferencia que se escribe~~ — **decidido (§2)**:
   se deja como está. El defecto es del origen, es conocido, y el portal es
   donde el número queda bien.
2. ~~Medir el cobro que no es efectivo~~ — **hecho** (§4): el origen ya lo deja
   fuera, no hay que descontar nada, y el aviso que decía lo contrario se
   corrigió.
3. ~~Probar el Z con la casilla de tarjeta resuelta~~ — **la casilla está
   resuelta (§3)**; queda hacer el primer cierre real, que ahora falla a la
   vista y sin cerrar el día.
4. **Abrir una caja desde el portal**, aunque sea una vez: es el único tramo del
   circuito que no tiene ni una fila.
