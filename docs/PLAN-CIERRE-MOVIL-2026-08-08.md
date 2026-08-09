# PLAN — Cerrar al 100 la parte visual/móvil

**Estado:** F1–F5, F7, F8 ✅ · **F6 parcial** (dos hallazgos cerrados, falta
standalone) · **F9 abierta** (la rotación) · **Abierto el** 2026-08-08 ·
**Cierra:** `PLAN-MOBILE-2026-07.md`
(fase 4 y criterio 4 de aceptación) y `PLAN-CANON-MOVIL-2026-08-07.md` (fases 2 y 4).

> ## Bitácora — 2026-08-08
>
> | Fase | Estado | Resultado medido |
> |---|---|---|
> | **F1** instrumento | ✅ v2.521.3 | 37 falsos positivos fuera. `sinAcuse` 77 → **40** sin tocar una vista. Verificado en rojo por los dos lados |
> | **F2** referencia | ✅ temas · ⏳ pestañas+modales | 37 rutas × 4 temas = **148 pantallas, todo en cero**. El tema **no cambia el layout** |
> | **F3** recortes | ✅ el conocido · ⏳ los nuevos | `facturacion#observaciones` **13 → 0** (v2.523.1) |
> | **F4** acuse | ✅ v2.523.0 | **40 → 0** en las 37 rutas. Eran **10 formas**, no 40 controles |
> | **F5** iPad Mini | ✅ v2.523.2 | Matriz **0 de 35 celdas**. La premisa del código era falsa y se midió |
> | **F6** teléfono real | ⏸️ necesita al usuario | Guion en `docs/PRUEBA-EN-TELEFONO-REAL.md` |
> | **F7** CI | ✅ v2.522.1 | Gates bloqueantes + barrido nocturno. Verificado en rojo |
>
> **Lo que la corrida completa encontró y los planes viejos no podían ver** —
> pestañas internas y diálogos, que nunca se habían medido:
> `pedidos#pedidos` con **42 recortados** (seis filas × los siete niveles de
> `LifecycleTimeline`: un arreglo, no 42), más dos controles chicos en
> `pedidos»accion` y `minmax#red`. Es exactamente para lo que existía la fase.
>
> ## La corrida de referencia — 117 pantallas (2026-08-08)
>
> Sólo fue posible después de arreglar el cuelgue de v2.524.1: hasta entonces
> **8 de 14 rutas** morían en silencio y el recorrido de pestañas nunca había
> cubierto las vistas sin pestañas.
>
> ```
> 117 pantallas · desbordes 116 · chicos 109 · zoom de iOS 1 · scroll lateral 0
> ```
>
> **F8 — la deuda que destapó, agrupada por forma.** Los números crudos engañan:
> son **ocho formas**, no 226 controles.
>
> | n | Dónde | Qué |
> |---|---|---|
> | 113 | `roles#chart` | el organigrama SVG: `path` que sobran hasta **120px**. Necesita carril |
> | ~70 | `staff»accion` · `dashboard»accion` · `branches»accion` | **43×43 — ver abajo, probable falso positivo** |
> | 20 | `overview»ficha` | fila de producto 227×**31** de alto |
> | 13 | `requests#*` (4 pestañas) | fila 358×**24** |
> | 6 | `metas#confirmacion` | botón 113×**15** |
> | 3 | `facturas-compra#revision` | sobran 32/32/14px |
> | 1 | `productos»ficha` | **un input con fuente <16px → iOS hace zoom** |
>
> ### El patrón 43×43 — medido, sin explicar
>
> Aparece **sólo en pantallas `»accion`**, o sea con un diálogo abierto, y
> siempre sobre controles del **shell** (el menú, Mi Perfil, la paginación), no
> del diálogo. Medido en `/staff`:
>
> ```
> SIN diálogo:  44 × 44      transforms: []
> CON diálogo:  43.12 × 43.12 transforms: []     ← exactamente ×0.98
> ```
>
> **Ningún ancestro tiene `transform`**, y no hay regla `scale(0.98)` ni `zoom:`
> en `index.css`/`App.css`. La hipótesis viva es el **`font-size` del root**:
> `w-11` son 2.75rem, y 2.75 × 15.68 = 43.12, o sea un root de 16 × 0.98.
>
> **RESUELTO (v2.525.0).** Sale de `blurClasses`: con un diálogo abierto el shell
> entero —`aside`, `main` y las tabs— recibe `pointer-events-none select-none
> scale-[0.98] blur-[2px]`, o sea que se aleja y se difumina **a propósito**. Los
> 70 eran controles que ya cumplen, medidos al 98%. Ninguno se puede tocar: el
> velo está encima. El medidor ahora descarta lo que tiene `pointer-events: none`
> en su cadena.
>
> ## F8 — cerrada el 2026-08-08
>
> ```
> desbordes 116 → 0 · chicos 109 → 0 · zoom iOS 1 → 0 · sin acuse 46 → 0
> ```
>
> De los 109 chicos, **58 eran el velo** y **12 medían la referencia** (el
> `input` `sr-only` en vez de su `<label>` — y al corregir eso aparecieron 5
> casillas de verdad chicas que el número viejo escondía). Los 39 reales salieron
> por su forma o su canónico: filas de producto (20), encabezados de Solicitudes
> (13), «De dónde sale» de Metas (6), el canónico `Checkbox` (5).
>
> Aparte, el **organigrama de Roles** no era un problema de tamaño sino de
> alcance: el pan sólo escuchaba eventos de mouse, así que en el teléfono estaba
> completo e **inalcanzable**. Ahora se arrastra con el dedo (v2.524.10).
>
> ## F9 — la rotación, ABIERTA
>
> Al girar, el contenido queda pintado al ancho de la orientación anterior y el
> resto sale en blanco. **Se arregla solo al recargar o cambiar de vista**, así
> que el ancho correcto existe: lo que no vuelve a ocurrir es el reparto.
>
> Probado y **fallido** (revertido en v2.524.9): re-parsear el meta viewport en
> `orientationchange`, y forzar el reflow con un interruptor de `display` en la
> raíz — éste además se veía. Tampoco sirve bloquear la orientación:
> `screen.orientation.lock()` no existe en Safari de iOS.
>
> **Sin probar:** remontar el árbol de React con una `key` que cambie con la
> orientación, que es lo que de verdad hace «abrir otra vista». El aviso está en
> `index.html`, en el punto donde alguien iría a reintentarlo.

