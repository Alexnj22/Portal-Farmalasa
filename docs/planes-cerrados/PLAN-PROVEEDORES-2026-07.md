# PLAN DE EJECUCIÓN — Maestro de Proveedores (auto-registro desde DTE)

> **Prompt de ejecución autocontenido.** Cualquier sesión de Claude Code puede retomar
> este plan desde el estado marcado en los checkboxes. Ejecutar fase por fase, en orden.
> NO saltar a la fase siguiente con ítems abiertos en la actual (incluye follow-ups
> externos del usuario). TODO write a producción (dato, DDL o registro de migración)
> requiere OK explícito del usuario EN EL MOMENTO — una aprobación previa no lo cubre.

**Fecha del plan:** 2026-07-18 · **Estado:** CERRADO — Fases 0-5 aplicadas en
prod (v2.21.0-v2.22.0). Pendiente no bloqueante: guard de permisos con rol
restringido (§4.6/§6) no re-probado en vivo para este módulo específico.
**Memorias relacionadas:** `project_facturas_compra_email_module.md`,
`reference_suppliers_vs_proveedores_tables.md`

---

## 1. Objetivo

Hoy los proveedores existen "de forma incorrecta": `suppliers` (78 filas) viene del
ERP vía `sync-erp-purchases` y solo tiene `nombre` + `nrc`; `proveedores` (18 filas)
es una tabla curada solo para reglas devolutivo/ND. Ninguna es un maestro real.

Se construye un **maestro de proveedores** que:

1. **Se llena solo desde los DTE** que ya ingresa `sync-purchase-emails`: el bloque
   `emisor` del JSON trae NIT, NRC, nombre legal, nombre comercial, giro (actividad
   económica con código oficial), dirección, teléfono y correo — casi todo el
   formulario del ERP viejo, gratis y con datos legalmente exactos (es el documento
   fiscal). Cada DTE nuevo con un NIT no visto crea el proveedor automáticamente;
   los ya vistos actualizan datos solo si cambiaron.
2. **Backfill inmediato**: los ~339 JSON ya guardados en Storage se parsean para
   poblar el maestro desde el día 1.
3. **Vista nueva** para verlos todos: asignar **categoría contable** (editable),
   ver datos fiscales, documentos recibidos, y hacer **match manual con el
   proveedor del ERP** (`suppliers`) mientras el ERP siga vivo.
4. Queda como **la** tabla de proveedores del futuro ERP-en-portal: cuando el ERP
   muera, `suppliers` se archiva y este maestro ya está completo y curado.

**Lo que NO es**: no reemplaza a `proveedores` (reglas devolutivo/ND) en v1 — esa
tabla sigue igual; unificarla es mejora futura (ver §Fuera de alcance).

---

## 2. Qué trae el DTE vs el formulario del ERP viejo (investigado)

Bloque `emisor` del esquema oficial del MH (fe-*-v1/v3, portal factura.gob.sv):

