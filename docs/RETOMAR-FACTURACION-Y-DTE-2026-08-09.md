# Facturación y envío a Hacienda — estado al 2026-08-09

Continúa y **reemplaza** a `RETOMAR-FICHAS-Y-DTE-2026-08-07.md`, que quedó
desactualizado en sus dos puntos principales. Todo lo de abajo está en
producción y verificado corriéndolo.

Empezó con dos preguntas del usuario —*«cuando dan observaciones, ¿dónde las
veo?»* y *«¿por qué no se corrigen según lo esperado del flujo?»*— y terminó
destapando cuatro procesos que informaban éxito sin hacer su trabajo.

---

## 1 · El circuito hoy

```
21:30 SV  sincronizar-fichas-clientes    ← cron 03:30 UTC
            lista = rechazados por Hacienda ∪ fichas sin distrito
            corrige la ficha DEL ERP (ver la tabla de decisión)
            espeja ERP → portal

22:30 SV  regularizar-dte                 ← cron 04:30 UTC
            envía lo que no tiene sello VÁLIDO + las anuladas
            registra cada intento en dte_mh_intentos
            ── y si quedó algún rechazo accionable:
               llama a la corrida de fichas (alcance «rechazos»)
               y REENVÍA, todo la misma noche

08:00 SV  alerta-barrido-dte-8am-sv       ← avisa cómo salió
cada 5m   check-sales-alerts              ← CCF con problema → campana + push
```

**La segunda vuelta es de este cambio.** Antes el ciclo tardaba un día: se
enviaba, el rechazo quedaba anotado, la corrida de fichas del día SIGUIENTE lo
corregía y recién ahí se reintentaba. `segundaVuelta` en el cuerpo es el freno
de recursión, y sólo arranca con 60 s de presupuesto restante — empezar la
cadena sin tiempo de terminarla dejaría la corrección hecha y el reenvío sin
hacer, que es el peor de los dos mundos.

⚠️ **No está demostrada en vivo.** Está desplegada y no se ejecutó ni una vez,
porque para dispararse necesita un rechazo accionable y no hay ninguno. La
primera prueba real es el primer caso que aparezca.

---

## 2 · La tabla de decisión, sobre la ficha DEL ERP

| estado de la ficha | acción |
|---|---|
| sin municipio | el triple por defecto |
| con municipio, sin distrito | el matcher (`elegirDistrito`) |
| rechazada por distrito | el triple por defecto |
| DUI que no cumple el algoritmo | borrarlo |
| rechazo no accionable (`fecEmi`) | nada — es informativo |

`DEFECTO` = **Chalatenango / Chalatenango Sur / CHALATENANGO** (4 / 36 / 7 en
códigos del ERP).

**Alcance, decidido por el usuario el 09-08:** en el ERP se escriben **sólo
consumidores** (`categoria = 'Consumidor'` o sin categoría). A los
contribuyentes se los espeja al portal y nada más — sus CCF pueden seguir
trabándose y está aceptado.

**El freno:** `dte_correcciones_ficha` anota qué se corrigió. Si Hacienda vuelve
a rechazar el mismo campo *después* de corregirlo, la ficha va a «Por revisar»
con motivo `rechazo_persistente` en vez de reintentar lo mismo cada noche.

---

## 3 · Por qué «bloque procesó 25,946 y ahora hay problemas»

Lo preguntó el usuario y era la pregunta correcta. `bloque` no falló: **la
corrida nocturna era un porte PARCIAL de `bloque.py`.**

```python
BORRAR_DUI_INVALIDO = True
DEFECTO = {'departamento': '4', 'municipio': '36', 'distrito': '7'}
if not campos.get('municipio'):   nuevos.update(DEFECTO)   # ① NO portada
elif not campos.get('distrito'):  elegir_distrito(...)     # ② sí portada
                                  # ③ borrar DUI inválido — NO portada
```

Se portó **la ②** —el matcher, lo difícil, verificado contra 25,946 decisiones—
y quedaron afuera las dos fáciles. Las reglas que el usuario dictó el 09-08 ya
estaban escritas en `bloque` desde el principio.

**Y la lista de trabajo cambió de fuente.** `bloque` leía la ficha del ERP —la
que viaja a Hacienda—; la nocturna preguntaba al ESPEJO
(`customers.distrito IS NULL`) y escribía en el ERP. Cuando las dos copias
divergen, mira la equivocada: una ficha con `CHALATENANGO` en el portal y el
distrito **vacío** en el ERP no era candidata, y era justo la que Hacienda
rechazaba.

---

## 4 · Los cuatro procesos que informaban éxito sin hacer nada

Todos comparten la misma forma: **una pieza portada a un contexto donde su
premisa dejó de cumplirse**, y un silencio que se lee igual que el éxito.

