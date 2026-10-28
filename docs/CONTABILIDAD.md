# Contabilidad — qué cubre el portal, qué falta y qué no se puede olvidar

Consolidado el 2026-10-28 a partir de siete documentos escritos entre el 1 y el
24 de agosto (ver «Fuentes» al final). Esos documentos se contradicen entre sí
porque cada uno se escribió con lo que se sabía ese día; acá manda lo que dice
el repo **hoy** (CHANGELOG, `supabase/migrations/`, `supabase/functions/`,
`src/`). Lo que no se pudo remedir sin tocar la base lo dice con su fecha.

La contabilidad tiene **tres niveles** y el portal no los cubre igual:

```
NIVEL 1 — DOCUMENTOS        NIVEL 2 — LIBROS FISCALES        NIVEL 3 — CONTABILIDAD FORMAL
DTE emitidos y recibidos →  libros de IVA, anexos F-07,   →  catálogo, Diario, Mayor,
inventario, planilla        cierre de período, cuota          Estados Financieros
Arts. 114-119 CT            Art. 141 CT · Arts. 83-86 RCT     Art. 435 C.Com · Art. 139 CT
✅ completo                 ✅ construido, con huecos          ❌ cero tablas
```

**El nivel 3 no sale solo del nivel 1.** Un documento dice *cuánto se vendió*;
la contabilidad además dice *contra qué* —caja o cuenta por cobrar—, *cuánto
costó lo vendido* y cómo quedó el inventario. Una venta de $113 que costó $70
es, en el libro de IVA, «gravadas $100 · débito $13»; en contabilidad es eso
**más** «Costo de venta $70 ⟋ Inventario $70». Esa segunda partida es la que el
portal todavía no puede producir, porque **el 96% de las líneas de venta no
tiene costo**. Cumplir con los libros de IVA no cumple con el Art. 435: son
obligaciones distintas y adicionales.

La **emisión** de los DTE la hace el sistema de origen, no el portal. Acá no se
lista trabajo de emisión.

---

## 1. Estado en una pantalla

### Construido

| Pieza | Versión | Nota |
|---|---|---|
| Candados del maestro de proveedores (`supplier_id` único, mensaje en vez de error crudo) | v2.339.0 | Bloque A del plan de agosto |
| Barrido del maestro de proveedores del origen (161 fichas, 98 → 28 filas sin NIT) | v2.340.0 | E4 |
| Alarmas que pueden sonar: verificador bidireccional, mismo orden en lo verificado y lo presentado, `npm run verificar:libros` | v2.341.0 | Bloque B |
| Sello, NIT y número de documento completo en compras; aviso de ventas sin DTE sellado | v2.347.2 – v2.348.4 | Bloque C, **menos C4** |
| Anexo de retención de Renta (Art. 156) y pestaña **Renta** | v2.347.0 | construido, **sin dato** (ver §2 ítem 6) |
| Columna `sales_invoices.retencion` | v2.355.0 | |
| Costo de venta congelado al insertar la línea (E1) | v2.398.0 | desde el **2026-08-05**; lo anterior está vacío |
| **Resumen Fiscal** — movimiento del mes, pago a cuenta 1.75 %, anticipo 2 % tarjeta | v2.406.0 | |
| Retención de IVA: el libro de consumidor registra el valor de la venta, no lo cobrado | v2.571.x | migraciones `20260812172655`, `20260812172845` |
| Anexos de ventas con su forma: contribuyentes 20 columnas, consumidor 23 | v2.569.3 y vecinas | |
| **Clasificación fiscal del proveedor** (Art. 65 LIVA), revisión por regla | v2.583.0 · v2.586.0 | 77 confirmadas al 2026-08-24 |
| **Libro de compras completo** (origen + correo, dedup. por código de generación) y **libro declarable** con pestaña | v2.590.0 · v2.590.1 · v2.633.0 | el declarable avisa si un documento entró dos veces |
| **Cierre de período** (`periodos_fiscales`): cadena del remanente, cifras congeladas, aviso de deriva | v2.591.0 | app nativa v2.1201.0. **0 períodos cerrados** al 2026-08-24 |
| Procedencia del costo (`costo_origen`) y `reconstruir_costo_de_venta` | migración `20260813164142` | **nunca se corrió** |
| Aviso cuando una anulación cae sobre un mes ya declarado | (ver CHANGELOG, «Aviso cuando la anulación cae sobre un mes ya declarado») | inerte hasta que se cierre el primer mes |
| Cuentas por pagar (deuda desde la fecha del DTE, pago y aprobación) | v2.641.0 · app v2.1183.0 | plazo de crédito: 0 de 163 al 2026-08-24 |
| Cuentas por cobrar (espejo de créditos) · caja, cortes, bolsas y depósitos al banco | ver `CLAUDE.md` y CHANGELOG | soporte de caja, no contabilidad |
| **Planilla**: quincenas, anticipos, incapacidad, suspensión; tabla de renta vigente | v2.1339.2 · v2.720.1 | |

