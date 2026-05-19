# Design System — Portal Farmalasa

## Visual Register

**product** — La UI sirve al flujo de trabajo; el diseño desaparece dentro de la tarea.

---

## Themes

El portal soporta dos temas seleccionables por el usuario, persistidos en `localStorage`.

### Tema 1: LiquidGlass (`data-theme="liquid"`, default)
Inspirado en visionOS / iOS 18. Profundidad real a través de capas, blur y refracción. Las superficies flotan sobre un fondo vivo de orbes degradados.

### Tema 2: Compat (`data-theme="compat"`)
Diseño corporativo sin transparencias. Para navegadores / computadoras que no soportan `backdrop-filter` o donde la fluidez importa más que la estética. Mismo lenguaje visual pero plano y predecible.

---

## Color Palette

### Marca
| Token | Valor | Uso |
|-------|-------|-----|
| `--brand` | `#007AFF` | Acciones primarias, selección activa, CTA |
| `--brand-dark` | `#005CE6` | Hover sobre brand |
| `--brand-purple` | `#5856D6` | Gradiente del logo / icono de app |

### Semánticos
| Token | Valor | Uso |
|-------|-------|-----|
| `--success` | `#34C759` | Confirmación, presente, activo |
| `--warning` | `#FF9500` | Alerta, pendiente, atención |
| `--danger` | `#FF3B30` | Error, ausente, crítico |
| `--info` | `#007AFF` | Mismo que brand |

### Superficies — LiquidGlass
| Token | Valor | Uso |
|-------|-------|-----|
| `--surface-card` | `rgba(255,255,255,0.55)` | Cards de contenido |
| `--surface-card-hover` | `rgba(255,255,255,0.70)` | Cards on hover |
| `--surface-header` | `rgba(255,255,255,0.85)` | Header flotante de vistas |
| `--surface-modal` | `rgba(255,255,255,0.88)` | Modales y drawers |
| `--surface-input` | `rgba(255,255,255,0.60)` | Inputs, selects |
| `--surface-sidebar` | Gradient `from-[#0A2A5E] to-[#041636]` | Barra lateral |
| `--surface-page` | `#F2F2F7` | Fondo de página |

### Superficies — Compat
| Token | Valor | Uso |
|-------|-------|-----|
| `--surface-card` | `#ffffff` | Cards planas |
| `--surface-header` | `#ffffff` | Header sólido con borde inferior |
| `--surface-modal` | `#ffffff` | Modal sólido |
| `--surface-input` | `#F8FAFC` | Input con borde slate |
| `--surface-page` | `#F1F5F9` | Fondo ligeramente más oscuro |

### Neutros
| Token | Valor | Uso |
|-------|-------|-----|
| `text-slate-900` | `#0F172A` | Títulos, valores numéricos |
| `text-slate-700` | `#334155` | Cuerpo de texto |
| `text-slate-500` | `#64748B` | Labels, metadata |
| `text-slate-400` | `#94A3B8` | Placeholders, iconos inactivos |

---

## Typography

