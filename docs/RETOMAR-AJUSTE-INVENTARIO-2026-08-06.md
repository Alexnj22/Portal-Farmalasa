# Retomar — Widget de Ajuste de Inventario (conectado al ERP)

**Escrito el 2026-08-06.** Cierra la sesión en la que el portal pasó de *pedir*
cambios a *ejecutarlos* en el ERP y ante Hacienda. El próximo widget —**Ajuste
de Inventario**— es el cuarto de la misma familia, y la mitad del trabajo ya
está hecha: existe el patrón, el módulo compartido, los secretos y las
lecciones. Este documento es para no volver a aprenderlas.

---

## 1 · Lo que quedó funcionando (y verificado)

| | |
|---|---|
| Widget «Solicitar Modificación a Facturación» | 4 tipos, los 4 se aplican en el ERP al aprobar |
| Edge Function `aplicar-solicitud-facturacion` | cliente · forma de pago · vendedor · anulación |
| Edge Function `regularizar-dte` | barrido de lo pendiente ante Hacienda |
| Cron `regularizar-dte-2230-sv` | `30 4` UTC = 22:30 SV |
| Cron `alerta-barrido-dte-8am-sv` | `0 14` UTC = 08:00 SV, avisa si falló |
| Widget de Ajuste Min/Max | auditado; su aviso nunca había funcionado |

Verificado de punta a punta contra facturas reales: la 345641 se anuló en el
ERP y ante Hacienda desde el portal (sello `2026A8FEE61FDE644CC8A4C56DB531294EAEF9O6`),
y la 344391 recibió su sello de recepción por el barrido.

---

## 2 · El patrón, en cuatro piezas

Esta es la forma que hay que **repetir**, no rediseñar.

### 2.1 · El widget crea una solicitud, no ejecuta

El navegador nunca habla con el ERP. Escribe una fila (`approval_requests` o
tabla propia) con todo lo que hace falta para aplicarla después.

**Guardá el id del ERP, no solo el del portal.** `sales_invoices.id` (6661122)
y `erp_invoice_id` (345641) son numeraciones distintas y el ERP acepta la
equivocada sin protestar, apuntando a otro documento. Ese fue el error más
peligroso de la sesión y se evitó por poco. Para inventario aplica igual:
`products.id` ≠ `erp_product_id`, y `branch_id` ≠ `erp_sucursal_id`.

### 2.2 · La validación va en la BD, no en la pantalla

El RLS deja ver a cada quien solo sus propias solicitudes, así que el navegador
**no puede** comprobar si otro ya pidió lo mismo. Una validación que no puede
ver el dato no es una validación.

Hoy hay dos, en `approval_requests`:
- trigger `validar_solicitud_facturacion` — no se piden cambios sobre una
  factura anulada;
- índice único parcial `approval_requests_una_pendiente_por_factura` — una sola
  pendiente por documento. **Índice y no trigger**: un índice no pierde una
  carrera entre dos inserts simultáneos, un `SELECT` previo sí.

### 2.3 · La notificación nace con la solicitud

`INSERT` y `notify` como dos llamadas del navegador **no funciona**. Medido dos
veces en esta sesión: `approval_requests` con 0 notificaciones, y
`minmax_change_requests` con **cero en toda su historia** pese a tres
solicitudes. En Min/Max el aviso iba dentro de un `try/catch` no-fatal, o sea
que fallaba en silencio por diseño.

La forma correcta es un trigger `AFTER INSERT` que crea la notificación en la
misma transacción, más otro `AFTER UPDATE OF status` que la marca
`metadata.resuelta` cuando se decide — si no, el aviso sigue ofreciendo
Aprobar/Rechazar sobre algo ya resuelto.

El cuerpo tiene que alcanzar para decidir sin abrir la app: qué, dónde, de→a y
el motivo.

### 2.4 · La Edge Function aplica, y el orden importa

**Primero el ERP, después APPROVED.** Si se marca aprobada antes y el ERP
falla, queda una solicitud que dice «aplicada» sobre algo intacto y nadie
vuelve a mirarla. Al revés, si el ERP no acepta la solicitud sigue PENDING y
quien aprueba ve el motivo.

