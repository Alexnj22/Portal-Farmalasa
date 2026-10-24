# Marketing — cómo funciona el planificador de contenido (2026-10-24)

Documento del área `marketing` (`auditoria/areas.mjs`). Todo lo de acá sale del
código y de las migraciones; donde se nombra una regla, se nombra también la
pieza que la hace cumplir. Si el código y este documento discrepan, manda el
código — y hay que corregir esto.

Archivos: `src/utils/marketing.js` (reglas que no conocen al navegador),
`src/utils/marketingInforme.js` (el informe del mes en PDF y HTML),
`src/data/marketing.js` (lecturas y escrituras), `src/views/marketing/`
(pantallas; `iconos.js` y `medir.js` son la parte de lógica que necesita
navegador o íconos). Migraciones: `supabase/migrations/2026100*_marketing_*` y
las dos del 23-oct (`segunda_a2_06_marketing_candados`, `h32_marketing_borradores`).

---

## 1. Quién es quién

Permisos del módulo `marketing` (migración `marketing_planificador`):

| permiso | qué deja hacer |
|---|---|
| `can_view` | ver el calendario y el flujo, comentar, pedir piezas (solicitudes), dejar ideas |
| `can_edit` | planificar, subir diseños, enviar a revisión, anotar la pauta |
| `can_approve` | aprobar piezas y el mes, pedir cambios, firmar el cierre del mes |

Permisos de arranque (se ajustan después en Permisos): **Diseñador/a Gráfico/a**
ve y edita; **Gerente General** y **Administrador** ven y aprueban; **Agente de
Atencion de Canales Digitales** (así, sin tilde, en la tabla de cargos) sólo ve. EDITAR lo tiene sólo el diseñador a
propósito: con editar se ven los diseños antes de que el mes se envíe.

Aparte está el módulo **`galeria`**: lo tienen las salas, y con él se ve SÓLO lo
liberado y aprobado (ver §7).

## 2. El ciclo de una pieza

Una pieza es una publicación de un día: post, carrusel, reel, video o historia
(`FORMATOS`), de una o varias marcas, para una o varias redes, con su tema
(`PILARES`). Vive dentro de su mes: un trigger (`marketing_pieza_en_su_mes`)
rechaza una fecha de otro mes.

Los estados, en el orden en que avanza (`ESTADOS_PIEZA` / `PASOS_DEL_FLUJO`):

```
pendiente → en_proceso → finalizado («Lista para revisión») → aprobado → programado → publicado
                               ↑                    │
                               └──── cambios ◄──────┘  (lo pide quien aprueba)
```

1. **Subir.** El diseñador crea la pieza y sube los diseños. Un diseño va al
   bucket en `<mes>/<pieza>/<fecha>-<nombre-limpio>` (`subirDiseno`): la ruta es
   lo que el RLS del bucket mira. Un archivo pesado entra como **enlace**
   (`agregarEnlace`). Una versión nueva de un diseño es una fila nueva que
   apunta a la anterior (`anterior_id`); el número y el retiro de la anterior
   los pone la base (`marketing_archivo_version`), así no hay dos V2 de lo mismo.
2. **Mover.** El diseñador mueve la pieza entre `pendiente`, `en_proceso` y
   `finalizado`. Sólo quien la creó la mueve de estado o de día (candado,
   §5); la pantalla usa la misma regla (`puedeMoverA`).
3. **Enviar a revisión.** Dos caminos, los dos por función de la base:
   - la pieza sola: `marketing_enviar_pieza` (exige `finalizado`), marca
     `enviada_at` y avisa a quien aprueba;
   - el mes entero: `marketing_publicar_mes`, que sube la `version` del mes,
     marca `publicado_at` y lo pasa a `en_revision`. Si el mes no tiene piezas,
     se niega.
