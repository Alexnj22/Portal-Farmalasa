// Torogoz en la app es SÓLO CONSULTA para lo que mueve dinero o Hacienda
// (decisión del usuario, 2026-10-07): facturar, reenviar o invalidar ante
// Hacienda, contingencia, notas de crédito, cobros, la caja del vendedor, la
// liquidación, los depósitos y el cierre del día se siguen haciendo desde el
// portal. Las pantallas los OCULTAN —no los deshabilitan— y, donde el bloque
// queda vacío, dicen dónde se hace.
//
// Se enciende cuando esas acciones se prueben en sala: es la única línea que
// hay que cambiar.
import { Text, View } from 'react-native';
import { Host, Icon } from '@expo/ui';
import { colorSistema } from '../Formulario';
import { iconoDe } from '../../tema/iconos';

export const ACCIONES_DE_DINERO = false;

export function SeHaceEnElPortal({ texto = 'Esto se hace desde el portal.', style }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 4 }, style]}>
      <Host matchContents><Icon name={iconoDe('Monitor')} size={15} color={colorSistema.texto2} /></Host>
      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14 }}>{texto}</Text>
    </View>
  );
}
