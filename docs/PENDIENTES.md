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
13. Vigilancia continua (cron) y `gate:seguridad`. — SEGURIDAD:228-246
14. ⏸ Carné sólo en su turno y su sala — **en espera de que Talento Humano termine
    de cargar los horarios** (usuario, 2026-10-28). Ciclo de vida del carné. — SEGURIDAD:176-260
15. Un solo camino para armar el perfil (login vs recarga). — AUDITORIA-COMPLETA:371
16. La interfaz deja de leer `user_metadata` (`AuthContext.jsx:1142,1323`).

### Bitácoras SRS y antibióticos
17. **Registro trazable de antibióticos por lote** (entradas, salidas,
    devoluciones, destrucción). Guía 3.3/3.4: CRÍTICO. — BITACORAS:152
18. **Disposición final y devoluciones de antibióticos.** — BITACORAS:172
19. **Borradores de los procedimientos 7–9** (antibióticos, vencidos,
    farmacovigilancia) para que firme el regente. — BITACORAS:142
20. Lote y vencimiento en las inyecciones. — BITACORAS:215
21. Fotos del bucket `recetas` dentro del respaldo semanal. — BITACORAS:306
22. Dueño del lote fundido o vencido en el libro (con datos de noviembre). — BITACORAS:177

### Operación
23. **«Quién responde» en las diferencias de conteo de inventario** (como
    `cortes_caja_diferencia_personas`). — FALTANTES:414-417
24. ~~Vencer los trabajos de impresión encolados~~ — **hecho** (migración `20261028223512`, 10 min). Y avisa a quien lo mandó con «Reimprimir» (`20261028225821`).
25. ~~Pruebas del reparto nocturno de `consolidate-timesheets`~~ — **hecho v2.1357.47**.
26. ~~Unificar la fórmula de la tardanza; `late_minutes ||`~~ — **hecho v2.1357.47**.
27. `inventoryMovements.js:88`: traer `factor` de la base, y revisar el
    `.in('erp_product_id')` sobre `inventory` (columna repetida: puede truncar). — PRODUCTOS:50
28. GPS en Rutas: `vercel.json:99` `geolocation=()` → `(self)`. — DISTRIBUCION:249
29. Purga (o decisión escrita de conservar) de pre-registros, chat, reservas y
    wallet de la app de clientes. — APP-CLIENTES:469
30. Descuento por renglón en ventas (antes: ver si el JSON lo trae). — DESCUENTOS:45

### Higiene y rendimiento (menor)
31. Lista escrita de las 48 tablas sin `created_at` y por qué.
32. Bajar la deuda de `gate:data` (escritura-a-ciegas 35, error-ignorado 26).
33. Separar vendors del chunk de entrada (B2); `pdfjs-dist` a `await import()`.
34. Dos comentarios viejos en `operar-caja/index.ts:2779,2860`; logo vacío en el ticket.
35. Dar de baja el cron `recordar-linea-base-egreso-mensual` (ya cumplió).
36. COFARSAL AP3 → asignar la sala sola (pista sin medir).

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
