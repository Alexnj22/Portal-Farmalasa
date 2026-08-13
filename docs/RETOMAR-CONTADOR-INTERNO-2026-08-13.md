# Retomar — contador interno, 2026-08-13

Estado al cierre del **2026-08-13**. **Empezar por acá.** El plan completo está en
`PLAN-CONTADOR-INTERNO-2026-08-12.md` y el porqué en
`AUDITORIA-CONTABLE-COMPLETA-2026-08-12.md`.

---

## Prompt para arrancar

```
Seguimos con el contador interno. Leé docs/RETOMAR-CONTADOR-INTERNO-2026-08-13.md.

El paso 1 está cerrado: la revisión de deducibilidad por regla está desplegada
(v2.586.0) y el Contador Externo ya tiene acceso. Falta que alguien confirme las
12 decisiones.

Lo que sigue es el paso 2 —el libro de compras unificado, +$5,900 entre junio y
julio— y las 6,436 líneas de venta sin costo del 1 al 4 de agosto, que tienen
reloj.
```

---

## Lo que quedó hecho y desplegado

| versión | qué | estado |
|---|---|---|
| v2.583.0 | Columnas de clasificación fiscal + la propuesta derivada del CIIU | en prod |
| v2.584.0 | Los 3 RPC + sección en la ficha + filtro + confirmación en tanda | en prod |
| **v2.586.0** | **La revisión POR REGLA** — pestaña nueva, columna «IVA», y fuera el botón a ciegas | **en prod** |

Migraciones aplicadas y registradas: `20260813041109`, `20260813042113`,
**`20260813160047`**. Los dos gates de migraciones en verde, incluido `--remote`.
Pusheado a `main` (`d8f8de74`) y desplegado.

**Verificado en el navegador** con la cuenta QA, no sólo compilado: los montos en
pantalla coinciden con la consulta SQL al centavo, el flujo Sí/No revela los tres
campos del anexo, «Revisar uno por uno» abre la lista, y cero errores de página.

---

## El paso 1 quedó cerrado, y así se rehizo

La pantalla de la v2.584.0 pedía confirmar 67 propuestas que no estaban en
pantalla. **El error era de encuadre, no de detalle.** Medido contra producción,
las 162 fichas sin confirmar caen en **12 reglas**:

| | reglas | proveedores | crédito fiscal |
|---|---|---|---|
| Propuestas del sistema | 7 | 67 | **$56,504.16** |
| Las que la ley condiciona | 5 | 36 | **$3,220.83** |
| Sin giro registrado | — | 59 | $7.94 |

Una sola regla —mercadería, Art. 65 nº1— cubre 52 proveedores y el **93%** de la
plata. Los 59 sin giro tienen **un documento entre todos**.

Tres decisiones de diseño que conviene no deshacer:

1. **Las tarjetas se ordenan por crédito fiscal, no por documentos.** Ordenar por
   conteo engaña: comisiones bancarias tiene **190 documentos y $81.82** (a $0.43
   cada una) mientras el alquiler tiene **7 documentos y $341.30**.
2. **Cada condicionada nombra a su peso pesado.** En alimentos, STEINER es
   $1,932.72 de los $2,626.15 — el **74%**. Quien decide el grupo está decidiendo
   sobre todo a ese proveedor y tiene que saberlo antes de apretar.
3. **«Giro demasiado genérico» no ofrece Sí/No.** Junta hospitales, televisión y
   «servicios n.c.p.»: seis casos distintos no comparten una respuesta. Manda a
   revisarlos uno por uno. Fingir lo contrario sería el error de la v2.584.0 en
   chico.

### La trampa que casi se repite, y cómo quedó cerrada

El crédito fiscal cruza `purchase_dte_documents`, que exige el módulo
**`facturas_compra`**; la pantalla vive en **`proveedores`**. **`Administrador`
tiene uno y no el otro.** Con un RPC INVOKER, el LEFT JOIN contra una tabla que la
policy le esconde **no falla**: devuelve NULL, el `coalesce` lo vuelve 0, y las
doce tarjetas mostrarían **$0.00 sin un solo error**.

Por eso `get_clasificacion_fiscal_pendiente` es **DEFINER con una guarda explícita
de `proveedores.can_view`**. Un cero de permiso y un cero de dato se ven igual, y
acá el cero es justo lo que decide si alguien confirma.

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

**Paso 2 — el libro de compras unificado.** Es el que vale la plata: junio
+$1,575.71 y julio +$4,351.22 de crédito fiscal que hoy no se declara. Necesita
clasificaciones **confirmadas** — o sea que ahora sí puede arrancar, apenas
alguien confirme las 12 decisiones.

Detalle en el plan §2. Lo esencial: la clave del cruce es el **código de
generación** (16 hexadecimales bastan), **no el sello** — el correo sólo trae
sello en el 31% y hay sellos repetidos entre proveedores distintos.

**Paso 3 — cierre de período.** Julio cerró con remanente a favor y nadie lo
arrastra. Sin esto la declaración de agosto ya nace mal.

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
