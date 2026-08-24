# Sistema, salud y auditoría general — la bitácora, los respaldos y lo que vigila

**Escrito el 2026-08-24**, durante la auditoría completa del portal. Era una de
las once áreas sin documento propio.

Son las pantallas de quien mantiene el portal. Su valor está entero en una
propiedad: **que lo que dicen sea cierto**. Una bitácora incompleta, un respaldo
que no corrió o un tablero de salud en verde sobre algo roto son peores que no
tenerlos, porque se les cree.

---

## 1. La bitácora: la autoría sale de la SESIÓN

`appendAuditLog` escribe en `audit_logs`. **El `user_id` sale de
`supabase.auth.getSession()`**, nunca de `sb_user` en `localStorage` — ese lo
escribe el navegador y por lo tanto se puede editar.

Desde la migración `20260806000957` la policy de INSERT exige
`user_id = auth.uid()`, así que mandar otra cosa no es sólo incorrecto: **la fila
se rechaza y `appendAuditLog` se traga el error**. Bitácora muda.

`getSession()` lee del almacenamiento local, no viaja a la red: se puede llamar
en cualquier camino sin costo.

### Lo que sigue abierto

La policy de INSERT de `audit_logs` acepta cualquier fila de cualquier usuario
autenticado (`WITH CHECK (true)`). Una tabla append-only no necesita policy de
DELETE, **pero sí necesita que su INSERT diga quién puede escribir qué**: hoy se
puede fabricar una entrada. Está registrado en la auditoría del 2026-07-30 junto
con el mismo defecto en `attendance`.

**Toda acción de usuario va a la bitácora.** No es una convención de estilo: es
la única forma de reconstruir qué pasó cuando alguien pregunta.

---

## 2. La salud de las sincronizaciones

`v_sync_health` junta el resultado de cada corrida. La vista de Salud muestra
**sólo los cuatro dominios que no tienen vigilancia propia**: `products`,
`minmax`, `purchases`, `backup`.

`dte` e `inventory` no están ahí a propósito — el primero tiene
`check-sales-alerts` y el segundo tiene el banner y `useSyncMonitor`. Duplicar la
vigilancia no la mejora: reparte la atención.

`check-sync-health-alerts-20min` avisa sin esperar a que alguien abra la
pantalla, que es la diferencia entre una alarma y un tablero.

> **Una alarma que espera a que alguien mire no cierra el circuito.**

---

## 3. Los respaldos: qué se guarda y qué no

`backup-critical-tables` corre los domingos a las 08:00 UTC (2 de la mañana en
El Salvador) y sube un gzip al bucket privado `backups`. Retención: **60 días**.

**Sólo se respalda el trabajo manual y la configuración.** Los datos que vienen
del sistema de origen —ventas, inventario, productos— **no se exportan**: se
recuperan resincronizando. Respaldarlos sería guardar una copia peor de algo que
ya se puede reconstruir, y multiplicaría el tamaño por diez.

⚠️ **Este cron estuvo 17 días muerto sin que nadie lo notara.** Es exactamente lo
que hoy vigila `npm run gate:eficiencia`: comprueba que lo declarado siga vivo,
que ninguna cadencia se haya apretado sola, y que las llamadas salientes
contesten 200 — un redeploy sin `--no-verify-jwt` las deja en 401 **antes de
ejecutar una línea**, y eso ya pasó tres veces.

---

## 4. Los objetos huérfanos

`orphan_objects_registry` es un **registro manual versionado** de candidatos a
código muerto, sembrado por migración.

La regla que lo hace confiable: **la pantalla sólo lee y marca estado; no crea ni
borra filas.** Un caso nuevo entra por migración, cuando se confirmó. Si la
pantalla pudiera agregar, el registro se llenaría de sospechas y dejaría de
significar «esto está confirmado como muerto».

---

## 5. La caja negra — cómo se diagnostica lo que no se puede ver

Existe por un defecto que sólo pasa en el teléfono del usuario y que **ningún
emulador reproduce**: al abrir el detalle de un producto «se recarga la página y
se pone negro».

Se persiguió tres veces por el lado del `backdrop-filter` y las tres falló.

### Las dos lecciones, que valen para todo el portal

**Un valor vivo no se descarta con una consulta de ayer.** El 2026-08-07 se creyó
saber por qué no podía ser el vidrio: `user_dashboard_prefs` decía que esa cuenta
usaba el tema `solid`, donde los cuatro `--backdrop-*` valen `none`. **Un día
después la sonda leyó el tema del DOM, en el teléfono, y salió `liquid`.** La
consulta de ayer no describe la sesión de hoy, y se había usado para descartar
una hipótesis.

(Y ojo con el vacío: **`liquid` es el único tema que no estampa `data-theme`**,
así que un `null` significa «con vidrio», no «sin dato».)

**Cuando una hipótesis se cae tres veces, lo que falta no es otra hipótesis: es
una medición del aparato donde pasa.**

### Por qué es `localStorage` y no la base

El problema es que la página **se recarga**, así que la consola se limpia y no
queda nada que mirar — y un teléfono no tiene consola a mano. `localStorage`
sobrevive a la recarga.

Y el momento en que hay que anotar es justamente cuando la página se está por
recargar: **un `fetch` ahí no llega a salir**. Primero se guarda local, que es
síncrono y no puede fallar a medias.

Es un anillo de 40 entradas que se lee después en `/ios-test`, que el usuario
puede abrir y fotografiar. **No guarda nada de negocio**: tipo de evento, mensaje
de error, ruta y datos del aparato.

---

## 6. Las retenciones

| cron | qué purga | plazo |
|---|---|---|
| `purge-sync-logs-daily` | `sync_log` | 90 días |
| `purge-cron-history-daily` | historial de cron | — |
| `backup-critical-tables-weekly` | respaldos viejos | 60 días |

**El historial de negocio no se purga nunca** — precios, min·máx, eventos de
empleados. La regla es: lo que es infraestructura tiene retención desde el día 1;
lo que es historia de la empresa, no.

---

## 7. Antes de tocar algo en Sistema

1. **Toda acción de usuario va a `appendAuditLog`.**
2. **La autoría sale de la sesión.** Nunca de `localStorage`.
3. **Una tabla de log nueva define su retención el mismo día que nace.**
4. **Un cron nuevo se declara en el manifiesto de `gate:eficiencia`, con su costo
   por corrida y su motivo escrito.** Un cron sin declarar hace fallar el gate a
   propósito: lo que no está declarado no lo vigila nadie.
5. **Una alarma nueva tiene que avisar sola**, no esperar a que alguien abra una
   pantalla.
6. **Antes de descartar una hipótesis con una consulta, preguntarse si el valor
   es vivo.**
