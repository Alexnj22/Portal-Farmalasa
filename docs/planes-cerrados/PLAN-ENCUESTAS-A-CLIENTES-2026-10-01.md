# Encuestas a clientes — plan (2026-10-01)

Pedido: que marketing pueda medir atención, percepción de la empresa y otras
situaciones con encuestas a clientes, anónimas o por entrevista, con un ciclo
borrador → aprobación → publicación, una meta de muestra por tiempo o cantidad,
y alcance general o por sucursal.

## Por qué NO se reutiliza el módulo de encuestas que ya existe

`surveys` / `survey_preguntas` / `survey_responses` (EncuestaAdminView) son de
**clima laboral**: `survey_responses.employee_id` es obligatorio y todo el
análisis gira alrededor del empleado y su jefe. Meter clientes ahí obliga a
volver opcional la columna que sostiene esas pantallas. Se crean tablas propias
con prefijo `encuesta_cliente_*`; se reutilizan los **componentes** visuales
(barras, distribución, resumen con IA), no las tablas.

## Decisiones del usuario (2026-10-01)

| tema | decisión |
|---|---|
| canales | QR/enlace público, entrevista desde el portal, tablet de mostrador |
| aprobación | Gerente General |
| identidad en entrevistas | opcional, **con consentimiento**; sin él, anónima |
| incentivo | configurable por encuesta: ninguno, puntos o muestra médica |
| antifraude del incentivo | sólo con ficha o teléfono; **uno por persona por encuesta**. El anónimo puro responde sin premio |
| entrega | la muestra médica la entrega quien acompaña la encuesta (entrevistador); los puntos se acreditan solos en la cuenta del cliente |

## Ciclo de vida

```
borrador ──enviar──▶ en_revision ──aprobar──▶ aprobada ──publicar──▶ publicada ──▶ cerrada ──▶ archivada
    ▲                    │
    └──── rechazar ──────┘   (con comentario obligatorio)
```

- Se edita **sólo en borrador**. Publicada = congelada: cambiar algo es
  *duplicar como versión nueva* (`version`, `origen_id`), para que dos rondas
  se puedan comparar.
- **Cierre automático** por la primera condición que se cumpla: `fecha_fin` o
  meta de respuestas alcanzada (total o, si es por sucursal, todas las cuotas).
  Un cron diario barato cierra las vencidas; la meta se evalúa al insertar.
- Cada transición deja fila en `encuesta_cliente_eventos` (quién, cuándo,
  comentario) y en `audit_logs`.

## Modelo de datos (borrador)

- `encuesta_cliente` — nombre, objetivo, estado, version, origen_id, canales
  (`text[]`: qr, entrevista, kiosco), alcance (`general` | `sucursales`),
  sucursales (`int[]`), fecha_inicio/fin, meta_total, incentivo_tipo
  (`ninguno` | `puntos` | `muestra`), incentivo_puntos, incentivo_nota,
  pide_consentimiento, mensaje_bienvenida/cierre, creada_por, aprobada_por.
- `encuesta_cliente_cuota` — encuesta + sucursal + meta (cuando la meta es por
  sucursal).
- `encuesta_cliente_dimension` — catálogo (Atención, Percepción de marca,
  Precio, Surtido, Tiempo de espera, Limpieza, Recomendación…), editable.
- `encuesta_cliente_seccion` / `encuesta_cliente_pregunta` — tipo, texto,
  ayuda, obligatoria, opciones (`jsonb`), dimension_id, `condicion` (`jsonb`:
  mostrar si la pregunta X cumple Y), orden.
- `encuesta_cliente_respuesta` — encuesta, sucursal, canal, entrevistador_id
  (empleado, si aplica), customer_id (sólo con consentimiento), telefono_hash
  (para «uno por persona» sin guardar el número en claro cuando no hay ficha),
  consentimiento_at, respuestas (`jsonb`), nps (columna derivada para agregar
  rápido), duracion_seg, dispositivo_hash, created_at.
- `encuesta_cliente_incentivo` — respuesta, tipo, puntos, entregado_por,
  entregado_at. Índice único `(encuesta_id, customer_id)` y
  `(encuesta_id, telefono_hash)` = la regla «uno por persona».
- Plantillas: una encuesta con `es_plantilla = true` (se duplica igual que una
  versión).

**Tipos de pregunta:** NPS 0–10, CSAT caritas 1–5, Likert 1–5, opción única,
opción múltiple, sí/no, ranking, número, texto abierto.

