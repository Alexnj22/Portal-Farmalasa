// Programar (o mover) la entrega de una sala, NATIVO — `ProgramarEntregaModal`
// del portal: fecha y hora con los selectores del sistema, y el historial de
// cada vez que se programó, con quién. Guarda con `programarEntregaDePedido`
// (núcleo), que agrega el cambio al historial en vez de pisarlo.
import { volver } from '../../componentes/volver';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchPedidoSucursalStatus } from '@nucleo/data/pedidos';
import { programarEntregaDePedido } from '@nucleo/data/accionesDePedido';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { diaDe, fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { BotonGrande, Dato, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Hora from '../../componentes/personas/Hora';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';

// «2026-10-07» + «14:30» en El Salvador (UTC−6, sin horario de verano) → ISO.
const aIso = (dia, hora) => new Date(`${dia}T${hora}:00-06:00`).toISOString();

export default function ProgramarEntrega() {
  const { pedidoId, sucId, numero } = useLocalSearchParams();
  const { user } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const [pss, setPss] = useState(null);
  const [dia, setDia] = useState(hoySV());
  const [hora, setHora] = useState('14:00');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    fetchPedidoSucursalStatus(pedidoId, Number(sucId), 'entrega_programada_at, entrega_programada_historial')
      .then(({ data }) => {
        setPss(data ?? {});
        if (data?.entrega_programada_at) {
          setDia(diaDe(data.entrega_programada_at));
          const h = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/El_Salvador' }).format(new Date(data.entrega_programada_at));
          setHora(h);
        }
      })
      .catch(() => setPss({}));
  }, [pedidoId, sucId]);

  const historial = pss?.entrega_programada_historial ?? [];
  const nombre = (id) => {
    const e = (empleados || []).find((x) => String(x.id) === String(id));
    return e ? shortEmployeeName(e) : null;
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      const iso = aIso(dia, hora);
      const yo = (empleados || []).find((x) => String(x.id) === String(user?.id));
      await programarEntregaDePedido({ pedidoId, sucId: Number(sucId), nuevoIso: iso, historial, userId: user?.id ?? null, nombre: yo?.name ?? null });
      useStaffStore.getState().appendAuditLog?.('PEDIDO_ENTREGA_PROGRAMADA', pedidoId, { sucursal_id: Number(sucId), entrega_at: iso, desde: 'app' });
      listo('Entrega programada', `${fechaTexto(iso, { weekday: 'long', day: 'numeric', month: 'long' })} · ${hora12(iso)}`);
      volver('/pedidos');
    } catch (e) {
      fallo('No se pudo programar', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: pss?.entrega_programada_at ? 'Mover la entrega' : 'Programar entrega', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>{`Pedido #${numero} · ${ERP_NAMES[Number(sucId)] ?? ''}`}</Text>
        {pss == null ? <ActivityIndicator /> : (
          <>
            <Seccion titulo="Cuándo llega a la sala">
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Día</Text>
                <Fecha valor={dia} onCambiar={setDia} desde={hoySV()} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Hora</Text>
                <Hora valor={hora} onCambiar={setHora} />
              </View>
            </Seccion>
            {historial.length ? (
              <Seccion titulo="Cambios anteriores">
                {[...historial].reverse().map((h, i) => (
                  <Dato key={`${h.registrado_at}-${i}`} primero={i === 0}
                    rotulo={nombre(h.por) ?? h.nombre ?? '—'}
                    valor={`${fechaTexto(h.programada_at, { day: 'numeric', month: 'short' })} ${hora12(h.programada_at)}`} />
                ))}
              </Seccion>
            ) : null}
            <BotonGrande texto={guardando ? 'Guardando…' : pss?.entrega_programada_at ? 'Actualizar' : 'Confirmar'} color={MARCA.violeta} onPress={guardar} deshabilitado={guardando} />
          </>
        )}
      </ScrollView>
    </>
  );
}
