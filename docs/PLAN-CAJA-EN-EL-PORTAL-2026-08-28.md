# La caja en el portal — apertura, vales y corte

Escrito el 2026-08-28. Nace de un reporte de una línea: «si sólo tengo el corte
de ahora en sala bolsa am y necesito dar una remesa de $500, al hacer el
siguiente corte falta dinero, porque para el sistema de ventas ese dinero está».

Todo lo que sigue está **medido contra producción**, y las escrituras al sistema
de origen están **probadas** o marcadas como pendientes de probar. No hay ningún
endpoint supuesto: los cinco salieron de leer el JavaScript de sus pantallas
(`js/funciones/funciones_caja_chica.js` y `funciones_corte_caja.js`) y los que
dicen «probado» se ejercieron de verdad.

---

## 1. El defecto que lo destapó, y por qué no se veía

El corte cuenta, **por día**, todo lo que entró a la caja desde el Z anterior.
Meter el dinero en una bolsa no le avisa nada: la plata de las bolsas **de hoy**
sigue siendo caja para el sistema hasta el Z de la noche. La de días anteriores
ya cerró con su Z y es invisible.

Entonces una salida de dinero cae en uno de dos casos, y **son opuestos**:

| de dónde sale | ¿la cuenta el sistema? | qué corresponde |
|---|---|---|
| bolsa **del día abierto** | sí | anotar una **salida de caja** por el monto |
| bolsa de un día ya cerrado | no | **no anotar nada** |

Las dos caras, medidas:

- **Salud 1, 26-ago** — REM-1024, $500 de la bolsa S1-1145 (del mismo día).
  Alguien anotó `SALIDA 500.00 · RIA BO#000345`: los vales pasaron de $0.00 a
  $556.95 y el corte de las 22:05 cerró en **0.00**.
- **Salud 1, 27-ago** — REM-1028, $400 de la bolsa S1-1157 (del mismo día).
  Nadie lo anotó. Los dos cortes siguientes marcaron **−$425.10 y −$400.10**.
- **Salud 1, 22-ago** — dos remesas ($254 + $200) salieron de una bolsa **del
  21** y las anotaron igual. Corte con **+$454.00 de sobrante**, tapado con un
  ingreso falso de $454.00.

**Alcance:** de 29 salidas registradas en el portal, 6 tomaron de una bolsa del
mismo día ($2,200) y **sólo 1 tiene su movimiento**. Quedaron como faltantes
falsos REM-1012 ($400, La Popular), REM-1013 ($100, Salud 2), OTR-1019 ($750,
Salud 4), REM-1025 ($50, Salud 4) y REM-1028 ($400, Salud 1).

El portal **ya sabe** en cuál de los dos casos está: eligió la bolsa y sabe si el
Z de ese día corrió. Nadie más lo sabe.

---

## 2. Lo que se puede escribir, y lo que ya está probado

Los endpoints, con el estado de cada uno:

| qué | endpoint | estado |
|---|---|---|
| vale (salida) | `agregar_salida_caja.php` `process=salida` | ✅ **probado el 28-ago** |
| ingreso | `agregar_ingreso_caja.php` `process=ingreso` | mismo handler, sin probar |
| borrar movimiento | `borrar_movimiento_caja.php` `process=eliminar` | ✅ **probado el 28-ago** |
| editar movimiento | `editar_movimiento_caja.php` `process=editar` | sin probar |
| comprobante del vale | `agregar_ingreso_caja.php` `process=imprimir` | devuelve el texto |
| apertura de caja | `apertura_caja.php` `process=insert` | sin probar |
| turno nuevo / cerrar turno | `apertura_caja.php` `process=apertura_turno` / `cerrar_turno` | sin probar |
| formulario del corte, **ya calculado** | `corte_caja_diario.php?aper_id=` (GET) | ✅ leído |
| grabar el corte | `cierre_turno.php` (formulario completo) | sin probar |
| comprobante del corte | `corte_caja_diario.php` `process=imprimir` | devuelve el texto |

### La prueba de escritura del 28-ago

```
apertura viva leída:  id_apertura=2863 · emp=38 · turno=1   (Salud 1)
crear:  {"typeinfo":"Success","msg":"Vale agregado correctamente !","id_mov":43260}
lista:  43260 · PRUEBA PORTAL 0.01 BORRAR · 28-08-2026 · 0.01 · SALIDA
borrar: {"typeinfo":"Success","msg":"Movimiento eliminado correctamente !"}
```

