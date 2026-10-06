// Corregir las marcas de un día, NATIVO — el `DayCorrectionModal` de la
// Auditoría de tiempos del portal: el horario planificado, las marcas que hay
// y las que faltan, y agregar una marca con su tipo, su hora y el motivo.
//
// Se guarda con la MISMA acción del store (`insertAttendancePunchAt`) y los
// mismos detalles: `manualAudit` hace que la capa de datos anote
// ATTENDANCE_PUNCH_MANUAL_ADDED con quién la puso y por qué. La hora es de El
// Salvador (`buildCSTDate`). La lista de tipos es del núcleo
// (`tiposDeMarcaParaCorregir`): las del almuerzo y la lactancia sólo si el día
// las tiene.
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { buildCSTDate } from '@nucleo/data/attendanceAudit';
import { ROTULO_MARCA, tiposDeMarcaParaCorregir } from '@nucleo/utils/auditoriaDeTiempos';
import { fmtTimeCSTStr } from '@nucleo/utils/quincena';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Dato, Opciones, Seccion } from '../formulario/Piezas';
import ConAurora from '../ConAurora';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';
import Hora from './Hora';

export default function CorregirMarcas({ objetivo, usuario, onCerrar }) {
  const insertar = useStaffStore((s) => s.insertAttendancePunchAt);
  const [tipo, setTipo] = useState('');
  const [hora, setHora] = useState('08:00');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const a = objetivo?.a;
  const tipos = useMemo(() => tiposDeMarcaParaCorregir(a?.dayConfig), [a]);

  const guardar = async () => {
    if (!objetivo || !tipo || !hora) return;
    const ts = buildCSTDate(objetivo.dia, hora);
    if (!ts || Number.isNaN(ts.getTime())) { fallo('Hora inválida', ''); return; }
    setGuardando(true);
    try {
      await insertar(objetivo.persona.id, ts.toISOString(), tipo, {
        manualAudit: true, auditedByName: usuario?.name || usuario?.email, auditedById: usuario?.id,
        reason: motivo.trim(), editedAt: new Date().toISOString(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('Marca registrada', `${tipos.find((t) => t.value === tipo)?.label} · ${hora12(hora)}`);
      setTipo(''); setMotivo('');
      onCerrar(true);
    } catch (e) {
      fallo('No se pudo guardar', mensajeAmigable(e, 'La marca no se registró. Intenta de nuevo.'));
    } finally { setGuardando(false); }
  };

  return (
    <Modal visible={!!objetivo} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onCerrar(false)}>
      {objetivo ? (
        <ConAurora>
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
              <Pressable onPress={() => onCerrar(false)} hitSlop={10}><Text style={{ color: MARCA.azulClaro, fontSize: 17, fontWeight: '600' }}>Cancelar</Text></Pressable>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800' }}>Corrección de marcaje</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${shortEmployeeName(objetivo.persona)} · ${fechaTexto(objetivo.dia, { weekday: 'long', day: 'numeric', month: 'long' })}`}</Text>
              </View>
              <View style={{ width: 70 }} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
              <Seccion titulo="Horario planificado">
                {a.shiftStart
                  ? <Dato primero rotulo={a.shift?.name || 'Horas propias'} valor={`${hora12(a.shiftStart)} – ${hora12(a.shiftEnd)}`} />
                  : <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{a.isOff ? 'Día libre' : 'Sin horario asignado'}</Text>}
                {a.dayConfig?.lunchStart ? <Dato rotulo="Almuerzo" valor={hora12(a.dayConfig.lunchStart)} /> : null}
              </Seccion>
              <Seccion titulo={`Marcas del día · ${a.dayPunches.length}`}>
                {a.dayPunches.length ? a.dayPunches.map((p, i) => (
                  <Dato key={p.id ?? p.timestamp} primero={i === 0} rotulo={ROTULO_MARCA[p.type] ?? p.type} valor={fmtTimeCSTStr(p.timestamp)} />
                )) : <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Sin marcas.</Text>}
                {a.inconsistencies.map((i) => <Text key={i.type} style={{ color: MARCA.rojo, fontSize: 14 }}>{`Falta: ${i.label} (${fmtTimeCSTStr(i.expected)})`}</Text>)}
              </Seccion>
              <Seccion titulo="Agregar marca">
                <Opciones opciones={tipos.map((t) => ({ id: t.value, label: t.label }))} valor={tipo} onCambiar={setTipo} />
              </Seccion>
              {tipo ? (
                <>
                  <Seccion>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Hora</Text>
                      <Hora valor={hora} onCambiar={setHora} />
                    </View>
                  </Seccion>
                  <Seccion titulo="Motivo" pie="Queda en la bitácora con tu nombre.">
                    <TextInput value={motivo} onChangeText={setMotivo} placeholder="Ej: olvidó marcar, el kiosco no respondía" placeholderTextColor={colorSistema.texto2} multiline
                      style={{ minHeight: 64, borderRadius: 12, padding: 12, fontSize: 16, color: colorSistema.texto, backgroundColor: 'rgba(127,127,127,0.16)' }} />
                  </Seccion>
                  <Aviso texto="La marca se agrega a las que ya hay: no reemplaza ninguna." />
                  <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar marca'} onPress={guardar} deshabilitado={guardando || !tipo || !hora} />
                </>
              ) : null}
            </ScrollView>
          </KeyboardAvoidingView>
        </ConAurora>
      ) : null}
    </Modal>
  );
}
