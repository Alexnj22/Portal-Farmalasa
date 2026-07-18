# Referencia legal y técnica — Impuestos y Facturación Electrónica (El Salvador)

Documentos descargados el **2026-07-18** para usar como referencia al trabajar
los módulos de **facturación, proveedores, ventas** y cualquier otro tema
fiscal/tributario del portal. Complementa (no reemplaza) las referencias
puntuales ya usadas en el código — ver `docs/resumen-dte-el-salvador.md` para
el resumen de negocio del DTE aplicado a esta farmacia.

## Documentos

| Archivo | Contenido | Fuente | Vigencia conocida |
|---|---|---|---|
| `codigo_tributario.pdf` | Código Tributario, Decreto Legislativo N.º 230 (texto base + reformas incorporadas hasta ~2014) | Asamblea Legislativa, vía eregulations.org | **No incluye las reformas de 2022 en adelante** — ver `decreto_487_reforma_dte.pdf` aparte |
| `decreto_487_reforma_dte.pdf` | Decreto Legislativo N.º 487 (30/ago/2022) — las reformas específicas que introdujeron los Documentos Tributarios Electrónicos (DTE) al Código Tributario: 14 artículos modificados, emisión/transmisión/recepción/invalidación de DTE, contingencias | Asamblea Legislativa (asamblea.gob.sv) | Texto original del decreto — no incorpora reformas posteriores a este mismo decreto (ej. Decreto 960/2024, que tocó Arts. 114 y 119-G, no incluido aquí) |
| `reglamento_codigo_tributario.pdf` | Reglamento de Aplicación del Código Tributario | Ministerio de Hacienda (transparenciafiscal.gob.sv) | Portal oficial de transparencia fiscal |
| `ley_iva.pdf` | Ley de Impuesto a la Transferencia de Bienes Muebles y a la Prestación de Servicios (Ley de IVA) | Ministerio de Hacienda (transparenciafiscal.gob.sv) | Portal oficial de transparencia fiscal |
| `ley_renta.pdf` | Ley de Impuesto Sobre la Renta | Ministerio de Hacienda (transparenciafiscal.gob.sv) | Portal oficial de transparencia fiscal |
| `dte_guia_tecnica.pdf` | "Documento Técnico de Lineamientos de Integración — Facturación Electrónica" (estructura JSON de los DTE, catálogos, firma electrónica) | factura.gob.sv (Ministerio de Hacienda / DGII) | Guía técnica oficial — la normativa DTE 2.0 (2026) puede traer cambios de campos no reflejados aquí; para el esquema JSON exacto en producción, la fuente de verdad sigue siendo el JSON real que llega por correo (ver `purchase_dte_documents`) |

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

Los PDFs no están indexados como texto plano en el repo (a diferencia del
Código de Trabajo, que vive en la memoria de Claude como `.txt` — ver
`reference_el_salvador_codigo_trabajo` en las memorias del proyecto). Para
buscar un artículo específico:

```bash
pdftotext docs/legal/codigo_tributario.pdf - | grep -n "Art. 114"
```

o abrir el PDF directamente. Si en el futuro se necesita grep frecuente sobre
estos textos, conviene generar los `.txt` una vez y guardarlos junto al PDF.
