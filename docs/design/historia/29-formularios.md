# Formularios y validación — historia

> Historia de DESIGN.md §29. Copia fiel del texto que vivía en DESIGN.md hasta el 2026-11-06, cuando el documento se condensó: allá quedaron la regla, el canónico, un ejemplo corto y el gate; acá, las mediciones y los incidentes que explican por qué. Las citas a líneas de código y los números de sección son los de ESA época (la Voz era §26, hoy §34).

## 29. Forms & Validation

### 29.1 Inputs — `PortalInput`

> Reescrito el 2026-07-27 (D4). La versión anterior documentaba **dos estilos de
> input que compiten** (glass y solid) con hex crudos, `text-[13px]` y su propio
> aro de foco. Los dos estaban a mano, y el aro propio era una de las 171
> reescrituras del foco que se borraron ese día.

```jsx
import PortalInput from '@/components/common/PortalInput';

<PortalInput
    name="dui" label="DUI" icon={CreditCard}
    value={form.dui} onChange={handle}
    required maskType="dui"
/>
```

Trae etiqueta en mayúsculas, badge de **Requerido**, borde de error, máscara e
íconos. Todo formulario nuevo lo reusa.

**El aro de foco NO se escribe.** Existe una sola regla en `index.css` sobre
`button/input/select/textarea/a/[role=button]/[tabindex]:focus-visible`. Cuando
se midió, había 171 aros a mano en 47 archivos, cada uno de otro color — y el
canónico estaba en `rgba(0,82,204,.55)` sin variante por tema, que da **1.63:1
sobre el navy oscuro** contra el 3:1 que pide WCAG 1.4.11. Escribir el propio
tapaba el problema en vez de arreglarlo.

```jsx
// ❌ reinventa el aro, y además lo apaga
className="… outline-none focus:ring-4 focus:ring-brand/10"

// ✅ no se escribe nada: el canónico lo pinta
```

`focus:outline-none` está **prohibido**: apaga el aro canónico y deja el campo
sin foco visible (WCAG 2.4.7).


### 29.2 `PortalTextarea` — campo de varias líneas

```jsx
<PortalTextarea label="Motivo" name="motivo" rows={3} required
    value={motivo} onChange={e => setMotivo(e.target.value)}
    placeholder="Describe la solicitud…" />
```

Era **el último control de formulario sin canónico** (2026-07-27). `<select>` ya
iba a `LiquidSelect`, la casilla a `Checkbox`, el archivo a `FileField`, la fecha
a `LiquidDatePicker` — y quedaban **37 `<textarea>` nativos** que nadie había
mirado, con cuatro radios (`rounded-xl` 4 · `lg` 4 · `2xl` 3 · `3xl` 1).

El efecto se veía en pantalla: en el mismo formulario, el campo de una línea y el
de varias no compartían ni borde ni radio, porque uno pasaba por `PortalInput` y
el otro no pasaba por nada.

Comparte con `PortalInput` la etiqueta, el badge "Requerido", el borde rojo de
error, el glow de marca y `data-surface="input"` — no está reimplementado, es la
misma superficie. Lo único distinto es que crece en alto.

- **`rows`, no una altura en píxeles.** El alto de un campo de texto se mide en
  líneas, que es lo que el usuario ve; un `h-24` deja de calzar apenas cambia el
  tamaño de fuente del tema.
- **`resize-none` a propósito.** El tirador de la esquina es el mismo elemento
  nativo que ya sacamos de todos los demás controles: no sigue el tema y al
  arrastrarlo se sale de la caja del formulario.
- **La etiqueta es opcional.** Muchos de los 37 ya tenían su `<label>` afuera;
  obligar a moverla habría encimado dos cambios en la misma pasada.

`<textarea>` nativo es ahora **bloqueante en el gate** (categoría `native`, cero
absoluto), igual que `<select>` y `window.confirm`.

### 29.2 Casillas y opciones

`<input type="checkbox">` **nunca** — usar `Checkbox` (§15.4). La casilla nativa
se pinta con el color del sistema operativo e ignora los cuatro temas.

Para elegir una de pocas opciones, `SegmentedControl` (§15.3); para muchas o
cuando vienen de datos, `LiquidSelect`.

### 29.3 Estado deshabilitado

Sale del componente (`disabled` en `Button`, `PortalInput`, `Checkbox`). No se
escriben clases `disabled:` a mano.

### Validation error standard — REVISADO 2026-07-25

Esta sección describía "3 patrones que compiten por el mismo problema" y
recomendaba deprecar el badge. Al re-auditar (con mockup mostrado al
usuario, decisión tomada 2026-07-25) resultó que eran **2 problemas
distintos mal etiquetados como uno solo**:

- El **indicador de campo requerido** (badge) y el **error de envío/
  servidor** (banner) no compiten entre sí — nunca fueron la misma cosa.
- El badge de campo requerido no estaba "deprecado" en la práctica: es el
  estándar real, vive en el componente compartido `PortalInput.jsx` y se
  usa en 26+ campos (`EmployeeFormModal`, `PracticanteModal`) más 4
  archivos que lo replican a mano (`BranchTabInmueble`,
  `BranchTabGeneral`, `FormRehireEmployee`, `NuevoConteoModal`). Ya trae
  `aria-invalid`/`aria-describedby` bien resueltos. **Decisión: se queda,
  ya no es "deprecado".**
- Lo único real que sí era inconsistente: el error de *envío* se veía
  como banner con caja+ícono en 8 archivos y como texto plano sin caja en
  2 (`FormSetPassword.jsx`, `LoginView.jsx`) — corregido, ambos ahora
  usan el mismo tratamiento.

**(a) Indicador de campo requerido — el badge, componente `PortalInput`:**
```jsx
<span className="text-danger font-bold bg-danger/10 px-2 py-0.5 rounded-md border border-danger/30 shadow-sm">
  Requerido
</span>
```
Solo se muestra cuando el campo es requerido y está vacío (`isMissing && !hasError`). Con `aria-invalid="true"` + `aria-describedby` apuntando al `id` del badge/mensaje.

**(b) Inline field error** — appears below the field, shown when a field-level rule fails:
```jsx
<p className="text-label font-black text-danger mt-1">
  {fieldError}
</p>
```
Must be paired with `aria-invalid="true"` on the input and `aria-describedby` pointing to the error element's `id`.

**(c) Global / submit banner** — appears above the submit button, shown for server errors or cross-field validation failures. Mensajes cortos tipo label → `uppercase tracking-widest`; oraciones completas (ej. "Las contraseñas no coinciden.") → case normal, sin uppercase:
```jsx
// Referencia: src/components/forms/FormRegisterPayment.jsx:185,
// src/components/forms/FormSetPassword.jsx, src/views/LoginView.jsx
{/* Sin `backdrop-filter`: un aviso es TINTA, no material — PLAN-MATERIALES
    §18.2. Este ejemplo lo llevaba y los dos archivos que cita también, hasta
    que la bajada de §20 se los quitó (v2.433.0). */}
<div className="flex items-center gap-3 text-danger-text
  bg-danger/10 px-4 py-3 rounded-2xl
  border border-danger/30 shadow-[var(--shadow-glow-danger)]
  animate-in fade-in slide-in-from-top-2">
  <AlertCircle size={18} className="shrink-0 text-danger" strokeWidth={2.5} />
  <span className="text-body-sm font-bold leading-relaxed">{globalError}</span>
</div>
```

---
