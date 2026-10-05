// El detalle de una oferta. Llega con el zoom desde su tarjeta
// (`Link.AppleZoomTarget`) y se cierra deslizando hacia abajo, como en
// App Store o Fotos. Lee la oferta de lo que la lista ya trajo.
import { ScrollView, View } from 'react-native';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Vidrio from '../../componentes/Vidrio';
import { CuerpoOferta, ImagenOferta } from '../../componentes/TarjetaOferta';
import { Entrada } from '../../componentes/animacion';
import { Vacio } from '../../componentes/ui';
import { useOfertas } from '../../lib/ofertas';

export default function Oferta() {
  const { id } = useLocalSearchParams();
  const ins = useSafeAreaInsets();
  const oferta = useOfertas((s) => s.datos?.ofertas?.find((o) => String(o.id) === String(id)));

  return (
    <>
      <Stack.Screen options={{ title: '', headerTransparent: true }} />
      {!oferta ? (
        <Vacio titulo="Esta oferta ya no está">Puede que haya terminado. Vuelve a la lista de ofertas.</Vacio>
      ) : (
        <ScrollView contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{ paddingBottom: ins.bottom + 32, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          <Link.AppleZoomTarget>
            <View>
              {oferta.imagen ? <ImagenOferta oferta={oferta} alto={320} /> : <View style={{ height: ins.top + 56 }} />}
            </View>
          </Link.AppleZoomTarget>
          <Entrada indice={0} estilo={{ margin: 16 }}>
            <Vidrio radio={26}>
              <CuerpoOferta oferta={oferta} completa />
            </Vidrio>
          </Entrada>
        </ScrollView>
      )}
    </>
  );
}
