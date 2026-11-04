// La fecha de nacimiento en Android con el selector de Material 3
// (`DatePickerDialog` de @expo/ui/jetpack-compose, 2026-11-04). Antes era el
// campo de texto DD/MM/AAAA con `keyboardType="numbers-and-punctuation"`, que
// sólo existe en iPhone: en Android salía el teclado de letras y había que
// buscar la barra. Es la contraparte de FechaNacimiento.ios.js (el DatePicker
// de SwiftUI): una fila que dice la fecha, y al tocarla el calendario del
// sistema. El valor sigue siendo el texto DD/MM/AAAA que espera el registro
// (`fechaDeNacimiento` de lib/formato.js), así que el formulario no cambia.
//
// Las fechas del selector de Material son medianoche en UTC: se leen y se
// arman con los métodos UTC. Con la hora local (El Salvador, UTC−6) la
// medianoche UTC cae en el día ANTERIOR y la fecha guardada saldría corrida.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { DatePickerDialog, Host } from '@expo/ui/jetpack-compose';
import * as Haptics from 'expo-haptics';
import Presionable from './Presionable';
import { colorSistema } from './sistema';
import { useTema } from '../tema/tema';

const dos = (n) => String(n).padStart(2, '0');
const aTexto = (d) => `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
// 'DD/MM/AAAA' → 'AAAA-MM-DD' (lo que pide `initialDate`), o null.
const aIso = (t) => {
  const m = String(t ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${dos(m[2])}-${dos(m[1])}` : null;
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dicha = (iso) => { const [a, m, d] = iso.split('-').map(Number); return `${d} de ${MESES[m - 1]} de ${a}`; };

export default function FechaNacimiento({ valor, alCambiar }) {
  const t = useTema();
  const [abierto, setAbierto] = useState(false);
  const iso = aIso(valor);
  return (
    <>
      <Presionable accessibilityRole="button" accessibilityLabel={`Fecha de nacimiento, ${iso ? dicha(iso) : 'sin agregar'}`}
        accessibilityHint="Abre el calendario" onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(true); }}
        style={{ minHeight: 56, paddingHorizontal: 16, paddingVertical: 8, gap: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ flexShrink: 1, fontSize: 16, color: iso ? colorSistema.texto : colorSistema.placeholder }}>Fecha de nacimiento</Text>
        <Text style={{ flexShrink: 1, textAlign: 'right', fontSize: 16, fontWeight: '500', color: iso ? colorSistema.texto : t.color.magentaTexto }}>
          {valor && iso ? valor : 'Agregar'}
        </Text>
      </Presionable>
      {abierto ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', width: 1, height: 1 }}>
          <Host style={{ width: 1, height: 1 }}>
            <DatePickerDialog initialDate={iso ?? '1990-01-01'} color={t.color.magenta}
              confirmButtonLabel="Listo" dismissButtonLabel="Cancelar"
              selectableDates={{ start: new Date(Date.UTC(1900, 0, 1)), end: new Date() }}
              onDateSelected={(d) => { setAbierto(false); Haptics.selectionAsync().catch(() => {}); alCambiar(aTexto(d)); }}
              onDismissRequest={() => setAbierto(false)} />
          </Host>
        </View>
      ) : null}
    </>
  );
}
