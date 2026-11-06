# MIN·MAX: ABC/XYZ son sólo clasificación

> Movido desde `CLAUDE.md` el 2026-11-06 sin cambiar el contenido. Allá queda la decisión en tres líneas; acá, el detalle, las mediciones y la historia. Las cifras de este archivo son de la fecha en que se escribieron: la verdad vigente vive en el archivo o la tabla que cada párrafo nombra.

## MIN·MAX: ABC/XYZ son SOLO clasificación (decisión, no bug)

Confirmado el 2026-07-29 (F4.3 de
`docs/planes-cerrados/PLAN-MINMAX-Y-CANDADO-2026-07-29.md`): en
`stock_config`, `reorder_x_days = reorder_y_days = reorder_z_days = 25`,
`buffer_x/y/z_days = 0`, y `lead_time_days` es NULL en las 18,364 filas de
`product_stock_params`. Entonces la fórmula real es, para **todo** producto:

```
MIN = floor(velocidad × 25)      MAX = ceil(velocidad × cycle_days)
```

ABC y XYZ **no intervienen en ningún número**. Es intencional: sirven para
filtrar, para el badge y para la matriz, nada más. **No cambiar la fórmula ni la
config** — si una auditoría futura lo levanta como bug, esto es la respuesta.

Dos consecuencias que conviene tener presentes:

1. Como el `reorder` es plano, cualquier cambio en `cycle_days` o en
   `reorder_*_days` reescribe el MIN/MAX de **todo el catálogo a la vez**. Es uno
   de los motivos por los que existe el candado de mantenimiento por módulo.
2. `xyz_x_cv_max` / `xyz_y_cv_max` (150/400) son restos muertos de la era
   pre-percentiles: hoy manda `xyz_x_percentile`/`xyz_y_percentile`. Ya no se
   editan desde `ConfigPanel` (verificado: no hay ni una referencia a `cv_max` en
   `src/`), así que no hay riesgo de que alguien toque un número que no hace nada.

Detalle del mismo cálculo, anotado para que no sorprenda: `velocity` usa unidades
**winsorizadas** al percentil `outlier_percentile`, pero `velocity_30d` usa las
crudas. Y desde F2.3 el denominador de `velocity` ya no es `analysis_days` fijo:
es `data_days`, o sea los días desde la **primera venta histórica** del producto
en esa sucursal (tope `analysis_days`, piso 30 días). Eso solo cambia algo para
los productos realmente nuevos — medido en Salud 1: 45 de 1,765.