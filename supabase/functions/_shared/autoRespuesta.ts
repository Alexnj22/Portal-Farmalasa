// Respuestas automáticas del chat de Puntos Salud (2026-10-20, «que conteste
// solo si preguntan precio de un producto, horario, número de teléfono»).
//
// Reconoce la PREGUNTA con reglas sobre el texto (sin modelo de lenguaje) y
// sólo dice qué tipo de respuesta corresponde; los DATOS los arma quien llama
// (app-clientes), siempre del portal: horario y teléfonos de las sucursales,
// precio y existencias del catálogo. Nunca inventa.
//
// Lo clínico NO se contesta solo, aunque la pregunta nombre un producto: dosis,
// síntomas, embarazo, lactancia, niños, interacciones, efectos, alergias,
// contraindicaciones o «¿qué me recomiendan?». Eso queda para el equipo.

export type Intencion =
  | { tipo: "horario" }
  | { tipo: "telefono" }
  | { tipo: "direccion" }
  | { tipo: "producto"; consulta: string };

export const sinTildes = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const CLINICO = /\b(dosis|cuant[oa]s? (debo|puedo|le doy|tomo)|cada cuant|sintoma|me duele|dolor de|embaraz|lactan|amamant|bebe|bebito|nino|nina|ninos|hijo|interacc|efecto|reaccion|alergi|contraindic|puedo tomar|se puede tomar|me receta|recomiend|sirve para|es bueno para|que tomo|que me das|diagnost|fiebre de|presion alta|diabet)/;
const HORARIO = /\b(horario|a que hora|que hora (abren|cierran)|abren|cierran|abierto|abierta|atienden|hasta que hora|domingo|feriado|hoy abren)/;
const TELEFONO = /\b(telefono|numero|whats|wasap|llamar|contacto|celular|cel\b)/;
const DIRECCION = /\b(direccion|ubicacion|ubicados|donde (estan|queda|quedan|se encuentran)|como llego|mapa|sucursales)/;
const PRODUCTO = /\b(precio|cuanto (cuesta|vale|sale|esta)|a como|tienen|tendran|hay |venden|disponib|existencia|les queda)/;

// Las palabras de la pregunta que no son el producto.
const RELLENO = new Set(("hola buenas buenos dias tardes noches por favor favor gracias quisiera queria quiero saber si me podrian decir " +
  "precio precios cuanto cuesta vale sale esta a como tienen tendran hay venden disponible disponibles existencia les queda queda " +
  "de del el la los las un una unos unas en y o para que con por su sus mi me te le lo se es son al tambien todavia aun ahi aqui " +
  "farmacia salud sucursal ustedes usted medicamento medicina producto pastilla pastillas favorcito porfa pls ok").split(" "));

/** La intención de un mensaje del cliente, o `null` si no se contesta solo. */
export function reconocer(texto: string): Intencion | null {
  const t = sinTildes(texto).replace(/[¿?¡!.,;:()"]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 300 || CLINICO.test(t)) return null;
  // Primero lo de las sucursales: «¿tienen WhatsApp?» es un teléfono, no un producto.
  if (HORARIO.test(t)) return { tipo: "horario" };
  if (TELEFONO.test(t)) return { tipo: "telefono" };
  if (DIRECCION.test(t)) return { tipo: "direccion" };
  if (PRODUCTO.test(`${t} `)) {
    const consulta = t.split(" ").filter((w) => w.length > 1 && !RELLENO.has(w)).join(" ").trim();
    if (consulta.length >= 3) return { tipo: "producto", consulta: consulta.slice(0, 60) };
  }
  return null;
}