| qué | por qué fallaba | desde cuándo |
|---|---|---|
| **fusionar duplicados** | `auth_can_edit_any` resuelve al empleado desde el JWT; el cron usa `service_role` → `FORBIDDEN` | desde que se automatizó |
| **el espejo ERP → portal** | un `erp_id` duplicado abortaba el lote de 70 y el error iba sólo a `console.error` | siempre |
| **rutas mudas del bucle** | fichas sin número del ERP salían por un `continue` sin contador ni destino | siempre |
| **el aviso de CCF** | existía **sólo como push**: cero filas en `notifications`; y el log de «ya avisé» se escribía ANTES de enviar, así que un push perdido silenciaba ese correlativo para siempre | siempre |

Los cuatro están corregidos. El del espejo reintenta **fila por fila** cuando el
lote falla; el del aviso usa `notify_employees` (campana + push) y escribe el log
**después** de confirmar.

---

## 5 · «Sin sello» significa sin sello VÁLIDO — en los tres sitios

`recibido_mh` es `text` y guarda 40 caracteres. Preguntarle `IS NULL` —o peor,
`!!valor`— da por buena cualquier basura escrita ahí. Estaba mal en tres
lugares, y **los tres tenían que fallar juntos** para perder una factura:

| dónde | preguntaba |
|---|---|
| el filtro del barrido | `recibido_mh IS NULL` |
| la guarda justo antes de enviar | `!!ahora?.recibido_mh` |
| la cola de Pendiente MH | `recibido_mh IS NULL` |

Corregir sólo el filtro no alcanzaba: la factura entraba a la cola y se omitía
igual con «ya estaba resuelta», **afirmándolo sobre una que nunca se envió**.

**Regla del usuario, textual:** lo único que NO se manda a Hacienda es lo que
**ya tiene sello** y su observación es de otra cosa.

Caso cerrado: `0000002848_COF` del 16-may-2025 con `recibido_mh = 'undefined'`
llevaba un año figurando como confirmada. Se envió y entró con sello real. Era
la sobreviviente del incidente que originó la pestaña de Observaciones — de las
24 se limpiaron 23 y quedó ésta, marcada como «solventada», que significa
*alguien la miró*, no *se envió*.

---

## 6 · La pestaña de Observaciones

Es la red de seguridad: las otras cuatro miran **un** problema conocido cada
una, ésta mira cualquier cosa que no cuadre. Siete reglas, catálogo del lado del
servidor (`get_invoice_observations`), y un código que el frontend no conozca
**se muestra crudo** en vez de ocultarse.

**«No cuadra» era la retención.** Marcaba 44 facturas; las 44 tenían retención,
las 44 cuadraban al restarla, y la suma de las diferencias ($179.36) era
exactamente la suma de las retenciones. En la otra dirección: hay 44 facturas
con retención en toda la base, las mismas, y cero cuadraban con la fórmula
vieja. El total del ERP ya viene con la retención restada (Art. 162).

Corregida, la categoría queda en cero. Un detector que marca 44 casos legítimos
enseña a ignorarlo, y ahí se pierde el descuadre real.

**Y desde el 09-08 muestra también el rechazo de Hacienda** (`RECHAZADA_POR_
HACIENDA`, octava regla). Lo pidió el usuario al preguntar dónde se ven las
observaciones del barrido: no se veían: el motivo vivía en `dte_mh_intentos` y
en el JSON de la bitácora, y en pantalla la factura aparecía en Pendiente MH sin
decir por qué.

El criterio de entrada es el del usuario —*«las que después de corregir, y
volver a enviar y aun así no se envían»*— y es la frontera que la pestaña ya
tenía: **¿se resuelve solo o hay que tocarlo?**. Sin sello válido, y además: el
motivo no es accionable (nunca se va a corregir solo), o ya se intentó ≥ 2 veces
(la segunda vuelta corrige y reenvía la misma noche, así que el segundo rechazo
ya es «no alcanzó»). Un rechazo accionable con un solo intento **no** entra:
está en curso.

Dos propiedades que hay que conservar si se toca:

- **El motivo va como texto** (`motivos_mh`), no como código. Un código no dice
  qué corregir.
- **No se puede solventar.** `sales_observation_resolutions` se lleva por
  `invoice_id` a secas, así que solventar saca la factura ENTERA de la pestaña
  — y «alguien la miró» no es «se envió». Es exactamente lo que dejó al
  `0000002848_COF` un año figurando como confirmada. Se cierra sola cuando
  llegue el sello.

---

## 7 · Piezas nuevas de este cambio

| pieza | qué es |
|---|---|
| `dte_rechazos_vigentes` | el último rechazo de cada factura sin sello, con el motivo clasificado y la ficha al lado. Une `observaciones` y `descripcion_msg` — **3 de 4 rechazos venían sólo en el segundo**, así que la consulta «oficial» del doc anterior no los mostraba |
| `clasificar_observacion_mh` | ahora entiende también el puntero de JSON Schema (`#/receptor/x`), no sólo `[receptor.x]` |
| `fichas_para_corregir_dte()` | la lista de trabajo: reactiva ∪ preventiva, con `puede_escribir` y `ya_corregido` |
| `dte_correcciones_ficha` | qué se corrigió y por qué. Append-only. Es el freno contra el bucle |
| `escribirCampos` / `ponerUbicacion` | escritura de varios campos y de la ubicación en cascada |
| `tieneSello()` | la forma del dato, no su ausencia de null |

