# Referencia legal y técnica (El Salvador)

Textos oficiales guardados en el repo para consultarlos al trabajar los módulos
que dependen de ellos. Son **dos materias distintas** y conviene no mezclarlas:

- **§1 Fiscal y tributario** — facturación, proveedores, ventas, contabilidad.
  Descargados el 2026-07-18 (el Código de Comercio el 2026-08-01).
- **§2 Regulación sanitaria** — bitácoras, dispensación bajo receta,
  almacenamiento. Descargados el **2026-08-16**.

Complementa (no reemplaza) las referencias puntuales ya usadas en el código —
ver `docs/resumen-dte-el-salvador.md` para el resumen de negocio del DTE
aplicado a esta farmacia, y `docs/PLAN-BITACORAS-SRS-2026-08-16.md` para el de
las bitácoras.

## 1 · Fiscal y tributario

| Archivo | Contenido | Fuente | Vigencia conocida |
|---|---|---|---|
| `codigo_tributario.pdf` | Código Tributario, Decreto Legislativo N.º 230 (texto base + reformas incorporadas hasta ~2014) | Asamblea Legislativa, vía eregulations.org | **No incluye las reformas de 2022 en adelante** — ver `decreto_487_reforma_dte.pdf` aparte |
| `decreto_487_reforma_dte.pdf` | Decreto Legislativo N.º 487 (30/ago/2022) — las reformas específicas que introdujeron los Documentos Tributarios Electrónicos (DTE) al Código Tributario: 14 artículos modificados, emisión/transmisión/recepción/invalidación de DTE, contingencias | Asamblea Legislativa (asamblea.gob.sv) | Texto original del decreto — no incorpora reformas posteriores a este mismo decreto (ej. Decreto 960/2024, que tocó Arts. 114 y 119-G, no incluido aquí) |
| `reglamento_codigo_tributario.pdf` | Reglamento de Aplicación del Código Tributario | Ministerio de Hacienda (transparenciafiscal.gob.sv) | Portal oficial de transparencia fiscal |
| `ley_iva.pdf` | Ley de Impuesto a la Transferencia de Bienes Muebles y a la Prestación de Servicios (Ley de IVA) | Ministerio de Hacienda (transparenciafiscal.gob.sv) | Portal oficial de transparencia fiscal |
| `ley_renta.pdf` | Ley de Impuesto Sobre la Renta | Ministerio de Hacienda (transparenciafiscal.gob.sv) | Portal oficial de transparencia fiscal |
| `dte_guia_tecnica.pdf` | "Documento Técnico de Lineamientos de Integración — Facturación Electrónica" (estructura JSON de los DTE, catálogos, firma electrónica) | factura.gob.sv (Ministerio de Hacienda / DGII) | Guía técnica oficial — la normativa DTE 2.0 (2026) puede traer cambios de campos no reflejados aquí; para el esquema JSON exacto en producción, la fuente de verdad sigue siendo el JSON real que llega por correo (ver `purchase_dte_documents`) |
| `codigo_comercio.pdf` | Código de Comercio, Decreto Legislativo N.º 671. **Título II "Contabilidad", Arts. 435-455** — la obligación de llevar contabilidad formal, los registros obligatorios (Estados Financieros, Diario y Mayor), la legalización de libros y el balance anual | Asamblea Legislativa (asamblea.gob.sv) | Agregado el **2026-08-01**. Texto con reformas incorporadas hasta la fecha de publicación del archivo; verificado que contiene los Arts. 435-455 |

**Por qué se agregó el Código de Comercio (2026-08-01).** Faltaba el documento
que en realidad **manda** en materia contable. El Código Tributario define la
contabilidad formal (Art. 139) pero *remite* la obligación: «están obligados a
llevar contabilidad formal los sujetos pasivos que **de conformidad a lo
establecido en el Código de Comercio** o en las leyes especiales están obligados
a ello». Sin este PDF, la cadena de la obligación quedaba cortada.

Ver `docs/CONTABILIDAD-ALCANCE-2026-08-01.md` para qué cubre el portal hoy y qué
no, con los artículos citados.

## 2 · Regulación sanitaria — SRS / DNM

Agregados el **2026-08-16** al definir el módulo de bitácoras. Son los dos
documentos que mandan sobre una farmacia que dispensa: **la guía dice qué se
revisa y con qué gravedad, el reglamento dice los números.**

| Archivo | Contenido | Fuente | Vigencia conocida |
|---|---|---|---|
| `srs_guia_verificacion_bpad.pdf` | «Guía de Verificación de Buenas Prácticas de Almacenamiento y Dispensación de Establecimientos que Dispensan Medicamentos». **Es literalmente la lista con la que el inspector camina la sala**: 8 secciones, cada ítem numerado y clasificado CRÍTICO / MAYOR / MENOR. La sección 2 es almacenamiento y dispensación (temperatura, refrigerador, limpieza); la **sección 3 es antibióticos** (3.1 a 3.22) | Superintendencia de Regulación Sanitaria (srs.gob.sv), carpeta `2025/10` | Publicada octubre 2025 |
| `rts_11020424_bpadyt.pdf` | Reglamento Técnico Salvadoreño **RTS 11.02.04:24** — Productos Farmacéuticos, Buenas Prácticas de Almacenamiento, Distribución y Transporte. 30 páginas. Es donde están **las frecuencias, los rangos y los años de resguardo**: §5.5-5.6 almacenamiento, §6.2 establecimiento (temperatura, humedad, refrigerador), §6.3 personal y regente, **§6.4 dispensación de antibióticos** | OSARTEC (osartec.gob.sv) | Versión del 18/dic/2024 |

