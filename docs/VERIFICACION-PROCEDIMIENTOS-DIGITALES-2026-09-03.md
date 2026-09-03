# Verificación de los dos procedimientos digitales

**2026-09-03.** Encargo: revisar `BORRADOR-A` (manejo de documentación digital,
RTS 6.1.14) y `BORRADOR-B` (supervisión del sistema electrónico, RTS 6.1.15),
comprobarlos contra el RTS y la Guía de la SRS, ver cómo lo hacen otros, y decir
si están completos y sirven para una inspección.

**Veredicto: NO están listos para firmar todavía.** Las cinco secciones que exige
el 6.1.15 están las cinco —eso está bien y es lo difícil— pero hay **una cita del
capítulo equivocado**, **cinco afirmaciones que el sistema no sostiene** (medidas
contra producción hoy), **un registro CRÍTICO fuera del alcance**, y **cuatro
controles que ningún marco internacional omite**. Ninguno de los dos cita la
**Ley de Firma Electrónica de El Salvador**, que es justamente la norma que hace
defendible todo el planteo.

Lo bueno: la estructura es correcta, las cinco secciones del 6.1.15 están
nombradas igual que la norma, el §2.3 del B ya plantea solo el problema del
cierre, y de lo verificable **las 14 citas normativas dan bien y 13 de las 18
afirmaciones sobre el sistema también**.

---

## 1 · Las fuentes, y que son las buenas

| fuente | de dónde | verificación |
|---|---|---|
| RTS 11.02.04:24 | `docs/legal/rts_11020424_bpadyt.pdf` | **md5 idéntico** al de OSARTEC (`osartec.gob.sv/…/RTS-BPADyT_-18122024-1.pdf`) — es el oficial |
| Guía de Verificación BPAD | `docs/legal/srs_guia_verificacion_bpad.txt` | leída completa |
| Ley de Firma Electrónica | D.L. 133/2015, `factura.gob.sv` | descargada y leída — **no está citada en ninguno de los dos borradores** |
| EU GMP Anexo 11 | Comisión Europea, rev. 1 (2011) | leído completo, 17 cláusulas |
| 21 CFR Part 11 | FDA, §11.10 (a)–(k), §11.50, §11.70 | leído |
| PN/L/PG/009/00 SEFH | procedimiento real de farmacia publicado (España) | leído completo — sirve de patrón de estructura |

⚠️ **El RTS tiene dos capítulos y sólo el §6 es nuestro** (farmacias y
botiquines). El §5 es de laboratorios, droguerías y centros de almacenamiento.
Esto ya costó una vez —la calibración del termómetro de sala— y **vuelve a costar
acá**: ver el hallazgo A1.

---

## 2 · Cada cita, comprobada

### Las que están bien

| cita | dice | ✓ |
|---|---|---|
| RTS 6.1.12 | documentación revisada/autorizada por el regente, con firma y sello | ✓ |
| RTS 6.1.14 | preferiblemente física; digital exige procedimiento previamente autorizado por el Regente; ALCOA | ✓ literal |
| RTS 6.1.15 | acceso, resguardo, forma de registro, respaldo, evaluación periódica | ✓ literal, y las 5 están en el B |
| RTS 6.1.3 | archivo de inspecciones, no menos de 3 años | ✓ |
| RTS 6.2.11 | instrumento independiente para bodega y sala | ✓ |
| RTS 6.2.15 | no mayor a 30 °C | ✓ |
| RTS 6.2.16 | **al menos dos veces al día**, conservar **2 años**, humedad informativa | ✓ (ver A10) |
| RTS 6.2.21 | evidencia de **fecha, hora y persona** | ✓ |
| RTS 6.3.7 | bitácora de visitas del regente, firma y sello, 1 año | ✓ |
| Guía 1.12 | ¿procedimientos autorizados por el regente? · MAYOR | ✓ |
| Guía 2.27 | ¿registros de temperatura, al menos dos veces al día? · **CRÍTICO** | ✓ |
| Guía 2.34 | ¿se anota fecha y persona? · MAYOR | ✓ |
| Guía 3.6 | protocolo de supervisión del sistema electrónico · MAYOR | ✓ (vive en la sección **3, ANTIBIÓTICOS**) |
| Guía 3.12 | dispensación resguardada al menos 1 año · MAYOR | ✓ |

