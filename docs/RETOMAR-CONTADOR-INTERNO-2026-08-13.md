# Retomar — contador interno, 2026-08-13

Estado al cierre del **2026-08-13**. **Empezar por acá.** El plan completo está en
`PLAN-CONTADOR-INTERNO-2026-08-12.md` y el porqué en
`AUDITORIA-CONTABLE-COMPLETA-2026-08-12.md`.

---

## Prompt para arrancar

```
Seguimos con el contador interno. Leé docs/RETOMAR-CONTADOR-INTERNO-2026-08-13.md.

Los pasos 1, 2 y 3 del plan están construidos y desplegados. Lo que falta se
divide en dos: decisiones de la contadora (método de costeo, 26 clasificaciones,
Art. 156) y los pasos 4-6, que están bloqueados por el costo de venta histórico.

Empezá preguntando cuál de las decisiones ya se tomó.
```

---

## Remedido contra producción — 2026-08-24

**Once días y ninguno de los cinco números se movió.** Todos dependen de la misma
firma que no llegó.

| | 2026-08-13 | 2026-08-24 |
|---|---:|---:|
| líneas de venta **sin costo** | 585,044 | **585,341** de 609,431 (96%) |
| períodos fiscales **cerrados** | 0 | **0** |
| proveedores con clasificación **confirmada** | 77 | **77** (86 pendientes de 163) |
| proveedores marcados para **Art. 156** | 0 | **0** |
| proveedores con **plazo de crédito** cargado | — | **0** de 163 |

**El método de costeo sigue siendo el único nudo.** Sin él no hay paso 4
completo (el Art. 142-A exige el importe de lo que sale), no hay paso 6 (no hay
Estado de Resultados) y no hay contabilidad formal. Las 24,090 líneas que sí
tienen costo son las que lo traen del sync desde que se puso la columna, no
histórico reconstruido: `reconstruir_costo_de_venta` **sigue sin correr**.

Y el plazo de los 163 proveedores está en **cero filas**, así que las cuentas por
pagar no pueden calcular ni una fecha de vencimiento.

---

## El estado del plan, medido el 2026-08-13 al cierre

| paso | estado | qué falta |
|---|---|---|
| **1 · Clasificación fiscal** | ✅ construido | **77 confirmadas**, faltan **26** ($594 + $734 trabados) |
| **2 · Libro declarable** | ✅ construido, con pestaña | nada de sistema |
| **3 · Cierre de período** | ✅ construido, con pantalla | **0 períodos cerrados** — lo hace el contador |
| **4 · Registro Art. 142-A** | ⚠️ ~80% | correlativo, encabezado, saldo corrido y **costo de salida** |
| **5 · Planilla y gastos** | ❌ | `payroll_entries`, `payroll_periods`, `branch_expenses` en **0 filas** |
| **6 · Contabilidad formal** | ❌ | **0 tablas**. No arranca sin el 4 y el 5 |

### Todo lo de abajo converge en UNA decisión

**585,044 líneas de venta sin costo** y **0 reconstruidas**. La herramienta está
lista y es reversible (`costo_origen`), pero el método —última compra, promedio
ponderado o PEPS— lo elige la contadora, y sobre quince meses mueve el Estado de
Resultados entero.

Sin costo de venta no hay paso 4 completo (el Art. 142-A exige el «importe de las
que salen») ni paso 6 (no hay Estado de Resultados que emitir). O sea que **una
sola firma destraba los tres pasos que faltan.**

### Lo desplegado hoy

| versión | qué |
|---|---|
| v2.586.0 | Revisión de deducibilidad **por regla** |
| v2.590.0 | Libro **declarable** + su pestaña |
| v2.590.1 | Abrir el documento desde el libro |
| v2.590.3/4 | El IVA del CCF sale del documento, regla en un solo lugar |
| v2.591.0 | **Cierre de período** con pantalla |
| — | El historial de precios y su changelog volvieron a escribirse |
| — | `costo_origen` + `reconstruir_costo_de_venta` (sin correr) |

