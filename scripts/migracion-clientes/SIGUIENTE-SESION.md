# Prompt para la próxima sesión

Copiá esto tal cual:

---

Retomá la migración de fichas de clientes ERP ↔ portal.

## El barrido del catálogo TERMINÓ el 2026-08-05

No queda catálogo que recorrer. Se procesaron las 27,701 fichas del catálogo y
las 6 que faltan **son exactamente los 6 rechazos por duplicado** de la decisión
abierta #3 — el ERP no las deja escribir y por diseño no se checkpointean, así
que un bloque nuevo las vuelve a intentar y vuelve a fallar. Que el pendiente
diga 6 no es trabajo pendiente: es esa decisión sin tomar.

Once bloques ese día (g1-g11), +5,014 fichas, cero campos perdidos y cero
alterados en todas.

**Lo que queda NO son bloques, son las decisiones abiertas de abajo.** Corré un
bloque solo por una razón: el catálogo sigue recibiendo altas mientras nadie
mira —40 fichas entre el arranque y el primer bloque del 5-ago, 8 más en las
cinco horas siguientes— y esas altas entran sin distrito. Un bloque cada tanto
las levanta; el procedimiento de abajo sigue valiendo tal cual.

**Leé primero `scripts/migracion-clientes/README.md`** — tiene el estado, las
reglas, lo que hay que saber del ERP y las decisiones abiertas. Está escrito
para retomar sin contexto previo.

**El estado exacto está en el README §1**, en el bloque generado entre los
marcadores `ESTADO:INICIO/FIN`, o corriendo `python3 estado.py`. No lo repito
acá a propósito: un número escrito a mano en dos lugares se desincroniza, y este
mismo archivo llegó a decir "585 fichas procesadas" estando cuatro bloques
atrás.

Lo que no cambia bloque a bloque: **cero campos perdidos y cero alterados** en
todo lo procesado, y la verificación relee cada ficha después de escribirla.

Antes de tocar nada: `python3 probar_offline.py` tiene que pasar en verde (162
comprobaciones, no toca el ERP ni la base) y `python3 refrescar_catalogo.py`
para actualizar el índice. **El estado exacto lo da `python3 estado.py`** — no
te fíes de los números escritos en prosa, fíjate en el bloque generado del
README §1.

## Correr un bloque

```bash
python3 bloque.py --desde-erp 500 --escribir --una-pasada   # ~25-40 min
python3 aplicar_espejo.py --aplicar                          # espeja al portal
python3 revisar_ambiguos.py --corregir                       # los desempates
python3 estado.py --escribir                                 # actualiza el README
```

El rango del primer comando es ancho porque el ERP varía: el 2026-08-03 se
midieron 4.93s por ficha a la mañana y 2.79s a la tarde, el mismo día y el mismo
código. Desde ese día `pedir()` reusa la conexión (~29% menos, README §1), así
que el piso bajó — pero el techo lo sigue poniendo el servidor del proveedor, no
nosotros.

**El paso de los ambiguos tampoco es opcional.** Un desempate no acierta la
mitad: se equivoca la mitad **justo donde la dirección sí decía cuál era**.
Medido en dos bloques seguidos: 2 de 5 mal en el bloque 4, **4 de 6 mal en el
5**. `revisar_ambiguos.py --corregir` relee esas fichas, las pasa por las reglas de
hoy y **escribe** la corrección en el ERP.

**No sirve reencolarlas** (borrar su entrada del checkpoint para que el próximo
bloque las rehaga). Se probó y no corrigió nada: la regla del distrito solo
actúa si el campo está VACÍO, y estas ya tienen uno — el equivocado. Salen "sin
cambios" y, peor, pierden la marca de `ambiguo`, así que la detección
automática ya no las ve. Si te pasa, `--fichas 2112,2304` las nombra a mano.

**La lista de candidatas ya no crece sola.** Hasta el 2026-08-02 la detección
buscaba la subcadena pelada `ambiguo` en la anotación del checkpoint, y el texto
que escribe la propia corrección dice `(corregido por revisar_ambigu**os**)`: se
detectaba a sí misma, así que cada ficha corregida volvía a la lista para
siempre y se releía del ERP en cada pasada. Eran 9 candidatas de las cuales 6
ya estaban resueltas. Ahora se busca `\(ambiguo\b` y quedan las 3 reales.

