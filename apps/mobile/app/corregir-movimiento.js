// Pedir una corrección de un movimiento de caja, NATIVO — `DialogoCorregir` de
// «Mi caja»: anularlo o corregir su monto, con motivo. No corrige nada por sí
// mismo: queda PEDIDO y alguien tiene que aprobarlo (`operar-caja`, acción
// `corregir`), igual que en el portal.
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { pedirCorreccion } from '@nucleo/data/bolsas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

export default function CorregirMovimiento() {
  const { sala, id, concepto, monto } = useLocalSearchParams();
  const puedeOperar = useAuth().hasPermission('caja_vales', 'can_edit');
  const [que, setQue] = useState('ANULAR');
  const [motivo, setMotivo] = useState('');
  const [montoNuevo, setMontoNuevo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const nuevo = Number(montoNuevo.replace(',', '.'));
  const valido = motivo.trim().length >= 5 && (que === 'ANULAR' || nuevo > 0);

  const pedir = () => Alert.alert('¿Pedir la corrección?',
    `${que === 'ANULAR' ? 'Anular' : `Cambiar a ${formatMoney(nuevo)}`}: ${concepto} · ${formatMoney(monto)}.\nQueda pedido; alguien tiene que aprobarlo.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Pedir', onPress: async () => {
        setOcupado(true);
        trabajando('Pidiendo la corrección…');
        const r = await pedirCorreccion({ sala, movimiento: id, que, motivo: motivo.trim(), montoNuevo: que === 'MONTO' ? nuevo : null }).catch((e) => ({ error: e }));
        setOcupado(false);
        if (r?.error) { fallo('No se pudo pedir', mensajeAmigable(r.error)); return; }
        listo('Queda pedido', 'Alguien tiene que aprobarlo.');
        router.back();
      } },
    ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pedir una corrección' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700', marginHorizontal: 4 }}>{`${concepto} · ${formatMoney(monto)}`}</Text>
          {!puedeOperar ? <Aviso tono="freno" texto="Pedir correcciones es de quien opera la caja." /> : (
            <>
              <Seccion titulo="Qué hay que corregir">
                <Opciones opciones={[{ id: 'ANULAR', label: 'Anularlo' }, { id: 'MONTO', label: 'Corregir el monto' }]} valor={que} onCambiar={setQue} />
                {que === 'MONTO' ? (
                  <Campo multiline={false} value={montoNuevo} onChangeText={(v) => setMontoNuevo(v.replace(/[^\d.,]/g, ''))}
                    keyboardType="decimal-pad" placeholder="Monto correcto" style={{ textAlign: 'center' }} />
                ) : null}
              </Seccion>
              <Seccion titulo="Motivo" pie="Al menos cinco letras: es lo que lee quien aprueba.">
                <Campo value={motivo} onChangeText={setMotivo} maxLength={200} placeholder="Se anotó dos veces" />
              </Seccion>
              <BotonGrande texto={ocupado ? 'Pidiendo…' : 'Pedir'} color={MARCA.ambar} deshabilitado={ocupado || !valido} onPress={pedir} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
