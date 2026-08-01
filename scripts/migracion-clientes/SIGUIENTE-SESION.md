# Prompt para la próxima sesión

Copiá esto tal cual:

---

Retomá la migración de fichas de clientes ERP ↔ portal.

**Leé primero `scripts/migracion-clientes/README.md`** — tiene el estado, las
reglas, lo que hay que saber del ERP y las decisiones abiertas. Está escrito
para retomar sin contexto previo.

Dónde quedó (2026-08-01, 21:00 UTC): **2,073 fichas procesadas de 27,591**,
1,837 clientes en el portal con datos del ERP, **cero campos perdidos y cero
alterados** en cuatro bloques. Quedan 25,518 fichas = 51 bloques.

Antes de tocar nada: `python3 probar_offline.py` tiene que pasar en verde (162
comprobaciones, no toca el ERP ni la base) y `python3 refrescar_catalogo.py`
para actualizar el índice.

## Correr un bloque

```bash
python3 bloque.py --desde-erp 500 --escribir --una-pasada   # ~45 min
python3 aplicar_espejo.py --aplicar                          # espeja al portal
```

**No hace falta simular antes** — decidido el 2026-08-01 y explicado en el
README §3. Sí conviene simular si cambiaste una regla de `planificar`.

Al terminar, mirar `ambiguos.json`: si aparece algo de tipo `distrito`, leer
esas fichas del ERP antes de darlas por buenas. Así se encontró el bug del
matcher en el bloque 4.

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