Migraciones: `20260813160047`, `164142`, `164845`, `165542`, `170912`, `172355`,
`174131`, `175718`, `180115`. Todas registradas, los dos gates en verde.

**El portal lleva la contabilidad desde julio 2026** (`contabilidad_config`).
Mayo y junio se declararon por fuera y el cierre los rechaza.

### Decisiones abiertas, ninguna de sistema

1. **El método de costeo.** Destraba los pasos 4, 5 y 6.
2. **Las 26 clasificaciones** que la ley condiciona — $594, más $734 trabados que
   la pantalla ya muestra con precio puesto.
3. **Los $262.52 del Art. 156.** 0 marcados de 99. El Contador Externo ya tiene
   permiso para hacerlo desde la ficha.
4. **Con qué libro se cierra julio**: $112.55 de remanente con el de hoy,
   $1,302.31 con el declarable.
5. Las cinco preguntas de más abajo.

### Cabos sueltos anotados y no cerrados

- **`generar_csv_libro` con sucursal NULL devuelve cero filas en silencio** —
  hallazgo 3.9, abierto desde el 12-08. Mismo patrón que apareció tres veces hoy.
- **La maqueta de «Aceptar sugerencia» por tarjeta** — 4 proveedores en 3
  categorías; hay que mostrarla antes de tocar código.
- **Tres columnas muertas**: `conteo_inventario_items.fisico_cantidad`,
  `sales_invoice_items.id_presentacion` (con un índice de un solo uso en su vida)
  y `audit_logs.device_name`. Nadie las lee — limpieza, no urgencia.

---

## Auditoría — qué información del proveedor exige la ley (2026-08-13)

Medida sobre los **99 proveedores con documentos** (los otros 63 nunca facturaron).

### Completo, sin un solo hueco

| dato | para qué lo exige la ley | huecos |
|---|---|---|
| NIT | Art. 114 CT (el CCF) · anexo F-07 | 0 de 99 |
| NRC | decide si el documento da crédito fiscal (Art. 65 LIVA / Art. 119 CT) | 0 de 99 |
| Nombre | Art. 141 CT, libro de compras | 0 de 99 |
| Giro y código de actividad | Art. 114 CT · es lo que deriva el Art. 65 | 0 de 99 |
| Dirección, departamento, municipio | Art. 114 CT | 0 de 99 |
| Percepción 1% | Art. 163 CT | 0 de 99 (24 percibien) |

Los 59 sin giro son fichas que nunca recibieron documento: **un** documento entre
las 59, $7.94. No es deuda de datos.

### El hueco NO es un dato faltante: es una decisión que nadie tomó

**`retiene_renta` está en `false` en los 99.** El Art. 156 CT obliga a retener el
**10% de Renta** al pagarle a una **persona natural** por un servicio. Y esto no
es crédito fiscal que se pierde: **si no se retiene, la empresa responde
solidariamente por el impuesto más la multa.** Es una deuda que aparece.

La herramienta existe desde el 2026-08-03 (`get_candidatos_retencion_renta`,
migración `20260803000221`) y **diez días después no hay una sola marca**. Su
lógica da 16 candidatos; dos son falsos positivos conocidos (ANA FRANCISCA
CEDILLOS vende mercadería; ANDA no es persona natural). Los dos que aplican con
claridad son alquileres:

| | base sin IVA | 10% a retener |
|---|---|---|
| OMAR ARNULFO SERRANO CRESPIN — alquiler del local | $2,600.00 | **$260.00** |
| LEMUS DE ALVARENGA, DIGNA AMERICA — alquiler | $25.20 | $2.52 |

### Dos cosas que la ficha no puede saber

- **No hay columna de tamaño de contribuyente** (verificado: cero columnas
  gran/mediano/pequeño). Sin eso el **Art. 162** —retención de IVA del 1%— no se
  decide por dato: sólo se sabe quién nos *percibe*, no a quién habría que
  *retener*.
