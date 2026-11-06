# Historia — la foto de una persona (§5.4)

Narrativa que antes vivía en `DESIGN.md` §5.4 (versión de 2026-08-26). La escala de entonces —≥48 aro + chip, 28–47 aro de 2,5 px, <28 aro de 2 px— fue reemplazada el 2026-11-05 por la escala fija `TAMANOS_DE_AVATAR` y el diseño «cuatro esquinas». Las reglas vigentes están en `DESIGN.md` §5.4.

### 5.4 `AvatarConEstado` — la foto de una persona dice si está (2026-08-26)

**La foto de una persona se pinta con `AvatarConEstado`. Nunca con
`LiquidAvatar` suelto, y nunca con un `<img>` a mano.** `LiquidAvatar` es la
primitiva —resuelve WEBP, el respaldo con iniciales y el reintento— y
`AvatarConEstado` es lo que se usa: le agrega el aro que dice si esa persona
está de vacaciones, incapacitada, con permiso, en apoyo o dada de baja.

Regla del usuario, dicha en una línea: *«todo lugar que muestre quién lo hizo
—nombre + apellido— debe llevar foto, y por lo tanto aro. O donde esté sólo la
foto por alguna razón, aro.»*

```jsx
<AvatarConEstado emp={emp} px={48} />
<AvatarConEstado emp={emp} px={20} radio="rounded-full" marco="" />
```

**`px` es un número y es obligatorio.** No es una clase de Tailwind, y esa no es
una preferencia de firma: el componente decide con él **la escalera**, y desde
`w-12 h-12` ese dato no se puede leer.

| tamaño | qué lleva | dice |
|---|---|---|
| ≥ 48 px | aro + chip con ícono | **qué** pasa |
| 28 – 47 px | aro solo (2,5 px) | **que** pasa algo |
| &lt; 28 px | aro de 2 px | igual — la palabra la pone el texto de al lado |

#### Por qué el aro y no otra cosa

El estado pasó por tres formas antes de ésta, y las dos primeras las levantó el
usuario mirando la pantalla:

1. **Una píldora debajo de los cargos** → *«no distingo que está de vacación»*.
   Quedaba cuarta en una pila de píldoras y la de arriba —«Faltan 2 datos»— era
   del mismo ámbar, tamaño y forma. **Un dato importante en el mismo envase que
   los demás queda escondido, por bien que esté redactado.**
2. **La foto en gris** → *«parece muerto»*. El gris es el vocabulario de «dado
   de baja», no el de «vuelve el martes».
3. **El aro**, elegido sobre halo, corona, arco inferior y foto teñida por una
   razón medible: **no se encoge como un ícono**. En el portal la foto va de
   20 px —firmas de bitácoras, chips de pedidos, la campana— a 160 px en la
   ficha del empleado. Un ícono de 20 px pasa a 7 y se vuelve una mancha; el
   aro sigue siendo un círculo entero de color y su grosor es **absoluto**.

El último escalón no es una concesión: **donde la foto es chica, el nombre está
escrito al lado**. Y el `title` lleva la frase completa —«En vacaciones · vuelve
el 2 de septiembre»— a cualquier tamaño, así que el dato nunca depende de
distinguir un color.

> ⚠️ **El aro va POR FUERA.** `ring-inset` se pinta encima del fondo del
> elemento pero **debajo de sus hijos**, y el hijo es una foto que ocupa el 100%
> de la caja: con `inset`, el aro existe en el DOM, tiene su color, pasa las
> pruebas —jsdom no compone capas— y es **invisible**. Lo vio el usuario antes
> que cualquier gate.

#### El componente acepta cualquier forma de persona

La misma gente llega con seis formas de objeto según de qué consulta salga:
`{name, photo}`, `{nombre, foto}`, `{empleado, persona_id}`,
`{created_by_name, created_by_photo}`, `{first_names, last_names}`,
`{nombre, photo_url}`. `normalizarPersona` (`utils/estadoDePersona.js`) las
acepta todas. **Lo único que importa de verdad es el `id`**: con él el estado se
resuelve contra el store aunque el objeto no traiga `history` —que es el caso
del sidebar, que pasa el objeto de la sesión—. Sin id no hay aro, y está bien:
no se puede afirmar el estado de alguien que no se sabe quién es.

