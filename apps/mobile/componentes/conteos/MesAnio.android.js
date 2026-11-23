// «Vence» de un lote en Android: MES y año en UN solo cuadro — el año con
// flechas y los doce meses en cuadrícula, como el `CampoMesAnio` del portal.
// Sale como «AAAA-MM».
//
// 2026-11-23 (Bodega, conteo de inventario): eran dos hojas seguidas (año,
// después mes) y en Android, después de elegir el año, la hoja del mes no
// dejaba elegir. Con un solo cuadro no hay una hoja que abra a otra.
import { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { colorSistema } from '../Formulario';
import Tocable, { Presionable as Pressable } from '../Tocable';
import { MARCA } from '../inicio/marca';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export default function MesAnio({ valor, onCambiar }) {
  const [a, m] = String(valor || '').split('-');
  const [abierto, setAbierto] = useState(false);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const abrir = () => { setAnio(a ? Number(a) : new Date().getFullYear()); setAbierto(true); };
  const elegir = (i) => { setAbierto(false); onCambiar(`${anio}-${String(i + 1).padStart(2, '0')}`); };
  const flecha = (texto, delta, etiqueta) => (
    <Pressable onPress={() => setAnio((x) => x + delta)} accessibilityRole="button" accessibilityLabel={etiqueta}
      style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: MARCA.azulClaro, fontSize: 26, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
  return (
    <>
      <Tocable onPress={abrir} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Vence</Text>
        <Text style={{ flex: 1, textAlign: 'right', color: valor ? colorSistema.acento : colorSistema.texto2, fontSize: 16 }}>
          {a && m ? `${MESES[Number(m) - 1]} ${a}` : 'Mes y año'}
        </Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
      </Tocable>
      <Modal visible={abierto} transparent animationType="fade" onRequestClose={() => setAbierto(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }} onPress={() => setAbierto(false)}>
          <Pressable android_ripple={null} onPress={() => {}}
            style={{ borderRadius: 28, backgroundColor: colorSistema.fila, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '600', marginBottom: 8, marginLeft: 8 }}>Vencimiento</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              {flecha('‹', -1, 'Año anterior')}
              <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{anio}</Text>
              {flecha('›', 1, 'Año siguiente')}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {CORTOS.map((mes, i) => {
                const elegido = Number(a) === anio && Number(m) === i + 1;
                return (
                  <View key={mes} style={{ width: '33.33%', padding: 4 }}>
                    <Pressable onPress={() => elegir(i)} accessibilityRole="button" accessibilityLabel={`${MESES[i]} ${anio}`}
                      style={{ minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: elegido ? MARCA.azul : 'transparent' }}>
                      <Text style={{ color: elegido ? '#FFFFFF' : colorSistema.texto, fontSize: 16, fontWeight: elegido ? '700' : '500' }}>{mes}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
              <Pressable onPress={() => setAbierto(false)} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Cancelar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
