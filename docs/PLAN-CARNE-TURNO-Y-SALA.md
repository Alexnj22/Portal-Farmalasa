# El carné, sólo dentro del turno y en su sala

**Estado: PROPUESTA ANALIZADA — no implementada.** Se aplica cuando los
prerrequisitos de §5 estén cumplidos. Escrito el 2026-08-11 a pedido del
usuario, después de que un carné legítimo fuera rechazado y de revisar por qué
el código de un carné se puede recrear.

---

## 1. La propuesta

Tal como se planteó:

1. Que se pueda entrar con el carné **sólo si la persona está de turno**.
2. Que se pueda entrar con el carné **sólo en la sucursal / kiosco donde tiene
   ese turno**.
3. Si no se cumple lo anterior, **sólo con usuario y contraseña**.

Es una buena idea y hay que tomarla en serio: convierte una credencial que hoy
sirve *en cualquier lugar y a cualquier hora* en una que sirve *acá y ahora*.

---

## 2. Qué resuelve — y qué no

**Lo que resuelve.** Hoy, quien recrea el código de un carné entra desde donde
quiera, cuando quiera, sin dejar rastro de intentos fallidos. Con la regla, ese
mismo código sólo sirve dentro de una ventana de horas y desde un lugar
determinado. Para alguien de afuera —o para un ex empleado— eso es la
diferencia entre una puerta abierta y una que hay que ir a golpear en persona,
en horario, delante de testigos.

**Lo que NO resuelve, y hay que decirlo.** El atacante realista de esta
credencial no está afuera: es **un compañero de la misma sala, en el mismo
turno**. Esa persona cumple las dos condiciones nuevas sin esfuerzo — está ahí,
a esa hora, en ese kiosco. Contra el caso que más importa —entrar como otro para
autorizarse algo, o para que una acción quede a nombre ajeno— la regla agrega
muy poco.

**Conclusión:** es una capa que vale la pena, **encima** de que el código deje de
ser derivable, nunca **en lugar** de eso. El problema de fondo sigue siendo el
que documenta `planes-cerrados/AUDITORIA-SUPABASE-2026-07-29.md` §S1-bis: el
código del carné es `SHA-256(código de empleado)` cortado a 8 caracteres, sin
ningún secreto, y el código de empleado es un número de 3–4 dígitos visible en
todo el portal.

---

## 3. Lo que hoy no está (medido el 2026-08-11 contra producción)

> **Leer esta tabla como el avance de una entrega en curso, no como un
> descuido.** El portal todavía no está liberado para todo el personal: los 17
> que han entrado con su usuario son el grupo con el que se está probando, y por
> eso hay 8 horarios cargados y ninguna marcación. Los números no dicen «esto
> está abandonado», dicen **cuánto falta del despliegue** — y resulta que la
> lista de prerrequisitos de esta regla (§5) es casi la misma lista que la de
> terminar de liberar el portal.
>
> Eso tiene una consecuencia práctica y buena: **el momento barato para
> introducir esta regla es durante el despliegue, no después.** Si cada persona
> que se libera entra ya con su contraseña propia, su horario publicado y su sala
> con dispositivo registrado, la regla nunca hay que retrofitearla sobre 50
> personas de golpe. Quien todavía no está liberado no cuenta para nada de esto.
>
> Y el reverso: mientras el despliegue sea parcial, **el carné es la puerta
> principal del grupo que está probando**. Encender la regla antes de tiempo le
> pega justo a quienes están ayudando a probar el portal.