### La que está mal

**`5.6.5` — capítulo equivocado.** Ver A1.

### Las que faltan

`6.2.18`, `6.2.20` (refrigerador, registro dos veces al día, 2–8 °C), `6.2.19`
(termómetro calibrado del refrigerador), Guía `2.29`/`2.32`/`2.33` (los tres
**CRÍTICOS**), Guía `3.7` (qué es un libro controlado), RTS `6.3.2`/`6.3.4`
(capacitación con registro), y **toda la Ley de Firma Electrónica**.

---

## 3 · Cada afirmación sobre el sistema, medida contra producción

### Ciertas (medidas hoy)

| lo que dicen | medido |
|---|---|
| la hora la fija el servidor | `registrar_lectura_bitacora` usa `bitacora_ahora_sv()` ✓ |
| una lectura tardía queda marcada | `tarde = true` en **77 de 619** lecturas ✓ |
| no se acepta fuera de rango sin acción correctiva | la función lo exige; **1 fuera de rango, 0 sin acción** ✓ |
| cada quien sólo ve su sala, y lo aplica la base | `bitacora_exigir_acceso` + `auth_module_scope` ✓ |
| las 7 tablas tienen RLS con policy explícita | ✓ las 7, `relrowsecurity=true`, 1–4 policies cada una |
| ningún proceso automático borra bitácoras | los 6 crons de purga tocan sesiones, avisos, historial de cron y logs de sync ✓ |
| respaldo semanal, domingos 02:00 SV, 60 días, 30 tablas | cron `0 8 * * 0` UTC = 02:00 SV ✓ · `RETENTION_DAYS = 60` ✓ · **30 tablas contadas** ✓ |
| sesión: 5 min sala/bodega, 12 h administrativos | `idle_limit_min` = 5 (20 cargos) y 720 (5 cargos) ✓ |
| datos en Supabase, us-east-1 | ✓ confirmado (`region: us-east-1`, Postgres 17.6) |
| el cierre lo pueden hacer varios cargos y el único cierre no lo hizo el regente | ✓ el cierre de `2026-08` lo firmó un **Supervisor/a de Ventas** |
| corregir una **lectura** agrega, no pisa | ✓ `bitacora_correcciones` guarda antes/después/motivo/quién |
| reabrir un mes exige motivo y queda registrado | ✓ `reabrir_mes_bitacora` inserta `accion='reabrir'` con motivo |
| la anotación se hace con cuenta propia | ✓ `auth_employee_id()`; el kiosco de marcaje **no** escribe bitácoras |

### Falsas

Las cinco están en los hallazgos A3, A4, A5, B2 y B3.

---

## 4 · Hallazgos

Ordenados por lo que costaría en una inspección.

### A1 · Se cita el capítulo de las droguerías 🔴

`BORRADOR-A §4.2` cierra con «conforme al numeral **5.6.5**». El 5.6.5 está en el
**capítulo 5**, que es de laboratorios, droguerías y centros de almacenamiento.

Y no es que esté en el capítulo de al lado: **el capítulo 6 no tiene ninguna
cláusula de desviaciones ni de acción correctiva.** Buscando `desviaci|correctiv`
en todo el §6: **cero coincidencias**.

O sea que el documento que firma el regente le ofrece al inspector una cláusula
que no nos obliga, y deja sin fundamento el control que sí hacemos.

**Corrección:** el rango sale de `6.2.15` (≤30 °C) y `6.2.20` (2–8 °C), y la
obligación de registrar de `6.2.16`. La acción correctiva es una decisión propia
del establecimiento —buena y conviene mantenerla— pero se declara como tal, no
como cumplimiento de un numeral ajeno.

### A2 · El refrigerador no está en el alcance 🔴

`BORRADOR-A §2` declara «temperatura y humedad relativa de **sala de ventas y
bodega**». Producción tiene un área más que ya se está registrando:

| tipo | áreas activas | franjas/día | rango |
|---|---:|---:|---|
| sala_ventas | 6 | 3 | ≤30 °C |
| bodega | 7 | 3 | ≤30 °C |
| **refrigerador** | **1** | **2** | **2.00–8.00 °C** |
| vitrinas | 6 | — | sólo limpieza |
| servicio_sanitario | 7 | — | sólo limpieza |

El refrigerador es RTS **6.2.20**, y en la Guía son **tres ítems CRÍTICOS**
(2.29, 2.32, 2.33). Un registro digital que existe y queda **fuera del
procedimiento autorizado** es exactamente el hueco que castiga el 6.1.14: se
lleva en digital sin el procedimiento que lo habilita.

Faltan además las limpiezas de **vitrinas** y **servicio sanitario**, que el §2
mete dentro de un genérico «limpieza y orden por área» sin nombrarlas.

### A3 · «Ningún dato se borra» es falso 🔴

`BORRADOR-A §4.3` abre con **«Ningún dato se borra ni se sobrescribe.»**

`anular_limpieza_bitacora` hace:

```sql
DELETE FROM public.bitacora_limpiezas WHERE id = p_limpieza_id;
```

Pide un motivo, **valida que no esté vacío, y lo descarta**: no se guarda en
ningún lado. La fila desaparece y no queda rastro de que existió. Sólo está
frenado dentro de un mes ya cerrado; dentro del mes abierto, se borra sin huella.

Choca con:

- **Ley de Firma Electrónica Art. 13-A(c)** — el archivo debe mantenerse
  «**íntegro, legible, completo y sin alteraciones**». Y su **Art. 14**, último
  inciso: la alteración que afecte la integridad **hace perder el valor legal**
  que la ley le da al documento almacenado.
- **Anexo 11 §9** — para cambio o borrado de datos GMP, **el motivo debe quedar
  documentado**.
- **21 CFR 11.10(e)** — pista de auditoría segura y con sello de tiempo que
  registre las acciones que **crean, modifican o borran** registros.

**Corrección de sistema, no de documento:** anular tiene que ser una marca
(`anulada_at`, `anulada_por`, `motivo`), como ya lo hace
`bitacora_dispensaciones`. El modelo correcto ya está en el repo.

### A4 · «Conserva el valor anterior» es falso para limpiezas 🟠

`corregir_limpieza_bitacora` hace `UPDATE … SET puntos = …, observaciones = …`:
**pisa** los valores. Sobreviven quién, cuándo y por qué; **el valor anterior
no.** Para lecturas sí es cierto (`bitacora_correcciones` guarda antes y
después), pero §4.3 y la fila «Preciso» del §5 lo dicen en general.

O el documento distingue los dos casos, o el sistema guarda el antes de la
limpieza. Lo segundo es mejor y es media hora de trabajo.

### A5 · El instrumento que la hoja promete no existe 🟠

`BORRADOR-A §4.5` dice que el mes impreso lleva «**el instrumento con el que se
mide**». La función `get_bitacora_mes_impreso` efectivamente tiene el campo. Pero
en producción:

**27 áreas activas · `instrumento` cargado en 0 · `calibrado_hasta` cargado en 0.**

O sea que la hoja sale con ese renglón en blanco. Y para el refrigerador,
«¿cuenta con termómetro calibrado?» (Guía 2.32) es **CRÍTICO** — el RTS 6.2.19 lo
exige si se maneja cadena de frío.

Es dato que falta cargar, no código que falta escribir. Pero un procedimiento
firmado que describe un renglón vacío es peor que no describirlo.

### A6 · No hay qué hacer cuando el sistema no está 🔴

`BORRADOR-A §4.1` dice: «**No se transcribe de un papel: el registro del sistema
es el original.**» Y no ofrece ninguna alternativa.

Las lecturas de 6.2.16 no se suspenden porque el portal esté caído. Y el portal
**se ha caído dos veces con incidente escrito**: 2026-07-08 y 2026-09-01. Con el
procedimiento como está, en esas horas el personal quedaba sin salida legal:
anotar en papel viola el procedimiento firmado, y no anotar viola el RTS.