Los dos planes anteriores están **más cerrados de lo que dicen sus documentos**:
se commiteó entre el 6 y el 7 de agosto y no se anotó. Este plan parte de la foto
verificada de hoy —no de lo que los docs afirman— y enumera lo que falta con su
número medido, para que ninguna fase se abra a discutir si el trabajo existe.

---

## 0. La foto de partida, verificada hoy

Lo que **ya está cerrado** y los planes viejos siguen listando como pendiente:

| | Estado real (2026-08-08) |
|---|---|
| Canon F0 — `DESIGN.md §32` al día | ✅ la tabla del canon vive en `DESIGN.md:4831`, con la corrección de gaps táctiles y safe-areas |
| Canon F1 — `gate:movil` | ✅ `scripts/mobile-gate.mjs`, en pre-commit acotado a `src/(views\|components)/` |
| Canon F3 — checklist | ✅ `docs/CHECKLIST-VISTA-NUEVA.md` |
| Mobile F1, F2, F3, F5 | ✅ confirmadas |

Los dos gates, en verde ahora mismo:

```
gate:design   0 hallazgos · baseline VACÍO (cualquier cosa nueva falla)
gate:movil    buscador-a-mano 0 · modal-sin-cuerpo-canonico 0 ·
              movil-false-sin-motivo 0 · tabla-a-mano 26/26 bajo baseline
              (4 excepciones con motivo escrito)
```

Y el último barrido guardado (`test-results/barrido-total/informe.json`,
7-ago 22:13 — **37 rutas, WebKit iPhone 13, tema por defecto**):

