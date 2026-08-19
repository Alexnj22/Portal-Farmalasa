# Agente de impresión de la caja

Hace que el papel salga **en la caja de la sucursal**, lo mande quien lo mande y
desde donde sea — incluido el teléfono.

---

## Instalación (3 pasos, unos 5 minutos)

### 1. En el portal, generá el código

**Sistema → Prueba de impresión → Cajas de las salas → Agregar una caja.**

Elegí la sucursal, ponele un nombre que diga cuál es (`Caja Salud 3`) y apretá
**Generar el código**. Sale un código de 8 letras así:

```
K7MD-P9QX
```

Dura **15 minutos** y se usa **una sola vez**. Si se vence, generás otro.

### 2. Copiá esta carpeta a la computadora de la caja

En una memoria USB, por red, como sea. Sólo hacen falta `instalar.sh` y
`agente.py`.

### 3. En la computadora de la caja, corré una línea

Abrí una terminal en esa carpeta y escribí:

```bash
bash instalar.sh
```

Te va a ir preguntando, y hace todo lo demás:

- comprueba que la computadora sirva (Python, sistema de impresión, internet),
- **encuentra la ticketera sola** y te pide que confirmes,
- te pide el código de 8 letras,
- escribe la configuración,
- deja el agente prendido para siempre (se enciende solo al reiniciar),
- y **manda una hoja de prueba**.

Si salió el papel de prueba, ya está. No hay que configurar nada más.

---

## Preguntas que van a salir

**¿Qué pasa si me equivoco al escribir el código?**
Te deja intentar tres veces. Podés escribirlo en minúsculas y con o sin el
guion: `k7md-p9qx` y `K7MDP9QX` son lo mismo. El alfabeto no tiene O, 0, I ni 1
justamente para que no se confundan al leerlos.

**¿Y si se vence el código?**
Generás otro en el portal y volvés a correr `bash instalar.sh`.

**¿Cómo se actualiza una caja sin ir a la sucursal?**
Una línea en la terminal de esa computadora, dictable por teléfono:

```bash
curl -fsSL https://portal.farmasalud.lat/agente-impresion/actualizar.sh | sudo bash
```

No toca `agente.conf` —el token, la sala y la impresora quedan como están—,
comprueba la firma de lo que baja, prueba que arranque antes de instalarlo y
**vuelve sola a la versión anterior** si el agente no levanta.

De ahí en adelante **no hace falta**: el agente pregunta cada 15 minutos si hay
una versión nueva, la instala con los mismos frenos y se reinicia. La línea
queda para una caja que quedó atrás o para no esperar los 15 minutos. El portal
la muestra, lista para copiar, en Sistema → Prueba de impresión, y ahí también
dice qué cajas están al día.

**¿Y si la versión nueva está rota?** No se instala: tiene que coincidir con su
firma, compilar y **arrancar** (se corre con `--autoprueba` antes de
reemplazar). La anterior queda al lado como `agente.py.anterior`, así que desde
la terminal de la sala se vuelve con un `cp` y un `systemctl restart`.

**¿Cómo sé que está funcionando?**
En el portal, esa caja va a decir **«ahora mismo»** al lado del nombre. Si dice
«sin instalar», el código nunca se canjeó; si dice «hace 3 h», la computadora
está apagada o sin internet.

**¿Cómo lo veo trabajar?**

```bash
sudo journalctl -u farmalasa-impresion -f
```

**Imprimo desde el portal y el otro sistema deja de imprimir hasta que apago y
prendo la ticketera.**
Es lo que reportó Salud 1 el 19-ago-2026, y no es un byte del ticket: es el
CANAL. El sistema de facturación le escribe directo a `/dev/usb/lp0`; cuando el
agente imprime por CUPS, el backend `usb` de CUPS reclama la impresora y
desengancha el módulo `usblp` del kernel, que es el que crea ese archivo — y
muchas veces no lo devuelve. Apagar y prender la ticketera la vuelve a enumerar
y el archivo revive.

Desde v2.664.5 el agente le escribe **al mismo archivo que el otro sistema** y
CUPS quedó de respaldo. Para comprobar por dónde está escribiendo esta caja:

```bash
sudo journalctl -u farmalasa-impresion -n 5 | grep 'Escribe en'
```

Si dice `CUPS`, falta el dispositivo o falta el permiso:

```bash
ls -l /dev/usb/lp0            # tiene que existir y ser escribible
sudo chmod 666 /dev/usb/lp0   # el otro sistema pide lo mismo
dmesg | grep -i usblp         # si no aparece, el módulo no cargó
```

**El papel sale pero no se corta.**
Desde v2.661.9 **el ticket trae su propio corte** y esto no debería pasar: si
pasa, la caja está recibiendo tickets viejos o la ticketera ignora el comando.
El último recurso es editar `/opt/farmalasa/agente-impresion/agente.conf`,
quitarle el `#` a la línea `CORTAR=1` y reiniciar con
`sudo systemctl restart farmalasa-impresion` — pero ojo: eso agrega un SEGUNDO
corte, y total en vez de parcial, así que se prueba con papel en la mano.

