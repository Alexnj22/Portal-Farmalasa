// «El precio no está bajando en caja» — la promoción sigue viva pero su
// descuento en la caja ya venció. Lo decide la base (`descuento_por_mover` en
// `get_promociones`). La acción lleva a `promocion-reactivar` en modo «sólo
// descuento»: no reactiva nada, mueve el descuento hasta el fin de la
// promoción. Es lo que el portal hace en Activas (`TabActivas` +
// `ReactivarPromocionModal modo="descuento"`). Lo usan la lista y el detalle.
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Aviso } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { guardarPromocion } from './elegida';

export default function AvisoDescuentoPorMover({ p, puedeEditar }) {
  if (!p?.descuento_por_mover) return null;
  return (
    <View style={{ gap: 6 }}>
      <Aviso tono="cuidado" texto="El precio no está bajando en caja: el descuento de esta promoción ya venció." />
      {puedeEditar ? (
        <Pressable accessibilityRole="button" hitSlop={8}
          onPress={() => { guardarPromocion(p); router.push({ pathname: '/promocion-reactivar/[id]', params: { id: String(p.id), modo: 'descuento' } }); }}
          style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginHorizontal: 4, opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Mover el descuento ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
