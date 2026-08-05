# Migración de fichas de clientes ERP ↔ Portal

Herramienta para completar y corregir las fichas de clientes en el ERP
(`clientesdte3.oss.com.sv/farma_salud`) y espejar el resultado a
`customers` en el portal.

**Estado al 2026-08-04, 00:25 UTC.** Escrito para retomar sin contexto previo.
Los números del bloque de abajo los genera `estado.py`; esta fecha es de la
prosa, que se escribe a mano.

---

## 1. Dónde estamos

<!-- ESTADO:INICIO -->
```
catálogo del ERP        27,699 fichas
procesadas              24,166 fichas    (checkpoint.json)
portadas al portal      20,569 de 24,657  (customers.erp_id no nulo)
  de ellas con distrito 20,487
pendientes               3,536          (8 bloques de 500)
```

**Verificadas OK: 24,166 · a revisar: 0.** El frente secuencial va por `erp_id 24,170`; hay 3 fichas ya hechas más adelante, del primer bloque que se armó por nombre desde el portal.

`revision_manual.json`: **443 DUI** borrados con su número original guardado (acumula entre bloques; si alguna vez baja, algo se rompió).

`faltantes_dte.json`: **100 fichas** no se pueden facturar todavía bajo DTE 2.0, 86 de ellas fiscales.
Les falta: distrito 87 · departamento 21 · sel_giro 15 · direccion 15 · correo 12 · nrc 11 · nit 10 · nombre 8 · telefono1 8 · municipio 8.

<sub>Generado por `python3 estado.py --escribir`. No editar a mano: los números se generan, las decisiones se escriben.</sub>
<!-- ESTADO:FIN -->

Bloques cerrados: el primero (por nombre, desde el portal) y los
secuenciales desde `erp 283`, todos con `--una-pasada` salvo el primero.
Cero campos perdidos y cero alterados en todo lo procesado.

**Hay fichas reencoladas a propósito** cuando se corrige una regla: se les
borra la entrada del checkpoint para que el próximo bloque las rehaga. Por
eso "procesadas" puede bajar de un momento a otro — es intencional, y el
motivo queda en el commit que lo hizo.


En el bloque 3 se estrenó en vivo la rama del salto con la ficha `erp 1419`
(FRANCISCO NOE LEMUS UMAÑA, Contribuyente): no se tocó en el ERP y sí se espejó
al portal, que es el comportamiento correcto.

Medición real: **1.37s por petición**, ~5.4s por ficha con las pausas. Un bloque
de 500 son ~45 min y el catálogo completo ~34 horas.

### La conexión se reusa (2026-08-03)

`pedir()` mantiene **una conexión persistente** al ERP en vez de abrir TCP+TLS
en cada petición. El bloque hace TRES por ficha —leer, escribir, releer para
verificar—, así que el handshake se pagaba tres veces.

Medido contra el ERP real, por el camino de `pedir()` y no por un banco
sintético: **0.44s por petición con conexión nueva contra 0.16s reusándola,
64%.** Sobre los 2.79s por ficha que se midieron en el bloque 30 son ~0.8s, o
sea ~29% del bloque entero.

Lo que hace a esta palanca distinta de bajar las pausas: **no le agrega ni una
petición al servidor del proveedor** — le llega el mismo trabajo con menos
conexiones. Por eso se pudo aplicar sin esperar el aviso a soporte del ERP, que
sigue siendo la condición para tocar `--pausa-lectura`/`--pausa-escritura`.

Dos cosas que `http.client` no trae y hubo que rehacer a mano, porque perder
cualquiera de las dos cambiaría el comportamiento en silencio: **seguir
redirecciones** y **convertir >=400 en `HTTPError`** (el guard del 4xx de
`pedir` depende de que siga llegando esa excepción). Verificado en vivo: un 404
llega como `HTTPError` en 0.36s, o sea sin gastar el backoff de 5s.

Y aparece un modo de fallo que antes no podía existir: **el servidor cierra una
conexión ociosa**. Eso no es un corte de red, es la vida normal del keep-alive,
así que se reconecta y se repite en el acto — sin gastar uno de los 4 intentos
ni los 5s de espera, o el ahorro se lo comería el backoff. Una sola vez por
petición: si la conexión nueva también falla, ya es un corte de verdad y entra
al camino de siempre. Repetir es seguro también para el POST, por el mismo
argumento por el que `escribir_ficha` ya reintentaba: `process=edit` con id fijo
y los 21 campos es idempotente.

### El hueco entre leer y escribir no era teórico

