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

1. **Leer las piezas del formulario, no su total.** El formulario del corte trae
   50 campos. Si entre ellos vienen la venta, los ingresos, los vales y los
   cobros por separado, el portal arma `ingresos + venta − vales + cobros` —que
   es la cuenta que **cierra en los 486 tiquetes, 100%**— y manda la diferencia
   buena. **Es el camino preferible y sólo hay que averiguar si esos campos
   están.** Se averigua sin escribir nada: `simular: true` no toca la caja.
2. **Un X antes del C.** La lectura X imprime las mismas líneas y no cuenta
   dinero; se lee su tiquete, se calcula el esperado y recién ahí sale el C.
   Cuesta un documento de más por corte, y un X suelto ya confundió una vez.
3. **Corregir después.** Requiere un endpoint para editar un corte ya hecho. No
   se encontró ninguno.

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

## 4. 🟠 El cobro de crédito que no entra al cajón

Regla del usuario (2-sep): *«sólo entra en efectivo, los otros no, es como pago
con tarjeta»*.

La prueba de Salud 4 de hoy fueron **$29.85 en tres cobros**, de los cuales
**$21.30 son transferencias**. Si el sistema de la caja los suma dentro de
`COBROS CREDITO` —que es la línea que alimenta `TOTAL CAJA`, o sea el efectivo
esperado—, el corte va a pedir en el cajón $21.30 que nunca estuvieron ahí y va a
marcar un faltante exacto por ese monto.

**Está medido a medias.** Lo que sí se sabe: los movimientos de abono del sistema
de la caja suman **al centavo lo mismo que la línea `COBROS CREDITO`** en 47 de
48 sala-días (la excepción es Salud 3 del 31-ago, con $60.00 que entraron después
del último corte). Lo que falta: si esos movimientos incluyen los cobros que no
fueron en efectivo.

**Lo contesta el próximo corte de Salud 4.** Si `tk_cobros_credito` vuelve con
$29.85, los cuenta y hay que restar los $21.30 del esperado. Si vuelve con $8.55,
no los cuenta y no hay nada que hacer.

Desde v2.941.0 el portal ya separa y muestra ese monto (`cobrosDeCredito`
→ `noEfectivo`), y lo ofrece como primera pista ante un faltante. **Lo que
todavía no hace es descontarlo del esperado**, y no debe hacerlo antes de la
medición: si el origen ya los excluye, restarlos otra vez inventaría un sobrante.

---

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

1. **Arreglar la diferencia que se escribe** (§2). Empezar por averiguar si el
   formulario trae las piezas sueltas — se puede con `simular`, sin escribir.
2. **Medir el cobro que no es efectivo** con el próximo corte de Salud 4 (§4), y
   sólo entonces decidir si se descuenta del esperado.
3. **Probar el Z una vez**, con la casilla de tarjeta resuelta (§3).
4. **Abrir una caja desde el portal**, aunque sea una vez: es el único tramo del
   circuito que no tiene ni una fila.
