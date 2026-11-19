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
npm run dev:red    # además en el wifi: abre en el teléfono la dirección «Network» que imprime
```

Sin configurar nada corre en **modo demo**: todo se guarda en el navegador y trae invitados de ejemplo.

- Invitación personal: `/i/DEMO01`
- Álbum: `/album` con clave **BODA27**
- Panel: `/admin`, contraseña **demo**
- Pantalla en vivo: `/pantalla`
- Inglés: botón **EN** arriba a la derecha, o `?lang=en`
- **Panel de pruebas** (botón «Pruebas», sólo en modo demo): cambiar la fase del sitio, fingir la fecha
  de hoy (plazo por vencer, plazo vencido, día de la boda), abrir cada invitación de ejemplo y borrar
  todo para empezar de nuevo.

Invitaciones de ejemplo: `DEMO01` familia de 4 con 3 nombres (sobra un lugar para acompañante),
`DEMO02` un pase, `DEMO03` ya confirmada con mesa, `DEMO04` familia con un niño, `DEMO05` invitada con +1,
`DEMO06` ya declinada, `DEMO07` dos pases sin nombres cargados.

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
4. En el SQL Editor: `insert into admins (email) values ('su-correo@ejemplo.com');` (el usuario tiene que existir antes: la base guarda su id)
5. Authentication → Sign In / Providers → desactivar *Allow new users to sign up*.
6. Project Settings → API: copiar la URL y la `anon key`.

### 2. Publicar (Vercel, gratis)

1. Importar el repo en Vercel, con **Root Directory = `boda`**.
2. Variables de entorno: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (ver `.env.example`).
3. Opcional: un dominio propio (p. ej. `alessandrayeduardo.com`).

## Seguridad, en corto

- Los invitados **no pueden leer la lista de invitados**: sólo ven su invitación, y sólo con su código (8 caracteres sin 0/O/1/I/L; los de 6 ya repartidos siguen valiendo).
- El álbum se lee público (es la idea), pero para subir hace falta la clave que va en los QR (8 caracteres al azar en una base nueva). La base revisa la clave **antes** de dejar subir: entrega una ruta con permiso de 30 minutos y el almacenamiento rechaza todo lo demás. Por carpeta: voces ≤ 3 MB de audio, fotos ≤ 15 MB, videos ≤ 60 MB. Con el álbum en su tope de espacio (`cuota_album_gb` en `ajustes`, 90 GB) no se dan más permisos.
- Los mensajes de voz piden la clave del álbum o un código de invitación.
- **Intentos fallidos**: 20 claves o códigos equivocados desde una misma IP en 10 minutos y esa IP espera.
- **Frenos** en cada función abierta: un tope global, uno por IP (generoso: el wifi del salón comparte IP) y uno por teléfono. Votar y jugar exigen un token que emite la base; los nombres del juego no aceptan enlaces ni groserías (lista en `ajustes.groserias`) y las respuestas fuera de tiempo se rechazan.
- Una invitación nunca suma más personas que sus pases, ni acepta respuestas después de la fecha límite, ni una persona sin «asiste/no asiste»: lo controla la base.
- El panel sólo abre con un usuario registrado en `admins` (se reconoce por su id, no por el correo).
- Ocultar una foto la saca del álbum al instante y mueve el archivo a un bucket privado: su enlace público deja de servirla (la caché de la CDN puede tardar un rato).
- Toda edición de invitados, personas y ajustes queda en la tabla `cambios` (quién: `panel` o `invitado:CODIGO`).
- El sitio sale con cabeceras de seguridad (`vercel.json`: CSP, nosniff, Referrer-Policy, Permissions-Policy). Si se usa un dominio propio para Supabase o una música de apertura de otro sitio, hay que agregarlo a la CSP. La CSP permite `unsafe-eval` porque el convertidor de fotos HEIC lo necesita.

### Mantenimiento

- **Archivos huérfanos** (subidas que nunca se registraron): `node scripts/limpiar-huerfanos.mjs` con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (`--ver` sólo lista). Borra por la API de almacenamiento: borrar filas de `storage.objects` deja el archivo ocupando espacio. Con `pg_cron` activo, la base limpia sola cada 15 min los permisos y frenos vencidos (no los archivos).
- **Respaldo**: `SUPABASE_DB_URL=… bash scripts/respaldo.sh` (pg_dump). `scripts/respaldo-workflow.yml` es un workflow de GitHub para hacerlo cada noche; no está activo (las instrucciones están en el archivo).
- **Datos personales**: unos 30 días después de la boda, en el SQL Editor, `select purgar_datos_personales();` borra teléfonos, notas, restricciones e IPs (también de la auditoría). No está programada.
- **Pausa del plan gratuito**: un proyecto Free sin uso por 7 días se pausa. En Pro no aplica; en Free, un ping diario (p. ej. un cron de GitHub que llame `…/rest/v1/rpc/estado_juego` con la anon key) lo mantiene despierto.

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


## Segunda ronda: lo que trae ahora

- **Letra grande (abuelos).** En el panel, al editar una invitación, «Letra grande»: ese enlace se abre con letra más grande, sin animaciones, con los botones «Escuchar la invitación» (la lee el teléfono), «Confirmar», «Cómo llegar» y «Llamar». La confirmación va de a una pregunta con botones enormes. Cualquiera la prende con el botón **Aa**. Escenario de prueba: `DEMO08`.
- **El sobre.** Cada enlace personal se abre con un sobre con el nombre del invitado y un sello «A&E». Música opcional: `musica` en `src/config.js` (empieza apagada).
- **El día en vivo.** Fase `boda`: la portada dice qué está pasando y qué sigue (sale de `itinerario`), «¿Dónde me siento?» busca la mesa por nombre (con la clave del álbum), y Panel → **En vivo** manda avisos que aparecen al instante en todos los teléfonos.
- **Canciones.** `/canciones` para pedir y votar; `/dj` es la pantalla del DJ, ordenada por votos. En el panel se marcan las que ya sonaron.
- **Mensajes de voz** en el libro de firmas (hasta 1 minuto).
- **El juego** «¿Cuánto conoces a los novios?»: preguntas en `juego` de `src/config.js`; los invitados juegan en `/juego`, el proyector en `/pantalla?modo=juego`, y se maneja desde Panel → En vivo.
- **Presentación** de las fotos de los invitados (pantalla completa, acercamiento lento), desde el álbum y la portada de recuerdos.

Con Supabase: volver a correr `supabase/schema.sql` completo (es idempotente) para crear las tablas nuevas (`avisos`, `canciones`, `canciones_votos`, `juego_respuestas`) y las funciones.

## Tercera ronda: parece una app

- **Barra de pestañas abajo**, como una app de iPhone. Cambia con la fase: en la invitación, Inicio · Dónde · **Confirmar** · Mensajes · Más; el día de la boda, Hoy · Música · **Fotos** · Juegos · Más. Cada cosa tiene su pantalla: `/evento` (lugares, programa, vestimenta, regalos, preguntas), `/confirmar`, `/mensajes`, `/hoy` (tu mesa, lo que pasa ahora y los avisos), `/mas`. La portada termina en accesos directos a lo que falta hacer. El código de la invitación se recuerda en el teléfono, así que `/confirmar` sabe quién eres.
- **Modo abuelos rehecho.** Con letra grande ya no es la página normal agrandada: es una pantalla propia con el saludo por nombre, la fecha y el lugar, un solo botón enorme «Confirmar si voy» (o «Usted ya respondió» con quién va), y debajo Escuchar, Cómo llegar, Llamar, WhatsApp y Ver las fotos. Sin pestañas ni animaciones.
- **El sobre, con magia.** Llega flotando entre luces y polvo dorado; al tocar el sello, el lacre se parte, el teléfono vibra, la solapa se abre, la tarjeta sube y se acerca hasta llenar la pantalla entre confeti y pétalos.
- **Canciones con buscador.** Se escribe el nombre y aparecen canciones con carátula y una muestra de 30 s para escucharla antes de pedirla; también se puede pegar un enlace de Spotify, YouTube o Apple Music. La búsqueda usa el catálogo público de Apple y, en el iPhone (donde Apple redirige a su app), el de Deezer; los enlaces se leen con noembed.com. Spotify y YouTube no tienen búsqueda pública sin cuenta: el DJ recibe, por cada canción, enlaces directos a Spotify, YouTube y Apple Music, y un botón para copiar la lista.
- **Juegos listos para usar** en `/juego`:
  - **Trivia en vivo** (`/juego/trivia`): 10 preguntas con reloj de 20 s, incluidas preguntas de «¿Quién es más probable?» que muestran cómo votó el salón. En el proyector (`/pantalla?modo=juego`), con la sesión del panel abierta, «Empezar el juego» y corre solo: abre cada pregunta, la revela al acabarse el tiempo y pasa a la siguiente; al final, podio.
  - **Bingo de la boda** (`/juego/bingo`): cartón de 4×4 al azar con cosas que pasan en la fiesta; al completar una línea canta ¡BINGO! Se guarda en el teléfono.
  - **Retos de fotos** (`/juego/retos`): 10 retos; cada foto se sube al álbum con el momento «Retos».
  - Las preguntas, casillas y retos están en `juego` de `src/config.js`.

Con Supabase: volver a correr `supabase/schema.sql` (agrega `portada`, `enlace` y `muestra` a `canciones` y el ajuste `juego_desde` para el reloj).