`radio` y `marco` existen para el sidebar y el kiosco, que son superficies
**bespoke** (§25.4) con sus propios tokens de borde. Cuando hay estado, el aro
**reemplaza** al marco: dos bordes concéntricos leen como un defecto de render.

#### Lo vigila `foto-sin-aro`, en cero y bloqueante

Marca dos cosas: un `<LiquidAvatar>` fuera del canónico, y un `<img>` cuyo `src`
nombre la foto de alguien (`photo`, `photo_url`, `foto`, `avatar`,
`webpSignedUrl`). **Las dos, y ésa es la lección.** La primera versión miraba
sólo el componente y llegó a cero el mismo día; al preguntarse *«¿quedó
canónico? ¿completamente?»* la medición dio **25 fotos de persona pintadas con
un `<img>` a mano** que ninguna regla veía. Es `tarjeta-a-mano` otra vez —cero
en julio, 81 casos vivos— : **un detector que mira UNA de las formas del defecto
certifica la ausencia de esa forma, no la del defecto.**

No marca la foto de un comprobante, una etiqueta o una evidencia: ahí no hay
ninguna persona cuyo estado se pueda decir. La diferencia la da el nombre del
campo, no la palabra.

Las cuatro excepciones están en `EXCEPTIONS` con su motivo: `LiquidSelect` (su
`opt.avatar` puede no ser una persona), `EmployeeFormModal` (muestra un blob
local sin guardar), el kiosco (dimensiona con cuatro consultas de medio, no hay
un `px`) y la encuesta (ya usa el aro para decir «es jefe»).

#### El estado NO sale del store — y ésa fue la segunda mitad

Resolverlo contra la lista de empleados del navegador parecía suficiente y era
un agujero: esa lista está **acotada**. Quien no tiene `staff_list.can_view`
recibe sólo los de su sucursal, y `employee_events` exige además `staff_detail`
o `schedules` para leer los eventos de otro. Para el resto **el historial llega
vacío** — indistinguible de «esta persona no tiene ausencias»—, así que el aro
decía «está» sobre alguien de quien no sabía nada.

Hoy el estado sale de **`get_estados_de_personas(uuid[])`**, `SECURITY DEFINER`
justamente para no depender del RLS de quien pregunta, devolviendo el mínimo:
id, clave y hasta cuándo. Y en **dos niveles**, que no es un detalle: quien ya
podía leer los eventos recibe el motivo preciso; el resto recibe `AUSENTE` a
secas. Que el aro nunca calle no puede costar que toda la empresa se entere de
que alguien está de **incapacidad**.

**Cuarenta caras son una consulta.** `data/estadosDePersonas.js` junta los
pedidos de un render entero. Y no se pregunta nada cuando el navegador ya tiene
el historial completo. Medido: 4,5 ms para las 49 personas de la empresa.

> ⚠️ `leerEstado` y `pedirEstado` son **dos** funciones. El `getSnapshot` de
> `useSyncExternalStore` tiene que ser **puro**: juntas, React llamaba a la que
> pedía varias veces por render y se realimentaba con su propio aviso. El
> síntoma fue un proceso de pruebas muerto sin una línea que dijera dónde.

Para que eso funcione, **una consulta que muestra a una persona tiene que
devolver su `id`**, no sólo su nombre y su foto. Cuatro funciones resolvían el
nombre en SQL y se quedaban con el id adentro —`get_conteos`,
`get_conteo_items_search`, `get_conteo_item_history` y la de bolsas—: era
razonable cuando el avatar sólo necesitaba una imagen, y dejó de serlo el día
que tiene que decir algo **de** la persona. Ya lo devuelven las cuatro.
