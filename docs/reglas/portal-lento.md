# Cuando el portal no responde: `npm run portal:lento`

> Movido desde `CLAUDE.md` el 2026-11-06 sin cambiar el contenido. Allá queda los seis pasos; acá, el detalle, las mediciones y la historia. Las cifras de este archivo son de la fecha en que se escribieron: la verdad vigente vive en el archivo o la tabla que cada párrafo nombra.

## Cuando el portal no responde: `npm run portal:lento` (2026-09-01)

**El síntoma nunca nombra la causa.** El 01-sep el portal dejó de dejar entrar
entre las 16:35 y las 16:44 y el reporte fue *«Realtime de Supabase no funciona,
no se puede iniciar sesión»*. Las dos mitades eran falsas: Realtime devolvía
**101** y Auth devolvía **200** durante todo el corte. Lo que fallaba era lo que
el portal lee DESPUÉS de entrar — 19 s, el techo del gateway — así que la
pantalla quedaba colgada, que es indistinguible de no poder entrar.

Y el log tampoco ayuda: dice `Timed out acquiring connection from connection
pool`, que manda a mirar las conexiones. No estaba ahí.

**Lo primero es el orden, y por eso hay un comando.** `npm run portal:lento` es
de sólo lectura y contesta las cuatro preguntas que separan el problema:
¿está pasando ahora?, ¿hay alguna consulta viva de más de 3 s?, ¿quién cuesta
más por llamada?, ¿y qué hago con eso?

### La causa fue una consulta de LECTURA, y estaba bien escrita

`puntos_tickets_de_ficha_que_no_acumula` corría cada minuto y devolvía `[]` —
pero para llegar a esa lista vacía recorría **358,964 filas** con una búsqueda
por cada una: **1,528,584 bloques (11.7 GB) y hasta 12,963 ms por vuelta**, sobre
una reserva de 20 conexiones.

El defecto no estaba en el SQL sino en una **ESTIMACIÓN**. `customers` no tenía
`false` entre los valores comunes de `acumula_puntos`, así que el planificador
usó la selectividad por defecto de un booleano —**la mitad**, 14,042 de 28,120—
cuando la respuesta real es **UNA fila**. Creyendo que las coincidencias
abundaban, eligió recorrer en el orden del `ORDER BY` esperando llenar el
`LIMIT 500` enseguida. Un `ANALYZE` bastó: **2,868 ms → 13.5 ms**.

**Un booleano casi todo igual es el caso donde el default miente más**, y el
autovacuum analiza al 20% de cambio, o sea casi nunca en una tabla de 28,120
filas. Por eso la corrección definitiva es un **índice parcial** sobre la
condición rara (`ON customers (id) WHERE acumula_puntos = false`): dejarlo en el
`ANALYZE` es apoyar el portal en que alguien lo repita a tiempo.

### Se mide en BLOQUES, no en milisegundos

Es la decisión que hace útil al listado. Un promedio de milisegundos medido
durante un corte dice quién **esperó**, no quién estaba lento — bajo saturación
todo tarda, así que el ranking se llena de víctimas. Los bloques son el TRABAJO
que la consulta hace: el mismo número con el servidor vacío o saturado.

Lo vigila la **sección F de `npm run gate:perf`** contra
`scripts/bloques-por-llamada.json`: una función que lee **≥195 MB por llamada** y
no está declarada **falla el gate**, y una declarada que crece por encima de su
techo, también. `deuda: true` significa *declarado pero no auditado* — protege
contra que crezca, no promete que esté bien.

Existe porque **ninguna de las otras cinco secciones podía ver esto**, y la
ceguera es estructural: la sección C mira la forma del plan, pero `EXPLAIN` de
una llamada a función devuelve un `Function Scan` y nada más; la sección B tapa
ese hueco vigilando el código de funciones concretas, escritas a mano, o sea
sólo lo que alguien ya sufrió. La función culpable era **del día anterior**.
Y la sección D ya vigilaba el TIEMPO de `get_faltantes_con_stock_en_otra_sala`
—159 ms contra un techo de 400— sin ver que lee **467 MB cada vez**.

### El instrumento se ensuciaba a sí mismo

Vale escribirlo porque volvió a pasar acá: la primera versión del listado
acusaba a `get_faltantes_con_stock_en_otra_sala` de **2,720 MB por llamada**
cuando su caller real lee **467**. La diferencia era que un bloque `DO $$` que
llama siete veces cuenta como UNA statement en `pg_stat_statements` — y los
bloques `DO $$` eran **las mediciones propias**, la sección D de este mismo gate
incluida, que llama cinco veces adentro de un solo statement.

O sea: **la herramienta que mide ensuciaba lo que medía y después culpaba a
otro.** Hoy el SQL excluye `DO`/`EXPLAIN`/`VACUUM`/`ANALYZE`/`CREATE`. Si un
número parece absurdo, sospechar del instrumento antes que de la función.

### Si vuelve a pasar

1. `npm run portal:lento`.
2. Si hay una consulta viva de más de 3 s, **es ésa** — la más vieja.
3. Si no, mirar el listado por bloques y cruzarlo con **cuántas veces corre**.
4. Sobre la candidata: `EXPLAIN (ANALYZE, TIMING OFF, BUFFERS)`, y buscar el
   nodo donde `rows` estimadas y `actual rows` se separan. Ahí está — casi nunca
   en el SQL. Con `TIMING OFF` a propósito: la instrumentación del reloj inventó
   1,146 ms sobre un trabajo de 31 en un nested loop de 3,655 vueltas.
5. Corregir, y **borrar sólo su estadística** para verificar sin esperar a que el
   promedio viejo se diluya:
   `SELECT extensions.pg_stat_statements_reset(userid, dbid, queryid) FROM extensions.pg_stat_statements WHERE query LIKE '%<funcion>%';`
6. Para parar la sangre YA, sin haber entendido todavía:
   `UPDATE cron.job SET active = false WHERE jobname = '<el cron>';` — reversible;
   un portal caído en horario de sala, no.

**Un reinicio de Postgres es CONSECUENCIA, no causa.** El del 01-sep fue a las
16:41, seis minutos después de que empezara la saturación. Buscarle explicación
propia es perder el rato.