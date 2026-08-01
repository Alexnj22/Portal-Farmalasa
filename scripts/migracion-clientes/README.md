# Migración de fichas de clientes ERP ↔ Portal

Herramienta para completar y corregir las fichas de clientes en el ERP
(`clientesdte3.oss.com.sv/farma_salud`) y espejar el resultado a
`customers` en el portal.

**Estado al 2026-08-01, 05:00 UTC.** Escrito para retomar sin contexto previo.

---

## 1. Dónde estamos

```
catálogo del ERP        27,569 fichas   (crece: eran 27,551 el 31-jul)
procesadas              585 fichas      (checkpoint.json)
portadas al portal      582 de 24,502   (customers.erp_id no nulo)
pendientes              ~27,000
```

Lo corregido: ~404 distritos, 3 nombres a mayúscula, 3 teléfonos y 11 DUI
borrados (con su número original guardado en `revision_manual.json`). **Cero
campos perdidos y cero alterados en 585 fichas.** El único fallo fue un
transitorio del ERP que entró a la primera al reintentarlo.

Medición real: **1.37s por petición**. El catálogo completo son ~34 horas.

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
python3 bloque.py --desde-erp 500              # SIMULACIÓN: no escribe nada
python3 bloque.py --desde-erp 500 --escribir   # escribe y verifica
```

`--desde-erp N` toma las N fichas del catálogo que el checkpoint no tenga con
las reglas actuales. También existe `--entrada archivo.json` con una lista
`[{id, name}]` del portal, que es como se hicieron los primeros bloques.

**Siempre simular primero y mirar los DUI y los rechazos.** El resto se verifica
solo.

### Qué produce

| archivo | qué es |
|---|---|
| `checkpoint.json` | **el estado**. Una entrada por ficha, con la versión de reglas. Perderlo = releer todo |
| `portal_pendiente.jsonl` | cola del espejo, append-only. Una línea por ficha procesada |
| `ambiguos.json` | nombres sin match, duplicados, rechazos del ERP |
| `revision_manual.json` | casos que requieren una persona (hoy: DUI inválidos) |
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
normal: el portal solo tiene clientes que aparecieron en una venta (24,502)
contra 27,551 fichas del ERP. **No se crean**, solo se reportan.

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

Del matcher de distritos, medido sobre 85 direcciones reales: **~40% se resuelve
por la dirección, ~16% queda ambiguo y ~44% es determinista** — o sea inventado
dentro del municipio correcto. A escala del catálogo son del orden de 10,000
fichas con un distrito sorteado. Está aceptado, pero conviene tenerlo presente.

## 8. Decisiones pendientes

1. ~~Qué se hace con los DUI inválidos~~ — **RESUELTO el 2026-08-01: se borran.**
   Un DUI que no pasa el verificador está mal, y eso es aritmética. Lo que se
   agregó es la red: el número original se registra en `revision_manual.json`
   **antes** de vaciarlo, así que borrar dejó de ser irreversible y se puede
   corregir con el cliente después. Dato que acotó el riesgo: las 10 fichas del
   muestreo son consumidor final exclusivo (0 CCF), y ahí el DUI del receptor no
   es campo requerido — el número incorrecto no viajaba a Hacienda.
2. **Las 4 fichas diferidas** — `FELIX ANTONIO RECINOS CARCAMO` (portal 5242),
   `NURIA ROXANA VILLANUEVA` (18312) e `YNES ANTONIO ARDON` (13810) tienen dos
   fichas cada uno en el ERP. Están **corregidas en el ERP**, pero el espejo no
   se puede aplicar: `customers` tiene una fila por cliente y hay que decidir cuál
   `erp_id` gana. Ver `duplicados_erp.json`.
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
