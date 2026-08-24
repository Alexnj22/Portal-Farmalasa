# Auditoría completa del portal — 2026-08-23

**Promedio: 89%.** Veinticinco áreas, doce ejes cada una. Ninguna área congelada
todavía, y eso es a propósito: el sello lo pone una corrida real en sala, no una
medición.

> **Al cierre de la jornada: los doce gates en verde y el único hallazgo grave
> cerrado.** Se resolvieron los 32 textos que nombraban el sistema de origen
> (v2.719.2), el `gate:bundle` que estaba en rojo (v2.719.3), y `staff_salary`,
> que era una llave sin cerradura (v2.720.0). Más dos cosas que esta auditoría
> no había visto: las pestañas del portal no se anunciaban como pestañas, y el
> barrido móvil daba un cero que era del instrumento. El detalle, en la §7.
>
> El conteo de hallazgos pasó de 221 a **229**, y eso no es un retroceso: se
> cerraron quince y se **descubrieron** los del barrido, que estaban ahí y nadie
> los contaba. Un número que sólo baja es un número que dejó de mirar.

El portal está en mucho mejor estado del que aparenta desde adentro. La regla
más cara del proyecto —envolver `auth_*` en `(SELECT …)`, el incidente del
2026-07-08 que tiró producción— **se sostiene entera en las 176 tablas: cero
violaciones**. El advisor de seguridad está en cero errores, no hay una sola
tabla sin llave primaria, no hay una vista sin `security_invoker`, y las 687
pruebas pasan.

Lo que la auditoría encontró no es un portal roto. Es un portal cuyas
afirmaciones escritas dejaron de coincidir con la realidad en algunos puntos, y
nada lo estaba mirando.

---

## 1. Qué se midió y cómo

### Las 25 áreas

El % se asigna por **área funcional**, no por módulo de permiso ni por archivo.
Un módulo de permiso es una LLAVE, no un circuito: `traslados` y
`dash_traslados` son dos llaves de la misma puerta, y un traslado cruza seis
pantallas, dos tablas y una edge function. Puntuar por llave da un tablero
ilegible y un candado que no protege nada — congelaría la vista y dejaría libre
la función que hace el trabajo.

El área es la unidad que tiene sentido congelar porque es la unidad que tiene
sentido probar: «un traslado sale de Bodega y llega a la sala» se verifica de
una vez o no se verifica.

El mapa vive en `auditoria/areas.mjs` y su cobertura está **verificada contra el
disco y contra producción**:

| pieza | total | asignadas | huérfanas |
|---|---:|---:|---:|
| archivos de `src/` | 524 | 524 | **0** |
| tablas | 180 | 180 | **0** |
| edge functions | 59 | 59 | **0** |
| tareas programadas | 68 | 68 | **0** |

Ese cero importa más de lo que parece. Un archivo sin área no entra en ningún
porcentaje: el día que alguien agregue una vista y no la mapee, el portal diría
«88% auditado» sobre un denominador que ya no es el suyo. Por eso el gate falla
—no avisa: falla— si aparece un huérfano.

### Los 12 ejes

Los ocho que se pidieron, más cuatro que se agregaron porque sin ellos «está
verde» no quiere decir nada.

| bloque | eje | peso | la pregunta |
|---|---|:--:|---|
| **Construcción** | Flujo y lógica | 3 | ¿El circuito cierra, incluidos el doble clic, el que se arrepiente y el que llega tarde? |
| | Datos y verdad | 3 | ¿Lo que muestra es cierto? Techo de 1000 filas, tipo real de la columna, unidades que no se suman. |
| | Base de datos | 2 | PK, RLS con policy, índice por FK, `search_path`, migraciones archivadas. |
| **Blindaje** | Seguridad y permisos | 3 | ¿Lo decide el SERVIDOR? Sin `USING(true)`, `auth_*` en `(SELECT)`, nada abierto a `anon`. |
| | Resiliencia | 2 | ¿Qué pasa cuando falla? Error de red, doble envío, la sesión que se cierra sola. |
| | Observabilidad | 2 | ¿Se puede reconstruir lo que pasó? |
| **Experiencia** | Vista y UI | 2 | Tokens, no colores crudos, DESIGN.md. |
| | Móvil | 2 | Canon §32.8/§32.9, gate + barrido + diálogos. |
| | UX, copy y accesibilidad | 2 | Habla del portal y no del sistema de origen. Pestaña en la URL. 44pt. |
| | Fluidez y eficiencia | 2 | Forma del plan, peso del chunk, cadencia de los crons. |
| **Confianza** | Pruebas | 2 | ¿Hay una prueba que falle si esto se rompe? |
| | Documentación y memoria | 1 | ¿Está escrito donde se va a leer? |

**Los cuatro que se agregaron** —seguridad, resiliencia, observabilidad y
pruebas— salieron de mirar cómo fallan de verdad las cosas en este repo. Los
tres incidentes más caros de julio y agosto (el outage del 08-jul, el sello de
Hacienda leído como booleano, el filtro de Receta Médica truncado a 1000 filas)
no fueron problemas de vista ni de flujo: fueron problemas de que algo escrito
dejó de ser cierto y ningún instrumento lo miraba.

### El sello de sala: por qué nadie llega a 100

Doce ejes en verde topan en **95%**. El 100 lo desbloquea una corrida real con
datos de producción, registrada con su fecha y su evidencia.

No es una formalidad. Hoy la memoria del proyecto tiene **catorce ítems
abiertos** que dicen literalmente «falta probarlo en sala», «falta la primera
corrida real», «falta verlo en pantalla». Un área con los doce ejes perfectos y
sin una sola corrida es código que compila y que nadie usó nunca — y congelarlo
sería prometer que funciona.

El sello es un **tope**, no un sumando. Si fuera un sumando, un área podría
compensar la falta de prueba real con puntaje de otro lado, que es exactamente
la confusión entre «construido» y «funciona» que el sello viene a evitar.

---

## 2. El resultado

```
  área                              %    fluj dato   bd segu resi obse vist movi   ux efic prue  doc
  ──────────────────────────────────────────────────────────────────────────────────────────────────
  Plataforma y chasis              92       89   95   98   98   79   83   95   85   95   95   95   95
  Cortes de caja y bolsas de efect 92       77   95   93   98   91   92   98   85   95   95   95   85
  Metas y cumplimiento             91       95   95   98   98   91   92   98   85   95   95   62   75
  Inventario, conteo y ventas perd 91       95   95   86   98   95   83   95   85   95   95   76   75
  Min · Máx                        91       83   95   98   98   95   83   98   85   95   95   76   95
  Permisos, cargos y candado de mó 90       95   95   98   98   95   83   86   85   95   95   62   75
  Asistencia y marcaciones         90       95   95   98   98   95   83   98   85   95   95   62   55
  Nómina y bonificaciones          90       95   95   98   98   91   83   95   85   95   95   62   55
  Libros fiscales y cierre de perí 90       77   95   98   98   95   92   98   85   95   95   62   95
  Tablero de inicio                89       89   95   98   98   83   83   89   85   95   95   76   55
  Solicitudes y aprobaciones       89       95   95   98   96   91   83   89   85   95   95   69   55
  Traslados entre salas            89       65   95   98   96   95   74   98   85   95   95   95   85
  Bitácoras reguladas (SRS)        89       83   95   98   98   95   83   95   85   95   95   62   75
  Impresión en ticketera           89       77   95   93   92   95   92   98   85   95   83   76   75
  Horarios, turnos y vacaciones    88       95   95   93   96   95   74   77   85   95   95   69   55
  Sucursales                       88       95   95   98   96   79   92   83   85   95   95   62   55
  Ventas                           88       77   95   92   98   95   92   92   85   95   95   62   55
  Facturación, DTE y clientes      88       95   95   95   92   78   74   92   85   95   95   62   95
  Productos, presentaciones y labo 88       95   95   89   98   91   65   83   85   95   95   76   55
  Sistema, salud y auditoría gener 88       83   95   98   98   85   83   98   85   95   95   62   55
  Acceso, identidad y kiosco       87       71   95   83   86   95   92   95   85   95   95   69   95
  Pedidos a sucursales             86       71   95   73   96   81   74   74   85   95   95   95   95
  Compras y cuentas por pagar      86       71   95   98   96   83   74   98   85   89   95   62   85
  Personal y expediente            85       89   95   98   96   64   74   71   85   95   95   69   55
  Avisos, notificaciones y encuest 85       89   95   98   98   91   74   59   85   95   95   62   55
```

Los números salen de `auditoria/puntuar.mjs`, que tiene las reglas del cálculo
escritas adentro. No se escriben a mano: el gate rechaza un `pct` que no se
derive de los ejes, y rechaza un eje en 90 o más que no diga con qué se
comprobó. Un puntaje sin evidencia es una opinión.

### Lo que la tabla dice en una línea

- **Ningún área está mal.** La más baja es 82. El portal está construido.
- **El eje más flojo del portal, con diferencia, es `pruebas`**: ocho áreas no
  tienen ni un archivo de prueba que nombre uno de sus archivos.
- **El segundo es `doc`**: once áreas no tienen un solo documento propio.
- **El más fuerte es `datos`**: 95 en las 25. `gate:data` cubre bien el techo de
  las 1000 filas, los tipos de columna y los errores tragados.

---

## 3. Los hallazgos

### 3.1 Grave — hay un dato que sale

**El salario de las 49 personas viaja al navegador de cualquiera que abra un
expediente.** El módulo `staff_salary` existe en la pantalla de Permisos, se
puede prender y apagar, y **no gatea nada**: ni en el navegador ni en el
servidor. Quien tenga `staff_detail` ve los salarios, tenga o no la llave que la
pantalla dice que hace falta.

No es nuevo — `gate:permisos` lo reporta como «hallazgo abierto por decisión»
desde el 2026-08-03, con la nota «dejarlo por ahora». Lo que la auditoría agrega
es la medida de cuánto tiempo lleva abierto (20 días) y que es el ÚNICO hallazgo
de esta categoría en todo el portal.

Hay dos salidas y las dos son aceptables; lo que no es aceptable es la de hoy,
que es ofrecer un control que no controla:

1. Gatearlo de verdad: filtrar las columnas de salario en el servidor cuando el
   llamador no tiene `staff_salary`, y esconderlas en la vista.
2. Borrar el módulo de la pantalla de Permisos y decir en su lugar que el
   salario va con el expediente.

### 3.2 Medio — una regla escrita dejó de ser cierta

**La superficie que se puede tocar sin iniciar sesión creció de 5 a 24.**
CLAUDE.md afirma que sólo cinco funciones son ejecutables por `anon` y que
«ninguna otra función del proyecto es ejecutable por `anon`». Producción tiene
**24 funciones y 3 tablas**.

La primera lectura fue «hay diecinueve agujeros» y **estaba mal**. Se abrieron
tres a mano antes de escribirlo, y las tres se defienden solas:

- `kiosco_marcar` entra por `kiosco_sucursal(device_id, device_token)`: sin token
  válido no hace nada. Las seis del kiosco son iguales.
- `update_proveedor_manual` abre con
  `IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN RAISE EXCEPTION
  'FORBIDDEN'`. Para `anon` eso es siempre falso.
- `expandir_lineas_envio` y otras cinco son funciones de **trigger**: sin `NEW`
  no se pueden ejecutar. Inertes por construcción.

Entonces el hallazgo no es que el portal esté abierto. Es que **la superficie
creció sola durante un mes y no lo detectó nada**, y la regla escrita dice otra
cosa. El riesgo no es lo que hay hoy: es que el día que entre una función sin
guarda, nadie se entera.

`update_proveedor_manual` muestra exactamente cómo se acumula: tiene **dos
sobrecargas**, la revocación del 2026-07-29 alcanzó a una y la otra se quedó con
el `GRANT`.

**Ya está arreglado.** `auditoria/superficie-anon.json` declara las 27 entradas
con su guarda y su motivo, y el gate falla si producción expone algo que no esté
ahí. Con su regresión fabricada.

**`gate:bundle` está EN ROJO.** Dos vistas pasaron su techo:

| vista | mide | techo | exceso |
|---|---:|---:|---:|
| `TrasladosView` | 61 kB | 47 kB | **+14 kB** |
| `DashboardView` | 100 kB | 99 kB | +1 kB |

El de Traslados viene del trabajo de envíos de hoy. El del Tablero es el margen
de 1 kB que el baseline dejó a propósito con la nota «el próximo crecimiento del
Inicio tiene que discutirse, no colarse».

**Una migración vive en producción y no en el repo:**
`20260823222500_envios_el_tope_de_renglones_sale_de_lo_medido`. Es de hoy, del
trabajo de envíos de otra sesión. Es la deriva exacta que la regla previene:
`apply_migration` escribió en el servidor y el archivo nunca se guardó. El SQL es
recuperable desde `supabase_migrations.schema_migrations`.

**Tres funciones sin `SET search_path`** (regla 4 del hardening):
`es_telefono_sv_valido`, `customer_ficha_estado`, `es_cliente_mostrador`.

**`identidad_vales` tiene RLS encendido y CERO policies.** Puede ser deliberado
—se accede sólo por una función DEFINER— pero no está escrito en ningún lado, y
una tabla que nadie puede leer sin que nadie sepa por qué es una trampa para el
próximo que la toque.

**El botón «Iniciar» de una ruta no se apaga mientras trabaja**
(`src/views/pedidos/TabPedidos.jsx:817`). Dos toques mandan
`avisarSalidaALasSalas` **dos veces**: el aviso de salida le llega duplicado a
cada sala. Es el único de los ocho que encontró el barrido cuyo doble toque tiene
consecuencia hacia afuera; los otros son copiar al portapapeles e imprimir.

**Dos `catch` que sólo dicen «silencioso»** (`src/context/AuthContext.jsx:1000` y
`:1040`). Están en el procesamiento de sesión: un error ahí deja a la persona con
permisos viejos y sin rastro en ningún lado. La diferencia con los otros
`catch` del archivo —que también se callan— es que ésos **explican por qué**
(«timeout o red inestable → se confía en el caché local»), y eso es una decisión.
«Silencioso» no es un motivo.

### 3.3 Menor — higiene

- **12 textos nombran el sistema de origen o la jerga de la tubería**, contra la
  regla que el usuario corrigió dos veces. Compras 7 («Sincronizar»,
  «Sincronizando (tanda N)», «Sincronización completa», «Error al sincronizar»,
  «match ERP»), Facturación 4 («Descartado: el ERP ya tenía otro valor»,
  «Guardado, pendiente de enviar al ERP», «Sin portar del ERP»), Sucursales 2 y
  el rótulo **«Sync»** del menú lateral, que lo ve todo el mundo todos los días.
- **5 llaves foráneas sin índice que no son columnas de auditoría**, más
  `pedido_items` (17 MB) con dos de auditoría — la excepción de la regla dice «en
  tablas pequeñas» y ésa no lo es.
- **10 índices que nunca se usaron**, ~8 MB. Se mantienen en cada escritura y no
  aceleran ninguna lectura. Cuatro son de Inventario, tres de Productos.
- **`impresion_dispositivos`: 402 escrituras por hora sobre SEIS filas**, cero
  inserciones. Es el latido de las cajas de impresión reescribiendo su fila
  entera — el patrón que la regla de los syncs prohíbe, en chico.
- **`cortes-caja-30s` dispara 2878 veces al día y declara 1920.** El manifiesto
  del gate de eficiencia quedó viejo.
- **45 tablas sin `created_at`**, contra la regla 1 del hardening. Muchas son de
  sincronización y ahí tiene sentido; no está escrito cuáles y por qué.
- **3 errores de lint** que sobreviven, ninguno nuevo.
- **45 carpetas `dist-*`** acumuladas en el árbol de trabajo.

### 3.4 Lo que está bien y conviene no perder

Un informe que sólo lista lo malo hace que se pierda lo que costó ganar.

- **Cero policies llamando `auth_*` fuera de `(SELECT …)`**, en las 176 tablas.
  Ésta es la regla del outage del 2026-07-08 y **se sostiene entera**.
- **Cero errores en el advisor de seguridad.** Cero tablas sin llave primaria.
  Cero vistas sin `security_invoker`. Cero `USING(true)` de escritura para
  `authenticated` (los cuatro que hay son de `service_role`).
- **687 pruebas en 54 archivos, todas verdes.**
- **`gate:perf` en verde**: 14 de 14 índices y crons vivos, 5 de 5 planes
  entrando por índice, y los 14 tiempos medidos por debajo de su techo.
- **`gate:eficiencia` en verde**: 894 escrituras por hora de un tope de 1240,
  5858 llamadas salientes y **ninguna fuera de 2xx**.
- **`gate:movil` con las cinco categorías en cero**, y ocho excepciones con
  motivo escrito.
- **Migraciones sin deriva local**: 532 post-baseline, todas con su archivo.

---

## 4. El candado

Es la parte que responde a «cuando ya esté finalizado no se toque nada de eso, y
si se toca que pregunte antes y se haga verificación después».

### Los dos chequeos

```
npm run gate:auditoria --hook     ← en el pre-commit, sin red, milisegundos
npm run gate:auditoria            ← al cerrar el trabajo
```

**`--hook` es el «preguntar antes».** Bloquea el commit que toca un área
congelada. Para seguir hay que abrir un desbloqueo a mano, con motivo escrito.

**El gate completo es el «verificar después».** Falla mientras quede un
desbloqueo abierto. El commit puntual pasa, pero el trabajo no se puede dar por
cerrado hasta volver a sellar el área.

**Son dos y no uno a propósito.** Un gate que bloquea CADA commit de un trabajo
en curso enseña a escribir `--no-verify`, y a partir de ahí no protege nada. Un
gate que sólo avisa se olvida el día que hay prisa — es exactamente cómo se
perdieron 164 entradas del changelog. La única combinación que sobrevive al
apuro es bloquear la primera vez (barato de resolver) y bloquear el cierre (que
es cuando de verdad importa haber verificado).

### El ciclo completo

```bash
# 1. El commit choca contra el candado y dice qué hacer.
# 2. Se le pregunta al usuario si de verdad quiere tocar esa área.
npm run auditoria:desbloquear -- traslados "el motivo obligatorio no llega al historial"

# 3. Se trabaja. Cada commit avisa que el área está abierta.
# 4. Se vuelve a verificar y se sella. Sin evidencia escrita no sella.
npm run auditoria:sellar -- traslados "gate:design, gate:movil, barrido de /traslados y un envío real desde Salud 2"
```

### Lo que el gate NO deja hacer

- Escribir un `pct` a mano que no salga de los ejes.
- Declarar un eje en 90 o más sin evidencia escrita.
- Congelar un área que no llegó a 100.
- Congelar un área sin sello de sala.
- Dejar un archivo, una tabla, una edge function o un cron sin área.
- Que producción exponga algo a `anon` que no esté declarado con su motivo.

Las seis tienen su **regresión fabricada** en
`tests/unit/auditoriaGate.test.js`, porque a un detector en cero no se le cree
hasta haberle construido el caso que debería hacerlo fallar. Una de esas
regresiones ya sirvió: destapó que el gate leía el índice real de git cuando
debía leer sólo lo inyectado — o sea que pasaba o fallaba según lo que
estuviera haciendo otra sesión en ese momento.

---

## 5. Lo que este informe NO puede afirmar

Tres límites, escritos para que nadie lea el 88% como más de lo que es.

**El eje `flujo` no se midió: se dedujo.** «¿El circuito cierra de punta a
punta?» no lo contesta ningún detector — lo contesta usarlo. Acá sale de los
PENDIENTES DECLARADOS en la memoria del proyecto, que es evidencia citable pero
indirecta. Un área con 95 en `flujo` quiere decir que nadie declaró un hueco, no
que no lo tenga.

**El eje `movil` está topado en 85 en las 25 áreas.** `gate:movil` está en cero,
pero **lee el fuente**, y hay filas que desde el fuente son una caja cerrada —
eso ya se midió: quitándole `usarAccionDeFila` a Personal el gate daba verde con
0 hallazgos y el barrido decía 25. Lo que cierra ese hueco es el barrido de 54
rutas en WebKit, y su última corrida completa es del **2026-08-17**. Todo lo
construido después no está medido.

