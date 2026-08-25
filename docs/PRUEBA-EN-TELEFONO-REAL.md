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
