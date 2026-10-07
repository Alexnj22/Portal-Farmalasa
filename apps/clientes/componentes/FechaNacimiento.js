// Fuera de iPhone, el campo de texto DD/MM/AAAA de siempre.
import { FilaCampo } from './sistema';

export default function FechaNacimiento({ valor, alCambiar }) {
  return <FilaCampo placeholder="Nacimiento (DD/MM/AAAA)" value={valor} onChangeText={alCambiar} keyboardType="numbers-and-punctuation" />;
}
