# Documentación legal

Ordenada el **2026-10-28**. Dos tipos de documento, en carpetas separadas:

| carpeta | qué es | quién lo cambia |
|---|---|---|
| `normativa/` | leyes, reglamentos y listados **oficiales** de El Salvador | el Estado — acá sólo se reemplazan por la versión nueva |
| `procedimientos/` | procedimientos escritos que firma y sella el regente (borradores) | la empresa — el `.md` es el original; el PDF lo genera `npm run procedimientos:pdf` |
| `empresa/` | el reglamento interno de trabajo (aprobado por la Dirección General de Trabajo) | la empresa |
| raíz | documentos propios publicados al cliente: privacidad, programa de puntos, reservas, mayoristas, afiches | la empresa — cada `.html` es el original y su PDF sale de los scripts de `package.json` (`*:pdf`, `afiche:*`) |

Los documentos de la raíz **no se movieron** a propósito: los scripts de
`package.json` y `scripts/` los generan en esa ruta.

**Los `.txt` al lado de un PDF son a propósito**: los PDF traen el texto
comprimido y hay que pasarlos por `pdftotext`. Con el `.txt` ya generado se cita
el número de artículo exacto sin repetir la conversión ni citar de memoria.

---

## 1 · Normativa vigente — verificada el 2026-10-28

Cada archivo lleva en el nombre **hasta qué fecha llegan sus reformas**. Se
eligió, entre todas las copias públicas, la que incorporaba la reforma más
reciente publicada en el Diario Oficial.

### `normativa/sanitaria/` — SRS (ex DNM)

| archivo | qué es | vigencia |
|---|---|---|
| `rts_11020424_diario_oficial_2025-10-08.pdf` | **RTS 11.02.04:24 publicado** — Buenas Prácticas de Almacenamiento, Dispensación, Distribución y Transporte. D.O. Tomo 449, N.º 189. **Es el que rige.** Escaneado, sin texto | ✅ entró en vigencia el **8-abr-2026**. Transición de 4 años: el primer año exige el **70 %** de la guía y el **85 %** en cadena de frío (§11.2) |
| `rts_11020424_consulta_2024.pdf` / `.txt` | La versión de **consulta** (dic-2024). Se conserva sólo porque tiene texto para buscar | ⚠️ **la §6.1 está numerada distinto** — ver abajo. La §6.2 es idéntica a la publicada |
| `srs_guia_verificacion_bpad.pdf` / `.txt` | Guía de Verificación de BPAD: la lista con la que el inspector recorre la sala, ítem por ítem con su peso CRÍTICO / MAYOR / MENOR | ✅ idéntica byte por byte a la que publica hoy srs.gob.sv (oct-2025) |
| `ley_de_medicamentos_actualizada_2025-06.pdf` / `.txt` | Ley de Medicamentos (DL 1008/2012) con sus reformas | ✅ consolidada por la SRS a junio 2025 |
| `ley_srs_actualizada_2025-06.pdf` | Ley de la Superintendencia de Regulación Sanitaria (DL 891): la SRS absorbió a la DNM | ✅ junio 2025 |
| `srs_listado_oficial_medicamentos_2026.pdf` / `.txt` | Listado Oficial de Medicamentos 2026 (acuerdo SI.2026.02.06-02). El cap. **J01** trae el grupo AWaRe dentro del código: `*(1)` Acceso, `*(2)` Precaución → fuente del ítem **1.13** | ✅ se reemplaza cada primer trimestre |
| `srs_venta_sin_receta_2026.pdf` / `.txt` | Listado de medicamentos de venta **sin** receta 2026 (acuerdo SI.2026.02.06-01) | ✅ se reemplaza cada primer trimestre |

**La §6.1 del RTS publicado se renumeró.** Al citar, usar la columna de la derecha:

| tema | consulta 2024 | **publicado 2025** |
|---|---|---|
| registro de visitas del regente | 6.3.7 | **6.1.3** |
| supervisión del sistema electrónico | 6.1.15 | **6.1.4** |
| archivo de inspecciones (3 años) | 6.1.3 | **6.1.5** |
| procedimiento de limpieza y mantenimiento | 6.1.11 | **6.1.13** |
| procedimientos firmados por el regente | 6.1.12 | **6.1.14** |
| listado de antibióticos | 6.1.13 | **6.1.15** |
| documentación digital (ALCOA) | 6.1.14 | **6.1.16** |

Los que más se consultan:

| tema | guía | RTS |
|---|---|---|
| temperatura y humedad: 2×/día (media mañana y media tarde), ≤30 °C, fecha + hora + persona, 2 años | 2.26, 2.27, 2.34 | 6.2.11, 6.2.15, 6.2.16, 6.2.21 |
| refrigerador: 2×/día, 2–8 °C, termómetro calibrado, uso exclusivo | 2.29 a 2.33 | 6.2.18 a 6.2.20 |
| limpieza: procedimiento escrito de áreas y mobiliario, firmado | 1.11, 1.12, 2.11 | 6.1.13, 6.1.14 |
| antibióticos: registro trazable, campos, parcial/total, copia de receta | 3.3, 3.5, 3.16 a 3.21 | 6.4 |

**Ningún antibiótico sistémico es de venta libre.** La lista 2026 de venta sin
receta sólo trae neomicina y sulfadiazina tópicas, y la Ley de Medicamentos
llama venta libre únicamente a lo publicado ahí. Las seis moléculas (cefixima,
azitromicina, claritromicina, levofloxacina, moxifloxacina, norfloxacina) y todo
antibiótico inyectable llevan además **receta retenida y libro**; el resto es
«con receta» sin retención. El registro trazable de la Guía 3.3 (CRÍTICO)
abarca **todos** los antibióticos que se manejan. Confirmarlo con el regente.

### `normativa/fiscal/`

| archivo | qué es | vigencia |
|---|---|---|
| `codigo_tributario_2026-04.pdf` / `.txt` | Código Tributario (DL 230), texto de la Asamblea Legislativa | ✅ reformas hasta el D.O. del **13-abr-2026**; incluye las de DTE (DL 487/2022) y consumidor final (DL 94/2024) |
| `ley_renta_2026-01.pdf` | Ley de Impuesto sobre la Renta (DL 134) | ✅ reformas hasta el D.O. del **14-ene-2026** |
| `ley_iva_2024-07.pdf` | Ley de IVA (DL 296), texto de la Asamblea | ✅ última reforma encontrada: D.O. del 11-jul-2024 |
| `codigo_comercio_2022-04.pdf` | Código de Comercio (DL 671). Título II «Contabilidad», Arts. 435-455 | ✅ última reforma encontrada: D.O. del 26-abr-2022 |
| `reglamento_codigo_tributario.pdf` | Reglamento de Aplicación del Código Tributario | ⚠️ PDF de 2008; no se encontró versión más nueva |
| `dte_guia_tecnica.pdf` | Lineamientos técnicos de los DTE (2021). Se conserva porque Compras **lee** los DTE de los proveedores (código QR, pág. 7). La facturación la emite el ERP | ⚠️ desactualizada (existe la versión 2.0), pero es del ERP |

### `normativa/laboral/`

| archivo | qué es | vigencia |
|---|---|---|
| `codigo_de_trabajo_2025-08.pdf` / `.txt` | Código de Trabajo, texto de la Asamblea Legislativa | ✅ reformas hasta el D.O. del **22-ago-2025** |
| `decreto_432_aguinaldo_exento_renta_2025-10.pdf` | DL 432 (oct-2025): el aguinaldo no paga renta hasta el monto que fija | ✅ |
| `oit_convenios_el_salvador.md` | qué convenios de la OIT obligan además del Código | ⚠️ no es la lista completa y lo dice (NORMLEX bloquea el acceso automático) |

