# Nómina — cómo se arma una quincena, ley por ley

**Escrito el 2026-08-24**, durante la auditoría completa del portal. Era una de
las once áreas sin documento propio, y es la única donde un error de una
constante es directamente **dinero mal retenido a una persona**.

---

## 1. Las dos secciones, y por qué están separadas

La boleta se arma en dos bloques que **no se pueden mezclar**:

| | qué lleva | ¿retiene? |
|---|---|---|
| **Sección A** | el salario ordinario de los días trabajados | **sí** |
| **Sección B** | recargos nocturnos, tiempo extra, asueto, bonificaciones, prima de vacaciones, viáticos | **no** (Código de Trabajo, arts. 169 y 190) |

```
líquido = A − (retenciones + descuentos) + B
```

Meter algo de B dentro de A no cambia el bruto: cambia **cuánto se le retiene a
la persona**. Es el error que esta separación existe para evitar.

---

## 2. Las tarifas

```
tarifa diaria = salario mensual / 30       (4 decimales)
tarifa hora   = tarifa diaria / 8          (4 decimales)
```

Los cuatro decimales no son coquetería: redondear la tarifa a centavos y después
multiplicarla por las horas del mes corre el resultado.

| concepto | factor | por qué |
|---|---|---|
| recargo nocturno ordinario | **× 0.25** | Art. 168: sólo el **recargo** sobre la tarifa diurna; la hora ya está pagada en A |
| tiempo extra diurno | **× 2.00** | Art. 169: 100% de recargo = doble |
| tiempo extra nocturno | **× 2.25** | Art. 169: el doble más el 25% nocturno |
| `night_hours_extra` | × 0.50 | campo heredado: **la consolidación automática no lo usa** |

---

## 3. Las retenciones

```
ISSS  = min(salario ordinario, 500) × 3%      ← tope legal: $1,000/mes = $500/quincena
AFP   = salario ordinario × 7.25%
base de renta = salario ordinario − ISSS − AFP
RENTA = tabla quincenal
```

**El tope del ISSS se aplica a la base, no al resultado.** Sin él, un sueldo alto
retiene de más y la boleta no cuadra contra la planilla del Seguro.

### La tabla de renta — y el defecto de dinero que tenía

Decreto Ejecutivo No. 10 de 2025, vigente desde la **primera quincena de mayo de
2025**. Reformó el art. 37 de la Ley de Impuesto sobre la Renta y subió el
mínimo exento a $550 mensuales (**$275 quincenales**).

| tramo | hasta | cuota fija | tasa | sobre el exceso de |
|---|---:|---:|---:|---:|
| I | 275.00 | 0 | 0% | — |
| II | 447.62 | 8.83 | 10% | 275.00 |
| III | 1,019.05 | 30.00 | 20% | 447.62 |
| IV | ∞ | 144.28 | 30% | 1,019.05 |

**Hasta el 2026-08-23 esto anualizaba la base (×24), aplicaba una tabla anual y
volvía a dividir.** Dos problemas:

1. La tabla anual era **la anterior a la reforma** —exento $4,064 al año, o sea
   $169.33 por quincena— y llevaba desactualizada desde mayo de 2025.
2. **Le faltaban las cuotas fijas.** El tramo II sumaba sólo el 10% del exceso
   sin los $8.83; el III arrancaba en $507.83 en vez de $720.00 anuales. Ni
   siquiera era internamente consistente: con sus propios números el tramo IV
   debía arrancar en $3,250.68 y decía $3,462.47.

Cuánto costaba:

| base gravada | retenía | correspondía |
|---:|---:|---:|
| $275.00 | $10.57 | **$0.00** |
| $500.00 | $44.97 | $40.48 |

**No le pasó a nadie**: al descubrirlo no había ni un período generado ni un
empleado con sueldo cargado. Era un defecto **latente**, y de dinero.

> **La tabla oficial es quincenal, así que se escribe quincenal.** Anualizar y
> desanualizar sólo agrega dos redondeos y una oportunidad de que los tramos
> dejen de empalmar.

`tests/unit/payroll.test.js` la vigila **tramo por tramo, incluidos los bordes
exactos**. Al cambiar la ley se cambia `TRAMOS_RENTA_QUINCENAL` y nada más.

---

## 4. De dónde salen los insumos

- **Días trabajados y horas** vienen de `timesheets` — o sea de
  `consolidate-timesheets`, que es quien decidió qué es hora extra y qué es
  nocturna. Ver `docs/ASISTENCIA-COMO-SE-CUENTA-EL-TIEMPO-2026-08-24.md`.
- **Anticipos y vacaciones** salen de `approval_requests` aprobadas.
- **Todo lo demás se puede pisar a mano** (`overrides`), y ese es el punto: la
  planilla propone, una persona confirma.

**Regenerar un período borra sólo las entradas `PENDING`.** Lo ya confirmado no
se pisa: si se pudiera, regenerar sería una forma silenciosa de deshacer una
decisión.

---

## 5. Antes de tocar algo en Nómina

1. **Una constante de ley se cambia en un solo lugar**, y la prueba que la
   vigila se actualiza en el mismo commit — nunca al revés.
2. **Nada nuevo entra a la sección A** salvo que la ley diga que retiene.
3. **Redondear al final, no en el camino.** Las tarifas llevan 4 decimales a
   propósito.
4. **Un tope se aplica a la base.**
5. **Antes de creer que un cálculo está bien, probarlo en los BORDES exactos de
   cada tramo** — el defecto de arriba sobrevivió porque nadie miró $275.00.
