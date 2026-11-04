// Fuera de iPhone y de Android (el navegador), el campo de texto DD/MM/AAAA.
// Los teléfonos tienen su selector del sistema: FechaNacimiento.ios.js y
// FechaNacimiento.android.js.
//
// 2026-11-04: teclado numérico y las barras se ponen solas («01011990» →
// «01/01/1990»). `numbers-and-punctuation` sólo existe en iPhone; en el resto
// salía el teclado de letras. Al borrar, una barra que quedó sola al final se
// quita con su número, para que la tecla de borrar no parezca trabada.
import { FilaCampo } from './sistema';

function conBarras(texto, anterior) {
  const digitos = String(texto ?? '').replace(/\D/g, '').slice(0, 8);
  const borrando = String(texto ?? '').length < String(anterior ?? '').length;
  let s = digitos.slice(0, 2);
  if (digitos.length > 2 || (!borrando && digitos.length === 2)) s += '/';
  s += digitos.slice(2, 4);
  if (digitos.length > 4 || (!borrando && digitos.length === 4)) s += '/';
  s += digitos.slice(4, 8);
  return s;
}

export default function FechaNacimiento({ valor, alCambiar }) {
  return (
    <FilaCampo placeholder="Nacimiento (DD/MM/AAAA)" accessibilityLabel="Fecha de nacimiento, día, mes y año"
      value={valor} onChangeText={(x) => alCambiar(conBarras(x, valor))} keyboardType="number-pad" maxLength={10} />
  );
}
