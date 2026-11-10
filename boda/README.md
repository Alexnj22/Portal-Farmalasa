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
- Inglés: botón **EN** arriba a la derecha, o `?lang=en`

## Personalizarlo

**Todo el contenido está en `src/config.js`**: nombres, fecha, fases, lugares (con coordenadas), programa, vestimenta, regalos, hospedaje, preguntas, fotos. Las fotos propias van en `public/fotos/` y se refieren como `/fotos/archivo.jpg`.

- **`sitio`**: la dirección pública. La vista previa del enlace en WhatsApp (título con nombres y fecha, y la foto `portadaCompartir`) se arma al compilar y necesita la URL completa.
- **`idiomas`** y el bloque **`en`**: con `['es', 'en']` aparece el botón ES/EN y el sitio toma el idioma del teléfono del invitado. El bloque `en` lleva sólo los textos traducidos, en el mismo orden que la versión en español; lo que falte se muestra en español. El panel queda en español.
- **`confirmarAntesDe`** y **`zonaHoraria`**: el panel las copia a la base cada vez que se abre, y la base rechaza confirmaciones fuera de plazo (con la fecha del lugar de la boda, no la del teléfono del invitado).

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
- Entrada: lista para registrar quién llegó. También se puede escanear el **pase** del invitado (el QR que ve en su invitación después de confirmar) con la cámara del teléfono: con la sesión del panel abierta, la invitación muestra la mesa y un botón «Registrar llegada».
- Mesas: platillos especiales (alergias y restricciones) por mesa, exportables para el banquete.
- Álbum: descarga completa en ZIP, en carpetas por momento.
- Mensajes: opción de revisar el libro de firmas antes de publicar cada mensaje.

## Ponerlo en línea

### 1. Base de datos (Supabase, plan gratuito)

> Crear un proyecto **nuevo** para la boda. No usar el del portal.

1. supabase.com → New project.
2. SQL Editor → pegar `supabase/schema.sql` → Run. (Si ya lo habían corrido con una versión anterior, se vuelve a correr completo: agrega lo nuevo sin borrar datos.)
3. Authentication → Users → *Add user* (correo y contraseña de quien administra).
4. En el SQL Editor: `insert into admins (email) values ('su-correo@ejemplo.com');`
5. Authentication → Sign In / Providers → desactivar *Allow new users to sign up*.
6. Project Settings → API: copiar la URL y la `anon key`.

### 2. Publicar (Vercel, gratis)

1. Importar el repo en Vercel, con **Root Directory = `boda`**.
2. Variables de entorno: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (ver `.env.example`).
3. Opcional: un dominio propio (p. ej. `alessandrayeduardo.com`).

## Seguridad, en corto

- Los invitados **no pueden leer la lista de invitados**: sólo ven su invitación, y sólo con su código (6 caracteres sin 0/O/1/I).
- El álbum se lee público (es la idea), pero para subir hace falta la clave que va en los QR. La base revisa la clave **antes** de dejar subir el archivo: entrega una ruta con permiso de 30 minutos, y el almacenamiento rechaza cualquier archivo fuera de una ruta autorizada. Se puede cambiar desde el panel.
- Una invitación nunca suma más personas que sus pases, ni acepta respuestas después de la fecha límite: lo controla la base, no sólo la pantalla.
- Frenos contra abuso: subidas y mensajes tienen un tope por minuto muy por encima de lo que genera un salón lleno.
- El panel sólo abre con un usuario cuyo correo esté en la tabla `admins`.
- Las fotos se pueden ocultar al instante desde el panel si alguien sube algo fuera de lugar.

## Ideas para seguir

- **Recordatorios automáticos** por WhatsApp/correo a quien no ha confirmado (Edge Function + cron).
- **Transmisión en vivo** de la ceremonia para quien no puede viajar (enlace de YouTube en la fase «boda»).
- **Trivia de los novios** en la mesa mientras sirven la cena, con ranking en la pantalla.
- **Playlist colaborativa** (Spotify) y votación de canciones.
- **Libro de fotos impreso** con las mejores del álbum.
- **Mensajes en video** para los novios.
- **Tablero de proveedores y presupuesto** para los novios (pagos, fechas, contactos).

## Fotos y videos del álbum

- Cada foto se reduce en el teléfono antes de subir (~400 KB) y se sube también una **miniatura** de ~480 px: el álbum, el panel y el fondo de la pantalla en vivo muestran la miniatura, y la grande sólo se baja al abrir la foto. Así el álbum carga rápido con el wifi del salón y no se gasta el límite de descarga del plan gratuito.
- Los videos llevan como portada un cuadro del primer segundo.
- Las fotos HEIC que el navegador no sabe abrir (Chrome en Android, Windows) se convierten a JPG en el teléfono; el convertidor sólo se descarga si hace falta.
- Si la señal se cae a mitad de la subida, se reintenta solo (y espera a que vuelva la conexión). Cerrar la página a mitad de una subida pide confirmación.