### No construido

| Pieza | Por qué no |
|---|---|
| Costo de venta histórico (2025-05-01 → 2026-08-04) | espera el método de costeo (§2 ítem 1) |
| Registro de control de inventarios, Art. 142-A | ~80% de los campos existe; falta costo de salida, saldo corrido, correlativo y encabezado |
| Catálogo de cuentas, Diario, Mayor, Estados Financieros | ninguna migración crea esas tablas |
| Alerta de sello pendiente por más de N días (ventas) | `check-sales-reconciliation` todavía dice «se corrige solo» |
| Anexo 3 de compras con la forma del manual | sigue en 23 columnas con constantes |
| Exportar el año entero | `src/data/librosIva.js` pide mes por mes |

---

## 2. Lo que falta

Una sola lista, ordenada por lo que destraba. **Quién lo destraba**: *contadora*
(una decisión de criterio), *usuario* (una gestión fuera del sistema), *código*.

1. **Método de costeo y reconstrucción del costo de venta.**
   *Qué:* elegir última compra, promedio ponderado o PEPS, y correr
   `reconstruir_costo_de_venta` sobre 15 meses.
   *Por qué:* sin costo no hay Estado de Resultados, ni importe de salida en el
   registro del Art. 142-A, ni contabilidad formal. Es el nudo de los ítems 2 y 3.
   *Quién:* **contadora** (el método); después código.
   *Evidencia:* 585,341 de 609,431 líneas sin costo al 2026-08-24; la función
   existe (`20260813164142`) y no es ejecutable por `authenticated`
   (`20260923214234`). La fuente es la compra real: 93.3% de las líneas tiene una
   compra previa del mismo producto, mediana 9 días antes. Quedan fuera 5,434
   líneas sin ninguna compra y 33,741 vendidas antes de la primera compra.

2. **Registro de control de inventarios (Art. 142-A CT).**
   *Por qué:* el Art. 65 LIVA lo pide para que el crédito fiscal de la
   mercadería sea deducible. Sin él, ese crédito es objetable.
   *Quién:* código, **después del ítem 1**.
   *Evidencia:* hay fecha, documento, proveedor, descripción con lote, país del
   proveedor, entradas con costo y salidas en unidades. Falta importe de salida
   (sólo desde 2026-08-05), saldo histórico, correlativo y encabezado.

3. **Contabilidad formal**: catálogo de cuentas → Diario → Mayor → Estados
   Financieros (y el F-971 con la declaración de Renta, Art. 91 CT).
   *Por qué:* Art. 435 C.Com. Con activo ≥ $12,000 la lleva un contador (Art.
   437) y los libros se legalizan (Art. 438): un sistema no reemplaza eso, lo
   alimenta.
   *Quién:* código (proyecto grande), **después de 1 y 2**.
   *Evidencia:* no hay ninguna tabla de cuentas, asientos ni partidas en
   `supabase/migrations/`.

4. **Cerrar el primer período, y decidir con qué libro.**
   *Por qué:* el remanente del Art. 67 LIVA sólo se arrastra si el mes anterior
   está cerrado; mientras tanto el aviso de deriva y el de anulaciones están
   inertes.
   *Quién:* **contadora**.
   *Evidencia:* julio deja $112.55 a favor con el libro que se declara hoy y
   $1,302.31 con el declarable. El portal lleva la contabilidad desde julio-2026
   (`contabilidad_config`); mayo y junio se declararon por fuera y el cierre los
   rechaza.

