# Migradores de botones al canónico

Herramientas usadas en la migración D3.3 (2026-07-27). Se guardan acá porque
**la parte cara no fue escribirlas, fue descubrir sus filtros**: cada uno salió
de un caso real que rompió.

| archivo | qué hace |
|---|---|
| `btnlib.py` | parser: recorre `<button>` respetando llaves, comillas y template literals |
| `migicon.py` | familia D — botones de solo ícono → `Button iconOnly` |
| `migA.py` | familia A — botones de acción → `Button` |
| `seg.py` | familia C — colapsa un `.map()` entero en un `SegmentedControl` |
| `correr-iconos.sh` · `correr-accion.sh` | corredores **con red de seguridad** |

## Las reglas que costaron caro

1. **Recolectar todos los rangos de una pasada y aplicar de atrás hacia
   adelante.** La primera versión re-escaneaba desde disco en cada vuelta del
   `while` y entró en bucle infinito.
2. **Todo atributo que no sea `className` se COPIA tal cual.** Nunca deducirlo:
   inventé nombres de handler a mano una vez y eslint lo atrapó con `no-undef`.
3. **Saltear si el ternario del `className` trae layout**, no solo colores. Si
   trae layout, está haciendo algo que el canónico no sabe.
4. **Saltear si el contenido tiene un ternario que devuelve JSX.**
   `{editando ? <><Save/> Guardar</> : <><Plus/> Crear</>}` no se desarma
   sacando los íconos.
5. **Si tras migrar queda un `isActive`/`isSel` huérfano, REVERTIR.** No es
   basura: es que ese botón perdió su distinción de estado activo, o sea que
   era un segmentado disfrazado. Sin eslint esto pasa el build en silencio y se
   ven pestañas que ya no marcan cuál está abierta.

## La red de seguridad, obligatoria

Los corredores migran **archivo por archivo**, corren `eslint` tras cada uno y
**revierten** el que tenga parse error, `no-undef`, o quede a menos de la mitad
de su tamaño. Sin eso, un solo archivo mal parseado se lleva puesta la sesión.

**No usar `git stash push`/`pop` para inspeccionar** trabajo sin commitear
mientras se migra: un round-trip de stash corrompió 5 archivos y me hizo creer
durante media hora que el migrador tenía un bug que no tenía. `git checkout` de
un archivo puntual alcanza.
