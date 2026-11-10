# Política interna — Puntos Salud del personal

Documento interno. **No forma parte del reglamento público** del programa
(`reglamento-programa-de-puntos-v2.html`): decisión del usuario, 2026-11-10.

## Quién

Toda persona del personal **activo** de la Empresa cuya ficha de cliente tenga el
mismo DUI que su ficha de empleado. Al dejar de ser personal activo, vuelve a
acumular como cualquier Cliente, con el reglamento.

## Cómo acumula

- **1 punto por cada US$1.00 en todas sus compras, a cualquier precio**:
  incluido el precio de personal, de mayoreo, de promoción o especial. Es la
  excepción a la cláusula 3.3 del reglamento.
- **El factor del nivel NO aplica**: gana siempre ×1, sea Bronce, Plata, Oro o
  Platino.
- Igual que todos: los productos que no acumulan (telefonía, bebidas, helados,
  paletas y los marcados en el portal) no suman, lo pagado con puntos no suma y
  las fracciones no acumulan.

## Su nivel

- **Sube y baja con sus compras de los últimos 12 meses**, como cualquier
  Cliente (cláusula 4).
- El nivel le da **los demás beneficios**: puntos de cumpleaños del nivel,
  raspable mensual en Oro y Platino (si compró el mes anterior) y ofertas.
- La app le muestra su nivel con **×1** y la marca «Equipo». Al subir de nivel
  el aviso no promete más puntos por compra.

## Dónde vive en el sistema

- Acumulación: `ventas_elegibles_puntos` (regla `personal`) y `puntos_acumular`
  (factor fijo 1), desde el 2026-11-15 (`reglas_v2_desde()`).
- La app: `nivelDelEquipo` en `supabase/functions/_shared/nivel.ts`.
- El aviso de subida: `avisos-clientes`.

## Historia

- 2026-11-03: 1 punto por $1 en cualquier compra, siempre ×1.
- 2026-11-10: confirmado; el nivel sube con las compras y da sólo los demás
  beneficios. Se corrige la app (mostraba el factor del nivel) y el aviso de
  subida («ganas más puntos»).
