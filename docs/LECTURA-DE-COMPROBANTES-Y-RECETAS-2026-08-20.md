# Leer una foto de papel: boletas (hecho) y recetas (medido, sin construir)

**2026-08-20.** Qué se construyó para el comprobante de una salida de dinero,
qué decidió el usuario y por qué, cuánto cuesta, y qué dio la prueba real sobre
recetas médicas — que es la parte que **todavía no está construida** y no debería
construirse sin leer esto primero.

> **Sobre los datos de este documento.** La prueba se hizo con cinco recetas
> reales. Acá quedan los resultados y los datos del PRESCRIPTOR (nombre,
> especialidad, J.V.P.M.), que son registro profesional público y sin los cuales
> los hallazgos no se entienden. **Los nombres de los pacientes no se
> transcriben**: para lo que se estaba midiendo —si la letra es descifrable— el
> resultado es «acerté el nombre de pila y fallé el apellido», y para eso no hace
> falta decir de quién.

---

## 1 · Lo que quedó hecho (v2.695.0 / v2.695.1)

Salió de tres pedidos del usuario mirando una salida de dinero en producción:
*«no puedes detectar 1. que sea una boleta válida (que no tomen foto de otra
cosa), 2. que sólo se guarde la boleta, que detectes y recortes el papel,
3. mostrar vista previa y ajustar»*.

### 1.1 · El editor ya existía y esta pantalla no lo tenía

La foto del comprobante entraba tal cual salía del teléfono: el mostrador, la
caja y media estantería alrededor de una boleta que ocupaba un tercio del cuadro,
y sin vista previa para notarlo.

`EditorDeReceta` —el de las bitácoras, hecho justo para fotografiar papel sobre
un mostrador— hacía las tres cosas. Se generalizó a
**`src/components/common/EditorDeDocumento.jsx`** con un perfil por documento
(`DOCS` en `src/utils/fotoDocumento.js`). O sea que el problema no era
construirlo: era que el canónico no se conocía fuera de bitácoras.

**El aviso de «recorte chico» se mide por lado distinto según el documento.** Una
hoja se juzga por su lado corto; una boleta térmica bien recortada mide algo como
600 × 1500, así que ese aviso habría saltado en **todas** las boletas bien
tomadas. Un aviso que aparece siempre deja de leerse y se lleva puestos a los que
sí importan.

### 1.2 · El recorte del papel: sugerido, nunca automático

Bajar un modelo de visión al teléfono se evaluó y se descartó (el motivo está
escrito en la cabecera de `EditorDeDocumento`): pesa megabytes y se equivoca con
una foto movida. **Pero como la foto ahora ya viaja para leerla**, el recuadro del
papel sale de esa misma llamada sin costar nada extra. El editor abre con ese
recorte puesto y la persona confirma o corrige.

Un recorte automático que nadie mira sigue siendo peor que uno manual. Eso no
cambió porque lo proponga un modelo.

### 1.3 · La boleta tiene que cuadrar

«Que sea una boleta válida» no se contesta con un heurístico de «esto parece un
documento»: eso caza la foto de una pared, **no la de otra boleta** ni la de una
boleta de $50 para una salida de $200. Se contesta LEYENDO la boleta y cruzándola
contra los tres datos que el formulario ya pide: **entidad, número y monto**.

- Función: **`supabase/functions/leer-boleta`** (`verify_jwt: true` — la llama el
  navegador con sesión, no un cron).
- La imagen viaja **inline en base64**, no por el bucket: la verificación pasa
  ANTES de guardar, y subir para verificar dejaría en `payment-proofs` la basura
  de cada intento descartado.
- **El veredicto lo arma código, no el modelo.** Comparar montos y números es
  aritmética. Si la regla dependiera de que el modelo diga «no coincide»,
  bastaría con que un día conteste distinto para que la regla cambie sola.
- Tolerancias escritas a propósito: `000292` == `292` (ceros de adelante),
  `TRANSNETWORK WS` ≈ `TRANSNETWORK` (una contiene a la otra, normalizadas),
  monto con un centavo de margen.

### 1.4 · Bloquea — decisión del usuario, con la objeción anotada

**Sin una boleta que cuadre, la salida no se registra.**

Se le ofreció la alternativa («avisa, deja guardar y queda marcado») señalando
que una lectura equivocada puede trabar a una sala con el cliente enfrente —el
efectivo ya salió en la realidad, el portal sólo lo registra— y eligió bloquear.
Queda escrito acá para que se sepa de dónde viene la regla el día que estorbe.

La pantalla separa los dos casos, que se arreglan distinto:

| Qué pasó | Qué dice | Cómo se sale |
|---|---|---|
| El veredicto no es `OK` | «La foto no parece la boleta», «La boleta dice $X y la salida es de $Y» | otra foto, o corregir el dato |
| No hubo veredicto (red, modelo caído) | «No se pudo revisar la foto» | reintentar |

**El bloqueo vive en el navegador, no en la base.** Se evaluó meterlo en
`registrar_salida_de_bolsa` y se descartó: esa función mueve efectivo, valida
diez cosas y está probada en sala; agregarle un parámetro obliga a DROP + CREATE
—cambia la firma— o sea a reescribir su cuerpo entero. Cubre el caso real (una
sala fotografiando otra cosa); no cubre a alguien llamando la RPC a mano.

### 1.5 · El rastro

`bolsas_operaciones.foto_lectura` (`jsonb`) guarda `{leido, coincide, veredicto}`.
Es lo que le permite a administración ver, al contar, **por qué** el portal dio
por buena esa boleta. Un control automático sin rastro de su decisión no se puede
auditar.

Se escribe con una función aparte (`guardar_lectura_de_boleta`) que **falla en
silencio a propósito**: es auditoría, y una salida que ya ocurrió en la realidad
no se deshace porque no se pudo anotar quién la revisó.

### 1.6 · La foto viaja reducida (v2.695.1)

Se mandaba la foto **cruda**: 4000 px, 3–4 MB. Tres problemas en uno — la subida
se arrastra en la conexión de una sala, la respuesta tarda más, y un lector cobra
la imagen **por píxeles**, así que costaba unas **cinco veces** más de lo
necesario. Va a 1400 px de lado largo. **El archivo que se guarda no cambia**:
sale del editor a su tamaño de siempre.

---

## 2 · Quién lee, y cuánto cuesta

Hoy lee **Gemini**, que ya está configurado y ya lo usan otras seis funciones del
portal. El usuario preguntó si convenía usar Claude; se dejó
`supabase/functions/_shared/claude.ts` escrito y el cambio reducido a **una
constante** (`LECTOR` en `leer-boleta`).

**Va como constante y no como «si hay key usá Claude, si no Gemini»**: un camino
que se elige solo hace que nadie sepa cuál corrió, y el día que la lectura falle
no se puede saber quién falló.

> **La suscripción de Claude no es una API key.** Claude Pro/Max y Claude Code se
> facturan aparte de la API. Para que `_shared/claude.ts` funcione hace falta una
> key de `console.anthropic.com` cargada como `ANTHROPIC_API_KEY` en los secretos
> de Supabase, con su propio consumo por token.

Costo medido, con la foto ya reducida (~1.960 tokens de imagen + ~700 de prompt;
salida ~250–550) y el volumen real de producción:

| | Volumen medido | Opus 5 ($5/$25) | Sonnet 5 ($3/$15) | Haiku 4.5 ($1/$5) |
|---|---|---|---|---|
| **Boletas** | 3,5/día (7 en 2 días) | ~$2.90/mes | ~$1.75/mes | ~$0.45/mes |
| **Recetas** (si se hiciera) | 5,9/día (291 en 49 días) | ~$5.40/mes | ~$3.20/mes | ~$0.85/mes |

Precios de lista de Anthropic **cacheados al 2026-06-24** — confirmar en
`anthropic.com/pricing` antes de comprometerse. La API es prepago, sin
mensualidad: una carga mínima dura meses a este volumen.

---

## 3 · La prueba sobre recetas — MEDIDA, no supuesta

El usuario propuso probar antes de construir: *«puedo enviarte ejemplos de fotos
de recetas, para ver si logras descifrarlo y así verificamos si es útil o no»*.
Cinco recetas reales, fotografiadas como las fotografía una sala. Leídas con
**Opus 5**, que es el mismo modelo que se pondría en la función.

### 3.1 · Resultado por campo

| Campo | Acierto | Nota |
|---|---|---|
| Encabezado impreso (clínica, médico, especialidad) | **5 / 5** | perfecto |
| **N.º de J.V.P.M.** | **3 / 5** | ver §3.2 — las otras dos NO TIENEN |
| Fecha | 4 / 5 | la quinta tiene el día ilegible |
| Paciente — nombre de pila | 5 / 5 | |
| Paciente — apellido | **~2 / 5 con certeza** | el resto: dudoso o adivinado |
| Medicamentos | **3 / 5 recetas sirven** | dos quedaron ilegibles enteras |