**El tercer comando no es opcional.** El estado del README se generaba a mano y
por eso envejecía: llegó a decir 1,085 cuando iban 2,073, y este mismo prompt
decía 585 estando cuatro bloques atrás. Un número viejo se lee igual que uno
correcto, así que nadie lo nota. Ahora se regenera de los datos vivos —
checkpoint, catálogo y portal— entre los marcadores `ESTADO:INICIO/FIN`. Los
NÚMEROS se generan, las DECISIONES se escriben.

**No hace falta simular antes** — decidido el 2026-08-01 y explicado en el
README §3. Sí conviene simular si cambiaste una regla de `planificar`.

Si `revisar_ambiguos.py` dice **"sigue ambigua"** en alguna, es que ninguna
regla la resuelve y ganó el sorteo: leerla a mano. **Desde el 2026-08-02 esas
NO se escriben** aunque uses `--corregir` — salen marcadas `SORTEO`. Antes sí se
escribían, y era un sorteo distinto, no una corrección: la herramienta sembraba
con el `erp_id` pelado (`'4420'`) y el bloque con el `portal_id` (`'erp:4420'`),
así que la ficha oscilaba entre dos valores a cada pasada. Ver README §1.

**La regla pendiente se implementó el 2026-08-03** (`preferir_el_nombrado_mas_tarde`).
La dirección salvadoreña va de lo específico a lo general (barrio → cantón →
distrito → departamento), así que entre dos candidatos gana el nombrado MÁS
TARDE — pero solo **después** del filtro del departamento, porque
`NUEVA TRINIDAD, CHALATENANGO` tiene el departamento al final.

Se releyeron las 16 fichas que en todo el histórico eligieron distrito por
sorteo: 13 quedaron igual y 3 se corrigieron (6437, 11603, 15599). Detalle y
tabla en README §1. `REGLAS` NO se subió, por el mismo criterio que el arreglo
del matcher: se nombran a mano las afectadas con `revisar_ambiguos.py --fichas`.

**Si aparece un caso nuevo del mismo tipo**, la regla no lo va a resolver sola
cuando los dos candidatos empatan en posición: ahí devuelve los candidatos
intactos y vuelve a decidir el sorteo. Acota el sorteo, no lo reemplaza.

## Lo primero que va a pasar

**Seis fichas van a salir rechazadas, y está bien.** Son nombres duplicados en
el ERP: contesta `Ya se registro un cliente con estos datos!` al escribir
cualquiera de las dos fichas de un par. El script no reintenta —ese rechazo es
un hallazgo, no un glitch—, verifica que la ficha quedó intacta y **no la anota
en el checkpoint**, así que vuelve a intentarse en cada bloque y falla igual.

| erp | nombre |
|---|---|
| 3883 / 8598 | FLOR DE MARIA GUARDADO GUARDADO |
| 7280 / 7284 | WILLIAM ENRIQUE ALEMAN ALFARO |
| 10290 / 16421 | JOSE MARDOQUEO RAMIREZ MEJIA |

Los tres pares están completos: al 2026-08-04 las seis rechazan en cada bloque
(`ambiguos.json`, todas con `duplicado: true`). Cuando esto decía "cinco", la
`16421` todavía no había sido cruzada por el frente.

**Este número sube solo** a medida que el frente cruza cada ficha duplicada: al
2026-08-05 hay **20** nombres duplicados en el catálogo, así que puede llegar a
~40. No es deterioro. (Eran 19 hasta el refresco de catálogo del 2026-08-05, que
además sumó 40 fichas nuevas: 27,659 → 27,699.) Si automatizás bloques, el corte NO puede ser un tope numérico de
"a revisar" — tiene que comparar contra los rechazos con `duplicado: true` de
`ambiguos.json` (ver README §3). Un tope de 3 cortó una cadena por falso
positivo el 2026-08-02.