4. **Cambios.** Quien aprueba pide cambios con `marketing_revisar_pieza`
   (decisión `cambios`, **exige texto**). La pieza pasa a `cambios`; si el mes
   estaba en revisión o aprobado, vuelve a `con_cambios`. Se avisa al diseñador.
5. **Aprobar.** `marketing_revisar_pieza` (decisión `aprobar`) aprueba una;
   `marketing_aprobar_mes` aprueba de una vez las que están `finalizado` y se
   niega si quedan piezas sin terminar o con cambios pedidos (las cuenta y lo
   dice). Sólo se revisa lo que se envió: si ni el mes ni la pieza se enviaron,
   la base lo rechaza.
6. **Programar y publicar.** Ya aprobada, el diseñador la pasa a `programado`
   (agendada en la red) o a `publicado`. El cron de las 8:00 pasa a
   `publicado` lo programado cuyo día ya quedó atrás.

Cada paso deja su comentario de tipo `aprobacion` o `cambio` (lo escriben las
funciones, no la pantalla) y su fila en `marketing_historial`.

### Tocar lo aprobado lo devuelve a revisión

Si una pieza `aprobado` o `programado` cambia de título, copy, hashtags, fecha,
hora, formato, redes o marcas, el candado la devuelve a `finalizado`
(`marketing_candado_de_estado`). Lo mismo si se agrega, quita o CAMBIA un
archivo (`marketing_archivo_reabre_pieza`, H31 desde el 23-oct). El motivo:
quien aprobó firmaría una pieza que ya no es la que vio. Y una pieza que vuelve
a revisión deja de estar liberada para las salas (`marketing_retener_si_reabre`).

## 3. Quién ve qué

| | `can_edit` | `can_view` (sin editar) | sólo `galeria` |
|---|---|---|---|
| calendario, flujo, avance | sí | sí | no |
| diseños de una pieza NO enviada | sí | **no** | no |
| diseños de una pieza enviada o del mes enviado | sí | sí | no |
| diseño «sin enviar» (§4) de otra persona | **no** | **no** | no |
| piezas liberadas y aprobadas | sí | sí | sí |
| comentarios y pauta | sí | sí | no |

Esto lo decide el RLS de `marketing_archivos` (`marketing_archivos_select`,
`marketing_archivos_galeria`) y de `storage.objects` (`marketing_storage_select`,
`marketing_storage_galeria`) — **no la pantalla**. Escondido sólo en el
navegador, el archivo se seguiría bajando con su URL.

## 4. Lo subido después del envío no lo ve nadie hasta reenviar (H32, 2026-10-23)

Decisión del usuario: lo que el diseñador sube a una pieza **después** de
enviarla a revisión es un borrador. No lo ve quien aprueba ni nadie más hasta
que la vuelva a enviar. Migración `20261023180657_h32_marketing_borradores.sql`.

**La columna.** `marketing_archivos.borrador boolean NOT NULL DEFAULT false`.
El navegador nunca la escribe: `subirDiseno` no la manda.

**El trigger.** `marketing_archivos_borrador` (BEFORE INSERT OR UPDATE,
función `marketing_archivo_borrador`) la calcula: al insertar, o al cambiar
`url`, `enlace` o `pieza_id`, `borrador = true` si la pieza ya tiene
`enviada_at` o su mes ya tiene `publicado_at`. Un `UPDATE` que intente cambiar
`borrador` a mano se rechaza («Un diseño sin enviar se publica enviando la
pieza a revisión»). Se llama `…_borrador` a propósito: los BEFORE INSERT corren
en orden alfabético y `marketing_archivos_version` tiene que ver la marca ya
puesta.

**La versión.** Una V2 borrador **no** retira a la V1 (`marketing_archivo_version`
sólo marca `reemplazado` si la nueva no es borrador, o si la anterior también
lo era). Así quien aprueba sigue viendo la V1 que aprobó. En el navegador,
`conVersionesAlDia` da por retirada la V1 cuando quien mira recibe también la
V2 (la autora); el rótulo de la V2 es «Sin enviar» (`ROTULO_SIN_ENVIAR`).

