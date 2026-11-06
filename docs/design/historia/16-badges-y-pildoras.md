# Historia — §16 Badges, contadores y las dos píldoras

> Narrativa original de DESIGN.md §16 (incluida la antigua «16.9»), movida aquí el 2026-11-06
> para que DESIGN.md lleve sólo la regla. Las cifras son de la fecha en que se midieron:
> hoy ninguna vista escribe la píldora del header a mano (las «12» de la tabla son historia).

### 16. Badges, avisos e indicadores

> Reescrita el 2026-07-27 (D4). La versión anterior enseñaba `bg-red-500`,
> `bg-emerald-500/10`, `#0052CC` y `text-[10px]` — colores de Tailwind y
> tamaños a mano que **ignoran los cuatro temas**. Era el ejemplo más directo de
> cómo el documento generaba deuda.

Al medirlos aparecieron **316 "chips"** escritos a mano, y no eran una sola cosa:

| | | |
|---|---|---|
| 249 | 78% | chip inline corto → `Badge` |
| 58 | 18% | aviso con ícono → `Notice` (§15.6) |
| 9 | 2% | contador pegado a un ícono → se queda inline, es geometría |

#### 16.1 `Badge` — etiqueta de estado

```jsx
import Badge from '@/components/common/Badge';

<Badge variant="success">Activo</Badge>
<Badge variant="danger" tone="solid">Vencido</Badge>
<Badge variant="warning" size="sm">Por vencer</Badge>
```

`variant` es semántico (`success` · `warning` · `danger` · `info` · `neutral` y
la paleta de gráficos), `tone` elige teñido o relleno. Los colores salen de los
tokens, así que responden a los cuatro temas.

**Nunca** `bg-red-500`, `bg-emerald-500/10` ni un hex. El color de un badge dice
*qué significa*, y eso vive en el token semántico.

#### 16.2 `Contador` — la burbuja con un número

> Reescrito el 2026-07-28 (D3.5). Antes decía *"el único caso que se escribe
> inline"* y mostraba el `<span>` a copiar. Se copió nueve veces, y **cuatro de
> ellas dentro de componentes canónicos** (`NotificationBell` ×2, `FilterBar`,
> el del menú lateral). Ahora tiene su propio canónico.

```jsx
// rojo y chico, los defaults
<Contador valor={sinLeer} aria-label={`${sinLeer} sin leer`} />

// "99+" al pasarse, en azul de marca
<Contador valor={n} max={99} tono="brand" aria-label={`${n} filtros aplicados`} />

// pegado a la esquina de un ícono: la POSICIÓN la pone el llamador
<Contador valor={n} className="absolute -top-1.5 -right-1.5 z-content"
          aria-label={`${n} sin leer`} />
```

Devuelve `null` cuando `valor <= 0` — no hace falta envolverlo en `{n > 0 && …}`.

**`aria-label` no es opcional.** Sin él, un lector anuncia "3" suelto y no se
sabe 3 de qué. El componente no lo puede adivinar: solo el llamador sabe si son
avisos, filtros o pedidos.

**Por qué no es un `Badge`:** un chip crece con su texto; un contador tiene que
ser **circular con un dígito y ovalado con dos**, o sea ancho mínimo fijo y alto
fijo. Metido en `Badge` habría dado burbujas de anchos distintos según el número.

El borde del componente va del color de la superficie (`border-surface-card`),
no blanco fijo: recorta el contador del fondo que tenga detrás, y en tema oscuro
un borde blanco dibujaría un halo.

#### 16.3 Punto de estado en vivo

```jsx
<span className="relative flex h-2 w-2">
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
  <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
</span>
```

`animate-ping` es decorativo: el tema sólido lo apaga solo, y también
`prefers-reduced-motion`.

**El punto necesita nombre (F3, 2026-07-29).** Un punto de color es información
—verde disponible, ámbar ausente— y un `<span>` sin `role` no lo anuncia: el
lector de pantalla lo salta completo. Va `role="img"` con el texto en `title` o
`aria-label`:

```jsx
<span role="img" title="Disponible"
      className="w-3.5 h-3.5 rounded-full bg-success …" />
```

Con `role="img"` el `title` **es** el nombre accesible, así que no hace falta
duplicarlo en `aria-label` y el hover del mouse sigue funcionando igual. Aplica a
todo indicador puramente gráfico: el punto de estado, el avatar en pila, el dot
por sucursal, la burbuja del cumpleaños. Ver §15.10, patrón (B).

---

### 16.9 Las dos píldoras de una vista — cuál es cuál (2026-07-27)

Una vista tiene **dos** contenedores en píldora, y confundirlos fue lo que me
hizo escribir mal §17. No son intercambiables:

| | píldora del **header** | píldora del **cuerpo** |
|---|---|---|
| canónico | **`ViewTabBar`** | **`FilterBar`** |
| qué lleva | pestañas de la vista + buscador global | los filtros que recortan los datos **+ las acciones** |
| dónde | fila del título, vía `filtersContent` | bajo el título, a la derecha |
| responde | *¿qué sección estoy viendo?* | *¿qué recorte, y qué hago con él?* |

**Las acciones son de la píldora del CUERPO (2026-07-30).** `ViewTabBar` tuvo una
prop `trailingActions` y se volvió un cajón de sastre: además de acciones de
verdad ("Nuevo Empleado", "Publicar", "Exportar") guardaba **filtros** —el rango
de fechas y el tipo de `TabHistory`, el `SegmentedControl` de
`EmployeeAnnouncementsView`, el selector "Copiar desde…" de `PermissionsView`—.
O sea que el header terminó filtrando, que es exactamente lo que §17 dice que no
hace. La prop se retiró: si algo recorta datos o actúa sobre ellos, va a
`FilterBar`. En el header solo queda navegar y buscar.

**La prop está mal nombrada.** `GlassViewLayout` la llama `filtersContent`, pero
**22 de las 34 vistas que la usan le pasan un `ViewTabBar`** — o sea pestañas,
no filtros. Ese nombre me hizo concluir que el header era el lugar de los
filtros, y estaba mal. Si algún día se renombra, `headerContent` sería honesto.

#### Estado medido de la píldora del header

| | vistas |
|---|---|
| usan `ViewTabBar` | 22 |
| **escriben la píldora a mano** | **12** |

Las 12 reconstruyen el contenedor —`rounded-header h-[4rem] md:h-[4.5rem]`,
`backdrop-blur-2xl`, sombra y hover propios— y meten adentro un
`SegmentedControl` y un buscador. Todo eso ya lo hace `ViewTabBar`, incluido el
contrato de buscador toggleable de §24 (Escape cierra y limpia; clic afuera
cierra solo si está vacío) y el colapso táctil de las acciones en hoja inferior.
Escribirla a mano significa perder esas dos cosas, no solo verse distinto.

**Nunca escribir el contenedor del header a mano.** Si falta algo, se le agrega
a `ViewTabBar`.

