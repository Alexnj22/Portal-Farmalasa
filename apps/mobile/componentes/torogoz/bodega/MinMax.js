// El mínimo y el máximo de un producto de Torogoz, NATIVO — el `MinMaxModal`
// de Reposición. Vacío = automático (sale de la velocidad de venta). Lo fija
// quien administra, con la misma función de la base (`fijarMinMax`).
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { fijarMinMax, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { enteroOpcional } from '@nucleo/utils/distribucionBodega';
import { formatQty } from '@nucleo/utils/formatNumber';
import { useStaffStore } from '@nucleo/store/staffStore';
import ConAurora from '../../ConAurora';
import { colorSistema } from '../../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { fallo, listo } from '../../Progreso';
import { PETROLEO, confirmar } from './piezas';

export default function MinMax({ producto, onCerrar, onGuardado }) {
  const [min, setMin] = useState(producto.manual ? String(producto.minimo) : '');
  const [max, setMax] = useState(producto.manual ? String(producto.maximo) : '');
  const [guardando, setGuardando] = useState(false);
  const nMin = enteroOpcional(min), nMax = enteroOpcional(max);
  const valido = !Number.isNaN(nMin) && !Number.isNaN(nMax) && (nMin == null || nMax == null || nMax >= nMin);

  const guardar = async (automatico) => {
    const ok = await confirmar(automatico ? '¿Volver al automático?' : '¿Guardar mínimo y máximo?',
      automatico ? `${producto.nombre} vuelve a calcularse con su venta.` : `${producto.nombre}: mínimo ${nMin ?? 'automático'} · máximo ${nMax ?? 'automático'}.`,
      'Guardar');
    if (!ok) return;
    setGuardando(true);
    try {
      await fijarMinMax(producto.product_id, automatico ? null : nMin, automatico ? null : nMax);
      useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_MINMAX', String(producto.product_id), { minimo: automatico ? null : nMin, maximo: automatico ? null : nMax, desde: 'app' });
      listo('Guardado', producto.nombre);
      onGuardado();
    } catch (e) {
      fallo('No se pudo guardar', mensajeDeDistribucion(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={guardando ? undefined : onCerrar}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 4 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }} numberOfLines={2}>{producto.nombre}</Text>
            <Pressable onPress={onCerrar} disabled={guardando} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cancelar</Text>
            </Pressable>
          </View>
          <Aviso texto={`Vende ${formatQty(Number(producto.velocidad))} unidades por día. Vacío = automático (hoy ${producto.minimo} · ${producto.maximo}).`} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Seccion titulo="Mínimo">
                <Campo multiline={false} keyboardType="number-pad" value={min} onChangeText={setMin} placeholder="Automático" />
              </Seccion>
            </View>
            <View style={{ flex: 1 }}>
              <Seccion titulo="Máximo">
                <Campo multiline={false} keyboardType="number-pad" value={max} onChangeText={setMax} placeholder="Automático" />
              </Seccion>
            </View>
          </View>
          {Number.isNaN(nMin) || Number.isNaN(nMax) ? <Aviso tono="freno" texto="Escribe números enteros." />
            : !valido ? <Aviso tono="freno" texto="El máximo tiene que ser mayor o igual al mínimo." /> : null}
          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} color={PETROLEO} onPress={() => guardar(false)}
            deshabilitado={!valido || guardando || (nMin == null && nMax == null)} />
          {producto.manual ? <BotonGrande borde texto="Volver al automático" color={PETROLEO} onPress={() => guardar(true)} deshabilitado={guardando} /> : null}
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}
