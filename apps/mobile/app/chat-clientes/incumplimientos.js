// «Incumplimientos» del chat, NATIVO — `IncumplimientosDelChat.jsx` del
// portal: las veces que un cliente esperó más de 20 minutos con el chat
// asignado a alguien que no le contestó (las registra el servidor,
// `chat_vigilar_espera`). Últimos 30 días. Se llega desde la bandeja, sólo con
// supervisión o permiso de editar el chat; la policy de la tabla exige ver el
// chat. Tocar uno abre esa conversación.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { TOPE_INCUMPLIMIENTOS, fetchIncumplimientosDelChat } from '@nucleo/data/chatClientes';
import { useEquipoDelChat } from '@nucleo/hooks/useBandejaDelChat';
import { nombreDeCliente } from '@nucleo/utils/chatClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Avatar from '../../componentes/Avatar';
import Vidrio from '../../componentes/Vidrio';
import Tocable from '../../componentes/Tocable';
import { MARCA } from '../../componentes/inicio/marca';

const DIAS = 30;

export default function Incumplimientos() {
  const { equipo, asegurarEquipo } = useEquipoDelChat();
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const cargar = useCallback(() => fetchIncumplimientosDelChat(DIAS)
    .then((d) => { setFilas(d); setError(null); asegurarEquipo?.(d.map((f) => f.employee_id)); })
    .catch((e) => { setError(mensajeAmigable(e, 'No se pudo cargar el registro de incumplimientos.')); setFilas((x) => x ?? []); }), [asegurarEquipo]);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Incumplimientos', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Aviso texto={`Clientes que esperaron más de 20 minutos con el chat asignado a alguien que no contestó. Últimos ${DIAS} días.`} />
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {filas && filas.length >= TOPE_INCUMPLIMIENTOS ? <Aviso tono="cuidado" texto={`Se muestran los ${TOPE_INCUMPLIMIENTOS} más recientes.`} /> : null}
        {(filas || []).map((f) => {
          const emp = equipo?.get?.(f.employee_id) ?? { id: f.employee_id };
          const cliente = f.conversacion?.cliente?.name ?? null;
          return (
            <Tocable key={f.id} accessibilityRole="button"
              onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push(`/chat-clientes/${f.conversacion_id}`); }}>
              <Vidrio radio={18}>
                <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
                  <Avatar empleado={emp} tamano={34} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                      {emp.name || emp.first_names ? shortEmployeeName(emp) : 'Alguien del equipo'}
                    </Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 14 }} numberOfLines={1}>
                      {cliente ? `No le contestó a ${nombreDeCliente(cliente)}` : 'No le contestó a un cliente'}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <Pildora texto={`⏱ ${f.minutos} min`} color={MARCA.rojo} />
                      {f.sala?.name ? <Pildora texto={f.sala.name} color={colorSistema.texto2} /> : null}
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaHora12(f.created_at)}</Text>
                    </View>
                  </View>
                </View>
              </Vidrio>
            </Tocable>
          );
        })}
        {filas && !filas.length && !error ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 32 }}>Sin incumplimientos</Text>
        ) : null}
      </ScrollView>
    </>
  );
}