---

## 8 · Trampas medidas — leer antes de tocar el ERP

**Los códigos de ubicación son POR DEPARTAMENTO, no globales.** El distrito `7`
es «CHALATENANGO» en Chalatenango y **«TEJUTEPEQUE» en Cabañas**. Copiar un
código de otra ficha escribe un lugar ajeno — casi pasa sobre una ficha que
alimenta documentos fiscales, y lo cazó un ensayo en seco que imprimía la
*etiqueta*, no sólo el código.

**Los selects son encadenados.** La lista de municipios depende del departamento
ya guardado, y la de distritos del municipio ya guardado: hay que escribir en
cascada releyendo entre paso y paso. No se pueden mandar los tres juntos.

**Cambiar el padre VACÍA a los hijos, y eso es correcto.** La guarda de
`escribirCampo` lo leía como «se perdieron campos» y abortaba, dejando la ficha
a medio escribir. `escribirCampos` recibe qué vaciados son esperados.

**El parser tiene que leer `<textarea>`.** Uno incompleto me hizo creer por un
momento que había borrado la dirección de un cliente. Usar `parsearFicha` de
`_shared/erp-clientes.ts`.

---

## 9 · Números al cierre

| | antes | ahora |
|---|---|---|
| rechazos vigentes accionables | 4 | **0** |
| facturas pendientes de sello | 1 | **0** |
| facturas con sello inválido | 1 | **0** |
| observaciones abiertas | 43 | **0** |
| fichas sueltas sin número del ERP | 83 | **17** |
| fallidas de la corrida de fichas | 14 | **0** |

---

## 10 · Abierto — por dónde seguir

**a) La segunda vuelta, sin ejercitar.** Es lo primero que hay que ver
funcionando. Necesita un rechazo real.

**b) Las fichas sueltas siguen naciendo.** 16-28 por día desde el 07-08, contra
1-2 antes. Lo que cambió no es que nazcan más: es que la limpieza estaba muerta
(§4). **Mirar si el número diario baja.** Si nacen 20 y se ligan 20 está en
equilibrio; si sube, el sospechoso es el tope de 25 consultas al ERP por corrida
de `sync-dte-sales`.

**c) 17 fichas sin factura de la cual deducir su número.** No se resuelven
solas: van a «Por revisar» con motivo `sin_numero_erp`. Hay que ligarlas a mano
o darlas de baja.

**d) Los contribuyentes.** 77 fichas sin distrito quedan fuera del alcance por
decisión. Sus CCF pueden trabarse — es una decisión revisable, no un olvido.

**e) 8 anulaciones en lista negra.** CCF anulados en el ERP que nunca se
emitieron ante Hacienda. Decisión de negocio.

**f) Push en 4 de 59 tipos de notificación.** Viene del 01-08 y sigue abierto.
El aviso de CCF ya no depende de eso —deja rastro en la campana— pero el resto
sí.

**g) «Recibido CON observaciones» no avisa a nadie.** Hacienda a veces acepta
—hay sello, o sea que entró— y aun así tiene algo que decir. El barrido lo
cuenta (`con_observaciones`) y sube la severidad de la bitácora a WARNING, pero
`alertar_barrido_dte` corta con `fallidas = 0` y no manda nada; y como la
factura sí tiene sello, tampoco cae en Observaciones. Pasó tres veces la noche
del 09-08. Es una decisión pendiente, no un olvido: hay que definir si merece
aviso o una regla propia.

**h) La regla nueva no alcanza ninguna factura todavía.** `RECHAZADA_POR_
HACIENDA` está ejercitada contra escenarios sintéticos (los 7 de accionable ×
intentos × forma del sello), no contra una fila real en pantalla — hay 0
rechazos vigentes. Igual que la segunda vuelta: la primera prueba real es el
primer caso que aparezca, y conviene mirar las dos juntas cuando llegue.

---

## 11 · Operar

**Ver los rechazos, ya clasificados:**
```sql
select correlativo, cliente, categoria, motivo, campo_ficha, accionable
from public.dte_rechazos_vigentes order by accionable desc;
```

**La lista de trabajo de la corrida:**
```sql
select origen, campo, count(*), count(*) filter (where puede_escribir)
from public.fichas_para_corregir_dte() group by 1,2;
```

**Disparar a mano** (el cuerpo de `sincronizar-fichas-clientes` acepta
`{"alcance":"rechazos"}` para acotar):
```sql
select net.http_post(
  url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/regularizar-dte',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets
                                 where name='admin_invoke_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 180000);
-- la respuesta llega después, en net._http_response
```

⚠️ `check-sales-alerts` usa **otro** secreto: además del Bearer necesita
`x-cron-secret` con `cron_invoke_secret`.

⚠️ **Al redesplegar cualquier edge function de este circuito:** van con
`--no-verify-jwt`, y el CLI se traga el `.env` del repo — `mv .env .env.bak`
primero. Ver `reference_edge_function_deploy_workaround`.