**Anexo 11 §16** lo pide con nombre propio: para sistemas que soportan procesos
críticos hay que prever la continuidad ante una caída (un sistema manual o
alternativo), y **el arreglo tiene que estar documentado y probado**.

**Corrección:** una hoja de contingencia controlada, y la regla de que al volver
el sistema se carga marcando que viene de contingencia, con la hoja de papel
archivada como respaldo. Eso no rompe «el original es el digital»: lo vuelve
honesto.

### A7 · La acción correctiva no está definida 🟠

`§4.2` sólo exige que se anote. El PN de la SEFH —procedimiento real de farmacia,
publicado— exige que ante una desviación el farmacéutico haga el análisis:
inventario de los medicamentos y lotes afectados, cuántas horas estuvieron fuera
de rango, a qué temperatura, y decisión documentada; y que **no se dispense el
producto afectado hasta haber investigado, justificado y documentado** que la
desviación no afecta calidad, seguridad ni eficacia.

Es la parte que protege al paciente, y es la que un inspector lee primero.

### A8 · Falta la capacitación, que el RTS exige con registro 🟠

**RTS 6.3.2** obliga a un programa anual de capacitaciones que incluya, entre los
temas, «**de este reglamento**», bajo responsabilidad del regente; **6.3.4**
obliga a que exista **registro** de la capacitación con el material y la
evaluación.

Ninguno de los dos procedimientos dice quién se capacita en él, cuándo, ni dónde
queda la constancia. **21 CFR 11.10(i)** pide lo mismo: que quien usa el sistema
tenga la formación para hacerlo.

### B1 · El proveedor es un tercero y no está tratado como tal 🔴

`BORRADOR-B §1` nombra a Supabase y ahí termina. No hay contrato, ni
responsabilidades, ni qué pasa si el servicio termina.

**Anexo 11 §3.1** exige acuerdo formal con declaración clara de las
responsabilidades del tercero. **21 CFR 11.10(k)** pide control de la
documentación del sistema.

Y hay un ángulo salvadoreño que conviene escribir porque **juega a favor**:
**Ley de Firma Electrónica Art. 12** — el almacenamiento de documentos
electrónicos puede hacerse por proveedor acreditado **o por cuenta propia**, y
quien almacena **por cuenta propia no tiene obligación de acreditarse** ante la
Unidad de Firma Electrónica. Farmalasa guarda sus propios registros: está en ese
supuesto. Decirlo evita la pregunta.

### B2 · «Toda salida de datos queda anotada» es falso para bitácoras 🟠

`BORRADOR-B §3` lo afirma. Medido: `export_log` tiene **41 filas** y los módulos
son `minmax`, `staff_list`, `dte_compra`, `libros_iva`, `libro_compras_completo`.
**Ninguno de bitácoras.** Ni la descarga ni la impresión del mes llaman a
`registrarEgreso` — no hay una sola referencia en `src/views/bitacoras`,
`src/components/bitacoras`, `src/data/bitacoras.js` ni en los dos maquetadores.

Es el módulo del que trata el protocolo, y es la regla propia del proyecto
(«toda salida de datos del portal se ANOTA»).

### B3 · «Toda acción queda en la bitácora de auditoría» es falso para bitácoras 🟠

`BORRADOR-B §4`. Medido sobre `audit_logs` (15,400 filas):

| acción | filas |
|---|---:|
| `PERMISOS_CAMBIO` | 216 |
| `CONFIGURAR_AREA_BITACORA` | 2 |
| `CONFIGURAR_HORARIOS_BITACORA` | 1 |
| registrar/corregir lectura, corregir/anular limpieza, cerrar/reabrir mes | **0** |

Sobre 619 lecturas, 3 correcciones y 1 cierre. Las tablas propias sí llevan quién
y cuándo, así que **la atribución existe** — lo que no existe es la pista
independiente de **21 CFR 11.10(e)**. Y es donde más duele: el `DELETE` del
hallazgo A3 no queda registrado en ninguna parte, ni en su tabla ni acá.

### B4 · La cuenta de pruebas puede cerrar el mes, y el documento no lo dice 🟠

