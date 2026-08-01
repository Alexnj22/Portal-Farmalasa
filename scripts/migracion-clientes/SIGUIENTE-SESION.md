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
python3 revisar_ambiguos.py --reencolar                      # los desempates
python3 estado.py --escribir                                 # actualiza el README
```

**El paso de los ambiguos tampoco es opcional.** Un desempate no acierta la
mitad: se equivoca la mitad **justo donde la dirección sí decía cuál era**.
Medido en dos bloques seguidos: 2 de 5 mal en el bloque 4, **4 de 6 mal en el
5**. `revisar_ambiguos.py` relee esas fichas, las pasa por las reglas de hoy y
reencola solo las que cambian — mucho más barato que subir `REGLAS`, que relee
todo el catálogo procesado para corregir un puñado.

**El tercer comando no es opcional.** El estado del README se generaba a mano y
por eso envejecía: llegó a decir 1,085 cuando iban 2,073, y este mismo prompt
decía 585 estando cuatro bloques atrás. Un número viejo se lee igual que uno
correcto, así que nadie lo nota. Ahora se regenera de los datos vivos —
checkpoint, catálogo y portal— entre los marcadores `ESTADO:INICIO/FIN`. Los
NÚMEROS se generan, las DECISIONES se escriben.

**No hace falta simular antes** — decidido el 2026-08-01 y explicado en el
README §3. Sí conviene simular si cambiaste una regla de `planificar`.

Si `revisar_ambiguos.py` dice **"sigue ambigua"** en alguna, es que ninguna
regla la resuelve y ganó el sorteo: leerla a mano. Patrón conocido sin resolver:
`B LAS FLORES SAN JOSE CANCASQUE` (erp 2423), donde los DOS candidatos están
nombrados enteros. La dirección salvadoreña va de lo específico a lo general
(barrio → cantón → distrito → departamento), así que preferir el candidato
nombrado MÁS TARDE lo resolvería — pero solo después del filtro del
departamento, porque `NUEVA TRINIDAD, CHALATENANGO` tiene el departamento al
final. No se implementó: hoy ese caso quedó bien y no hay dato malo que lo
justifique.

## Lo primero que va a pasar

Las **5 fichas reencoladas** (161, 176, 380, 1641, 1791) entran al arranque del
próximo bloque, antes que las nuevas, porque van ordenadas por id. Se les borró
la entrada del checkpoint a propósito para que se rehagan con el matcher
corregido: dos de ellas tenían el distrito MAL. Verificá que queden con
NUEVA TRINIDAD (176) y SAN ANTONIO DEL MONTE (380).

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