- **Persona natural vs jurídica se infiere, no se sabe.** La función lo deduce del
  NIT de 9 dígitos, del DUI o del nombre. Los 99 tienen NIT y **ninguno tiene
  DUI**, así que en la práctica decide el nombre — por eso se cuelan ANDA y las
  sociedades escritas «S. A. DE C. V.» con espacios.

---

## Permisos: el Contador Externo ya entra

Hasta hoy el rol **no tenía `proveedores` en absoluto** — o sea que la pantalla
construida para el contador era invisible para el rol «Contador Externo». Se le
concedió `can_view` **y `can_edit`** (autorizado por el usuario el 2026-08-13),
que es lo que necesitan los dos RPC de escritura y el `retiene_renta` de la ficha.

Consecuencia deliberada: como el RPC de lectura es DEFINER, el contador ve el
crédito fiscal aunque tenga `facturas_compra_ver_montos = false`. Es consistente
— ya ve esa misma plata en `libros_iva_ver_montos` y
`libro_compras_completo_ver_montos`, los dos en `true`.

---

## Lo que sigue

Los pasos 2 y 3 quedaron construidos el 2026-08-13 — lo que decía esta sección
antes (que estaban pendientes) ya no vale. El estado real está arriba, en «El
estado del plan».

### Costo de venta — la cifra del plan estaba mal encuadrada (medido 2026-08-13)

El plan del 12-08 dice «las 6,436 líneas del 1 al 4 de agosto sin costo», y ese
recorte es arbitrario. Medido por día:

```
  2026-07-31   1,390 líneas   1,390 sin costo
  2026-08-04   1,354          1,354
  2026-08-05   1,229          1,043   ← empieza a registrarse
  2026-08-06   1,052             26
```

El costo arrancó el **2026-08-05**; todo lo anterior está igual de vacío. El
hueco real es **585,040 líneas, del 2025-05-01 al 2026-08-04** — quince meses,
no cuatro días.

**Y `product_precios` NO es la fuente.** Hay una decisión escrita el 2026-08-06
(`20260806004055_e1_no_estampar_costo_sobre_ventas_viejas`): el trigger se niega
a estampar costo en ventas de más de 15 días porque *«un dato inventado que se
lee como medido es peor que un NULL»*. Rellenar quince meses con la lista de hoy
es exactamente lo que esa migración prohíbe.

`product_precios_history` tampoco sirve: **`costo` está NULL en sus 26,739
filas** y la tabla dejó de recibir versiones el 2026-06-03.

**La fuente que sí sirve son las compras reales.** `purchase_receipt_items` +
`purchase_receipts.fecha` cubren **2025-05-01 → 2026-08-13**, el mismo rango que
las ventas sin costo, y comparten `erp_product_id`. Medido:

| | líneas | con compra previa | ≤30 días | mediana |
|---|---|---|---|---|
| **total sin costo** | 585,040 | **545,865 (93.3%)** | — | — |
| muestra 2025-06 | 36,777 | 31,179 (84.8%) | 29,979 | **9 días** |
| muestra 2026-07 | 40,046 | 39,904 (99.6%) | 34,755 | **9 días** |

O sea que el costo reconstruido sería **el precio de una compra real hecha en
promedio 9 días antes de la venta**, no una estimación. 2025-06 es más flojo
porque las compras empiezan el 2025-05-01 y sólo había un mes acumulado.

Lo que queda fuera: **5,434 líneas** de productos sin ninguna compra registrada,
y **33,741** vendidas antes de la primera compra de ese producto.

**Antes de implementarlo hay que decidir dos cosas**, y ninguna es técnica:

1. **Un costo reconstruido y uno capturado no pueden verse iguales.** Hoy
   `costo_unitario` no dice de dónde salió. Hace falta una columna de procedencia
   (`lista` / `compras` / NULL) o se repite el problema que la migración del 06-08
   evitó — sólo que ahora con 545,865 filas.
