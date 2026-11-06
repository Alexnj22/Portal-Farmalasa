# Cuentas por cobrar, efectivo del cobro y cierre del día

> Movido desde `CLAUDE.md` el 2026-11-06 sin cambiar el contenido. Allá queda el resumen con las reglas que cuestan dinero; acá, el detalle, las mediciones y la historia. Las cifras de este archivo son de la fecha en que se escribieron: la verdad vigente vive en el archivo o la tabla que cada párrafo nombra.

## Cuentas por cobrar: la lista se mira acá, el cobro se decide allá (2026-09-02)

Los créditos de los clientes viven en el sistema de la caja y el portal tiene un
**espejo** (`creditos_de_clientes`, cron `creditos-cada-hora`). Las dos mitades
NO son intercambiables y confundirlas cuesta dinero real:

| | de dónde sale | por qué |
|---|---|---|
| **la lista** | el espejo del portal | leerla en vivo son **6 peticiones EN SERIE** al origen —la sucursal vive en su sesión, no se pueden hacer a la vez— cada vez que alguien abre la vista |
| **el cobro** | se relee el ORIGEN | entre la última corrida y el clic pueden haber cobrado en la caja; abonar de más deja el crédito en negativo y al cliente pagando dos veces |

**`id_factura` lleva el ID DEL CRÉDITO.** Es el nombre que usa el formulario del
origen y su propio campo oculto viaja con el número del crédito — medido: el
crédito 1912 tiene la factura 299063. Mandar el de la factura abona al crédito
de otra persona **sin dar error**, y **el origen no tiene forma de deshacer un
abono**: no hay borrar ni anular. La traducción vive en UNA línea de
`creditos-erp` y el parámetro se llama `credito` de punta a punta.

**El amarre con la ficha y el vendedor sale de `sales_invoices`.** El origen
sólo da el NOMBRE escrito en la factura; `factura_erp` → `erp_invoice_id` trae
`customer_id` y `cod_vendedor`, y `cod_vendedor` → `employees.code`. Medido el
2-sep: **2,386 de 2,387 créditos con ficha, 2,328 con vendedor**. El `LEFT JOIN`
es a propósito — un crédito cuya factura todavía no sincronizó entra igual y
toma el amarre en la corrida siguiente. Perder la deuda por no tener el amarre
sería el peor de los dos errores.

**El espejo se mantiene con CUATRO piezas, y ninguna sobra** (2026-09-02; la cuarta, 2026-10-02):

| | cada cuánto | qué mira | cuesta |
|---|---|---|---|
| pasada frecuente | 10 min, 7am-11pm | **sólo el día de hoy** | 1.8 s · 2 kB |
| barrido completo | 1 vez, 2am SV | 2024 → hoy | 17.3 s · 1.4 MB |
| relectura tras abonar | cada abono | esa sala, esa fecha | ~250 ms |
| pantalla abierta (2-oct) | al abrir, cada minuto a la vista, búsqueda sin resultado | **hoy**, su sala | 1 lectura/sala/min **compartida** |

**La cuarta pieza tiene el tope en la BASE, no en el navegador.**
`creditos_tomar_lectura(sala, segundos)` reclama la lectura de forma atómica
(`ON CONFLICT … WHERE leido_el < now() - …`): diez pantallas abiertas en una
sala cuestan lo mismo que una, y la acción `refrescar_hoy` de `creditos-erp`
contesta sin iniciar sesión en la caja cuando no le toca. Nació de «se vendió al
crédito y se quería abonar en el mismo momento»: con el cron de 10 minutos ese
crédito no estaba en la lista. La búsqueda sin resultado usa tope de 10 s
porque ése es exactamente el caso «lo acaban de vender».

**El barrido diario NO es redundante y es el que se olvida.** Un abono hecho en
el ORIGEN sobre un crédito de hace ocho meses **no aparece en la ventana de
hoy** —lo que cambió es su saldo, no su fecha—, así que sin él el espejo
mostraría una deuda ya pagada para siempre y el aviso del plazo cobraría lo que
nadie debe.

