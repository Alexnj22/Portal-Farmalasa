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

**¿Cómo sé que está funcionando?**
En el portal, esa caja va a decir **«ahora mismo»** al lado del nombre. Si dice
«sin instalar», el código nunca se canjeó; si dice «hace 3 h», la computadora
está apagada o sin internet.

**¿Cómo lo veo trabajar?**

```bash
sudo journalctl -u farmalasa-impresion -f
```

**El papel sale pero no se corta.**
Editá `/opt/farmalasa/agente-impresion/agente.conf`, quitale el `#` a la línea
`CORTAR=1` y reiniciá con
`sudo systemctl restart farmalasa-impresion`. Viene apagado porque la ticketera
de las salas corta sola, y prender un comando de corte que no hace falta puede
hacer que salga basura.

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

**El agente no maqueta.** El contenido llega con sus columnas y sus códigos de
impresora ya adentro, igual que lo que recibe el programa del sistema de
facturación. La maquetación vive en `src/utils/ticketPrint.js` y tiene que
seguir viviendo ahí: dos maquetadores se desincronizan y la diferencia sólo se
ve en el papel.

**Un trabajo que queda a medias vuelve solo.** Si el agente se muere con el
papel en la mano, a los dos minutos ese trabajo vuelve a la cola. A los 3
intentos pasa a `ERROR` y deja de reintentarse: un ticket que no sale nunca
taparía a los que sí saldrían. La cola se purga a los 14 días.

**⚠️ No reconfigures la cola `pos-80`.** Es por la que imprime hoy el sistema de
facturación. Si hiciera falta otra configuración, se crea una cola nueva al
mismo dispositivo y el instalador te deja elegirla.
