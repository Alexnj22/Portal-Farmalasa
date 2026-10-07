// «Armar rutas» (quien administra): la lista de rutas con su vendedor y sus
// días. Tocar una la abre para editar nombre, vendedor, días y el orden de
// visita; «Nueva ruta» abre la misma pantalla vacía.
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { fetchRutas, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { diasDeRuta } from '@nucleo/utils/distribucionRutas';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Widget, { Esqueleto, Renglon, Vacio } from '../../inicio/Widget';
import { Aviso, BotonGrande } from '../../formulario/Piezas';
import Etiqueta from './Etiqueta';

const PETROLEO = '#0f6e7d';

export default function Armar() {
  const [rutas, setRutas] = useState(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setError('');
    try { setRutas(await fetchRutas()); } catch (e) { setError(mensajeDeDistribucion(e)); }
  }, []);
  // Se relee al volver de editar una.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  return (
    <View style={{ gap: 14 }}>
      <View style={{ marginHorizontal: 16 }}>
        <BotonGrande texto="Nueva ruta" color={PETROLEO} onPress={() => router.push('/torogoz/ruta/nueva')} />
      </View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <Widget titulo="Rutas" icono="Truck" color={PETROLEO} cuenta={rutas?.length ?? 0}>
        {rutas === null ? <Esqueleto /> : rutas.length ? rutas.map((r, i) => (
          <Renglon key={r.id} primero={i === 0} titulo={r.nombre}
            detalle={`${r.vendedor?.name ? shortEmployeeName(r.vendedor.name) : 'Sin vendedor'} · ${diasDeRuta(r.dias)}`}
            derecha={r.activo ? null : <Etiqueta variante="neutral" texto="Inactiva" />}
            onPress={() => router.push(`/torogoz/ruta/${r.id}`)} />
        )) : <Vacio texto="Todavía no hay rutas." />}
      </Widget>
    </View>
  );
}
