# Una solicitud, varios productos y varias salas — 2026-08-20

Hoy pedirle producto a otra sala es **un producto a una sala**. Quien necesita
tres cosas de Salud 1 abre el modal tres veces; quien necesita la misma caja y
no sabe quién la tiene, la pide a cuatro salas de a una.

Eso no es una molestia teórica. Medido sobre las 215 solicitudes de traslado que
existen (11 al 20 de agosto):

| lo que se midió | número |
|---|---|
| solicitudes en total | **215** |
| tandas —mismo día, mismo par de salas— | 66 |
| tandas que fueron de **más de un producto** | **33 (la mitad)** |
| productos por tanda cuando fue más de uno | 5.52 en promedio |
| el récord: productos a **una sola** sala en un día | **24** |
| veces que el mismo producto se pidió a **varias** salas el mismo día | 15 |
| el récord: salas para un mismo producto | **5** |

O sea que la mitad de las veces que alguien le pide a una sala, le pide más de
una cosa — y lo tiene que hacer de a uno. Las 215 solicitudes de hoy serían ~66
composiciones.

---

## 1 · La forma: una composición, N solicitudes

Se compone **una** solicitud en pantalla —varios productos, cada uno con su sala
y su cantidad— y al enviar se parte en **una solicitud por sala de origen** (y
por estante: Bodega tiene dos). Cada sala ve y contesta **sólo lo suyo**. Quien
pidió las ve agrupadas por un `grupo_id` que viaja en el `metadata`.

```
Salud 4 compone:                    se envían:
  Eutirox 100  ×3  ← Salud 1          Sol. A → Salud 1: Eutirox ×3, Amoxi ×2
  Amoxi 500    ×2  ← Salud 1          Sol. B → Salud 2: Eutirox ×5
  Eutirox 100  ×5  ← Salud 2          Sol. C → Salud 3: Eutirox ×2
  Eutirox 100  ×2  ← Salud 3          (las tres con el mismo grupo_id)
```

**Por qué N filas y no una con varios orígenes.** Todo lo que hay debajo está
clavado a UN origen: el RLS que decide quién la ve, la cascada del aprobador, el
aviso, la sala de respaldo que cubre a la cerrada, el documento de traslado del
sistema —uno por origen, con su número de vale— y el índice de duplicados. Una
fila con tres orígenes obliga a reescribir las cinco cosas y, peor, haría que
Salud 2 vea adentro de su solicitud los renglones de Salud 3.

**Y la buena noticia: varios productos POR sala ya está construido abajo.** El
despachador (`aplicar-traslado-inventario`) ya recorre `lineas` y su propio
comentario habla de «un traslado de cinco productos». Lo que es de un solo
producto es la pantalla, el cálculo de disponibilidad (mira `items->0`) y el
índice de duplicados (también `items->0`).

## 2 · Despachar de menos

Te piden 3, tenés 2 porque vendiste una. Hoy no se puede: la tarjeta compara
contra lo pedido entero y te empuja al rechazo.

La solicitud **sigue diciendo 3**. Es la firma de quien pidió; si la pantalla se
la baja a 2, mañana nadie sabe que faltó una. Lo que se agrega es un dato aparte
por renglón —«salieron 2», con motivo— igual que `pedido_items.cantidad_enviada`
en los pedidos a Bodega (*«se daba por hecho que salía lo asignado, y no es
cierto»*).

Tres reglas copiadas de la familia de ajustes, donde ya están escritas:

1. **Sólo hacia abajo.** Aprobar más de lo que pidieron es otra solicitud, sin
   el motivo ni la firma de quien la habría pedido.
2. **Motivo obligatorio** cuando no sale todo.
3. **El tope lo pone el servidor.** La pantalla también lo topa, pero la
   pantalla es una sugerencia.

**El faltante se cierra y sugiere dónde.** Esa solicitud termina, y el aviso
dice «faltó 1 — la tiene Salud 3 (12)». El cálculo de qué sala tiene ya existe
para los rechazos; se reusa.

## 3 · Recibir

**Por sala**, que además es lo único posible: cada envío es un documento aparte
en el sistema y se recibe en la sesión de esa sucursal. Sale gratis con la
división.

**Y un botón de confirmar todo** cuando ya contestaron todas, con dos
condiciones:

1. **Muestra qué está confirmando** —sala, producto, cantidad, lote— y recién
   ahí se confirma de una. Un botón que acepta tres cajas sin que hayas visto
   ninguna es el problema del motivo de rechazo que venía elegido de fábrica: 6
   de 8 rechazos decían el primero de la lista porque nadie lo eligió. Recibir es
   decir «esto llegó y lo conté».
2. **Va de una en una por dentro.** Cada recepción es un viaje al sistema con su
   propia sesión; las tres juntas en un solo viaje no entran en el tiempo que
   tiene. Se aprieta una vez y se ve el avance; si una falla, las otras ya
   quedaron y se reintenta sólo ésa.

## 4 · El techo, y por qué todavía no se sabe

El despacho corta a los 110 s (`PRESUPUESTO_MS`) y hoy contesta «se verificaron
X de N productos, dividí la solicitud». Con un renglón por solicitud eso nunca
se tocó; con 24 sí puede.

Medido sobre las 196 llamadas a `aplicar-traslado-inventario` de las últimas 24
horas —la mitad son el preflight de CORS, que contesta en milisegundos—, el
trabajo real de **un renglón** (despachar o recibir) está entre **1 y 8
segundos**, con una cola de 18.9 s. Lo que **no** se puede deducir de ahí es el
costo MARGINAL de cada renglón extra, porque no existe todavía ni una solicitud
de más de uno.

Entonces: el despacho anota cuánto tardó cada renglón, y el tope de la pantalla
sale de esa medición en vez de un número inventado. Arranca conservador.

---

## 5 · Orden de trabajo

1. **Base** — disponibilidad por renglón (hoy `items->0`) y el freno de
   duplicados por renglón. *(La base antes que la pantalla.)*
2. **Despachador** — aceptar cantidades ajustadas (bajar, nunca subir), anotar
   `enviado` por renglón y el tiempo de cada uno.
3. **Decisión** — la tarjeta de quien despacha: renglones, bajar cantidad,
   motivo obligatorio.
4. **Composición** — el modal multi-renglón y multi-sala, y la división al
   enviar.
5. **Agrupado** — la vista de quien pidió: las hermanas juntas, recibir por sala
   y confirmar todo.
6. **Avisos** — uno por sala que contesta, con la sugerencia de dónde está lo
   que faltó.
