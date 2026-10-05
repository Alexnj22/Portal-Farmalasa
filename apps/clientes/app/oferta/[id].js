// El detalle de una oferta. Llega con el zoom desde su tarjeta
// (`Link.AppleZoomTarget`) y se cierra deslizando hacia abajo, como en
// App Store o Fotos. Lee la oferta de lo que la lista ya trajo.
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Vidrio from '../../componentes/Vidrio';
import { CuerpoOferta, PortadaOferta } from '../../componentes/TarjetaOferta';
import { Entrada } from '../../componentes/animacion';
import { Cargando, Vacio } from '../../componentes/ui';
import { useOfertas } from '../../lib/ofertas';

export default function Oferta() {
  const { id } = useLocalSearchParams();
  const ins = useSafeAreaInsets();
  const datos = useOfertas((s) => s.datos);
  const cargar = useOfertas((s) => s.cargar);
  const oferta = datos?.ofertas?.find((o) => String(o.id) === String(id));
  // Abierta desde un enlace o un aviso, en frío, la lista todavía no está en
  // memoria: se pide en vez de decir «ya no está».
  useEffect(() => { if (!datos) cargar(); }, [datos, cargar]);
  if (!datos) return <Cargando />;

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
              <PortadaOferta oferta={oferta} alto={380 + ins.top / 2} conTitulo={false} />
            </View>
          </Link.AppleZoomTarget>
          <Entrada indice={0} estilo={{ marginHorizontal: 16, marginTop: -36 }}>
            <Vidrio radio={28}>
              <CuerpoOferta oferta={oferta} completa />
            </Vidrio>
          </Entrada>
        </ScrollView>
      )}
    </>
  );
}
