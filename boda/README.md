# Sitio de la boda 💍

Un solo sitio que acompaña toda la boda y cambia solo según la fecha:

| Fase | Cuándo | Qué muestra |
|---|---|---|
| **Save the date** | antes de `invitacionesDesde` | portada con fecha y cuenta regresiva, agregar al calendario, historia, fotos |
| **Invitación** | hasta el día de la boda | + lugares con mapa interactivo, programa, vestimenta, regalos, hospedaje, preguntas, **confirmación (RSVP)**, libro de firmas |
| **Boda** | el día (y el siguiente) | botón grande para **subir fotos** al álbum compartido, pantalla en vivo para el proyector |
| **Recuerdos** | después | el álbum completo, mensajes, agradecimiento |

Para ver cualquier fase sin esperar: agregar `?fase=boda` (o `save-the-date`, `invitacion`, `recuerdos`) a la dirección.

## Probarlo ya (modo demo)

```bash
cd boda
npm install
npm run dev        # http://localhost:5180
```

Sin configurar nada corre en **modo demo**: todo se guarda en el navegador y trae invitados de ejemplo.

- Invitación personal: `/i/DEMO01`
- Álbum: `/album` con clave **BODA27**
- Panel: `/admin`, contraseña **demo**
- Pantalla en vivo: `/pantalla`

## Personalizarlo

**Todo el contenido está en `src/config.js`**: nombres, fecha, fases, lugares (con coordenadas), programa, vestimenta, regalos, hospedaje, preguntas, fotos. Las fotos propias van en `public/fotos/` y se refieren como `/fotos/archivo.jpg`.

## Qué hace

**Para los invitados**
- Enlace personal por familia (`/i/K7M2QX`): los saluda por su nombre e indica cuántos pases tienen.
- Confirman persona por persona, agregan a su acompañante si tienen pase extra, restricciones alimentarias, una canción y un mensaje. Pueden cambiar la respuesta hasta la fecha límite.
- Ven su **mesa asignada** después de confirmar.
- Mapa interactivo (OpenStreetMap, sin clave de API) + botones a Google Maps y Waze.
- Agregar al calendario (Google y archivo .ics con recordatorio una semana antes).
- Libro de firmas público.
- **Álbum compartido**: escanean el QR de su mesa, suben fotos y videos desde el teléfono (se comprimen antes de subir: ~10 MB → ~400 KB), etiquetan el momento y ven el álbum crecer en vivo.

**Para ustedes (`/admin`)**
- Resumen: confirmados, no asisten, lugares sin respuesta, quién ya abrió su invitación, restricciones alimentarias, canciones pedidas.
- Invitados: alta y edición por familia, importar desde CSV (Excel / Google Sheets), exportar, y **enviar por WhatsApp** con mensajes listos (save the date, invitación, recordatorio) que quedan marcados como enviados.
- Mesas: plano del salón donde se arrastran las mesas, asignación por familia o por persona, alerta de mesas excedidas, lista por mesa para el salón.
- Álbum: ocultar o borrar fotos, lista de enlaces para respaldo.
- QR y enlaces: tarjetas QR imprimibles para cada mesa, clave del álbum, enlace a la pantalla en vivo.

## Ponerlo en línea

### 1. Base de datos (Supabase, plan gratuito)

> Crear un proyecto **nuevo** para la boda. No usar el del portal.

1. supabase.com → New project.
2. SQL Editor → pegar `supabase/schema.sql` → Run.
3. Authentication → Users → *Add user* (correo y contraseña de quien administra).
4. En el SQL Editor: `insert into admins (email) values ('su-correo@ejemplo.com');`
5. Authentication → Sign In / Providers → desactivar *Allow new users to sign up*.
6. Project Settings → API: copiar la URL y la `anon key`.

### 2. Publicar (Vercel, gratis)

1. Importar el repo en Vercel, con **Root Directory = `boda`**.
2. Variables de entorno: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (ver `.env.example`).
3. Opcional: un dominio propio (p. ej. `danielyvaleria.com`).

## Seguridad, en corto

- Los invitados **no pueden leer la lista de invitados**: sólo ven su invitación, y sólo con su código (6 caracteres sin 0/O/1/I).
- El álbum se lee público (es la idea), pero para subir hace falta la clave que va en los QR. Se puede cambiar desde el panel.
- El panel sólo abre con un usuario cuyo correo esté en la tabla `admins`.
- Las fotos se pueden ocultar al instante desde el panel si alguien sube algo fuera de lugar.

## Ideas para seguir

- **Recordatorios automáticos** por WhatsApp/correo a quien no ha confirmado (Edge Function + cron).
- **Transmisión en vivo** de la ceremonia para quien no puede viajar (enlace de YouTube en la fase «boda»).
- **Trivia de los novios** en la mesa mientras sirven la cena, con ranking en la pantalla.
- **Playlist colaborativa** (Spotify) y votación de canciones.
- **Descarga del álbum en ZIP** y libro de fotos impreso con las mejores.
- **Check-in en la entrada** escaneando el QR de la invitación (y mostrando la mesa).
- **Mensajes en video** para los novios.
- **Idioma inglés** para invitados del extranjero.
- **Tablero de proveedores y presupuesto** para los novios (pagos, fechas, contactos).