**El barrido de código sobre-acusa y está escrito.** Cada categoría de
`scripts/auditoria-barrido.mjs` lleva su `ve:` y su `no ve:`. Los números de
`escritura-sin-bitacora` (27) son los menos confiables: el detector mira un
archivo por vez y no puede seguir la cadena hasta un trigger de Postgres o hasta
el llamador.

### El instrumento mintió tres veces antes de acertar

Vale la pena dejarlo escrito porque es la lección que más se repite en este
repo, y volvió a pasar hoy:

1. `fecha-sin-hora` reportó 7. Los tres primeros eran **el comentario de
   `src/utils/semana.js` que EXPLICA por qué `new Date('2026-08-18')` retrocede
   un día**. El detector estaba acusando a la documentación de la regla que venía
   a hacer cumplir. Con los comentarios fuera: **0**.
2. `catch-mudo` reportó 5. Tres eran `catch` que **sí** manejan el error: su
   comentario ocupaba justo las ocho líneas de la ventana y el código real caía
   afuera. Un detector con la ventana corta no encuentra menos — encuentra MAL,
   y acusa con más fuerza al código que más se molestó en explicarse. Con la
   ventana real: **2**, y los dos verificados a mano.
3. `submit-sin-freno` reportó 13. Nueve eran botones que sólo cambian una
   variable local («Confirmar» que hace `setModo('confirmar')`) o el botón
   «Cancelar» de al lado, que heredaba el `onClick` del de abajo porque el corte
   del elemento tomaba doce líneas de corrido. Exigiendo `onClick={async …}` con
   un `await` adentro: **8**, de los cuales uno solo tiene consecuencia real.

Y una cuarta, que es la peor porque va en la dirección contraria: al filtrar el
ruido de `texto-del-sistema-de-origen` descarté la línea entera cuando llevaba
`className=`, y **eso se comió un hallazgo real** — el rótulo «Sync» del menú
lateral vive en un `<span>` que además lleva clases de Tailwind. Un filtro que
apaga el hallazgo junto con el ruido es peor que no filtrar: deja el número más
chico y más falso.

---

## 6. Qué sigue, en orden

1. **Resolver `staff_salary`** — gatearlo o borrarlo. Es el único hallazgo de la
   categoría grave.
2. **Bajar `TrasladosView` a su techo** (o discutir el techo, con el motivo
   escrito, como manda el ratchet).
3. **Guardar el archivo de la migración `20260823222500`** — es de otra sesión;
   quien la aplicó es quien la recupera.
4. **Correr el barrido móvil de 54 rutas.** Es el único eje topado en las 25
   áreas a la vez, y una sola corrida lo desbloquea entero.
5. **Poner los primeros sellos de sala.** Las áreas que ya corren en producción
   con datos reales —Ventas, Fiscal, Personal, Asistencia— sólo necesitan que
   alguien registre la verificación para pasar de 95 al 100.
6. **Las ocho áreas sin ninguna prueba**: Metas, Asistencia, Nómina, Bitácoras,
   Sucursales, Avisos, Permisos y Sistema.
7. **Los 12 textos que nombran el sistema de origen**, empezando por «Sync» en
   el menú lateral porque lo ve todo el mundo.

---

## Los archivos

| archivo | qué es |
|---|---|
| `auditoria/areas.mjs` | El mapa: qué archivo, tabla, función y cron es de qué área. |
| `auditoria/registro.json` | Los puntajes. `pct` y `estado` se derivan, no se escriben. |
| `auditoria/puntuar.mjs` | Las reglas del cálculo, con la evidencia medida adentro. |
| `auditoria/superficie-anon.json` | Todo lo alcanzable sin iniciar sesión, con su guarda y su motivo. |
| `auditoria/desbloqueos.json` | Las áreas abiertas ahora mismo. |
| `auditoria/snapshot-produccion.json` | Tablas, crons y superficie `anon` tal como estaban al medir. |
| `scripts/auditoria-gate.mjs` | El candado y el contraste del mapa. |
| `scripts/auditoria-cli.mjs` | desbloquear · sellar · recalcular · sincronizar. |
| `scripts/auditoria-barrido.mjs` | El instrumento: lo que los once gates no miran. |
| `tests/unit/auditoriaGate.test.js` | Las regresiones que el candado tiene que cazar. |


---

## 7. Lo que se cerró el mismo día

### 7.1 Los 32 textos que nombraban el sistema de origen — v2.719.2

El barrido encontró 14. Eran **21**: el detector buscaba «ERP» y «sincronizar» y
no conocía **WFM**. Seis textos visibles lo nombraban, y uno le informaba al
usuario que el portal usa un «algoritmo predictivo leyendo Supabase».

Los peores no eran los del ERP. En el expediente de una sucursal, el panel que
recarga el histórico de ventas se llamaba **«Motor de Sincronización WFM»**, su
botón decía **«Ejecutar Inyección»**, y al terminar anunciaba **«🎉 Volcado
Express finalizado»**. Hoy dice «Recargar el histórico de ventas», el botón dice
«Recargar», y al terminar dice cuántos meses se recargaron.

Los otros once se encontraron mirando el **bundle** y no el fuente: cadenas de
prosa dentro de `dist/`. Ahí aparecieron «El ERP no entregó el inventario de esta
sucursal», «Esa categoría no es una de las seis del ERP» y el aviso de que «se
están terminando de sincronizar los datos del empleado».

**Verificado contra el bundle, no contra el fuente.** Los trece textos viejos se
buscaron en `dist/` después de compilar: cero coincidencias, y los nuevos sí
están. Grepear `src/` no alcanza — la mitad de estos textos viven en
`aria-label`, `title` y `placeholder`.

**Un detector al que le falta una palabra no falla: devuelve un número menor, que
se lee como buena noticia.** El vocabulario ahora incluye WFM, Supabase,
PostgREST, SheetJS, «inyección» y «volcado», y descarta `console.*` y los
argumentos de `invoke()`, que no los lee nadie.

Y el módulo **«Salud de syncs»** —que nombraba la tubería en el menú, en el
encabezado, en la pantalla de Permisos y en la miga de pan— pasó a llamarse
**«Actualización de datos»**. Con él se fueron «Backup» → **Respaldo**,
«Dominio» → **Qué se actualizó**, «Sin corridas» → **Sin actualizaciones** y la
unidad del paginador. `MinMax` quedó como **Min / Max**, que es como se llama el
módulo en todo el resto del portal.

### 7.2 El `gate:bundle` que estaba en rojo — v2.719.3

| vista | antes | ahora | techo |
|---|---:|---:|---:|
| Inicio | 100 kB | **87 kB** | 99 |
| Traslados | 61 kB | **bajo 47** | 47 |

**El Inicio.** El buscador de inventario tenía 1,414 líneas en un archivo y 1,180
eran el cuerpo del modal. Las descargaba **todo el que abre el portal**, para una
pantalla que la mayoría de las visitas no abre nunca. El azulejo ya invocaba el
cuerpo por render-prop, así que sólo faltaba mudarlo — y estaba escrito desde el
21-ago en el baseline del propio gate. Nadie lo había hecho.

**Traslados.** Tres piezas que sólo aparecen a pedido viajaban estáticas, y en
los tres casos `WidgetTransferRequests` **ya lo hacía bien**: el patrón estaba
resuelto en el repo y esta vista no lo seguía.

Diferir lo que se pinta siempre sería mentirle al gate, y el baseline lo dice de
`RankingVendedores`. La diferencia acá es que estas tarjetas dependen de un dato
que todavía no llegó: el chunk se pide en paralelo con una consulta que de todos
modos hay que esperar. **El baseline no se tocó.**

### 7.3 Un hallazgo que esta auditoría no había visto

**Las pestañas del portal no se anunciaban como pestañas.** `ViewTabBar` las
pintaba como `<button>` sueltos: sin `role="tablist"`, sin `role="tab"`, sin
`aria-selected`. Un lector de pantalla leía tres botones y no decía cuál está
activo. Vale para las **29 vistas con pestañas**.

Lo destapó una prueba de Playwright que buscaba `getByRole('tab')` en Traslados y
no encontraba nada — con las tres pestañas dibujadas en la captura.

**Ningún gate podía verlo, y por eso importa:** los tres gates visuales miran
cómo se ve, el barrido móvil mide dónde cae. Ninguno escucha. Un defecto que sólo
existe para quien usa lector de pantalla no tiene instrumento en este repo, y
esta auditoría tampoco lo tenía — el eje `ux` incluye accesibilidad en su
enunciado y ningún detector la medía.

### 7.4 Una prueba nueva, porque el gate que premia diferir es ciego

Un `lazy()` sin su `Suspense`, un nombre mal escrito en el
`.then(m => ({ default: m.Algo }))` o un import a una ruta muerta **compilan,
pasan el lint, pasan las 689 pruebas unitarias y BAJAN el número del gate**. El
defecto sólo aparece cuando alguien aprieta el botón.

O sea que la medición que premia diferir es ciega justamente al modo en que
diferir se rompe. `tests/e2e/carga-diferida.spec.js` abre cada cosa diferida
contra el entorno de pruebas y exige ver su contenido.

Esa prueba tuvo que aprender lo mismo que todo detector de este repo: arrancó
exigiendo la consola limpia y falló **tres veces** por cosas del entorno —el
branch de pruebas no tiene las edge functions desplegadas, a propósito—. Estaba
midiendo la salud del entorno en vez de la carga del módulo. Hoy sólo falla ante
los cuatro errores que únicamente puede dar un diferido roto.

### 7.5 Y un gate hizo su trabajo

`gate:perf` **bloqueó el commit** de la mudanza: vigila `MIN_LETRAS_BUSQUEDA` por
ruta fija y el archivo se había movido. Un chequeo así no distingue «la constante
se borró» de «el archivo se movió» — y de las dos, la primera es la peligrosa:
con menos de 3 letras el buscador salía con la primera tecla y traía 16,722
filas. Se le apuntó al archivo nuevo y se confirmó a mano que sigue en 3.

---

## 8. Lo que sigue, actualizado

