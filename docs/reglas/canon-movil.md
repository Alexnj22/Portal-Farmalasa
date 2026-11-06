# El teléfono no es la pantalla chica (canon móvil)

> Movido desde `CLAUDE.md` el 2026-11-06 sin cambiar el contenido. Allá queda la tabla de props de `DataTable` y el puntero a DESIGN.md §32; acá, el detalle, las mediciones y la historia. Las cifras de este archivo son de la fecha en que se escribieron: la verdad vigente vive en el archivo o la tabla que cada párrafo nombra.

## REGLA CRÍTICA: el teléfono no es la pantalla chica (canon móvil, 2026-08-21)

Nació de un reporte de una línea —*«en facturas de compra cuando abro una card me
da información, pero muy reducida, no puedo ver los productos, no puedo ver el
pdf»*— que resultó ser **16 de las 59 tablas del portal, el 27%**. El canon
completo vive en **DESIGN.md §32.8 y §32.9**; el plan y lo que queda abierto, en
`docs/planes-cerrados/PLAN-MOVIL-2026-08-20.md`. Acá va lo que hay que saber ANTES de tocar una
vista.

**El modo de falla es el SILENCIO.** No hay error, no falta ninguna fila, y en
escritorio todo funciona. Por eso estos defectos viven meses: sólo se ven con el
teléfono en la mano, y el que lo tiene en la mano no reporta «el `onClick` no se
declaró», reporta «no me deja ver nada».

### Lo que `DataTable` no puede adivinar, y por eso lo declara la vista

En el teléfono `DataTable` **no pinta una tabla: pinta fichas**. Desde afuera un
`onClick` es una caja cerrada —no se sabe si navega o si expande un `<tr>`—, así
que el default es su hoja genérica y la vista declara el resto:

| prop | cuándo |
|---|---|
| `usarAccionDeFila: true` | la fila tiene un destino de verdad (un modal, una navegación). **Sin esto la hoja genérica le GANA al destino real.** |
| `apilada: true` | la primera celda no es un nombre sino un BLOQUE escrito para una columna. Medido en Mín·Máx: 105px recortados por ficha; en el libro de compras, 161px. |
| `acciones: 'mantener'` | la fila tiene acciones. Van detrás de mantener presionado (§32.7), no en una tira. |
| `acciones: true` | igual, pero como tira visible. Sólo con una o dos acciones. |
| `movil={false}` | **la fila no es un registro** (una matriz, un calendario). Exige motivo escrito arriba. |

**Un detalle que se olvida y rompe:** si el `onClick` expande un `<tr colSpan>`,
declarar `usarAccionDeFila` no alcanza — ese `<tr>` no se pinta en modo ficha. El
destino ahí es **`ExpedienteMovil`**, con el cuerpo del detalle escrito UNA vez
(prop `comoPanel`) y la expansión de escritorio apagada con `!enTelefono`. El
corte del teléfono sale de `useExpedienteMovil` y **nunca de un `useMediaQuery`
propio**: si divergen, hay un ancho donde la fila es ficha y el detalle intenta
expandirse dentro de una tabla que ya no está.

Y una celda de acciones **cambia de forma sola**: `useEnHojaDeAcciones()`
(`components/common/hojaDeAcciones.js`) le dice que está en la hoja, y ahí un
`Button` con `iconOnly` recupera su rótulo desde `title`. Se resolvió con
contexto y no con una prop porque una prop obligaría a rendir la celda dos veces.

### Las otras cuatro reglas del teléfono

1. **El blanco de dedo son 44pt.** `min-h-[var(--tap-min)]` / `min-w-[...]`, que
   vale **0 en escritorio** y no cambia nada ahí. Cuando el tamaño **ES el
   dato** —una barra apilada, donde el ancho codifica la proporción— estirarlo
   sería mentir: se declara `data-medida="dato"` y el barrido lo saltea.
2. **El toque tiene que ACUSAR recibo.** No hay cursor ni hover: el acuse es la
   única señal de que entró. Vale `active:scale-[0.97]` o `data-interactive`,
   que ya pone `clickable()`.
3. **Las áreas seguras van por `--sa-top/right/bottom/left`**, nunca `env()`
   escrito a mano. Con el token, una prueba puede pisarlo y **medir** si el
   marco se corre; con `env()` a mano no hay forma de distinguir el shell que
   respeta el notch del que lo ignora, porque en todo emulador vale 0. `max()`
   sólo si el inset es el ÚNICO relleno.
4. **Un formulario largo guarda borrador** — ver `gate:borradores` en
   Estándares. Y si lo que se puede perder vive en un store, **el store es el
   que tiene que persistir**: componer un traslado a tres salas se perdía entero
   porque el store era memoria pura y la sesión se cierra sola a los 5 minutos.

### Cómo se verifica, y por qué son TRES capas

- **`npm run gate:movil`** — lee el fuente. Bloqueante en cero.
- **`tests/e2e/barrido-total-movil.spec.js`** — 54 rutas en WebKit iPhone 13.
  `ORIENTACION=acostado` para la otra mitad. Correr **por tandas**.
- **`tests/e2e/dialogos-movil.spec.js`** — abre los diálogos y los mide. Corre
  contra producción, así que tiene lista de freno: **abrir no puede escribir**.

Las tres, porque **ninguna ve lo que ve la otra**. El gate lee el fuente, y una
fila envuelta en `memo(EmployeeRow)` es una caja cerrada: quitándole
`usarAccionDeFila` a Personal el gate da **verde con 0 hallazgos** y el barrido
dice **25**. Eso lo cierra `data-destino`, que `Ficha` estampa en el DOM porque
en tiempo de render sí sabe la respuesta.

### La lección que se repitió SEIS veces, y es la más cara

> **En esta tanda, seis de los hallazgos no estaban en el portal sino en cómo se
> leía la medición.**

El informe parcial se llamaba igual que uno completo. El detector de acuse
acusaba a 36 tarjetas que hacían lo correcto y tapaba al único botón mudo. La
regla de tamaño contaba hijos `absolute` como hermanos del flex. El resumen no
contaba tres dimensiones que sí medía. El detector de desborde miraba la caja
propia y no el borde visible. Y el barrido de diálogos reportaba «no abrió» sobre
botones que nunca apretó.

**Antes de creerle un cero a un instrumento, fabricarle la regresión que debería
cazar.** Y antes de creerle un número grande, abrir tres casos a mano: acusar al
que hizo bien el trabajo es cómo un gate se termina desactivando.