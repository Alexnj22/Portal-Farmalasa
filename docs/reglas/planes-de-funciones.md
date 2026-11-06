# Una función con parámetros se mide seis veces

> Movido desde `CLAUDE.md` el 2026-11-06 sin cambiar el contenido. Allá queda la lista corta de chequeo; acá, el detalle, las mediciones y la historia. Las cifras de este archivo son de la fecha en que se escribieron: la verdad vigente vive en el archivo o la tabla que cada párrafo nombra.

**Una función con parámetros se mide SEIS veces, no una** (2026-08-17). Cuatro
trampas de planificación, ninguna visible leyendo el SQL — las tres primeras
midiendo `get_ventas_receta_stats`, la cuarta el 2026-08-25 después de que
tumbara el portal entero:

1. **`plpgsql` cambia al plan GENÉRICO en la sexta ejecución.** Las cinco
   primeras llamadas daban 24 ms y la sexta 1,089 ms, con los mismos argumentos.
   Sin los valores, el planificador no sabe que el rango de fechas filtra, y
   elige el plan al revés. Cuando el plan bueno depende de los ARGUMENTOS, no
   hay genérico que sirva: `ALTER FUNCTION … SET plan_cache_mode =
   'force_custom_plan'`. Cuesta ~3 ms de planificación. Una función que se
   probó una vez y anda "bien" puede estar degradada en producción desde la
   sexta llamada de cada conexión.
2. **`LANGUAGE sql` se INLINEA en quien la llama y aplana sus CTE —
   *si no tiene cláusula `SET`*.** Mismo cuerpo: 1,011 ms inlineado contra 34 ms
   con `PREPARE`. `plpgsql` no se inlinea nunca — por eso `get_ventas_con_puntos`
   y las gemelas de receta lo son. `EXECUTE` dinámico además replanifica siempre,
   así que tampoco sufre (1). **Esa condición del `SET` es la trampa 4.**
3. **Un `EXISTS` correlacionado fija la dirección del join.** `EXISTS (… WHERE
   ii.invoice_id = si.id …)` obliga a entrar por las 180,000 facturas del año;
   el mismo predicado como `si.id IN (SELECT ii.invoice_id …)` deja al
   planificador entrar por los 4,013 renglones. 8,471 ms → 31 ms.
4. **`LANGUAGE sql` CON `SET search_path` es la peor combinación posible, y es
   la que manda escribir la regla 4 de «Estructura BD» en CLAUDE.md.** El `SET` la vuelve
   opaca —no se inlinea, o sea que (2) no aplica— y además su cuerpo se
   planifica **una sola vez con los argumentos como `Params`**: nunca ve un
   valor. No es que caiga al plan genérico en la sexta llamada como (1): **nace
   genérica y no hay plan personalizado que pedir.**

   Medido en `get_conteo_products_count` el 2026-08-25, intercalado bajo la
   misma carga: **2,606 ms contra 56 ms** del mismo cuerpo con literales. El
   planificador estimaba un CTE en ~1 fila y elegía *nested loops sobre CTE
   scans* — ~21 millones de comparaciones donde el plan bueno hace dos hash
   joins.

   Dos cosas que **parecen** la corrección y NO lo son, las dos medidas:
   - **`MATERIALIZED` como cerca no alcanza.** Esa función ya tenía CINCO CTE
     materializados. La cerca fija el orden de join *a través* de ella; no le
     arregla la estimación de filas al CTE.
   - **`plan_cache_mode = 'force_custom_plan'` a secas no hace nada** (2,025 vs
     1,969 ms). Sin caché de planes, el modo no tiene sobre qué actuar.

   **La corrección es pasarla a `plpgsql`** —que sí entra al caché— y *ahí* sí
   `SET plan_cache_mode TO 'force_custom_plan'`. El cuerpo no se toca.

   **El tell que ahorra el diagnóstico:** lenta **desde la primera llamada** de
   toda sesión = es `LANGUAGE sql`, nunca tuvo plan personalizado. Lenta **desde
   la sexta** = es (1).

   Y el daño no se queda en su pantalla: una lectura de 2.6 s ocupa una ranura
   del pool de PostgREST 46× más tiempo, así que **dos personas paginando lo
   llenan** y todo el portal empieza a devolver 504 *Timed out acquiring
   connection from connection pool* — que nombra conexiones y manda a mirar
   donde no está el problema. Ver
   [[feedback_una_consulta_lenta_de_lectura_tumba_el_portal_entero]].

   **La auditoría de las restantes está CERRADA**
   (`docs/planes-cerrados/PLAN-PLANES-GENERICOS-2026-08-25.md`): **40 funciones medidas, 40
   sanas, 0 migraciones**. `get_conteo_products_count` era la única de las 69, y
   eso enseñó la condición que faltaba: no basta con ser `LANGUAGE sql` + `SET`,
   **hace falta ADEMÁS que el plan bueno dependa de los argumentos**. Si no
   depende, el genérico es tan bueno como el personalizado — y forzarlo sólo
   agrega el costo de replanificar (+0.54 ms por llamada), o sea una
   **regresión** en una función barata y frecuente. Medido: a
   `get_ccf_con_problema` la deja **6.6× más lenta**.

   Dos filtros de descarte inmediato, los dos medidos:
   - **Si sus únicos parámetros son un payload `json`/`jsonb`, NO puede tener
     este defecto**: `jsonb_array_elements` se estima en 100 filas con un
     literal de 3, uno de 5,000 o un parámetro. Descarta las diez de sync.
   - **Un promedio de `pg_stat_statements` medido sobre una ventana con
     saturación dice quién ESPERABA, no quién estaba LENTO.** De 19 «caras», al
     remedirlas fuera de la ventana sólo tres lo eran.

   Lo vigila la sección E de `npm run gate:perf` contra
   `scripts/planes-genericos.json`: **producción exponiendo una que no esté
   declarada FALLA el gate**, y el manifiesto que nombre una que ya no existe,
   también. Al escribir una función `LANGUAGE sql` con parámetros y CTEs, se
   declara ahí — con su medición, o con `ms: null` si es deuda.

Y **medir con `EXPLAIN (ANALYZE, TIMING OFF)`**: con el timing encendido, la
instrumentación de un nested loop de 3,655 vueltas inventó 1,146 ms sobre un
trabajo de 31. El número que se reporta tiene que ser el que no miente.