| dato | hoy | qué implica para la regla |
|---|---|---|
| Empleados activos | 50 | |
| Con horario cargado esta semana | **8** | La regla 1 dejaría afuera a **42 de 50** |
| Última semana con horarios | 2026-08-10 | Los horarios no se publican todas las semanas |
| Sucursal dentro del horario | **no existe** | `employee_rosters.schedule_data` guarda día, turno y horas — ninguna sucursal. La regla 2 **no se puede evaluar** con lo que hay |
| Dispositivos de kiosco registrados | **1**, en **1** sala | En 6 salas no hay con qué atar «el kiosco donde tiene el turno» |
| Marcaciones en los últimos 7 días | **0** | No hay una señal alternativa de «está trabajando» |
| Entraron alguna vez con usuario y contraseña | 17 de 50 | |
| Siguen con contraseña temporal | **33 de 50** | 🔴 **La regla 3 no es una salida: es un candado** |
| Cuentas de carné creadas | 36 | El carné es hoy la puerta principal, no la excepción |

**El número que manda es el último de los rojos.** Si se enciende la regla hoy,
42 personas no pueden entrar por carné y 33 de ellas no tienen contraseña propia
con la que caer de vuelta. No es una restricción: es dejar a dos tercios del
personal afuera del portal.

**Dicho de otra forma, y es la forma útil:** la regla no está esperando a que
alguien la programe — está esperando a que el despliegue llegue a cada persona.
Se enciende sola, sin drama, el día que las cuatro condiciones de §5 estén
cumplidas para el grupo liberado. Y se puede encender **por sala**: en cuanto
una sucursal tenga a su gente con contraseña, horario y un dispositivo
registrado, ahí ya se puede exigir, sin esperar a las otras seis.

---

## 4. Las decisiones que hay que tomar antes de escribir una línea

### 4.1 ¿Qué es «estar de turno»? Hay dos fuentes y no dan lo mismo

| fuente | a favor | en contra |
|---|---|---|
| **El horario publicado** (`employee_rosters`) | Existe sin kiosco y sin marcaje. Es lo que ya se planifica | Quien cubre un turno de última hora queda afuera. Y si RRHH no publica una semana, **nadie entra** |
| **La marcación** (entró y no ha salido) | Es la verdad, no el plan. Cubre reemplazos y cambios | Hoy hay 1 kiosco y 0 marcaciones. Sin marcaje no hay señal |

**Recomendación:** el horario publicado como fuente principal, y la marcación
como **ampliación**, nunca como restricción: si la persona marcó entrada y no ha
marcado salida, está de turno aunque el horario diga otra cosa. Al revés —exigir
las dos— multiplica las formas de quedarse afuera.

### 4.2 Los márgenes ya existen, no hay que inventarlos

El motor de marcaje (`src/utils/timeClock.helpers.js`) ya define la tolerancia
del negocio: **30 minutos antes** de la hora de entrada y hasta **15 minutos
después** del fin de turno. La regla del carné debe usar esos mismos números; dos
tolerancias distintas para el mismo turno se contradicen el día que alguien llega
25 minutos antes.

### 4.3 El turno que cruza la medianoche

Un turno de 21:00 a 05:00 pertenece al día en que **empezó**. Si la regla mira
«el turno de hoy» a las 00:30, el personal nocturno se queda sin acceso a mitad
de su jornada. Hay que resolverlo explícitamente al escribirla, no descubrirlo.

### 4.4 La hora la pone el servidor

La comparación va en hora de El Salvador (UTC−6) y **calculada en el servidor**.
Si se hiciera con el reloj del navegador, cambiar la hora del equipo saltearía la
regla entera y quedaría de adorno.

### 4.5 ¿Qué es «su sucursal»?

Hoy lo único que existe es `employees.branch_id`, que es la sala **asignada** a la
persona, no la del turno. Dos caminos:

- **(a) Agregar la sucursal al turno.** Es lo correcto: permite cubrir en otra
  sala sin perder el acceso, y hace que la regla diga lo que promete.
- **(b) Usar `employees.branch_id`.** Más barato, pero quien cubre en otra sala no
  entra — y cubrir en otra sala es exactamente cuando más se necesita el portal.

### 4.6 ¿Cómo sabe el portal DÓNDE está quien escanea?

Un navegador cualquiera no tiene sucursal. Dos opciones:

- **Dispositivo registrado** — ya existe la pieza (`kiosk_devices`, con
  `device_id` + `device_token`, usada por el kiosco de marcaje). **Recomendada.**
