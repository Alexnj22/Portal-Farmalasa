# Pendientes — la lista única (verificada el 2026-10-28, v2.1357.32)

**Ésta es LA lista de lo que falta.** Se armó leyendo las secciones de «falta»
de todos los documentos de `docs/` y comprobando cada punto contra el código y
la base de producción (sólo lectura). Lo que los documentos daban por pendiente
y ya estaba hecho NO aparece acá.

Al cerrar un ítem: se borra de acá (y del documento de origen si lo nombra).
Al descubrir uno nuevo: se agrega acá, no sólo en el documento del módulo.

Cuatro estados, y no se mezclan:

| | significa | quién lo destraba |
|---|---|---|
| **A. Construir** | código o base que no existe | una sesión de trabajo |
| **B. Decidir** | espera una decisión | el usuario, la contadora o el regente |
| **C. Probar en sala / cargar** | está hecho, falta usarlo de verdad o cargar un dato | alguien en sucursal |
| **D. Planes largos** | trabajo de varias sesiones con su propio documento | ver abajo |

---

## ⚠️ Primero: saberlo

**Desde el 19-oct, las facturas de consumidor final de las 6 pm en adelante no
se mandan a Hacienda** (decisión del usuario, `regularizar-dte/index.ts:84-99`).
Medido el 28-oct: **1,174 facturas, ~$9,700, ~20% de cada día**, sin sello.
Consecuencia: **no entran al libro de IVA** (Art. 119-D: el libro sólo lleva lo
sellado). La contadora tiene que saberlo, y cualquier alerta de «sello
pendiente» (A2) tiene que excluirlas o sonará todas las noches.

---

## A. Construir — ordenado por importancia

### Fiscal y contabilidad
1. ~~Guarda contra el archivo contaminado del origen~~ — **hecho v2.1357.36**
   (desplegada, versión 45 de `sync-erp-purchases`).
2. ~~Alerta de sello pendiente y de sello sobre un mes declarado~~ — **hecho
   v2.1357.39** (`avisar_ventas_sin_sello`, cron 8:10 SV).
3. ~~`generar_csv_libro` sin sucursal devolvía 0 filas~~ — **hecho v2.1357.41**
   (ahora falla con el motivo).
4. ⏸ **Anexos de compras, percepción, ventas y anulados con la forma oficial**
   (anexo 3 F-07, anexo 8, anexo 1 col. G, anulados con 36) — **en espera: se arma
   con la contadora** (decisión del usuario, 2026-10-28). Ver «De la contadora».
5. (unido al 4)
6. ~~Exportar el año entero~~ — **no hace falta hoy**: la pantalla sólo pide un mes,
   y el mes más cargado (7 salas) no llega a 400 filas contra el techo de 1000.
   Se hace el día que se pida exportar el año.
7. ~~Motivo obligatorio en «Otros descuentos» de la planilla~~ — **hecho v2.1357.43**.
8. ⏸ Cargar la compra confirmada en el sistema de la caja (`compras.php`) — **en espera
   por decisión del usuario** (2026-10-28). — AUDITORIA-MATCH-DTE:130
9. Notas de crédito → puntos (`docs/propuestas/notas-credito-puntos-2026-10-09/`):
   esperar la primera NC real.

### Seguridad y acceso (cada uno pide además una decisión; ver SEGURIDAD-Y-ACCESO)
10. **El PIN deja de ser la contraseña de la cuenta del carné** — etapa 1 (pase
    de un solo uso) **hecha y probada en pruebas, v2.1357.46**. Falta: subir función
    + web el domingo 01:00–04:00 SV; días después, la etapa 2 (contraseñas al
    azar), con OK del usuario. — SEGURIDAD:59-110
    Después: **carné sólo en su horario** (ítem 14), sobre esta misma puerta,
    primero en modo aviso.
11. ⏸ **Carné sólo desde terminal registrada + tope de intentos** — **en espera:
    el usuario dijo «por el momento no» (2026-10-28)**. Remedido ese día: 1
    terminal (La Popular) en 7 salas. — SEGURIDAD:112-134
