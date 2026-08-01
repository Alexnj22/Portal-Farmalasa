# Migración de fichas de clientes ERP ↔ Portal

Herramienta para completar y corregir las fichas de clientes en el ERP
(`clientesdte3.oss.com.sv/farma_salud`) y espejar el resultado a
`customers` en el portal.

**Estado al 2026-08-01, 09:00 UTC.** Escrito para retomar sin contexto previo.

---

## 1. Dónde estamos

```
catálogo del ERP        27,575 fichas   (crece: 27,551 el 31-jul, 27,569 al alba)
procesadas              1,085 fichas    (checkpoint.json)
portadas al portal      993 de 24,509   (customers.erp_id no nulo)
pendientes              26,576          (54 bloques de 500)
```

Bloques cerrados: el primero (por nombre, desde el portal) y **erp 283–1000**,
el primero corrido con `--una-pasada`. Ese segundo bloque: 481 corregidos OK,
17 sin cambios, 2 saltados, **0 a revisar, 0 rechazos, 0 reintentos**. Cero
campos perdidos y cero alterados en las 1,085 fichas acumuladas.

Medición real: **1.37s por petición**, ~5.4s por ficha con las pausas. Un bloque
de 500 son ~45 min y el catálogo completo ~34 horas.

### El hueco entre leer y escribir no era teórico

En el bloque erp 283–1000 se midió: **1 de 499 fichas fue editada por una
persona en el ERP** durante los ~50 minutos entre la simulación y la corrida.
Fue la `erp 885` (PLACIDA ACOSTA DE PACHECO), que pasó de no tener distrito a
tener CHALATENANGO — puesto a mano.

El plan de la simulación decía escribirle `CONCEPCIÓN QUEZALTEPEQUE`, que es un
sorteo determinista. Con `--una-pasada` la ficha se releyó justo antes de
escribir, se vio el distrito real y **no se tocó**. Verificado en el portal:
quedó CHALATENANGO.

O sea que la tasa de edición concurrente no es cero, y el POST manda los 21
campos. Por eso `--una-pasada` es el modo de la corrida larga y no una
optimización opcional.

## 2. Puesta en marcha

Faltan dos archivos que **no se versionan** (uno es secreto, el otro pesa 2.6 MB
y envejece):

**`erp.env`** — cookie de sesión del ERP. Formato:

```
ERP_COOKIE=PHPSESSID=<valor>
```

Se saca del navegador con la sesión abierta (DevTools → Application → Cookies).
Caduca; cuando caduca, cualquier script corta con
`SESIÓN CAÍDA: refrescá la cookie en erp.env`. **El checkpoint hace que retomar
sea solo volver a correr.**

**`rep_cli.html`** — índice del catálogo. Se regenera:

```bash
python3 refrescar_catalogo.py
```

Verificá que el arnés pase antes de tocar nada:

```bash
python3 probar_offline.py     # ~50 comprobaciones, no toca el ERP ni la base
```

## 3. Cómo se corre un bloque

```bash
python3 bloque.py --desde-erp 500                          # SIMULACIÓN: no escribe nada
python3 bloque.py --desde-erp 500 --escribir --una-pasada   # escribe y verifica
```

`--desde-erp N` toma las N fichas del catálogo que el checkpoint no tenga con
las reglas actuales. También existe `--entrada archivo.json` con una lista
`[{id, name}]` del portal, que es como se hicieron los primeros bloques.

**Siempre simular primero y mirar los DUI y los rechazos.** El resto se verifica
solo.

### `--una-pasada` es el modo de la corrida larga

Lee, corrige, verifica y espeja **cada ficha antes de mirar la siguiente**, en
vez de planear las 500 y después escribir las 500. Cuesta exactamente las mismas
peticiones —1,230 por bloque de 500— y cierra el hueco entre la lectura y la
escritura, que en dos fases llega a **15 minutos**. Como el POST manda los 21
campos, ese hueco es la única forma en que la corrida podría pisar una edición
que otra persona hizo en el ERP mientras tanto.