Las tres que salieron bien traían medicamentos identificables y verificables
contra el catálogo (BioGaia, Aero-OM, Sebamed · Meropenem 1 g + SSN ·
Betnovate 0.1 %, clorfenamina maleato 4 mg, prednisolona susp. oral).

### 3.2 · Tres hallazgos que cambian el diseño

**1 · No toda receta trae J.V.P.M., y el formulario hoy lo exige.**
De las cinco: tres con J.V.P.M. impreso (6103, 11219, 14 499), una con **otro
registro** (`NUE MEDCRI-041-1`, un médico de medicina crítica) y una **sin médico
identificado** — sólo la clínica y su inscripción C.S.S.P. 103. Hay que decidir
qué hace el portal con esas dos antes de automatizar nada.

**2 · El SELLO es mejor fuente que el membrete.**
En una de las recetas el membrete dice «Dr. Valdemar Fuentes Palencia» y el sello
«Dr. **José** Valdemar Fuentes Palencia». Buscar en el CSSP por el nombre del
membrete puede no encontrarlo — y el CSSP ya demostró que sus campos de nombre y
apellido no son intercambiables (ver la cabecera de
`consultar-profesional-cssp`).

**3 · Las dos que fallaron son las dos mal fotografiadas.**
Una doblada, chica y de baja resolución; la otra de costado. O sea que el editor
de §1.1 **no es sólo para archivar: mejora la lectura**. Falta reprobar esas dos
ya recortadas y enderezadas, y ese número es el que decide.

### 3.3 · Qué construir, si se construye

- **Sí:** leer el sello y **disparar la consulta al CSSP** con el J.V.P.M.
  Ese es el mismo bucle que hace fuerte a la boleta —un dato leído, verificado
  contra una fuente externa— y es además lo más tedioso de teclear.
- **Sí, como sugerencia visible:** lo manuscrito (medicamento, cantidad, fecha),
  marcado como leído de la foto y confirmado por la persona.
- **No:** rellenar solo el nombre del paciente. Se acertó el nombre de pila
  siempre y se falló el apellido en tres de cinco — y un apellido cambiado en un
  libro que lee un inspector no se nota hasta que es tarde.
- **No:** bloquear. A diferencia de la boleta, acá **no hay contra qué cuadrar**:
  la receta ES la fuente de verdad.

### 3.4 · Lo que hay que decidir antes, y no es técnico

Una receta trae **nombre, edad y documento de un paciente, más el medicamento** —
datos de salud de una persona identificada, bastante más sensibles que una boleta
de remesa. Leerla significa que la foto sale del portal hacia un tercero (Google o
Anthropic, según el `LECTOR`).

Se puede acotar **qué se extrae y se guarda** —por ejemplo, sólo los campos del
prescriptor—, pero **la foto viaja entera igual**; para que no salga habría que
recortarla antes, y eso no es confiable. Si esa foto no puede salir del portal,
la respuesta honesta es que esto no va.

---

## 4 · Qué queda abierto

- [ ] Correr la lectura de boletas **una o dos semanas contra boletas reales**
      antes de decidir nada de recetas. Si falla sobre papel impreso, sobre letra
      manuscrita va a fallar más.
- [ ] Probar en sala que una foto que **no** sea la boleta efectivamente no deja
      guardar (es lo único que prueba que el bloqueo existe).
- [ ] Reprobar las dos recetas ilegibles **ya recortadas y enderezadas** con el
      editor, y anotar cuánto sube.
- [ ] Decidir qué hace el formulario con una receta **sin J.V.P.M.** (el registro
      alterno tipo `NUE`, y la receta sin médico identificado).
- [ ] Decidir si la foto de una receta puede salir del portal (§3.4).
- [ ] Si se pasa a Claude: crear la key en `console.anthropic.com`, cargarla como
      `ANTHROPIC_API_KEY` en Supabase y cambiar `LECTOR` a `'claude'`.

## Archivos

| Qué | Dónde |
|---|---|
| Editor de documentos de papel | `src/components/common/EditorDeDocumento.jsx` |
| Perfiles y umbrales por documento | `src/utils/fotoDocumento.js` (`DOCS`) |
| Formulario de la salida de dinero | `src/components/bolsas/SalidaDeBolsa.jsx` |
| Lectura y rastro (cliente) | `src/data/bolsas.js` (`leerBoleta`, `guardarLecturaDeBoleta`) |
| Lector | `supabase/functions/leer-boleta/index.ts` |
| Cliente de Claude, sin usar todavía | `supabase/functions/_shared/claude.ts` |
| Migraciones | `20260820221830` (columna), `20260820221939` (función del rastro) |
