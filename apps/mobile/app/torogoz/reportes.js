// Reportes de Torogoz, NATIVO — `TabReportes` del portal con sus cinco vistas:
// Utilidad (con la gráfica de venta y utilidad por día), Libros de ventas,
// Libro de compras, Retenciones y Relacionadas. Sólo quien administra la
// distribuidora: el costo es el margen de la empresa. La vista va en la
// dirección (`?reporte=`), como en el portal. Cada archivo sale por la hoja de
// compartir y queda anotado como salida de datos.
//
// El «Paquete del mes» (un ZIP con todo lo fiscal) sale de las vistas de libros
// y retenciones: el mismo paquete del portal (`paqueteDelMes`, núcleo),
// comprimido acá con `fflate`.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { VISTAS_REPORTES } from '@nucleo/utils/distribucionReportes';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import Segmentos from '../../componentes/Segmentos';
import { Aviso } from '../../componentes/formulario/Piezas';
import Utilidad from '../../componentes/torogoz/bodega/reportes/Utilidad';
import LibrosVentas from '../../componentes/torogoz/bodega/reportes/LibrosVentas';
import LibroCompras from '../../componentes/torogoz/bodega/reportes/LibroCompras';
import Retenciones from '../../componentes/torogoz/bodega/reportes/Retenciones';
import Relacionadas from '../../componentes/torogoz/bodega/reportes/Relacionadas';

const VISTAS = VISTAS_REPORTES.map((v) => ({ id: v.key, label: v.label }));
const CON_BUSCADOR = { utilidad: 'Producto, cliente, ruta…', ventas: 'Cliente o número de control', compras: 'Proveedor, número o NIT', relacionadas: 'Producto' };

export default function Reportes() {
  const { reporte } = useLocalSearchParams();
  const vista = VISTAS.some((v) => v.id === reporte) ? reporte : 'utilidad';
  const { hasPermission } = useAuth();
  const puede = !!hasPermission?.('distribucion_config', 'can_edit');
  const [buscar, setBuscar] = useState('');

  const cambiar = (v) => { setBuscar(''); router.setParams({ reporte: v }); };
  const buscador = CON_BUSCADOR[vista]
    ? { placeholder: CON_BUSCADOR[vista], hideWhenScrolling: true, onChangeText: (e) => setBuscar(e.nativeEvent.text), onCancelButtonPress: () => setBuscar('') }
    : undefined;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Reportes', headerLargeTitle: true, headerSearchBarOptions: buscador }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        {!puede ? (
          <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto="Los reportes de la distribuidora los ve quien la administra." /></View>
        ) : (
          <>
            <Segmentos opciones={VISTAS} activa={vista} onCambiar={cambiar} />
            {vista === 'ventas' ? <LibrosVentas buscar={buscar} />
              : vista === 'compras' ? <LibroCompras buscar={buscar} />
                : vista === 'retenciones' ? <Retenciones />
                  : vista === 'relacionadas' ? <Relacionadas buscar={buscar} />
                    : <Utilidad buscar={buscar} />}
          </>
        )}
      </ScrollView>
    </>
  );
}