12. Segundo humano y dispositivo conocido: los interruptores existen y nada los
    consulta. — SEGURIDAD:156-226
    · **Dispositivo conocido (§3.6): ⏸ en espera — el usuario dijo «por el
      momento no» (2026-10-28).**
    · **Segundo humano (§3.4): ⏸ en espera — el usuario lo validará más
      adelante (2026-10-28).** Falta que elija qué acciones lo llevan (anular,
      transmitir a Hacienda, cambiar contraseña de otro, descarga masiva) y
      quiénes confirman.
13. ~~Vigilancia continua (cron) y `gate:seguridad`~~ — **hecho** (migración
    `20261029023934`; desde `20261029025157` avisa sólo a Edwin Núñez). — SEGURIDAD:228-246
14. ⏸ Carné sólo en su turno y su sala — **en espera de que Talento Humano termine
    de cargar los horarios** (usuario, 2026-10-28). Ciclo de vida del carné. — SEGURIDAD:176-260
15. ~~Un solo camino para armar el perfil (login vs recarga)~~ — **hecho v2.1357.56**:
    todos los logins y la recarga usan `leerMiPerfil()`. — AUDITORIA-COMPLETA:371
16. ~~La interfaz deja de leer `user_metadata`~~ — **hecho v2.1357.56**.

### Bitácoras SRS y antibióticos
17. ~~Registro trazable de antibióticos por lote~~ — **hecho v2.1358.0**
    (Bitácoras → Registro por lote; foto diaria por lote desde el 28-oct).
    Devoluciones y destrucción entran con el ítem 18.
18. ⏸ **Disposición final y devoluciones de antibióticos** — **en espera: se arma
    con los procedimientos que el usuario ya tiene hechos y todavía no subió**
    (usuario, 2026-10-28). — BITACORAS:172
19. ⏸ **Procedimientos 7–9** (antibióticos, vencidos, farmacovigilancia) —
    **en espera: el usuario ya los tiene hechos y los va a subir** (2026-10-28).
    — BITACORAS:142
20. ~~Lote y vencimiento en las inyecciones~~ — **hecho v2.1359.0** (obligatorio al cobrar cuando la factura no lo dice). — BITACORAS:215
21. ⏸ **Fotos del bucket `recetas` dentro del respaldo semanal** — **en espera de
    una receta real para probar la compresión** (usuario, 2026-10-29). Plan
    acordado: (a) comprimir al subir con `reducirAJpeg` de `@plataforma/imagenes`,
    lado máximo ~2000 px y calidad 0.85 (lo mismo que `capturaDesdeElTelefono`):
    ~400 KB en vez de ~3 MB; mostrarle al usuario original y comprimida lado a
    lado antes de fijarlo. (b) `backup-critical-tables` copia cada domingo SÓLO
    las fotos nuevas a `backups/recetas/…` y **nunca las borra** (son
    expediente; la ventana de 60 días es sólo para los volcados de tablas).
    Volumen: 157 ventas con receta en sep-2026 → ~1.1 GB/año con respaldo,
    comprimidas. Hoy el bucket está vacío (0 fotos). — BITACORAS:306
22. Dueño del lote fundido o vencido en el libro (con datos de noviembre). — BITACORAS:177

### Operación
23. ⏸ **«Quién responde» en las diferencias de conteo de inventario** (como
    `cortes_caja_diferencia_personas`) — **en espera: el usuario lo tiene que
    hablar con gerencia** (2026-10-29). Propuesta: al cerrar un conteo con
    diferencia en dinero, pedir quién responde, cuánto y por qué vía, igual que
    caja. — FALTANTES:414-417