En el bloque erp 283–1000 se midió: **1 de 499 fichas fue editada por una
persona en el ERP** durante los ~50 minutos entre la simulación y la corrida.
Fue la `erp 885` (PLACIDA ACOSTA DE PACHECO), que pasó de no tener distrito a
tener CHALATENANGO — puesto a mano.

El plan de la simulación decía escribirle `CONCEPCIÓN QUEZALTEPEQUE`, que es un
sorteo determinista. Con `--una-pasada` la ficha se releyó justo antes de
escribir, se vio el distrito real y **no se tocó**. Verificado en el portal:
quedó CHALATENANGO.

O sea que la tasa de edición concurrente no es cero, y el POST manda los 21
campos. Por eso `--una-pasada` es el modo de la corrida larga y no una
optimización opcional.

### "DISTRITO, DEPARTAMENTO" no es un empate

La gente escribe la dirección así —`NUEVA TRINIDAD, CHALATENANGO`,
`SAN ANTONIO DEL MONTE, SONSONATE`— y varios departamentos tienen un distrito
homónimo. Hasta el bloque 4 el matcher veía dos candidatos y desempataba por
sorteo: acertaba la mitad de las veces, **justo en los casos donde la dirección
sí decía cuál era**. Peor que un sorteo a ciegas, porque la información estaba
y se descartaba.

De 5 fichas resueltas así, 2 quedaron mal:

| erp | dirección | escribió | correcto |
|---|---|---|---|
| 176 | `NUEVA TRINIDAD, CHALATENANGO` | CHALATENANGO | NUEVA TRINIDAD |
| 380 | `SAN ANTONIO DEL MONTE, SONSONATE` | SONSONATE | SAN ANTONIO DEL MONTE |
| 161 | `MEJICANOS, SAN SALVADOR` | MEJICANOS ✓ | (acertó de casualidad) |

Corregido: con **más de un** candidato se descartan los que se llaman igual que
el departamento o el municipio de esa ficha. Con uno solo no se descarta nada —
ahí sí puede ser que la persona viva en el distrito homónimo, y ese borde está
en el arnés.

**No se subió `REGLAS`** y el motivo importa: el cambio solo interviene con ≥2
candidatos, o sea exactamente las fichas anotadas con `ambiguo` en
`cambios.distrito`, que son enumerables desde el checkpoint. Se reencolaron las
5 a mano. Subir REGLAS habría releído las 2,078 (una hora contra el servidor del
proveedor) para corregir esas mismas 5.

### El sorteo es determinista, pero SOLO con la misma semilla

`elegir_distrito` siembra con `sha256(portal_id)`, y `planificar` le pasa
`cliente['id']` — que es `'erp:4420'`, **no** `'4420'`. Hasta el 2026-08-02
`revisar_ambiguos.py` le pasaba el `erp_id` pelado, así que comparaba contra
**otro sorteo**: para una ficha que ninguna regla resuelve reportaba "CAMBIA"
alrededor de la mitad de las veces y, con `--corregir`, escribía la otra cara de
la misma moneda. La ficha oscilaba en el ERP a cada pasada sin acercarse a la
respuesta.

Dos arreglos, y el segundo es el de fondo:

1. **La semilla sale del `portal_id` que guarda el checkpoint**, no reconstruida
   como `f'erp:{eid}'`. Tiene que ser el guardado: los primeros bloques se
   armaron desde el portal y ahí el id no tiene esa forma.
2. **`--corregir` ya no escribe una ficha que sigue ambigua.** Se muestra como
   `SORTEO` y se dice por qué. Un sorteo distinto no es una corrección — la
   semilla equivocada solo hacía visible ese agujero.

Las correcciones anteriores no estaban afectadas: 176, 380, 2112, 2304, 2423 y
2457 se resolvieron por REGLA (nombre completo, abreviatura, descarte del
homónimo), y ahí la semilla no interviene. La única escrita por el camino del
sorteo fue la `erp 4420`.

**`erp 4420` acertó por el mecanismo equivocado.** Dirección
`BA LAS FLORES SAN LUIS DEL CARMEN`, candidatos SAN JOSE FLORES y SAN LUIS
CARMEN; quedó en SAN LUIS CARMEN, que es el valor correcto —`BA LAS FLORES` es
el barrio— pero salió de un sorteo, no de una regla. Se dejó porque revertirla
sería escribir el valor peor.