*(Esta lista es de la primera jornada. La vigente está al final, en §8.11.)*

1. ~~**`staff_salary`**~~ — cerrado en v2.720.0.
2. ~~**Correr el barrido móvil de 54 rutas.**~~ — corre; de 13 rutas medidas a 31.
3. **Poner los primeros sellos de sala.**
4. ~~**Las ocho áreas sin ninguna prueba.**~~ — cubiertas en v2.720.1 y v2.721.0.
5. ~~**La migración `20260823222500`**~~ — recuperada de prod y commiteada.


### 7.6 `staff_salary` — el único hallazgo grave, cerrado (v2.720.0)

**La medición corrigió al informe que lo levantó.** La nota de `gate:permisos`
decía «el salario viaja al navegador de cualquiera que abra el expediente».
Cierto en la letra y engañoso en el fondo: los **cuatro** cargos que podían abrir
un expediente —Administrador, Jefe/a de Talento Humano, QA/Testing y
Supervisor/a de Ventas— eran exactamente los cuatro que tenían la llave. **No se
le escapaba a nadie.**

Lo que fallaba era otra cosa y peor de sostener: la protección era una
**coincidencia de configuración**, no una regla. El día que alguien le diera
`staff_detail` a una jefatura de sala —justo lo que la pantalla de Permisos
invita a hacer, con `staff_salary` apagado al lado— el sueldo viajaba igual, y
el interruptor que decía controlarlo no hacía nada.

Se arregló ahora **precisamente porque hoy no le quitaba el dato a nadie**: los
cuatro que lo verían son los cuatro que ya lo ven, así que el cambio no le cierra
una puerta a nadie que la esté usando.

- **En el servidor**: `base_salary`, `bank_name` y `account_number` salieron de
  `employees_safe` (83 → 80 columnas) y viven detrás de `get_employee_salarios`,
  que comprueba el módulo y respeta su alcance. Sin la llave devuelve **vacío, no
  error**: «no te toca» no puede parecer «se rompió».
- **En la pantalla**: la sección de dinero del expediente estaba gateada por
  `canEdit` —poder EDITAR la ficha— y ahora la gatea su propio módulo. Donde
  decía **`$0.00`** con el dato ausente ahora dice `—`.

Probado primero en el branch `staging` y verificado en producción. La migración
se aplicó **antes** del push, porque un push a `main` despliega en segundos.

`gate:permisos` quedó **sin un solo hallazgo abierto**. Era el último.

### 7.7 El barrido móvil dio un cero que era suyo, no del portal

Se corrió el barrido de las 54 rutas y anunció: **«54 vistas · con algo que
corregir: 0»**. Cero reventadas, cero tablas en el teléfono, cero desbordes.

**Sólo 13 rutas tenían algo que medir.** Las otras 41 llegaron sin una ficha, sin
una tabla y sin una fila —el entorno de pruebas no tiene datos para ellas, y la
cuenta de pruebas no abre todas las pantallas— y el resumen las contó como
buenas.

La causa: su bandera `vacia` medía `document.body.innerText.length < 120`, o sea
el **body entero, chasis incluido**. El menú lateral con sus veinte ítems ya pasa
ese umbral, así que ninguna vista sin datos se marcaba nunca.

Se arregló el instrumento: ahora informa **«MEDIDAS N de 54»**, marca con `?` las
que no pudo medir y las lista con el motivo. Pero **el eje `movil` no sube**:
para medir de verdad hace falta correrlo contra un entorno con datos. Un gate que
no pudo medir no puede dar verde.

Es la cuarta vez en el día que el hallazgo estaba en la medición y no en el
portal. Vale la pena decirlo así de claro: **de los seis problemas que esta
auditoría encontró en sus propios instrumentos, ninguno se habría notado mirando
el número.** Todos aparecieron al abrir tres casos a mano.


### 7.8 Las ocho áreas sin pruebas — cubiertas (v2.720.1 y v2.721.0)

El eje más flojo del portal era **pruebas**: ocho de las veinticinco áreas no
tenían un solo archivo que las nombrara. Hoy las ocho lo tienen. **93 pruebas
nuevas en 7 archivos**; la suite pasó de 689 a 793.

La pregunta al escribirlas no fue «cómo subo el número» sino **qué se rompe en
silencio si nadie mira** — que es la única forma de que una prueba valga algo.

**Y encontró un defecto de dinero.** La planilla usaba la tabla de retención de
renta **anterior al Decreto Ejecutivo No. 10 de 2025**, y además le faltaban las
cuotas fijas de cada tramo. Con base gravada de $275,00 —el mínimo exento
exacto— retenía **$10,57 a alguien que por ley no paga nada**.

No le pasó a nadie: no había ni un período de planilla, ni una entrada, ni un
empleado con sueldo cargado. Era un defecto latente esperando la primera corrida,
que es exactamente lo que una prueba tiene que atrapar — la nómina no avisa
cuando paga mal, y **ninguno de los doce gates podía verlo, porque ninguno sabe
qué dice la ley**.

**Y una corrección a esta misma auditoría.** Las primeras lecturas de tamaño de
tabla decían «46 entradas de planilla, 1 período». Eran `reltuples`, la
estimación del planificador, no un conteo — un `count(*)` dio cero y cero. Mi
propia consulta llamaba a esa columna `filas_aprox` y aun así cité el número como
si fuera exacto. Cambió la severidad del hallazgo entero: de «se le retiene de
más a 49 personas» a «hay un defecto esperando la primera corrida».

**Dos hallazgos quedaron anotados y sin cambiar**, porque tocarlos mueve lo que
ve el usuario:

- El cálculo de tardanza está **duplicado** entre la vista y
  `consolidate-timesheets`. Hoy coinciden —comprobado sobre las 429 filas— pero
  son dos copias de la misma regla.
- `ts?.late_minutes || (recálculo)`: con `late_minutes` en **0** —«puntual», y
  hoy lo son las 429— el `||` descarta el timesheet y recalcula.

**`conteo_ver_sistema` es la única de las 156 llaves fuera del canon §7-bis.** Se
ancló como excepción con motivo: renombrarla exige migración (9 filas otorgadas y
una función de Postgres) y no arregla ningún comportamiento.

**Tres de estas pruebas nacieron mal**, y es el mismo patrón de todo el día: la
de continuidad de tramos exigía una forma que la ley no tiene, y la de
`localStorage` espiaba el prototipo cuando jsdom expone los métodos en la
instancia. Las dos «fallaron» contra código correcto.


---

## 8. La segunda jornada — 2026-08-24

### 8.1 Lo que salió de `audit_logs`, que nadie estaba mirando

Buscando qué áreas se usan de verdad apareció esto: **92 errores de render en
producción en 45 días, de siete personas**, el último ayer. Ningún gate los mira.

Todos de la misma familia, con cuatro caras: «Importing a module script failed»,
«Failed to fetch dynamically imported module: …/DashboardView-C2-ismpz.js»,
«undefined is not an object (evaluating 'k._result.default')» y «Cannot read
properties of undefined (reading 'default')».

Es una versión vieja pidiendo piezas de una versión que ya se fue. **No es un
defecto de esa pantalla.** El portal ya lo manejaba con `vite:preloadError` desde
julio, pero los dos mensajes más frecuentes son de **WebKit**, donde ese evento
no llega — así que en iPhone y Safari la recarga nunca ocurría. Cerrado en
v2.721.1 con el `ErrorBoundary` como segunda red.

### 8.2 Cuatro de los cinco hallazgos de base de datos eran míos

| lo que dije | lo que resultó |
|---|---|
| «5 FKs sin índice» | **236 de 291 tienen índice.** Una lo tenía compuesto y mi consulta sólo miraba el prefijo. Las demás son columnas de auditoría que la regla exceptúa, y casi siempre nulas: `pedido_items.confirmado_suc_por` tiene **6 valores de 49,042**. |
| «`identidad_vales` sin policies» | **Está bien cerrada a propósito.** `authenticated` no tiene GRANT; cinco funciones DEFINER son el único acceso. El RLS es la segunda cerradura. Faltaba que estuviera escrito. |
| «10 índices muertos, 8 MB» | **No se puede decidir.** El servidor arrancó hace 3 días y este portal tiene procesos mensuales. Un índice que sólo se usa el día 1 se ve idéntico a uno muerto. No se borró nada. |
| «3 funciones sin `search_path`» | **Real.** Cerrado. Hoy el portal tiene **cero** funciones sin `search_path` fijo. |

### 8.3 El eje móvil: no era falta de datos, era el instrumento

El plan era sembrar el entorno de pruebas. Medir primero cambió el diagnóstico
dos veces:

1. **No faltaban datos.** El branch tiene 5,111 facturas, 163 cortes y 2,436
   existencias — pero **todos del 15 de agosto**. Las vistas filtran por hoy o
   por el mes en curso, así que la pantalla es un `EmptyState` correcto. Se
   escribió una herramienta que corre las fechas (con guarda para que no pueda
   ejecutarse en producción). Subió de 13 a 15 rutas medidas.
2. **Quince de 54 seguía sin cerrar.** `minmax` pinta **1 tabla, 50 filas, 110
   botones y 4,159 caracteres** —está llena— y el barrido la contaba como vacía.
   Su selector de ficha ya no reconoce lo que el portal pinta.

**El detector va por su tercera versión, y la que funcionó salió de MEDIR:** una
ruta sin acceso da exactamente **779 caracteres**; una con contenido pasa de
4,000. El corte va en 1,100.

Y ahora **separa las dos causas**, que son dos trabajos distintos: «sin acceso
con esta cuenta» se arregla dando el módulo, «sin datos» se arregla sembrando.
Antes las 38 se informaban juntas y no se podía decidir ninguna.

### 8.4 La corrección sobre los sellos

Lo que propuse al cerrar la primera jornada estaba mal: **poner un sello hoy no
congelaría ninguna área.** El sello levanta el tope de 95, pero el puntaje sigue
limitado por los doce ejes — la mejor área llegaría a **92%, no a 100**.

El cuello de botella es uno solo y es el mismo para las 25: el eje `movil`. Por
eso destrabarlo era el trabajo, y no registrar sellos que no habrían cambiado
nada.

