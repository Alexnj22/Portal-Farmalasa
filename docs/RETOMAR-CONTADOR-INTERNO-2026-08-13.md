# Retomar — contador interno, 2026-08-13

Estado al cierre del 2026-08-12. **Empezar por acá.** El plan completo está en
`PLAN-CONTADOR-INTERNO-2026-08-12.md` y el porqué en
`AUDITORIA-CONTABLE-COMPLETA-2026-08-12.md`.

---

## Prompt para arrancar

```
Seguimos con el contador interno. Leé docs/RETOMAR-CONTADOR-INTERNO-2026-08-13.md
y docs/PLAN-CONTADOR-INTERNO-2026-08-12.md §1.bis.

Ayer entregué la confirmación de la clasificación fiscal a ciegas: la propuesta
sólo se ve dentro del modal, y en la lista no aparece ni el estado ni la
sugerencia. Alex lo rechazó con razón.

Antes de escribir código, mostrame el rediseño de la pantalla de revisión POR
REGLA (7 tarjetas para 67 propuestas, 5 para las 36 condicionadas), y esperá que
lo apruebe. Después implementalo.
```

---

## Lo que quedó hecho y desplegado

| versión | qué | estado |
|---|---|---|
| v2.583.0 | Columnas de clasificación fiscal en `proveedores_maestro` + la propuesta derivada del CIIU | en prod |
| v2.584.0 | Los 3 RPC + sección en la ficha + filtro + confirmación en tanda | en prod |

Migraciones aplicadas y registradas: `20260813041109` y `20260813042113`. Los dos
gates de migraciones en verde. Pusheado a `main` (`f9d978ea`) y desplegado.

**Datos hoy en producción:** 67 proveedores en `propuesta`, 95 en `pendiente`
(36 con motivo legal escrito + 59 sin código de actividad), 0 en `confirmada`.

---

## Lo primero, y es un rediseño

**El §1.bis del plan tiene el análisis completo.** Resumen:

La pantalla actual pide confirmar 67 propuestas que no están visibles. Hay que
rehacerla **agrupando por regla**:

- **7 tarjetas** cubren las 67 propuestas — una sola cubre 52 (mercadería).
- **5 tarjetas** cubren las 36 condicionadas, cada una con su pregunta legal.
- **59 proveedores sin código de actividad** tienen **1 documento entre todos**:
  van a una sección callada, no al flujo principal.

Son **12 decisiones, no 162**.

Y tres cosas más:

- **B** — que el estado se vea en la lista, en una columna angosta («IVA», ~64px,
  marca de color + `title`) o dentro de la celda de Proveedor. El ancho de la
  tabla es una restricción real: ya le quitaron dos columnas por eso.
- **C** — la sección de deducibilidad quedó al fondo del modal, después de
  Contacto y de Notas, siendo la decisión de mayor consecuencia de esa ficha.
- **Mostrar el rediseño antes de implementarlo.** Ayer no lo hice y por eso hubo
  que rehacerlo.

---

## Lo que sigue después

**Paso 2 — el libro de compras unificado.** Es el que vale la plata: junio
+$1,575.71 y julio +$4,351.22 de crédito fiscal que hoy no se declara. Necesita
clasificaciones **confirmadas**, así que no arranca antes del rediseño.

Detalle en el plan §2. Lo esencial: la clave del cruce es el **código de
generación** (16 hexadecimales bastan), **no el sello** — el correo sólo trae
sello en el 31% y hay sellos repetidos entre proveedores distintos.

**Paso 3 — cierre de período.** Julio cerró con remanente a favor y nadie lo
arrastra. Sin esto la declaración de agosto ya nace mal.

**Con reloj:** las 6,436 líneas de venta del 1 al 4 de agosto sin costo. El costo
de venta arrancó el 2026-08-05 y esas líneas todavía se pueden rellenar desde
`product_precios` (7,856 de 8,188 tienen precio) con cuatro días de deriva. Cada
día que pasa la aproximación empeora, y sin costo de venta no hay Estado de
Resultados.

---

## Las cinco preguntas para la contadora

Ninguna es de sistema y las cinco cambian el resultado.

1. **Las 36 fichas condicionadas** (combustible, ferretería, alimentos, cómputo):
   ¿cuáles aplican? Es la única entrada humana del paso 1.
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

---

## Trampas de esta sesión, para no volver a pisarlas

- **`apply_migration` por MCP no está disponible.** El equivalente —aplicar con
  `supabase db query` y registrar la fila en `supabase_migrations.schema_migrations`—
  quedó como script en el scratchpad. Requiere permiso explícito del usuario: el
  clasificador bloquea la escritura en producción, y con razón.
- **El CLI de Supabase se traga el `.env` del repo** (`client-gmail1` tiene un
  guión y rompe su parser). La salida limpia es un workdir aislado con
  `supabase/config.toml` y `supabase/.temp/` copiados — así no hay que mover el
  `.env`, que es lo que otras sesiones pueden estar usando.
- **Los `get_libro_*` llevan `auth_has_module_permission` DENTRO del WHERE**:
  desde una sesión que no es de un empleado devuelven **cero filas, sin error**.
  Para auditarlos hay que ir a las tablas base.
- **`generar_csv_libro` con `p_branch_id => NULL` devuelve cero filas en
  silencio** — el filtro es `branch_id = p_branch_id`. Está anotado como hallazgo
  3.9 de la auditoría y sigue abierto.
- **Commitear no despliega.** Las dos versiones quedaron commiteadas y sin
  pushear, y Vercel despliega en el push.