**Fuente:** System font stack — `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

No se usa ninguna fuente externa de display. Inter es el fallback en plataformas sin system-ui.

### Escala de tamaños
| Token | Tamaño | Peso | Uso |
|-------|--------|------|-----|
| `text-[28px]` | 28px | 900 | Valor KPI principal |
| `text-[20px]` | 20px | 800 | Título de sección |
| `text-[16px]` | 16px | 700 | Título de card / widget |
| `text-[13px]` | 13px | 600 | Cuerpo principal |
| `text-[12px]` | 12px | 500 | Texto secundario |
| `text-[11px]` | 11px | 700 | Labels uppercase, badges |
| `text-[10px]` | 10px | 700 | Metadatos, timestamps |
| `text-[9px]`  |  9px | 700 | Tags compactos |

**Ratio de escala:** ~1.15 (tighter que brand, más opciones de densidad)

### Convenciones
- Labels en uppercase van con `tracking-widest` y `font-bold/black` mínimo
- Nunca `font-normal` en UI interactiva — mínimo `font-medium`
- Evitar `font-thin`/`font-light` en texto pequeño (legibilidad en pantallas de tienda)

---

## Spacing & Layout

### Grid
- **Desktop:** Sidebar fijo + área de contenido scroll
- **Tablet:** Sidebar colapsable, contenido fluido
- **Móvil:** Sidebar drawer over content

### Gaps habituales
| Contexto | Gap |
|----------|-----|
| Dentro de card | `gap-3` / `gap-4` |
| Entre cards en grid | `gap-4` |
| Padding de card | `p-4` / `p-5` |
| Padding de header flotante | `px-5 py-3` |

### Contenedor máximo
Views: sin `max-w` — crecen con el viewport. Las vistas densas (tablas) usan el ancho completo.

---

## Border Radius

| Token | LiquidGlass | Compat | Uso |
|-------|-------------|--------|-----|
| `--radius-xl` | `1.75rem` | `0.75rem` | Cards de contenido |
| `--radius-2xl` | `2rem` | `1rem` | Modales |
| `--radius-header` | `2.5rem` | `0` | Header flotante |
| `--radius-btn` | `9999px` | `0.5rem` | Botones principales |
| `--radius-badge` | `9999px` | `0.375rem` | Badges y pills |
| `--radius-input` | `0.75rem` | `0.5rem` | Inputs, selects |

---

## Motion System

### Principios
1. **El movimiento comunica estado, no decoración.** Si el efecto no aclara qué cambió, no existe.
2. **Timing:** 150ms para respuesta de click; 200-250ms para expansión/entrada; 300ms para transiciones de página.
3. **Ease estándar:** `cubic-bezier(0.23, 1, 0.32, 1)` — ease-out rápido, sensación de respuesta física.
4. **Sin bounce.** `cubic-bezier(0.34, 1.56, 0.64, 1)` solo para toggles físicos (switch thumb).
5. **Press state:** `active:scale-[0.97]` — sutil, nunca `scale-90`.
6. **Hover lift:** `-translate-y-0.5` + shadow upgrade. Solo en elementos clickeables.
7. **Entrance:** `animate-in fade-in slide-in-from-bottom-2` — 200-280ms.

### Tokens de animación
```css
--ease-spring:  cubic-bezier(0.23, 1, 0.32, 1);
--ease-out:     cubic-bezier(0.25, 0.46, 0.45, 0.94);
--dur-fast:     150ms;
--dur-base:     200ms;
--dur-slow:     300ms;
```

### Animaciones definidas (tailwind.config.js)
- `animate-kpi-enter` — 280ms, para KPI cards al montar
- `animate-widget-enter` — 250ms, para widgets
- `animate-widget-settle` — bounce sutil para drop de drag

### Patrones de interacción
```jsx
// Botón primario
"transition-[transform,box-shadow,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"

// Card clickeable  
"hover:-translate-y-0.5 hover:shadow-lg transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"

// Ítem de lista
"hover:translate-x-1 transition-[transform,background-color] duration-150"

// Sliding tab pill
"transition-[left,width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"

// Ícono en hover de card
"transition-[transform] duration-200 group-hover:scale-[1.08]"
```

### Compat — ajuste de motion
En `data-theme="compat"`, las animaciones de entrada se conservan pero se reducen:
- Hover lift: `hover:-translate-y-px` (solo 1px)
- No `hover:-translate-y-0.5` (4px)
- El timing es igual — la respuesta rápida es importante para todos los temas

---

## Shadows — LiquidGlass

```css
/* Card en reposo */
inset 0 1px 0 rgba(255,255,255,0.9), 0 8px 32px rgba(0,0,0,0.06)

/* Card en hover */
inset 0 1px 0 rgba(255,255,255,0.95), 0 16px 40px rgba(0,0,0,0.09)

/* Header flotante */
inset 0 1px 0 rgba(255,255,255,0.9), 0 4px 24px rgba(0,0,0,0.06)

/* Modal */
0 32px 80px rgba(0,0,0,0.18), inset 0 2px 0 rgba(255,255,255,0.95)

/* Botón brand */
0 4px 14px rgba(0,122,255,0.25)

/* Botón brand hover */
0 8px 20px rgba(0,122,255,0.35)
```

## Shadows — Compat

```css
/* Card */
0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)

/* Card hover */
0 4px 12px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)

/* Modal */
0 20px 50px rgba(0,0,0,0.15)
```

---

## Components

### Card de contenido (WidgetCard)
**LiquidGlass:**
```jsx
<div data-surface="card"
  className="bg-white/55 backdrop-blur-[18px] backdrop-saturate-[180%]
             border border-white/75 rounded-[1.75rem]
             shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_32px_rgba(0,0,0,0.06)]">
```

**Compat (via CSS override):**
```css
[data-theme="compat"] [data-surface="card"] {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  border-radius: 0.75rem;
  backdrop-filter: none;
}
```

### KPI Card
Icono + label arriba, valor numérico grande abajo. Sub-context en la esquina.
Nunca: número grande solo, label pequeño abajo (hero metric ban).

### Sliding Tab Indicator
Un pill CSS que se traslada entre tabs vía `left: calc(index * 100% / N)`.
Nunca: N botones con background propio que se togglean.

### Botón primario
```jsx
className="px-5 py-2.5 bg-[#007AFF] hover:bg-[#005CE6] text-white
           rounded-full font-black text-[11px] uppercase tracking-widest
           shadow-[0_4px_14px_rgba(0,122,255,0.25)]
           hover:shadow-[0_8px_20px_rgba(0,122,255,0.35)]
           hover:-translate-y-0.5
           transition-[transform,box-shadow,background-color] duration-150
           ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