2. **Qué método contable.** Costo de la última compra anterior es lo que se midió
   acá; promedio ponderado y PEPS dan otro número. Es decisión de la contadora, y
   cambia el Estado de Resultados de quince meses.

**Pendiente de diseño, con maqueta antes de tocar código:** mover «Aceptar
sugerencia» del listado a tarjetas por categoría sugerida. Son **4 proveedores en
3 categorías** (medido: de los 94 sin categoría, sólo 4 tienen sugerencia), y con
eso los checkboxes del listado quedarían sirviendo a una sola acción —«Asignar
categoría», que sí tiene volumen real (90 proveedores)—. La selección por fila es
**el único caso del proyecto**: los otros 8 archivos que importan `Checkbox` lo
usan como campo de formulario, no como selector de filas.

---

## Las cinco preguntas para la contadora

Ninguna es de sistema y las cinco cambian el resultado.

1. **Las 36 fichas condicionadas** (combustible, ferretería, alimentos, cómputo):
   ¿cuáles aplican? Es la única entrada humana del paso 1, y hoy la pantalla ya la
   pide en 5 preguntas en vez de 36 fichas.
2. **Junio se pagó $1,077.16 que no correspondía** — reconstruido con los
   documentos completos daba **−$506.14**, o sea remanente a favor y cero a
   pagar. ¿Se presentan modificatorias? Art. 104 CT: 2 años, verificación de
   auditores, y no surten efecto hasta que Hacienda se pronuncie.
3. **La percepción anterior a junio-2026** (~$12,000 estimados). La prueba es
   LETERAGO: 0 de 56 documentos con percepción en 9 meses y 1.000% exacto desde
   junio — no dejaron de percibir, el campo no se leía.
4. **La base del pago a cuenta**: declaró $3,991.48 en junio y el 1.75% de las
   ventas da $3,484.93 por las dos fuentes. Hace falta su papel de trabajo.
5. **¿Se presentan el F-983 y el F-987?** La empresa cruza el umbral de los
   Arts. 125 y 142 CT con holgura.

**Sexta, nueva:** los **$262.52 del Art. 156** de arriba. ¿Se marcan y se
declaran, o hay algo en esos alquileres que lo excluya?

---

## Trampas de esta sesión, para no volver a pisarlas

- **Un RPC con `auth_has_module_permission` dentro del `WHERE` devuelve CERO
  FILAS, sin error, desde una sesión que no es de un empleado.** Pasó al auditar
  `get_candidatos_retencion_renta`: dio 0 candidatos y casi se reporta como «no
  hay». Para auditar esas funciones hay que ir a las tablas base. El RPC nuevo de
  hoy lanza `FORBIDDEN` en vez de fingir un cero, justamente por esto.
- **Dos tablas del mismo circuito pueden pedir módulos distintos.**
  `proveedores_maestro` → `proveedores`; `purchase_dte_documents` →
  `facturas_compra`. Cruzarlas en un INVOKER produce ceros silenciosos.
- **El `.env` del repo rompe el parser del CLI de Supabase** (`client-gmail1`
  tiene un guión). La salida limpia es un workdir aislado con
  `supabase/config.toml` y `supabase/.temp/` copiados — así no hay que mover el
  `.env`, que es lo que otras sesiones pueden estar usando.
- **`generar_csv_libro` con `p_branch_id => NULL` devuelve cero filas en
  silencio** — el filtro es `branch_id = p_branch_id`. Hallazgo 3.9 de la
  auditoría, sigue abierto.
- **Compilar y pasar los gates no prueba lo que se ve.** «Revisar uno por uno» se
  cayó en una reescritura del componente: build en verde, eslint en verde, gate de
  diseño en verde, y el botón no existía. Lo encontró abrir la pantalla.
- **Commitear no despliega.** Vercel despliega en el push.