## Canales

1. **QR / enlace público** — ruta pública `/e/:token`, sin login. El token es
   por encuesta **y** sucursal (así la sucursal no se pregunta, viene en el QR).
   Entra por una RPC/edge function para `anon` que valida token, estado
   `publicada` y fechas, y nada más. **Se declara en
   `auditoria/superficie-anon.json` con su guarda** (regla 4). Antifraude
   básico: hash de dispositivo + límite por ventana de tiempo.
2. **Entrevista** — dentro del portal, con sesión. Se elige sucursal (default:
   `empleado_sala_de_hoy`), se pregunta consentimiento; con sí, se busca la
   ficha o se anota el teléfono. Guarda borrador local (`saveDraft`) porque la
   sesión de sala se cierra a los 5 min.
3. **Tablet de mostrador** — el mismo formulario público en modo kiosco (vuelve
   solo al inicio tras X segundos sin uso). Reusa el mecanismo de dispositivos
   del kiosco de marcación si encaja.

## Incentivo

- Sólo si la respuesta trae ficha o teléfono **y** consentimiento.
- **Puntos:** al guardar la respuesta, la función del servidor los acredita con
  el mecanismo de `puntos_ajustar` (motivo `encuesta`, referencia a la
  respuesta). Nada lo dispara el navegador: así no se puede pedir dos veces.
  Si hay teléfono sin ficha: se busca la ficha por teléfono; si no existe,
  queda «pendiente de asignar» (como `puntos_panel_pendientes`).
- **Muestra médica:** la pantalla de cierre se lo dice al entrevistador y él
  marca «entregada»; queda registro de quién, cuándo y qué para el reporte de
  costo. En el QR anónimo no aplica (no hay quien la entregue) — a confirmar.

## Muestra

- Calculadora sugerida al configurar: con los clientes únicos atendidos por
  sucursal en los últimos 90 días (de `sales_invoices`, vía RPC), tamaño para
  95% de confianza y ±5% de margen. Es una **sugerencia**; la meta la decide
  marketing.
- Tablero de avance: por sucursal, «42 de 80», ritmo diario y proyección de
  cierre.

## Resultados

- NPS (promotores − detractores), CSAT y puntaje por dimensión; general, por
  sucursal, por canal y contra la versión/ronda anterior.
- Distribución por pregunta y cruce simple (p. ej. NPS por sucursal × canal).
- Comentarios abiertos con resumen de IA (`preguntarASaly`, como clima
  laboral).
- **Alerta de detractor:** NPS ≤ 6 con comentario → aviso al supervisor de la
  sucursal (y al cliente identificado se le puede dar seguimiento).
- Exportar con `exportCsv` (módulo `encuestas-clientes`), sin nombrar sistemas
  de origen.
- Todas las agregaciones del lado del servidor (`RETURNS json`) — las
  respuestas crecen sin techo y PostgREST corta en 1000.

## Permisos (módulo nuevo en `permissionModules`)

| acción | quién |
|---|---|
| diseñar / editar borradores | marketing |
| aprobar / rechazar | Gerente General (permiso `can_edit` de aprobación) |
| aplicar entrevistas | quien tenga el permiso (marketing, personal de sala designado) |
| ver resultados | marketing, gerencia, supervisores (sólo su sucursal) |

## Fases

1. **Base:** tablas + RLS, constructor (secciones, preguntas, dimensiones,
   plantillas, vista previa), ciclo borrador → aprobación → publicación.
2. **Captura:** entrevista desde el portal + formulario público QR + modo
   tablet; meta y cierre automático.
3. **Incentivos:** puntos automáticos y registro de muestras.
4. **Resultados:** tablero, comparativas, IA, alertas de detractor, CSV.

Cada fase se prueba primero en el entorno de pruebas (`npm run dev:staging`).

## Cerrado (2026-10-01, segunda ronda)

- **Sección propia** del menú (`/encuestas-clientes`), no pestaña de Marketing.
  Ruta pública aparte: `/e/:token`.
- **Muestra médica sólo en presencial** (entrevista o tablet acompañada). En el
  QR anónimo el tipo `muestra` no se ofrece.
- **Consentimiento:** sin revisión legal externa (el usuario: «el delegado
  desaparece, la ley fue removida»). Se mantiene una casilla simple de
  consentimiento antes de ligar ficha o teléfono; el texto es configurable por
  encuesta.