5. **Las 26 clasificaciones que la ley condiciona.**
   *Por qué:* Art. 65 nº2 y nº3, Art. 65-A a) y c) — combustible y repuestos,
   ferretería, alimentos y bebidas, cómputo, actividades genéricas. El libro
   declarable sólo usa `confirmada`.
   *Quién:* **contadora** (la pantalla lo pide en 5 preguntas, no 26 fichas).
   *Evidencia:* $594 de crédito fiscal pendiente más $734 trabados (2026-08-13).
   Los 59 proveedores sin código de actividad suman un documento entre todos.

6. **Quién `retiene_renta` (Art. 156 CT).**
   *Por qué:* si no se retiene el 10% al pagarle un servicio a una persona
   natural, la empresa **responde solidariamente** por el impuesto más la
   multa. No es crédito que se pierde: es una deuda que aparece.
   *Quién:* **contadora** (el rol Contador Externo ya puede marcarlo desde la
   ficha).
   *Evidencia:* 0 de 99 marcados al 2026-08-24. Los dos claros son alquileres:
   OMAR ARNULFO SERRANO CRESPIN ($260.00) y LEMUS DE ALVARENGA ($2.52). El anexo
   dice lo que *correspondería* retener —se retiene al pagar y el portal
   registra lo facturado—.

7. **Alerta de sello pendiente y de sello que llega sobre un mes declarado.**
   *Por qué:* una venta sin sello no es DTE (Art. 119-D) y no entra al libro; si
   el sello llega después de declarar, la declaración quedó corta.
   *Quién:* código.
   *Evidencia:* `supabase/functions/check-sales-reconciliation/index.ts:136,217`
   trata `sin_sello` como «se corrige solo»; a los 447 días reporta igual que a
   las 5 horas. Para CCF ya hay aviso a los 5 minutos (v2.1084.4); para
   facturas de consumidor no. Especificación:
   - vigilar `estado = 'FINALIZADA'` y `length(recibido_mh) <> 40` —incluye
     `'undefined'`, que **parece** sello—;
   - disparo 1: pendiente más de 2 días hábiles, más fuerte cerca del cierre;
   - disparo 2: `sales_invoice_changelog` con `campo = 'recibido_mh'`, valor
     nuevo de 40 caracteres y `detected_at` en un mes posterior a la venta;
   - destinatario: el rol «Sistema — Alertas Técnicas», que ya existe.
   El incidente de mayo estuvo 87 días invisible.

8. **Las tres facturas de 2025 sin sello.**
   *Qué:* decidir si se retransmiten, se invalidan o se dejan.
   *Quién:* **usuario** con la contadora.
   *Evidencia:* 2025-05-16 sucursal 4 $14.00 (`undefined`); 2025-08-29
   sucursales 25 y 27, $7.45 y $30.55 (NULL). $5.98 de IVA; llevan más de un año.

9. **Anexo 3 de compras con la forma del manual F-07.**
   *Qué:* 21 columnas en vez de 23; columna C (tipo de documento) desde
   `purchase_dte_documents.tipo_dte`; columnas Q-T desde la clasificación del
   proveedor en vez de `1;1;2;5` fijo; código de generación completo; sello.
   *Por qué:* hoy ninguna fila del anexo identifica su documento, y `1;1;2;5`
   (costo de artículos comprados) es falso para teléfono, banco y alquiler.
   *Quién:* código. La clasificación —que era el bloqueo de Q-T— ya existe.
   *Evidencia:* `src/utils/libroIva.js:267-316`. El sello falta **por
   sucursal**, no por fecha: el origen no lo emite para Salud 1, 2, 4 ni La
   Popular, así que ningún backfill lo completa. Detalle columna por columna en
   `ANEXOS-HACIENDA-2026-08-11.md` §2 y §6.

