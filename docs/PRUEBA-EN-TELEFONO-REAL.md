# Prueba en el teléfono real — el guion

F6 de `docs/planes-cerrados/PLAN-CIERRE-MOVIL-2026-08-08.md`. **Es la única fase que no puede
cerrar una sesión de Claude Code sola**: necesita un iPhone de verdad, y el
motivo no es pereza del instrumento.

## Por qué ningún emulador sirve para esto

`env(safe-area-inset-*)` vale **0 en todos**. En Playwright, en Chrome DevTools y
en cualquier captura de emulador, `px-4` y `pl-[max(1rem,env(…-left))]` se ven
**idénticos**: la única forma de saber cuál está escrito es leer el fuente. La
auditoría los *pisa* con los de un iPhone 13 acostado (47/47/34/47) para medir si
el chrome se corre, y eso es lo máximo que se puede hacer sin un teléfono — pero
pisar un valor no es lo mismo que tener un notch.

Y hay un precedente que lo demuestra: **v2.30.0 rompió el ☰ en modo «agregado a
inicio»** y Playwright no lo vio nunca, porque no emula `display-mode:
standalone`. Se detectó por capturas que mandó el usuario.

## Lo que ya está medido, para no repetirlo

Barrido del 2026-08-08, WebKit iPhone 13, **37 rutas × 4 temas**:

```
desbordan 0 · chicos 0 · zoomIOS 0 · desbordePagina 0 · encadenan 0
ninguna vista reventó · ninguna vacía
```

O sea que **no hace falta buscar recortes ni scroll lateral**: eso está cubierto
y sale en cero en los cuatro temas. Lo que el teléfono aporta es exactamente lo
que la máquina no puede ver.

---

## El recorrido — tres modos, cinco vistas

Abrir el portal en el iPhone y mirar, **en este orden**:

### 1 · Safari, vertical

- [ ] **El ☰ y el borde de arriba.** ¿El encabezado se mete debajo de la barra de
      estado o de la isla dinámica? Debe quedar por debajo, no tapado.
- [ ] **El pie.** ¿Las tabs de abajo quedan pisadas por la barra de gestos del
      teléfono?
- [ ] Scrollear una vista larga (Ventas o Productos) **hasta el final**: ¿el
      último renglón se alcanza, o queda debajo de la barra de gestos?

### 2 · Safari, **acostado** — el que más rompe

Acostado, el inset lateral vale **47px** y hasta v2.450.0 el shell lo ignoraba
por completo: el ☰ vivía a 16px del borde, o sea debajo del notch.

- [ ] Girar el teléfono **con una vista ya abierta** (no recargar): ¿el contenido
      se corre y queda algo debajo del notch, a izquierda o derecha?
- [ ] Abrir un modal acostado: entra **de costado**, no desde abajo — acostado el
      alto es el recurso escaso.

### 3 · «Agregado a inicio» (PWA standalone) — el que Playwright no puede ver

Compartir → Añadir a pantalla de inicio, y abrir **desde el ícono**, no desde
Safari.

- [ ] **¿Se ve el ☰?** Ésta es la regresión exacta de v2.30.0: `100dvh` se
      calcula distinto en standalone que en una pestaña de Safari.
- [ ] ¿Queda un hueco muerto abajo?
- [ ] Scrollear: ¿el scroll llega hasta el final del contenido?

### Las cinco vistas

Las que más se usan, en los tres modos de arriba:
**Inicio · Ventas · Pedidos · Personal · Solicitudes**

### Un punto que NUNCA se midió

Las tabs inferiores (`[data-shell="tabs-movil"]`) **sólo se pintan con
`hasSelfOnly`** — o sea, para quien tiene acceso a un único módulo. La cuenta de
QA ve el menú completo, así que en ninguna medición se dibujaron. Si hay un
empleado con un solo módulo, mirar el portal con **su** cuenta es lo único que
prueba esa pieza.

---

## Cómo reportar lo que salga

