# Fichas de clientes y envío a Hacienda — estado al 2026-08-07

Empezó con una pregunta simple: *«si validás una factura y el MH devuelve
observaciones, las podés ver?»*. Se podían, pero estaban enterradas, y tirando
de ese hilo salió una cadena de problemas encadenados que terminó en un proceso
automático nocturno.

Este documento es para retomarlo. **Todo lo de abajo está en producción.**

---

## 1 · El circuito, de punta a punta

```
21:30 SV  sincronizar-fichas-clientes   ← cron sincronizar-fichas-clientes-2130-sv
            1. fusiona fichas repetidas
            2. aparta las dudosas en «Por revisar»
            3. completa el distrito que falte
            4. copia los datos del ERP al portal

22:30 SV  regularizar-dte               ← cron regularizar-dte-2230-sv
            envía a Hacienda lo pendiente, ya con las fichas corregidas
            registra CADA intento en dte_mh_intentos

08:00 SV  alerta-barrido-dte-8am-sv     ← avisa cómo salió
```

El orden importa: si las fichas se corrigen después del envío, el envío recibe
rechazos por datos que ya estaban arreglados.

---

## 2 · Qué se descubrió (y qué se creía mal)

**El rechazo era el distrito vacío.** DTE 2.0 lo exige en el receptor. Tres
facturas llevaban días colgadas por eso; las tres entraron al corregirlo.

**`identificacion.fecEmi` NO es del cliente.** Es la fecha de emisión del
documento, y «DIFIERE DE LA FECHA DE ENVIO» aparece siempre que se transmite
hoy una factura emitida antes. No se arregla y no se debe: cambiarla sería
alterar un dato fiscal. Es la observación más común y es informativa.

**Un rechazo perdía la estructura.** Las observaciones llegaban concatenadas
dentro del texto del error, así que justo el caso accionable era el que no se
podía filtrar. Corregido con `RechazoMH` en `_shared/erp-dte.ts`.

**Dos diagnósticos que me equivoqué y corrigió medir:**

- *«El backlog de fichas es riesgo fiscal»* — **falso**. El ERP ya las tenía
  completas; el desactualizado era el portal. Sus facturas ya salían válidas.
  El riesgo real eran las fichas **nuevas** del ERP que nunca pasaron por
  `bloque.py`.
- *«No hace falta el id del cliente en el JSON de ventas»* — cierto para
  limpiar después, **falso** para no ensuciar. Sin el id en el momento de la
  venta, el sync seguía creando duplicados.

---

## 3 · Las piezas nuevas

| pieza | qué es |
|---|---|
| `dte_mh_intentos` | Cada envío al MH con su sello, observaciones y **qué se corrigió antes**. Append-only. 61 filas al cierre |
| `clasificar_observacion_mh` | Texto crudo del MH → familia + campo de la ficha + accionable |
| `extraer_observaciones_mh` | Saca las rutas `[receptor.x]` de cualquier texto, venga como array o dentro de un error |
| `clientes_sin_distrito_corregibles` | El alcance, del lado del servidor, para que el script no duplique el criterio |
| `fusionar_cliente_duplicado` | Une la ficha suelta con la real. El destino lo resuelve la función desde el `erp_id` |
| `dte_excluidas_del_barrido` | Lista negra explícita: facturas que no se intentan nunca, con motivo |
| `upsert_customers_v2` | Liga por número del ERP, no por nombre |
| `_shared/distrito.ts` | El matcher, **traducido y verificado** (ver §5) |
| `_shared/erp-clientes.ts` | Trato con la ficha del ERP. Lo usan las dos funciones |
| `sincronizar-fichas-clientes` | La corrida diaria |

---

## 4 · Lo que se arregló de raíz

**El sync creaba un cliente por cada nombre que no reconocía.** Como el nombre
viene de cómo se escribió la factura, cualquier letra distinta abría ficha
nueva: ~22 duplicados por día.

Normalizar el texto **no servía** — medido contra los 68 duplicados reales:

| criterio | evitaba |
|---|---|
| nombre exacto (lo de antes) | 0 de 68 |
| sin acentos ni ñ | 0 |
| + espacios colapsados | 1 |
| + solo alfanumérico | 3 |

El 96% son nombres genuinamente distintos (`VAQUEZ`/`VASQUEZ`,
`ALVARNEGA`/`ALVARENGA`). Ninguna regla de texto los une sin unir además a
personas que no lo son.

Por eso `sync-dte-sales` ahora **le pregunta al ERP a qué cliente pertenece la
factura** cuando no reconoce el nombre. Tope de 25 lecturas por corrida —un
backfill traería cientos y colgaría una función de 150 s que arranca cada
minuto— y si el ERP no responde, degrada al comportamiento anterior.

---

## 5 · El matcher: cómo se movió sin perder su validación

`elegir_distrito` de `bloque.py` llevaba **25,946 decisiones** sobre fichas
reales, y tres de sus seis reglas se descubrieron corrigiendo errores medidos,
no razonando. Reescribirlo habría tirado eso.

No se reescribió: **se tradujo y se verificó**.