**Publicar los borradores.** `marketing_publicar_borradores(p_piezas uuid[])`
(SECURITY DEFINER, ejecutable sólo por `service_role`: no se llama desde el
navegador). La llaman `marketing_enviar_pieza` y `marketing_publicar_mes`. Hace
tres cosas: retira las versiones que tienen un sucesor borrador, pone
`borrador = false`, y si publicó algo, devuelve a `finalizado` las piezas que
estaban `aprobado` o `programado` — un diseño nuevo se vuelve a revisar. Las
dos funciones devuelven `disenos_publicados` con la cuenta.

**El objeto del bucket.** `marketing_objeto_es_borrador_ajeno(name)` dice si un
objeto de Storage es el archivo de un borrador que NO subió quien pregunta ni
es de una pieza que creó. Sólo mira rutas cuyo segundo tramo es un uuid (la
carpeta de la pieza); la biblioteca no es borrador nunca.

**Las cuatro policies** que la usan o la miran:

| policy | tabla | qué agrega H32 |
|---|---|---|
| `marketing_archivos_select` | `marketing_archivos` | un borrador sólo lo ven quien lo subió y quien creó la pieza |
| `marketing_archivos_galeria` | `marketing_archivos` | la galería nunca ve un borrador (`NOT borrador`) |
| `marketing_storage_select` | `storage.objects` | `AND NOT marketing_objeto_es_borrador_ajeno(name)` |
| `marketing_storage_galeria` | `storage.objects` | ídem para la galería |

**El historial** no muestra el enlace de un borrador: dice «Enlace»
(`marketing_anotar_archivo`).

## 5. Los candados

Todos viven en la base. Las funciones de revisión marcan su transacción con el
GUC `marketing.por_funcion = 'si'` y los triggers las dejan pasar; cualquier
otro `UPDATE` (el de la pantalla, o uno hecho a mano por la API) choca.

- **El estado del mes** (`estado`, `version`, `publicado_*`, `aprobado_*`) sólo
  cambia publicándolo o aprobándolo. Al crear un mes nace `planificando`.
- **Una pieza la aprueba quien revisa**: nadie la pone `aprobado` con un update.
- **Programar exige aprobado**, y **publicar también** (H30, 23-oct): antes la
  regla vivía sólo en `puedeMoverA` y por la API se publicaba una pieza nunca
  revisada, que llegaba a la galería.
- **La revisión la firma quien revisa**: `revisado_por`/`revisado_at` no se tocan.
- **Sólo quien creó la pieza la mueve** de estado o de día (salvo superusuario).
- **Lo aprobado no se borra del bucket** (H31): `marketing_storage_delete` niega
  borrar objetos de piezas `aprobado`, `programado` o `publicado`.
- **Un comentario no se reescribe** (H33): de un comentario sólo se marca
  `resuelto`, su autor corrige el texto y mueve su marca; tipo, autor, mes,
  pieza y respuesta no cambian (`marketing_comentario_inmutable`).
- **El tope de pauta**: la suma del presupuesto de las piezas no puede pasar el
  `presupuesto_pauta` del mes, y sin tope fijado no se asigna nada
  (`marketing_tope_de_pauta`). El tope lo fija gerencia.
- **Quitar una pieza**: sólo quien la creó (o superusuario) y no si está
  publicada (`marketing_piezas_delete`). Sin policy el `DELETE` devuelve cero
  filas sin error; `borrarPieza` lo convierte en error.

## 6. Storage

Bucket **privado** `marketing`, 200 MB por archivo (alcanza un reel de 60 s en
1080p), tipos: jpeg, png, webp, gif, heic, mp4, quicktime, webm y pdf.