Y fue **el primer dato malo que justificó implementar la regla pendiente**: la
dirección salvadoreña va de lo específico a lo general, así que con dos
candidatos nombrados enteros gana el nombrado MÁS TARDE. Hasta ahí el README la
descartaba por falta de un caso real; `erp 4420` fue ese caso.

**Implementada el 2026-08-03** (`preferir_el_nombrado_mas_tarde`), después de
que el bloque 30 aportara el segundo caso: `erp 11603`,
`BARRIO LAS FLORES SAN JOSE CANCASQUE`, donde el sorteo eligió el BARRIO. Va
después de `descartar_los_que_son_la_ubicacion` y nunca antes — en
`NUEVA TRINIDAD, CHALATENANGO` el nombrado más tarde es el departamento, así que
la regla solo es válida una vez descartado ese candidato. Si dos empatan en
posición no opina y decide el desempate de siempre.

Se releyeron del ERP **las 16 fichas que en todo el histórico eligieron distrito
por sorteo** (el resto se resolvió por regla, donde la semilla no interviene).
13 no se movieron —incluidas 176 y 380, corregidas antes a mano— y 3 cambiaron:

| erp | dirección | tenía | quedó |
|---|---|---|---|
| 6437 | `DESVIO SAN RAFAEL EL TABLON, EL PARAISO` | SAN RAFAEL | EL PARAÍSO |
| 11603 | `BARRIO LAS FLORES SAN JOSE CANCASQUE` | SAN JOSE FLORES | SAN J CANCASQUE |
| 15599 | `LA LAGUNA, LAS VUELTAS, CHALATENANGO` | LA LAGUNA | LAS VUELTAS |

En `erp 4420` la regla llega **al mismo valor que había puesto una persona a
mano**, que es la validación más fuerte de que no es una hipótesis: reproduce la
decisión humana en el caso donde ya se sabía la respuesta.

No se subió `REGLAS`: hacerlo obligaría a releer las 16,142 fichas por tres
correcciones. Es el mismo precedente del arreglo del matcher — se corrige el
código y se nombran a mano las afectadas con `revisar_ambiguos.py --fichas`.

## 2. Puesta en marcha

Faltan dos archivos que **no se versionan** (uno es secreto, el otro pesa 2.6 MB
y envejece):

**`erp.env`** — cookie de sesión del ERP. Formato:

```
ERP_COOKIE=PHPSESSID=<valor>
```

Se saca del navegador con la sesión abierta (DevTools → Application → Cookies).
Caduca; cuando caduca, cualquier script corta con
`SESIÓN CAÍDA: refrescá la cookie en erp.env`. **El checkpoint hace que retomar
sea solo volver a correr.**

**`rep_cli.html`** — índice del catálogo. Se regenera:

```bash
python3 refrescar_catalogo.py
```

Verificá que el arnés pase antes de tocar nada:

```bash
python3 probar_offline.py     # ~50 comprobaciones, no toca el ERP ni la base
```

## 3. Cómo se corre un bloque

```bash
python3 bloque.py --desde-erp 500                          # SIMULACIÓN: no escribe nada
python3 bloque.py --desde-erp 500 --escribir --una-pasada   # escribe y verifica
```

`--desde-erp N` toma las N fichas del catálogo que el checkpoint no tenga con
las reglas actuales. También existe `--entrada archivo.json` con una lista
`[{id, name}]` del portal, que es como se hicieron los primeros bloques.

### ¿Hay que simular antes?

**Con `--una-pasada`, no.** La regla vieja decía "siempre simular primero y
mirar los DUI", y tenía sentido cuando el único modo era el de dos fases: ahí el
plan completo solo se podía ver por adelantado, porque después se escribían las
500 de corrido.

En una pasada cada ficha imprime su plan **justo antes** de aplicarlo, y el
número original de un DUI inválido se escribe a disco ANTES del POST que lo
borra. O sea que lo que la simulación protegía ya está cubierto por la corrida
misma, y simular cuesta 15 minutos y 500 peticiones de más contra el servidor
del proveedor. Decidido así el 2026-08-01, después de tres bloques sin un solo
rechazo.

**Sí conviene simular** cuando cambiaste una regla de `planificar`: ahí querés
ver el efecto sobre las 500 antes de escribir ninguna.

### `--una-pasada` es el modo de la corrida larga

Lee, corrige, verifica y espeja **cada ficha antes de mirar la siguiente**, en
vez de planear las 500 y después escribir las 500. Cuesta exactamente las mismas
peticiones —1,230 por bloque de 500— y cierra el hueco entre la lectura y la
escritura, que en dos fases llega a **15 minutos**. Como el POST manda los 21
campos, ese hueco es la única forma en que la corrida podría pisar una edición
que otra persona hizo en el ERP mientras tanto.

