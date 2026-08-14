# La recepción de La Popular — 14 de agosto de 2026

Qué pasó, cómo se diagnosticó y qué quedó cambiado. Escrito el mismo día,
mientras se recibía el pedido **#114** (`07-140826-1-PO`, 6 cajas + 5 cajas
especiales de Electrolit).

---

## 1. Lo que se reportó

> «Estoy recibiendo el pedido en La Popular, Dolores lo está haciendo, pero no
> le aparece entregado; si le da confirmar cajas, no se guarda.»

Dos síntomas. Resultaron ser **una sola casilla de permiso**, más una segunda
del módulo vecino. Y al seguir recibiendo apareció un tercer defecto, sin
relación con los permisos, en las cajas especiales.

---

## 2. La causa

Ese mismo día, entre las **12:43 y las 12:46**, el permiso `Pedidos → Gestionar`
del cargo **Jefe/a de Sala** se prendió y apagó cuatro veces desde el panel de
permisos, y quedó **apagado**. Está en la bitácora:

| hora (SV) | permiso | valor |
|---|---|---|
| 12:43:29 | `pedidos` · ver | ✅ |
| 12:43:33 | `pedidos` · **gestionar** | ✅ |
| 12:45:39 | `pedidos` · **gestionar** | ❌ |
| 12:46:16 | `pedidos` · **gestionar** | ✅ |
| 12:46:29 | `pedidos` · **gestionar** | ❌ ← quedó así |

Los otros tres cargos de sala estaban igual, así que **ninguna sucursal podía
recibir**. Dolores tiene ese cargo.

### Por qué se vio como dos problemas distintos

El mismo permiso lo verifican tres capas, y **no se comportan igual**:

| capa | cómo verifica | qué se ve |
|---|---|---|
| Función de base con privilegio (`receive_pedido_sucursal`, `update_pedido_sucursal_lifecycle`) | `IF NOT auth_can_edit_any(...) THEN RAISE` | error rojo en pantalla |
| `UPDATE` con seguridad por fila (`pedido_sucursal_status`) | la regla no coincide | **cero filas, sin error** → éxito falso |
| `SELECT` con seguridad por fila (`ruta_pedidos`) | `pedidos_tab_rutas → ver`, apagado desde el 10-ago | la fila no llega → el hito «Entregado» nunca enciende |

De ahí los dos síntomas. El «no se guarda» era la primera capa gritando; el «no
aparece entregado» era la tercera callando.

### La prueba en la base

Pedido #114, antes de corregir: `llegada_fisica_at` vacío, `cajas_recibidas`
`[]`, ningún renglón con receptor — contra una pantalla que ya había dado la
llegada por confirmada, había escrito en la bitácora y le había avisado a
bodega. La entrega del conductor sí estaba registrada (Fernando Oliva, 14:53).

> **Ojo con un dato que confunde:** los renglones que un pedido tiene en estado
> «recibido» **al instante de crearse**, sin receptor, no son una recepción —
> nacen así. En las 35,668 filas históricas el receptor es nulo en todas, así
> que esa columna no sirve para saber quién recibió lo viejo.

---

## 3. Qué se hizo

### Permisos (aplicado en la base, con su registro en la bitácora)

| cargo | Pedidos → Gestionar | Rutas de entrega → Ver | alcance rutas |
|---|---|---|---|
| Jefe/a de Sala | ✅ | ✅ | sólo su sala |
| Subjefe/a de Sala | ✅ | ✅ | sólo su sala |
| Regente de Enfermería | ✅ | ✅ | sólo su sala |
| Dependiente de Farmacia | ✅ | ✅ | sólo su sala |

El alcance de Pedidos ya era «su sucursal», así que ninguna sala gana acceso a
los pedidos de otra ni a las acciones de bodega. La llegada del #114 quedó
registrada a las **15:16**, cinco minutos después.

### Código — v2.605.7: que el silencio duela

1. **Las escrituras de la recepción piden el `RETURNING`** y tratan «cero filas»
   como el fallo que es. Es la misma red que las rutas estrenaron en v2.605.2;
   lo que faltaba era llevarla al camino de al lado, así que el mecanismo quedó
   compartido en vez de duplicado.