10. **Los otros tres anexos con forma equivocada.**
    Anexo 8 (percepción): lleva correlativo y nombre que no pide, le faltan
    sello, DUI y número de anexo, y los montos van con 4 decimales donde
    Hacienda toma 2 (`libroIva.js:348`). Anulados: código de generación sin
    guiones (32) donde el manual pide 36 (`cgPelado`). Anexo 1: la columna G
    lleva el id interno y en DTE debe ir vacía.
    *Quién:* código. Ver `ANEXOS-HACIENDA-2026-08-11.md` §6 grupos A-C.

11. **C4 — `purchase_receipts.subtotal` a `numeric(14,4)`.**
    *Por qué:* el origen guarda 577.7115 y el portal 577.71; sólo afecta al
    anexo de percepción (el libro va con 2 decimales).
    *Quién:* **contadora** (¿el anexo se presenta con 2 o 4 decimales?).
    *Evidencia:* ninguna migración cambia el tipo. Si la respuesta es «2», C4 se
    cierra sin cambio de columna y el ítem 10 se resuelve redondeando.

12. **Exportar el año.**
    *Quién:* código. *Evidencia:* `src/data/librosIva.js:14` — «si algún día se
    pidiera un año completo, esto necesita `fetchAllRows`». Un año de compras
    pasa el techo de 1000 filas de PostgREST y truncaría sin error.

13. **`generar_csv_libro(..., p_branch_id => NULL)` devuelve cero filas sin
    error.**
    *Por qué:* es la forma exacta de un archivo fiscal vacío que parece correcto.
    Hoy nadie la llama así.
    *Quién:* código: que devuelva todas las sucursales o que falle.
    *Evidencia:* último archivo local `20260812172655`, filtro
    `branch_id = p_branch_id`. La U2 (`20260926150848`) la reescribió en prod;
    confirmar con `pg_get_functiondef` antes de tocarla.

14. **El Corte Z resta la retención dos veces.**
    Su línea VENTAS GRAVADAS ya viene neta de retención y su TOTAL se la vuelve
    a restar. No se corrige desde el portal: el cotejo se ancló en GRAVADAS
    (v2.571.7), que coincide con `sum(sales_invoices.total)` en los 12
    meses-sucursal cargados.
    *Quién:* **usuario** — reportarlo al proveedor del sistema de la caja. La
    evidencia está armada: ticket original, DTE sellado y las once columnas.

15. **Datos de proveedores que sólo se arreglan en el origen.**
    PEPSI sin NIT en ninguna fuente · MIO PHARMA y GENACOL comparten NIT
    `06141006091029` · NEGOCIOS VIDZA con NIT imposible (día 40, mes 18) ·
    BANCO PROMÉRICA sin contraparte para ligar · `PROVEEDOR PRUEBA` existe allá
    (id 53459) y borrarlo acá lo trae de vuelta.
    *Quién:* **usuario**.

16. **Gastos operativos.** `branch_expenses` tenía 0 filas el 2026-08-12 (ahí
    irían honorarios, alquileres, servicios). No se remidió. Sin gastos no hay
    margen real ni Estado de Resultados aunque el ítem 1 se resuelva.
    *Quién:* usuario (cargarlos) o código (sacarlos del libro de compras
    clasificado como *gasto*, que ya existe).

**Cifras para remedir** antes de citarlas: el 2026-08-24 fue la última
medición de las cinco que se mueven con la firma de la contadora (líneas sin
costo, períodos cerrados, proveedores confirmados, marcados Art. 156, plazos de
crédito). Ninguna se había movido en once días.

---

## 3. Preguntas para la contadora

Las fuentes tenían cuatro listas (08-06, 08-12, 08-13 y el texto de retención)
más `planes-cerrados/PREGUNTAS-CONTADOR-2026-08-03.md`. Unificadas y sin
repetir, por orden de valor:

1. **¿Qué método de costeo?** Última compra, promedio ponderado o PEPS. Destraba
   los ítems 1-3 de §2 y mueve el Estado de Resultados de quince meses.
2. **¿Con qué libro se cierra julio** (remanente $112.55 o $1,302.31) y cuándo
   cierra el primer período?