**Capturas, no descripciones.** Una captura del teléfono es el instrumento aquí:
dice el tamaño real, el inset real y el modo real. Con el nombre de la vista y si
era vertical / acostado / standalone.

Si algo aparece, va a `docs/planes-cerrados/PLAN-CIERRE-MOVIL-2026-08-08.md` como fase nueva —
no se arregla a ojo desde una captura sin antes reproducirlo.

---

## El trabón al girar el teléfono (F9) — EN PAUSA

**Estado:** EN PAUSA por decisión del usuario · **Pausado el** 2026-08-08 ·
**Última versión tocada:** v2.527.1 · **Plan padre:** `PLAN-CIERRE-MOVIL-2026-08-08.md`, F9

> «siento que estamos en un círculo vicioso, si no encuentras causa, demos una
> pausa y sigamos con algo más pendiente.»

Es una pausa correcta. **No se encontró la causa.** Lo que sí hay es un embudo
cerrado: cuatro explicaciones descartadas *con medición en el teléfono del
usuario*, un instrumento que ya funciona, y un siguiente paso concreto que no
requiere volver a empezar.

---

### 1. El síntoma, en palabras del usuario

> «al girar, media pantalla se adapta bien, rápido y todo, pero cuando pasa a
> ocupar toda la pantalla es que se traba y se ve raro, son segundos en ese
> tramo, por lo que se ve mal.»

**Ojo con la primera versión del síntoma.** Durante días se persiguió otra: «el
contenido queda pintado al ancho anterior y sólo vuelve al recargar o abrir otra
vista». Esa lectura era falsa y costó tres intentos. El ancho correcto **llega
solo**; el defecto es la *duración* del tramo.

### 2. El aparato

No es un iPhone cualquiera y ningún emulador lo estaba reproduciendo:

| | |
|---|---|
| Viewport | 352×715 vertical · 765×352 horizontal |
| Zoom de página | **1.25** (o sea un teléfono de 440×956 al 125%) |
| Modo | **agregado a inicio** (standalone) — iOS lo suspende, no lo recarga |
| Tema | cambia; se probó en `liquid` y en `solid`, **falla en los dos** |

### 3. Qué está descartado, y con qué número

| Descartado | Evidencia |
|---|---|
| **El teléfono / Safari** | `/raw-test?sinvidrio=1` (sin shell, sin vidrio) gira con un trabón de **17 ms**, el mismo minuto y el mismo modo |
| **Las capas de vidrio** | tres corridas lentas con `tema: solid`, donde los cuatro `--backdrop-*` valen `none`. Lo acotó el usuario: «con solid sí me pasa en compras» |
| **El reparto del DOM (layout)** | en la corrida lenta, leer `clientWidth` —que fuerza el recálculo pendiente— costó **3 ms** |
| **Código nuestro de más** | **3 re-renders** del shell en la corrida lenta: los mismos que traen las rápidas |
| **Safari tardando en entregar el viewport** | fue real (1,105–3,185 ms) hasta v2.526.7 y **desapareció** al quitar un re-render nuestro. Hoy entrega en **0–1 ms** |

### 4. Qué queda vivo

Un bloqueo del hilo principal de **~1.5 a 2.0 s** que llega **después** de que el
reparto ya terminó, y que no es layout ni código nuestro. Quedan tres:

1. **Presión de memoria / pausa del recolector.** Es la que más apoyo tiene por
   contexto: la sesión vive días en standalone, con zoom al 125%, y este mismo
   teléfono ya cerró la pestaña por techo de memoria en Reglas
   (`project_iphone_muerte_subita_reglas_2026_08_08`).
2. **Pintado / composición** de una pantalla grande al tamaño nuevo.
3. **Trabajo diferido de `content-visibility`** aterrizando después del giro.

### 5. El siguiente paso, en orden

**5.1 — La prueba de la memoria, que es gratis y puede cerrar todo.**
Recargar la app del todo (cerrarla de la lista de apps y volver a abrirla) y
girar **inmediatamente** 3-4 veces en `/compras`. Después usarla un rato largo y
repetir.