2. **Siete escrituras que se hacían a ciegas ahora miran el resultado**: la
   llegada, el paso 2, el reenvío, la llegada del reenvío, el reporte de
   diferencias, el cierre de bodega y la confirmación de la sala. Ninguna firma
   la bitácora ni manda avisos si no pasó nada, y todas lo dicen en pantalla.
3. **Los botones de recepción no se pintan sin permiso**, gateados por el mismo
   permiso que exige el servidor. Los avisos de estado se quedan —ver qué pasó
   con el pedido sí se puede— con una píldora de sólo lectura.
4. **`npm run gate:data` estrena la categoría `escritura-a-ciegas`**: `await
   supabase…` sin recoger el resultado. El detector viejo sólo veía
   `const { data } = await supabase…`, o sea a quien al menos pidió el dato; era
   ciego justo a la forma que causó esto.

### Código — v2.606.1: la caja especial abre su caja

Recibiendo el mismo pedido, al entrar a «E3 — Caja especial (ELECTROLIT FRESA
625ML)» la pantalla listaba **LECHE NAN 2 OPTIPRO, LECHE NAN AR y LECHE NIDO 1**
—los productos de las cajas normales— y el botón ofrecía «Confirmar Caja
**null**».

La pantalla preguntaba «¿qué hay abierto?» en cuatro sitios y tres la
contestaban mirando sólo el número de caja, que adentro de una caja especial
vale nulo. Los tres caían en «el pedido entero»:

- **La grilla** pintaba todos los productos del despacho. Quien recibe contaba
  esos tres y al confirmar sólo se guardaba el Electrolit: lo contado y lo
  guardado no eran lo mismo.
- **«Todo OK» daba por recibido el pedido COMPLETO** desde adentro de una caja
  de Electrolit, y cerraba la recepción como terminada. El más grave de los
  tres, y el único sin señal en pantalla.
- **El rótulo del botón** interpolaba el nulo. Esa fue la única pista visible.

Ahora la pregunta se contesta una sola vez, en `alcanceDeRecepcion`
(`src/utils/cajasEspeciales.js`), pura y con pruebas ancladas a este caso. Y los
cierres de «Confirmar» y «Todo OK», que estaban duplicados y ya habían divergido
—la copia de «Todo OK» tampoco esperaba a las especiales antes de dar el pedido
por terminado—, quedan en una sola copia.

---

## 4. Lo que queda abierto

- **26 escrituras a ciegas en las funciones de servidor.** Todas son inserts de
  bitácora de los crons. Están anotadas en el baseline del gate, con el motivo
  escrito en el encabezado: bajarlas obliga a redesplegar nueve funciones, con
  la trampa de `--no-verify-jwt` que describe `CLAUDE.md`. En `src/` la
  categoría quedó en **cero y bloqueante**.
- **El panel de permisos no avisa qué se rompe al apagar una casilla.** Apagar
  «Gestionar» en Pedidos deja a las cuatro salas sin poder recibir, y eso no se
  ve desde el panel. No se abordó.

---

## 5. Las tres lecciones

1. **Un permiso que falta no da un síntoma: da uno por capa que lo verifica, y
   las capas no se comportan igual.** Ante «me falla X y además no veo Y» en un
   módulo con permisos por cargo, empezar por la tabla de permisos del cargo de
   esa persona —una sola consulta explica los dos— y no por el código de X.
2. **Una red de seguridad escrita para un camino no cubre al de al lado.** La
   protección contra el «no pasó nada» existía desde v2.605.2, a un archivo de
   distancia, y nadie la llevó a la recepción. Cuando se arregle un silencio de
   este tipo, buscar a los hermanos el mismo día.
3. **La misma pregunta contestada en cuatro lugares se contesta distinto en
   tres.** No es hipotético: pasó con «¿qué hay abierto?» y las tres respuestas
   malas convivieron sin que ninguna prueba las viera. Si una pregunta gobierna
   qué se guarda, tiene que ser una función, y tener una prueba.