3. **¿Junio y julio se declararon con el libro del origen sin anexar nada?**
   Con los documentos completos junio da **−$506.14** (remanente a favor) en vez
   de los **$1,077.16** pagados, y julio −$4,463.77 en vez de −$112.55. ¿Se
   presentan modificatorias? Las que *reducen* el impuesto caen en el Art. 104
   CT: 2 años, verificación de auditores, sin efecto hasta que Hacienda se
   pronuncie. Antes, decidir cuáles de los CCF sin registrar son deducibles
   (Art. 65 / 65-A): en julio fueron 265, sobre todo banco, telefonía y agua,
   pero también mercadería (MONTREAL es el 38% del crédito no registrado).
4. **Percepción anterior a junio-2026 (~$12,000 estimados).** LETERAGO: 0 de 56
   documentos con percepción en nueve meses y 1.000% exacto desde junio. Mismo
   camino del Art. 104. Es extrapolación: verificar contra los DTE archivados
   (existen desde 2026-05-13).
5. **Las 26 clasificaciones condicionadas** (§2 ítem 5).
6. **Los $262.52 del Art. 156** — ¿se marcan, o hay algo en esos alquileres que
   lo excluya?
7. **La base del pago a cuenta.** Declaró $3,991.48 en junio; el 1.75% de las
   ventas da $3,484.93 por el portal y $3,484.29 por su archivo. Las dos fuentes
   coinciden, así que los $506.55 son otro componente de esa línea
   (¿ISR retenido del mismo F-14?). Hace falta su papel de trabajo. Confirmar de
   paso que 1.75% (Art. 151) es el régimen de la empresa.
8. **¿Se presentan el F-983 y el F-987?** El umbral de los Arts. 125 y 142 CT es
   2,753 salarios mínimos = $1,125,426; las ventas selladas fueron $1,724,541 en
   2025. Si se cruza y no se presentan, es omisión con multa. El F-983 pide
   inventario físico valuado y `conteos_inventario` tenía 1 fila.
9. **El anticipo del 2% por tarjeta (Art. 162-A).** $407.15 en julio sobre
   $20,357.62 cobrados con tarjeta. ¿Se acredita? Se confirma con el estado de
   cuenta del procesador.
10. **Retención de IVA en el libro de consumidor**: ¿confirma que se registra el
    valor de la venta ($120.00) y no lo cobrado ($118.94)? El texto listo para
    enviarle está en `planes-cerrados/RETENCION-EN-LOS-LIBROS-2026-08-12.md` §9.
    Y: ¿junio y julio se declararon con las cifras viejas? Serían $41.53 de
    Salud 3 ($2.21 + $39.32).
11. **C4: ¿el anexo de percepción va con 2 o 4 decimales?**
12. **El incidente de sellos de mayo-junio** (22 facturas, ver §4.4): ¿se
    sostiene la fuerza mayor por falla de la plataforma? ¿Se subsana ya para
    asegurar el atenuante del 75% (Art. 261) antes de que Hacienda requiera
    algo? ¿Se presentan las modificatorias hacia arriba de mayo ($27.23) y junio
    ($5.29)? ¿Qué se hace con las tres de 2025?
13. **Qué archivo sube de verdad**: ¿estos CSV o la plantilla del Ministerio
    llenada aparte? Cambia la prioridad de los ítems 9-11 de §2.
14. **Julio compró más de lo que vendió** ($234,534 gravadas contra $214,046).
    ¿Reabastecimiento normal o señal de algo?

### Ya respondidas — no volver a preguntar

