# Plan: los clientes se crean y se corrigen sólo en el portal (2026-11-15)

Decisión del usuario, 2026-11-15. Este documento es el punto de partida de la
sesión que lo implemente **desde la Mac** (la sesión en la nube no llega al
ERP: ni red ni credenciales).

Auditado el mismo día contra el código y producción (sección «Auditoría» al
final): cada afirmación de abajo está medida, y donde la primera versión decía
otra cosa, se corrigió.

## El problema

Un cliente con el DUI o el teléfono mal en su ficha no puede entrar a la app
Puntos Salud: la app lo valida contra el DUI y el teléfono **del portal**
(`app-clientes`, acción `entrar` → `buscarCliente`; la búsqueda por documento
es `puntos_cliente_por_documento`). Cuando la sala corrige la ficha **en el
ERP**, el portal no se entera:

- El «espejo» se copió completo **una vez**, en agosto (`bloque.py` /
  `aplicar_espejo.py`; el portal tenía entonces ~24,500 fichas).
- Desde entonces sólo se releen las fichas que corrige la corrida de las 9:30 pm
  (`sincronizar-fichas-clientes`, lista `fichas_para_corregir_dte()`: las
  nuevas sin distrito y las que Hacienda rechazó).
- `sync-dte-sales` trae el NOMBRE del cliente y, por `reimprimir_factura.php`,
  su número interno (`id_cliente`), y crea la ficha del portal con
  `upsert_customers_v2`. Nunca trae el DUI ni el teléfono. **Así nacen hoy los
  clientes en el portal: ~530 en los últimos 30 días (~18 por día), todos dados
  de alta en el ERP.**

Lo que se edita **en el portal** sobre una ficha que ya existe en el ERP llega
en el momento (`push-cliente-erp` al guardar; `drain-cliente-erp-queue` cada
10 min es la red). **Lo que se edita sobre una ficha que el ERP no tiene no
llega nunca**: ver el hueco de abajo.

### El hueco que la primera versión no vio

Hay **93 fichas del portal sin número del ERP** (`customers.erp_id IS NULL`),
39 de ellas de los últimos 30 días. Nacen en
`cliente_crear_de_mostrador`, que crea la ficha **sólo en el portal**, y lo
llaman dos pantallas:

- la caja del portal (`src/components/caja/BuscarFicha.jsx`);
- la app del personal (`apps/mobile/app/aplicacion-inyeccion.js`).

Su cola de cambios no se vacía nunca: `cola_espejo_portal_erp` las aparta con
«sin erp_id: la ficha del portal no está emparejada con el ERP». Medido el
15-nov: de los 37 cambios pendientes en `customers_changelog`, **35 son de 5
fichas sin número del ERP** (DUI, teléfono, ubicación, categoría; el más viejo
del 5-oct). Los otros 2 son `notes` de una ficha emparejada (campo que sólo vive
en el portal). **El ERP no está rechazando nada: le faltan esas fichas.**

Consecuencia para el plan: el alta en el ERP no es sólo para los clientes
nuevos. Hay que **subir también las 93 que ya existen** (paso 4c), y el alta de
mostrador tiene que pasar por el mismo camino.

## Lo que se decidió

| # | Qué | Estado |
|---|---|---|
| 1 | **Regla para las salas**: los datos del cliente se corrigen en el portal (Clientes → ficha → editar), no en el ERP. | Decidido. Es inmediato para fichas emparejadas; para las 93 sin número, sólo después del 4c. |
| 2 | Releer la ficha del ERP cuando el cliente no puede entrar a la app. | **Descartado** por el usuario. |
| 3 | **Revisión completa, una sola vez**: releer las fichas del ERP y dejar el portal igual. | Por hacer. |
| 4 | **Crear el cliente desde el portal** (y desde la app del personal), con el alta en el ERP en el mismo momento. | Por hacer. |
| 5 | El usuario **desactiva en el ERP** la creación y la edición de clientes. | Lo hace el usuario — **después del 4**. |
| 6 | **Permiso nuevo para crear** (`clientes_crear`). Nace activo para todo cargo que hoy VE Clientes. | Decidido por el usuario, 2026-11-15. |