**Lo que prueba, y es la decisión de diseño más importante del plan: el servidor
toma `id_apertura`, `id_empleado` y `turno` del FORMULARIO, no de la sesión.** El
vale lo creó una cuenta que **no tiene ninguna caja abierta**, dentro de la
apertura viva de otra persona. Consecuencia: **no hacen falta usuario y
contraseña por caja**. La identidad la pone el portal.

Y confirma el vocabulario: el sistema le dice **«vale»** a una salida de caja. No
es una analogía nuestra.

---

## 3. Quién abre la caja hoy — el hallazgo que decide el orden

Leído en vivo el 28-ago, sin escribir nada:

| sala | apertura | quién | abrió | registrado |
|---|---|---|---|---|
| Salud 1 | 2863 | NATHALY MICHELLE ESTRADA | 06:55 | $757.25 |
| Salud 2 | 2865 | **MI CAJA LA SALUD 2** | 07:05 | $1,224.16 |
| Salud 3 | 2866 | RODRIGO EDUARDO MARQUEZ | 07:10 | $657.35 |
| Salud 4 | 2864 | AUDELIA ELIZABETH CALLEJAS | 06:58 | $430.55 |
| La Popular | 2862 | **MI CAJA LA POPULAR** | 06:53 | $607.10 |
| Salud 5 | 2861 | **MI CAJA LA SALUD 5** | 06:50 | $309.90 |

**En tres salas la caja no sabe quién es**, y eso se arrastra al corte: de los
452 cortes desde el 14-ago, **185 están firmados por «MI CAJA …»**. En las otras
tres el nombre es real pero es **siempre el mismo en dos semanas** —106 de
Nathaly, 77 de Audelia, 73 de Rodrigo—, o sea que tampoco es quién estaba en la
caja: es la cuenta que abrió esa mañana.

Y en los **452, sin excepción, `cortes_caja.employee_id` está en NULL**: ningún
corte está ligado a una ficha del portal.

O sea que «saber quién cortó» hoy **no tiene respuesta**, y no por falta de
acceso: el dato no existe del lado de la caja. Esto es lo que justifica mover la
apertura al portal — no la comodidad, sino que la identidad del portal (carné,
kiosco, marcación, horario) es la única que existe.

---

## 4. El agujero de auditoría, que es lo que hay que cerrar primero

**Los movimientos se pueden editar y borrar en el origen sin dejar rastro**, y
hoy el portal no se entera de ninguna de las dos cosas:

- `sync-cortes-caja` hace `upsert` de lo que ve. Un movimiento **borrado sigue
  apareciendo en el portal para siempre**, sin marca.
- Uno **editado se pisa** y el valor viejo no queda en ningún lado.

Comprobado con la prueba de arriba: el movimiento 43260 existió y desapareció, y
del lado del origen no queda ni el número.

Es exactamente el hueco del ingreso de $454.00 del 22-ago que tapó un sobrante
falso: un movimiento inventado después del corte no dispara nada.

**Lo que hay que construir:**

1. `cortes_caja_movimientos` lleva `visto_at` y `desaparecido_at`. Cada corrida
   marca lo que ya no está en vez de dejarlo como si siguiera.
2. `cortes_caja_movimientos_historial` — una fila por cada cambio observado, con
   el antes y el después. El origen no guarda historia; el portal sí.
3. `origen`: `PORTAL` (lo escribió el portal, con su folio y su operación) o
   `CAJA` (lo tecleó alguien allá). Lo segundo es legítimo, pero tiene que ser
   **visible**.
4. Avisos: un movimiento que aparece, se edita o se borra **después** de un
   corte; y el patrón del 22-ago —un ingreso por el monto exacto del sobrante
   del corte anterior—, que se detecta solo.

Esto **no escribe nada** en el origen y se puede hacer hoy.

---

## 5. Orden de entrega

Todo va al portal. Este es el orden, no un recorte:

**F1 · Auditoría de los movimientos** (§4). Sin escrituras. Cierra el hueco que
hace que cualquier otra cosa sea creíble.

**F2 · El vale lo escribe el portal.** Al guardar una salida que consume plata de
una bolsa del día abierto, el portal escribe la salida de caja con el folio
adentro del concepto (`REMESA REM-1031 BO#000319`), igual que Salud 1 lo escribe
hoy a mano. Si la plata sale de una bolsa vieja, **no escribe nada y lo dice en
pantalla**, para que tampoco lo anoten a mano.