```

### Botón secundario
```jsx
className="px-4 py-2 bg-white/70 backdrop-blur-sm border border-white/90
           text-slate-700 rounded-full font-bold text-[11px]
           hover:bg-white hover:shadow-sm
           transition-[background-color,box-shadow] duration-150 active:scale-[0.97]"
```

### Badge de estado
```jsx
// Activo / success
"px-2.5 py-0.5 bg-[#34C759]/10 text-[#1A7A35] border border-[#34C759]/25 rounded-full text-[10px] font-bold"
// Pendiente / warning
"px-2.5 py-0.5 bg-[#FF9500]/10 text-amber-700 border border-[#FF9500]/25 rounded-full text-[10px] font-bold"
// Error / danger
"px-2.5 py-0.5 bg-[#FF3B30]/10 text-red-700 border border-[#FF3B30]/25 rounded-full text-[10px] font-bold"
// Info / neutro
"px-2.5 py-0.5 bg-[#007AFF]/10 text-[#007AFF] border border-[#007AFF]/25 rounded-full text-[10px] font-bold"
```

### Input / Select
```jsx
className="w-full bg-white/60 backdrop-blur-sm border border-white/80
           rounded-[0.75rem] px-3 py-2.5 text-[13px] text-slate-700
           focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 focus:border-[#007AFF]/50
           shadow-[inset_0_2px_8px_rgba(0,0,0,0.04)]
           transition-[border-color,box-shadow] duration-150"
```

### Ícono badge en header de widget
```jsx
className="w-8 h-8 rounded-[0.875rem] bg-gradient-to-tr from-[#007AFF] to-[#5856D6]
           flex items-center justify-center shadow-[0_4px_12px_rgba(0,122,255,0.3)]"
```

---

## Loading States

- **Skeleton:** `animate-pulse bg-slate-100` para contenido que carga — nunca spinner en el centro de contenido
- **Inline spinner:** Solo en botones de acción (submit, fetch de un elemento)
- **Typing indicator:** 3 dots con `animate-bounce` y delays escalonados — único uso permitido de bounce

---

## Iconography

**Librería:** Lucide React, `strokeWidth={2}` por defecto, `strokeWidth={1.5}` en íconos grandes (>20px).

Tamaños en contexto:
- Nav sidebar: `size={20}`
- Header de widget: `size={16}`
- Botón: `size={14}`
- Badge/chip: `size={10}` – `size={12}`
- KPI: `size={14}` en badge de icono (w-7 h-7)

---

## Anti-patterns (NUNCA hacer)

- `transition-all` — usar propiedades específicas
- `active:scale-90` o `active:scale-95` — mínimo `active:scale-[0.97]`
- `border-l-4` como decoración de card — usar background highlight
- Gradiente como text (`bg-clip-text text-transparent`) en títulos de UI
- `animate-bounce` en elementos decorativos
- `cubic-bezier(0.34, 1.56, 0.64, 1)` (spring) en elementos de layout
- Paleta indigo/violet/purple fuera de contextos de IA intencionalmente marcados
- Hero metric: número grande + label pequeño sin contexto
- Cards idénticas en grid (mismo peso visual, sin jerarquía)
- Glassmorphism como decoración (solo como capa funcional)
- Fuentes externas de display en UI de producto

---

## Checklist para nueva vista

Al construir una nueva vista, verificar:
- [ ] Usa `GlassViewLayout` (o wrapper equivalente) con `data-surface="page-header"`
- [ ] Cards usan `data-surface="card"` para theming automático
- [ ] Tabs usan el patrón sliding pill (no toggle de background por botón)
- [ ] Loading state tiene skeleton, no spinner centrado
- [ ] Empty state tiene ilustración + acción + texto instructivo
- [ ] Error state tiene mensaje + retry
- [ ] Botones usan `active:scale-[0.97]` y `transition-[specific-props]`
- [ ] Tablas tienen hover de fila (solo `hover:bg-*` sin border-l)
- [ ] Fuentes: nunca `font-normal` en labels, mínimo `font-medium`
- [ ] Íconos de widget usan el badge azul-degradado estándar
- [ ] El tema Compat funciona (sin backdrop-blur, sin transparencias)