**¿Se puede instalar en más de una computadora de la misma sala?**
No hace falta y no conviene: el papel sale igual en la caja aunque el documento
se mande desde otra máquina. Si igual se hace, no se imprime dos veces (la cola
usa `FOR UPDATE SKIP LOCKED`), pero no hay motivo.

---

## Por qué hace falta esto

El portal imprime mandando el ticket a `http://localhost` de la computadora que
tiene el navegador abierto. Eso alcanza sólo a esa máquina y **no puede alcanzar
otra**: apuntar a la IP de la caja es contenido mixto y el navegador lo corta, y
la exención de `localhost` no se hereda a una IP. Ningún permiso ni bandera lo
destraba.

Sin agente, entonces:

- quien confirma un corte **desde el teléfono** —que es justo donde llega el
  aviso— no tiene forma de que salga papel;
- quien resuelve una diferencia **desde la oficina** imprime ahí el comprobante
  que debía firmarse en la sala;
- y `ok` significa siempre «el programa recibió el pedido», nunca «salió papel»:
  la respuesta del camino directo llega opaca, un 404 y un 200 se ven igual.

Con el agente, el portal deja el documento en una cola con su sucursal y esta
computadora lo saca. El acuse deja de ser una promesa: el agente contesta si el
comando funcionó.

Además sobrevive a un formateo de la caja, que el camino de hoy no: los
`print*.php` del sistema de facturación **no están en ningún servidor**, viven
sólo en el disco de cada computadora de sala y no hay de dónde bajarlos.

---

## Notas para quien mantenga esto

**No hay secretos en `instalar.sh`.** La llave que lleva es la `publishable` de
Supabase — la misma que viaja dentro del JavaScript del portal, o sea que la
tiene cualquiera que abra la página. Lo que autoriza a esta caja es su *token*,
y ése lo entrega el canje del código: nunca está escrito en el repositorio.
`agente.conf`, que sí lo tiene, queda con permisos `600` y está en `.gitignore`.

**El agente se actualiza solo, y por eso los frenos importan.** Una versión mala
llega a las cinco cajas a la vez. Lo que se compara es el **hash** del archivo y
no un número de versión: un número hay que acordarse de subirlo, y el día que
alguien no lo sube las cajas creen estar al día corriendo otra cosa. Lo publica
`scripts/publicar-agente.mjs` en cada build, desde el ÚNICO archivo que existe
—`scripts/agente-impresion/agente.py`—; `public/agente-impresion/` es generado y
está en `.gitignore` justamente para que no haya una segunda copia que se
desincronice.

Y quien controle esa dirección puede correr código en las cinco cajas. Es la
misma confianza que el portal ya tiene sobre esas computadoras, pero dejó de ser
cierto que «un ticket no puede ejecutar nada»: eso sigue valiendo para la cola,
no para la actualización.

**Escribe al dispositivo, no a CUPS, y el orden no es preferencia.** Ver la
pregunta de arriba: al revés, imprimir desde el portal deja al sistema de
facturación sin ticketera. `DISPOSITIVO=` vacío en `agente.conf` fuerza CUPS —
es la escotilla para una caja donde la ticketera no cuelgue de USB, no un ajuste
para probar.

**El agente no maqueta.** El contenido llega con sus columnas y sus códigos de
impresora ya adentro, igual que lo que recibe el programa del sistema de
facturación. La maquetación vive en `src/utils/ticketPrint.js` y tiene que
seguir viviendo ahí: dos maquetadores se desincronizan y la diferencia sólo se
ve en el papel.

**Un ticket son BYTES, y por eso viaja en base64.** La letra normal se pide con
`ESC ! \x00`, así que todo ticket lleva un NUL — y un NUL no cabe ni en un JSON
ni en una columna `text` de Postgres. Hasta el 17-ago-2026 la cola guardaba
texto y rechazaba **todos** los documentos con 400 «unsupported Unicode escape
sequence»; el portal lo leía como «esta sala no tiene caja» y caía al diálogo
del navegador, así que el papel salía en la computadora de quien apretaba el
botón. Hoy la columna es `bytea` y `reclamar_impresion` devuelve
`contenido_b64`. El agente todavía acepta el `contenido` viejo en texto plano:
eso es lo que permite actualizar una caja **antes** de tocar la base sin que
quede tirando papel en blanco, y se puede borrar cuando todas estén al día.

**Un trabajo que queda a medias vuelve solo.** Si el agente se muere con el
papel en la mano, a los dos minutos ese trabajo vuelve a la cola. A los 3
intentos pasa a `ERROR` y deja de reintentarse: un ticket que no sale nunca
taparía a los que sí saldrían. La cola se purga a los 14 días.

**⚠️ No reconfigures la cola `pos-80`.** Es por la que imprime hoy el sistema de
facturación. Si hiciera falta otra configuración, se crea una cola nueva al
mismo dispositivo y el instalador te deja elegirla.
