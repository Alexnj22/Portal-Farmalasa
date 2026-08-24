# Personal y expediente — qué se puede leer de una persona, y qué no

**Escrito el 2026-08-24**, durante la auditoría completa del portal. Era una de
las once áreas sin documento propio.

Acá el riesgo no es un número mal calculado: es **un dato de una persona que
alguien puede leer y no debería**. Dos veces se descubrió que una vista publicaba
más de lo que su pantalla mostraba, y las dos veces el defecto era invisible
—nadie recibe un error por poder leer de más—.

---

## 1. `employees` no se lee directo: se lee `employees_safe`

La tabla tiene columnas que no son de todos. La vista `employees_safe` es la
puerta, y **lo que salió de ahí salió por una razón medida**:

### El código de carné ES la contraseña del portal

`login()` hace `signInWithPassword(password: code)`. Publicar `code` y
`kiosk_pin` en la vista significaba que **cualquier empleado con sesión podía
leer el de todos —medido: 47 de 47— y entrar como cualquiera.**

Hoy van por `get_employee_credenciales(p_ids)`, detrás de la misma compuerta que
gobierna editar un empleado (`staff_list.can_edit`). **Ver un código es una
llamada explícita, no un efecto de traer la fila.**

### El sueldo, el banco y la cuenta

Mismo caso: `employees_safe` los publicaba a cualquiera que pudiera leer la
vista, y el módulo `staff_salary` —que la pantalla de Permisos deja prender y
apagar— **no gateaba nada**. Era una llave sin cerradura.

**Sin la llave el RPC devuelve VACÍO, no error.** Es deliberado: quien no puede
ver salarios abre el expediente igual y ve un guión donde va el monto. Lanzar
convertiría «no te toca» en «se rompió», que es peor — y además le dice al
navegador que ahí hay algo.

### La consecuencia práctica: `RETURNING` enumera columnas

Un `.select()` sin argumentos pide `*`, y desde que `code` dejó de ser legible el
servidor responde *«permission denied for column code»*: **guardar un empleado
fallaría entero**. Por eso `DEVUELVE` lista los campos que el llamador usa
después, y **no puede volver a ser `*`**.

---

## 2. El padrón viene recortado, y eso tiene un efecto colateral

Quien no tiene «ver» en Personal recibe el padrón **acotado a su sucursal**
(`scopeToMyBranch`). Está bien: una sala no navega los expedientes de las demás.

Pero entonces **quien preparó tu pedido en bodega no existe en tu mapa de
empleados**, y la línea de tiempo pintaba la hora con el nombre y la cara en
blanco — no por falta de permiso, sino porque nadie los trajo.

`fetchEmployeesPublicByIds` resuelve exactamente eso y nada más: **sólo las
personas que ya aparecen nombradas en registros que el usuario tiene delante, y
sólo su identidad pública** (nombre y foto). No es el padrón: es resolver un `id`
que la pantalla ya está mostrando.

---

## 3. Las fotos son privadas

`photo_url` es la URL cruda; `photo` es la **firmada**, y se genera al arrancar
o al iniciar sesión. **En la base siempre se guarda la URL formato-público como
identificador, nunca una URL firmada** — expira.

Todo select directo de `photo_url` tiene que pasar por `signPhotosDeep()`. Si no,
la foto sale rota y nadie sabe por qué.

---

## 4. Los documentos del expediente vencen, y eso es normativo

`employee_documents` es un `jsonb` por empleado. **RTS 11.02.04:24 §6.3.1 exige
acreditación vigente para TODO el personal**, no sólo Regente o Enfermería, así
que el aviso aplica a cualquier categoría con `expiry_date`.

| umbral | qué muestra |
|---|---|
| ya vencido | «Vencido», en rojo |
| ≤ 30 días | «Vence en N días», en rojo |
| ≤ 60 días | «Vence pronto», en amarillo |

`check-employee-doc-expiry-daily` lo avisa sin esperar a que alguien abra la
pantalla.

**El cálculo vive en un solo lugar** (`utils/documentExpiry.js`) y devuelve la
**variante** del `Badge`, no un puñado de clases. Antes devolvía `className` con
la paleta escrita a mano y los dos llamadores la pegaban dentro de un `<span>`
propio: dos chips a mano del mismo estado, con dos formas distintas.

⚠️ `daysUntilExpiry` usa `Math.ceil`, que para hoy devuelve **`-0`**. Es el
comportamiento real y está anclado como tal en las pruebas; no forzarlo a `0` sin
mirar quién compara contra él.

---

## 5. Los eventos programados

`employee_events` guarda lo que va a pasar (vacaciones, incapacidad, permiso) y
`apply-scheduled-employee-events-daily` lo aplica el día que toca. Esa misma
tabla es la que consulta el enrutador de aprobadores —pero **preguntando**, no
leyéndola: ver `docs/SOLICITUDES-QUIEN-DECIDE-Y-QUIEN-LO-VE-2026-08-24.md`.

`employee_events` es **historial: append-only**, sin policy de DELETE.

---

## 6. Los dependientes económicos

`economic_dependents` (`jsonb`) admite dos modos: fecha de nacimiento exacta, o
**edad a mano** cuando la familia no la sabe. La definición de «está en modo edad
manual» y de «esa edad es válida» vive en `utils/economicDependents.js`
**compartida entre la pantalla y el store**, para que la validación del formulario
y la normalización al guardar no puedan divergir.

Rango aceptado: 0 a 120, entero. Un decimal, un negativo o un vacío **bloquean
Guardar** en vez de guardarse como `null`.

---

## 7. Antes de tocar algo en Personal

1. **Nunca `select('*')` sobre `employees`.** Enumerar columnas.
2. **Antes de agregar una columna a `employees_safe`, preguntarse quién la va a
   poder leer.** La vista la publica a todo el que pueda leerla, no sólo a la
   pantalla que la pidió.
3. **Un dato sensible va detrás de un RPC con su módulo**, y sin permiso devuelve
   vacío, no error.
4. **Toda `photo_url` pasa por `signPhotosDeep()`.**
5. **Una regla de validación que existe en la pantalla y en el store se escribe
   una vez y se importa dos.**
6. **El código de carné no se muestra, no se registra en la bitácora y no viaja
   con la fila.**
