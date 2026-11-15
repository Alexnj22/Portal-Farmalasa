# Plan: los clientes se crean y se corrigen sólo en el portal (2026-11-15)

Decisión del usuario, 2026-11-15. Este documento es el punto de partida de la
sesión que lo implemente **desde la Mac** (la sesión en la nube no llega al
ERP: ni red ni credenciales).

## El problema

Un cliente con el DUI o el teléfono mal en su ficha no puede entrar a la app
Puntos Salud: la app lo valida contra el DUI y el teléfono **del portal**
(`puntos_cliente_por_documento`, desde `app-clientes`, acción `entrar`).
Cuando la sala corrige la ficha **en el ERP**, el portal no se entera:

- El «espejo» se copió completo **una vez**, en agosto (`bloque.py` /
  `aplicar_espejo.py`, ~24,500 fichas).
- Desde entonces sólo se releen las fichas que corrige la corrida de las 9:30 pm
  (`sincronizar-fichas-clientes`, lista `fichas_para_corregir_dte()`: las
  nuevas sin distrito y las que Hacienda rechazó; 38 el 15-nov).
- `sync-dte-sales` sólo trae el NOMBRE del cliente y su número interno, nunca
  el DUI ni el teléfono.

En cambio, lo que se edita **en el portal** llega al ERP en el momento
(`push-cliente-erp`, empuje inmediato al guardar; el cron
`drain-cliente-erp-queue` cada 10 min es la red).

## Lo que se decidió

| # | Qué | Estado |
|---|---|---|
| 1 | **Regla para las salas**: los datos del cliente se corrigen en el portal (Clientes → ficha → editar), no en el ERP. Ya es inmediato en los dos lados. | Decidido. Falta avisar a las salas (¿y un aviso en la vista Clientes?). |
| 2 | Releer la ficha del ERP cuando el cliente no puede entrar a la app. | **Descartado** por el usuario. |
| 3 | **Revisión completa, una sola vez**: releer las ~29,000 fichas del ERP y dejar el portal igual. | Por hacer. |
| 4 | **Crear el cliente desde el portal** (y desde la app del personal), con el alta en el ERP en el mismo momento. | Por hacer. |
| 5 | El usuario **desactiva en el ERP** la creación y la edición de clientes. | Lo hace el usuario — **después del 4**. |

### ⚠️ El orden importa

El ERP sigue siendo la caja donde se factura. Si se apaga la creación de
clientes en el ERP antes de que el portal sepa crearlos, las salas no tienen
dónde registrar a un cliente nuevo. **Editar** sí se puede apagar en el ERP en
cualquier momento: el portal ya edita y empuja.

Orden: **4 → 5 → 3 → aviso a las salas.** La revisión va después del 5 para que
nadie cambie fichas en el ERP mientras se compara.

## 4 · Crear el cliente desde el portal

### Lo que hay hoy

- `cliente_crear_de_mostrador(p_nombre, p_dui, p_telefono)`
  (`src/data/customers.js`, `crearClienteDeMostrador`) crea la ficha **sólo en el
  portal**; no pasa al ERP.
- `push-cliente-erp` y `_shared/erp-clientes.ts` sólo saben **editar**
  (`procesos/clientes.php` con `process: "edit"` e `id_cliente`).
- En la copia guardada de la pantalla del ERP
  (`scripts/migracion-clientes/cli6317.html`) el alta abre
  **`modal_new_cliente.php`**. Los campos del formulario de edición son:
  `nombre, dui, nit, nrc, pasaporte, categoria, sel_giro, telefono1,
  telefono2, correo, direccion, municipio, distrito, porcentaje, hi_retiene,
  apunte` (+ `process`, `id_cliente`).

### Lo primero en la Mac

1. Leer `modal_new_cliente.php` y averiguar qué manda al guardar: el valor de
   `process` del alta, los campos obligatorios y **cómo devuelve el
   `id_cliente` nuevo** (o cómo encontrarlo después).
