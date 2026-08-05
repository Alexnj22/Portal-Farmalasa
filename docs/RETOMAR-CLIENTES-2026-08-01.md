# Clientes — dónde retomar (2026-08-01, tarde)

> ## ⚠️ Releído el 2026-08-05 — cuatro de los cinco pendientes ya están resueltos
>
> Este documento se escribió el 2026-08-01 y **su lista de pendientes ya no
> describe el sistema**. Cada punto se volvió a medir contra prod y contra el
> código; el detalle está al pie de cada uno. Resumen:
>
> | # | Escrito el 01-ago | Medido el 05-ago |
> |---|---|---|
> | 1 · el espejo pisa ediciones | URGENTE | ⚠️ **SIGUE ABIERTO** — `aplicar_espejo_erp` no tiene `COALESCE`. Lo que cambió es que **ya no hay cron que lo dispare**: el riesgo solo se materializa si alguien corre `aplicar_espejo.py` a mano |
> | 2 · el distrito del ERP degradado | 894 fichas mal | ✅ **Resuelto** — `ABREVIATURAS_ERP` + `sinTildes` en `elSalvadorGeo.js`. De 21,438 fichas con distrito, **21,412 resuelven**. Quedan **26** (11 valores), y 6 son abreviaturas nuevas que la tabla no tiene: `SAN RAF CEDROS`, `SN J VILLANUEVA`, `STA C MICHAPA`, `STGO DE MARÍA`, `CONCEP DE OTE`, `STA ROSA GUACHI` |
> | 3 · Fase 2, escribir al ERP | «no existe» | ✅ **Construida** — edge function `push-cliente-erp`, invocada desde `customers.js:130`, y el cron `drain-cliente-erp-queue` (cada 10 min, `active=true`). **10 ediciones ya enviadas**, 4 en cola |
> | 4 · `1111-1111` pasa la validación | 69 personas | ✅ **Resuelto** — `telefonoValido` exige prefijo `[2567]`, así que `1111-1111` ya no pasa. Ojo: **4,958 fichas** lo tienen guardado (no 69), pero solo se marcan al editarlas, por decisión escrita en el propio validador |
> | 5 · commit sin pushear | `02880141` | ✅ **Pusheado** — está en `origin/main` |
>
> **Lo único que queda de este documento es el punto 1**, y su fix sigue siendo
> la línea por campo que está escrita más abajo.

## Estado en una línea

~~**Se edita desde el portal y queda guardado. No llega al ERP.** Cero cambios
enviados, 7 en cola.~~ → **Al 2026-08-05 sí llega al ERP**: 10 enviadas, 4 en cola,
drenadas por cron cada 10 minutos.

## Qué quedó hecho hoy

- **Guardado desde el portal: probado end-to-end contra producción**
  (`portal.farmasalud.lat`, no un build local). Ficha ZULMA FUNES (id 1833541):
  `phone` null → `2000-0000` → null, **verificado en la BD entre las dos
  escrituras**, no solo por el toast. Botón bloqueado sin cambios y con teléfono
  inválido, bitácora con `SIN ENVIAR AL ERP`, 0 errores de consola.
- **"A revisar" pasó de 1 modo a 4** (v2.321.0, migración `20260801153440` ya
  aplicada en prod). Era un booleano que mandaba siempre `'dui'`: la tarjeta
  contaba 17 y el filtro mostraba 2. Verificado contra la BD: DUI 2 · Teléfono 0
  · Nombre 18 · Duplicado 86.
- **"Nombre dañado" dejó de ser solo mojibake**: marca también los nombres sin
  una sola letra (`....`, `.....`, `1111111111111`). La tarjeta pasó de 17 a 20.
- **Los scripts de QA usan la cuenta dedicada** (`E2E_USER`/`E2E_PASSWORD` del
  `.env`, rol 33 que ya tenía permiso de `clientes`). Antes usaban `portal-user`,
  y por eso tres ediciones propias se reportaron como "de otra persona".

## Pendientes, por urgencia

### 1. URGENTE — el espejo borra ediciones del portal, en silencio

`aplicar_espejo_erp` escribe los 16 campos **sin condición**. No hay `COALESCE`,
no es "solo si está vacío".

**Comprobado en vivo el 2026-08-01 16:01 UTC**: reescribió 811 fichas en un
minuto, y de las 2 fichas que tenían edición hecha desde el portal, **pisó las
2**. Ejemplo: JOSE RUTILIO ALEMAN VASQUEZ (14529), distrito corregido a mano a
`Chalatenango` a las 05:50, revertido a `CHALATENANGO` a las 16:01:46.

Lo grave no es que pise: es que **no deja rastro**. `customers_changelog` no
registra nada, así que la bitácora sigue diciendo que la corrección se hizo y no
dice que se deshizo. Hoy no hubo daño real (las 2 fichas eran de prueba), pero el
módulo existe para completar 23,897 fichas.

**Fix**, una línea por campo en la función:

```sql
-- antes:   el ERP siempre gana
phone = e.phone
-- después: el portal gana si tiene algo
phone = COALESCE(NULLIF(c.phone, ''), e.phone)
```

**Coordinar antes de tocar**: otra sesión está corriendo `bloque.py` /
`aplicar_espejo.py` (corrida "b2", 1,085 de 24,509 fichas, ~34 h restantes al
ritmo medido). No cambiarle la función por debajo mientras trabaja.

### 2. El distrito del ERP no es un formato distinto: es el dato degradado

**894 fichas tienen distrito en la BD y el formulario muestra el campo vacío.**
`normalizarGeo` (`src/data/elSalvadorGeo.js:160`) compara contra el catálogo con
igualdad exacta, así que `CHALATENANGO` ≠ `Chalatenango` → lo trata como
inexistente. Y si el operador toca el municipio, lo pone en `null` y al guardar
se borra de verdad.

Hoy **ninguno de los 894 es contribuyente**, así que el aviso de "distrito
obligatorio para CCF" no se dispara en falso. Es suerte, no diseño.

Además, varios no son mayúsculas sino **abreviaturas** — no son el nombre de
nada y no se arreglan con `INITCAP`:

| ERP | real |
|---|---|
| `SAN I LABRADOR` | San Isidro Labrador |
| `SN MIG MERCEDES` | San Miguel de Mercedes |
| `SAN ANT RANCHOS` | San Antonio Los Ranchos |
| `SAN ANT LA CRUZ` | San Antonio de la Cruz |
| `NVA CONCEPCIÓN` | Nueva Concepción |
| `DULCE NOM MARÍA` | Dulce Nombre de María |
| `SAN J CANCASQUE` | San José Cancasque |
| `SAN JOSE FLORES` | San José Las Flores |
| `SAN LUIS CARMEN` | San Luis del Carmen |

Hay que construir una **tabla de equivalencias ERP ↔ catálogo**. Sirve para esto
y para la Fase 2, así que conviene hacerla una sola vez.

Nota: `departamento` y `municipio` **sí** están bien (992 fichas, todas en
formato catálogo). El problema es solo `distrito`.

### 3. Fase 2 — escribir de vuelta al ERP (no existe)

- La cola son las filas de `customers_changelog` con `erp_synced_at IS NULL`.
- Tiene que ir por **edge function**: el ERP no da CORS y las credenciales están
  en Vault.
- El emparejamiento de distrito contra la lista del ERP tiene que ser
  **normalizado**, nunca por igualdad de cadena — ver el punto 2.

### 4. Menor — `1111-1111` está en 69 personas distintas

Es relleno de cajero y pasa la validación, porque `es_telefono_sv_valido` solo
mira el formato. Por eso el filtro "Teléfono" devuelve 0. Fix: lista de
teléfonos basura (`1111-1111`, `0000-0000`, …) en el validador.

### 5. Administrativo — hay un commit sin pushear

`02880141` (el filtro de duplicados) **no está pusheado**, así que la mejora aún
no está en el portal en vivo — la BD sí ya tiene la migración. Ese commit además
**arrastró 5 archivos de otra sesión** (notificaciones): entre el `git add` de 3
paths explícitos y el `commit`, la otra sesión preparó los suyos en el index. No
se perdió nada; la atribución quedó cruzada. No se reescribió la historia porque
la otra sesión estaba commiteando.

**En este árbol usar `git commit -o -- <paths>`**, que ignora lo que otro haya
preparado en el medio.

## Datos que no hace falta volver a descubrir

- **Tres baldes de mostrador**, no dos: `CLIENTES VARIOS`, `CLIENTE FRECUENTE`,
  `CLIENTE FRECUENTE NUEVO` (+ `TODOS`). 28% de todas las facturas.
- **`search_name` es GENERADA** con `translate`, no `lower(name)`. No asignarla.
  Normalizar el query con el MISMO `translate`, nunca `unaccent()`.
- **Duplicados**: no hay por documento (DUI y NIT, cero repetidos) ni por nombre
  exacto (índice único). Son 86 fichas en 43 grupos por **conjunto de tokens**
  (apellidos invertidos). El teléfono es inútil como señal.
- **Calcular duplicados cuesta 327 ms** sobre las 24,506 contra 126 ms de la
  lista → por eso el bloque se inyecta en el texto del query solo cuando el
  filtro está activo.
- **No hacer `ALTER TABLE customers`** sin pensarlo: el sync de DTE la escribe
  cada minuto entre 12:00 y 05:59 UTC. Es el perfil del outage del 2026-07-08.
- **Lo único que escribe `customers` automáticamente** es `upsert_customers`
  (`INSERT … ON CONFLICT DO NOTHING`): crea fichas, nunca actualiza. Las
  ediciones del portal están a salvo de ese lado.
- **QA**: `E2E_USER`/`E2E_PASSWORD`, y **verificar la identidad de la fila antes
  de escribir** — un script que busca y clickea "la primera fila" escribe en el
  registro equivocado con todo en verde.
