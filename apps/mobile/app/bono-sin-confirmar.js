// Un pago de bono que quedó «sin confirmar», NATIVO — `DialogoSinConfirmar`
// del portal (H20). La salida se mandó a la caja y la caja no contestó: pudo
// haberla anotado igual, así que repetirla a ciegas podía pagar dos veces. Se
// mira la caja y se contesta: «Sí salió» lo da por pagado; «No salió» anula el
// movimiento del portal y el bono vuelve a quedar por pagar. La nota es
// obligatoria (`resolver_pago_bono_sin_confirmar` la exige).
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { resolverPagoBonoSinConfirmar } from '@nucleo/data/bonosProducto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

export default function BonoSinConfirmar() {
  const { item: crudo } = useLocalSearchParams();
  const [item] = useState(() => { try { return JSON.parse(crudo); } catch { return null; } });
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  if (!item) return <Aviso tono="freno" texto="No se pudo leer el bono." />;

  const nombre = item.tipo === 'bodega' ? 'Bodega' : shortEmployeeName(item);
  const listoParaContestar = !guardando && nota.trim().length > 0;

  const resolver = async (salio) => {
    setGuardando(true);
    trabajando(salio ? 'Dando el bono por pagado…' : 'Anulando el pago…');
    try {
      await resolverPagoBonoSinConfirmar(item.item, salio, nota.trim());
      listo(salio ? 'Bono pagado' : 'Pago anulado',
        salio ? `${formatMoney(item.monto)} quedan como pagados.` : 'El bono vuelve a quedar por pagar.');
      router.back();
    } catch (e) {
      fallo('No se pudo resolver', mensajeAmigable(e, 'Vuelve a intentarlo.'));
    } finally { setGuardando(false); }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pago sin confirmar' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '700', marginHorizontal: 4 }}>{nombre}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 4 }}>
          {`Se mandó la salida de ${formatMoney(item.monto)}${item.promocion ? ` (${item.promocion})` : ''} y la caja no confirmó. Revisa en la caja si el movimiento salió antes de repetirlo.`}
        </Text>
        <Campo placeholder="Qué viste en la caja" value={nota} onChangeText={setNota} editable={!guardando} />
        <BotonGrande texto="Sí salió" color={MARCA.verde} deshabilitado={!listoParaContestar} onPress={() => resolver(true)} />
        <BotonGrande texto="No salió" color={MARCA.ambar} borde deshabilitado={!listoParaContestar} onPress={() => resolver(false)} />
      </ScrollView>
    </>
  );
}
