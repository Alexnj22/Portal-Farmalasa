# Prompt — Módulo de Clientes en el portal

Construí el módulo de Clientes: ver, buscar, filtrar y editar la ficha fiscal de
los clientes desde el portal. Fase 1 escribe solo en el portal; la Fase 2 (más
adelante, no ahora) propaga la edición al ERP.

## Qué existe y qué no

- **`src/data/customers.js`** — 17 líneas, una sola función:
  `searchCustomersByTokens(tokens)`, búsqueda server-side por tokens con OR
  sobre `search_name/nit/dui/phone/erp_id`. Reusala, no la reescribas.
- **`src/data/elSalvadorGeo.js`** — `EL_SALVADOR_GEO`: departamento → municipios.
  **Le faltan los distritos**, que es el tercer nivel que la ficha necesita.
- **No hay vista.** Hay que crearla de cero, con el checklist de módulo nuevo:
  vista, ruta, entrada de menú, permisos en `role_permissions`, y lo que haga
  falta en BD.

## La tabla

`customers`, 24,502 filas:

```
id bigint PK · name text NOT NULL · search_name text (= lower(name))
erp_id text · nit · dui · nrc · pasaporte
phone · telefono2 · email · direccion
departamento · municipio · distrito · categoria · giro
retencion_pct smallint · notes · created_at · updated_at
```

Datos que importan para el diseño:

- **`search_name` es único en las 24,502 filas.** Sirve como llave de
  emparejamiento con el ERP.
- **179 filas tienen `erp_id`**; las otras ~24,300 solo tienen nombre. El
  llenado va por bloques desde el ERP y sigue en curso, así que la vista tiene
  que verse bien con la ficha vacía.
- **`customers` tiene UNA sola policy: `customers_select`** (SELECT,
  `authenticated`, `USING (true)`). **No hay policy de INSERT/UPDATE/DELETE**, o
  sea que hoy nadie puede escribir desde la API. Para que el módulo guarde hay
  que decidir el camino — ver "Decisiones abiertas".
- Existe el RPC **`aplicar_espejo_erp(p_filas json)`** (migración
  `20260801044543`), SECURITY DEFINER, concedido a `authenticated`. Es para el
  espejo masivo ERP→portal; empareja por `search_name` y **nunca inserta**. No
  es el camino para editar un cliente suelto, pero es el precedente de diseño a
  seguir: función DEFINER como único camino de escritura, en vez de abrir una
  policy amplia.
- **PostgREST corta en 1000 filas.** Con 24,502 clientes, la lista tiene que ser
  paginada o buscada server-side. Ver la regla del cap en `CLAUDE.md`.

## Lo que hay que saber del ERP (esto costó caro averiguarlo)

El ERP es `https://clientesdte3.oss.com.sv/farma_salud`. La ficha se edita en
`editar_cliente.php?id_cliente=N` y se guarda con POST a `procesos/clientes.php`.

1. **Un POST parcial BORRA lo que no mandás.** Hay que reenviar los 21 campos del
   formulario, no solo el que cambió.
2. **Los valores van CRUDOS, sin `.strip()`.** El control de duplicados del ERP
   compara el nombre tal cual, y hay fichas cuya única diferencia es un espacio
   al inicio. Recortarlo hace colisionar los nombres y el ERP rechaza el
   guardado **entero** con
   `{"typeinfo":"Error","msg":"Ya se registro un cliente con estos datos!"}`.
3. **Siempre leer la respuesta.** Devuelve JSON `{typeinfo, msg}`. Si no la
   leés, un rechazo se ve igual que "el campo no se aplicó" y te vas a pasar
   horas persiguiendo el problema equivocado.
4. **Los ids de distrito NO son globales.** Van por (departamento, municipio), y
   se piden a `_helpers.php` con
   `{process:'getDistrito', id_departamento, id_municipio}`. El `8` es MEJICANOS
   en San Salvador y DULCE NOM MARÍA en Chalatenango. **En el portal guardá
   siempre el NOMBRE del distrito, nunca el id del ERP**, y resolvé el id contra
   la lista de ese municipio al momento de escribir.
5. **Categorías (6):** Consumidor, Contribuyente, Gran Contribuyente,
   Contribuyente Exento, Extranjero, Menor de edad. **El 99% del catálogo es
   Consumidor.** Los datos de un contribuyente se declaran a Hacienda: cualquier
   edición automática debe limitarse a Consumidor; el resto se edita solo con
   intervención humana explícita.