### ⚠️ El orden importa

El ERP sigue siendo la caja donde se factura. Si se apaga la creación de
clientes en el ERP antes de que el portal sepa crearlos, las salas no tienen
dónde registrar a un cliente nuevo (~18 por día). **Editar** sí se puede apagar
en el ERP en cualquier momento para las fichas emparejadas.

Orden: **4a → 4b → 4c → aviso a las salas → 5 → 3.**

- El aviso va **antes** del 5: cuando el ERP deje de dejar crear, la sala tiene
  que saber ya dónde se hace.
- La revisión (3) va después del 5 para que nadie cambie fichas en el ERP
  mientras se compara.

## 4 · Crear el cliente desde el portal

### 4a · Averiguar el alta del ERP (lo primero en la Mac)

Lo que ya se sabe de la copia guardada (`scripts/migracion-clientes/cli6317.html`,
que es la pantalla de **edición**):

- El guardado manda el formulario (`#6a6d1ed555aea`, serializado) por POST a
  **`procesos/clientes.php`**, con `process=edit` e `id_cliente`.
- La respuesta es `{typeinfo, msg}`, y con `Success` la página **se recarga a
  `admin_cliente.php`**. **No devuelve el número del cliente.**
- El alta abre `modal_new_cliente.php` (la variable `urlprocess` de esa copia
  lo nombra, pero no se usa en el guardado).

Lo que falta, y hay que leerlo del ERP vivo:

1. El HTML de `modal_new_cliente.php`: qué `process` manda el alta (casi seguro
   el mismo `procesos/clientes.php` con otro valor), qué campos son
   obligatorios y qué valores por defecto pone (categoría, giro, ubicación).
2. **Cómo encontrar el `id_cliente` nuevo.** Si la respuesta no lo trae, se
   busca justo después en la lista del ERP **por DUI/NIT y nombre exactos**,
   y se acepta **sólo si hay una coincidencia y es nueva** (no estaba antes del
   alta). Dos coincidencias, o ninguna → la ficha queda **pendiente de
   emparejar**, visible, nunca adivinada.
3. Probar el alta con una ficha de prueba y dejarla anotada (el ERP no tiene
   cómo borrar: confirmar si `procesos/clientes.php` tiene un `delete` antes de
   contar con él).

### 4b · El alta en el portal

- **Una sola función de la base** para crear, que reemplaza a
  `cliente_crear_de_mostrador` en sus dos usos y sirve al formulario nuevo de
  Clientes. Exige `clientes_crear` (envuelto en `(SELECT …)`), valida (DUI con
  `es_dui_valido`, teléfono con `es_telefono_sv_valido`, lo que exige la
  categoría según `customer_ficha_estado`) y decide duplicados con la clave
  normalizada (`search_name`, sin tildes), por DUI y por NIT — no con el índice
  único de nombre, que NO quita acentos («MUÑOZ» y «MUNOZ» entran los dos). Ver
  el encabezado de `scripts/migracion-clientes/crear_faltantes.py`. Si ya
  existe, devuelve esa con `existente: true` (como hoy).
- **El alta en el ERP es inmediata**, no por la cola: el cajero tiene que
  encontrar al cliente en la caja del ERP al instante para facturarle.
  - Camino: la función crea la ficha del portal marcada **«subiendo al ERP»** y
    la edge function (nueva acción en `push-cliente-erp`, o una función propia)
    hace el alta, lee la respuesta y guarda el `erp_id`.
  - Si el ERP rechaza o no se encuentra el número: la ficha **queda marcada
    pendiente y visible** (pastilla en Clientes y un aviso al que la creó), y el
    cron de la cola la reintenta. Nunca creada a medias en silencio.
  - Cuidado con la doble alta: un reintento después de un alta que sí entró pero
    cuyo número no se encontró **duplica en el ERP**. Antes de reintentar un
    alta, buscar primero (paso 2 de 4a).
