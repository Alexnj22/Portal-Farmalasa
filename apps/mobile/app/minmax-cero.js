// Poner un producto en 0 en TODAS las salas — y decir por qué. NATIVO —
// `CeroEnTodasModal` del portal.
//
// El porqué es OBLIGATORIO (pedido del usuario, 2026-09-28): es la decisión más
// fuerte del módulo, la toma una persona para las siete salas y se publica en el
// momento. La base también lo exige (`FALTA_MOTIVO`). La puede tomar quien
// decide sobre todas las salas o quien recibió esa función sola
// (`minmax_cero_en_todas`), igual que en el portal. «Ya no rota» —que borra
// historial de demanda— sólo con alcance total.
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ponerEnCeroProductoEnTodasLasSalas } from '@nucleo/data/stockParams';
import { MOTIVO_AJUSTE } from '@nucleo/constants/minmax';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

export default function MinMaxCero() {
  const { producto, nombre, clase, velocidad } = useLocalSearchParams();
  const { hasPermission, getScope } = useAuth();
  const puedeYaNoRota = getScope?.('minmax') === 'ALL';
  const puede = hasPermission('minmax', 'can_edit') && (puedeYaNoRota || hasPermission('minmax_cero_en_todas'));
  const [motivo, setMotivo] = useState('otro');
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const altaRotacion = clase === 'A' || clase === 'B';
  const falta = !nota.trim() ? 'Escribe por qué se pone en 0.' : null;

  const confirmar = () => Alert.alert('¿Poner 0 en todas las salas?', `${nombre} queda en 0 · 0 en todas las sucursales y en Bodega, y se publica ahora.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Poner 0 en todas', style: 'destructive', onPress: async () => {
      setOcupado(true);
      trabajando('Poniendo en 0…');
      const { error } = await ponerEnCeroProductoEnTodasLasSalas({ p_erp_product_id: Number(producto), p_motivo: motivo, p_nota: nota.trim() });
      setOcupado(false);
      if (error) { fallo(nombre || 'Producto', mensajeAmigable(error)); return; }
      useStaffStore.getState().appendAuditLog?.('MINMAX_ZERO_ALL_BRANCHES', String(producto), {
        field: 'min+max', product: nombre, new_min: 0, new_max: 0, motivo, nota: nota.trim(), desde: 'app',
      });
      listo(nombre || 'Producto', 'Quedó en 0 en todas las salas');
      router.back();
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: '0 en todas las salas' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700', marginHorizontal: 4 }}>{nombre}</Text>
          {!puede ? <Aviso tono="freno" texto="Poner un producto en 0 en todas las salas es de quien decide sobre todas, o de quien tiene esa función." /> : (
            <>
              <Aviso tono="cuidado" texto={`Quedará en 0 / 0 en todas las sucursales y en Bodega, y se publica en este momento.${altaRotacion ? ` Es clase ${clase} y vende ${Number(velocidad ?? 0).toFixed(1)} und/día.` : ''}`} />
              {puedeYaNoRota ? (
                <Seccion titulo="Motivo">
                  <Opciones opciones={[{ id: 'otro', label: 'Otro motivo' }, { id: 'ya_no_rota', label: MOTIVO_AJUSTE.ya_no_rota.label, detalle: MOTIVO_AJUSTE.ya_no_rota.detalle }]}
                    valor={motivo} onCambiar={setMotivo} />
                </Seccion>
              ) : null}
              <Seccion titulo="¿Por qué?" pie="Obligatorio: queda en el historial del producto.">
                <Campo value={nota} onChangeText={setNota} maxLength={300} placeholder="Descontinuado, lo retiró el proveedor, sólo se trae por encargo…" />
              </Seccion>
              <BotonGrande texto={ocupado ? 'Guardando…' : 'Poner 0 en todas'} color={MARCA.rojo} deshabilitado={ocupado || !!falta} onPress={confirmar} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