**Y la relectura tras abonar no es ceremonia**: sin ella, lo único que dice que
el abono entró es el «success» del origen y el saldo que se muestra es una
RESTA hecha acá. Si allá se aplicara distinto —o a otro crédito, que es lo que
pasa si se manda el número equivocado y no da error—, el portal informaría el
número bonito. Con ella, el saldo que se guarda es el que el origen dice tener.

**Una ventana de un día en vez del histórico entero también acotó la
comprobación PREVIA al abono**: 17 s → ~250 ms, y esos 17 s eran con el cliente
enfrente. La fecha de un crédito no cambia nunca, así que sale del espejo.

**El raspado vive en `_shared/creditos.ts` y no duplicado.** Lo usan la pantalla
y el cron; escrito dos veces, el día que el origen cambie una columna una copia
se queda vieja y nadie se entera.

**`vencio_el` y `pagado_el` se OBSERVAN, no se calculan.** Se escriben la
primera vez que se ven (`COALESCE(viejo, nuevo)`). Derivadas de `fecha + 30`
cada vez, el aviso no podría saber si ya avisó. Y **vencido exige SALDO**: un
crédito de hace dos años ya pagado tiene 700 días y no debe nada — el plazo mide
una deuda, no una fecha.

### El efectivo del cobro entra al cajón y el comprobante NO lo cuenta (2026-09-02)

Cobrar un crédito desde el portal mete efectivo en la caja. El sistema de origen
lo registra como movimiento del día —`POR ABONO A CREDITO`— y **no lo suma ni a
INGRESOS ni a la línea COBROS CREDITO**, o sea a ninguno de los dos términos de
`TOTAL CAJA = INGRESOS + VENTA − VALES + COBROS`. El esperado nace corto y el
conteo de la sala aparece como un **sobrante que nadie hizo**.

Salud 4, corte de las 13:00 del primer día que hubo cobros desde el portal:

| | |
|---|---:|
| esperado del comprobante | $230.85 |
| cobros en efectivo antes de contar | +$88.25 |
| esperado real | **$319.10** |
| se contó | $309.25 |

El portal anunciaba **+$78.40 de sobrante** sobre un **faltante de $9.85**.

**La corrección se sella en la FILA del corte, no se calcula en cada pantalla.**
`cortes_caja.cobros_portal_efectivo` lo mantienen dos triggers —uno en
`cortes_caja` y otro en `creditos_abonos_portal`—, y `contraste` se lo suma al
esperado. Son **ocho** los lugares que leen un corte (la lista, el detalle, la
tarjeta, el widget del Inicio, el resumen del mes, los avisos, Mi caja y el
ticket que se imprime): calculado en cada uno, alcanza que uno se olvide para
que dos pantallas señalen faltantes distintos sobre la misma persona.

**Y el noveno lector NO tiene fila: es el corte RECIÉN HECHO** (2026-09-02). La
escribe `sync-cortes-caja` medio minuto después, así que el papel que imprime el
portal se arma antes de que el trigger selle nada. Ahí la respuesta de
`hacer-corte-caja` se traduce a una fila de `cortes_caja` **a mano**
(`conLaCuentaBuena`, en `cortesDiagnostico.js`), y esa traducción se había
quedado con **cinco de las ocho columnas** que `contraste` lee: sin
`cobros_portal_efectivo` da por cero la corrección, sin error y sin línea
faltante. El corte 14399 de Salud 4 salió impreso con **+$88.40** mientras su
tarjeta —ya sellada— decía **+$0.15**.