Sin el flag el comportamiento es el de siempre (dos fases), que es lo que
conviene cuando querés ver el plan entero antes de que se escriba nada. En
simulación el flag se ignora: no hay escritura que acercar.

### Reintento del glitch del ERP

El ERP falla de dos maneras y el script las trata distinto:

| respuesta | qué hace |
|---|---|
| no es su JSON (`Proceso no encontrado` en texto plano, un 502, vacío) | **reintenta**, hasta 3, con backoff 2s/4s |
| su JSON diciendo que no (`Ya se registro un cliente con estos datos!`) | **no reintenta** — no cambia por insistir, y ese rechazo es un hallazgo |

Reintentar es seguro porque el POST es idempotente: `process=edit` con id fijo y
los 21 campos deja la ficha igual se aplique una vez o tres. Los intentos quedan
anotados en `bloque_resultado.json` y en `ambiguos.json`, así que un rechazo que
sobrevivió tres intentos no se lee igual que uno contestado a la primera.

Existe porque pasó: **una vez en 365 escrituras**, y el mismo payload entró a la
primera al reintentarlo. A escala de 20,000 escrituras son ~55 cortes.

### Encadenar bloques desatendidos: lo que se aprendió en la corrida de 10

El 2026-08-02 se corrieron 10 bloques seguidos. Cortó **cuatro veces**, y cada
diagnóstico corrigió al anterior. Vale la pena el detalle porque los tres
primeros parecían correctos:

1. **`aplicar_espejo.py` no reintentaba nada.** Un timeout mataba la corrida.
   Real, arreglado — pero no era la causa de fondo.
2. **"Parpadeos de red"**: se amplió el backoff de `bloque.py` de 9s a 30s.
   **Ese cambio no servía para nada**, y conviene saber por qué antes de repetir
   el error.
3. **`bloque.pedir` no capturaba el error.** En CPython 3.9 `urllib` envuelve en
   `URLError` solo el ENVÍO del request: `h.getresponse()` queda fuera del try,
   así que un corte mientras se lee la respuesta sale crudo como
   `ConnectionResetError`/`TimeoutError` y **esquivaba el bucle de reintentos
   entero**. Por eso ampliar el backoff no cambió nada: el bucle no llegaba a
   ejecutarse. Hoy captura `OSError`, que cubre los seis modos de fallo
   (`URLError` y `HTTPError` son subclases suyas, así que el guard del 4xx sigue
   disparando primero).
4. **La causa real era la Mac, no la red ni el ERP.** `pmset` con `sleep 1`,
   `powernap 1`, `standby 1`: se duerme al minuto y tira las conexiones en
   vuelo. Se confirmó cruzando `pmset -g log` con la hora exacta de cada corte,
   y sondeando el ERP justo después: 20 lecturas, 0 fallos, ninguna sobre 3s.
   **`caffeinate -i` no alcanza** — frena el sueño por *idle*, no el
   *Maintenance Sleep* de Power Nap. Cambiar `pmset` necesita `sudo`.

La lección operativa: **no se puede evitar el sueño sin sudo, así que hay que
sobrevivirlo**. Un orquestador de bloques tiene que decidir el corte por
**progreso real** —cuántas fichas nuevas quedaron en el checkpoint— y no por el
código de salida del proceso. Un bloque que murió habiendo avanzado 250 fichas
no es un fallo del que haya que huir: se reintenta y el checkpoint lo retoma
donde quedó. Solo se corta si dos intentos seguidos no avanzan nada.

Y el guardián de "a revisar" tiene que ser **semántico, no un tope numérico**.
Un tope de 3 cortó la cadena en el bloque 16 por un falso positivo: las 4 fichas
eran los rechazos por nombre duplicado, que suben solos a medida que el frente
cruza cada ficha de cada par. Con 19 nombres duplicados en el catálogo esto
puede llegar a ~38, todas esperadas. Lo que importa es si aparece un caso que
**no** sea uno de esos rechazos — eso sí es un patrón nuevo.

### Qué produce