- **Lo que hay que respetar, ya aprendido con la edición**:
  - **LEER la respuesta**: el ERP contesta 200 con `{"typeinfo":"Error"}` cuando
    rechaza.
  - **Los valores viajan crudos**; el control de duplicados del ERP compara el
    nombre tal cual.
  - **Un POST parcial borra lo que no se manda** (en la edición): mandar la
    ficha entera.
  - Ubicación resuelta por etiqueta y escrita en cascada
    (`docs/reglas/fichas-y-hacienda.md`).
- **Pantallas**: botón «Nuevo cliente» en Clientes (formulario de 6+ campos →
  borrador con `saveDraft`/`loadDraft`), la caja y la app del personal
  (`apps/mobile/app/clientes.js` dice hoy «No hay alta: las fichas las da de
  alta el punto de venta»: eso cambia). Toda acción → `appendAuditLog`.
- **Edge function nueva o cambiada** → declararla en
  `scripts/alcance-manifest.json` y correr `gate:alcance` y `gate:seguridad`
  completos; leer `verify_jwt` vivo antes de redesplegar. `push-cliente-erp`
  hoy va con `--no-verify-jwt` porque la llaman **dos**: el cron (con el
  secreto, que no es un JWT) y el navegador (con la sesión de la persona, que la
  función pasa a los RPC para que apliquen su permiso). En el manifiesto está
  declarada sólo como `cron`: al agregarle el alta desde el navegador, corregir
  esa declaración.

### 4c · Subir las fichas que ya existen sin número del ERP

Las 93 de hoy (y las que nazcan hasta que 4b esté publicado). Mismo camino que
el alta, en tanda, **buscando primero en el ERP** (muchas pueden existir allá
con otro nombre o con el DUI: ésas se emparejan, no se crean). Las que choquen
(mismo DUI en dos fichas, nombre parecido) → «Por revisar». Al terminar, la cola
de `customers_changelog` debería quedar en cero salvo `notes`.

### 4d · Permiso `clientes_crear` (decidido)

- Sub-permiso de `clientes` (`tipo: 'cap'`, junto a `clientes_ver_montos` en
  `src/constants/permissionModules.js`) — `gate:permisos` lo cruza.
- La migración lo da con `can_view = true` a **todo cargo que hoy ve
  Clientes**. Medido el 15-nov (`role_permissions`, `module_key = 'clientes'`,
  `can_view`): Gerente General (2), Administrador (3), Jefe/a de Talento Humano
  (11), Supervisor/a de Ventas (13), Jefe/a de Sala (19), Regente de Enfermería
  (23), Dependiente de Farmacia (30) y QA / Testing (33). **Leerlo otra vez al
  escribir la migración** (puede cambiar) y copiarlo desde la tabla, no desde
  esta lista: `INSERT … SELECT role_id … WHERE module_key = 'clientes' AND
  can_view`.
- Subjefe/a de Sala (20) **no** ve Clientes hoy, así que no lo recibe. Si las
  salas lo necesitan para crear en la caja, es una decisión aparte.

## 3 · Revisión completa

- Releer **todas las fichas emparejadas** (29,191 el 15-nov; el portal tiene
  29,284) con `leerFicha` (`editar_cliente.php`) y aplicarlas con
  `aplicar_espejo_erp`, que:
  - **no propaga borrados** (`COALESCE`): un campo vacío en el ERP no borra el
    del portal;
  - **respeta los cambios del portal todavía no subidos** (los cruza contra
    `customers_changelog` pendiente y los deja como conflicto, no los pisa).
- **Mejora sobre la primera versión**: un valor del ERP que **no pasa la
  validación del portal** (DUI que no cumple el algoritmo, teléfono que no es de
  El Salvador) **no reemplaza** a uno válido del portal. Va al informe. Si no,
  la revisión puede volver a dejar sin entrar a la app a quien ya entraba.