- Si en sesión fresca no hay trabón y aparece con el uso → es **acumulación de
  memoria**, y el trabajo es el mismo que cerró el incidente de Reglas: acotar
  listas, `content-visibility`, desmontar lo que no se ve.
- Si el trabón está desde el primer giro → memoria queda descartada y hay que ir
  al Inspector.

**5.2 — El Inspector Web de Safari, que es la respuesta definitiva.**
Mac + cable + `Ajustes › Safari › Avanzado › Inspector web`, y en el Mac
`Develop › [iPhone] › [la app]`. Grabar una **Timeline** durante el giro dice en
una sola pasada si esos 1.9 s son *Painting*, *GC* o *Rendering*. Todo lo que se
hizo desde el navegador es un sustituto de esto; con un cable se resuelve en
diez minutos.

**5.3 — Bisección por peso**, si no hay cable a mano. Girar en pantallas de
tamaño creciente (`/ios-test` ~1,400 nodos, `/compras` ~1,466, una lista larga) y
ver si el trabón escala con el número de elementos. Si escala, es pintado; si es
constante, es una pausa del sistema.

### 6. La herramienta que ya está construida

`iniciarSondaRotacion` en `src/utils/cajaNegra.js`, se lee en **`/ios-test`** →
tarjeta «Rotación — qué tarda al girar» → botón **«Copiar giros»**.

Mide y anota por giro: cuánto tardó Safari en entregar el ancho, cuánto tardó el
portal en acomodarse, el peor trabón **con su horario**, cuánto costó la lectura
del ancho, cuántas veces se re-renderizó el shell, el tema, el zoom, si corre en
standalone y si el remontaje estaba encendido.

**Tres trampas que ya se pagaron — no reintroducirlas:**

1. **La ventana no puede cerrarse cuando el trabajo esperado termina.** Cerraba
   600 ms después de que la vista se acomodaba (~800 ms en total) y el trabón
   llega más tarde: producía «3 de 4 giros bien» mientras el usuario decía
   «sigue igual». Hoy mira **siempre 5 s**.
2. **Leer anchos es lo caro** (`clientWidth` fuerza el recálculo). Por eso las
   lecturas se apagan al acomodarse y el resto de la ventana sólo cuenta cuadros.
3. **El rumbo del giro y el estado del interruptor se anotan del evento, no del
   final.** Leerlos al escribir dio corridas mal etiquetadas y tres mediciones
   que parecían línea base y no lo eran.

### 7. Lo que quedó en el código y por qué

- **El remontaje al girar está APAGADO** (`portal_remontar_al_girar`, interruptor
  en `/ios-test`). Se agregó en v2.526.0 contra el síntoma mal leído; no arregla
  nada y cobra el estado local de la vista —filtros, scroll, un formulario a
  medio llenar— en cada giro. **Se puede borrar** junto con `esVertical`,
  `remontarAlGirar`, `fijarRemontarAlGirar` y `tests/e2e/rotacion-movil.spec.js`
  el día que se decida que no hace falta como brazo de comparación.
- **La sonda no corre sola**: duerme hasta que el teléfono gira. Si el defecto se
  cierra, se borra `iniciarSondaRotacion`, su tarjeta y `leerRotaciones` /
  `limpiarRotaciones`.
- **`/raw-test?sinvidrio=1`** existe como control sin shell ni vidrio. Su barra
  lleva un `blur(44px)` que el parámetro apaga; sin eso no controlaba nada.

### 8. Ganancia real de esta ronda, aunque no se haya cerrado

- Girar ya no re-renderiza el shell (v2.526.7). Ninguno de los tres estados de
  tamaño cambia al rotar este teléfono, así que ese re-render lo había agregado
  v2.526.0 y no lo pedía nadie.
- Safari pasó de tardar **1.1–3.2 s** en entregar el viewport a **0–1 ms**.
- El remontaje dejó de tirar el estado de la vista en cada giro.
- Quedan cuatro explicaciones descartadas con número, no con opinión.