| Pregunta | Respuesta y cómo |
|---|---|
| ¿El libro que se declara es el del portal? | **No.** El usuario, 2026-08-05: lo rearma a mano desde Facturas de Compras, anexando CCF, retenciones y notas de crédito. Ver §4.1 — la medición del 12-08 matiza esto |
| ¿Cuál fuente de compras es la buena, origen o correo? | **Ninguna sola.** Cruzado contra el libro del origen el 2026-08-12: el libro tiene que ser la unión. Construido (v2.590.0) |
| ¿Los proveedores empezaron a percibir en junio, o empezamos a capturarlo? | **Empezamos a capturarlo.** Prueba LETERAGO (auditoría del 12-08). Queda la pregunta del monto (ítem 4) |
| ¿Se hizo evento de contingencia por las 22 facturas? | **No.** El usuario, 2026-08-06: «fue manualmente uno por uno». Con eso el literal en juego es el g) del Art. 239-A |
| ¿Quién nos retiene IVA? | BANCO PROMERICA por CCF e ISSS por factura (Art. 162 inc. 3: instituciones autónomas retienen aunque no sean contribuyentes). La sección B de las preguntas del 03-08 quedó vieja |
| ¿Deben las notas de crédito restarse en el libro? | Sí (Art. 62 LIVA); ella ya lo hace a mano y el declarable lo hace solo |
| ¿Cuál es la tasa del pago a cuenta en el código? | 1.75%, Art. 151 CT verificado en `docs/legal/`. Sólo falta confirmar el régimen (pregunta 7) |

---

## 4. Decisiones y reglas que no se pueden olvidar

### 4.1 · El libro del portal es un insumo; el que se declara se arma afuera

Dato del usuario el 2026-08-05: la contadora rearma el libro de IVA a mano. Por
eso los CCF sin registrar no se leyeron como plata perdida y las notas de
crédito no como riesgo de multa.

**Pero la auditoría del 2026-08-12 midió otra cosa para junio:** el IVA del
libro del origen *tal cual* da $1,069.57, a $7.59 de lo declarado ($1,077.16);
con los documentos completos daría −$506.14. O sea que **junio se declaró sin
anexar nada**. Las dos afirmaciones no se pueden sostener a la vez para junio;
lo que resuelve es el ítem 3 de §3. Mientras tanto, la consecuencia que vale en
cualquiera de los dos casos: si el libro declarado se arma fuera del portal, **no
existe en ningún sistema** y sólo el cierre de período lo deja reproducible.

### 4.2 · Sello válido = 40 caracteres, y es la ley, no un diseño

Art. 119-D CT: el documento adquiere carácter de DTE **cuando obtiene el sello**.
`length(recibido_mh) = 40` es esa definición. `IS NOT NULL` y `!!valor` dan por
buena la basura: el origen llegó a guardar la cadena `'undefined'`. Al capturar
el sello de compras se valida igual — 6 de 331 del origen no medían 40 (un
código de generación, uno con espacio, tres con texto pegado a mano).

### 4.3 · Una venta transmitida tarde pertenece al mes de su EMISIÓN

El período lo fija la fecha de emisión; el documento conserva fecha y código de
generación. Si el sello llega después de declarar, la declaración quedó corta.

- **Hacia arriba no hay plazo** (Art. 101 CT); **hacia abajo, 2 años y
  verificación** (Art. 104). Corregir a favor del fisco es trámite; a favor
  propio, proceso.
- **Lo caro es la cadena:** cambiar mayo cambia su remanente, que es el punto de
  partida de junio y de julio.
- **El estado actual no guarda la historia.** Una vez sellada, la factura no
  deja rastro de que faltó. El rastro está en `sales_invoice_changelog`
  (`detected_at`). Medir el estado en vez de la historia ya dio un «mayo
  limpio» falso.

### 4.4 · El incidente de sellos de mayo-junio 2026

22 facturas, $32.52 de IVA (mayo $27.23, junio $5.29), con `recibido_mh =
'undefined'` y selladas a mano una por una el **2026-08-02**, 43 a 87 días
después. En 5 de 6 consultadas el servicio del origen devolvía cuerpo vacío:
Hacienda nunca las tuvo, así que el 2 de agosto fue la primera transmisión.

Lectura del Art. 239-A, para empezar la conversación con datos (no es asesoría):
d) castiga *omitir* la transmisión y no aplica, porque se transmitió; g)
—omitir el evento de contingencia— es **monto fijo**, 9 salarios mínimos =
$3,679.20 (SM comercio 2026: $408.80); con subsanación voluntaria antes de
requerimiento, Art. 261, baja 75% a ≈$919.80. La lectura dura por c) daría
≈$17,987, y el argumento en contra sale del texto: el sello se otorgó. Si la
falla fue de la plataforma, la premisa de fuerza mayor del Art. 119-F se cumple.
**El atenuante depende del reloj.**