| archivo | qué es |
|---|---|
| `checkpoint.json` | **el estado**. Una entrada por ficha, con la versión de reglas. Perderlo = releer todo |
| `portal_pendiente.jsonl` | cola del espejo, append-only. Una línea por ficha procesada |
| `ambiguos.json` | nombres sin match, duplicados, rechazos del ERP |
| `revision_manual.json` | **el número original de cada DUI borrado**. ACUMULA entre bloques — es lo único que hace reversible el borrado, y hasta el 2026-08-01 cada corrida pisaba la anterior |
| `bloque_plan.json` / `bloque_resultado.json` | plan y resultado del último bloque |
| `duplicados_erp.json` | los 19 nombres duplicados del catálogo — lista de purga |
| `faltantes_dte.json` | **fichas que no se pueden facturar todavía**: qué campo le falta a cada una para cumplir DTE 2.0, por categoría. Acumula entre bloques y una ficha que se completa sale sola. Es lista de trabajo de una persona — un NIT ausente no se deduce de nada |

## 4. El espejo al portal

`customers` **no tiene policy de escritura** — su única policy es
`customers_select` (SELECT, `authenticated`, `USING (true)`). Para escribir se
creó el RPC `aplicar_espejo_erp(p_filas json)`
(migración `20260801044543`), SECURITY DEFINER, concedido solo a
`authenticated` y `service_role`. Empareja por `search_name`, **nunca inserta**,
y omite los nombres que llegan repetidos. Devuelve
`{recibidas, duplicadas_omitidas, actualizadas, sin_match}`.

Se aplica con:

```bash
python3 aplicar_espejo.py            # muestra cuántas hay en cola
python3 aplicar_espejo.py --aplicar  # las manda
```

Se autentica con `portal-user` / `portal-password` del `.env` del repo — el
portal arma el correo como `usuario@farmalasa.app`, y el script lo completa si
en el `.env` está el usuario pelado. No hace falta la service-role key.

`sin_match` cuenta las fichas del ERP cuyo nombre no existe en `customers`. Es
normal: el portal solo tiene clientes que aparecieron en una venta (24,509)
contra 27,575 fichas del ERP. **No se crean**, solo se reportan.

### El espejo NO pisa lo que se editó desde el portal

Hasta el 2026-08-01 sí lo hacía. El RPC reescribía las 15 columnas sin
condición y, medido en vivo a las 16:01 UTC, de las 2 fichas con edición del
portal **pisó las 2** — sin dejar rastro, porque `customers` no tiene ningún
trigger y la bitácora seguía diciendo que la corrección estaba vigente. Además
escribía NULL cuando el ERP no traía el dato, y el 98% de las fichas vienen sin
correo: cualquier correo cargado a mano se borraba en la corrida siguiente.

Corregido en la migración `20260801163144`. La regla es **el ERP manda**, y lo
que se protege no es "el portal gana" sino el tramo en que una edición todavía
no tuvo chance de llegar al ERP:

| situación | qué hace |
|---|---|
| el ERP no manda el dato (campo ausente) | no toca la columna |
| no hay edición del portal pendiente | manda el ERP |
| hay edición pendiente y el ERP sigue igual que cuando se editó | respeta la edición |
| hay edición pendiente **y el ERP también cambió** | manda el ERP, el descarte se anota en `espejo_conflictos` y la entrada se cierra con `descartado_at` |

La marca de "pendiente" es `customers_changelog.erp_synced_at IS NULL` **y
`descartado_at IS NULL`**. Cuando el empuje al ERP marca la primera, la
protección se levanta sola y el ERP vuelve a mandar.

### `descartado_at`: por qué una decisión también tiene que anotarse

Hasta el 2026-08-02 solo existía `erp_synced_at`, y el espejo y el push se
trancaban entre sí. El espejo decidía que un campo perdía la carrera y lo
anotaba; el push, al ver ese conflicto, dejaba de mandar el campo (regla 3 de
§4b). Las dos reglas correctas — pero **nadie cerraba la entrada**, y
"pendiente" es justamente lo que hace que el espejo la vuelva a detectar. Cada
corrida la descartaba de nuevo:

```
espejo: "esta edición perdió"  →  push: "entonces no la mando"
   ↑                                        ↓
   └──── sigue pendiente ←── nadie la marca ─┘
```

Medido: **7 filas idénticas** en `espejo_conflictos` para el mismo
`changelog_id 10`, una por corrida, y el badge *"Sin enviar al ERP"* encendido
para siempre sobre un cambio ya decidido.

`descartado_at` cierra la entrada sin mentir: **no** se reusó `erp_synced_at`,
porque ese campo significa "viajó al ERP" y acá no viajó nada. La bitácora
ahora distingue *"Sin enviar al ERP"* (todavía puede viajar) de *"Descartado: el
ERP ya tenía otro valor"* (no va a viajar).

