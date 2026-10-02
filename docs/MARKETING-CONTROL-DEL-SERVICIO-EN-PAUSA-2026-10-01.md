# Marketing — control del servicio: EN PAUSA (2026-10-01)

Se construyó, se publicó (v2.1141.0 y v2.1143.1) y el mismo día el usuario
decidió retirarlo de la pantalla:

> «no me gusta servicio. no lo siento necesario por ahora, dejalo documentado
> pero quitalo.»

Lo que se quitó es **la interfaz**. La base quedó entera y sin uso, a propósito:
retirar tablas y funciones es DDL en producción para nada, y volver a ponerlas
costaría otra migración. Si se decide que no vuelve nunca, ahí sí se borran (ver
«Retirarlo del todo»).

## Qué era

Una pestaña «Servicio» en Marketing que medía el mes del diseñador contra su
oferta (`docs/Oferta a Julio Lozano.pdf`, 30-sep-2026):

| medida | meta | cómo se contaba |
|---|---|---|
| publicaciones | 12 | piezas `post`/`carrusel` **aprobadas** (aprobado, programado o publicado) |
| videos o reels | 4 | piezas `reel`/`video` aprobadas |
| visitas presenciales | 1 | filas de `marketing_visitas` del mes |
| anticipación | 10 días | primera vez que la pieza quedó «Lista para revisión» (historial) contra su fecha − 10 |
| calendario | mes anterior | `marketing_meses.primer_envio_at` contra el día límite del mes anterior, 23:59 SV |
| cambios | — | comentarios tipo `cambio`, y horas hasta la siguiente vez que volvió a estar lista |
| manual de marca | — | recursos tipo `manual` subidos a Marca en el mes |
| extraordinarias | — | solicitudes del mes, entregadas y días de entrega |

Calendario y anticipación eran exentos antes de `marketing_ajustes.control_desde`
(2026-11-01): octubre empezó con la oferta ya firmada a fin de septiembre.

Más un **cierre mensual**: quien aprueba firmaba Cumplió / Con observaciones /
No cumplió (las dos últimas exigían escribirlas), el acta congelaba los números
de ese momento en `marketing_cierres.resumen`, se descargaba en PDF con espacio
para las dos firmas y avisaba al diseñador. No bloqueaba el mes; volver a firmar
reemplazaba el acta. Y una tendencia de 6 meses para evaluar el período de prueba.

## Qué sigue vivo en la base (sin pantalla)

- Tablas `marketing_visitas` y `marketing_cierres` (vacías; RLS y permisos puestos).
- Funciones `marketing_cumplimiento(uuid)` y `marketing_cerrar_mes(uuid, text, text)`.
- Columnas de metas en `marketing_ajustes`: `meta_publicaciones`, `meta_videos`,
  `meta_visitas`, `dias_anticipacion`, `control_desde`.
- `marketing_meses.primer_envio_at` — lo sigue escribiendo `marketing_publicar_mes`.
  Es inofensivo y deja la historia hecha si el control vuelve.

**Lo que NO se quitó porque no era del control**: el OK por pieza
(`marketing_enviar_pieza`, `enviada_at`), el aviso a las salas al liberar, el
rótulo «Lista para revisión» y el tipo «Manual de marca» de la biblioteca.

Migraciones: `20261002020220_marketing_control_del_servicio.sql` (todo junto con
el OK por pieza) y `20261002020915_marketing_anticipacion_exenta_en_octubre.sql`.

## Volver a ponerlo

El código de la pantalla está en git, en el último commit antes de retirarlo
(buscar `git log --diff-filter=D -- src/views/marketing/TabServicio.jsx`):

- `src/views/marketing/TabServicio.jsx` — la pestaña.
- `src/utils/marketingActa.js` — el acta en PDF (pdfmake por `import()`; necesita
  su excepción `hex` en `scripts/design-gate.mjs` y su línea en `auditoria/areas.mjs`).
- En `src/data/marketing.js`: `fetchCumplimiento`, `fetchMesesConCierre`,
  `cerrarMes`, `fetchVisitas`, `registrarVisita`, `quitarVisita`, y las columnas
  de metas en el `select` de `fetchAjustes`.
- En `src/utils/marketing.js`: `RESULTADOS_CIERRE` y `resultadoCierreDe`.
- En `MarketingView.jsx`: la pestaña `servicio` (visible a quien edita o
  aprueba) y el selector de mes también en esa pestaña.
- En `AjustesModal.jsx`: la sección «Metas del servicio», que guarda al salir
  del campo.

Antes de reactivarlo, revisar si la oferta cambió (fin de los 6 meses de prueba).

## Retirarlo del todo

Si se decide que no vuelve: una migración que haga `DROP FUNCTION
marketing_cerrar_mes, marketing_cumplimiento`, `DROP TABLE marketing_cierres,
marketing_visitas`, quite las cinco columnas de metas de `marketing_ajustes`, y
saque las dos tablas de `auditoria/areas.mjs`. `primer_envio_at` puede quedarse.