24. ~~Vencer los trabajos de impresión encolados~~ — **hecho** (migración `20261028223512`, 10 min). Y avisa a quien lo mandó con «Reimprimir» (`20261028225821`).
25. ~~Pruebas del reparto nocturno de `consolidate-timesheets`~~ — **hecho v2.1357.47**.
26. ~~Unificar la fórmula de la tardanza; `late_minutes ||`~~ — **hecho v2.1357.47**.
27. ~~`inventoryMovements.js`: `factor` de la base y `.in()` sin corte~~ — **hecho v2.1359.7**. — PRODUCTOS:50
28. ~~GPS en Rutas en el navegador~~ — **cerrado sin cambio**: el GPS es sólo para las apps (usuario, 2026-10-01 y reconfirmado 2026-10-29). `geolocation=()` en `vercel.json` se queda a propósito; la app usa el GPS nativo, que ese encabezado no toca. — DISTRIBUCION:249
29. ~~Plazos de datos de la app de clientes~~ — **hecho v2.1360.0**. — APP-CLIENTES:469
30. ✅ Descuento por renglón en ventas (2026-10-29, v2.1364.0). El JSON no lo trae; se separa campaña / a mano cruzando con la copia de las campañas. Promociones → Rebajas. — DESCUENTOS §2
31. 💜 **Volver a traer a Sally, la IA del portal, con algo que decir** (usuario,
    2026-10-29: «me da nostalgia quitarla»). Su «Diagnóstico» se quitó de la
    tarjeta de Sucursales y de la ficha de la app (v2.1373.0) porque sólo le
    repetía a la IA lo que la tarjeta ya mostraba (`datosParaElDiagnostico`,
    sin un dato nuevo). La edge function `analyze-branch` sigue desplegada —la
    usa también el análisis del personal en `TabStaff`— y
    `datosParaElDiagnostico` quedó en `src/utils/sucursales.js` sin lector.
    Vuelve como la voz del ítem 32, no como un botón.
32. **Resumen diario de cada sucursal con IA** (usuario, 2026-10-29). Un widget
    en la tarjeta (una línea: lo más urgente) y un panel en la ficha (el
    detalle, cada número a la vista). Diseño acordado:
    - Un cron de madrugada calcula los indicadores de cada sala **en SQL**;
      la IA no calcula nada, sólo redacta en 2-3 líneas lo que se salió de lo
      normal. Se guarda por día, así se ve cómo cambió.
    - Cada número se compara con la historia de **la misma sala** (no un
      umbral fijo): «vende 18% menos que su promedio de los martes».
    - Día sin nada fuera de lo normal → «Sin novedades», sin relleno.
    - No repetir Inicio ni Ventas: el valor es cruzar módulos por sala.
    - Candidatos (falta que el usuario elija): ventas contra su historia y la
      meta · faltantes de alta rotación · cortes con diferencia · ausencias y
      tardanzas · productos por vencer · documentos de la sala por vencer.


### Higiene y rendimiento (menor)
31. ✅ Las 48 tablas sin `created_at`, con su motivo (2026-10-29): `auditoria/tablas-sin-created-at.json`, en 4 grupos. `gate:auditoria` falla si aparece una nueva sin declarar.
32. ✅ Deuda de `gate:data` en cero (2026-10-29): escritura-a-ciegas 35→0, error-ignorado 26→0, las dos bloqueantes en cero.
33. ✅ Vendors fuera del entry y `pdfjs` por `import()` (2026-10-29). Facturas de compra 138→10 kB; tras cada deploy se bajan 184 kB en vez de 303 (React y Supabase quedan en caché); el arranque en frío no cambia (303 kB).
34. ✅ Comentarios de `operar-caja` corregidos (2026-10-29): decían que cerrar el turno emite el Z; desde el 1-sep el Z sale antes por `hacer-corte-caja`. Logo: el icono (sin el nombre) va en todo ticket con la marca arriba, por los tres caminos (`logoTicket.js`). **Falta verlo en papel** en una sala.
35. ✅ Cron `recordar-linea-base-egreso-mensual` y su función retirados (2026-10-29). El techo se decidió el 2026-10-01; desde entonces devolvía 0.
36. ~~COFARSAL AP3 → asignar la sala sola~~ Descartado (2026-10-29): todas las compras se cargan en Bodega. Facturas de Sala abre sólo Bodega y la base rechaza otra sala; Movistar dejó de repartirse por línea.

---

## B. Decidir