6. **El combo de clientes trae 3 pseudo-clientes que no son fichas**: `TODOS`,
   `-1` (CLIENTES VARIOS) y `-2` (CLIENTE FRECUENTE NUEVO). Son baldes de
   mostrador del POS. Nunca escribirles.
7. **Duplicados**: 19 nombres repetidos en 27,551 fichas (38 fichas, 19
   purgables); 11 pares difieren solo en espacios. Hay una lista en
   `duplicados_erp.json` del trabajo de migración.

## Reglas de validación ya acordadas — reusalas, no inventes otras

- **Teléfono**: válido si tiene **8 dígitos**, o **503 + 8** (código de país).
  Se cuentan **dígitos, no caracteres**: `'7538-5899'`, `'75385899'` y
  `'(503) 7538-5899'` son todos válidos. Si no cumple → `23010013`.
  Ojo: `1111-1111` pasa (son 8 dígitos) — la regla valida forma, no veracidad, y
  hay bastante relleno de ese tipo en el catálogo.
- **DUI**: usar `isValidDUIAlgorithm` de `src/utils/duiUtils.js`. No reimplementar.
  En el catálogo hay ~2% inválidos, casi todos de 9 dígitos con verificador
  incorrecto (uno resultó ser una fecha de nacimiento tecleada en el campo).
- **Nombre**: mayúscula es el estándar de facto — el 91% del catálogo ya lo está.

## Fase 1 — el módulo (esto es lo que hay que hacer ahora)

Vista de lista con el estándar del proyecto: header flotante, buscador global,
filter pills, DataTable con orden. Filtros útiles dado el estado de los datos:
categoría, departamento/municipio/distrito, con/sin DUI, con/sin `erp_id`
(o sea "portado del ERP" o no), y con/sin datos fiscales completos.

Ficha de detalle/edición con los campos de arriba, cascada
departamento → municipio → distrito, y las validaciones ya descritas.

Mostrá la actividad del cliente si es barato: `sales_invoices.customer_id` te da
cuántas facturas tiene y de qué tipo (CCF vs COF). Es el dato que más ayuda a
decidir si una ficha vale la pena completarla.

## Fase 2 — escribir de vuelta al ERP (NO ahora, pero diseñá para esto)

Cuando se implemente, **tiene que ir por una edge function**, no desde el
navegador: las credenciales del ERP viven en secrets de Supabase
(`ERP_BRANCH_MAP`) y además el ERP no permite CORS desde el portal. La secuencia
correcta, ya probada: login → GET de la ficha → parsear los 21 campos **crudos**
→ mezclar el cambio → POST completo → **leer el JSON de respuesta** → releer la
ficha y verificar campo por campo.

Diseñá la Fase 1 para que eso encaje: guardá el `erp_id`, el nombre del distrito
(no su id), y dejá el punto de guardado en un solo lugar.

## Decisiones abiertas — resolvelas antes de escribir código

1. **Cómo escribe el módulo.** `customers` no tiene policy de escritura. Las
   opciones son (a) un RPC DEFINER por operación, siguiendo el precedente de
   `aplicar_espejo_erp`, o (b) una policy de UPDATE con gate de permisos usando
   `auth_can_edit_any(...)` envuelto en `(SELECT ...)`. `USING (true)` está
   prohibido por `CLAUDE.md`. Mi sugerencia es (a).
2. **De dónde salen los distritos.** El portal no los tiene. O se extraen del
   ERP una vez y se guardan como catálogo, o se arma desde la reorganización
   territorial oficial de El Salvador. Tienen que quedar por
   (departamento, municipio).
3. **Qué se hace con los duplicados.** Hay 19 nombres repetidos en el ERP y el
   portal tiene una sola fila por cliente. El módulo es el lugar natural para
   revisarlos y purgarlos.

## Convenciones del proyecto que aplican

Leé `CLAUDE.md` y `DESIGN.md` antes de empezar. En particular: `LiquidSelect` en
vez de `<select>` nativo, cero elementos nativos del navegador, `appendAuditLog`
en toda acción de usuario, bump de `APP_VERSION` en cada commit, y
`npm run gate:design` en verde antes de cerrar. Toda tabla o función nueva sigue
las reglas de RLS y grants de `CLAUDE.md`.