**Los `.txt` están al lado a propósito.** Los dos PDFs traen el texto comprimido
y un `WebFetch` sobre ellos devuelve basura binaria — hay que pasarlos por
`pdftotext -layout`. Como al implementar hay que citar números de ítem todo el
tiempo, el `.txt` ya generado evita repetir la conversión y evita la tentación
de citar de memoria.

Los cuatro ítems que más se consultan, para no tener que buscarlos:

| tema | guía | RTS |
|---|---|---|
| temperatura y humedad: 2×/día, ≤30 °C, fecha+hora+persona, 2 años | 2.26, 2.27, 2.34 | 6.2.11, 6.2.15, 6.2.16, 6.2.21 |
| refrigerador: 2×/día, 2-8 °C, termómetro calibrado, uso exclusivo | 2.29 a 2.33 | 6.2.18 a 6.2.20 |
| antibióticos: registro trazable, campos exigidos, parcial/total, copia de receta | 3.3, 3.5, 3.16 a 3.21 | 6.4.1 a 6.4.5 |
| bitácora de visitas del regente | 2.23 | 6.3.7 |

**Ojo con quién regula.** Los textos y la propia guía nombran indistintamente a
la **DNM** (Dirección Nacional de Medicamentos) y a la **SRS**
(Superintendencia de Regulación Sanitaria), que la absorbió. Es el mismo
regulador; al buscar en internet aparecen bajo los dos nombres.

## 3 · Laboral — Código de Trabajo

Descargado el **2026-08-27**, al preguntarse cómo espera la ley ver el «lugar de
pago» en el contrato. Hasta ese día el expediente de personal se construyó
citando artículos **de memoria**, sin el texto en el repo para contrastarlos.

| Archivo | Contenido | Fuente | Vigencia conocida |
|---|---|---|---|
| `codigo_de_trabajo.pdf` | Código de Trabajo, edición rubricada y concordada con las Normas Internacionales del Trabajo (OIT) | colsiba.org (copia de la edición OIT) | Versión actualizada; sin fecha de corte impresa |
| `codigo_de_trabajo.txt` | El mismo, en texto plano | `pdftotext -layout` | — |

⚠️ **Es una copia de una edición, no el diario oficial.** Sirve para leer el
texto y citarlo con precisión; para una actuación con consecuencias —una
inspección, un juicio— la fuente es la Asamblea Legislativa.

⚠️ **Y el `-layout` engaña en ESTE documento.** Va a dos columnas con notas al
margen, así que un artículo se corta a mitad de frase y sigue veinte líneas más
abajo, intercalado con otro. El Art. 129 termina en «…a no ser que» y su
excepción aparece después del Art. 133. Para leer un artículo COMPLETO conviene
extraerlo **sin** `-layout`, que respeta el orden de lectura:

```bash
pdftotext docs/legal/codigo_de_trabajo.pdf - | less
```

Los que ya se usaron, con su ubicación:

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

`REGLAMENTO INTERNO DE TRABAJO FP Y FS.rtf` está **aprobado por la Dirección
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

Se lee con `textutil -convert txt -stdout "docs/legal/REGLAMENTO INTERNO DE TRABAJO FP Y FS.rtf"`.

## ⚠️ Limitación importante

**Ninguno de estos documentos es garantizadamente la versión 100% vigente hoy.**
Los textos legales de El Salvador no tienen una única fuente oficial que
mantenga un "consolidado" público y descargable con TODAS las reformas al
día — eso solo lo ofrecen bases de datos legales pagas (vLex, etc.). Estos
PDFs son los mejores textos oficiales/casi-oficiales disponibles públicamente
al momento de la descarga, con reformas incorporadas hasta las fechas
indicadas arriba.

**Para trabajo de código (nombres de campos DTE, tipos de documento, reglas
de cálculo IVA/retención) esto es suficiente.** Para preguntas legales
sensibles, con implicancia de cumplimiento real (ej. una auditoría, una
disputa con el Ministerio de Hacienda), verificar contra el Diario Oficial
más reciente o un asesor legal/contable — no asumir que estos PDFs son la
última palabra.

## Cómo usarlos

**Los dos de §2 ya tienen su `.txt` al lado** — se grepean directo:

```bash
grep -n "antibiótic" docs/legal/rts_11020424_bpadyt.txt
grep -n -A3 "^3\.17" docs/legal/srs_guia_verificacion_bpad.txt
```

Los de §1 no están indexados como texto plano (a diferencia del Código de
Trabajo, que vive en la memoria de Claude como `.txt` — ver
`reference_el_salvador_codigo_trabajo` en las memorias del proyecto). Para
buscar un artículo específico:

```bash
pdftotext -layout docs/legal/codigo_tributario.pdf - | grep -n "Art. 114"
```

o abrir el PDF directamente. El `-layout` importa: sin él, las tablas de la
guía de la SRS pierden la columna de gravedad y un ítem CRÍTICO se lee igual
que uno MENOR.
