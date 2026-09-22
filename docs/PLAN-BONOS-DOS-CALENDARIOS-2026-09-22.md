# Plan — los bonos se pagan en dos calendarios, no en una hoja mensual (2026-09-22)

## Por qué existe

La pestaña «Liquidación» de `/promociones` es una hoja MENSUAL que junta el bono
de meta, los de promociones por producto, los de laboratorio y los excedentes
(Fase 5 de `PLAN-PROMOCIONES-2026-09-01.md`). No corresponde a ningún pago real.
El usuario vio un «borrador» (agosto 2026: 24 personas, $554.64, sólo bono de
meta, marcado informativo, nunca aprobado) y no pudo saber qué era ni por qué
estaba en Promociones.

Regla de pago, dicha por el usuario el 2026-09-22:

| bono | cuándo se paga | cómo |
|---|---|---|
| **de meta (ventas)** | 2 veces al año: ene–jun en la **1ª quincena de julio**, jul–dic en la **1ª quincena de enero** | acumulativo = **la suma del bono de cada mes** del semestre |
| **de producto (promociones)** | en cada sala | **salida de efectivo** de la caja |

Decisiones del mismo día:

- El bono de meta **va aparte** de Promociones.
- Quien se va de la empresa antes del día de pago: **lo decide gerencia, caso
  por caso**. El portal muestra lo acumulado y pide la decisión; no paga ni
  niega por su cuenta.
- Bono de producto: un botón **«Pagar»** que hace la salida de caja y le indica
  a la sala que saque el efectivo del cajón.

---

## Fase 1 — quitar la hoja mensual · ✅ pantalla (v2.1032.0), tablas y borrador (v2.1032.1, migración `20260922214007`)

- Se quita la pestaña «Liquidación» de `/promociones` (`TabLiquidacion.jsx`,
  `src/data/liquidacion.js`).
- El borrador de agosto (`liquidacion` id 3) se descarta (🔒 escritura en
  producción, pedir antes). Agosto entra en el semestre jul–dic.
- Las tablas `liquidacion*` y sus RPC se retiran cuando la Fase 2 las
  reemplace, no antes: primero se comprueba que nada más las lee.

## Fase 2 — el semestre en Metas · ✅ v2.1032.0

- En `/metas`, junto a la pestaña «Bono» (que ya calcula el mes con
  `get_bono_meta_sala`): **«Pago semestral»**, con el semestre en curso y los
  pasados.
- Por persona: el bono de cada uno de los 6 meses y la suma. Una persona que
  cambió de sala suma lo de cada sala.
- **Los meses se congelan al cerrar.** Sumar recalculando en vivo haría que una
  anulación de marzo cambiara en julio un número que ya se vio. Cada mes cerrado
  guarda su bono por persona; el semestre suma esas fotos.
- **Quien ya no trabaja** aparece aparte, con su acumulado, y gerencia marca
  «pagar» o «no pagar» con motivo. Sin esa marca, el semestre no se puede
  aprobar.
- Aprobar congela el semestre, igual que hoy la hoja mensual (reabrir exige
  motivo). Exporta el archivo para planilla.

## Fase 3 — «Pagar» el bono de producto en la sala · ⬜

- Cuando una promoción con bono termina (por fecha o por lote), cada sala ve a
  quién le toca y cuánto.
- Botón **«Pagar»**: hace la salida por `operar-caja` (acción `salida`, que ya
  tiene el freno de doble envío `clave_envio` y la identidad de quien la hace),
  y la pantalla le dice a la sala **cuánto efectivo sacar del cajón**.
- Lo pagado queda marcado y no se puede volver a pagar (índice único por
  persona·promoción·sala).
- La salida tiene que entrar en el esperado del corte (`gate:cortes`).

**Los tres montos se pagan en tres lugares** (usuario, 2026-09-22):

| monto | dónde | cómo |
|---|---|---|
| vendedor | su sala | «Pagar» → salida de efectivo de esa caja |
| administración | planilla | se agrega a la planilla, no sale de ninguna caja |
| bodega | **Salud 3** | «Pagar» → salida de efectivo de la caja de Salud 3 |

---

## Qué no cambia

- El cálculo del bono de cada mes (`get_bono_meta_sala`) y sus reglas.
- Promociones, descuentos, lote, avisos y excedentes.