### 8.5 El eje móvil, destrabado — y los dos defectos que escondía

El barrido pasó de medir **13 rutas de 54 a 25**, y con eso aparecieron dos
defectos que llevaban meses detrás de un cero:

- **Sucursales**: el botón «Horario (Hoy)» medía **310×43 px** — a un píxel del
  blanco de dedo.
- **Horarios**: el calendario pinta una tabla de 1,054 px en una pantalla de 390.
  Ése **se queda tabla**: es una matriz (personas × días), no una lista de
  registros. Quedó declarado con su motivo para que el barrido deje de
  reportarlo en cada corrida — un hallazgo que aparece siempre y nunca se
  arregla es como se aprende a ignorar un informe.

Los dos cerrados en v2.723.1. El barrido final: **0 hallazgos, 0 reventadas, 0
tablas en el teléfono, 0 inputs chicos**.

El eje sube de 85 a **92**, no a 100: 29 rutas siguen sin datos en el entorno de
pruebas, así que la mitad larga del portal continúa sin medirse en el teléfono.
Un gate que no pudo medir no puede dar verde — pero tampoco corresponde el 85 de
cuando no se sabía nada.

**Y el arreglo tuvo un efecto secundario que hay que contar.** Al declarar la
matriz para sacarla del conteo de HALLAZGOS quedó también fuera del conteo de
CONTENIDO, y `schedules` —que pinta un calendario entero— pasó a contarse como
«sin nada que medir». El barrido bajó de 27 rutas a 25 sin que el portal hubiera
cambiado. Eran dos preguntas distintas usando la misma variable: «¿había algo que
mirar?» y «¿cayó a tabla algo que debía ser ficha?». Ahora son dos listas.

### 8.7 `content-visibility`: la propiedad que deja el texto sin medir

`branches` pintaba **0 fichas con ocho sucursales cargadas**, el mismo síntoma
que había costado dos diagnósticos en `minmax`. Las dos sospechas razonables
resultaron falsas, y la causa era una tercera que no se parece a ninguna:

- ¿Era una **tarjeta a mano** que `gate:design` no ve porque su `className`
  viene de una variable? **No.** `alertStatus.cardStyles` resuelve a la cadena
  vacía en sus dos ramas: la raíz de `BranchCard` no lleva superficie ni borde.
  Es un **envoltorio de maquetación** —`rounded-header`, `overflow-hidden`, flex
  en columna— y sus hijos sí usan el material canónico. El gate hace bien en no
  marcarla.
- ¿Era que el barrido no reconoce sus fichas? **Tampoco**, por lo mismo: no son
  fichas, es un panel compuesto.

Lo que la escondía es que **`BranchCard` lleva `content-visibility: auto`**, para
no renderizar lo que está fuera de la pantalla. Y `innerText` devuelve **sólo
texto renderizado**. Medido en el teléfono:

| ruta | `innerText` | superficies | fichas reales |
|---|---:|---:|---|
| `branches` | **508** | **176** | **8** |
| `sesiones` | 506 | 16 | ninguna |

**Dos caracteres separan una vista llena de una vacía.** El detector iba por su
tercera versión, todas basadas en contar texto, y ninguna podía funcionar para
la mitad del portal que usa esa propiedad por rendimiento.

La v4 cuenta **estructura**, que existe en el DOM aunque no se pinte: elementos
con superficie de tarjeta, con corte en 60 —tres veces el chasis vacío medido
(13–24) y menos de la mitad de la vista con datos más pobre (166)—. El texto se
conserva como señal adicional, pero ya no manda solo.

**Resultado: de 25 rutas medidas a 31, con 0 hallazgos en todas.** Y la
regresión que costó descubrirlo queda anclada en el comentario del detector, con
los números medidos, para que la v5 no vuelva a contar caracteres.

**Es la decimocuarta vez en esta auditoría que el hallazgo estaba en el
instrumento y no en el portal** — y la primera cuya causa es una propiedad de CSS
que el portal usa *bien*. Un instrumento no sólo se equivoca por tener el
umbral mal puesto: se equivoca por medir una magnitud que el sujeto tenía
motivos legítimos para no exponer.

### 8.8 La bitácora: 27 acusaciones vagas, 26 huecos reales, 0 al cerrar

El detector de observabilidad decía **27** y estaba haciendo la pregunta mal.
Acusaba a cualquier archivo de `src/data/` que escribiera sin nombrar
`appendAuditLog` — o sea a la capa de datos entera, que es una capa fina donde la
bitácora **no se escribe nunca**: se escribe en quien orquesta la acción, la
vista o el slice.

Un detector que acusa a 27 archivos por diseño no se lee. Se apaga.

Se rehízo para seguir la **cadena de llamada**, y para seguir además los **alias
de los imports**. Ese segundo detalle no es cosmético: `practicantesSlice.js`
importa `updatePracticante as updatePracticanteData`, así que buscando el nombre
suelto la coincidencia caía en el componente —que llama a la acción del store,
que se llama igual— y el slice, **que sí audita**, quedaba invisible. Dos falsos
positivos que además señalaban el archivo equivocado para arreglarlos.

Medido así fueron **26 acciones reales**, y las 26 quedaron cerradas:

| dónde | qué no dejaba rastro |
|---|---|
| Planilla | crear el período, **aprobarlo**, **darlo por pagado**, recalcular, canjear horas |
| Vacaciones | crear, editar fechas, cambiar estado, confirmar, cancelar |
| Mín·Máx | cambiar la configuración — reescribe el mínimo y máximo de **18,364 filas** |
| Turnos | crear, editar, archivar, restaurar — de ahí sale el minuto de tardanza |
| Horarios | poner y quitar una cobertura entre salas |
| Traslados | **rechazar** un pedido de otra sala |
| Cotizaciones | crear, editar y anular un precio ofrecido por escrito |
| Bitácoras SRS | reconfigurar un área — cambia lo que el regente firma al cerrar el mes |
| Productos | marcar un producto como sin principio activo |
| Inventario | reportar una venta perdida |

Dos exenciones, **por tabla y no por nombre de función**: el tema elegido y las
notificaciones propias. Escribir el estado de uno mismo no le pasa nada a nadie
más, y anotarlo llenaría la bitácora del ruido que taparía justo lo que existe
para encontrar. Por tabla porque el nombre lo cambia cualquiera; la tabla es el
dato.

### 8.9 Seis de ocho acusados no eran nada

De los ocho `submit-sin-freno` que quedaban, **seis no eran defectos**: cuatro
copiaban al portapapeles, uno generaba un código candidato y otro leía renglones
para imprimir. Apretar «Copiar» dos veces copia dos veces.

Los dos reales eran los mismos dos: **iniciar y completar una ruta**. «Iniciar»
escribe el estado y manda un aviso de salida **a cada sala de la ruta** — ese
aviso ya se fue y no se puede retirar.

Seis de ocho falsos es exactamente el número con el que una categoría se termina
apagando. Ahora se le pide la señal que separa las dos clases: **que el manejador
llame a algo que escriba**. La convención del repo lo hace posible — en
`src/data/` los que leen se llaman `fetch*` y los que escriben empiezan por el
verbo.

Y el último hallazgo de copy también era del detector: el botón del libro de
compras se llama `key: 'sincronizar'` y **en pantalla dice «Buscar nuevas»**. El
texto ya estaba bien y el detector señalaba la palabra que tiene que quedarse.
Ahora descarta `key`/`slug`/`testId`, pero **no** `value` ni `name`: la regla «un
rótulo no es una clave» avisa que hay catálogos donde el `value` ES el texto que
se muestra, y filtrarlos haría el número más chico a costa de clasificar mal por
construcción.

**Barrido de auditoría: 38 hallazgos → 0.**

### 8.10 La pantalla dice qué está mostrando, y son TRES estados

El detector de «esta ruta no tenía nada que medir» iba por su cuarta versión y
las cuatro adivinaban. Las dos últimas fallaron por el mismo motivo — medían un
**proxy** en vez del hecho:

| versión | qué contaba | dónde se rompió |
|---|---|---|
| v3 | caracteres de texto | `branches` con 8 salas da **508**; `sesiones` sin nada da **506** |
| v4 | elementos con superficie de tarjeta | `sesiones` pinta fichas que no usan ese token |

Se dejó de adivinar. `EmptyState` estampa **`data-vacio`** y `LoadingState`
estampa **`data-cargando`**: un atributo no cambia un pixel y convierte la
pregunta en una respuesta. Es lo mismo que `data-destino` hizo por las fichas —
en tiempo de render el portal **sí sabe** qué está mostrando.

Y con eso el barrido pasó a distinguir **tres** causas, que siempre fueron tres y
tienen tres arreglos distintos:

- **sin datos y lo dice** → la pantalla está bien; se arregla sembrando.
- **seguía cargando** → no es un problema del dato; se sube la espera o se mira
  por qué tarda.
- **sin resolver** → ni contenido reconocible ni un vacío canónico. Hay que
  abrirlas una por una.

Antes las tres se informaban juntas bajo «sin datos», así que la tercera no se
podía ver.

**Y esa tercera no es lo que primero se escribió.** La línea decía «pantallas que
no explican qué pasa» y prometía doce defectos. Se abrieron tres a mano y las tres
eran cosas distintas, ninguna eso:

| ruta | qué era realmente |
|---|---|
| `corte-z` | **sí explica** —«el mes en curso todavía no se cierra»— pero escrito a mano, fuera de los dos componentes canónicos |
| `my-requests` | es una **redirección**: no tiene contenido propio y nunca lo va a tener |
| `sesiones` | **tiene datos** (dos fichas) y usa `EmptyState` bien; queda bajo el corte de contenido |

Una de tres era un hallazgo suave. Doce defectos en un informe que tiene, como
mucho, unos pocos es cómo un informe se deja de leer — así que la categoría pasó
a llamarse **«sin resolver»**, que es lo que de verdad significa.

