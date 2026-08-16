# Agente de impresión de la caja

Hace que el papel salga **en la caja de la sucursal**, lo mande quien lo mande y
desde donde sea — incluido el teléfono.

## Por qué hace falta

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

## Qué necesita

- Python 3 (viene con Linux; no usa ninguna librería de fuera)
- CUPS con la ticketera dada de alta — en Salud 3 es la cola `pos-80`
- Salida a internet hacia el portal. **No abre ningún puerto**: siempre pregunta
  él, así que no expone la impresora a la red.

## Instalación

**1. Registrar la caja en el portal.** Sistema → Prueba de impresión → «Cajas de
impresión» → *Registrar esta caja*. Elegí la sucursal y ponele un nombre que
diga cuál es (`Caja Salud 3`). El portal devuelve un **identificador** y un
**token**.

> El token se muestra **una sola vez**. No se puede volver a leer desde ninguna
> pantalla — un token que se puede releer es un token que viaja. Si se pierde,
> se registra la caja de nuevo.

**2. Copiar la carpeta a la computadora de la caja** y crear `agente.conf` al
lado de `agente.py`:

```ini
SUPABASE_URL=https://sacecdkdmsdvgqnrsett.supabase.co
SUPABASE_ANON_KEY=<la misma llave pública que usa el portal>
DEVICE_ID=<el identificador que dio el portal>
DEVICE_TOKEN=<el token que dio el portal>
# CORTAR=1   # sólo si el papel sale sin cortarse (ver abajo)
```

**3. Probarlo a mano** antes de dejarlo corriendo:

```bash
python3 agente.py
```

Mandá algo a imprimir desde el portal —Sistema → Prueba de impresión sirve— y
mirá que salga papel y que la consola diga `impreso`.

**4. Dejarlo prendido** con systemd:

```bash
sudo cp farmalasa-impresion.service /etc/systemd/system/
sudo systemctl enable --now farmalasa-impresion
journalctl -u farmalasa-impresion -f     # para verlo trabajar
```

## Cosas que conviene saber

**El corte del papel viene apagado.** La ticketera de las salas corta sola al
terminar el trabajo (medido con `lp -o raw`). `CORTAR=1` agrega el comando de
corte por si alguna no lo hace — se prende sólo si el papel sale sin cortarse,
con papel en la mano y no por las dudas.

**El agente no maqueta.** El contenido llega con sus columnas y sus códigos de
impresora ya adentro, igual que lo que recibe el programa del sistema de
facturación. La maquetación vive en `src/utils/ticketPrint.js`, y tiene que
seguir viviendo ahí: dos maquetadores se desincronizan y la diferencia sólo se
ve en el papel.

**No corras dos agentes contra la misma sala.** No imprime dos veces —la cola
usa `FOR UPDATE SKIP LOCKED`, así que dos lectores nunca se llevan la misma
fila— pero no hay motivo para tener dos.

**Un trabajo que queda a medias vuelve solo.** Si el agente se muere con el
papel en la mano, a los dos minutos ese trabajo vuelve a la cola. A los 3
intentos pasa a `ERROR` y deja de reintentarse: un ticket que no sale nunca
taparía a los que sí saldrían.

**⚠️ No reconfigures la cola `pos-80`.** Es por la que imprime hoy el sistema de
facturación. Si hiciera falta otra configuración, se crea una cola nueva al
mismo dispositivo y se pone su nombre al registrar la caja.
