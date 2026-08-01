# Migración de fichas de clientes ERP ↔ Portal

Herramienta para completar y corregir las fichas de clientes en el ERP
(`clientesdte3.oss.com.sv/farma_salud`) y espejar el resultado a
`customers` en el portal.

**Estado al 2026-08-01, 05:00 UTC.** Escrito para retomar sin contexto previo.

---

## 1. Dónde estamos

```
catálogo del ERP        27,569 fichas   (crece: eran 27,551 el 31-jul)
procesadas              92 fichas       (checkpoint.json)
portadas al portal      179 de 24,502   (customers.erp_id no nulo)
pendientes              ~27,400
```

Lo corregido hasta ahora: 42 distritos, 3 nombres a mayúscula, 2 teléfonos y
1 DUI borrado (`00000003-0`, relleno evidente). Cero campos perdidos, cero
alterados, cero rechazos del ERP en las últimas dos corridas.

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

Hoy el espejo se aplica pasando el JSON a mano. **Para automatizarlo el script
necesita autenticarse** (usuario y contraseña de una cuenta del portal, no la
service-role key): con eso llamaría al RPC directo y dejaría de hacer falta
mover el payload a mano. Es la decisión pendiente #4.

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
| 4 | **DUI inválido → se REPORTA, no se borra.** Ver decisión #1 |
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

1. **Qué se hace con los DUI inválidos.** Al simular 500 aparecieron 10, y a
   diferencia del relleno de ayer (`00000003-0`) **todos tienen estructura de DUI
   real** en fichas de personas con nombre y apellido: casi seguro son DUI buenos
   con un dígito mal tecleado. Por eso el default pasó a **reportar**. Con
   `--dui-invalido borrar` se recupera el comportamiento viejo. A escala serían
   ~690 borrados irreversibles.
2. **Las 4 fichas diferidas** — `FELIX ANTONIO RECINOS CARCAMO` (portal 5242),
   `NURIA ROXANA VILLANUEVA` (18312) e `YNES ANTONIO ARDON` (13810) tienen dos
   fichas cada uno en el ERP. Están **corregidas en el ERP**, pero el espejo no
   se puede aplicar: `customers` tiene una fila por cliente y hay que decidir cuál
   `erp_id` gana. Ver `duplicados_erp.json`.
3. **Dos distritos probablemente mal**, ya escritos, del tramo débil del matcher:
   `BARRIO LAS FLORES → SAN JOSE FLORES` (erp 3461) y
   `COL SAN FRANCISCO → SAN FRANCISCO LEMPA` (erp 1672).
4. **Credenciales del portal** para que el script llame al RPC del espejo por sí
   mismo. Sin eso el payload pasa a mano, bloque por bloque.
5. **Avisarle a soporte del ERP** antes de la corrida larga. No por permiso: el
   catálogo completo son ~12-15 horas de tráfico automatizado contra el servidor
   del proveedor, y el riesgo real es que alguien vea un cambio masivo y
   "restaure de backup".

## 9. Módulo de Clientes en el portal

El prompt para construirlo está en `docs/PROMPT-MODULO-CLIENTES.md`.
