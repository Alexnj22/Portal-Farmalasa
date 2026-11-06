# Historia — §34 Voz

Narrativas que sostienen las reglas de `DESIGN.md` §34 (antes §26 «Voz»).

## Por qué existe la sección (F2 de PLAN-IDENTIDAD, 2026-07-29)

El doc tenía 3,370 líneas sobre la forma y ni una sobre la palabra. Medido en los
73 slots de copy del portal: cuatro gramáticas en el mismo hueco.

| Forma | Ejemplos que había |
|---|---|
| `Sin X` | `Sin resultados`, `Sin pagos confirmados` |
| `Sin X` con punto | `Sin facturas en el período.`, `Sin proveedores registrados todavía.` |
| `No hay X` | `No hay registros`, `No hay empleados en esta categoría` |
| `Aún no hay X` / `No se encontraron X` | `Aún no hay cotizaciones`, `No se encontraron productos` |

## Tuteo (2026-07-29)

El tuteo dominaba: 89 usos contra 22 de voseo. Unificar hacia el mayoritario
costó 22 strings. La primera versión de la regla de exclamaciones las prohibía a
secas, y al aplicarla quedó claro que el código tenía razón en violarla en tres
lugares (los momentos humanos).

## «Anaquel» (2026-08-25)

Decisión del usuario: *«no uses nunca anaquel, solo Vitrina / Estante»*.
`laboratorios` guarda `vitrina`, `estante` y `peldano` (más `bodega_numero` /
`bodega_peldano`), y el catálogo hace elegir entre «Vit.» y «Est.»: la pantalla
nombraba de una forma lo que la base nombraba de otra. Se limpiaron 51 usos de
una vez. El aviso del conteo cíclico decía «anotá lo que ves en el anaquel» y
vivía dentro de una función de Postgres: salió de auditar `pg_proc.prosrc`.

## «Acá» (2026-08-26)

Decisión del usuario: *«aca no se usa. es aqui.»* Salió de mirar el detalle de
una bolsa. El portal decía «acá» 40 veces y «aquí» 22 en texto de pantalla; se
barrieron las 40.

## Lo que el gate de voz no veía (2026-08-26)

1. `copy-vacio` sólo conocía una lista cerrada de arranques. «No salió nada de
   acá» pasaba. Antes de excluir los errores, `^No\s` a secas acusaba a 13 y
   once eran errores correctos.
2. Las reglas de vocabulario miraban el renglón entero: de los 7 primeros
   hallazgos de `copy-aqui`, los 7 eran comentarios pegados a código
   (`// …`, `/** … */` de una línea, `{/* … */}`).
3. La lista de voseo tenía agujeros: «Descargá la hoja o el CSV, aplicalo, y
   registralo acá» pasaba en verde, y un barrido de agudas encontró ocho más
   (`Actualizá`, `Completá`, `Contá`, `Dejá`, `Descargá`, `confirmá`, `tocá`,
   `pausás`). `copy-trato` llevaba meses en cero sin haber mirado.

`copy-aqui` se probó devolviendo un «acá» a `TrasladosView` y comprobando que
fallara.

## El estilo en una constante

Una constante `GLASS` con vidrio a mano estuvo en verde en tres pestañas de
Pedidos a la vez. `shadow-sm` sueltos (322 usos) no son deuda: la sombra no
tiene canónico como el vidrio.
