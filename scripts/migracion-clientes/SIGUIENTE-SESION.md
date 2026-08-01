# Prompt para la próxima sesión

Copiá esto tal cual:

---

Retomá la migración de fichas de clientes ERP ↔ portal.

**Leé primero `scripts/migracion-clientes/README.md`** — tiene el estado
completo, las reglas, lo que hay que saber del ERP y las decisiones abiertas.
Está escrito para retomar sin contexto previo.

Resumen de dónde quedó (2026-08-01, 06:00 UTC): 585 fichas procesadas de 27,569,
582 clientes portados al portal, cero campos perdidos y cero alterados. El
script se loguea solo con las credenciales del `.env`, así que no hay cookie que
refrescar. `python3 refrescar_catalogo.py` para actualizar el índice del
catálogo, y `python3 probar_offline.py` tiene que pasar en verde antes de tocar
nada.

Antes de seguir con los bloques, hay dos mejoras que valen más que avanzar:

1. **Reintento automático** cuando el ERP responde algo distinto de `Success`.
   Pasó una vez en 365 escrituras —devolvió `"Proceso no encontrado"` en texto
   plano— y el mismo payload entró a la primera al reintentarlo. A escala de
   20,000 escrituras serían ~55 interrupciones que hoy requieren intervención.

2. **Modo `--una-pasada`**: leer, corregir, verificar y espejar cada ficha antes
   de pasar a la siguiente, en vez de las dos fases actuales. No cuesta ni una
   petición más —son las mismas 1,230 por bloque de 500— y elimina el hueco
   entre la lectura y la escritura, que hoy puede ser de 15 minutos. Como el
   POST manda los 21 campos, ese hueco es la única forma en que podríamos pisar
   una edición hecha por otra persona en el ERP. La simulación sigue disponible
   para revisar un plan antes.

Después, los bloques: `python3 bloque.py --desde-erp 500` para simular y
`--escribir` para aplicar, y `python3 aplicar_espejo.py --aplicar` para el
espejo. Con la latencia real medida (1.37s por petición) cada bloque de 500 es
~37 minutos.

Dos cosas que van a aparecer y conviene reconocer:

- **La rama del salto** (categoría ≠ Consumidor) todavía no corrió en vivo. Se
  estrena en el bloque 2 o 3, con la ficha `erp 1419` — FRANCISCO NOE LEMUS
  UMAÑA, Contribuyente, ya verificado. Esa ficha **no** se edita en el ERP pero
  **sí** se espeja al portal. Es el comportamiento correcto, no un error.
- **Las 4 fichas duplicadas** (`FELIX ANTONIO RECINOS CARCAMO`,
  `NURIA ROXANA VILLANUEVA`, `YNES ANTONIO ARDON`) están corregidas en el ERP
  pero su espejo no se puede aplicar hasta decidir cuál `erp_id` gana. Ver
  `duplicados_erp.json`: 19 nombres duplicados en total, 11 que difieren solo en
  espacios.

Y antes de la corrida larga: son **~34 horas** de tráfico contra el servidor del
proveedor. Conviene avisarle a soporte del ERP — no por permiso, sino para que
nadie vea un cambio masivo y decida restaurar de backup.

**Ojo con `src/version.js`**: hay otra sesión construyendo el módulo de Clientes
(va por v2.319.0). Leé la versión del disco en el momento y no asumas.

---

## Contexto adicional si hace falta

- El prompt del módulo de Clientes está en `docs/PROMPT-MODULO-CLIENTES.md`.
- Los 11 DUI borrados, con su número original, están en `revision_manual.json`.
- El changelog de las tres versiones de este trabajo (2.317.0, 2.317.1, 2.317.2)
  cuenta el hallazgo del `.strip()` y por qué los valores viajan crudos.
