# Bitácoras: qué falta para que sean legales en las salas

**2026-10-28.** Pedido del usuario: *«revisar las bitácoras del portal
(temperatura, humedad, limpieza, antibióticos, inyecciones) de acuerdo a las BPA
y reglamentos de la SRS, dejarlas finalizadas, ver qué más se necesita para
sacarlo en producción»*.

Se midió **octubre en producción**, no el código. Las normas de referencia son
las dos que están en `docs/legal/`: **RTS 11.02.04:24 §6** (farmacias) y la
**Guía de Verificación BPAD**. Antecedentes:
`AUDITORIA-BITACORAS-SRS-2026-08-25.md`,
`AUDITORIA-LIBRO-BAJO-RECETA-2026-09-03.md` y
`BITACORAS-SOLO-DIGITAL-QUE-PIDE-LA-SRS-2026-09-03.md`.

---

## 1 · Estado por bitácora

| bitácora | octubre | veredicto |
|---|---|---|
| **Temperatura y humedad**, salas y bodegas de sala | 81/81 lecturas por área (3 por día × 27 días), con hora y persona | ✅ cumple 6.2.16 / 6.2.21 (Guía 2.27, 2.34). Dos humedades imposibles (0 % y 3 %): **corregido**, ver §2 |
| **Temperatura**, Bodega central | 62 de 69 lecturas | ⚠️ faltan 7 lecturas en 23 días |
| **Refrigerador**, Bodega central | 42 lecturas, **las 42 en 8.0 °C exactos**; **sin fecha de calibración** | ❌ Guía 2.32 CRÍTICO (termómetro calibrado). Y 42 lecturas idénticas en el límite del rango no son creíbles como medición (RTS 6.1.14, «preciso») |
| **Refrigerador**, salas | **no existe** | ❌ las 6 salas tienen en existencia eritropoyetina, y varias tienen insulinas. Ver §3.1 |
| **Limpieza** | 2 turnos por día en cada área, completos | ✅ cumple el registro (RTS 5.5.5 / 6.1.11). Falta el procedimiento escrito y firmado (Guía 1.11/1.12) |
| **Libro bajo receta** | 537 renglones, **0 completados**; 0 recetas, 0 médicos, 0 fotos | ❌ nunca se usó. **Reiniciado limpio para el 1-nov**, ver §2 |
| **Inyecciones** | 945 aplicaciones; **618 (65 %) firmadas por Dependientes o Jefes de Sala** | ❌ ver §3.2 |
| **Cierre de mes** | sólo La Popular cerró agosto; **septiembre no lo cerró nadie** | ❌ el rol Regente tiene 0 personas, y sólo él puede cerrar |
| **Respaldo** | semanal, 35 tablas, el último fue el 25-oct, sin errores | ✅ bitácoras y recetas adentro. **Faltan las inyecciones** |

---

## 2 · Lo que se aplicó hoy

1. **El libro bajo receta arranca limpio el 1 de noviembre** (decisión del
   usuario). `branches.libro_receta_desde = 2026-11-01` en las 6 salas, se
   borraron los 537 renglones de ago–oct (ninguno estaba completado, ninguno
   tenía receta: no había dato oficial que perder; están en el respaldo del
   25-oct) y los folios quedaron en 0. El primer renglón real va a ser el
   `2026-00001`. Octubre **no se puede reconstruir**: no se guardó ni una receta.
2. **Una lectura imposible ya no entra** — migración
   `20261028163232_bitacoras_una_lectura_imposible_no_entra`. Temperatura
   fuera de −20…50 °C o humedad fuera de 10…100 % se rechaza al anotar y al
   corregir. El rango de aviso de cada área no cambió. Las dos humedades de
   octubre (0 % en Salud 5 y 3 % en Bodega) se arreglan con «Corregir», que
   deja el motivo y el valor anterior.

---

## 3 · Lo que NO se arregla con software

### 3.1 · Cadena de frío en las salas — CRÍTICO

**Sí: la eritropoyetina va refrigerada (2–8 °C)**, y las insulinas sin abrir
también. Las 6 salas tienen eritropoyetina en existencia, y varias tienen
Lantus, Humulin, Insulex o Novolin. Según el usuario, **sólo Bodega tiene
refrigerador**.

RTS 6.2.18 (refrigerador exclusivo), 6.2.19 (termómetro calibrado), 6.2.20
(registro dos veces al día) y Guía 2.32 / 2.33, los dos **CRÍTICOS**. Hay dos
salidas, y hay que elegir una:

- **poner un refrigerador exclusivo en cada sala que venda producto de frío**.
  Después se activa en Bitácoras → Configuración, con su fecha de calibración, o
- **sacar ese producto de las salas** y despacharlo sólo desde donde haya
  refrigerador.

Mientras tanto, un inspector que abra la vitrina y encuentre eritropoyetina a
temperatura ambiente lo marca como CRÍTICO, y eso pesa más que cualquier
registro.