- En segundo plano y en tandas, de noche, fuera del horario de sala (la copia
  de agosto midió ~34 h en total). Como script desde la Mac, o, si va como cron,
  declarado en `CRONS` de `gate:eficiencia` con sus peticiones al ERP por día.
- **Informe al terminar**: cuántas fichas cambiaron y en qué campo; las que no
  se pudieron leer; las que chocan (mismo DUI en dos fichas, número interno que
  el ERP no reconoce) → «Por revisar»; las que el ERP traía inválidas.
- Después de esto, con el ERP cerrado a altas y ediciones, el portal y el ERP
  quedan iguales y se mantienen así porque todo cambio nace en el portal.

## Lo que queda fuera (y conviene decidir)

- **Pre-registros de la app** (`app_preregistro_resolver`): hoy la sala sólo
  puede *vincular* a una ficha existente o *descartar* (2 pendientes el
  15-nov). Con el alta en el portal, se puede agregar «crear la ficha con estos
  datos» — usaría la misma función de 4b.
- **La venta de la distribuidora** (Torogoz, en `sesion/nucleo`) tiene su propio
  «Cliente nuevo»: confirmar si sus clientes viven en `customers` y si también
  deben subir al ERP.
- `sync-dte-sales` seguirá creando fichas desde las facturas mientras el ERP
  deje crear. Después del 5 ese camino debería quedar en cero; si aparece una
  ficha nueva por ahí, alguien creó un cliente en el ERP (vale como alarma).

## Auditoría (2026-11-15)

Contra el código y producción:

| Afirmación de la primera versión | Resultado |
|---|---|
| La app valida contra el DUI y teléfono del portal | ✅ `app-clientes`, acción `entrar` |
| El espejo se copió una vez, ~24,500 fichas | ✅, pero eran las de agosto; hoy son 29,284 |
| «~29,000 fichas» para la revisión | ✅ 29,191 emparejadas |
| `sync-dte-sales` sólo trae el nombre y el número interno | ✅, y crea la ficha (`upsert_customers_v2`) |
| Editar en el portal «ya es inmediato en los dos lados» | ⚠️ Sólo para fichas emparejadas; 93 fichas sin número no suben nunca (35 de los 37 cambios trabados) |
| `cliente_crear_de_mostrador` crea sólo en el portal | ✅, y la usan la caja y la app del personal: es la fuente de las 93 |
| `_shared/erp-clientes.ts` sólo sabe editar | ✅ `process: "edit"` |
| El alta abre `modal_new_cliente.php` | ✅, pero el guardado va a `procesos/clientes.php` y no devuelve el número |
| `aplicar_espejo_erp` no propaga borrados | ✅, y además respeta lo pendiente |
| `push-cliente-erp` con `--no-verify-jwt` | ✅ correcto (cron + navegador, valida adentro); el manifiesto la declara sólo `cron` |
| Quién tiene Clientes | Corregido con los ids de cargo reales (ver 4d) |
| Orden 4 → 5 → 3 | ✅, con 4c y el aviso antes del 5 |

## Referencias

- `supabase/functions/push-cliente-erp/index.ts` — el empuje portal → ERP.
- `supabase/functions/_shared/erp-clientes.ts` — login, leer y escribir la ficha.
- `supabase/functions/sincronizar-fichas-clientes/index.ts` — la corrida de las
  9:30 pm, `filaPortal` y `aplicar_espejo_erp`.
- `supabase/migrations/20261111033250_cola_portal_erp_sin_campos_solo_portal.sql`
  — `cola_espejo_portal_erp` y por qué aparta las fichas sin `erp_id`.
- `supabase/migrations/20261028200428_inyecciones_confirmar_en_la_bitacora_y_ficha_desde_la_caja.sql`
  — `cliente_crear_de_mostrador`.
- `scripts/migracion-clientes/` — la migración de agosto (`bloque.py`,
  `aplicar_espejo.py`, `crear_faltantes.py`, `cli6317.html`).
- `docs/reglas/fichas-y-hacienda.md` — lo que no se puede romper de las fichas.