```
desbordan 0 · chicos 0 · zoomIOS 0 · desbordePagina 0 · encadenan 0
ninguna vista reventó · ninguna vacía · 591 fichas
sinAcuse 77 · imposibles 14 · tablas 1 (schedules, excepción declarada)
```

**Los seis pendientes, y nada más que esos seis.** Cada uno es una fase de acá
abajo:

1. El medidor cuenta **37 falsos positivos** de los 77 `sinAcuse`.
2. Nunca se midió **ningún tema que no sea el de por defecto** — de cuatro.
3. `facturacion#observaciones`: **13 elementos recortados**, hallado en v2.513.0
   y sin corregir.
4. **40 controles sin acuse del toque** reales, en nueve formas.
5. **iPad Mini**: `TabBarAction sm` (36px) y el disparador de `PeriodPicker`
   (34px) se dibujan a 768px con puntero grueso.
6. Ni `gate:movil` ni `gate:design` ni el barrido corren en **CI**; y nada se
   verificó nunca en un **dispositivo real**.

---

## F1 · El instrumento primero — 37 de los 77 no existen

**Bloquea a F2, F3 y F4**, porque son las que se miden con él.

`medicion-movil.js:17` decide visibilidad recorriendo ancestros y mirando
`display:none` / `visibility:hidden` / `opacity:0`. El sidebar en el teléfono
**no se esconde con ninguna de las tres**: se esconde con
`transform: translateX(-100%)`. Así que su botón de colapsar
(`button.relative.w-11.h-11`) entra como visible en **las 37 rutas**, una vez por
vista, y es exactamente la mitad del número que hoy se lee como deuda.

Anotado en el changelog de v2.517.0 como «deuda del medidor tanto como del
botón». Es del medidor.

**La corrección precisa, y por qué no es «está fuera del viewport»:** un control
por debajo del pliegue está fuera del viewport y **sí** se alcanza con scroll —
descartarlo haría subcontar. El sidebar está fuera **horizontalmente**, y el
barrido mide `desbordePagina = 0` en las 37, o sea que no hay scroll lateral con
que alcanzarlo. La regla es esa y sólo esa:

```js
// Un control desplazado FUERA de lado es inalcanzable: no hay scroll horizontal
// (desbordePagina = 0 en las 37 rutas). Fuera por ARRIBA o por ABAJO no —
// eso se alcanza scrolleando, y descartarlo haría subcontar.
const alcanzable = (el) => { const r = el.getBoundingClientRect();
    return r.right > 0 && r.left < window.innerWidth; };
```

Se aplica a `sinAcuse` y a `chicos`. **NO** a `desbordan`, que mide justamente lo
que se sale.

**Aceptación:** el helper se verifica **en rojo** antes de darlo por bueno — se
le mete un control desplazado a propósito y el medidor tiene que seguir viéndolo
si el desplazamiento es vertical, y dejar de verlo si es horizontal. Un
instrumento que no puede fallar no prueba nada (regla heredada; el 2026-08-07 una
prueba pasó dos veces con cero intercepciones porque el service worker se comía
la petición). Después: `sinAcuse` baja de 77 a **40** sin tocar una sola vista, y
ese 40 es el número contra el que trabaja F4.

---

## F2 · La corrida de referencia — pestañas, modales y los cuatro temas

Es lo único del alcance que **nunca se midió**, y por eso es la fase que puede
cambiar el tamaño de todo el plan. Va temprano a propósito: comprometerse a
cerrar «lo visual» sin saber qué hay en tema oscuro es comprometerse a ciegas.

El código ya está y ya corrió: `PESTANAS=1` recorre las pestañas internas leyendo
`data-pestanas` (v2.513.0), `MODALES=1` abre dos diálogos por vista (v2.513.0), y
`TEMA=dark|solid|solid-dark|liquid` se estampa en `localStorage` antes de cargar.
Lo que no existe es **una corrida guardada que use las tres cosas**: el informe en
disco tiene 37 entradas de ruta pura, ni una clave `ruta#pestaña`.