**Del usuario**
- Asistencia: aplicar la tolerancia de 10 min por semana del RIT Art. 26 (pasarla pierde el pago del descanso) — hoy la tardanza sólo se anota. Decide Talento Humano.
- Seguridad: ventana para el cambio del PIN; qué acciones llevan segundo humano y quiénes; borrar las 8 cuentas huérfanas (ya baneadas); fila `lectura_masiva`.
- Caja: alcance ALL de Talento Humano en `caja_vales`; enlazar el aporte del depósito a su vale; más de una caja por sala; reembolso del banco por remesas.
- Impresión: igualar el HTML a 54 columnas; reimprimir un documento fiscal.
- Recetas: ¿puede la foto de una receta salir del portal? (bloquea su lectura); receta sin J.V.P.M.; pasar el lector de boletas a Claude.
- Pedidos: confirmación de lote sólo en controlados.
- Avisos: qué eventos llevan push; «recibido con observaciones» avisa a alguien o no.
- Marketing: volver a poner el control del servicio o retirarlo.
- Teléfono: borrar el remontaje apagado y la sonda (F9 en pausa).
- `libros/` con nombres de clientes en la raíz del repo: mover o borrar.
- Nómina: quitar `night_hours_extra`.
- Bono de metas como umbral escrito.
- Clientes: 18 fichas `sin_numero_erp`; 8 anulaciones en lista negra.

**De la contadora**
- Asistencia (ASISTENCIA §7-bis): confirmar hora extra nocturna ×2.25; si «tiempo compensado» por horas extra es legal.
- **Armar los anexos de Hacienda** (ítem A4): traer un anexo que ella haya subido de verdad y ajustar el formato contra ese.
- Método de costeo (destraba costo histórico → registro Art. 142-A → contabilidad formal → F-971).
- Primer período fiscal y con qué libro; 2 o 4 decimales; 26 clasificaciones condicionadas; quién retiene renta (0/175); F-983/F-987; anulados tipo `1` vs `01`; las 14 preguntas de CONTABILIDAD:225-276.

**Del regente / gestiones externas**
- Nombrar al Regente en el portal (destraba cierres, AWaRe, firmas). Cargar las fichas de los dos regentes químicos.
- Confirmar el grupo AWaRe (0/33); firmar procedimientos A, B, C, E; evaluación periódica del sistema.
- Pedir a la SRS la resolución del listado de antibióticos; sistema de estupefacientes.
- Refrigerador en cada sala; calibrar el de Bodega (42 lecturas seguidas en 8.0 °C).

---

## C. Probar en sala / cargar un dato

- **Ninguna de las 31 áreas tiene sello de sala** (`auditoria/registro.json`). Las más bajas: traslados y compras (65), acceso y pedidos (71).
- **Nómina: nunca se generó un período real** (0 filas) — 32 empleados ya tienen sueldo.
- Bitácoras: el libro arranca el **1-nov**; capacitar a la sala; corregir 3 humedades imposibles de octubre; cerrar sep/oct en las 6 salas; 47 inyecciones traídas sin ficha.
- Pedidos: devolución por daño con foto (nunca ocurrió); rama «sólo bodega»; lote que vuelve.
- Inventario: ajustar los 8 conteos finalizados (0 aplicados); los $777.73 de Bodega.
- Compras: cargar `dias_credito` (0/175); primer pago a proveedor real.
- DTE: la segunda vuelta nunca se ejecutó; ningún `RECHAZADA_POR_HACIENDA` real.
- Torogoz (distribución): cargar el emisor, los 4 secretos `DIST_MH_*` y el primer DTE de pruebas.
- App de clientes: capturas y notas de tienda; Sentry sin IP; ITMS-91053 en la próxima build.
- Teléfono real: el recorrido de `PRUEBA-EN-TELEFONO-REAL.md`; tabs con un solo módulo; Horarios.
- Boleta que no es boleta no deja guardar; reprobar las 2 recetas ilegibles.
- El resto de «falta probar en sala» vive en la memoria (`INDICE-abierto.md`).

---

## D. Planes largos

| plan | estado |
|---|---|
| [Auditoría total por lotes](auditoria-2026-09-02/PLAN.md) | 20 lotes, **ninguno corrido** |
| [Núcleo portable](PLAN-NUCLEO-PORTABLE-2026-09-24.md) | sólo F7 paso 2, **pospuesto por el usuario** |