- Diseños: `<mes_id>/<pieza_id>/<archivo>`. La base guarda la URL en forma
  pública como identificador (regla 10 de CLAUDE.md), nunca una firmada; la
  pantalla las firma en una sola tanda por mes (`firmarDisenos`).
- Biblioteca de marca: `biblioteca/<archivo>` (logos, paleta, tipografías).
- Al quitar una pieza o un archivo, la fila se borra primero y el objeto
  después: un objeto huérfano es el error barato. Si el bucket no deja
  borrarlo, no se lanza —la acción sí salió— pero queda en la consola.
- Las medidas (ancho y alto) se toman al elegir el archivo (`medirArchivo`) y
  dicen si sirve como estado de WhatsApp. Un formato que el navegador no abre
  (HEIC en Chrome) no la deja esperando: a los 4 s se sube sin medidas.

## 7. Liberar para las salas (galería)

Quien edita o aprueba libera una pieza aprobada, programada o publicada con
`marketing_liberar_pieza` (cualquier otro estado se rechaza); las salas
la ven en la galería, la descargan y la publican en WhatsApp. El aviso a las
salas suena con la primera pieza liberada; las de los 15 minutos siguientes
llegan a la campana sin sonar.

## 8. Lo que pasa solo

- **Cron `marketing-recordatorios-8am-sv`** (`0 14 * * *` UTC = 8:00 en El
  Salvador, `marketing_recordatorios_diarios`): pasa a publicado lo programado
  de días anteriores, recuerda lo de hoy que no está programado ni publicado,
  avisa de lo vencido de las dos últimas semanas, y recuerda la fecha límite
  para enviar el calendario del mes siguiente (`dia_limite_envio`, 3 días
  antes, la víspera y el día). Se apaga con `recordatorios_activos`.
- **Historial**: cada cambio de estado, de fecha, de archivo o de liberación
  queda en `marketing_historial` por trigger, con quién y cuándo.

## 9. Pauta, promociones e informe

- La pauta es 1:1 con la pieza (`marketing_pautas`). Un resultado vacío se
  guarda como `null` («todavía no se anotó»), nunca como cero: un cero haría
  creer que la pauta corrió y no trajo nada (`guardarPauta`). El costo por
  mensaje o por clic sólo se calcula con algo gastado Y algún resultado.
- Una pieza ligada a una promoción compara la venta de sus productos durante
  la pauta contra los mismos días justo antes (`marketing_efecto_en_ventas`).
  No es causalidad y el informe lo dice.
- El **informe del mes** (`construirInformeDoc`) se descarga en PDF desde el
  portal; la app imprime el MISMO documento traducido a HTML
  (`construirInformeHtml`), así los dos papeles dicen lo mismo.

## 10. Control del servicio y cierre

El servicio del diseñador tiene metas mensuales, 10 días de anticipación por
pieza (exento en octubre de 2026), visitas y entregables. El cumplimiento lo
calcula `marketing_cumplimiento`: cuenta como entregado lo aprobado,
programado o publicado. Quien aprueba firma el **cierre** del mes
(`marketing_cerrar_mes`: cumplió, con observaciones o no cumplió — las dos
últimas exigen escribirlas); el acta guarda la FOTO de los números al firmar,
así corregir el mes después no cambia lo que se evaluó para el pago.

## 11. Lo que la bitácora anota

Toda escritura de `src/data/marketing.js` llama a `anotar(...)` en su propio
cuerpo (`MARKETING_PIEZA_*`, `MARKETING_ARCHIVO_*`, `MARKETING_MES_*`,
`MARKETING_PAUTA_*`, `MARKETING_COMENTARIO_*`, `MARKETING_IDEA_*`…), así
cualquier pantalla —portal o app— la hereda. Las pruebas de esa capa están en
`tests/unit/marketingDatos.test.js`; las del informe, en
`tests/unit/marketingInforme.test.js`; las de íconos y medidas, en
`tests/unit/marketingPantalla.test.js`.