Sin el flag el comportamiento es el de siempre (dos fases), que es lo que
conviene cuando querés ver el plan entero antes de que se escriba nada. En
simulación el flag se ignora: no hay escritura que acercar.

### Reintento del glitch del ERP

El ERP falla de dos maneras y el script las trata distinto:

| respuesta | qué hace |
|---|---|
| no es su JSON (`Proceso no encontrado` en texto plano, un 502, vacío) | **reintenta**, hasta 3, con backoff 2s/4s |
| su JSON diciendo que no (`Ya se registro un cliente con estos datos!`) | **no reintenta** — no cambia por insistir, y ese rechazo es un hallazgo |

Reintentar es seguro porque el POST es idempotente: `process=edit` con id fijo y
los 21 campos deja la ficha igual se aplique una vez o tres. Los intentos quedan
anotados en `bloque_resultado.json` y en `ambiguos.json`, así que un rechazo que
sobrevivió tres intentos no se lee igual que uno contestado a la primera.

Existe porque pasó: **una vez en 365 escrituras**, y el mismo payload entró a la
primera al reintentarlo. A escala de 20,000 escrituras son ~55 cortes.

### Qué produce

| archivo | qué es |
|---|---|
| `checkpoint.json` | **el estado**. Una entrada por ficha, con la versión de reglas. Perderlo = releer todo |
| `portal_pendiente.jsonl` | cola del espejo, append-only. Una línea por ficha procesada |
| `ambiguos.json` | nombres sin match, duplicados, rechazos del ERP |
| `revision_manual.json` | **el número original de cada DUI borrado**. ACUMULA entre bloques — es lo único que hace reversible el borrado, y hasta el 2026-08-01 cada corrida pisaba la anterior |
| `bloque_plan.json` / `bloque_resultado.json` | plan y resultado del último bloque |
| `duplicados_erp.json` | los 19 nombres duplicados del catálogo — lista de purga |

## 4. El espejo al portal

`customers` **no tiene policy de escritura** — su única policy es
`customers_select` (SELECT, `authenticated`, `USING (true)`). Para escribir se
creó el RPC `aplicar_espejo_erp(p_filas json)`
(migración `20260801044543`), SECURITY DEFINER, concedido solo a
`authenticated` y `service_role`. Empareja por `search_name`, **nunca inserta**,
y omite los nombres que llegan repetidos. Devuelve
`{recibidas, duplicadas_omitidas, actualizadas, sin_match}`.

Se aplica con:

```bash
python3 aplicar_espejo.py            # muestra cuántas hay en cola
python3 aplicar_espejo.py --aplicar  # las manda
```

Se autentica con `portal-user` / `portal-password` del `.env` del repo — el
portal arma el correo como `usuario@farmalasa.app`, y el script lo completa si
en el `.env` está el usuario pelado. No hace falta la service-role key.

`sin_match` cuenta las fichas del ERP cuyo nombre no existe en `customers`. Es
normal: el portal solo tiene clientes que aparecieron en una venta (24,509)
contra 27,575 fichas del ERP. **No se crean**, solo se reportan.

### El espejo NO pisa lo que se editó desde el portal

Hasta el 2026-08-01 sí lo hacía. El RPC reescribía las 15 columnas sin
condición y, medido en vivo a las 16:01 UTC, de las 2 fichas con edición del
portal **pisó las 2** — sin dejar rastro, porque `customers` no tiene ningún
trigger y la bitácora seguía diciendo que la corrección estaba vigente. Además
escribía NULL cuando el ERP no traía el dato, y el 98% de las fichas vienen sin
correo: cualquier correo cargado a mano se borraba en la corrida siguiente.

Corregido en la migración `20260801163144`. La regla es **el ERP manda**, y lo
que se protege no es "el portal gana" sino el tramo en que una edición todavía
no tuvo chance de llegar al ERP:

| situación | qué hace |
|---|---|
| el ERP no manda el dato (campo ausente) | no toca la columna |
| no hay edición del portal pendiente | manda el ERP |
| hay edición pendiente y el ERP sigue igual que cuando se editó | respeta la edición |
| hay edición pendiente **y el ERP también cambió** | manda el ERP, y el descarte se anota en `espejo_conflictos` |

La marca de "pendiente" es `customers_changelog.erp_synced_at IS NULL`. Cuando
la Fase 2 empuje la edición al ERP y la marque, la protección se levanta sola y
el ERP vuelve a mandar. **La Fase 2 no debe empujar una entrada que figure en
`espejo_conflictos`**: el ERP ya se movió más allá de ese valor.

El RPC además dejó de reescribir filas que no cambiaron — la misma cola pasó de
826 filas actualizadas a 1.

## 5. Las reglas

Versionadas en la constante `REGLAS` de `bloque.py`. El checkpoint guarda con
cuál se procesó cada ficha, y **subir el número reprocesa todo** — es lo que
hace que una regla nueva se aplique a lo ya hecho.

| # | regla |
|---|---|
| — | **Solo se edita la categoría `Consumidor`.** Cualquier otra se lee y se espeja al portal, pero no se toca en el ERP |
| 1 | **Distrito**, si está vacío: nombre completo en la dirección → token → determinista `hash(id) % n` |
| 2 | **Teléfono**: 8 dígitos, o 503 + 8. Si no cumple → `23010013` |
| 3 | **Nombre** → MAYÚSCULA (el 91% del catálogo ya lo está) |
| 5 | **DUI inválido → se borra**, y el número original queda en `revision_manual.json` antes de vaciarlo. `--dui-invalido reportar` lo deja intacto |
| — | **Sin municipio** → default Chalatenango / Chalatenango Sur / CHALATENANGO |

## 6. Lo que hay que saber del ERP

Esto costó una tarde de diagnóstico. No lo redescubras.

1. **Un POST parcial BORRA lo que no mandás.** Se reenvían los 21 campos.
2. **Los valores van CRUDOS, sin `strip()`.** El control de duplicados compara el
   nombre tal cual, y hay fichas cuya única diferencia es un espacio inicial.
   Recortarlo las hace colisionar y el ERP rechaza el guardado **entero**.
3. **Leé siempre la respuesta**: `{"typeinfo":"Error","msg":"Ya se registro un
   cliente con estos datos!"}`. Sin eso, un rechazo se ve idéntico a "el campo no
   se aplicó" y perseguís el problema equivocado.
4. **Los ids de distrito NO son globales** — van por (departamento, municipio),
   vía `_helpers.php` con `{process:'getDistrito', id_departamento, id_municipio}`.
   El `8` es MEJICANOS en San Salvador y DULCE NOM MARÍA en Chalatenango.
   **En el portal se guarda el NOMBRE, nunca el id.**
5. **El combo trae 3 pseudo-clientes que no son fichas**: `TODOS`, `-1` (CLIENTES
   VARIOS), `-2` (CLIENTE FRECUENTE NUEVO). Baldes de mostrador del POS. El
   índice ya los excluye (solo acepta id > 0).
6. **Categorías (6)**: Consumidor, Contribuyente, Gran Contribuyente,
   Contribuyente Exento, Extranjero, Menor de edad. El corte es por igualdad
   contra `'Consumidor'`, así que una categoría nueva se saltea sola.

## 7. Composición del catálogo (muestra de 200 fichas al azar)

```
categoría      99% Consumidor · 1% Contribuyente
departamento   98% Chalatenango · 1% San Salvador
sin distrito   95%   ← esto es casi todo el trabajo
teléfono       99% con 8 dígitos · 0% vacíos
DUI            66% válido · 30% vacío · 2% inválido
```

### El matcher de distritos rinde MENOS de lo que decía la primera medición

