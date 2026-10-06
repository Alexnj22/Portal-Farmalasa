// Las dos acciones sobre UN renglón de conteo que no son contarlo, NATIVO:
//
// - `modo: 'lote'` — `EditLoteModal` del portal: el lote físico no es el del
//   renglón. Sólo corrige la ETIQUETA del conteo (`editarLoteConteoItem`), no
//   el inventario real ni contra qué se compara. Conteo abierto y por lote.
// - `modo: 'recuento'` — el recuento del supervisor entre finalizar y aprobar
//   (`recontarConteoItem`). La RPC exige can_approve, rechaza que lo haga quien
//   contó esa línea y conserva el primer conteo en el historial.
//
// Los dos piden confirmación antes de escribir: el recuento cambia la
// diferencia que se va a firmar.
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cantidadValida } from '@nucleo/utils/conteoDeInventario';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import ConAurora from '../ConAurora';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import Fecha from '../formulario/Fecha';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

export default function AccionDeRenglon({ item, modo, onCerrar, onHecho }) {
  const editarLote = useStaffStore((s) => s.editarLoteConteoItem);
  const recontar = useStaffStore((s) => s.recontarConteoItem);
  const [lote, setLote] = useState('');
  const [vence, setVence] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!item) return;
    setLote(item.lote || '');
    setVence(item.fecha_vencimiento || '');
    setCantidad('');
    setNota('');
  }, [item]);

  const esLote = modo === 'lote';
  const valido = esLote ? true : cantidad !== '' && cantidadValida(cantidad);

  const enviar = async () => {
    setGuardando(true);
    try {
      if (esLote) {
        const r = await editarLote(item.id, { lote: lote.trim() || null, fechaVencimiento: vence || null });
        listo('Lote corregido', 'Se actualizó la etiqueta del renglón.');
        onHecho?.(item.id, { lote: r.lote, fecha_vencimiento: r.fecha_vencimiento });
      } else {
        const valor = Number(cantidad);
        const r = await recontar(item.id, { fisicoCantidad: valor, nota: nota.trim() || null });
        listo('Recuento guardado', `${item.product_nombre || 'Renglón'}: ${valor}`);
        onHecho?.(item.id, {
          fisico_primer_conteo: r.fisico_primer_conteo, fisico_cantidad: valor, sistema_cantidad: r.sistema_cantidad,
          diferencia: r.diferencia, estado_item: valor === 0 && r.sistema_cantidad > 0 ? 'SIN_UBICAR' : 'CONTADO',
          recontado_at: new Date().toISOString(),
        });
      }
      onCerrar();
    } catch (e) {
      fallo(esLote ? 'No se corrigió el lote' : 'No se guardó el recuento', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };

  const guardar = () => {
    if (!valido || guardando) return;
    if (esLote) {
      Alert.alert('¿Corregir el lote?', 'Cambia la etiqueta de este renglón del conteo. El inventario real no se toca.', [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Corregir', onPress: enviar }]);
    } else {
      Alert.alert('¿Guardar el recuento?', `El físico de este renglón pasa a ${cantidad}. El primer conteo queda en el historial.`, [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Guardar', onPress: enviar }]);
    }
  };

  return (
    <Modal visible={!!item} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{esLote ? 'Corregir lote' : 'Recontar'}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                  {[item?.product_nombre, item?.presentacion, item?.lote ? `lote ${item.lote}` : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text>
              </Pressable>
            </View>

            {esLote ? (
              <>
                <Aviso tono="nota" texto="Usa esto cuando el lote encontrado no corresponde al de este renglón. Sólo corrige la etiqueta de este conteo — no modifica el inventario real." />
                <Seccion titulo="Lote">
                  <Campo multiline={false} value={lote} onChangeText={setLote} placeholder="Número de lote" autoCapitalize="characters" autoCorrect={false} />
                </Seccion>
                <Seccion titulo="Vencimiento">
                  <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>
                      {vence ? fechaTexto(vence, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Sin fecha'}
                    </Text>
                    {vence ? <Fecha valor={vence} onCambiar={setVence} /> : null}
                    <Pressable onPress={() => setVence(vence ? '' : (item?.fecha_vencimiento || hoySV()))} hitSlop={8} style={{ marginLeft: 10 }}>
                      <Text style={{ color: colorSistema.acento, fontSize: 15 }}>{vence ? 'Quitar' : 'Poner fecha'}</Text>
                    </Pressable>
                  </View>
                </Seccion>
              </>
            ) : (
              <>
                <Seccion titulo="Primer conteo">
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>
                    {`Físico ${item?.fisico_cantidad ?? '—'}${item?.ver_sistema && item?.sistema_cantidad != null ? ` · sistema ${item.sistema_cantidad}` : ''}`}
                  </Text>
                </Seccion>
                <Seccion titulo="Recuento">
                  <Campo multiline={false} keyboardType="number-pad" value={cantidad} onChangeText={(v) => setCantidad(v.replace(/[^\d]/g, ''))}
                    placeholder="Cantidad encontrada" style={{ fontSize: 22, fontWeight: '700' }} />
                </Seccion>
                <Seccion titulo="Nota (opcional)">
                  <Campo value={nota} onChangeText={setNota} placeholder="Dónde apareció, qué se revisó" style={{ minHeight: 60 }} />
                </Seccion>
              </>
            )}
            <BotonGrande texto={guardando ? 'Guardando…' : esLote ? 'Corregir el lote' : 'Guardar el recuento'} onPress={guardar} deshabilitado={!valido || guardando} />
          </ScrollView>
        </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}