**Y la primera versión de esa idea estaba mal por el otro lado.** Se hizo que
`data-vacio` VETARA cualquier otra señal, con el argumento de que una pantalla
diciendo «acá no hay nada» gana sobre cualquier proxy. En la corrida siguiente el
**tablero, con TRECE fichas pintadas, se contó como vacío** — porque uno solo de
sus widgets no tenía datos. Un vacío dentro de un widget no es la pantalla
diciendo que está vacía: es un rincón diciéndolo de sí mismo, y desde afuera los
dos se ven igual. Hoy el contenido manda y los atributos sólo explican **por qué**
no lo hay.

**Y la marca estaba en el camino menos transitado.** Con `data-vacio` sólo en
`EmptyState`, el barrido veía **mudas a diecisiete rutas que están bien**:
Clientes, Cotizaciones, Libros de IVA y catorce más no arman su vacío a mano — se
lo pasan a `DataTable` por la prop `empty`, y `DataTable` lo pinta con marcado
propio. Ahora lo estampan las dos, en sus dos formas (la tabla de escritorio y la
hoja del teléfono), y hay pruebas que lo anclan: si alguien las quita, falla algo
en vez de volverse ciego el barrido en silencio.

### 8.11 El entorno de pruebas llevaba 130 migraciones de atraso

Separar las tres causas del barrido tuvo un rendimiento inmediato: entre las doce
rutas «sin resolver», `/inventario` no estaba vacía — decía **«Error al cargar
inventario»**. Ninguna versión anterior del detector podía verlo, porque todas
las juntaban bajo «sin datos».

El error resultó ser del **entorno**, y al tirar de ese hilo apareció algo más
grande. Medido el 2026-08-24:

| | pruebas | producción | atraso |
|---|---:|---:|---:|
| migraciones | 413 | **543** | **130** |
| tablas | 172 | 181 | 9 |
| funciones | 497 | 554 | 57 |

**El barrido móvil de las 54 rutas —el instrumento que decide el eje `movil` de
las 25 áreas— venía midiendo un portal de hace un mes.**

Y el modo de falla no era un error claro, era **en pedazos**: una vista
materializada que el branch nunca pobló, y una columna
(`user_dashboard_prefs.mobile_theme`) que existe en producción y todavía no ahí.
Las dos se leían como defectos del portal y ninguna lo era.

CLAUDE.md decía que el esquema del branch era «idéntico al de prod, **verificado
por huella md5** de tablas, funciones, policies e índices». Era cierto en julio,
el día que se verificó. Es exactamente la lección que esta misma auditoría había
escrito para la superficie `anon`: **una afirmación que nadie vuelve a verificar
deja de ser cierta sin avisar**, y las dos veces el que se la creyó fue un
instrumento.

Queda corregida en CLAUDE.md, con la tabla medida, y queda el procedimiento para
volver a comprobarlo (`scripts/entorno-pruebas/comparar_con_produccion.mjs`).
Ponerlo al día exige **rehacer el branch**, que borra los datos sembrados y la
corrida de fechas — es una decisión de quien esté trabajando, no algo que
convenga automatizar.

### 8.12 Las doce «sin resolver», abiertas una por una

| ruta | qué era |
|---|---|
| `compras`, `libro-compras-completo`, `requests`, `sesiones` | **tienen datos** — 5 renglones, 3 fichas, etc. Quedan bajo el corte de contenido |
| `corte-z`, `encuesta` | pintan una explicación o un encabezado, sin filas |
| `ventas-perdidas`, `requests-personales`, `my-announcements`, `encuesta-admin` | **vacío escrito a mano**, fuera de `EmptyState` y de la prop `empty` de `DataTable` |
| `my-requests` | una **redirección** a `/requests-personales`: no tiene contenido propio |
| `inventario` | **el único defecto**, y era del entorno (§8.11) |

O sea: de doce, **cero defectos del portal** y cuatro casos de vacío escrito
fuera de los dos componentes canónicos — que es un hallazgo de consistencia, no
de funcionamiento. Haber llamado «mudas» a las doce habría puesto doce defectos
en el informe.

### 8.13 Cinco vacíos dibujados a mano, y por qué el sexto se queda

Poner `data-vacio` en `EmptyState` tuvo un efecto que no se buscaba: **cuatro
vistas siguieron saliendo mudas**. No les faltaba el vacío — lo tenían **copiado
clase por clase**. El de Solicitudes reproducía el envoltorio entero (`min-h-
[400px]`, `animate-in fade-in zoom-in-95`, halo de `w-28 h-28` con
`blur-[40px] opacity-30`, caja de ícono `w-24 h-24 rounded-modal`), y lo único
que agregaba era el color por estado — que `EmptyState` ya acepta por
`glowClass`/`iconClass`.

Seis copias en cinco archivos. **Cinco volvieron a la canónica** —Solicitudes,
Avisos, Mis avisos, Turnos y Encuestas—, prop por prop, así que se ven igual.

**La sexta se queda a mano y eso también es una decisión escrita:** es el único
vacío *celebratorio* del portal —halo del doble de grande, ícono con degradado y
sombra de brillo, título de display— y pasarlo al canónico lo apagaría. Lo que sí
necesitaba era anunciarse.

Por eso el detector nuevo (`vacio-a-mano`) mira **`data-vacio` y no la clase**:
quien tenga una razón para dibujar el suyo, la declara y sigue siendo medible. Un
detector que prohibiera la clase habría obligado a elegir entre el canon y el
diseño; éste sólo exige que la pantalla diga en qué estado está.

### 8.14 El tamaño de la batería se cuenta, no se escribe

La evidencia del eje `pruebas` decía **«687 pruebas en 54 archivos, todas
verdes»**. Era cierto el día que se tecleó y falso tres tandas después: la
batería estaba en **834**.

Es la **tercera** vez en esta misma auditoría que aparece el mismo defecto, y las
tres veces el que se creyó la afirmación fue un instrumento:

| dónde | decía | era |
|---|---|---|
| superficie `anon` (CLAUDE.md) | «5 funciones, ninguna otra» | 24 funciones y 3 tablas |
| entorno de pruebas (CLAUDE.md) | «idéntico a prod, verificado por md5» | 130 migraciones atrás |
| eje `pruebas` (`puntuar.mjs`) | «687 pruebas» | 834 |

Ahora se cuenta **ejecutando la batería**. Y si no se puede ejecutar, no se
inventa un número: la evidencia dice *«la batería no se pudo ejecutar acá: el
tamaño no se midió»* — un instrumento que no pudo medir no puede dar verde.

**Y el primer intento de contarlo también salió mal**, que es la lección de
segundo orden: `numTotalTestSuites` cuenta bloques `describe`, no archivos, así
que informó **244 archivos** sobre 64 reales. Un número derivado no es
automáticamente un número correcto — hay que mirar si el que sale se parece a lo
que uno sabe.

### 8.15 Una ruta sentada sobre el umbral

Tras convertir los vacíos, cuatro rutas pasaron de «sin resolver» a «sin datos y
lo dicen» — que era lo esperado. Pero **una ruta que estaba medida dejó de
estarlo**: `cierre-periodo`.

No había cambiado nada en ella. Medida a mano: **1,124 caracteres**, contra un
corte de **1,100**. Veinticuatro caracteres.

**Una ruta sentada sobre el umbral no da un resultado: da un resultado distinto
cada corrida.** Y un instrumento que oscila enseña a no mirarlo, que es la forma
en que un control se muere sin que nadie lo apague.

El corte bajó a **900**, y el número sale de lo medido: el chasis vacío —marco,
menú y encabezado, sin nada de contenido— da **779**. Se puede bajar sin riesgo
precisamente por el trabajo de §8.10 y §8.13: los vacíos ya no dependen de este
número. Los canónicos declaran `data-vacio` y los dibujados a mano los caza
`vacio-a-mano`, que está en cero y es bloqueante.

Es la forma general del arreglo que se repitió toda la jornada: **cuando una
señal positiva existe, el umbral deja de tener que hacer el trabajo difícil.**

### 8.16 El eje móvil, destrabado del todo: 54 de 54

Cinco versiones del detector persiguieron un corte que separara «hay algo que
medir» de «no llegué a mirar». El corte no existía, y no por falta de tino:
**la pregunta estaba mal hecha.**

Una vista con estado vacío **igual tiene interfaz que medir**. Sus filtros, sus
botones y el propio cartel de vacío son blancos de dedo como cualquier otro.
Marcarla «no medida» descartaba pantallas enteras que sí había que revisar — y
por eso ninguna versión encontraba el corte: se estaba buscando la frontera
equivocada.

Lo único que de verdad impide medir es que **la vista no pinte nada suyo**. Eso
no se podía ver porque el chasis —marco, menú, encabezado, barra de filtros—
pinta sus propias tarjetas y se mezclaba con las de la vista. Medido: el chasis
solo da entre 13 y 24, y `sesiones` —con dos fichas de persona reales— da 16. Los
rangos se solapan y ningún corte los separa.

`GlassViewLayout` ahora estampa **`data-contenido`** donde termina el marco.
Contando adentro, los mismos casos se separan solos:

| ruta | dentro del contenido | declara vacío | qué es |
|---|---:|---|---|
| `overview` | 154 | sí (un widget) | llena |
| `cierre-periodo` | 18 | no | llena |
| `libro-compras-completo` | 17 | no | llena |
| `sesiones` | 5 | no | llena (2 fichas) |
| `cotizaciones` | 5 | **sí** | vacía |
| `compras` | 2 | no | una compra |
| `my-announcements` | 1 | **sí** | vacía |

**Resultado: 54 de 54 rutas medidas. 0 hallazgos, 0 reventadas, 0 tablas en el
teléfono, 0 desbordes de página, 0 toques perdidos.**

Es el mismo arreglo por tercera vez, y ya es un patrón con nombre: **cuando el
portal declara lo que sabe, el instrumento deja de adivinar.** `data-destino` en
la ficha, `data-vacio` y `data-cargando` en los estados, `data-contenido` en el
chasis. Ninguno cambia un pixel; los tres convierten una inferencia frágil en un
dato.

El eje `movil` sube a **95** —el tope sin sello de sala— y no a 100: el entorno de
pruebas sigue 130 migraciones atrás (§8.11), así que lo medido vale para la
**maqueta**, que no depende del esquema, y no para una vista cuyo dato no llegó a
cargar.

