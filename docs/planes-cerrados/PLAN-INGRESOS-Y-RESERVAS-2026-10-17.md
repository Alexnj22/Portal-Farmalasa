# Ingresos de caja con forma de pago, Mapfre y reservas — 2026-10-17

Decisiones del usuario tomadas en la sesión del 2026-10-17. Tres partes, en
este orden: la 1 es la que hoy puede descuadrar cortes y las otras dos la usan.

## El hallazgo que manda el diseño

**Todo ingreso anotado en el portal va al cajón de la caja** (45 días medidos:
0 movimientos sin `erp_movimiento_id`). La caja trata cada ingreso como
efectivo y lo suma al esperado del corte. Un ingreso cobrado con tarjeta y
anotado igual nace como un **faltante que no existe**. Preguntar la forma de
pago no alcanza: lo que no es efectivo **no puede llegar al cajón**.

## Parte 1 — Forma de pago en TODOS los ingresos

- Se pregunta en todos los tipos de ingreso (inyección, glucosa, domicilio,
  otro, abono, Mapfre…). **Efectivo por defecto.**
- **Efectivo** → a la caja, como hoy.
- **Tarjeta** → foto del voucher SIEMPRE; monto, número y fecha salen de la
  lectura. **No va a la caja.**
- **Transferencia** → foto del comprobante SIEMPRE; ídem. **No va a la caja.**
- **Sin foto** → el ingreso igual existe, pero queda **pendiente de
  autorización**. Lo aprueba **cualquiera con el permiso activo** (hoy
  Supervisión y Talento Humano) — un permiso, no una cadena de cargos.
  **Rechazado no se borra ni se anula**: se le avisa a quien lo anotó y queda
  pendiente para que lo **vuelva a enviar con más pruebas**.
- **Un voucher puede cubrir venta + ingreso.** Ejemplo del usuario: voucher de
  $16 = $15 de venta con tarjeta + $1 de inyección. Se guarda el total del
  voucher y el ingreso anota sólo su parte; el resto tiene que coincidir con
  una venta `tipo_pago='tarjeta'` de esa sala, mismo monto, hora cercana. Si
  no aparece: **voucher sin cuadrar**. Varios ingresos sobre el mismo voucher
  se suman.
- Al cerrar: `npm run gate:cortes` — ahora tiene que ignorar lo no-efectivo.

## Parte 2 — Pago de asegurado Mapfre

**Construida el 2026-10-19** (tipo `MAPFRE`, `mapfre_facturas`, `mapfre_cotizar`,
`DialogoMapfre`). La ficha de Mapfre se identifica por `erp_id = '19713'`
(`mapfre_customer_id()`).

Cómo funciona: la venta a Mapfre (ficha `customers.id = 1043`, erp `19713`)
se factura **al crédito** por lo que paga la aseguradora, y lo que paga el
asegurado se descuenta con **puntos de lealtad** (el ERP no tiene otro
descuento; a Mapfre no le afecta porque `acumula_puntos = false`). En la
factura ese descuento es un renglón con `erp_product_id = 0` cuyo
`total_linea` es exactamente lo que pagó el asegurado.

Medido: factura 6713048 (Salud 5, 15-oct) — productos $39.45, renglón de
puntos $7.89, total a Mapfre $31.56, y un ingreso «Otro · mapfre» de $7.89 ese
día. **Del 1-sep al 15-oct: 14 facturas, 7 sin un ingreso igual ese día
($103.29).**

- Tipo nuevo **«Pago de asegurado Mapfre»**: se elige la factura de Mapfre de
  la sala, **el monto lo pone el portal** desde el renglón de puntos, y tienen
  que coincidir.
- El asegurado se elige **del listado de clientes**.
- Pregunta forma de pago (parte 1).
- Aviso: factura de Mapfre con descuento y sin su ingreso.

## Parte 3 — Reserva de productos (un solo circuito)

Hoy hay tres que no se hablan: el abono de Mi caja (`abonos_de_cliente`, todo
a mano, 5 abiertos y 4 ya vencidos sin que nada los mueva), la reserva con
anticipo del Inicio (`reserva_en_sucursal_crear`, bien armada pero **el
anticipo nunca entra a la caja**, 0 usos) y la práctica real: «Otro ·
adelanto de X» de entrada y «Otro» de salida al retirar.

**«Adelanto» = apartar**, no es otro concepto.

Estados: `ANOTADA → APARTADA` (había existencia: se separa) **o** `→ ESPERANDO`
(no había) `→ LISTA` (llegó a la sala: se separa y se avisa) `→ RETIRADA`
**o** `→ VENCIDA` (el anticipo pasa a saldo a favor).

- Cliente del listado (o ficha nueva ahí mismo). Productos del catálogo, con
  precio del catálogo; renglón «encargo» para lo que no está.
- La existencia apartada **no cuenta como disponible** (venta, Mín·Máx,
  traslados). Al recibir mercadería, lo esperado sale marcado **«reservado —
  apartar»**.
- Amarrado a la app: el cliente ve el avance y recibe aviso cuando está LISTA.
- Anticipo con forma de pago (parte 1). Al retirar, el anticipo se aplica según
  cómo entró: sólo el efectivo sale del cajón.
- **Reglamento con cláusulas** en `docs/legal/` + **comprobante impreso** con
  folio y código de barras + lo mismo en la app.
- Un proceso diario mueve las vencidas (que no vuelva a pasar lo de los 4).
- Migrar los 5 abonos viejos.

### Condiciones (decididas)

| | |
|---|---|
| Plazo | **7 días** desde que el producto está LISTO en la sala |
| Anticipo mínimo | **50 %** si el producto está en sala; **100 %** si no lo tenemos o es insumo |
| Vencida sin retirar | el anticipo queda como **saldo a favor por 30 días** |
| Precio | **fijo sólo si está en sala**; en encargos se confirma cuando llega |

- **«Insumo»**: una **marca en el portal** sobre el producto, puesta a mano
  desde el catálogo (`products` no tenía cómo distinguirlo:
  `tipo_medicamento` vacío en 5,249 de 5,255).

## Lo que la parte 1 tiene que tocar (mapeado el 2026-10-17)

- `caja_efectivo_piezas` suma como efectivo toda fila del portal con
  `erp_movimiento_id IS NULL` → filtrar por forma de pago. Alimenta
  `caja_estado`, `caja_falta_por_contar`, `caja_falta_contra_corte` (cierre
  automático), `get_caja_piezas_del_rango` y `efectivoEnElCajon` de
  `operar-caja`. Partir de la definición VIVA (la reescribió U2 con regex).
- `fetchAnotadosDelPortal` (`src/data/bolsas.js`) oculta las filas sin id de
  caja → lo no-efectivo desaparecería de Cortes/Movimientos.
- `src/utils/cajaDelDia.js` marca «todavía no llega a la caja» → no aplica a
  lo no-efectivo.
- `operar-caja`: el corte a la caja va entre el registro del abono/aplicación y
  el `fetch` a `agregar_ingreso_caja.php`; lo no-efectivo vuelve antes.
- Otros que llaman `anotarIngreso`: `apps/mobile/app/meter-dinero.js` y
  `src/hooks/useResolverDiferencia.js` → default EFECTIVO en el servidor.
- Aprobación: `approval_requests` con tipo nuevo creado del lado del
  servidor (como `CAJA_MOVIMIENTO_CHANGE`), resuelto por permiso de módulo.