### 4.5 · La retención de IVA no reduce la venta

Art. 162 CT: es un **anticipo del impuesto**, «sobre el precio de venta», y se
consigna por separado (`ivaRete1`, aparte de `totalGravada`). Los Arts. 83 y 85
RCT piden «valor de ventas» y no tienen columna de retenido. Por eso los dos
libros registran `subtotal + iva`, no `total` (que es lo cobrado). Julio:
cobrado $241,836.14 · valor de las ventas **$241,879.06** · retención $42.92.
El **cotejo** contra el Corte Z sigue en lo cobrado a propósito: son dos
preguntas, «¿coincide con la caja?» y «¿qué se declara?», y la retención es la
distancia entre ellas. Base sin IVA, desde $100.

### 4.6 · Las claves que identifican, y las que no

- **El código de generación es la clave.** Truncado a 20 por el origen, los
  primeros 16 hexadecimales bastan. Una `O` en un código hexadecimal es un cero
  mal escrito.
- **`numero_control` no es único**: el correlativo reinicia cada año, y un
  reintento del POS reusa el número con otro código. Nunca ponerle restricción
  de unicidad.
- **El sello no es único en compras**: el mismo sello aparece en LETERAGO y en
  COFARSAL. COFARSAL 4986/5059 era una compra duplicada ($8.46 de crédito); el
  declarable ya avisa cuando un documento entra dos veces (v2.633.0).
- **El número de control truncado a 20 no identifica nada**: 1,171 números
  distintos colapsan en 48 claves. Así salió el falso «$1,581».
- **Antes de dar un número que sale de un cruce, contar cuántas claves
  distintas produce.** El crédito fuera del libro pasó por $1,176 → $10,922 →
  $1,581 → $8,532 en una sola sesión; sólo el último estaba verificado en las
  dos direcciones.

### 4.7 · El origen sólo llena lo vacío

El maestro del origen tiene 6 NIT equivocados (contra el DTE firmado) más uno
imposible, y le borra las comas a las razones sociales. De las 5 clases de
diferencia del libro de compras, 4 son defectos del origen que el portal ya
corrige. Reglas del barrido: el origen nunca pisa un NIT; `percibe_1` es
asimétrico (el origen puede encenderlo, nunca apagarlo); ligar antes que crear;
validar la forma del NIT; usar **la cuenta de compras**, porque el mismo
`id_proveedor` apunta a otro proveedor con la cuenta de clientes.

### 4.8 · El costo no se inventa

`20260806004055_e1_no_estampar_costo_sobre_ventas_viejas`: el trigger no estampa
costo en ventas de más de 15 días — «un dato inventado que se lee como medido es
peor que un NULL». Por eso la reconstrucción usa compras reales y marca su
procedencia en `costo_origen`. `product_precios` guarda el costo **actual** y
`product_precios_history.costo` está NULL en sus 26,739 filas.

### 4.9 · Lo que la contabilidad formal exige desde el diseño

- **Un asiento no se edita, se corrige con otro asiento** (Art. 139 CT: no
  puede modificarse de modo que no sea determinable su contenido primitivo). Es
  lo contrario de un `UPDATE`.
- **Atraso máximo de dos meses** (Art. 139). Un módulo que se llena «cuando se
  puede» incumple por diseño.
- **Una tabla vacía es peor que no tenerla**: el reporte devuelve cero y cero se
  lee como «no hubo gastos», no como «nadie lo cargó».

### 4.10 · La clasificación es una decisión por proveedor, no por documento

1,291 CCF desde junio venían de 99 proveedores: 99 decisiones cubren todos los
documentos futuros. Sale del CIIU (`cod_actividad`), no de una lista a mano.
`iva_deducible` nace NULL y el estado nace `pendiente`; el libro sólo usa
`confirmada`; un CHECK impone la matriz del manual (Costo → tipos 4-7, Gasto →
1-3). El agua del Art. 65 nº4 es el suministro público (ANDA), no el agua
envasada.

### 4.11 · Trampas de medición