- **IP de la sala** — más frágil: cambia sola, se comparte entre salas y se
  falsifica con cualquier conexión de datos.

### 4.7 Qué pasa cuando la regla no se puede evaluar

Sin horario publicado, o desde un equipo no registrado, hay que elegir: ¿deja
pasar o no? **Recomendación: el carné falla cerrado, usuario y contraseña jamás.**
Y precisamente por eso el prerrequisito de las contraseñas (§5.1) no es opcional.

### 4.8 Las excepciones que ya se sabe que existen

- Jefaturas y supervisión que visitan salas que no son la suya.
- Administración y Bodega, que no tienen turno de sala.
- Llegar antes de que abra el turno (los 30 minutos de §4.2 pueden no alcanzar un
  día de inventario).

Cada una necesita una respuesta escrita **antes** de encender la regla, o se
resuelven a los gritos el primer lunes.

---

## 5. Prerrequisitos, en orden

1. **Contraseña propia para las 50 personas** (hoy 17 han entrado alguna vez).
   Sin esto, cualquier restricción del carné deja gente sin ninguna puerta.
2. **Horarios publicados todas las semanas para todo el personal de sala**
   (hoy 8 de 50). La regla es tan confiable como la agenda que la alimenta.
3. **Decidir la sucursal del turno** — §4.5 (a) o (b), por escrito.
4. **Un dispositivo registrado por sala** (hoy 1 de 7), si se toma el camino
   recomendado de §4.6.
5. **Encenderla primero en modo aviso**: durante dos semanas, la regla se evalúa
   y **registra** a quién habría bloqueado, sin bloquear a nadie. Ese registro es
   la lista de excepciones reales — la única forma de descubrir los huecos sin
   gente esperando en la puerta.

**Los cuatro primeros son, punto por punto, la lista de lo que le falta al
despliegue.** No hay que hacer un proyecto aparte: alcanza con que la entrega de
cada persona incluya su contraseña y su horario, y la de cada sala su
dispositivo. Conviene por eso que el interruptor de la regla sea **por
sucursal**, para que una sala terminada no espere a la última.

---

## 6. Dónde se implementa cuando toque

- **La decisión va en el servidor**, dentro de `ensure_user_by_code` — es el único
  punto por el que pasa un carné y ya tiene al empleado resuelto. Ahí, cuando el
  match sea por carné, se evalúa turno + lugar y se devuelve `OUT_OF_SHIFT` o
  `WRONG_BRANCH` en vez del correo con el que se completa el ingreso.
- **El mensaje tiene que decir qué pasó**, en términos del portal: «Tu carné
  funciona sólo durante tu turno» o «Este carné no es de esta sala». Un
  «incorrecto» mudo manda a la gente a pensar que el carné se dañó — que es
  exactamente lo que pasó el 2026-08-11.
- **Cada rechazo se registra** con quién, dónde y cuándo. Hoy `login_rate_limit`
  sólo guarda la IP, así que un carné rechazado no deja rastro de quién era.

---

## 7. Esto no reemplaza lo otro

El orden que de verdad reduce el riesgo:

1. **Que el código del carné deje de derivarse del código de empleado** — secreto
   aleatorio por persona, guardado sólo como hash (§S1-bis, decisión ya tomada y
   frenada por el marcaje sin internet).
2. **Sacar el PIN de la lectura**: hoy cualquier empleado con acceso al listado de
   personal puede pedir la columna entera en una sola consulta.
3. **Esta regla** — turno y lugar.
4. **Segundo factor**: escaneo + PIN personal de 4 dígitos, que el kiosco ya sabe
   verificar contra un hash lento.

Y aparte, con impacto directo en planilla: los códigos que autorizan horas extra
se calculan en el navegador a partir del reloj (§S1-ter de la misma auditoría).
Quien abra el archivo JS del portal se autoriza su propia hora extra. Si se va a
tocar el sistema de credenciales, ése es el que mueve dinero.
