// Un vencimiento que puede faltar. El selector del sistema siempre muestra
// alguna fecha —con el valor vacío pinta la de hoy—, así que un lote «sin
// fecha» se vería con fecha de hoy y se guardaría así sin que nadie la
// eligiera. Acá, sin fecha se dice «Sin fecha» con un botón para poner una;
// con fecha, el selector y «Quitar».
import { Pressable, Text, View } from 'react-native';
import { hoySV } from '@nucleo/utils/fecha';
import Fecha from '../../formulario/Fecha';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../../inicio/marca';

export default function FechaOpcional({ valor, onCambiar }) {
  if (!valor) {
    return (
      <Pressable onPress={() => onCambiar(hoySV())} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} accessibilityRole="button">
        <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Sin fecha · poner una</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Fecha valor={valor} onCambiar={onCambiar} />
      <Pressable onPress={() => onCambiar('')} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Quitar la fecha">
        <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Quitar</Text>
      </Pressable>
    </View>
  );
}