Identidad **siempre del JWT**, nunca por parámetro; más empleado ACTIVO y el
permiso del módulo.

---

## 3 · El ERP: lo que ya está mapeado

Base: `https://clientesdte3.oss.com.sv/farma_salud`.
Login: `POST login.php` con `username`/`password`/`m=1`; **la cookie viaja en el
Set-Cookie del 302**, así que no hay que seguir el redirect.

Credenciales en el secreto `ERP_FACTURACION_CREDS` (usuario `edwin`). El
responsable de anulaciones ante Hacienda, en `DTE_RESPONSABLE_ANULACION`.

Todo lo de DTE vive en **`supabase/functions/_shared/erp-dte.ts`** —
`login`, `pedir`, `conReintento`, `leerRespuesta`, `estaAnulada`,
`enviarDteAlMH`. **Reusar ese módulo, no copiarlo.**

### Trampas verificadas, que van a volver

1. **El ERP contesta HTTP 200 con `{"typeinfo":"Error"}` cuando rechaza.** Hay
   que leer el cuerpo; un rechazo silencioso se ve igual que un éxito.
2. **El mensaje no distingue la operación.** `cambiar_cod` y `cambiar`
   devuelven el mismo «Numero actualizado». Nunca dar por bueno sin releer y
   comparar.
3. **Un POST parcial borra lo que no mandás** (incidente 6317, ya conocido).
   `cambiar_datos` manda cliente y forma de pago juntos: el campo que no cambia
   viaja con su valor **actual recién leído**, no con el que traía la solicitud.
4. **Nombres de parámetro mentirosos**: el código de vendedor viaja en
   `numero_doc`.
5. **El token del MH se cachea en la sesión PHP** al abrir la pantalla
   (`generar_dte.php` / `anular_dte.php`). Sin ese GET previo, `get_dte`
   responde `"Token no pudo ser cargado"`.
6. **El éxito es el sello, no el 200.** `proxydte.php` contesta 200 igual
   cuando Hacienda rechaza; ahí `selloRecibido` viene nulo.
7. **Hacienda acepta con reparos** («RECIBIDO CON OBSERVACIONES»). Es éxito con
   advertencia: guardarlas y contarlas aparte.
8. **Una sesión sirve para todas las sucursales** — verificado leyendo facturas
   de Salud 1, 3, 4, 5 y La Popular sin `cambio_sesion.php`. **OJO: esto puede
   NO valer para inventario** (ver §5).

### Presupuesto de tiempo

Una Edge Function vive **150 s**. Cada paso contra el ERP tarda ~0.3 s medido;
la llamada al MH es la lenta. `regularizar-dte` usa un presupuesto de 110 s y
se corta **antes** de empezar otro documento, para que siempre alcance a
escribir el registro. Con 300 pendientes drena en tandas y **dice cuántas
quedan** — un tope que no se anuncia se lee como «ya está todo».

---

## 4 · Lo que quedó pendiente de esta sesión

1. **Botón por fila** en las pestañas de Facturación. `regularizar-dte` ya
   acepta `{ alcance:'una', invoice_id }`; falta colgarlo de cada renglón.
2. **Cliente sin número interno.** 102 de 27,769 fichas no tienen `erp_id` y el
   buscador las ofrece igual: la solicitud se crea y recién al aprobarla se
   descubre que no se puede aplicar. Filtrarlas o avisar al elegir.
3. **El plazo de gracia y la regla de CCF se muestran pero no se imponen.**
   `canSubmit` solo exige motivo y, para un CCF de fecha anterior, tildar una
   casilla. Hoy un CCF fuera de ventana se puede aprobar y se manda a Hacienda.
4. **La notificación de "decidida"** (al solicitante) sigue saliendo del
   navegador — el mismo hueco que se cerró para la de creación.
5. **Reintento tras un barrido cortado.** Hay una guarda que relee el estado
   antes de enviar; no está probada contra un corte real.