La medición vieja (85 direcciones del `ccf_erp.json`) daba ~40% resuelto por
dirección, ~16% ambiguo y ~44% determinista. **Esa muestra eran contribuyentes**
—negocios, con direcciones fiscales completas— y el catálogo es 99% consumidor
final. Medido sobre las 500 fichas del bloque erp 283–1000, que sí son la
población real:

```
determinista (la dirección no dice)  374   78%   ← distrito sorteado
dirección (nombre completo)           88   18%
dirección (abreviatura)               19    4%
ambiguo                                0    0%
```

O sea que a escala del catálogo no son ~10,000 fichas con un distrito inventado
dentro del municipio correcto: son del orden de **21,000**. Sigue estando
aceptado —el municipio, que es lo que importa, siempre es el real, y el sorteo
es determinista y auditable— pero el número honesto es ese, no el anterior.

Los 0 ambiguos no son una mejora: son la otra cara del mismo dato. Una dirección
que no nombra ningún distrito no puede nombrar dos.

## 8. Decisiones pendientes

1. ~~Qué se hace con los DUI inválidos~~ — **RESUELTO el 2026-08-01: se borran.**
   Un DUI que no pasa el verificador está mal, y eso es aritmética. Lo que se
   agregó es la red: el número original se registra en `revision_manual.json`
   **antes** de vaciarlo, así que borrar dejó de ser irreversible y se puede
   corregir con el cliente después. Dato que acotó el riesgo: las 10 fichas del
   muestreo son consumidor final exclusivo (0 CCF), y ahí el DUI del receptor no
   es campo requerido — el número incorrecto no viajaba a Hacienda.
2. ~~Las fichas duplicadas~~ — **RESUELTO el 2026-08-01.**
   `python3 revisar_duplicados.py` lee las dos fichas de cada nombre y compara
   campo por campo: 17 de los 19 se resolvieron solos y ya están espejados
   (los tres que estaban trabados —FELIX ANTONIO RECINOS CARCAMO, NURIA ROXANA
   VILLANUEVA, YNES ANTONIO ARDON— ya tienen `erp_id` en el portal).

   Quedan **dos que necesitan una persona**, porque las dos fichas traen DUI
   distintos y eso ya no es un duplicado tipográfico — pueden ser dos personas
   con el mismo nombre:

   | nombre | fichas | DUI en conflicto |
   |---|---|---|
   | FLOR DE MARIA GUARDADO GUARDADO | 3883 / 8598 | `01404969-2` vs `02055661-5` |
   | WILLIAM ENRIQUE ALEMAN ALFARO | 7280 / 7284 | `01347642-2` vs `08666142-6` |

   Y **un caso donde elegir una ficha descarta un dato**: MOISES RODOLFO
   HERNANDEZ ANAYA gana con la 26151 (NIT, NRC, correo) y con eso se pierde el
   `dui='05216466-4'`, que solo estaba en la 3906. Eso se arregla purgando el
   duplicado EN EL ERP, no en el espejo: fusionar los campos daría una fila del
   portal que no coincide con ninguna ficha real. Está anotado en
   `duplicados_analisis.json` bajo `pierde`.
3. **Dos distritos probablemente mal**, ya escritos, del tramo débil del matcher:
   `BARRIO LAS FLORES → SAN JOSE FLORES` (erp 3461) y
   `COL SAN FRANCISCO → SAN FRANCISCO LEMPA` (erp 1672).
4. ~~Credenciales del portal~~ — **RESUELTO**: `aplicar_espejo.py` se autentica
   solo y llama al RPC. Un bloque de 500 se espeja en dos llamadas.
5. **Avisarle a soporte del ERP** antes de la corrida larga. No por permiso: el
   catálogo completo son ~12-15 horas de tráfico automatizado contra el servidor
   del proveedor, y el riesgo real es que alguien vea un cambio masivo y
   "restaure de backup".

## 9. Módulo de Clientes en el portal

El prompt para construirlo está en `docs/PROMPT-MODULO-CLIENTES.md`.