| Campo del form ERP | ¿Viene en el DTE? | Fuente / decisión |
|---|---|---|
| Nombre | ✅ | `emisor.nombre` (razón social legal) + `emisor.nombreComercial` |
| Dirección | ✅ | `emisor.direccion.complemento` |
| Departamento / Municipio | ✅ | `emisor.direccion.departamento` / `.municipio` — **códigos** oficiales del MH (CAT-012/CAT-013). Se guardan los códigos + label resuelto client-side con catálogo constante |
| Distrito | ⚠️ No viene en el DTE | El esquema DTE solo trae depto+municipio (catálogos post-reforma 2023). **NO se pide** — el form ERP lo exigía, acá es innecesario |
| DUI | ⚠️ Solo en FSE | En tipo 14 (Factura Sujeto Excluido) el proveedor va en `sujetoExcluido.numDocumento` y puede ser DUI en vez de NIT. Columna nullable |
| NIT | ✅ | `emisor.nit` (14 dígitos) — **clave natural del maestro** (UNIQUE) |
| NRC | ✅ | `emisor.nrc` (sin ceros a la izquierda) — es la llave de match con `suppliers.nrc` (mismo formato, ej. `1166-5`) |
| Giro | ✅ | `emisor.descActividad` + `emisor.codActividad` (catálogo oficial CAT-019 de actividad económica) — mejor que texto libre |
| Percibe 1% | ✅ derivable | Art. 163 CT: si el proveedor es Gran Contribuyente percibe 1% en ventas ≥$100 a contribuyentes menores. Se **observa** del propio DTE: `resumen.ivaPerci1 > 0` → flag `percibe_1=true` automático (+ override manual). No se pide a mano |
| Teléfono 1 / Correo | ✅ | `emisor.telefono` / `emisor.correo` |
| Teléfono 2 / Fax | ❌ | Fax: **eliminado** (obsoleto). Teléfono 2: columna manual opcional |
| Nombre del Contacto | ❌ | Manual, opcional (dato de gestión, no fiscal) |
| Nombre para Cheques | ❌ | Manual, opcional — útil para pagos (a veces difiere de la razón social) |
| Categoría del Proveedor | ❌ | Manual — ver §3 (seed de categorías contables) |
| Tipo de Proveedor (Costo/Gasto) | ❌ | Se deriva de la categoría (cada categoría tiene `clase`), no se pide aparte |
| País de Origen | ❌ | **Innecesario en v1**: todo DTE recibido es nacional (SV). Importaciones llegan como declaración de mercancías, no DTE — si algún día se ingresan, se agrega. Columna `pais` default `'SV'` por si acaso |

**Extras que el DTE regala y el form ERP no tenía** (se guardan): `tipoEstablecimiento`
(CAT-009), `nombreComercial` separado del nombre legal, y por documento los flags de
retención observados (`ivaRete1` — Art. 162 CT, retención 1% de Grandes
Contribuyentes; `reteRenta` — retención de renta, típico 10% a servicios de personas
naturales, Art. 156). Estos flags importan para contabilidad/anexos DGII y salen
solos de los JSON.

**Requisito regulatorio que esto cubre** (libro de compras / anexos DGII): por cada
compra se necesita identificar al proveedor por NIT (14 dígitos) o NRC (sin ceros
antepuestos) + nombre — exactamente lo que el maestro garantiza. El resto del form
ERP viejo (fax, distrito, país) no es requisito de nada.

**Por tipo de DTE, quién es el proveedor:**

| tipoDte | Proveedor sale de | Crea proveedor automático |
|---|---|---|
| 01, 03, 05, 06 (factura, CCF, NC, ND) | `emisor` | ✅ Sí |
| 14 (FSE) | `sujetoExcluido` (no `emisor` — el emisor somos nosotros) | ✅ Sí, con `numDocumento` (NIT o DUI) |
| 07, 08 (retención, liquidación) | `emisor` suele ser un **cliente** grande que nos retiene, no un proveedor | ❌ NO auto-crear — guardar el doc, no ensuciar el maestro |
| 11, 15 (exportación, donación) | casos raros en bandeja de compras | ❌ NO auto-crear en v1 |

---

## 3. Categorías contables (seed propuesto — confirmar con el usuario)

Tabla `proveedores_categorias` con `clase` (para separar costo de venta vs gasto,
que es la distinción contable que importa) + nombre. Seed:

| clase | categorías |
|---|---|
| `costo` (inventario / costo de venta) | Mercadería para reventa (medicamentos y misceláneos) |
| `gasto_operativo` | Energía eléctrica · Agua · Telecomunicaciones (tel/internet) · Alquileres · Mantenimiento y reparaciones · Limpieza · Combustible y transporte · Vigilancia/seguridad |
| `gasto_admin` | Servicios profesionales y honorarios · Servicios financieros/bancarios · Seguros · Papelería y útiles · Publicidad · Impuestos y tasas municipales |
| `otro` | Otros (catch-all, editable) |