O sea que **usar el mismo juez no alcanza si no se le dan las mismas piezas**, y
el objeto armado a mano es la mitad frágil: no falla, se queda corto. Por eso
vive pegado a `contraste` y no en la vista. Al agregarle una columna al juez, se
agrega ahí — y el dato que no sale del tiquete se le pregunta al MISMO canónico
que usa el trigger (`cobros_portal_en_efectivo`), nunca a una suma escrita
aparte. Ver [[feedback_el_mismo_juez_con_menos_piezas_da_otro_numero]].

**Cuánto contó el comprobante se DERIVA de su propia suma**, no del renglón:
`cobros = total_caja − subtotal + vales`. `tk_cobros_credito` sale del papel con
una expresión regular y el papel a veces no imprime la línea — y su ausencia se
lee igual que un cero. El despeje cierra al centavo en los **493 cortes**
capturados, y no puede quedar en cero porque el origen le cambie el nombre a la
línea, que es el modo de falla que importa: un cero de más ahí inventa un
faltante del tamaño de los cobros del día.

**La lección, que es la cara general:** la medición que sostenía lo contrario
—«el origen ya distingue, sólo el efectivo llega al esperado»— era **correcta**;
lo que falló fue el salto de *aparece en la lista de movimientos* a *está en el
esperado*. Ver
[[feedback_aparecer_en_la_lista_de_movimientos_no_es_estar_en_el_esperado]]. Y
sobrevivió medio día porque el único cobro en efectivo de esa mañana era de
$8.55: **un defecto proporcional al monto se esconde solo mientras los montos
son chicos.**

Lo vigila **`npm run gate:cortes`**, que compara el efectivo que entró al cajón
contra el que el esperado cuenta —por sala y por día, contra los movimientos del
propio origen, o sea también para una fuente que nadie previó—. Dos decisiones
de medición que ya costaron: los movimientos con `desaparecido_at` **no cuentan**
(el origen no anula, borra: el 1-sep un abono de $54.99 se borró a las 15:04 y
el corte de esa hora cerró exacto), y la referencia es el corte que **más llega a
contar** en el día y no el último (hay cortes de apertura de turno que declaran
$0.00).

### El cierre del día tiene CUATRO frenos, y ninguno cubre a los otros (2026-09-06 · 2026-10-28)

Cerrar el día emite el Z y **no se deshace**: esa caja no vuelve a abrir. Los
frenos viven en `hacer-corte-caja` —nunca en `operar-caja`, que llegaría
con el Z ya emitido— y se repiten en la pantalla para avisar ANTES:

| freno | pregunta | qué costó no tenerlo |
|---|---|---|
| corte sin resolver | ¿quedó alguno ni confirmado ni descartado? | Salud 1, 5-sep |
| sin corte confirmado | ¿hay AL MENOS UNO confirmado hoy? | — |
| **efectivo sin contar** | **¿entró plata desde el último confirmado?** | **Salud 2, 6-sep** |
| **preventa sin finalizar** | **¿queda alguna preventa guardada en la caja?** | — (lo hacía la caja, ver abajo) |

**El cuarto vale también para el corte C, no sólo para el Z.** La pantalla de
corte de la caja pinta «Hay facturas pendientes de cobro» y **deshabilita
Guardar** cuando la sala tiene preventas guardadas —medido el 2026-10-28 en las
seis salas: aviso en las 4 con preventas, en ninguna de las 2 sin—. El freno
vivía sólo en ESE botón: el POST a `corte_caja_diario.php` lo acepta igual, y el
portal, que nunca aprieta el botón, se lo saltaba desde que corta él. Una
preventa puede ser dinero que ya entró al cajón y todavía no es venta.
`hacer-corte-caja` lee la lista (`get_referencias`, `preventasVivas`) **antes
del vale y de cualquier escritura**; si no la puede leer, frena. Y relee el
aviso de la pantalla justo antes de enviar, por si entró una en el medio.
Mi caja la pide al abrir el diálogo (`body.preventas`, sólo lectura, una por
apertura) para decirlo antes de que alguien cuente el cajón en vano.