De paso arregla algo que el candado viejo hacía mal: se marca el campo entero
**en el momento del conflicto**, así que la cadena superada queda identificada
por su fecha. El cruce contra `espejo_conflictos` bloqueaba el campo **de por
vida**, incluso para una edición hecha meses después de la carrera perdida —
que es intención nueva y sí tiene que viajar.

El RPC además dejó de reescribir filas que no cambiaron — la misma cola pasó de
826 filas actualizadas a 1.

## 4b. El espejo al revés: del portal AL ERP — **automático**

Editar en el portal manda el cambio al ERP **en el momento**. No hay que correr
nada.

```
Guardás en el portal
    ↓  el guardado NO espera al ERP (es un servidor ajeno; medido: 300 s en una lectura)
push-cliente-erp (edge function)  →  llega al ERP  →  toast "Enviado al ERP"
    ↓  si falla
queda en cola, protegida del espejo, con badge "Sin enviar al ERP" en la bitácora
    ↓
cron `drain-cliente-erp-queue` cada 10 min  →  la levanta sola
```

| pieza | qué es |
|---|---|
| `push-cliente-erp` | edge function. Con `customer_id` viene del formulario y usa el JWT de la persona; sin él viene del cron y usa service_role |
| `drain-cliente-erp-queue` | cron cada 10 min, drena de a 5 fichas. Es la GARANTÍA: sin él, un envío fallido se queda pendiente para siempre si nadie vuelve a editar esa ficha |
| `cola_espejo_portal_erp()` | la cola (migración `20260801164413`) |
| `marcar_empujado_al_erp()` | la salda. Acepta service_role además del permiso de módulo (`20260801200437`), porque un cron no tiene usuario |
| `empujar_al_erp.py` | **el mismo trabajo desde la terminal**. Ya no hace falta para la operación normal; sirve para depurar o para drenar a mano |

**OJO AL REDESPLEGAR `push-cliente-erp`**: va con `--no-verify-jwt` porque el
cron manda el `admin_invoke_secret` de Vault como Bearer, que no es un JWT. Un
redeploy sin repetir el flag la resetea a `verify_jwt=true` y el cron falla con
401 **antes de ejecutar una línea** — ya mordió dos veces a este proyecto con
otras funciones.

**La tabla de abreviaturas está duplicada** entre `src/data/elSalvadorGeo.js` y
la edge function: son dos runtimes sin bundling entre ellos. Si se agrega una
fila allá, hay que agregarla acá.

Con eso el ciclo cierra: edito en el portal → llega al ERP → el espejo lo trae
de vuelta y coinciden.

Tres cosas que NO hace, todas a propósito:

1. **No adivina un select.** El portal guarda la etiqueta (`Chalatenango`) y el
   ERP quiere el value (`7`). Se empareja por `norm()` —sin acentos ni
   mayúsculas— contra las opciones de esa misma ficha. Si no hay coincidencia
   exacta tras normalizar (`SN MIG MERCEDES` contra `San Miguel de Mercedes`),
   **el campo no viaja y se reporta**. Inventar un distrito en una ficha fiscal
   es justo lo que este proyecto tiene prohibido.
2. **No salda lo que no viajó.** Si de dos campos uno resuelve y el otro no, se
   marcan solo los `changelog_ids` del que llegó. El otro sigue pendiente y se
   reintenta.
3. **No empuja un campo que perdió una carrera.** Cuando el espejo descarta una
   edición marca con `descartado_at` **todas** las entradas pendientes de ese
   campo, no solo la última: las anteriores son eslabones de la misma cadena
   superada. Sin esta regla, el `customer_id 16164` del portal habría recibido
   `'7538-5899'` —un valor que la persona ya había reemplazado— porque esa
   entrada quedó limpia mientras la siguiente perdía la carrera.

   **Ese 16164 es el id del PORTAL, no del ERP.** Las dos numeraciones son
   independientes y se pisan: `customers.id 16164` es la ficha basura `....`
   (`erp_id 9810`), mientras que `id_cliente 16164` del ERP es MARIA ADILIA
   SOSA DE VASQUEZ, otra persona. Escribir "el cliente 16164" a secas manda a
   leer la ficha equivocada — pasó el 2026-08-02. Decir siempre de qué
   numeración se habla.

### Lo que el viaje de ida y vuelta NO conserva

Probado end-to-end con la ficha `erp 2` (JOSE RUTILIO ALEMAN VASQUEZ): se editó
`telefono2` desde el portal, se empujó, se verificó en el ERP, y la ficha quedó
**idéntica a la foto inicial en los 21 campos**.

