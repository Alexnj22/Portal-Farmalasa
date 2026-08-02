# Prompt para la próxima sesión

Copiá esto tal cual:

---

Retomá la migración de fichas de clientes ERP ↔ portal.

**Leé primero `scripts/migracion-clientes/README.md`** — tiene el estado, las
reglas, lo que hay que saber del ERP y las decisiones abiertas. Está escrito
para retomar sin contexto previo.

**El estado exacto está en el README §1**, en el bloque generado entre los
marcadores `ESTADO:INICIO/FIN`, o corriendo `python3 estado.py`. No lo repito
acá a propósito: un número escrito a mano en dos lugares se desincroniza, y este
mismo archivo llegó a decir "585 fichas procesadas" estando cuatro bloques
atrás.

Lo que no cambia bloque a bloque: **cero campos perdidos y cero alterados** en
todo lo procesado, y la verificación relee cada ficha después de escribirla.

Antes de tocar nada: `python3 probar_offline.py` tiene que pasar en verde (162
comprobaciones, no toca el ERP ni la base) y `python3 refrescar_catalogo.py`
para actualizar el índice. **El estado exacto lo da `python3 estado.py`** — no
te fíes de los números escritos en prosa, fíjate en el bloque generado del
README §1.

## Correr un bloque

```bash
python3 bloque.py --desde-erp 500 --escribir --una-pasada   # ~45 min
python3 aplicar_espejo.py --aplicar                          # espeja al portal
python3 revisar_ambiguos.py --corregir                       # los desempates
python3 estado.py --escribir                                 # actualiza el README
```

**El paso de los ambiguos tampoco es opcional.** Un desempate no acierta la
mitad: se equivoca la mitad **justo donde la dirección sí decía cuál era**.
Medido en dos bloques seguidos: 2 de 5 mal en el bloque 4, **4 de 6 mal en el
5**. `revisar_ambiguos.py --corregir` relee esas fichas, las pasa por las reglas de
hoy y **escribe** la corrección en el ERP.

**No sirve reencolarlas** (borrar su entrada del checkpoint para que el próximo
bloque las rehaga). Se probó y no corrigió nada: la regla del distrito solo
actúa si el campo está VACÍO, y estas ya tienen uno — el equivocado. Salen "sin
cambios" y, peor, pierden la marca de `ambiguo`, así que la detección
automática ya no las ve. Si te pasa, `--fichas 2112,2304` las nombra a mano.

**La lista de candidatas ya no crece sola.** Hasta el 2026-08-02 la detección
buscaba la subcadena pelada `ambiguo` en la anotación del checkpoint, y el texto
que escribe la propia corrección dice `(corregido por revisar_ambigu**os**)`: se
detectaba a sí misma, así que cada ficha corregida volvía a la lista para
siempre y se releía del ERP en cada pasada. Eran 9 candidatas de las cuales 6
ya estaban resueltas. Ahora se busca `\(ambiguo\b` y quedan las 3 reales.

**El tercer comando no es opcional.** El estado del README se generaba a mano y
por eso envejecía: llegó a decir 1,085 cuando iban 2,073, y este mismo prompt
decía 585 estando cuatro bloques atrás. Un número viejo se lee igual que uno
correcto, así que nadie lo nota. Ahora se regenera de los datos vivos —
checkpoint, catálogo y portal— entre los marcadores `ESTADO:INICIO/FIN`. Los
NÚMEROS se generan, las DECISIONES se escriben.

**No hace falta simular antes** — decidido el 2026-08-01 y explicado en el
README §3. Sí conviene simular si cambiaste una regla de `planificar`.

Si `revisar_ambiguos.py` dice **"sigue ambigua"** en alguna, es que ninguna
regla la resuelve y ganó el sorteo: leerla a mano. **Desde el 2026-08-02 esas
NO se escriben** aunque uses `--corregir` — salen marcadas `SORTEO`. Antes sí se
escribían, y era un sorteo distinto, no una corrección: la herramienta sembraba
con el `erp_id` pelado (`'4420'`) y el bloque con el `portal_id` (`'erp:4420'`),
así que la ficha oscilaba entre dos valores a cada pasada. Ver README §1.

**La regla pendiente ya tiene su caso.** Patrón: los DOS candidatos nombrados
enteros — `B LAS FLORES SAN JOSE CANCASQUE` (erp 2423, quedó bien) y
`BA LAS FLORES SAN LUIS DEL CARMEN` (**erp 4420, el sorteo lo puso mal**). La
dirección salvadoreña va de lo específico a lo general (barrio → cantón →
distrito → departamento), así que preferir el candidato nombrado MÁS TARDE los
resuelve — pero solo después del filtro del departamento, porque
`NUEVA TRINIDAD, CHALATENANGO` tiene el departamento al final. Sigue sin
implementarse; lo que cambió es que ahora hay un dato malo que lo justifica.