```bash
cd scripts/migracion-clientes
python3 arnes_matcher.py            # arma los 25,946 casos
python3 arnes_matcher.py --probar   # valida el arnés contra el original (99.92%)
python3 arnes_matcher.py --salida   # la referencia: lo que el Python decide HOY
node --experimental-strip-types comparar_matcher.mjs   # → 25,946 iguales, 0 distintas
```

**Cualquier cambio en `_shared/distrito.ts` tiene que volver a pasar esa
comparación.** Si no, se pierde exactamente lo que la hace confiable.

> **La trampa:** la primera traducción *mejoraba* un defecto. `norm()` del
> original deja espacios dobles donde había una coma, y eso cambia qué regla
> gana. La versión TS los colapsaba — y ésa fue la ÚNICA diferencia en 25,946
> casos. Se le quitó la mejora: una traducción decide **igual** que el
> original, defectos incluidos. Mejorarlo es otra decisión, y va en
> `bloque.py` primero.

---

## 6 · Números al cierre

| | antes | ahora |
|---|---|---|
| facturas sin sello | 3 | **0** |
| fichas sueltas (huérfanas) | 126 | **~18** |
| fichas sin distrito | 209 | **~28** |
| duplicados nuevos por día | ~22 | **0** *(sin confirmar, ver §7)* |
| respuestas del MH guardadas | ninguna | cada intento |

Además: 68 fichas fusionadas y 1,127 facturas devueltas a su cliente.

---

## 7 · Abierto — por dónde seguir

**a) Confirmar que la fuente quedó cortada.** Es lo primero.
El cambio en `sync-dte-sales` se desplegó sin que hubiera ventas nuevas en esa
ventana, así que el camino con cliente desconocido **nunca se ejecutó con
tráfico real**. La señal:

```sql
select count(*) from customers c
where c.erp_id is null
  and not public.es_cliente_mostrador(c.name, c.erp_id)
  and (c.categoria = 'Consumidor' or c.categoria is null);
```

Si sigue en ~18 y no saltó a ~40, funcionó.

**b) Sensuntepeque, sin explicación.** `0000063213_COF` fue rechazada por
`[receptor.direccion.distrito]` con la ficha **correcta**: Cabañas / Cabañas
Este / SENSUNTEPEQUE, y ese distrito tenía 14 facturas selladas antes.
Cambiarle el departamento a mano lo evitó, no lo explicó. Va a reaparecer.
Para diagnosticarlo: leer el JSON que genera `creaJsonDTe` y comparar el código
de distrito contra una de las 14 que sí entraron.

**c) Dos fichas en «Por revisar»** (pestaña Clientes, familia *repetido*):

- ARQUIMIDES FORNOS → ARQUIMIDES FERNANDEZ — apellidos muy distintos
- MARIA URBINA VDA. DE MORALES → «NO APARECE» — la contraparte no tiene ninguna
  compra y es basura del ERP

Decisión del usuario el 2026-08-07: **no unir**. Quedan abiertas.

**d) El bucle reactivo.** `dte_mh_intentos` se llena sola, pero nada la lee
para actuar sobre un rechazo. El circuito que faltaría: leer los rechazos
accionables → corregir la ficha → reintentar. Las piezas ya existen; falta el
lazo.

**e) Las ~18 fichas sueltas que quedan.** Casi todas son duplicados cuyo
`erp_id` ya tiene dueño. Se limpian con la corrida diaria o a mano.

---

## 8 · Operar

**Disparar a mano cualquiera de las dos:**

```sql
select net.http_post(
  url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sincronizar-fichas-clientes',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets
                                 where name='admin_invoke_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 180000);
-- la respuesta llega después, en net._http_response
```

**Ver qué contestó Hacienda, ya clasificado:**

```sql
select i.correlativo, obs, c.campo_ficha, c.accionable
from dte_mh_intentos i, unnest(i.observaciones) obs,
     lateral clasificar_observacion_mh(obs) c
order by i.created_at desc;
```

**Sacar una factura de la lista negra:**
`delete from dte_excluidas_del_barrido where invoice_id = X;`

**⚠️ Al redesplegar cualquier edge function de este circuito:** van con
`--no-verify-jwt`, y el CLI se traga el `.env` del repo (tiene claves con
guiones). Ver `reference_edge_function_deploy_workaround`:

```bash
mv .env .env.bak
supabase functions deploy <fn> --no-verify-jwt --project-ref sacecdkdmsdvgqnrsett
mv .env.bak .env
```

Sin el flag, el cron empieza a fallar con 401 **antes de ejecutar una línea** y
el proceso muere en silencio. Ya pasó tres veces en este proyecto.

---

## 9 · Deuda anotada

- `bloque.py` sigue siendo la fuente de verdad del matcher; `distrito.ts` es su
  traducción verificada. **Si una cambia, la otra también** — y hay que volver
  a correr la comparación.
- `_shared/erp-clientes.ts` unificó el parseo que estaba duplicado en
  `push-cliente-erp`. Al cierre, esa función se desplegó con el import nuevo y
  responde bien, pero **su camino de escritura no se ejercitó** (la cola estaba
  vacía). La primera edición real de un cliente lo confirma; si algo falla, la
  entrada queda pendiente en la cola y se reintenta.