**Hay que correrlo en dos mitades** — no es una preferencia: seis corridas
seguidas murieron cerca de la pantalla 28 con «Target page, context or browser has
been closed», y es el proceso de contenido de WebKit acumulando 37 vistas con sus
pestañas y sus diálogos (v2.514.2). Los dos comandos están escritos en el
encabezado del propio spec.

Ocho corridas: **2 mitades × 4 temas**. Y el informe se escribe después de cada
pantalla, así que una muerte a mitad de camino no pierde lo medido.

⚠️ **El ingreso se bloquea si se abusa.** El 2026-08-07 la fase quedó sin correr
porque Supabase cortó por límite de intentos tras muchas corridas en el día. Hay
que espaciar las ocho, no encadenarlas.

**Aceptación:** ocho informes guardados con nombre propio
(`informe-<mitad>-<tema>.json`), y una tabla que distinga **ruta · pestaña ·
modal · tema** — no un promedio. Cada informe lleva su **prueba de vida**: cuántas
pantallas recorrió. Cero hallazgos y cero datos se ven igual.

**Salida de la fase:** la lista real de trabajo de F3. Si el tema oscuro sale
limpio, F3 es sólo el hallazgo conocido; si no, se dimensiona acá y no después.

---

## F3 · Los recortes — el conocido, más lo que traiga F2

**El conocido, sin corregir desde el 2026-08-07:** `facturacion#observaciones`
tiene **13 elementos recortados** (`FacturacionView.jsx:2647`, pestaña
`observaciones`). Fue el primer hallazgo real que encontró el recorrido de
pestañas, y el changelog de v2.513.0 lo dice textual: *«no se habría visto nunca
sin esta fase»*. No aparece corregido en ningún changelog posterior.

Se le suma lo que F2 levante en las otras pestañas, en los modales y en los tres
temas no medidos.

**Aceptación:** `desbordan`, `chicos`, `zoomIOS` y `desbordePagina` en **0** en las
ocho corridas de F2, repetidas al terminar. Y —lección del tablero, que medía cero
y era la peor pantalla del portal— **se abren las capturas**: los números en cero
no dicen que se lea bien.

---

## F4 · El acuse del toque — 40 reales, en nueve formas

En un teléfono `hover:` no existe. Sin un `active:` propio, lo único que confirma
el toque es el destello gris del navegador, ajeno al material del portal — y el
portal lo apaga donde hay acuse propio. Un control sin acuse y sin destello queda
**mudo**.

Los 40 que quedan tras F1, agrupados por forma. La agrupación es el dato que
decide el trabajo: **nueve arreglos, no cuarenta**.

| n | Forma | Dónde |
|---|---|---|
| 14 | columnas de los dos gráficos (`div.flex-1.flex.flex-col`) | overview 7 + schedules 7 |
| 6 | selector de sucursal (`button.relative.flex.flex-col`, «La Popular») | pedidos |
| 6 | tarjeta de resumen (`button.text-left.p-5.rounded-modal`) | `AttendanceMonitorView.jsx:601` |
| 4 | baldosa del tablero (`button.group.w-full.h-full`) | overview |
| 4 | enlaces `a.blanco-tactil` (`text-success` / `text-brand-text`) | staff 2 + dashboard 2 |
| 3 | encabezado de sección colapsable | `TabLaboratorios.jsx:34` |
| 1 | `StatCard` clicable («Pts. Canjeados») | `VentasView.jsx:643` |
| 1 | uno-de-N del período («Esta semana») | overview |
| 1 | disparador de `PeriodPicker` («Seleccionar período») | `PeriodPicker.jsx:479` |

Dos notas que evitan trabajo equivocado:

- **Las 14 columnas también son las 14 `imposibles`** — los dos números son el
  mismo conjunto. Que no puedan medir 44pt (aritmética: `(ancho − huecos) /
  columnas < 44`) **no las exime del acuse**: se tocan igual, y son el control
  que más se toca de esas dos vistas.
- **El arreglo va en el canónico, nunca por vista.** Es la lección de v2.517.0:
  457 de 634 eran `ListRow`, y un solo cambio se llevó 361 de Laboratorios. Las
  seis primeras filas de la tabla son componentes compartidos; tocarlos en la
  vista sería multiplicar el mismo parche.