Pero el distrito mostró el límite: la persona había puesto `Chalatenango`
(catálogo oficial), el empuje lo mandó bien —resolvió al value `7`— y al volver
el espejo trajo `CHALATENANGO`, que es como rotula el ERP. **El dato es el
mismo, la rotulación no.** Mientras el portal guarde la etiqueta del ERP en vez
de la del catálogo, esto va a pasar siempre; es el mismo problema de la tabla de
equivalencias ERP ↔ catálogo que hace falta para los 894 distritos que el
formulario no reconoce.

## 4c. DTE 2.0 — qué necesita cada tipo de cliente

DTE 2.0 ya está vigente y exige **distrito y teléfono** en el receptor. Eso da
vuelta el criterio con el que arrancó esta migración: hasta ahora **no** tocar
una ficha era la opción neutral, y ya no lo es — una ficha sin distrito no se
puede facturar.

| campo | Consumidor | Contribuyente / Gran Contribuyente |
|---|---|---|
| nombre, teléfono, departamento, municipio, **distrito** | requerido | requerido |
| NIT, NRC, giro, correo, dirección | — | requerido |

Estado de las 1,015 fichas ya espejadas (de `faltantes_dte.json`):

```
99 fichas no se pueden facturar todavía · 83 de ellas fiscales
   distrito 99 · direccion 8 · sel_giro 3 · nit 3 · nrc 3 · correo 2
```

Los **consumidores ya cumplen** —16 sin distrito de 910— porque la migración se
los completa. Los **fiscales están al 100% sin distrito**, y es consecuencia
directa de que el bloque no los escribe: se completan desde el portal, uno por
uno, con una persona decidiendo.

## 5. Las reglas

Versionadas en la constante `REGLAS` de `bloque.py`. El checkpoint guarda con
cuál se procesó cada ficha, y **subir el número reprocesa todo** — es lo que
hace que una regla nueva se aplique a lo ya hecho.

| # | regla |
|---|---|
| — | **Solo se ESCRIBE la categoría `Consumidor`.** Cualquier otra se lee y se espeja al portal, pero el bloque **nunca** la escribe en el ERP — ni siquiera cuando la dirección nombra el distrito. Se corrigen **desde el portal**, y de ahí `empujar_al_erp.py` lleva el cambio: así detrás de cada dato fiscal hay una decisión humana |
| 1 | **Distrito**, si está vacío: nombre completo en la dirección → token → determinista `hash(id) % n` |
| 2 | **Teléfono**: 8 dígitos, o 503 + 8. Si no cumple → `23010013` |
| 3 | **Nombre** → MAYÚSCULA (el 91% del catálogo ya lo está) |
| 5 | **DUI inválido → se borra**, y el número original queda en `revision_manual.json` antes de vaciarlo. `--dui-invalido reportar` lo deja intacto |
| — | **Sin municipio** → default Chalatenango / Chalatenango Sur / CHALATENANGO |

## 6. Lo que hay que saber del ERP

Esto costó una tarde de diagnóstico. No lo redescubras.

1. **Un POST parcial BORRA lo que no mandás.** Se reenvían los 21 campos.
2. **Los valores van CRUDOS, sin `strip()`.** El control de duplicados compara el
   nombre tal cual, y hay fichas cuya única diferencia es un espacio inicial.
   Recortarlo las hace colisionar y el ERP rechaza el guardado **entero**.
3. **Leé siempre la respuesta**: `{"typeinfo":"Error","msg":"Ya se registro un
   cliente con estos datos!"}`. Sin eso, un rechazo se ve idéntico a "el campo no
   se aplicó" y perseguís el problema equivocado.
4. **Los ids de distrito NO son globales** — van por (departamento, municipio),
   vía `_helpers.php` con `{process:'getDistrito', id_departamento, id_municipio}`.
   El `8` es MEJICANOS en San Salvador y DULCE NOM MARÍA en Chalatenango.
   **En el portal se guarda el NOMBRE, nunca el id.**
5. **El combo trae 3 pseudo-clientes que no son fichas**: `TODOS`, `-1` (CLIENTES
   VARIOS), `-2` (CLIENTE FRECUENTE NUEVO). Baldes de mostrador del POS. El
   índice ya los excluye (solo acepta id > 0).
6. **Categorías (6)**: Consumidor, Contribuyente, Gran Contribuyente,
   Contribuyente Exento, Extranjero, Menor de edad. El corte es por igualdad
   contra `'Consumidor'`, así que una categoría nueva se saltea sola.

