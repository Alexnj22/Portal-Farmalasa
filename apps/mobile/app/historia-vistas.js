// Quién vio una historia de la app de clientes, NATIVO — el `VistasModal` del
// portal: los clientes con cuenta, el más reciente primero, y si tocaron un
// botón. Los que la vieron sin cuenta se cuentan pero no tienen nombre.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { fetchQuienesVieron } from '@nucleo/data/ofertasClientes';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { leer } from '../componentes/comercial/elegido';

export default function HistoriaVistas() {
  const { historia, resumen } = useMemo(() => leer('historia-vistas') ?? {}, []);
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!historia) return;
    fetchQuienesVieron(historia.id).then(setLista).catch((e) => { setLista([]); setError(mensajeAmigable(e, 'No se pudo cargar quién la vio.')); });
  }, [historia]);
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Quién la vio' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        {!historia ? <Aviso tono="freno" texto="Vuelve a la lista y elige la historia otra vez." /> : (
          <>
            <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{historia.titulo}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
              {`${resumen?.vistas ?? 0} la vieron · ${resumen?.con_cuenta ?? 0} con cuenta · ${resumen?.visitantes ?? 0} sin cuenta · ${resumen?.tocaron ?? 0} tocaron un botón`}
            </Text>
            {error ? <Aviso tono="freno" texto={error} /> : null}
            {lista == null ? <ActivityIndicator style={{ marginTop: 16 }} /> : !lista.length ? (
              <Aviso texto="Todavía no la ha visto ningún cliente con cuenta." />
            ) : (
              <Vidrio radio={18}>
                <View style={{ padding: 12, gap: 10 }}>
                  {lista.map((p, i) => (
                    <View key={p.customer_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{p.cliente}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${fechaTexto(p.visto_at, { day: 'numeric', month: 'short' })} · ${hora12(p.visto_at)}`}</Text>
                      </View>
                      {p.toco_boton ? <Pildora texto="Tocó un botón" color={MARCA.verde} /> : null}
                    </View>
                  ))}
                </View>
              </Vidrio>
            )}
            {resumen?.visitantes > 0 ? <Aviso texto="Los que la vieron sin cuenta se cuentan, pero no tienen nombre." /> : null}
          </>
        )}
      </ScrollView>
    </>
  );
}