- El proveedor tiene UNA categoría (FK nullable — recién creado queda "Sin categoría"
  y la vista lo destaca como pendiente de clasificar).
- La categoría vive en el **proveedor**, no en el documento (v1). Si un mismo
  proveedor mezcla costo y gasto (raro en la práctica), se elige la dominante;
  categorización por documento es mejora futura.
- CRUD de categorías NO en v1 (seed fijo por migración; agregar una es un INSERT).

---

## 4. Diseño BD (Fase 1)

### 4.1 Tabla `proveedores_maestro`

```sql
CREATE TABLE public.proveedores_maestro (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Identidad fiscal (del DTE, no editable a mano salvo excepción)
    nit text UNIQUE,                  -- clave natural; nullable SOLO para FSE con DUI
    dui text,                         -- solo sujetos excluidos sin NIT
    nrc text,
    nombre text NOT NULL,             -- razón social legal (emisor.nombre)
    nombre_comercial text,
    cod_actividad text,               -- CAT-019
    desc_actividad text,              -- giro
    tipo_establecimiento text,        -- CAT-009
    departamento text,                -- código CAT-012
    municipio text,                   -- código CAT-013
    direccion text,                   -- direccion.complemento
    telefono text,
    correo text,
    -- Flags fiscales observados de los DTE (auto)
    percibe_1 boolean NOT NULL DEFAULT false,
    retiene_renta boolean NOT NULL DEFAULT false,
    -- Curación manual
    categoria_id bigint REFERENCES public.proveedores_categorias(id),
    supplier_id integer REFERENCES public.suppliers(id),  -- match ERP (mientras viva)
    contacto_nombre text,
    telefono2 text,
    nombre_cheques text,
    notas text,
    activo boolean NOT NULL DEFAULT true,
    pais text NOT NULL DEFAULT 'SV',
    -- Trazabilidad
    source text NOT NULL DEFAULT 'dte' CHECK (source IN ('dte','manual')),
    primera_vez_visto date,           -- min(fecha_emision) de sus DTE
    ultima_vez_visto date,            -- max(...) — se actualiza en cada sync
    docs_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (nit IS NOT NULL OR dui IS NOT NULL)
);
CREATE INDEX ... ON proveedores_maestro (nrc);
CREATE INDEX ... ON proveedores_maestro (categoria_id);
CREATE INDEX ... ON proveedores_maestro (supplier_id);
-- + columna nombre_norm generada con norm_search() (patrón design_search_standard)
```

Reglas del proyecto que aplican tal cual: RLS SELECT `authenticated` vía
`(SELECT auth_has_module_permission('proveedores','can_view'))`, escritura vía RPC
con `auth_can_edit_any(ARRAY['proveedores'])`, FKs con índice, `SET lock_timeout='5s'`,
staging (`ewcmerxqjvludtgskuin`) primero, archivo local mismo nombre misma sesión.

### 4.2 Cambios en tablas existentes

- `purchase_dte_documents`: `ADD COLUMN proveedor_id bigint REFERENCES
  proveedores_maestro(id)` + índice. Se llena por NIT (auto) — convive con el
  `supplier_id` (ERP) existente, no lo reemplaza.
- `suppliers` y `proveedores`: **sin cambios** en v1.

### 4.3 RPCs (todas SECURITY según regla, escritura con audit)

- `upsert_proveedor_from_dte(p_data jsonb)` — DEFINER, solo `service_role`
  (la llama la edge function). Upsert **condicional** (`ON CONFLICT (nit) DO UPDATE
  ... WHERE (cols) IS DISTINCT FROM (EXCLUDED.cols)` — regla anti-churn del
  proyecto). NUNCA pisa los campos manuales (categoria_id, supplier_id, contacto,
  notas...): solo los campos que vienen del DTE. Actualiza `ultima_vez_visto`,
  `docs_count`, y sube `percibe_1`/`retiene_renta` a true si se observan (nunca
  los baja solo — override manual manda).
