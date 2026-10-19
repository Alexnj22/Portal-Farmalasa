# Cuenta para el revisor de las tiendas (2026-10-17)

Apple (y Google) necesitan entrar a la app para revisarla. La única cuenta con
datos de muestra era la ficha real del dueño, que no se le puede dar a nadie.

**Las credenciales NO están acá: el repositorio es público.** Viven en las
notas de revisión de App Store Connect / Play Console y las tiene el dueño.
Quien las necesite las lee de ahí.

## Qué se creó en producción

| tabla | qué | cómo encontrarlo |
|---|---|---|
| `customers` | la ficha «CLIENTE DEMO» (id 3201016; se llamó «CLIENTE DE REVISION» unas horas, pero la tarjeta muestra las dos primeras palabras) | `notes` dice que no es una persona |
| `puntos_codigo_acceso` | su código de 7 caracteres | `customer_id = 3201016` |
| `app_cliente_muestras` | 19 muestras copiadas de la cuenta de prueba (ofertas, inyecciones, vencimientos, facturas, historias) | `customer_id = 3201016` |

## Desde el 2026-10-19: el revisor entra con DUI y teléfono, NO con el código

Entrar con el código de 7 letras abre ahora una sesión LIMITADA (puntos,
saldo, tarjeta, nivel y ofertas; ver `CON_CODIGO` en `app-clientes`). Si las
notas de revisión dan el código, el revisor no ve facturas, reservas ni chat,
y «Borrar mi cuenta» le pide entrar con DUI y teléfono — motivo de rechazo
(5.1.1(v) exige poder borrar la cuenta). La ficha 3201016 tiene DUI y
teléfono: **las notas de App Store Connect y Play Console tienen que dar esos
dos**, y como mucho mencionar el código como segunda forma de entrar.

## Las facturas de muestra abren un documento de EJEMPLO (2026-10-19)

Sus cuatro facturas de muestra se copiaron de la cuenta de prueba y su
`documento_de` apunta a facturas de OTRA ficha: el control de pertenencia —que
no se abrió— no las dejaba abrir. Ahora una muestra cuya factura prestada no
es de la ficha sirve `sales-dte/muestras/FACTURA-DE-EJEMPLO.pdf` y `.json`
(datos ficticios, marcados «EJEMPLO», sin validez fiscal): en Mis facturas, al
descargar y al enviarlas por correo. `DOC_EJEMPLO` en `app-clientes`.

## Por qué no sale de la base

- **No va al sistema de la caja**: la cola hacia allá es `customers_changelog`,
  que sólo llenan las ediciones del portal. Un alta directa no la toca.
- **No entra a la corrida nocturna de fichas** (`fichas_para_corregir_dte`): no
  tiene facturas (no puede tener rechazos de Hacienda) y tiene domicilio
  completo y categoría Consumidor (no es «sin distrito»).
- **Sin puntos**: dar puntos se hace sólo con `puntos_ajustar`, desde el portal
  y con permiso; hacerlo por SQL dejaría un movimiento sin firma. Si se quiere
  un saldo para mostrar, que lo dé una persona con ese permiso, motivo
  «Cuenta de revisión de las tiendas».
- **Sin el panel «Modo de prueba»**: tiene muestras pero no la fila
  `modo_prueba` (ver `esDePrueba` en `app-clientes`). Apple lee ese panel como
  una función de depuración.

## Borrarla

```sql
DELETE FROM app_cliente_muestras  WHERE customer_id = 3201016;
DELETE FROM puntos_codigo_acceso  WHERE customer_id = 3201016;
DELETE FROM app_cliente_sesiones  WHERE customer_id = 3201016;
DELETE FROM customers             WHERE id = 3201016 AND name = 'CLIENTE DEMO';
```

Antes de borrar, mirar que no tenga nada más colgado (reservas, chat, avisos):
la revisión puede haber reservado o escrito algo.