Tres frenos, porque esta capacidad corre el número que el portal después audita:

1. **Nunca escribe dos veces**: antes de mandar, busca el folio en los
   movimientos del día. Un reintento tras un timeout es el escenario obvio, y
   duplicar un vale de $500 es peor que no ponerlo.
2. **Sólo borra lo que escribió el portal**, identificado por folio — nunca por
   monto ni por posición.
3. **Si el vale no entra, la salida se guarda igual** y queda como «falta
   anotarla en caja». La salida es el hecho; el vale es su consecuencia.

**F3 · Los ingresos de efectivo.** El mismo camino, al revés. Acá viven los
pagos de servicios y los depósitos a cuenta, que hoy son texto libre
(`DEP A CTA #0127 DUI: 00082798-1 B.000376`). En el portal son campos.

**F4 · La apertura.** Con el carné. El nombre del turno pasa a ser una persona
verificada y las tres salas dejan de cortar como «MI CAJA». Su prueba de
escritura es **más invasiva que la del vale** —abrir mal una caja deja a una sala
sin vender—, así que se hace con una sala acordada, al inicio del día.

**F5 · El corte.** El formulario se pide armado (`corte_caja_diario.php?aper_id=`)
y se devuelve con el conteo. El portal no calcula el esperado.

---

## 6. Lo que falta averiguar, y no se puede desde acá

1. **El catálogo de `id_tipo`** de los movimientos. El modal que lo lista sólo se
   abre para un usuario que tenga una caja abierta, y la cuenta del portal no
   tiene ninguna. En la prueba mandé `id_tipo=1` y entró bien, pero el tipo
   probablemente sea lo que separa un ingreso común de un **cobro de crédito**,
   que en el tiquete tiene línea propia. Se resuelve desde una edge function con
   las credenciales por sala de `ERP_BRANCH_MAP`.
2. **Si el corte valida la clave del supervisor del lado del servidor.** El
   formulario de `cierre_turno.php` trae `tuser_ad` y `pass`, y hay un
   `process=confirmar` aparte que en el navegador sólo **destapa** la diferencia.
   Si el servidor la exige, el portal no debería pedir esa clave: hay que ver si
   alcanza con el candado doble del portal.
3. **Qué pasa con dos cajas en una sala.** Todas las salas tienen una sola hoy
   (`Caja 1`), pero el modelo del origen admite varias.

---

## 7. La regla que no se negocia

**El portal no puede ser el único camino.** Si se cae la red o cambia un campo
del lado de ellos, la sala abre, anota y corta como hoy, y el portal se entera
después y reconcilia. Todo lo de este plan es una capa encima, nunca un
reemplazo — porque el peor final posible es una sala que a las 10 de la noche no
puede cerrar el turno por un despliegue nuestro.

---

## 8. «Vale» son TRES papeles distintos (2026-08-29)

Lo destapó el usuario mirando el flujograma: *«no veo en el flujo la parte de
hacer un vale y sacar dinero de una bolsa»*. No era sólo que faltara — era que
la misma palabra nombraba tres cosas y por eso el circuito no se entendía.

| se llama | cuántos | dónde va | ¿mueve lo que la caja espera? |
|---|---|---|---|
| **Vale de papel** | UNO por operación, aunque toque cuatro bolsas | se archiva; no viaja dentro de la bolsa | **no** |
| **Etiqueta** | una POR bolsa | pegada a la bolsa, con la resta entera | **no** |
| **Vale de caja** | uno por corte | al sistema de la caja | **sí** |

El vale de papel dice de qué bolsa salió cada parte y quién recibió; la etiqueta
lleva `inicial − vales = lo que queda`, que es lo que alguien va a contar con las
manos; y el vale de caja es el único movimiento que corre el número del corte.

**Por eso una salida de una bolsa de un día ya cerrado igual imprime su papel y
su etiqueta, y aun así no se anota en la caja.** Los dos primeros son respaldo;
el tercero es contabilidad.

Desde v2.853.0 las pantallas y el concepto que se escribe del otro lado dicen
**«vale de caja»** cuando es el tercero. Antes decía «VALES DEL PORTAL», que no
distinguía nada para quien lo lee allá.