Se resuelve purgando los duplicados en el ERP, que es decisión de persona
(decisión abierta #3).

**Y el espejo va a rechazar 2, que es OTRA cosa.** `aplicar_espejo.py` cierra con
"2 ficha(s) que el portal RECHAZÓ" y un `HTTP 409 / 23505` sobre el índice único
de `customers.nit`. No son los rechazos del ERP de arriba: estos los pone el
PORTAL, y se repiten en todos los espejos desde el 2026-08-03 como mínimo
(`espejo_b30.log` en adelante). Nadie los había anotado — el espejo dice "el
resto sí se aplicó" y el total grande tapa las 2.

| erp | fila portal | nombre | nit |
|---|---|---|---|
| 4324 | 17015 | FRANCISCO ANTONIO ALVARENGA ALVARENGA | `0407-051066-002-0` |
| 14318 | 494 | ALVARENGA ALVARENGA FRANCISCO ANTONIO | **null** ← rechazada |
| 15973 | 21268 | NERIS PALMA ORTIZ | `0462-3018--0` |
| 20011 | 7414 | NERIS ORTIZ PALMA | **null** ← rechazada |

Es la misma persona cargada dos veces en el ERP **con el nombre invertido**, así
que el matcher por nombre no las junta. En el portal son dos filas distintas; el
espejo le quiere escribir el NIT a la que lo tiene vacío y el índice único lo
frena porque la otra ya lo ocupa.

**El efecto es silencioso y permanente**: `erp 14318` y `erp 20011` se quedan con
`nit` y `dui` en NULL en el portal para siempre, aunque en el ERP sí tengan el
dato. No aparecen en `faltantes_dte.json` —que mira el ERP, no el portal—, así
que el hueco no se ve por ningún lado salvo en la cola del log del espejo.

A diferencia de los tres pares del ERP, acá el NIT es **el mismo** en ambas, así
que no es "pueden ser dos personas": son una. Decisión abierta #4.

## Si vas a encadenar bloques desatendidos (y lo que se aprendió el 5-ago)

Leé README §3, "Encadenar bloques desatendidos". El resumen: **esta Mac se
duerme al minuto** (`pmset`: `sleep 1`, `powernap 1`) y tira las conexiones en
vuelo; `caffeinate -i` no frena el *Maintenance Sleep*. Sin `sudo pmset -a sleep
0 powernap 0` no se puede evitar, así que el orquestador tiene que **sobrevivirlo**:
decidir el corte por progreso real en el checkpoint —no por el código de salida—
y reintentar el bloque, que retoma donde quedó.

**Pasó en g10 y el mecanismo funcionó tal como está escrito**: el proceso murió
a media ficha (la `erp 27523`), el log cortó sin error ninguno, y el relanzado
tomó las 147 que faltaban y cerró. La ficha a medio escribir no se perdió porque
el bloque solo checkpointea lo que verificó releyendo.

**Y una trampa nueva, si medís el progreso desde afuera**: contar las líneas
`^OK|^REVISAR|^SALTA` del log SUBESTIMA. Las fichas que salen `sin cambios`
cierran con `ESPEJO   <nombre>   sin cambios`, que no empieza con ninguna de
esas tres. En g10 el contador decía 365 cuando el checkpoint ya tenía 425 — 60
fichas de diferencia, y en un bloque con muchas `sin cambios` es peor. Medí el
`len()` del checkpoint, o contá `(portal erp:`, que sale una vez por ficha.

Las 5 fichas reencoladas del handoff anterior (161, 176, 380, 1641, 1791) ya
están: **176 quedó NUEVA TRINIDAD y 380 SAN ANTONIO DEL MONTE**, verificadas
releyéndolas del ERP. Reencolarlas no había alcanzado —tal como avisaba este
mismo archivo— y se arreglaron con `revisar_ambiguos.py --fichas 176,380
--corregir`.

La `erp 1791` (JOSE MARIO ABARCA) es un caso aparte que **no hay que "arreglar"**:
alguien le cambió el municipio a mano en el ERP después de procesarla, y como los
ids de distrito van por (departamento, municipio), el distrito que le habíamos
escrito **se reetiquetó solo** — el portal decía POTONICO y el ERP EL PARAÍSO,
sin que nada fallara. Por decisión del usuario se dejó el ERP como está y se
espejó al portal. Si volvés a verla, ya coincide.

## Lo que ya NO hay que hacer

- **No correr `empujar_al_erp.py` a mano.** Editar en el portal manda el cambio
  al ERP solo, y un cron cada 10 minutos drena lo que haya quedado pendiente.
  El script sigue existiendo para depurar.
- **No tocar los contribuyentes.** Decisión del usuario: quedan pendientes. El
  bloque ya los saltea por regla — se leen, se espejan, no se escriben.

## Decisiones abiertas, del usuario

1. **Avisarle a soporte del ERP** antes de seguir de corrido: los bloques que
   faltan son del orden de 6-9 horas de tráfico contra el servidor del
   proveedor, y el riesgo real es que alguien vea el cambio masivo y "restaure
   de backup". Es lo único que falta para poder encadenar bloques sin parar.

   **Ese aviso es también lo que destraba bajar las pausas.** Hoy `pedir()` se
   toma 1.4s por ficha entre `--pausa-lectura` y `--pausa-escritura`, que es la
   mitad del tiempo de cada ficha. Bajarlas a ~0.4s corta otro tercio, pero
   duplica el RITMO de peticiones contra el proveedor — al revés que el
   keep-alive, que baja el tiempo sin agregar tráfico. Por eso una se aplicó ya
   y la otra espera a que haya alguien avisado del otro lado.
2. **Las 99 fichas de `faltantes_dte.json`** — no se pueden facturar bajo DTE
   2.0. **65 necesitan un solo campo, el distrito**; a 86 les falta el distrito
   entre otros campos, y **85 son fiscales** (todo lo que no es `Consumidor`) y
   quedan congeladas por decisión del usuario. Recontado del archivo el
   2026-08-04; antes decía 87 y 83.

   El desglose viejo —"50 lo tienen escrito en su propia dirección y 49 las
   decide una persona"— **no se puede recomputar**: `faltantes_dte.json` guarda
   `erp_id`, `name`, `categoria` y `faltan`, no la dirección. Sumaba 99 contra
   un universo de 87, así que ya no cerraba. Para rehacerlo hay que releer las
   direcciones del ERP y pasarlas por las reglas de `planificar`.
3. **Tres nombres duplicados sin resolver**: FLOR DE MARIA GUARDADO GUARDADO
   (3883/8598), WILLIAM ENRIQUE ALEMAN ALFARO (7280/7284) y JOSE MARDOQUEO
   RAMIREZ MEJIA (10290/16421). Tienen DUI distintos en cada ficha, así que
   pueden ser dos personas — no lo resuelve un script.

   **Ya cuestan las seis.** El frente pasó los tres pares, así que el ERP rechaza
   sus seis escrituras en cada bloque y, como no se checkpointean, se reintentan
   para siempre (~15s por bloque). Esto antes decía "la 7280 va a hacer lo mismo
   cuando el frente llegue ahí": llegó el 2026-08-04.
4. **Las 2 filas del portal sin NIT** (`erp 14318` / `erp 20011`, detalle y tabla
   en "Lo primero que va a pasar"). Son la misma persona duplicada en el ERP con
   el nombre invertido, con el MISMO NIT en las dos fichas — no es ambigüedad,
   es un duplicado. Hay que decidir cuál fila del portal sobrevive y fusionar,
   o purgar la ficha duplicada en el ERP. Mientras tanto el espejo las rechaza
   en cada bloque y esas dos filas del portal no se pueden facturar bajo DTE 2.0
   aunque el ERP tenga el dato.
5. **El reproceso completo**, si se quiere prolijidad del mecanismo de `REGLAS`:
   el matcher se arregló sin subirla, reencolando las 5 afectadas a mano. Está
   justificado en el README, pero si se prefiere, subir REGLAS a 7 relee las
   2,073 (≈1 h) y deja el checkpoint coherente por construcción.

## Contexto adicional si hace falta

- Los 35 DUI borrados, con su número original, están en `revision_manual.json`.
  **Ese archivo acumula entre bloques** — si alguna vez vuelve a tener menos
  entradas que antes, algo se rompió.
- `docs/RETOMAR-CLIENTES-2026-08-01.md` es el estado del MÓDULO de clientes que
  dejó otra sesión (vista, filtros, permisos), que es trabajo distinto de esta
  migración.
- Hay varias sesiones de Claude sobre este mismo árbol. `git status --short`
  antes de editar un archivo que no tocaste, y `git add` con rutas explícitas
  siempre — hoy una sesión ajena se llevó 4 archivos míos dentro de su commit.