- **Un RPC con el permiso dentro del `WHERE` devuelve cero filas, sin error,**
  desde una sesión que no es de empleado (los `get_libro_*`,
  `get_candidatos_retencion_renta`). Auditar contra las tablas base.
- **`proveedores_maestro` pide `proveedores` y `purchase_dte_documents` pide
  `facturas_compra`**: cruzarlas en un INVOKER da ceros silenciosos.
- **Antes de junio-2026 la serie de IVA no es comparable**: la percepción pasa de
  6-9 documentos al mes a 226-249 y el sello aparece de golpe.
- **El servicio de consulta del origen contesta 200 con cuerpo vacío** para un
  código ajeno: validar el contenido, no el status.

### 4.12 · La cuota del mes

Junio-2026, $12,331.29: IVA $1,077.16 (se reproduce a centavos), pago a cuenta
$3,991.48 (la fórmula sí, la base no — pregunta 7), ISSS $2,526.05, AFP
$3,555.74, ISR $930.86, honorarios $250. En agosto el 59% dependía de una
planilla vacía; la planilla ya existe (v2.1339.2), pero **no está verificado que
la cuota del mes salga de ella**: el Resumen Fiscal cubre IVA, pago a cuenta y
anticipo por tarjeta.

---

## 5. Relacionados (no absorbidos)

- `docs/LIBROS-IVA-FORMATO-Y-HALLAZGOS-2026-08-01.md` — formato de los archivos
  de los libros, columna por columna, y los hallazgos de formato.
- `docs/ANEXOS-HACIENDA-2026-08-11.md` — los anexos del F-07 campo por campo,
  catálogos, F-971/F-983/F-987 y la conciliación contra los archivos del
  contador (§8).
- `docs/planes-cerrados/BLOQUE-D-CIERRE-DE-PERIODO.md` — el diseño original del
  cierre (construido después como v2.591.0).
- `docs/planes-cerrados/PREGUNTAS-CONTADOR-2026-08-03.md` — la primera lista de
  preguntas; superada por §3.
- Leyes: `docs/legal/normativa/fiscal/` (Código Tributario 2026-04, Reglamento,
  Ley de IVA 2024-07, Ley de Renta 2026-01, Código de Comercio, guía técnica
  DTE).

## 6. Fuentes

Los siete documentos que este reemplaza, archivados:

- `docs/planes-cerrados/CONTABILIDAD-ALCANCE-2026-08-01.md` — los tres niveles,
  los artículos del C.Com y del CT, el catálogo de tipos de DTE con volúmenes, y
  la cuota de junio línea por línea.
- `docs/planes-cerrados/PLAN-CONTABILIDAD-2026-08-02.md` — los hallazgos H1-H31
  de proveedores y libros de IVA, los bloques A-E con su verificación, la
  comparación byte a byte contra el archivo del origen, el barrido de
  proveedores y el borrador del impuesto de julio.
- `docs/planes-cerrados/RETOMAR-CONTABILIDAD-2026-08-06.md` — el cambio de
  encuadre del «se rearma a mano», el incidente de sellos completo (§7 a §7.sexies,
  Art. 239-A) y la especificación de la alerta (§8.3).
- `docs/planes-cerrados/AUDITORIA-CONTABLE-COMPLETA-2026-08-12.md` — la
  auditoría medida contra producción: libro de compras incompleto, percepción
  no capturada, anexos con defectos, y el SQL para reproducir cada cifra.
- `docs/planes-cerrados/RETENCION-EN-LOS-LIBROS-2026-08-12.md` — la retención del
  Art. 162 en los dos libros, el defecto del Corte Z, las seis guardas de
  `get_cortes_z` y el texto para la contadora.
- `docs/planes-cerrados/PLAN-CONTADOR-INTERNO-2026-08-12.md` — los seis pasos del
  contador interno, las reglas CIIU de clasificación con su artículo, y el
  rediseño de la revisión por regla.
- `docs/planes-cerrados/RETOMAR-CONTADOR-INTERNO-2026-08-13.md` — estado al
  13-08 y remedición del 24-08, la medición de la reconstrucción del costo, qué
  datos del proveedor exige la ley y los permisos del Contador Externo.
