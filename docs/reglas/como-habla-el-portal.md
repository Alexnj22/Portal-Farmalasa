# Cómo habla el portal

Lo definió el usuario el 2026-11-16. Vale para todo texto que ve una persona:
web, app, mensajes de error de las funciones, avisos, papel y archivos
exportados. Los comentarios del código y los nombres de variables o columnas
**no** cambian.

## Tono

- **Tú**: «Revisa», «Escribe el motivo». Nunca voseo («revisá», «tenés») ni usted.
- **Frases cortas y directas.** Una idea por frase. Sin rayas «—», sin
  «no es X: es Y», sin explicar por qué existe la regla.
- «aquí», nunca «acá».
- Si todo está bien, no se dice nada.

| Antes | Ahora |
|---|---|
| No se pidió el documento — anótala antes de cerrar, no se puede volver a ver. | Anota el documento antes de cerrar. Después ya no se puede ver. |
| Aprobarlo saca este monto de la caja: el cajón deja de esperarlo. | Si lo apruebas, este monto sale de la caja del día. |

## Palabras

| Se dice | No se dice | Nota |
|---|---|---|
| **caja** | cajón, gaveta | El dinero físico también es «la caja». |
| **sucursal** | sala, farmacia | «Sucursal Salud 2». |
| **existencia** | stock, inventario (como cantidad) | «Hay 12 en existencia». |
| **producto** | renglón, línea, ítem | «Dejaste 2 productos fuera». |
| **voucher** / **boleta** / **comprobante** | — | Según el papel: voucher = terminal POS; boleta = depósito o remesa; comprobante = sólo cuando es genérico. |
| **factura** / **crédito fiscal** | DTE, documento | «Crédito fiscal» cuando lo es; si no, «factura». |
| **datos** (del cliente, del producto) | ficha, expediente | «Los datos del cliente». |
| **corte** / **cierre del día** | Z, Corte Z, corte X | Corte = el de turno; cierre del día = el final. |
| **traslado** | envío | «Traslado a Salud 2». |
| **descarte** | baja (de producto) | «Baja» queda sólo para empleados. |
| **Ministerio de Hacienda** o **MH** | Hacienda a secas | |
| **Mín/Máx** | MinMax, Min/Max, MIN·MAX, Mín·Máx | |
| **cargo** | puesto | «Cargo: Regente». |
| **el cargo**: jefe de sucursal, subjefe de sucursal, supervisor, Talento Humano | jefe inmediato, jefatura, supervisión | «Jefe inmediato» cambia según quien lee (para un dependiente es el jefe de sucursal; para el jefe, el supervisor). Antes de nombrar a quien recibe un aviso o hace algo, mirar en el código o la base quién es de verdad. |
| **Soporte** | Sistemas, Informática | «Si sigue igual, avisa a Soporte». |
| **un supervisor o administrador** | supervisión, el supervisor (a secas) | Cuando quien decide es supervisión o administración (rol SUPERVISOR/ADMIN/SUPERADMIN en la base): diferencias de pedido, traslados que no aparecen. |
| **motorista** | conductor, chofer | |
| **Traslado a otra sucursal** | envío a otra sala, traslado sin solicitud | El que una sucursal manda sin que se lo pidan. |

Y la regla que ya existía (CLAUDE.md): nunca nombrar el ERP ni la jerga de la
tubería («sincronizar», «sync»).

## Cuidado al cambiar una palabra

- **Un rótulo puede ser el dato** (CLAUDE.md, «un rótulo no es una clave»): si
  `value === label` o el texto vive en una función de Postgres, cambiarlo
  exige migración. Antes de reemplazar, mirar si alguien compara contra ese
  texto (pruebas, `find`, `===`).
- Los nombres de cargos y módulos que vienen de la base se cambian en la base,
  no en la pantalla.

## Cómo se aplica

- Todo texto nuevo o tocado sigue esta tabla.
- Lo viejo se corrige **por módulos**, en tandas que el usuario revisa.
- Una palabra nueva que no esté aquí: preguntarle al usuario y agregarla a la
  tabla en el mismo commit.