Los dos primeros estaban **en verde** cuando Salud 2 cerró el 6-sep a las 17:58
con su único conteo firmado a las **11:59**: $152.65 de ventas, $5.74 de CAESS y
$1.00 de una inyección — **$159.39** en el cajón que ya no puede contar nadie.
«Hay un corte confirmado hoy» y «lo que hay ahora está contado» son preguntas
distintas, y seis horas separan una respuesta de la otra.

**El juez es `caja_falta_por_contar`, y es UNO solo**: lo llama el candado del
servidor y viaja dentro de `caja_estado` para el aviso de la pantalla. Si el
aviso y el candado pudieran contestar distinto, la sala vería «todo bien» y el
botón la rechazaría — o peor, al revés.

**Compara dos ESPERADOS, nunca un esperado contra un conteo.** Lo que el sistema
espera en el cajón hoy contra el esperado que el último corte **confirmado** dio
por medido (los descartados no cuentan, igual que en `corte_tramo`). Restando
contra lo CONTADO, un faltante firmado de $2.54 se leería como «$2.54 sin
contar» y trabaría un cierre correcto. Y lo que el corte midió se **despeja del
canónico** (`declarado − corte_diferencia(...)`), no se copia su fórmula.

**No es un cronómetro.** Salud 4 el 5-sep cerró hora y media después de su corte
y pasa: lo que frena es que haya entrado plata, no que haya pasado el rato.

⚠️ **La resta obvia es ruido, y está medida.** `entradas_del_día − tk_ingresos`
parece decir lo mismo y dispara **60 veces sobre 143 cierres, 59 de ellas sin
una sola venta después del corte**: el tiquete no pone los cobros de crédito en
INGRESOS sino en su propia línea. `tk_total_caja` sí los incluye.

Lo vigila la **sección D de `npm run gate:cortes`**, que nombra los días ya
cerrados que se llevaron efectivo sin contar. Su `YA_PASADOS` lleva los dos
históricos **con su monto escrito**; una entrada nueva ahí es sólo para un día
cerrado que no se puede reparar, nunca para que el gate calle.

### El día que NADIE cerró lo cierra el portal (2026-09-23)

Una hora después de la hora de cierre, si la caja sigue abierta y hay un corte
C no descartado desde una hora antes del cierre, `cierre-automatico-caja` (cron
cada 10 min, 17:00–23:50 SV) emite el Z por `hacer-corte-caja` en modo
`automatico`. El juez es **`caja_cierre_automatico_decidir`**, uno solo: lo
consulta el cron y lo vuelve a consultar `hacer-corte-caja` justo antes de
emitir. A las 7:00, `avisar_dias_sin_cierre` le avisa a la sala y a supervisión.

**El sistema de la caja NO lo hace** (revisado en su configuración el 23-sep):
lo único automático es un corte **C** a las 21:00:00 sobre la caja abierta.
Ese C nace PENDIENTE y nadie lo firma, y por eso en el modo automático **no
frena «corte sin resolver»**: frenaría justo el día que hace falta cerrar.
«Efectivo sin contar» sí frena, medido contra ese corte cercano al cierre
(`caja_falta_contra_corte`) aunque no esté confirmado. **«Preventa sin
finalizar» también frena** (usuario, 2026-10-28: «que frene y notifique
supervisor»): el día queda abierto, `cierre-automatico-caja` anota el motivo
`preventas_sin_finalizar` y avisa a Gerente General y Supervisor/a de Ventas
con la lista — una sola vez por noche, aunque el cron corra cada 10 min. Al
tocar cualquiera de los frenos de arriba, mirar también la rama `automatico`.

**Sólo cierra si la sala no cerró, y eso se mira tres veces**: el juez exige
caja abierta y ningún Z en el espejo, `hacer-corte-caja` le vuelve a preguntar
justo antes de emitir, y además lee los cortes del día EN VIVO en la caja
(`ya_estaba`) — el espejo puede ir minutos atrás de un Z recién hecho.