`BORRADOR-B §2.2` declara **cinco** cargos con «Cerrar el mes». Producción tiene
**seis**: los cinco más `QA / Testing (CI)`.

La tabla `roles` ya tiene la columna `es_cuenta_de_pruebas` (y `QA / Testing (CI)`
es la única marcada), así que hay dos salidas limpias: declararla como cuenta que
no es una persona, o quitarle el permiso. Lo que no se puede es enumerar quién
firma y omitir a uno.

Lo mismo en los otros cuatro renglones de esa tabla: todos omiten QA.

### B5 · Respaldo de 60 días junto a conservación de 2 años, sin reconciliar 🟠

`§3` dice conservación **2 años**; `§5` dice retención del respaldo **60 días**.
Son compatibles —la base viva es el medio de conservación y el respaldo es contra
pérdida— pero el documento no lo dice, y quien lo lea encuentra una
contradicción. **Anexo 11 §17** y **21 CFR 11.10(c)** piden justamente que el
registro sea recuperable **durante todo el período de retención**.

### B6 · El respaldo declara siete tablas que todavía no se respaldaron ni una vez 🟠

La migración que mete las 7 tablas de bitácoras al respaldo es **de hoy**
(`20260903174328`). El cron corre los domingos. **La corrida con las 30 tablas no
ha ocurrido.**

El bracket `[dd/mm/aaaa] — 30 tablas, 0 fallos` está bien dejado vacío. Lo que
hay que hacer es **dispararlo una vez a mano y guardar la constancia antes de que
el regente firme** — si no, el documento declara un control que nunca corrió, que
es la trampa que este repo ya conoce.

### B7 · Faltan control de cambios, incidentes y continuidad 🟠

Tres cláusulas que ningún marco omite y que los dos borradores no tienen:

| | Anexo 11 | Part 11 | estado |
|---|---|---|---|
| **Control de cambios** del sistema | §10 | 11.10(k) | el repo ya lo hace (versión, CHANGELOG, migraciones, gates) — falta declararlo |
| **Gestión de incidentes** | §13 | — | no existe |
| **Continuidad** ante caída | §16 | — | no existe (es el A6) |

El primero es gratis: ya está hecho, sólo hay que escribirlo.

### B8 · La firma electrónica no está caracterizada, y la ley salvadoreña la nombra 🔴

`§2.3` plantea bien el dilema pero le falta el fundamento. Lo da la
**Ley de Firma Electrónica (D.L. 133/2015)**:

> **Art. 6** — «La firma electrónica simple tendrá la misma **validez jurídica**
> que la firma autógrafa. En cuanto a sus efectos jurídicos, la firma electrónica
> simple **no tendrá validez probatoria en los mismos términos** a los concedidos
> por esta ley a la firma electrónica certificada; sin embargo, podrá constituir
> un elemento de prueba conforme a las reglas de la sana crítica.»

El cierre en el sistema es una **firma electrónica simple**. Vale, pero prueba
menos. Y el RTS 6.1.12 pide firma **y sello profesional** — el sello es del
profesional colegiado, no del sistema.

**Recomendación, que además desatasca el §2.3:** lo que cumple el 6.1.12 es **la
hoja impresa firmada y sellada por el regente**; el cierre en el sistema es un
control interno con firma electrónica simple. Escrito así, el documento es cierto
con los seis cargos actuales y no hay que restringir nada para poder firmarlo.
Restringirlo igual conviene, pero deja de ser un bloqueo.

Y si se quiere que el cierre valga como firma, **21 CFR 11.50** dice qué tiene
que mostrar: **nombre impreso del firmante, fecha y hora, y el significado** de
la firma (revisión, aprobación, responsabilidad). **11.70**: ligada al registro
de modo que no se pueda separar ni transferir.

### B9 · La Ley de Firma Electrónica no aparece en ninguno de los dos 🔴

Es la norma salvadoreña que hace defendible «el registro del sistema es el
original», y ninguno la cita. Los artículos que aplican:

| artículo | qué da |
|---|---|
| **Art. 6** | firma simple = validez jurídica de la autógrafa, sin igual fuerza probatoria |
| **Art. 7** | equivalencia funcional: lo suscrito electrónicamente se reputa escrito |
| **Art. 11** | la exigencia de conservar por un plazo se cumple por cuenta propia si se cumple el 13-A |
| **Art. 12** | por cuenta propia **no hay que acreditarse** ante la Unidad de Firma Electrónica |
| **Art. 13-A** | mínimos: consultable en cualquier momento · formato conservado o reproducción exacta · **íntegro, legible, completo y sin alteraciones** |
| **Art. 14** | el sistema debe garantizar legible/íntegro/seguro/auténtico, fecha y hora precisas del almacenamiento, y recuperación. **Omitir cualquiera hace perder el valor legal** |

Los tres mínimos del 13-A se mapean casi uno a uno con ALCOA y con las cinco
secciones del 6.1.15. Citarlos convierte los dos documentos de «así lo hacemos»
en «así lo manda la ley y así lo hacemos».

### A9/B10 · Menores de forma 🟡

- El `§7` del A cita ítems de la Guía `1.12, 2.27, 2.34, 3.6`; el 3.6 es el ítem
  del documento **B**, y faltan 2.29/2.32/2.33 (refrigerador) y 3.7.
- No hay **«Sustituye a:»** en el encabezado (el SEFH sí lo tiene).
- No hay **control de copias**. Con 7 salas y una norma que prefiere el papel, si
  el procedimiento se imprime y se reparte sin numerar las copias, aparecen
  versiones viejas en sala. El SEFH lo resuelve con su Anexo I: número de copia,
  nombre, cargo, firma, fecha.
- No hay sección de **definiciones** (ALCOA, franja, cierre, corrección,
  anulación, contingencia).
- Los formularios `FLS-BIT-00` a `FLS-BIT-03` se referencian pero **no se
  adjuntan**. En el patrón normal son anexos del propio procedimiento.
- El B tiene un bracket sin resolver en §2.1 sobre el carné con código de barras.
- **La copia impresa debe quedar en el establecimiento.** El 6.1.14 pide la
  documentación «disponible **dentro del establecimiento**», y los datos viven en
  us-east-1. El A §4.5 dice que se archiva; conviene decir explícitamente
  **dónde** y que es en cada sala.

### A10 · La frecuencia declarada supera la norma, y eso tiene filo 🟡

El `§2` declara **3 veces al día**; el RTS 6.2.16 exige **al menos dos**. Está
bien hacer más — pero una vez escrito «3», un día con 2 lecturas incumple **el
procedimiento propio**, que en una inspección se lee igual de mal.

Redacción segura: «no menos de dos (RTS 6.2.16); este establecimiento realiza
tres». El refrigerador va con **dos** (6.2.20), que es lo que ya tiene cargado.

---

## 5 · Cómo lo hacen los demás

**Ninguno de los tres marcos que miré organiza esto distinto del 6.1.15** — lo
organizan *más fino*. El 6.1.15 pide cinco cosas; el Anexo 11 pide diecisiete y
el Part 11 once. Las cinco del RTS están todas adentro de las otras dos listas,
así que **cumplir bien el RTS es un subconjunto honesto**, y las que faltan son
las que valen la pena copiar.

### PN/L/PG/009/00 — SEFH (España), control y registro de temperaturas

El procedimiento de farmacia realmente publicado que más se parece a lo nuestro.
Su estructura: Objetivo · Responsabilidad y alcance · **Definiciones** ·
Descripción (material y equipo / control de temperaturas) · **Registros** ·
**Control de cambios** · **Anexos**, y los anexos son las hojas mismas más un
**control de copias numeradas** y un **registro de incidencia** con código
correlativo.

Dos cosas que nos faltan y ahí están: **el control de copias** (A9) y **la
profundidad de la desviación** (A7).

### EU GMP Anexo 11 — Sistemas informatizados

Las cláusulas que nos faltan, en orden de lo que costaría:
**§16 Continuidad** (A6) · **§3 Proveedores y prestadores** (B1) ·
**§10 Control de cambios** y **§13 Incidentes** (B7) · **§17 Archivado** (B5) ·
**§9 Pistas de auditoría** —revisadas con regularidad, con el motivo de todo
cambio o borrado— (A3, B3) · **§6 Verificación de exactitud** para datos críticos
tecleados a mano, que es exactamente una lectura de temperatura, y que en nuestro
caso lo cubriría la verificación diaria del jefe de sala si se declara como tal.