## Lo primero que va a pasar

**Una ficha va a salir rechazada, y está bien.** La `erp 3883` (FLOR DE MARIA
GUARDADO GUARDADO) es una de las dos duplicadas sin resolver: el ERP contesta
`Ya se registro un cliente con estos datos!` porque choca con la 8598. El script
no reintenta —ese rechazo es un hallazgo, no un glitch—, verifica que la ficha
quedó intacta y **no la anota en el checkpoint**, así que se reintenta en cada
bloque y falla igual. Va a aparecer como `a revisar: 1` hasta que alguien purgue
el duplicado en el ERP (decisión abierta #3). No es deuda nueva: es la misma
decisión, ahora con un costo visible por bloque.

Las 5 fichas reencoladas del handoff anterior (161, 176, 380, 1641, 1791) ya
están: **176 quedó NUEVA TRINIDAD y 380 SAN ANTONIO DEL MONTE**, verificadas
releyéndolas del ERP. Reencolarlas no había alcanzado —tal como avisaba este
mismo archivo— y se arreglaron con `revisar_ambiguos.py --fichas 176,380
--corregir`.

La `erp 1791` (JOSE MARIO ABARCA) es un caso aparte que **no hay que "arreglar"**:
alguien le cambió el municipio a mano en el ERP después de procesarla, y como los
ids de distrito van por (departamento, municipio), el distrito que le habíamos
escrito **se reetiquetó solo** — el portal decía POTONICO y el ERP EL PARAÍSO,
sin que nada fallara. Por decisión del usuario se dejó el ERP como está y se
espejó al portal. Si volvés a verla, ya coincide.

## Lo que ya NO hay que hacer

- **No correr `empujar_al_erp.py` a mano.** Editar en el portal manda el cambio
  al ERP solo, y un cron cada 10 minutos drena lo que haya quedado pendiente.
  El script sigue existiendo para depurar.
- **No tocar los contribuyentes.** Decisión del usuario: quedan pendientes. El
  bloque ya los saltea por regla — se leen, se espejan, no se escriben.

## Decisiones abiertas, del usuario

1. **Avisarle a soporte del ERP** antes de seguir de corrido: los 51 bloques
   son ~38 horas de tráfico contra el servidor del proveedor, y el riesgo real
   es que alguien vea el cambio masivo y "restaure de backup". Es lo único que
   falta para poder encadenar bloques sin parar.
2. **Las 99 fichas de `faltantes_dte.json`** — no se pueden facturar bajo DTE
   2.0. 87 necesitan un solo campo (el distrito); 50 de ellas lo tienen escrito
   en su propia dirección y 49 las tiene que decidir una persona. 83 son
   fiscales y quedan congeladas por decisión del usuario.
3. **Dos nombres duplicados sin resolver**: FLOR DE MARIA GUARDADO GUARDADO
   (3883/8598) y WILLIAM ENRIQUE ALEMAN ALFARO (7280/7284). Tienen DUI distintos
   en cada ficha, así que pueden ser dos personas — no lo resuelve un script.
   **La 3883 ya empezó a costar**: el ERP rechaza su escritura por duplicado en
   cada bloque, y como no se checkpointea, se reintenta para siempre. La 7280 va
   a hacer lo mismo cuando el frente llegue ahí.
4. **El reproceso completo**, si se quiere prolijidad del mecanismo de `REGLAS`:
   el matcher se arregló sin subirla, reencolando las 5 afectadas a mano. Está
   justificado en el README, pero si se prefiere, subir REGLAS a 7 relee las
   2,073 (≈1 h) y deja el checkpoint coherente por construcción.

## Contexto adicional si hace falta

- Los 35 DUI borrados, con su número original, están en `revision_manual.json`.
  **Ese archivo acumula entre bloques** — si alguna vez vuelve a tener menos
  entradas que antes, algo se rompió.
- `docs/RETOMAR-CLIENTES-2026-08-01.md` es el estado del MÓDULO de clientes que
  dejó otra sesión (vista, filtros, permisos), que es trabajo distinto de esta
  migración.
- Hay varias sesiones de Claude sobre este mismo árbol. `git status --short`
  antes de editar un archivo que no tocaste, y `git add` con rutas explícitas
  siempre — hoy una sesión ajena se llevó 4 archivos míos dentro de su commit.
