# Bloque D — El cierre de período

**Estado: DOCUMENTADO, no ejecutado. Pendiente de que Alex lo confirme.**
Fecha: 2026-08-03 · Contexto: `docs/PLAN-CONTABILIDAD-2026-08-02.md` Parte 3 §1

---

## 1. El problema, en una frase

**Hoy no existe registro de qué se declaró.** Cualquier mes se re-exporta y puede
salir distinto. El archivo de junio que bajó la contadora hace dos semanas **no se
puede reproducir hoy**, y nadie —ni ella ni nosotros— puede probar qué decía.

Eso no es una hipótesis. Está medido abajo.

---

## 2. La evidencia

### 2.1 Documentos que entran a un mes después de que el mes cerró

Ventas finalizadas, dadas de alta con fecha posterior al último día de su propio mes:

| Mes del documento | Documentos del mes | Entraron después del cierre | Monto |
|---|---|---|---|
| Mayo 2026 | 22,696 | **87** | $718.55 |
| Junio 2026 | 21,654 | **124** | $996.65 |
| Julio 2026 | 22,429 | **181** | $1,614.76 |

**Honestidad sobre este número:** casi todo cae el día 1 del mes siguiente. Es el
retraso normal del sync, que cubre "ayer y hoy" — no son documentos que aparecen
meses después. Prueba que el libro se mueve después del último día del mes, no que
se mueva eternamente.

### 2.2 La deriva que importa es la otra: el libro cambia sin que entre un documento

Ésta no se ve contando filas, y es la que rompe la reproducibilidad. Cuatro casos
**reales, de las últimas dos semanas, tres de ellos causados hoy mismo**:

| Cuándo | Qué cambió | Alcance |
|---|---|---|
| 2026-08-02 | Re-sync de mayo | **21 documentos** recuperados que faltaban |
| 2026-08-03 (C1) | Se empezó a guardar el sello de compras | junio pasó de 0 a **91 sellos de 93** en Bodega |
| 2026-08-03 (C5) | `docs_count` derivado en vez de acumulado | **93 de 161 fichas** de proveedor tenían el número inflado |
| 2026-08-03 (C3) | El libro muestra el número de control real | **380 de 467** filas de julio cambiaron lo que muestran |

Ninguno agregó ni quitó una operación. Los cuatro cambiaron **lo que el libro
dice**. Si alguien hubiera declarado julio el 1 de agosto, el libro que ve hoy no
es el que presentó — y no hay forma de saberlo.

### 2.3 Por qué el módulo no puede sostener "el dato es confiable" sin esto

Es confiable **hoy**. Nadie puede probar qué decía ayer. Para un libro fiscal, que
se presenta y después se audita, esa distinción es la única que importa.

---

## 3. El diseño

### D1 — Declarar un período congela sus bytes

Tabla `libros_iva_cierres`:

| columna | qué guarda |
|---|---|
| `periodo` | `2026-07-01` (primer día del mes) |
| `libro` | `consumidor` · `contribuyente` · `anulados` · `compras` · `percepcion` · `retencion` |
| `csv` | **los bytes exactos** del archivo, tal como se descargó |
| `sha256` | hash de esos bytes |
| `totales` | jsonb con documentos / monto / impuesto, para no re-parsear el CSV al mostrarlo |
| `cerrado_por`, `cerrado_at` | quién y cuándo |

Los bytes y no una re-generación: el punto es poder devolver **el mismo archivo**,
no uno equivalente. Es la misma lógica del §9 del doc de formato — si se re-genera,
ya no se está probando nada.

Retención: **no se purga.** Es historial de negocio (regla 7 de `CLAUDE.md`).

### D2 — Un período cerrado se lee del snapshot

La vista, al pedir un mes cerrado, trae el CSV guardado en vez de la tabla viva. El
botón de exportar devuelve esos bytes. Sin excepción y sin opción de "regenerar":
un botón que regenera un mes cerrado es el agujero por el que se pierde la garantía.

### D3 — La deriva se detecta, no se aplica

Cron diario: recalcular el libro de los meses cerrados y comparar el hash. Si
cambió, avisar **con el detalle**:

> *junio cambió después de declararse: +1 documento, +$45.98*

Y no tocar nada. La decisión de si va modificatoria es de contabilidad, no del
sistema. **Ésta es la pieza de autonomía**: el mes no solo cierra, se queda
vigilado solo.

Alcance del cron: los últimos N meses cerrados (12 alcanza — el Art. 65 da 3
períodos para reclamar crédito, y una modificatoria más vieja que un año es
excepcional). Recalcular 6 libros × 12 meses es barato si se hace en la ventana
06:00–11:59 UTC, cuando los syncs están quietos.

### D4 — El sello en pantalla

En la vista: *"Declarado el 12/08 por María"* y el botón de exportar dice que baja
el archivo declarado. Un mes cerrado no se puede re-exportar en silencio.

---

## 4. Lo que hay que decidir ANTES de ejecutar

Estas no las puedo resolver yo. Son las que conviene contestar cuando se retome:

1. **¿Quién puede cerrar un mes?** Hoy `libros_iva` tiene permiso de ver y de
   editar. Cerrar es más fuerte que editar: conviene un permiso propio, o al menos
   exigir `can_edit` + un cargo específico.

2. **¿Se puede reabrir?** Mi recomendación: **no borrar nunca**. Reabrir crea una
   fila nueva marcada como "reapertura", con el motivo escrito y quién lo hizo. Un
   cierre que se puede borrar no es un cierre.

3. **¿Qué pasa si el mes se cierra y todavía tiene avisos rojos** —documentos sin
   número de control, CCF sin NRC, ventas sin sello—? Dos opciones: bloquear el
   cierre, o dejarlo cerrar guardando los avisos vigentes junto al snapshot. Me
   inclino por la segunda: bloquear obliga a que el sistema tenga razón siempre, y
   a veces se declara igual con una diferencia conocida y explicada.

4. **¿El cierre es por libro o por mes completo?** Los seis libros del mes se
   presentan juntos, así que cerrar el mes completo es más fiel. Pero eso obliga a
   que los seis estén sanos el mismo día.

---

## 5. Lo que D **no** resuelve

- **No arregla los datos.** Congela lo que hay. Si julio se cierra con 436
  documentos de gasto sin registrar, queda congelado con esa diferencia — con la
  ventaja de que queda escrita.
- **No reemplaza el cuadre.** Los controles de B siguen siendo los que detectan que
  algo está mal *antes* de declarar.
- **No es contabilidad formal.** Sigue siendo libros de IVA. El alcance del módulo
  no cambia (ver memoria `project_contabilidad_alcance_2026_08_01`).

---

## 6. Lo que cuesta

Cuatro migraciones y una vista tocada. Sin riesgo sobre tablas calientes: la tabla
es nueva y el cron solo lee. El trabajo real está en D3 —el recalculo diario— y en
las decisiones del §4, no en el código.

Estimado del plan original: ~3 días.

---

## 7. Estado

**Pendiente de confirmación de Alex.** No se ejecuta nada hasta entonces. Cuando se
retome, este documento es el punto de partida: el diseño está cerrado, faltan las
cuatro decisiones del §4.