### FDA 21 CFR Part 11 — §11.10 (a)–(k)

Lo que aporta que el Anexo 11 no dice tan directo:
**(b)** poder generar copias exactas y completas **en forma legible por humanos y
electrónica**, aptas para inspección y copia por la autoridad — nuestro §4.6 lo
cumple a medias, ofrece impresión o archivo pero no lo compromete;
**(c)** recuperación durante todo el período de retención (B5);
**(e)** pista de auditoría segura y con sello de tiempo para creación,
modificación **y borrado** (A3, B3);
**(i)** formación del personal (A8);
**(j)** política escrita que responsabilice a cada quien por lo hecho bajo su
firma — no existe, y es una línea;
**(k)** control de la documentación del sistema y de su distribución (A9).

### Ley de Firma Electrónica de El Salvador

Ver B9. Es la que más falta hace y la más barata de agregar.

---

## 6 · Qué hacer, en orden

> **Actualizado el mismo día.** Los puntos 1 a 6 y el 8 quedaron cerrados
> (v2.970.7 y v2.970.12). Sigue abierto el **7**: correr el respaldo una vez a
> mano. Y de las decisiones de la empresa quedan los datos de trámite —códigos,
> fechas, nombre y JVPM del regente— más la confirmación del umbral de 32 °C.

**Antes de que el regente firme:**

1. Corregir la cita `5.6.5` → `6.2.15` / `6.2.16` / `6.2.20` **(A1)**.
2. Meter el **refrigerador** y las limpiezas de vitrinas y servicio sanitario en
   el alcance **(A2)**.
3. Corregir las cinco afirmaciones falsas **(A3, A4, A5, B2, B3)** — o arreglando
   el sistema, o diciendo la verdad en el documento. Para A3 la corrección tiene
   que ser del sistema: un borrado sin rastro no se arregla escribiéndolo.
4. Agregar la **contingencia** **(A6)** — es lo único que hoy deja al personal sin
   salida legal.
5. Agregar la **Ley de Firma Electrónica** y resolver el §2.3 con el criterio de
   B8 **(B8, B9)**.
6. Declarar **QA / Testing (CI)** o quitarle el permiso de cierre **(B4)**.
7. Correr el respaldo una vez a mano y anotar la constancia **(B6)**.
8. Cargar `instrumento` y `calibrado_hasta` en las 14 áreas que miden
   temperatura **(A5)**.

**Antes de la próxima inspección:**

9. Proveedor y responsabilidades **(B1)**; control de cambios, incidentes **(B7)**;
   conciliar 60 días con 2 años **(B5)**; definir la acción correctiva **(A7)**;
   capacitación con registro **(A8)**; control de copias, definiciones,
   «Sustituye a» y los formularios como anexos **(A9)**.

**Lo que ya está bien y no hay que tocar:** las cinco secciones del 6.1.15 con los
nombres de la norma; que el §2.3 se haya planteado solo en vez de esconderse; la
tabla ALCOA del §5 del A; y que la evaluación periódica esté declarada como lo
único que todavía no existe como práctica, en vez de inventarla.

---

## 7 · La lección

**Cinco de los hallazgos son afirmaciones que el documento hace sobre el sistema
y que el sistema no sostiene** — «ningún dato se borra», «conserva el valor
anterior», «el instrumento», «toda salida queda anotada», «toda acción queda en
la bitácora». Las cinco eran ciertas *como intención*, y ninguna se había medido.

Es la diferencia entre un documento interno y uno que firma un profesional
colegiado: acá **cada frase es una declaración ante la autoridad**. Antes de
firmar, cada oración en presente sobre lo que el sistema hace tiene que haberse
medido contra producción — que es exactamente lo que costó el respaldo que no
alcanzaba a las bitácoras hace dos días.

Ver `feedback_una_afirmacion_que_nadie_verifica_deja_de_ser_cierta`.
