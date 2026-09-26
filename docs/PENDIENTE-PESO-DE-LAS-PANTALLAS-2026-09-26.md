# Pendiente: el peso de las pantallas (`gate:bundle` en rojo) — 2026-09-26

**Estado: ABIERTO, aplazado por decisión del usuario** para seguir con el plan
del núcleo portable. No es parte de ese plan (F0–F8 no tocan el peso).

## Qué pasa

`npm run gate:bundle` ya fallaba en `main` antes de v2.1075.28 (se comprobó
compilando las dos versiones: el diff de pesos era vacío). Nadie lo notó porque
el gate **no corre en el pre-commit** — necesita un `npm run build` antes.

Ya se bajó en v2.1075.30:

| | antes | después | cómo |
|---|---:|---:|---|
| NotificationBell (va en TODAS las pantallas) | 71 kB | 37 kB | la tarjeta de aviso se carga al abrir la campana |
| CortesView | 115 kB | 107 kB | `utils/imprimirDiferido.js`: la ticketera se carga al imprimir |
| MiCajaView | 91 kB | 86 kB | ídem |

## Lo que queda sobre el techo (medido el 2026-09-26)

| | mide | techo | exceso |
|---|---:|---:|---:|
| entry (carga inicial) | 307 kB | 296 kB | +11 |
| CortesView | 107 kB | 73 kB | **+34** |
| MetasView | 75 kB | 67 kB | +8 |
| BolsasView | 70 kB | 62 kB | +8 |
| BitacorasView | 87 kB | 80 kB | +7 |
| VentasView | 72 kB | 66 kB | +6 |
| NotificationBell | 37 kB | 33 kB | +4 |
| MaintenanceView | 41 kB | 37 kB | +4 |
| PermissionsView | 53 kB | 50 kB | +3 |
| GestionStockView | 55 kB | 53 kB | +2 |
| MinMaxView / ConteoDetailView | 90 / 71 kB | 89 / 70 kB | +1 |

Y 8 vistas nuevas sin techo propio (MiCaja, Notificaciones, Promociones,
Puntos, SolicitudesDatos, CuentasPorCobrar, MisPuntos, `creditos`).

## Lo que se sabe de la causa

- **El entry no tiene un culpable.** Comparado contra la compilación del
  2026-08-27 (cuando medía 294): +13 kB repartidos en código propio nuevo
  (`busqueda.js`, `turnoDelDia.js`, `fecha.js`, `hora.js`, más lógica en
  `employeeSlice`/`requestsSlice`/`systemSlice`). Las librerías no crecieron.
  Bajarlo exige sacar slices del store del arranque — cambio de riesgo.
- **Cortes** es el único exceso grande y merece mirarse a fondo: su cierre
  estático trae `FilterBar`, `PeriodPicker`, `FileField`, `BarraFlotante`,
  `MovimientosDeCaja`, `bolsas.js` y `cortesDiagnostico.js`.
- Lo que queda en la campana (37 kB) es `useAccionesDeAviso` y su cierre
  (bolsas, cortes, resolver corte): es un hook, diferirlo exige partir el
  componente.

## Cómo medir (el instrumento que se usó)

```bash
npx vite build --outDir dist-mapa --sourcemap
# cierre estático de un chunk, restando el entry, agrupado por archivo fuente:
node cierre.mjs <Vista>-<hash>.js <index-hash>.js
```

El script (`cierre.mjs`) sigue los `import` estáticos entre chunks, reparte el
gzip de cada chunk entre sus fuentes según el sourcemap, y resta lo que ya está
en el entry. Vivió en el scratchpad de la sesión; si hace falta de nuevo, es
corto de reescribir.

## Opciones cuando se retome

1. Recortar Cortes a fondo (lo más grande y lo más concreto).
2. Subir los techos restantes a lo medido, **cada uno con su motivo escrito**
   en `scripts/bundle-gate-baseline.json` (regla: nunca sin motivo y sin OK del
   usuario), para que el gate vuelva a vigilar desde acá.
3. Evaluar correr `gate:bundle` en algún punto automático (CI), porque hoy se
   puede quedar en rojo semanas sin que nadie lo vea.