### 8.17 Un cuelgue que era del taller, no del portal

El barrido empezó a colgarse: 15 minutos contra los 4 que tarda. La ruta donde se
trababa devolvía **«Navigation interrupted»**, y la consola decía *«Importing a
module script failed»* — el mismo error que en producción significa «se publicó
una versión nueva y este archivo ya no existe», y que `ErrorBoundary` responde
**recargando la página**. Por eso la navegación se interrumpía: el portal se
estaba recargando solo, correctamente.

La causa no era el portal: era el **servidor de desarrollo con dos horas de vida
y decenas de ediciones encima**. Su grafo de módulos quedó inconsistente y empezó
a servir imports que ya no resolvían. Reiniciarlo —y borrar `node_modules/.vite`—
lo resolvió: la ruta carga y mide 1,124 caracteres.

Queda escrito porque el síntoma es **indistinguible** del defecto real que
`ErrorBoundary` viene a cubrir, y perseguirlo en el portal habría costado horas.
Antes de creerle a un fallo de carga de módulo en desarrollo: reiniciar el
servidor.

### 8.18 La brecha de mayo/2025, cerrada — $117,509.80

El acumulado diario de ventas (`sales_daily_stats`) **empezaba el 2025-05-18** y
las facturas el **2025-05-01**. Faltaban **85 pares fecha·sala** —17 días × 5
salas— con **12,113 facturas** por **$117,509.80**.

La causa estaba entendida desde el 21 de agosto y anotada sin taparse: el cron
diario corre `refresh_sales_daily_stats(365)`, y esos días salieron de la ventana
de un año antes de haberse calculado nunca. Un tramo que nunca entró y que
después queda a más de 365 días **no vuelve solo**.

**Lo que hizo segura la corrección fue medir antes lo que la función BORRA.** No
sólo agrega: elimina de su ventana las filas que ya no tengan facturas detrás.
Sobre 500 días eso son **2,744 filas en riesgo**, así que primero se comprobó
cuántas quedarían huérfanas —**cero**— y recién entonces se corrió, con permiso
explícito. Escribió 86 filas.

> Una función idempotente no es automáticamente una función inofensiva: **lo que
> hace depende del rango que se le dé.**

**Y mi propia medición previa estaba mal.** Conté **$120,078.21** porque sumé
todas las facturas; la función excluye `estado IN ('NULA','DTE INVALIDADO EN
MH')`. La diferencia de **$2,568.41** son exactamente las anuladas. El número
bueno era el que ya estaba anotado — o sea que el dato viejo corrigió a la
medición nueva, que es el orden inverso al habitual y conviene tenerlo presente.

Hoy la tabla arranca el 2025-05-01 y **no falta ningún par en 500 días**.

⚠️ El agujero se puede volver a abrir: el cron sigue con 365 días. Si aparece
otra brecha vieja, la salida es la misma — medir el borrado, y llamar con un
rango que la cubra.

### 8.19 El rebase no podía funcionar, y el motivo es el propio flujo de trabajo

Con el permiso concedido, el rebase del entorno de pruebas se corrió dos veces.
Las dos terminaron en **`MIGRATIONS_FAILED`**, y avanzó **8 de 130**.

El estado no dice por qué. Buscándolo apareció esto: **nueve migraciones existen
sólo en el branch** — ocho del 12 de agosto y una del 14. No están en producción
con ese número.

No es un descuido de nadie. Es **la consecuencia esperable del flujo que este
mismo repo prescribe**: CLAUDE.md manda probar el DDL de tablas calientes en el
branch antes que en prod, y con razón. Pero al reaplicar después en producción,
`apply_migration` genera una versión nueva — así que la fila del branch queda
huérfana. Con nueve de ésas, la historia del branch deja de ser un prefijo de la
de prod y el rebase no tiene por dónde entrar.

> **La herramienta de arreglo estaba deshabilitada por el uso correcto de la
> herramienta que la necesitaba.** Y nadie lo sabía porque nadie había rebaseado
> nunca.

Queda escrito en CLAUDE.md junto a la instrucción que lo causa, que es donde
sirve. Ponerlo al día exige **rehacer el branch** — con su costo explícito:
se pierden la corrida de fechas y los permisos de la cuenta de pruebas (los dos
se rehacen con sus scripts), y **cambia el ref**, así que hay que rehacer
`.env.staging`.

### 8.20 Los cuatro hallazgos de datos que quedaban, medidos uno por uno

El eje `flujo` es el que más pesa y el peor puntuado, y casi todos sus hallazgos
son «falta probarlo en sala» — que es lo que el sello cubre y no se puede cerrar
desde acá. Pero cuatro eran preguntas de datos con respuesta. Se midieron las
cuatro contra producción.

**1 · La brecha de mayo/2025 — cerrada.** §8.18.

**2 · El −$621.17 falso de Salud 1 — ya no existe.** `cortes_caja` arranca hoy el
**2026-08-14** y no hay ninguna fila del 13. Lo que sí apareció midiendo son dos
diferencias confirmadas y grandes en Salud 3 —**−$970.39** el 17-ago y
**−$499.50** el 20— y las dos tienen la forma de una decisión, no de un error: se
recontó dos veces, dio lo mismo, y se confirmó. El proceso funcionando.

**3 · La bitácora de los cortes — existe, y es mejor que la general.**
`audit_logs` tiene **una** entrada de corte contra **247 resoluciones**, lo que a
primera vista parecía un agujero grave. No lo es: hay una tabla propia,
`cortes_caja_eventos`, con **exactamente 247 filas** y más información que una
entrada genérica (`estado_antes`, `estado_despues`, `motivo`, autor, origen).

> Y eso deja al descubierto un punto ciego real del detector de bitácora: sólo
> conoce `appendAuditLog`. Una tabla de eventos propia le resulta invisible, igual
> que una escritura hecha por `.rpc()`. Acá el resultado fue bueno; el detector no
> tenía cómo saberlo.

**4 · Las compras que comparten sello — son 7, no 6, y dos son graves.** Creció
una el 1-ago. Cuatro de los siete pares son la misma compra repetida, uno es un
proveedor con dos documentos, y **dos tienen proveedores DISTINTOS bajo el mismo
sello**:

| sello | compras |
|---|---|
| `2026262C8A5E…ISND` | COFARSAL $465.96 · FARMA VALUE $38.33 (12-jun) |
| `202618E24BC…D7M` | COFARSAL $663.94 · LETERAGO $125.82 (21-jul) |

Un sello de Hacienda identifica **un** documento. Dos proveedores no pueden
compartirlo: en cada par, uno de los dos lo tiene mal asignado.

Y hay un hilo del que tirar: `documento_numero` guarda el código de generación
**cortado a 20 de sus 36 caracteres** (1,037 filas), y ése es el campo por el que
`backfill-dte-related-docs` y `leer-dte-json` buscan a qué compra pegarle el
sello. El recorte viene del sistema de origen y ya estaba documentado —no es un
defecto del portal—, pero **usar una clave recortada para asignar un sello fiscal
es exactamente la forma de asignárselo al documento equivocado.** En uno de los
casos el `documento_numero` es, literalmente, el propio sello recortado.

Queda abierto y mejor descrito de lo que estaba: de «6 pares comparten sello» a
«dos sellos están en la compra equivocada, y acá está por dónde puede haber
pasado».

### 8.21 Rehacer el entorno de pruebas destapó que el historial no se puede reproducir

El branch nuevo se creó, y **falló igual que el viejo**. Eso descartó la
hipótesis cómoda —«el branch estaba sucio»— y dejó la incómoda: **la historia de
migraciones no se puede replicar sobre una base vacía**. Se detuvo en la
**331 de 543**.

La causa es de manual y estaba a la vista:

```sql
SELECT cron.unschedule('cortes-caja-1min');
```

`cron.unschedule` **lanza** si el trabajo no existe. En producción existe —porque
alguien lo creó antes— así que la migración pasa y nadie se entera. En una base
vacía aborta, y con ella **las 212 migraciones que venían después**.

Y el trabajo que faltaba, `cortes-caja-1min`, **ninguna migración lo crea**: se
programó en producción a mano, y una migración posterior lo dio por hecho.

> Esto no es un problema del entorno de pruebas. Es que **el historial no se
> puede reproducir**, que es exactamente lo que hace falta el día que haya que
> reconstruir la base desde cero.

De nueve usos de `cron.unschedule`, **cinco ya tenían la guarda correcta** —el
patrón estaba en el repo— y una vive dentro de una función (corre al llamarla, no
al replicar). Las tres que faltaban quedaron con
`WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = …)`, y `gate:migrations`
lo vigila desde ahora, probado con una regresión que caza la mala y deja pasar la
guardada.

**Y hay un módulo entero fuera del control de versiones.** Con el branch ya al
día (545 migraciones, la misma versión máxima que prod), la comparación de
objetos dejó **dos tablas y siete funciones que existen sólo en producción**, y
las nueve son del mismo lugar:

| | |
|---|---|
| tablas | `contabilidad_config`, `periodos_fiscales` |
| funciones | `cerrar_periodo_fiscal`, `reabrir_periodo_fiscal`, `get_periodo_fiscal`, `get_periodos_fiscales`, `calc_credito_declarable`, `get_clasificacion_fiscal_pendiente`, `resolver_clasificacion_pendiente` |

**El cierre de período fiscal —lo que usa el contador para cerrar el mes— existe
sólo en producción.** Una reconstrucción no lo tendría, y nadie lo sabía porque
nunca se había intentado reconstruir.

**Un tercer hallazgo, más chico y del mismo tipo:** la semilla creaba la cuenta
de pruebas sin `must_change_password: false`, y el portal exige que sea
explícitamente `false` (`null` cuenta como «tiene que cambiarla»). O sea que la
reconstrucción entraba bien y **aterrizaba en «Cambiá tu contraseña» sin poder
pasar de ahí**. Corregido en la semilla.

Los tres se descubrieron por lo mismo: **nadie había ejercitado nunca el camino
de reconstrucción.** Un procedimiento de recuperación que nunca se corre no es un
procedimiento, es una intención.

### 8.22 El cierre fiscal entra al control de versiones

