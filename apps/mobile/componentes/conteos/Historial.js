// El historial de un renglón de conteo, NATIVO — `ItemHistoryModal` del
// portal: quién puso cada cantidad y cuándo, si la editó, la borró, la recontó
// o corrigió el lote, con su nota y la diferencia contra el sistema.
//
// Los eventos se rotulan con `EVENTO_DE_CONTEO` (núcleo), los del portal. La
// cantidad del sistema sólo viene cuando este cargo puede verla: el ciego no
// pasa por acá, porque la base no la manda.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useStaffStore } from '@nucleo/store/staffStore';
import { EVENTO_DE_CONTEO } from '@nucleo/utils/conteoDeInventario';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { fmtHM } from '@nucleo/utils/tableroDePedidos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import ConAurora from '../ConAurora';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import { FONDO, Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import Avatar from '../Avatar';

const COLOR = { success: MARCA.verde, warning: MARCA.ambar, danger: MARCA.rojo, 'chart-1': MARCA.azulClaro, 'chart-9': MARCA.violetaClaro, neutral: colorSistema.texto2 };

export default function Historial({ item, simple = false, onCerrar }) {
  const fetchConteoItemHistory = useStaffStore((s) => s.fetchConteoItemHistory);
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!item) return undefined;
    let vivo = true;
    setFilas(null);
    fetchConteoItemHistory(item.id)
      .then((h) => { if (vivo) setFilas(h); })
      .catch((e) => { if (vivo) { setError(mensajeAmigable(e)); setFilas([]); } });
    return () => { vivo = false; };
  }, [item, fetchConteoItemHistory]);

  return (
    <Modal visible={!!item} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{item?.product_nombre}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                {`Historial · ${simple ? (item?.presentacion || 'sin presentación') : (item?.lote ? `lote ${item.lote}` : 'sin lote')}`}
              </Text>
            </View>
            <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text>
            </Pressable>
          </View>
          {error ? <Aviso tono="freno" texto={error} /> : null}
          {filas == null ? <ActivityIndicator style={{ marginTop: 20 }} /> : !filas.length ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginTop: 20 }}>Sin registros todavía.</Text>
          ) : filas.map((h, i) => {
            const ev = EVENTO_DE_CONTEO[h.evento] ?? EVENTO_DE_CONTEO.EDICION;
            const dif = h.diferencia;
            return (
              <View key={`${h.contado_at}-${i}`} style={{ borderRadius: 16, backgroundColor: FONDO, padding: 12, flexDirection: 'row', gap: 10 }}>
                <Avatar empleado={{ id: h.contado_por, name: h.contado_por_nombre, photo: h.contado_por_photo_url }} tamano={36} />
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{h.contado_por_nombre ? shortEmployeeName(h.contado_por_nombre) : 'Desconocido'}</Text>
                    <Pildora texto={ev.label} color={COLOR[ev.variante] ?? MARCA.ambar} />
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                    {h.contado_at ? `${fechaTexto(String(h.contado_at).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmtHM(h.contado_at)}` : '—'}
                  </Text>
                  {h.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`“${h.nota}”`}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{h.fisico_cantidad ?? '—'}</Text>
                  {h.sistema_cantidad != null ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`sistema ${h.sistema_cantidad}`}</Text> : null}
                  {dif != null ? (
                    <Text style={{ color: dif === 0 ? MARCA.verde : dif < 0 ? MARCA.rojo : MARCA.azulClaro, fontSize: 13, fontWeight: '800' }}>{dif > 0 ? `+${dif}` : String(dif)}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}