⚠️ **Falta el DL 433 (15-oct-2025, «Refórmase el Código de Trabajo»)**, el que
corre el pago del aguinaldo al período **20-oct a 20-dic**. Es posterior al
consolidado y la Asamblea no publica su PDF en la ficha del decreto (el enlace
lleva al DL 432). Pedirlo al Diario Oficial cuando haga falta citarlo.

### `normativa/datos-personales/`

| archivo | qué es | vigencia |
|---|---|---|
| `ley_proteccion_datos_personales_2024.pdf` | Ley para la Protección de Datos Personales (DL 144, D.O. 15-nov-2024) | ✅ sin reformas ni reglamento publicados |

---

## 2 · Notas de lectura del Código de Trabajo

| Artículo | Qué dice | Dónde se aplica |
|---|---|---|
| 18 | Tres ejemplares del contrato; el tercero a la Dirección General de Trabajo dentro de **ocho días**. Omitirlo NO invalida el contrato | aviso con cuenta regresiva del expediente |
| 20 | Presunción de contrato de trabajo cuando hay subordinación | advertencia de «servicios profesionales» |
| 23 | Qué debe decir el contrato escrito. **Nº 9: «Forma, período y lugar de pago»** | la pestaña Contrato entera |
| 25 | El plazo sólo vale si la labor es transitoria, temporal o eventual | «por qué es temporal» |
| 28 | Período de prueba: 30 días | aviso de período de prueba |
| 120 | Moneda de curso legal; prohíbe vales, fichas y cupones | catálogo de medio de pago |
| **128** | «El salario debe pagarse en el lugar convenido **o en el establecido por el reglamento interno de trabajo** y, a falta de estipulación, en el acostumbrado o donde el trabajador preste sus servicios» | catálogo de lugar de pago |
| **129** | Prohíbe pagar en centros de vicio, lugares de recreo, expendios de bebidas embriagantes y **tiendas de ventas al por menor**, «a no ser que se trate de los trabajadores de esos establecimientos». El pago en contravención **«se tendrá por no hecho»** | por qué pagar en la sala SÍ se puede |
| 130 | Cuándo se vuelve exigible el salario según la forma de estipulación | nota bajo «forma de estipulación» |

### El reglamento interno de la empresa manda tanto como el Código

`empresa/REGLAMENTO INTERNO DE TRABAJO FP Y FS.rtf` está **aprobado por la Dirección
General de Trabajo**, y el Art. 128 del Código le entrega expresamente la
definición del lugar de pago. Su **Art. 40** ya lo resolvió:

> «El salario devengado por los y las Trabajadoras les será pagado en la moneda
> de curso legal y será cancelado los **días quince y último de cada mes**, en
> las **oficinas de la Empresa o en su lugar de trabajo**. Los métodos de pago
> serán por medio de **transferencia bancaria electrónica o cheque**.»

De ahí sale que el lugar de pago sea un catálogo de dos y no un texto libre.
**Y deja una pregunta abierta:** el reglamento dice transferencia o cheque, y el
portal ofrece «Efectivo». Uno de los dos tiene que cambiar, y es decisión de la
empresa, no del portal.

Se lee con `textutil -convert txt -stdout "docs/legal/empresa/REGLAMENTO INTERNO DE TRABAJO FP Y FS.rtf"`.

---

## 3 · Cómo se mantiene al día

**Ningún texto legal de El Salvador tiene un consolidado oficial que se
actualice solo.** La forma de saber si uno sigue vigente es buscar la reforma
más reciente en el Diario Oficial y compararla con la última que trae el
archivo. Por eso cada nombre lleva su fecha de corte.

- Los dos **listados de la SRS** se publican cada primer trimestre: reemplazar
  el del año anterior.
- Al bajar una versión nueva: borrar la vieja, renombrar con la fecha de la
  última reforma que incluye y actualizar esta tabla.
- Para una actuación con consecuencias (una inspección, un juicio) la fuente es
  el Diario Oficial, no una copia.