- Y el criterio de `ListRow` se hereda: **el acuse se declara sólo cuando la fila
  es interactiva**. Sin `onClick` ni `href` es una fila de lectura, y encogerla al
  tocarla prometería algo que no pasa.

**Aceptación:** `sinAcuse` en **0** en las 37 rutas, con el medidor ya corregido
por F1. Si algún control queda a propósito sin acuse, va con su motivo escrito en
el código — no en una lista aparte.

---

## F5 · iPad Mini — una decisión de diseño, no un `min-h`

Es el **único criterio de aceptación de `PLAN-MOBILE` que sigue en ⚠️**, y el
propio plan dice *«es el próximo trabajo, y empieza por ahí»*.

**El hecho medido:** a 768px con puntero grueso, `TabBarAction size="sm"` (36px,
`TabBarAction.jsx:51`) y el disparador de `PeriodPicker` (34px,
`PeriodPicker.jsx:479`) **sí se dibujan**. El comentario del código afirma lo
contrario —*«no baja del mínimo táctil porque en táctil esta píldora NO se dibuja:
ahí `FilterBar` es la barra flotante»*— y es una premisa escrita que la medición
desmiente. El corte de `useLayoutCompacto` es
`(max-width: 719px), (hover: none) and (max-height: 500px)`: el iPad Mini (744px
de alto acostado) cae del lado de escritorio **a propósito y con motivo escrito**,
porque ahí sobra sitio para la barra de filtros completa.

O sea: el corte no está mal. Lo que falta es que **«hay sitio» y «hay dedo» son
dos preguntas distintas**, y el tamaño del blanco táctil responde a la segunda.

**Tres salidas, y la recomendada:**

| | Qué hace | Costo |
|---|---|---|
| **A · `.blanco-tactil`** ✅ **recomendada** | separa el área de impacto del tamaño pintado | ninguno visual. Hay que **medir antes** el hueco entre botones adyacentes de la píldora: si no alcanza, se solapan |
| B · `min-h-[var(--tap-min)]` en `sm` | crece de verdad con puntero grueso | estira la píldora de §17 de 52px a **60** en tablets |
| C · reformular §17 | «52 con mouse, 60 con dedo» | toca el contrato de §17, que hoy dice «son 52px tenga una ranura o cinco» |

**A** es la que este proyecto ya validó tres veces y la que no toca §17: cerró las
50 cajas de MIN·MAX (36×23, dos por fila), el interruptor `sm` (32×16) y el aspa y
el chevron internos de `LiquidSelect` — justo los casos que `DESIGN.md §32` daba
por imposibles con el argumento de que agrandar la caja invisible arriesga
solaparse con el vecino. **La medición del hueco decide**: si no alcanza, la
decisión sube al usuario con B y C sobre la mesa, porque ahí ya es cambiar cómo se
ve la píldora en tablet.

**Aceptación:** la celda `iPad Mini · ventas` de `tests/e2e/matriz.spec.js` en
`0/0/0/0`, y las otras cuatro columnas sin moverse. Y el comentario de
`TabBarAction.jsx:46` reescrito: hoy enseña una premisa falsa a quien lo lea.

---

## F6 · El dispositivo real — lo único que ningún emulador puede

Dos cosas, y las dos están marcadas como no verificadas desde julio:

1. **Las áreas seguras.** `env(safe-area-inset-*)` vale **0 en todo emulador**, así
   que `px-4` y `pl-[max(1rem,env(…-left))]` se ven idénticos y la única forma de
   distinguirlos es leer el fuente. La auditoría los **pisa** con los de un iPhone
   13 acostado (47/47/34/47) para medir si el chrome se corre, que es lo más que
   se puede hacer sin un teléfono. Falta el teléfono.
   Y queda un punto expresamente sin verificar: las tabs inferiores
   (`[data-shell="tabs-movil"]`) sólo se pintan con `hasSelfOnly`, y **la cuenta de
   QA ve el menú completo** — nunca se dibujaron en una medición.