6. **Seguridad, para reportar a OSS:** `anular_dte.php` sirve en el HTML, en
   claro, el usuario y contraseña de la API del Ministerio de Hacienda y un
   Bearer vivo. Cualquiera con sesión del ERP los ve. Y en el flujo de
   anulación **no se usan** — el JS arma `user=…&pwd=…` y nunca lo manda.

---

## 5 · El widget de Ajuste de Inventario

### Lo que ya se sabe (sondeo de solo lectura, 2026-08-06)

| página | título | campos del formulario |
|---|---|---|
| `ajuste_inventario.php` | Ajuste Inventario | `categoria`, `concepto`, `cu`, `destino`, `fecha1`, `filas`, `id_sucursal_dom`, `params`, `process`, `producto_buscar` |
| `admin_ajuste.php` | Administrar Ajuste | `fini`, `ffin`, `sucursal`, `origen` |

También existen `ingreso_inventario.php`, `descargo_inventario.php`,
`admin_traslados.php`, `reporte_kardex.php` y `generar_kardex_lote.php`.

El JS a leer es **`js/funciones/funciones_ajuste_inventario.js`** — es donde van
a estar los `process=` reales, igual que `funciones_fact_rangos.js` tenía el
`process=deleted` de la anulación.

### ⚠️ La diferencia que hay que resolver primero

Los endpoints de DTE resuelven por `id_factura` y **una sola sesión alcanzó
para todas las sucursales**. `ajuste_inventario.php` tiene un campo
**`id_sucursal_dom`**, lo que sugiere que el ajuste **sí depende del contexto
de sucursal de la sesión**. Si es así hace falta `cambio_sesion.php` antes de
cada ajuste — el patrón ya existe en `sync-erp-purchases` y
`check-purchases-reconciliation` (`SESION_URL`).

**Averiguarlo antes de escribir nada**, con lecturas: abrir
`ajuste_inventario.php` con la sesión en una sucursal y ver si el `<select>` de
sucursal viene fijo o elegible, y si `admin_ajuste.php` lista ajustes de otras
sucursales.

### Orden sugerido

1. Leer `funciones_ajuste_inventario.js` y anotar los `process=`.
2. Resolver la pregunta de la sucursal (arriba).
3. Probar en **lectura** el listado `admin_ajuste.php` para entender la forma
   de un ajuste ya hecho.
4. Recién entonces: tabla de solicitudes + trigger de notificación + trigger de
   validación + Edge Function que aplica, reusando `_shared/erp-dte.ts` para
   login/pedir/reintentos.
5. Una prueba con **un** ajuste chico, reversible, y confirmarlo en el kardex
   antes de soltar nada masivo.

### Lo que hay que decidir con el usuario

- **¿Qué se ajusta y quién lo aprueba?** El ajuste de inventario mueve
  existencias reales: probablemente no debería aplicarse de un clic como el
  cambio de vendedor.
- **¿Es reversible?** La anulación de una factura no lo era y por eso el
  «Aprobar» abre confirmación. Si un ajuste tampoco lo es, mismo tratamiento.
- **¿Hay tope de cantidad o de valor** por encima del cual haga falta otro
  nivel de aprobación?

---

## 6 · Reglas de la casa que costaron caro hoy

- **El árbol es compartido.** Otra sesión se llevó mis archivos en su commit
  tres veces, y dos veces el bump de versión. Commitear con paths explícitos,
  `git fetch` antes de pushear, y revisar `git status` después del `add`.
- **`apply_migration` nunca toca el disco.** Cada migración necesita su archivo
  local con la versión de 14 dígitos que devolvió el servidor; el gate
  `--remote` lo detecta y esta sesión lo usó cuatro veces.
- **Probar con `BEGIN … ROLLBACK`.** Todas las reglas nuevas se verificaron con
  inserts reales revertidos. Tres veces la prueba estuvo mal antes que el
  código —dos filas con el mismo `now()`, una fila con fecha vieja, una
  conversión de zona invertida— y las tres se habrían reportado como
  «verificado» sin volver a mirar.
- **Un tope que no se anuncia es un truncamiento silencioso.** Pasó con el
  `.limit(500)` del widget, con el `.limit(1000)` de Min/Max y casi con
  `MAX_POR_CORRIDA`.
