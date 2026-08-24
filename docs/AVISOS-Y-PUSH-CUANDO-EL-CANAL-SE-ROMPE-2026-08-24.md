# Avisos, notificaciones y encuestas — qué pasa cuando el canal se rompe

**Escrito el 2026-08-24**, durante la auditoría completa del portal. Es una de
las once áreas que no tenía documento propio, y la que dejó el aprendizaje más
transferible del portal entero:

> **Un aviso que no salió, y que nadie sabe que no salió, es peor que no tener
> aviso.**

---

## 1. Los cuatro canales, y cuál sirve para qué

| canal | dónde llega | cuándo se usa |
|---|---|---|
| La campana | dentro del portal | todo evento |
| El push al teléfono | fuera del portal | **sólo lo accionable** |
| Los comunicados (`announcements`) | pantalla + push por trigger | lo que la empresa anuncia |
| La encuesta de clima | su propia vista | por campaña |

**La regla de ruido:** `push = true` **sólo** para eventos accionables — una
solicitud pendiente, una solicitud decidida, la llegada física o el reenvío de
un pedido. El resto enciende la campana y nada más. Un push por cada cosa que
pasa entrena a la gente a ignorarlos, y entonces el canal deja de existir
aunque funcione.

---

## 2. Lo que rompió el canal, y por qué vivió tres semanas

Las dos funciones de aviso hacían esto:

```js
catch (err) { console.error(err); return 0; }
```

La acción del usuario se completaba como si todo hubiera salido bien aunque el
destinatario no se enterara de nada, y como el error moría en la consola no
había manera de notarlo salvo ir a mirar la tabla. **Eso es lo que dejó vivir
tres semanas el 401 del push (v2.320.3): el canal estaba roto y el portal no lo
dijo ni una vez.**

Lo que hay hoy:

- **Reintentos** ante fallas transitorias: cortes de red y 5xx. Sólo eso — un
  error de permisos o de datos da igual cuántas veces se mande, y un error que
  volvió **con respuesta** del servidor no se reintenta a propósito.
- **Si aun así no sale, se le avisa a quien hizo la acción.** Es el único que
  puede levantar el teléfono y contarlo por otro medio.

---

## 3. El push pertenece al EQUIPO, no a la cuenta

Web Push no tiene forma de pertenecer a una persona: el `endpoint` lo emite el
navegador de esa computadora y es la única dirección que existe.

En las máquinas de mostrador el turno cambia de persona y el equipo no. Eso
dejaba la suscripción ligada al **primero** que apretó «Activar» ahí, y cerrar
sesión no la soltaba: los avisos de quien ya se fue seguían cayendo en esa
pantalla, y el siguiente no recibía ninguno de los suyos.

Entonces el dueño se define por quién está adentro:

- al **entrar** se reclama el equipo (`reclamarPushDelEquipo`),
- al **salir** se suelta, si el equipo es compartido.

**Al soltar NO se llama `sub.unsubscribe()`.** Se borra la fila y se deja viva la
suscripción del navegador: así el permiso ya concedido sigue puesto y el
siguiente empleado queda ligado en silencio al iniciar sesión, sin tener que
enterarse de nada ni volver a autorizar avisos.

### Dos detalles que se rompen solos

- **El endpoint se recuerda al reclamar.** En `pagehide` no hay tiempo de
  preguntárselo al service worker: `getSubscription()` es asíncrono y la página
  ya se está muriendo, así que la respuesta llegaría a un mundo que no existe.
- **`getRegistration()` y nunca `ready`.** `ready` es una promesa que jamás se
  resuelve si no hay service worker registrado, y esto corre en los caminos de
  inicio y cierre de sesión, donde quedarse colgado sería mudo.

---

## 4. A quién le aplica un comunicado: una definición, no dos

`announcementAppliesToUser` (`src/utils/announcementAudience.js`) es el único
punto de verdad. Estaba **duplicado y divergente** entre `useSyncMonitor.js` y
`NotificationBell.jsx` — dos pantallas contestando distinto sobre el mismo
aviso.

Es el espejo de `getTargetAudience` de `AnnouncementsView.jsx`, que es la fuente
canónica al **crear**:

| `target_type` | `target_value` |
|---|---|
| `GLOBAL` | — |
| `BRANCH` | escalar: el `branch_id` |
| `ROLE` | escalar: **el NOMBRE del rol**, no su id |
| `EMPLOYEE` | array de ids de empleado |

**`ROLE` se resuelve por nombre porque así es como la vista lo escribe.** Es un
rótulo que ES la clave — con todo lo que eso implica: cambiarle el texto a un
rol rompe los avisos ya publicados que lo apuntan. Ver la regla «un rótulo no es
una clave» de `CLAUDE.md`.

---

## 5. Lo que está abierto

- **El push llega a 4 de 59 eventos.** La cuenta está en la auditoría de
  notificaciones del 2026-08-01. No es un defecto por sí solo —la regla de ruido
  es deliberada— pero la lista de cuáles deberían tenerlo nunca se cerró.
- `purge-notifications-daily` es la única retención del área. Los comunicados no
  se purgan.

---

## 6. Antes de tocar algo acá

1. **Ningún `catch` que se coma el error de un aviso.** Si no salió, alguien
   tiene que enterarse — y ese alguien es quien hizo la acción.
2. **Reintentar sólo lo transitorio.** Un 4xx no cambia de opinión.
3. **Una sola definición de audiencia.** Si hace falta preguntarlo en un tercer
   lugar, se importa; no se copia.
4. **Antes de renombrar un rol**, recordar que los avisos por `ROLE` lo apuntan
   por nombre.
5. **Un push nuevo tiene que ser accionable.** Si el destinatario no puede hacer
   nada al recibirlo, va a la campana.
