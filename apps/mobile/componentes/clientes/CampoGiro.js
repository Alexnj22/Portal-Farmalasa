// El renglón del giro en un formulario de cliente: muestra la actividad elegida
// y abre `ElegirGiro` (catálogo del MH). Nunca se escribe a mano, como en
// `FormClienteDetail.jsx` del portal. Un giro guardado que no está en el
// catálogo se ve tal cual, marcado «No está en el listado del MH».
import { useState } from 'react';
import { Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { giroDelCatalogo } from '@nucleo/utils/clienteValidacion';
import { Presionable as Pressable } from '../Tocable';
import { colorSistema } from '../Formulario';
import { Rotulo } from '../personas/Formulario';
import { MARCA, FONDO_CONTROL } from '../inicio/marca';
import ElegirGiro from './ElegirGiro';

/**
 * @param {{ valor: string, giros: {value: string, label: string, sublabel?: string}[],
 *           requerido?: boolean, error?: string, onCambiar: (texto: string) => void }} props
 */
export default function CampoGiro({ valor, giros, requerido, error, onCambiar }) {
  const [abierta, setAbierta] = useState(false);
  const delCatalogo = giroDelCatalogo(valor, giros);
  const texto = delCatalogo ?? (valor || '');
  const fuera = !!String(valor ?? '').trim() && giros.length > 0 && !delCatalogo;
  return (
    <View style={{ gap: 8 }}>
      <Rotulo texto="Giro" requerido={requerido} />
      <Pressable disabled={!giros.length} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(true); }}
        style={({ pressed }) => ({ minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: FONDO_CONTROL, borderWidth: error ? 1 : 0, borderColor: MARCA.rojo, opacity: !giros.length ? 0.5 : pressed ? 0.7 : 1 })}>
        <Text style={{ flex: 1, color: texto ? colorSistema.texto : colorSistema.texto2, fontSize: 16 }}>
          {texto || (giros.length ? 'Busca la actividad económica' : 'Cargando actividades…')}
        </Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 16 }}>›</Text>
      </Pressable>
      {fuera ? <Text style={{ color: MARCA.ambar, fontSize: 12, marginLeft: 2 }}>No está en el listado del MH</Text> : null}
      {error ? <Text style={{ color: MARCA.rojo, fontSize: 12, marginLeft: 2 }}>{error}</Text> : null}
      <ElegirGiro visible={abierta} giros={giros} valor={texto} quitable={!requerido}
        onElegir={onCambiar} onCerrar={() => setAbierta(false)} />
    </View>
  );
}
