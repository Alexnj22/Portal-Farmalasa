# Torogoz a producción — plan (2026-10-01)

Estado: **preparado, sin tocar producción.** La distribuidora vive en el
entorno de pruebas (32 borradores en `supabase/borradores/distribucion/`, tres
edge functions, la UI en `/torogoz`). Este documento es el orden para pasarla
a la base real sin romper un gate ni el portal.

Nace de dos auditorías del 2026-10-01: una de los borradores contra las reglas
de `CLAUDE.md` y otra de qué exige cada gate. Lo que se pudo corregir sin
producción ya está corregido en `0032_ajustes_antes_de_produccion.sql`.

## 0. Decisiones que faltan (del usuario)

| | qué | por qué importa |
|---|---|---|
| **D1** | **El emisor real.** NIT, NRC, nombre, actividad, dirección, establecimiento y `ambiente` de la S.A.S. | La semilla de pruebas (0002) no va a producción. Sin emisor, el módulo abre vacío. Se carga desde la pestaña **Empresa** (con `distribucion_config`) o como migración de datos; el `ambiente` arranca en `'00'` (pruebas de Hacienda) hasta aprobar el plan de pruebas. |
| **D2** | **Credenciales de Hacienda**: `DIST_MH_CERT`, `DIST_MH_CERT_CLAVE`, `DIST_MH_USUARIO`, `DIST_MH_CLAVE_API`. | Sin ellas los documentos quedan «Falta la firma». Las pone el usuario con `supabase secrets set` (nunca en el chat). |
| **D3** | **`RESEND_API_KEY` nueva** (la anterior quedó expuesta) y `CORREO_REMITENTE`. | Correo al cliente. `CORREO_MODO` NO se pone en producción. |
| **D4** | **GPS en Rutas.** `vercel.json` manda `Permissions-Policy: geolocation=()`, que apaga la ubicación en TODO el sitio: las visitas se guardan sin coordenadas y sin error. | Cambiarlo a `geolocation=(self)` toca la configuración compartida del portal: decisión aparte. |

## 1. Antes de la ventana (sin producción)

- [x] `0032`: REVOKE completo (TRUNCATE ya no queda para `authenticated`), 18 índices de FK, el push que no tumba una solicitud, y el **faltante del camión valorizado** (estaba en $0).
- [x] `auditoria/areas.mjs`: las 43 tablas `dist_*` y los 2 crons en el área `distribucion`.
- [x] `gate:tipos`: `src/utils/distribucionDocumento.js` en 0 avisos; JSDoc de opciones en `src/data/distribucion.js` para el día que pierda `@ts-nocheck`.
- [ ] Unir `origin/main` en una rama sobre `sesion/sas-ruta` (main está en 2.1113.x; la rama en 2.1117.x). Quedarse con el `ignoreCommand` de `vercel.json` de main. Bumpear con `npm run version:bump -- minor "Torogoz a producción"`.

## 2. La ventana — 06:00 a 11:59 UTC (00:00–05:59 SV)

Fuera de esa franja corren los syncs, y **diez borradores toman lock sobre
`products`** (cada FK hacia ella pide SHARE ROW EXCLUSIVE): 0001, 0004, 0006,
0015, 0017, 0026, 0030. **0008 toca `approval_requests`** (DROP/ADD del CHECK
de tipo e índice único). Todos llevan `SET lock_timeout = '5s'`: si uno
falla por lock, se reintenta; no congela el portal.

1. **0008 se rehace contra lo VIVO antes de aplicarlo.** Redefine
   `es_solicitud_operativa`, `modulo_de_aprobacion` y el CHECK
   `approval_requests_type_check`, que existen en producción y otras sesiones
   tocan. Sacar las tres con `pg_get_functiondef` / `pg_get_constraintdef` en
   el momento y agregarles sólo `DIST_DESCUENTO`.
2. `apply_migration`, **uno por borrador, en orden 0001 → 0032**, con nombre
   `distribucion_00NN_<nombre>`. Las semillas 0002 y 0005 pueden entrar (en
   producción no hacen nada: exigen la cuenta `pruebas` o el NIT ficticio) o
   saltarse; entrar mantiene idéntica la historia con el branch.
   0001–0009 no son idempotentes: **una sola pasada**, sin reintentos a medias.
3. Por cada uno, el archivo `supabase/migrations/<versión-de-14-dígitos>_<mismo-nombre>.sql`
   con el SQL exacto aplicado, en el mismo commit.
4. Desplegar las tres funciones **con JWT** (las llama el navegador; ningún
   cron): `distribucion-dte`, `distribucion-correo`, `distribucion-comprobante`.
   `mv .env .env.bak` antes del CLI.
5. Borrar `supabase/borradores/distribucion/` y ajustar sus rutas en
   `auditoria/areas.mjs`.

## 3. Después, en el mismo trabajo

- `npm run tipos:base` → commitear `src/types/database.ts`; quitar
  `@ts-nocheck` de `src/data/distribucion.js`, `distribucionCompras.js`,
  `distribucionInventario.js`; `npm run gate:tipos -- --remoto`.
- `npm run gate:data -- --regen-schema` (15 columnas booleanas nuevas:
  `dist_*.activo`, `venta_libre`, `contribuyente`, `gran_contribuyente`,
  `relacionada`, `desde_camion`) y `npm run gate:data -- --remote`.
- `gate:eficiencia`: declarar en `CRONS`
  `dist-vencer-reservas` (`* * * * *`, 1440/día, `sistema: 0`) y
  `dist-aviso-cartera-atrasada` (`0 13 * * *`, 1/día, `sistema: 0`). Se
  declaran DESPUÉS: una vez declarados, el gate exige que estén vivos.
- `npm run auditoria:sincronizar` con el snapshot nuevo de producción.
- `npm run gate:migrations` y `npm run gate:migrations -- --remote`.
- Unos días después: `npm run gate:perf` (sección F) — candidatas
  `dist_tablero`, `dist_libros_iva`, `dist_utilidad`.

## 4. El entorno de pruebas

`scripts/entorno-pruebas/distribucion.mjs` NO se borra entero: con los
borradores convertidos en migraciones el branch ya trae el esquema, pero
siguen haciendo falta desplegar las tres funciones (con `CORREO_MODO=simulado`)
y las semillas de tablero y pruebas. Reducirlo a eso y apuntar
`mantener_al_dia.mjs` (línea ~186) a la versión reducida. La primera corrida
nocturna después va a rehacer el branch (cambia el ref; el script actualiza
Vercel si están los secretos `VERCEL_*`).

## 5. Lo que queda abierto a propósito

- Varias funciones toman el emisor con `ORDER BY id LIMIT 1`: correcto con UN
  emisor, que es el caso. Si alguna vez hay dos, hay que pasarlo por parámetro.
- Cuatro funciones DEFINER podrían ser INVOKER (`dist_validar_lote_item`,
  `dist_ventas_perdidas_resolver`, `dist_cliente_ruta_texto`,
  `dist_validar_desde_camion`): leen tablas que quien llama ya puede leer. No
  es un agujero; es más privilegio del necesario.
- El receptor de la Nota de Remisión de la carga (la misma empresa) se
  confirma en el plan de pruebas de Hacienda.