2. **El reporte original del usuario.** `PLAN-MOBILE` nació de «en el teléfono no
   hay scroll y el menú no aparece», y su criterio 1 sigue diciendo *«falta el
   dispositivo real»*. También el modo «agregado a inicio» (PWA standalone), donde
   ya hubo una regresión que Playwright no podía ver: v2.30.0 rompió el ☰ y sólo
   se detectó por capturas del usuario.

**Aceptación:** un recorrido en el iPhone del usuario —vertical, acostado y en
standalone— sobre las cinco vistas que más usa, con capturas. Es la fase que **no
puede cerrar esta sesión sola**.

---

## F7 · CI — que esto no se pueda deshacer sin avisar

`.github/workflows/ci.yml` corre hoy lint + vitest + smoke de Chromium. No corre
`gate:movil`, ni `gate:design`, ni el barrido. `gate:movil` está en el pre-commit
local, y `git commit --no-verify` lo saltea.

1. **`gate:movil` y `gate:design` al job `lint-and-unit`.** Son locales, sin red,
   ~1s cada uno. Bloqueantes: los dos baselines están hoy en su piso, así que
   cualquier hallazgo nuevo es código nuevo.
2. **El barrido, no en cada push.** Son ~16 minutos en dos mitades y necesita la
   app levantada con sesión. Va en un job aparte, nocturno o a pedido, con el
   informe como artefacto.

**Aceptación:** un PR con una violación a propósito —una `<table>` a mano en una
vista— tiene que **poner el CI en rojo**. Igual que en F1: el gate se verifica
fallando, no pasando.

---

## Orden, y por qué es ése

```
F1 (instrumento)  →  F2 (la corrida completa)  →  F3 (recortes)
                                    ↓
                              F4 (acuse)  ·  F5 (iPad)  ·  F7 (CI)   ← en paralelo
                                    ↓
                              F6 (dispositivo real)   ← cierra el plan
```

F1 va primero porque **todo lo demás se mide con él**, y hoy miente en la mitad de
un número. F2 va segundo porque es lo único que puede cambiar el tamaño del plan:
tres temas sin medir. F6 va al final porque necesita al usuario y su teléfono, y
porque no tiene sentido pedírselo antes de que lo demás esté puesto.

F4, F5 y F7 no dependen entre sí.

---

## Reglas que este plan hereda y no negocia

- **Un instrumento que no puede fallar no prueba nada.** Todo detector nuevo o
  corregido se verifica **en rojo** antes de darlo por bueno (F1 y F7 lo tienen
  como criterio explícito).
- **Cero hallazgos y cero datos se ven igual.** Todo informe lleva prueba de vida.
- **El baseline no se regenera para tapar un hallazgo nuevo** — ni el de
  `gate:design` ni el de `gate:movil`.
- **La captura verifica el bundle, no el código**: entre editar y fotografiar va
  el build, y entre el gate y la foto también.
- **La pantalla habla del portal**, nunca del sistema de origen — también en los
  textos que agregue una variante móvil.
- **El arreglo va en el canónico.** Si un hallazgo se repite en N vistas, el
  arreglo es uno y viaja solo; N parches son N lugares donde volver a romperlo.
- Bump de `APP_VERSION` con `npm run version:bump` y entrada en `CHANGELOG.md` en
  cada commit; paths explícitos, nunca `git add -A` — hay otras sesiones sobre
  este árbol.

---

## Lo que este plan NO cubre

- **Tablet en general y horizontal**: F5 cierra los dos controles medidos del iPad
  Mini, no una revisión de tablet. El canon de `§32` habla del teléfono.
- **El shell nativo de Capacitor** más allá de las safe-areas de F6.
- **La deuda de lint** (~186 problemas preexistentes, `continue-on-error` en CI):
  es otra deuda, documentada aparte, y F7 no la toca.
- **Los `imposibles`**: las 14 columnas de gráfico no se agrandan. Son una
  restricción medida, no deuda — F4 les da acuse, no tamaño.
