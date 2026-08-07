# Checklist — vista o módulo nuevo en el teléfono

Fase 3 de `PLAN-CANON-MOVIL-2026-08-07.md`. Se abre **antes** de escribir la
vista, no después.

**El criterio de que esto sirve es uno solo:** que el barrido encuentre la vista
nueva en cero **la primera vez**. Si hay que corregirla después, el checklist
falló — y entonces lo que hay que arreglar es el checklist, no sólo la vista.

Cada pregunta tiene respuesta verificable. Ninguna dice «que se vea bien».

---

## 1 · Los elementos — ¿usaste la variante, o la escribiste?

La tabla completa está en `DESIGN.md §32`. Las cinco que más se olvidan:

- [ ] **¿Hay una lista de registros?** → `DataTable` + `DataRow`/`DataCell`. **No
      se escribe una lista aparte para el teléfono**: cae solo a fichas bajo
      `lg:`. Si la fila NO es un registro (un calendario, una matriz de precios),
      `movil={false}` **con el motivo escrito arriba** — el gate lo exige.
- [ ] **¿La fila abre un detalle?** → `ExpedienteMovil`. `auto` (hoja que crece)
      si el detalle es una lista de líneas; `pantalla` si son secciones e
      historiales. Adentro del panel, **cero tablas** en los dos casos.
- [ ] **¿Hay un modal?** → `LiquidModal` (composición) o `HojaMovil` (cuerpo
      cerrado). Nunca `ModalShell` crudo: entra bien y adentro queda una pantalla
      de escritorio encogida.
- [ ] **¿Hay buscador?** → `ViewTabBar` o `SearchInput`. Nunca una píldora+input
      propia: cada copia se lleva los bugs que el canónico ya arregló.
- [ ] **¿Hay acciones de vista o filtros?** → `BarraFlotante` / `FilterBar`, que
      publica sus ranuras ahí.

Y las dos reglas que no son componentes:

- [ ] Ningún `<input>`/`<textarea>` de texto por debajo de **16px** (zoom de iOS).
- [ ] Ningún blanco táctil por debajo de **44pt**. Si el tamaño **es** el diseño
      —un aspa dentro de un campo, una caja de 36×23 entre dos vecinas—, la
      salida es `.blanco-tactil`: crece el área de impacto, no la pintura.

## 2 · Los permisos — si la vista trae widgets de tablero

- [ ] ¿El widget está en `WIDGET_DEFS` **y** en el reparto de
      `src/constants/dashboardTabs.js`? Lo segundo se olvida y el gate de
      permisos lo levanta.
- [ ] ¿La clave `dash_*` está en `permissionModules.js`? Sin eso no se puede
      repartir a ningún cargo.

## 3 · Correr los gates — antes de commitear

```
npm run gate:movil      # que no hayas escrito a mano lo canónico
npm run gate:design     # colores crudos, elementos nativos, inputs chicos
npm run gate:permisos   # solo si la vista tiene módulo o widget
```

## 4 · Mirarla en el teléfono — el único paso que no se puede saltar

```
RUTAS=mi-ruta PANTALLAS=4 E2E_BASE_URL=http://localhost:4174 \
  npx playwright test --project=webkit-movil -g "foco"
```

- [ ] `desbordan`, `chicos` y `zoomIOS` en **0**.
- [ ] Si la vista tiene pestañas, mirarlas **todas** — el barrido las recorre
      solo desde que `ViewTabBar` estampa `data-pestanas`.
- [ ] **Abrir las capturas.** Los números en cero no dicen que se lea bien: el
      tablero medía cero y era la peor pantalla del portal, con los títulos
      cortados y los widgets a 180px.

## 5 · Lo que el checklist NO cubre

Dicho para que nadie lo lea como una garantía:

- El **acuse del toque** (`hover:` sin `active:`) no está gateado; lo cuenta el
  barrido en `sinAcuse` y hoy hay cientos.
- El **tema oscuro** sólo se mide pasando `TEMA=dark` al barrido.
- Las **áreas seguras** (notch) no se pueden verificar en emulador:
  `env(safe-area-inset-*)` vale 0 en todos. Necesita un teléfono real.