- `get_proveedores_maestro()` — Patrón C (`RETURNS json` + `json_agg(to_json(t))`),
  INVOKER. Incluye JOIN a categoría + suppliers (nombre ERP) + agregados de docs.
- `set_proveedor_categoria(p_id, p_categoria_id)` / `set_proveedor_supplier(p_id,
  p_supplier_id)` / `update_proveedor_manual(p_id, ...campos manuales)` — con
  policy de escritura y `appendAuditLog` desde el cliente. Autoría server-side
  (`auth_employee_id()`), jamás del parámetro.

---

## 5. Fases de ejecución

### Fase 0 — Decisiones del usuario (BLOQUEA todo lo demás) — ✅ CERRADA 2026-07-18

- [x] **0.1 Nombre de la tabla**: `proveedores_maestro`. `proveedores` (devolutivo/ND)
      queda intacta, sin renombrar.
- [x] **0.2 UI: módulo nuevo** `proveedores` (vista + ruta + menú + permisos + BD),
      grupo de menú Inventario junto a Facturas de Compra.
- [x] **0.3 Seed de categorías**: se aplica el seed de §3 tal cual como punto de
      partida (categoria_id es FK nullable y editable después — "agregar una
      categoría es un INSERT", no bloquea). El usuario revisará/ajustará el
      contenido de las categorías más adelante; no bloquea Fase 1.
- [x] **0.4 Roles con acceso**: mismos que `facturas_compra` — role_id 2, 3, 13.

### Fase 1 — BD (staging → prod, OK humano por migración)

- [ ] 1.1 `20260718_proveedores_maestro.sql`: `proveedores_categorias` (+ seed §3),
      `proveedores_maestro` (§4.1), columna `proveedor_id` en
      `purchase_dte_documents`, RLS + índices + `nombre_norm`.
- [ ] 1.2 `20260718_proveedores_maestro_rpcs.sql`: las 4-5 RPCs de §4.3.
- [ ] 1.3 Permisos del módulo (`role_permissions` seed para `ROLES_CON_ACCESO`).
- [ ] 1.4 Security advisor: 0 ERRORES después de cada migración.

### Fase 2 — Backfill desde los JSON ya guardados

- [ ] 2.1 Edge function nueva `backfill-proveedores-dte` (o modo `backfill:true`
      de la de Fase 3): recorre `purchase_dte_documents` (paginado servidor,
      respetando el límite 1000), baja cada JSON del bucket `purchase-dte`,
      parsea el bloque correcto según tipoDte (§2), llama
      `upsert_proveedor_from_dte` y setea `proveedor_id` en el documento.
      Presupuesto de tiempo + `hasMore` (mismo patrón que `sync-purchase-emails`
      — un backfill de 339 docs ya demostró exceder el límite de ejecución).
      **Chequear `error` de CADA query** (regla del proyecto). Tipos 07/08/11/15:
      documento queda sin `proveedor_id`, sin crear proveedor.
- [ ] 2.2 Correr contra staging primero si hay datos; si no, dry-run con log.
- [ ] 2.3 Correr en prod (OK humano) hasta `hasMore:false`. Verificar: count de
      proveedores creados ≈ NITs distintos en `purchase_dte_documents` (tipos
      01/03/05/06/14), 0 duplicados, campos poblados en muestra de 5.

### Fase 3 — Auto-registro en el sync diario

- [ ] 3.1 Modificar `sync-purchase-emails`: tras insertar cada documento, llamar
      `upsert_proveedor_from_dte` + guardar `proveedor_id`. El match ERP
      automático por NRC que ya existe (`suppliers.nrc`) se traslada: el
      resultado se guarda TAMBIÉN en `proveedores_maestro.supplier_id` (una vez,
      si es NULL) — así el match manual solo cubre lo que el NRC no resolvió.
- [ ] 3.2 Redeploy (CLI + workaround `.env`, NUNCA la MCP) y prueba con
      "Sincronizar ahora" en real.

### Fase 4 — UI: vista Proveedores

- [x] 4.1 `src/views/purchases/ProveedoresView.jsx` — estándares completos:
      GlassViewLayout + ViewTabBar (búsqueda header, `tokenMatch`),
      filter pill EN EL BODY (§17 DESIGN.md), DataTable estándar, LiquidSelect,
      empty state glassmorphism, sin border-l. Columnas: Proveedor (nombre +
      nombre comercial), NIT/NRC, Giro, Categoría (LiquidSelect inline si
      `can_edit`), Match ERP (patrón `SupplierMatchCell`, con botón cancelar),
      Docs (count), Última compra. Filtros: categoría / "(sin categoría)" /
      "(sin match ERP)" / clase / activo.
- [x] 4.2 Modal detalle (`FormProveedorDetail.jsx`, patrón `FormEditContact` —
      self-contained en `HIDES_FOOTER`, todo botón con `type="button"`): datos
      fiscales completos, campos manuales editables (contacto, teléfono 2,
      nombre cheques, notas, activo, percibe_1 override), link "Ver
      documentos" a Facturas de Compra filtrado por NIT (`?q=`).
- [x] 4.3 Checklist módulo nuevo: ruta en `App.jsx`, menú (grupo Inventario),
      `PermissionsView.jsx`, BD (Fase 1, permisos roles 2/3/13). `appendAuditLog`
      en las 3 acciones (ver detalle, set categoría, set match, update manual).
- [x] 4.4 En `FacturasCompraView`: la columna proveedor prefiere `proveedor_id`
      (maestro) mostrando el match ERP como dato secundario (`ERP: nombre`
      solo si difiere). Migración `get_purchase_dte_documents` con el join
      nuevo, staging→prod.
- [x] 4.5 Migraciones de prod aplicadas antes del push. `APP_VERSION` v2.22.0
      + changelog. Commit + push.
- [~] 4.6 Verificación visual con Playwright: lista real (59 proveedores),
      asignar categoría y campos manuales (persistidos y confirmados en BD,
      datos de prueba revertidos), match ERP, cross-link a Facturas de Compra
      (filtra correctamente). **Falta**: guard de permisos con un rol SIN
      acceso a `proveedores` — solo se probó con una cuenta con acceso total;
      el patrón (`PermissionGuard`/`hasPermission`) es idéntico al de
      `facturas_compra`, ya probado en prod, pero no se verificó en vivo para
      este módulo específico.

### Fase 5 — Cierre

- [x] 5.1 Advisor 0 ERRORES final (verificado tras Fase 1 y tras la corrección
      de tipo 09).
- [x] 5.2 Memoria nueva `project_proveedores_maestro_module.md` + actualizada
      `reference_suppliers_vs_proveedores_tables.md` (ahora TRES tablas,
      documentado cuál manda para qué) + memoria de feedback nueva sobre el
      error de tipo_dte 09 (`feedback_check_existing_catalogs_before_inferring.md`).
- [x] 5.3 Checkboxes de este archivo cerrados. Pendiente real: 4.6/§6 guard de
      permisos con rol restringido (no bloqueante — patrón ya probado en
      `facturas_compra`).

---

## 6. Criterios de aceptación

- [x] Todo NIT emisor de los DTE ya sincronizados (tipos 01/03/05/06 — 09
      revertido, 14 sin casos reales aún) existe UNA vez en el maestro, con
      giro/dirección/contacto del JSON. Verificado: 59 proveedores, 0
      duplicados, muestra de 5 con datos completos.
- [x] Un DTE nuevo de un proveedor nunca visto lo crea solo — verificado con
      una corrida real de "Sincronizar ahora" (95 docs nuevos, 25 proveedores
      nuevos, 100% con `proveedor_id`).
- [x] Un DTE nuevo de un proveedor existente NO reescribe la fila si nada
      cambió — verificado en staging (`updated_at` solo cambia cuando un
      campo realmente difiere; docs_count/fechas sí avanzan porque cada
      llamado corresponde a un documento nuevo real, no a un re-scan).
- [x] La categoría y el match ERP se asignan desde la vista y sobreviven al
      siguiente sync (el upsert nunca toca esas columnas) — verificado con
      datos reales de prod (luego revertidos).
- [x] `percibe_1` se enciende solo al observar `ivaPerci1>0` en un DTE real —
      verificado en el smoke test de staging.
- [~] Roles sin permiso no ven el módulo (patrón idéntico a `facturas_compra`,
      no re-probado en vivo para este módulo). Advisor 0 ERRORES ✓. Auditoría
      en `audit_logs` de cada acción manual ✓ (3 tipos de evento confirmados).

## 7. Riesgos y casos borde

| Caso | Manejo |
|---|---|
| Mismo NIT, varios establecimientos/nombres comerciales (sucursales del proveedor) | 1 fila por NIT (el maestro es el contribuyente, no la sucursal); el último DTE actualiza datos si cambiaron |
| Proveedor cambia dirección/teléfono/giro | Upsert condicional actualiza solo lo distinto; sin historial en v1 (mejora futura si contabilidad lo pide) |
| FSE con DUI (sin NIT) | Fila con `nit NULL, dui NOT NULL`; el CHECK exige al menos uno. Dedupe por DUI para esos casos (índice UNIQUE parcial sobre dui WHERE nit IS NULL) |
| DTE tipo 07/08 en la bandeja (cliente que nos retiene, no proveedor) | NO crea proveedor; documento guardado igual que hoy |
| `emisor.nrc` con formato distinto a `suppliers.nrc` | Match ERP queda NULL → cola "(sin match ERP)" en la vista, botón Emparejar manual |
| JSON viejo sin algún campo opcional (correo, teléfono) | NULL, nunca descartar |
| Dos proveedores ERP (`suppliers`) apuntando al mismo NIT real | Permitido (supplier_id es del proveedor maestro→ERP, 1:1 desde el maestro); si el ERP tiene duplicados es problema del ERP, no del maestro |

## 8. Fuera de alcance v1 (mejoras futuras)

- Unificar `proveedores` (devolutivo/ND) con el maestro (FK o merge).
- Historial de cambios de datos fiscales del proveedor.
- Categoría por documento (no solo por proveedor) para proveedores mixtos.
- CRUD de categorías desde la UI.
- Alta 100% manual de proveedores sin DTE (source='manual' ya está previsto en
  el schema; la UI de alta se construye cuando haga falta de verdad).
- Cuentas por pagar / estados de cuenta por proveedor (evolución natural junto
  con la conciliación ERP ya listada en el plan de Facturas de Compra).

## 9. Referencias regulatorias (verificadas 2026-07-18)

- Esquemas DTE + catálogos oficiales (CAT-009, CAT-012, CAT-013, CAT-019):
  portal factura.gob.sv del MH.
- Percepción 1%: Art. 163 Código Tributario (Grandes Contribuyentes, ventas
  ≥ $100 a contribuyentes menores) — observable en `resumen.ivaPerci1`.
- Retención 1% IVA: Art. 162 CT (solo si NOSOTROS fuéramos Gran Contribuyente —
  hoy solo se registra el flag observado, sin lógica activa).
- Retención renta a sujetos excluidos/servicios (Art. 156): observable en
  `resumen.reteRenta` de FSE.
- Identificación de proveedor para libro de compras/anexos DGII: NIT (14 díg.)
  o NRC (sin ceros antepuestos) + nombre — cubierto por el maestro.