### 3.2 · Inyecciones aplicadas por personal que no es de enfermería

El RTS y la Guía de la SRS **no regulan la aplicación de inyectables**. Esa
regla viene del ejercicio profesional de enfermería (CSSP / Junta de Vigilancia
de la Profesión de Enfermería). Hay que confirmarla con el regente. Pero el dato
de octubre dice que 472 inyecciones las marcó un Dependiente de Farmacia y 146
un Jefe de Sala.

**No se van a ocultar del registro.** Es lo que se pidió, y se descartó a
propósito: un inspector cruza las ventas de inyectables contra el registro, y
un hueco se lee como ocultamiento, que es peor que el hallazgo. Lo que sí se
puede hacer, y espera el visto bueno del usuario: que **desde ahora sólo
personal de enfermería pueda marcar una inyección como aplicada**. Así el
registro dice la verdad hacia adelante. Además le faltan **lote y vencimiento**
de lo aplicado: hoy sólo 22 de 993 llevan la dosis.

### 3.3 · Por qué el libro nunca se usó

Medido: **cero intentos**. No hay un médico guardado ni una foto subida, y la
bitácora de auditoría no tiene ni una acción del libro. No es un error que
falle: **la sala no lo está llenando**. Si el 1-nov arranca igual, en noviembre
va a pasar lo mismo. Hace falta:

- **capacitar a la sala** (cómo se completa un renglón con la receta en la
  mano: médico por número de JVPM, paciente, cantidad prescrita y foto), y
- **probar el circuito completo una vez en sala**, incluida la consulta al
  CSSP, que con la tabla de médicos vacía es el único camino para el primer
  médico de cada sala.

### 3.4 · El refrigerador de Bodega

- Cargar **la fecha de calibración** del termómetro (Configuración →
  Refrigerador). Sin certificado, el ítem 2.32 falla.
- **Revisar el termómetro**: 42 lecturas idénticas en 8.0 °C significan que el
  aparato está trabado o que se anota el límite en vez de leerlo. Las dos cosas
  son hallazgo. Y 8.0 es el borde: si es real, el refrigerador está al límite.

---

## 4 · Lo que falta para que sea legal — lista de arranque

**Bloqueantes (sin esto el registro digital no está autorizado):**

1. **Nombrar al Regente en el portal.** Hoy son 0 personas. Es quien firma los
   procedimientos (RTS 6.1.12, Guía 1.12 MAYOR) y el único que puede cerrar el
   mes. *Pendiente, decisión del usuario.*
2. **Firmar y sellar los procedimientos** de `docs/legal/procedimientos/`:
   - **A**: manejo de documentación digital (RTS 6.1.14);
   - **B**: protocolo de supervisión del sistema electrónico (RTS 6.1.15, Guía
     3.6 MAYOR);
   - **C**: hoja de contingencia.

   Siguen en BORRADOR desde el 3-sep.
3. **Cerrar septiembre y octubre** en las 6 salas cuando exista el Regente.
4. **Refrigeradores en sala o sacar el producto de frío** (§3.1).
5. **Calibración del refrigerador de Bodega** (§3.4).

**Faltan escribirse (procedimientos que firma el regente):**

6. Limpieza y mantenimiento de áreas **y mobiliario** (RTS 6.1.11, Guía 1.11
   MAYOR). El registro existe; el escrito que respalda, no.
7. Adquisición, dispensación, devolución y disposición final de antibióticos
   (RTS 6.4.1, Guía 3.1 MAYOR).
8. Manejo de medicamentos vencidos (Guía 6.3).

**Faltan construirse en el portal (ordenado por riesgo):**

9. **Registro trazable de antibióticos**: entradas, salidas, devoluciones y
   destrucción por lote, cuadrado contra existencias (Guía 3.3 / 3.4, **los dos
   CRÍTICOS**). Hoy el libro registra sólo la salida.
10. **Listado de antibióticos con su grupo AWaRe** (Guía 1.13 MAYOR). Hoy no
    existe. La fuente es el LOM 2025 de la SRS, cap. J01.
11. **Disposición final** de antibióticos vencidos o no conformes (Guía 3.8).
12. **Inyecciones**: sólo enfermería marca «aplicada»; lote y vencimiento de lo
    aplicado; y la tabla `inyeccion_aplicaciones` adentro del respaldo semanal.
13. **Evaluación periódica del sistema** (RTS 6.1.15): definir quién la hace y
    cada cuánto, y dejar constancia. Es la quinta sección del protocolo B y no
    existe.

**Se quedan en papel (decisión ya tomada):** bitácora de visitas del regente
(RTS 6.3.7, Guía 2.23); constancia del control de plagas (RTS 6.2.22);
registro de capacitación (Guía 2.20).

**Hay que pedírselo a la DNM:** la resolución con el listado oficial de
antibióticos bajo receta, y cuál es su sistema de control de estupefacientes y
psicotrópicos (Guía §4: hay tramadol y pregabalina en catálogo sin control).