## 7. Composición del catálogo (muestra de 200 fichas al azar)

```
categoría      99% Consumidor · 1% Contribuyente
departamento   98% Chalatenango · 1% San Salvador
sin distrito   95%   ← esto es casi todo el trabajo
teléfono       99% con 8 dígitos · 0% vacíos
DUI            66% válido · 30% vacío · 2% inválido
```

### El matcher de distritos rinde MENOS de lo que decía la primera medición

La medición vieja (85 direcciones del `ccf_erp.json`) daba ~40% resuelto por
dirección, ~16% ambiguo y ~44% determinista. **Esa muestra eran contribuyentes**
—negocios, con direcciones fiscales completas— y el catálogo es 99% consumidor
final. Medido sobre las 500 fichas del bloque erp 283–1000, que sí son la
población real:

```
determinista (la dirección no dice)  374   78%   ← distrito sorteado
dirección (nombre completo)           88   18%
dirección (abreviatura)               19    4%
ambiguo                                0    0%
```

O sea que a escala del catálogo no son ~10,000 fichas con un distrito inventado
dentro del municipio correcto: son del orden de **21,000**. Sigue estando
aceptado —el municipio, que es lo que importa, siempre es el real, y el sorteo
es determinista y auditable— pero el número honesto es ese, no el anterior.

Los 0 ambiguos no son una mejora: son la otra cara del mismo dato. Una dirección
que no nombra ningún distrito no puede nombrar dos.

## 8. Decisiones pendientes

1. ~~Qué se hace con los DUI inválidos~~ — **RESUELTO el 2026-08-01: se borran.**
   Un DUI que no pasa el verificador está mal, y eso es aritmética. Lo que se
   agregó es la red: el número original se registra en `revision_manual.json`
   **antes** de vaciarlo, así que borrar dejó de ser irreversible y se puede
   corregir con el cliente después. Dato que acotó el riesgo: las 10 fichas del
   muestreo son consumidor final exclusivo (0 CCF), y ahí el DUI del receptor no
   es campo requerido — el número incorrecto no viajaba a Hacienda.
2. ~~Las fichas duplicadas~~ — **RESUELTO el 2026-08-01.**
   `python3 revisar_duplicados.py` lee las dos fichas de cada nombre y compara
   campo por campo: 17 de los 19 se resolvieron solos y ya están espejados
   (los tres que estaban trabados —FELIX ANTONIO RECINOS CARCAMO, NURIA ROXANA
   VILLANUEVA, YNES ANTONIO ARDON— ya tienen `erp_id` en el portal).

   Quedan **dos que necesitan una persona**, porque las dos fichas traen DUI
   distintos y eso ya no es un duplicado tipográfico — pueden ser dos personas
   con el mismo nombre:

   | nombre | fichas | DUI en conflicto |
   |---|---|---|
   | FLOR DE MARIA GUARDADO GUARDADO | 3883 / 8598 | `01404969-2` vs `02055661-5` |
   | WILLIAM ENRIQUE ALEMAN ALFARO | 7280 / 7284 | `01347642-2` vs `08666142-6` |

   Y **un caso donde elegir una ficha descarta un dato**: MOISES RODOLFO
   HERNANDEZ ANAYA gana con la 26151 (NIT, NRC, correo) y con eso se pierde el
   `dui='05216466-4'`, que solo estaba en la 3906. Eso se arregla purgando el
   duplicado EN EL ERP, no en el espejo: fusionar los campos daría una fila del
   portal que no coincide con ninguna ficha real. Está anotado en
   `duplicados_analisis.json` bajo `pierde`.
3. **Dos distritos probablemente mal**, ya escritos, del tramo débil del matcher:
   `BARRIO LAS FLORES → SAN JOSE FLORES` (erp 3461) y
   `COL SAN FRANCISCO → SAN FRANCISCO LEMPA` (erp 1672).
4. ~~Credenciales del portal~~ — **RESUELTO**: `aplicar_espejo.py` se autentica
   solo y llama al RPC. Un bloque de 500 se espeja en dos llamadas.
5. **Avisarle a soporte del ERP** antes de la corrida larga. No por permiso: el
   catálogo completo son ~12-15 horas de tráfico automatizado contra el servidor
   del proveedor, y el riesgo real es que alguien vea un cambio masivo y
   "restaure de backup".

## 9. Módulo de Clientes en el portal

El prompt para construirlo está en `docs/PROMPT-MODULO-CLIENTES.md`.