2. Probar el alta con una ficha de prueba y borrarla (o dejarla anotada).

### Lo que hay que respetar (ya aprendido con la edición)

- **Hay que LEER la respuesta**: el ERP contesta 200 con
  `{"typeinfo":"Error"}` cuando rechaza.
- **Los valores viajan crudos**; el control de duplicados del ERP compara el
  nombre tal cual.
- **Un POST parcial borra lo que no se manda** (en la edición): mandar la ficha
  entera.
- **Sin duplicados**: la existencia se decide con la clave normalizada
  (`search_name`, sin tildes), por DUI y por NIT, no con el índice único de
  nombre (que NO quita acentos: «MUÑOZ» y «MUNOZ» entran los dos). Ver el
  encabezado de `scripts/migracion-clientes/crear_faltantes.py`.
- **Las validaciones del portal**: DUI con su algoritmo (`es_dui_valido`),
  teléfono de El Salvador (`es_telefono_sv_valido`), categoría y lo que exige
  cada una (`customer_ficha_estado`), ubicación resuelta por etiqueta y escrita
  en cascada (`docs/reglas/fichas-y-hacienda.md`).
- **El alta es inmediata**, no por la cola: el cajero tiene que encontrar al
  cliente en la caja al instante para facturarle. Si el ERP rechaza, el portal
  lo dice y **no deja la ficha creada a medias** (o la deja marcada como
  pendiente y visible, nunca en silencio).
- Edge function nueva o cambiada → declararla en `scripts/alcance-manifest.json`
  y correr `gate:alcance` y `gate:seguridad` completos; leer `verify_jwt` vivo
  antes de redesplegar (`push-cliente-erp` va con `--no-verify-jwt`).
- Toda acción → `appendAuditLog`; formulario de 6+ campos → borrador
  (`saveDraft`/`loadDraft`); módulo del portal → pantalla nativa en
  `apps/mobile` (hoy `/clientes` dice «las fichas las da de alta el punto de
  venta»: eso cambia).

### Quién puede crear

Hoy tienen `clientes` con edición: Dependiente de Farmacia (20), Regente de
Enfermería (8), Jefe/a de Sala (6), Supervisor/a de Ventas, Administrador,
Gerente General, Jefe/a de Talento Humano. Decidir con el usuario si crear usa
el mismo permiso o uno propio.

## 3 · Revisión completa

- Releer las ~29,000 fichas del ERP (`leerFicha`, `editar_cliente.php`) y
  aplicarlas al portal con `aplicar_espejo_erp`, que **no propaga borrados**
  (`COALESCE`): un campo vacío en el ERP no borra el del portal.
- En segundo plano y en tandas, de noche, fuera del horario de sala (la copia de
  agosto midió ~34 h en total). Declarar la cadencia en `CRONS` de
  `gate:eficiencia` (peticiones al ERP por día) o correrlo como script desde la
  Mac.
- **Informe al terminar**: cuántas fichas cambiaron, en qué campo, y las que no
  se pudieron leer o chocan (mismo DUI en dos fichas, número interno que el ERP
  no reconoce → «Por revisar»).
- Después de esto, con el ERP cerrado a ediciones, el portal y el ERP quedan
  iguales y se mantienen así porque todo cambio nace en el portal.

## Referencias

- `supabase/functions/push-cliente-erp/index.ts` — el empuje portal → ERP.
- `supabase/functions/_shared/erp-clientes.ts` — login, leer y escribir la ficha.
- `supabase/functions/sincronizar-fichas-clientes/index.ts` — la corrida de las
  9:30 pm, `filaPortal` y `aplicar_espejo_erp`.
- `scripts/migracion-clientes/` — la migración de agosto (`bloque.py`,
  `aplicar_espejo.py`, `crear_faltantes.py`).
- `docs/reglas/fichas-y-hacienda.md` — lo que no se puede romper de las fichas.