Las dos tablas y las siete funciones quedaron capturadas en
`20260824050000_el_cierre_fiscal_entra_al_control_de_versiones.sql`, y la
migración se registró en producción **sin ejecutar nada**: los nueve objetos ya
existían, así que lo que faltaba era el registro, no los objetos.

**Las definiciones las generó el propio Postgres** (`pg_get_functiondef`) en vez
de retipearse: son 22 kB, y copiarlos a mano arriesga una divergencia silenciosa
entre lo que el historial dice y lo que la base tiene — que es exactamente el
defecto que la migración viene a cerrar.

**La prueba de que sirve fue rebasear el entorno de pruebas, donde no existían.**
Volvieron a aparecer solas: 2 tablas, 7 funciones, sus policies, sus permisos y
sus comentarios, construidos por el historial.

**Y esa prueba encontró algo que la lectura no habría encontrado.** En producción
`calc_credito_declarable` la ejecuta **sólo `service_role`**; en la base
reconstruida quedó también para `authenticated`. La causa: Supabase concede
EXECUTE por defecto a `anon, authenticated, service_role` sobre toda función
nueva, así que un `REVOKE … FROM PUBLIC, anon` —el patrón que usa todo el repo—
**deja a `authenticated` adentro por la puerta de atrás**.

No es cosmético: esa función es SECURITY DEFINER y no chequea permisos adentro
(es un cálculo puro), de modo que en la base reconstruida cualquier sesión
autenticada podía pedir el crédito fiscal declarable del período. Corregido en la
migración y en el branch.

> **Media captura habría sido peor que ninguna**: el primer registro se escribió
> con los `REVOKE` y sin los `GRANT`, lo que en una reconstrucción habría dejado
> las siete funciones revocadas y sin conceder — o sea el módulo muerto. Se
> detectó contándolas.

`gate:migrations --remote`: **546 archivos locales, 546 filas en prod, sin
deriva.**

### 8.23 El barrido de revokes incompletos: 131 medidas, 7 cerradas

El hallazgo de §8.22 no era de una función: era **del patrón que usa todo el
repo**. Supabase concede EXECUTE por defecto a `anon, authenticated,
service_role` sobre toda función nueva, así que

```sql
REVOKE EXECUTE ON FUNCTION f(...) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION f(...) TO service_role;
```

parece cerrar la función a `service_role` y **no la cierra**: `authenticated`
queda adentro porque nunca se le quitó.

Se cruzó lo **declarado** en las 545 migraciones contra el ACL **real** de
producción. **131 funciones tienen EXECUTE para `authenticated` sin que ninguna
migración se lo conceda.** Ese número, solo, asusta sin informar — así que se
partió:

| clase | cuántas | veredicto |
|---|---:|---|
| ayudantes `auth_*` | 6 | **correcto**: los llaman las policies, que corren como el usuario. Sin eso RLS entero deja de funcionar, y sólo devuelven datos del propio llamador |
| funciones de disparador | 14 | **correcto**: sin `NEW` lanzan, no se pueden llamar a mano |
| kiosco (`verify_kiosk_*`, `get_kiosk_boot_payload`) | 4 | **correcto**: abiertas a propósito, ya declaradas en `superficie-anon.json` |
| las que el navegador SÍ llama | 3 | **correcto**: tienen que conservarlo |
| INVOKER (sin privilegio propio) | 67 | **sin efecto**: corren con el permiso de quien llama |
| **DEFINER, sin guarda, que el navegador no llama** | **7** | **hallazgo** |

Las siete quedaron cerradas a `service_role`. La peor de lejos:

> **`notify_employees`** — SECURITY DEFINER, sin ningún chequeo de permiso, y
> acepta **título, cuerpo, enlace y `push` arbitrarios** contra cualquier lista
> de empleados. El único freno era no podérselo mandar a uno mismo. Cualquier
> sesión autenticada podía mandarle un aviso —y una notificación al teléfono— a
> toda la empresa, **con el portal como remitente**.

Le siguen `sincronizar_bitacora_dispensaciones` y `bitacora_tomar_folio`, que
**escriben en un libro regulado** (folios de dispensación, anulación de
renglones) sin preguntar quién llama.

**Tres verificaciones antes de tocar nada**, porque un revoke mal puesto rompe en
silencio: el navegador no las llama ni una vez (0), ninguna función **INVOKER**
las invoca (0 — sus 11 llamadoras son DEFINER o disparadores, que corren con el
permiso del dueño), y el revoke se probó primero en el entorno de pruebas.

**Y una sospecha mía que la medición volteó:** creí que `next_cotizacion_numero`
dejaba que cualquiera quemara números de cotización. Leerla lo desmintió — no
consume ninguna secuencia, calcula el siguiente leyendo la tabla. Llamarla no
tiene efecto.

**El gate lo cierra para siempre**, y aprendió en dos pasos. La primera versión
acusaba **por archivo**: 28 hallazgos sobre 7 funciones, y una migración que
arreglara el permiso no borraba las quejas de las anteriores — el número no
bajaba nunca y no había forma de cerrarlo. Postgres no funciona así: gana la
última sentencia. Ahora mide el **estado final por función**, y excluye los
disparadores. De 28 a 4, y de 4 a 0 con la migración.

### 8.24 El sello prestado: la guarda estaba, y le faltaba la mitad

Los siete pares de compras que comparten sello (§8.20) tienen causa, y es una
asimetría de una línea. `sync-erp-purchases` construye un mapa
`número de documento → sellos` y pregunta:

> ¿este número trae **un solo** sello? Si no, NULL — «un sello equivocado es peor
> que ninguno».

Falta la pregunta de al lado: **¿este sello es de un solo número?** Sin ella, un
sello que el libro del sistema de origen repite bajo dos documentos distintos se
le pega a los dos.

Y no vinieron del correo: **ningún `purchase_dte_documents` tiene esos sellos**,
así que la única vía es el sync. Los montos además difieren —COFARSAL $465.96 con
FARMA VALUE $38.33, COFARSAL $663.94 con LETERAGO $125.82— o sea que **no es la
misma compra cargada dos veces**: son dos compras reales con un sello prestado.

La guarda nueva usa el mismo criterio que su vecina, en la otra dirección.

**Queda sin desplegar y sin decidir**, y es honesto decirlo: el arreglo está en el
repo pero la función corre la versión vieja, así que el defecto sigue produciendo
pares (el séptimo apareció el 1 de agosto). Y las cuatro filas ya escritas siguen
con un sello que en cada par le pertenece a una sola de las dos. Las dos cosas son
escrituras a producción y esperan decisión.

### 8.25 Los sellos de sala: qué hay medido y por qué ninguna área llega

Se revisó la memoria buscando lo que **de verdad corrió en sala**, con fecha y
dato. Hay tres corridas reales, y son buenas:

| qué | cuándo | evidencia medida |
|---|---|---|
| Cola de impresión de sala | 19-ago | Salud 4 imprimió su prueba y **seis bolsas seguidas, todas entre 0.5 y 1.9 s** — contra 8 documentos en toda su historia hasta esa mañana |
| Devolución de pedido, punta a punta | 17-ago | Pedido 116 de La Popular, traslado 29456, vale `6a83760255054`. Salió de la sala 14:58:42, entró a bodega 14:58:46 — **4 segundos**. Pidió Andy Mancia, confirmó Josue Guevara |
| Traslado de pedido | 11-ago | Pedido #96, Salud 2: **476 productos verificados en 38 segundos**, 463 líneas, 157 con lote controlado, 13 hallazgos |

**Y ninguna de las tres alcanza para sellar su área, por tres motivos distintos
que conviene no mezclar:**

1. **Impresión** — la cola funciona, pero la corrida del 19-ago también midió que
   **el camino directo NO saca papel en la caja de Salud 4**, y sigue sin probarse
   en otra sala. Una corrida que descubre un defecto no es una corrida que
   valida: es media validación y un hallazgo nuevo.
2. **Pedidos** — la devolución corrió de verdad, pero el área tiene abiertos el
   brazo del sobrante, el cron de 3 días, la confirmación del lote que llegó
   —que es la parte legal— y una ruta real con conductor.
3. **Traslados** — el #96 fue **simulacro**, por decisión explícita del usuario
   («NO hacer traslados reales todavía»). Un simulacro mide el mecanismo, no el
   circuito.

Contando lo que la memoria declara pendiente: **diecinueve frases que empiezan
con «falta»**, y casi todas son «falta que alguien lo haga en una sala».

> Por eso el sello es un TOPE y no un sumando. Si fuera un sumando, un área
> podría compensar la falta de prueba real con puntaje de otro lado — que es
> exactamente la confusión entre «construido» y «funciona». Hoy las 25 áreas
> están donde corresponde: **construidas y sin sellar.**

Lo que esta revisión sí deja es la lista de **qué le falta a cada una para
sellarse**, que es más útil que un sello puesto de apuro.

### 8.26 El eje de pruebas medía lo que no importa

Escribiendo pruebas para subirlo apareció el defecto en la regla, no en el
portal: **contaba archivos de prueba**.

Nómina tiene **un** archivo que prueba a fondo `calcRenta` y `calcPayrollEntry`
—la tabla de renta entera, el tope del ISSS, la quincena completa— y puntuaba
62%: exactamente lo mismo que un área con una prueba de una línea. Para subirla
habría que **partir ese archivo en dos**, que no agrega una sola verificación.

> Una regla que premia partir archivos enseña a partir archivos. Y el que la
> escribió —yo— estuvo a punto de hacerlo.

Ahora cuenta **cuántos archivos del área quedan nombrados por alguna prueba**,
sobre cuántos tiene. Sube cuando se cubre algo nuevo y no se mueve al reacomodar
los tests.

El retrato que da es distinto, y varios puntajes **bajaron** — que es la señal de
que ahora es honesto:

| área | cobertura real |
|---|---|
| Traslados | **7 de 9 (78%)** |
| Cortes de caja | 7 de 20 (35%) |
| Plataforma | 25 de 132 (19%) |
| Bitácoras | 1 de 13 (8%) |
| **Sucursales** | **1 de 23 (4%)** |

La regla vieja ponía a Traslados y a Sucursales casi iguales. Son 78% y 4%.
