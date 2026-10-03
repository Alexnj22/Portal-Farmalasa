// Ventas perdidas, NATIVO — lo que un cliente pidió y no había
// (`VentasPperdidasView`): los pendientes de revisar para compra, con los más
// pedidos arriba, y los ya atendidos. «Listo» lo pasa a procesado.
//
// Y algo que el portal sólo hacía desde la búsqueda del tablero: REPORTAR desde
// el mostrador, con el teléfono en la mano, en el momento en que el cliente lo
// pide. La forma del reporte y el resumen salen del núcleo (`ventasPerdidas`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchVentasPerdidas, insertVentaPerdida, updateVentaPerdidaStatus } from '@nucleo/data/ventasPerdidas';
import { masSolicitados, reporteDeVentaPerdida } from '@nucleo/utils/ventasPerdidas';
import { fechaHora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import ConAurora from '../componentes/ConAurora';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

function Reportar({ abierto, onCerrar, onListo }) {
  const { user } = useAuth();
  const [buscado, setBuscado] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [laboratorio, setLaboratorio] = useState('');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { if (abierto) { setBuscado(''); setCantidad('1'); setLaboratorio(''); } }, [abierto]);
  const fila = reporteDeVentaPerdida({ buscado, laboratorio, cantidad, salaId: user?.branchId ?? null, empleadoId: user?.id ?? null });
  const enviar = async () => {
    setEnviando(true); trabajando('Reportando…');
    try {
      const { error } = await insertVentaPerdida(fila, { desde: 'app' });
      if (error) throw error;
      listo('Reportado', `${fila.producto_buscado} · ${fila.cantidad} u.`);
      onListo();
    } catch (e) {
      fallo('No se pudo reportar', mensajeAmigable(e, 'Vuelve a intentar en un momento.'));
    } finally { setEnviando(false); }
  };
  return (
    <Modal visible={abierto} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>Reportar una venta perdida</Text>
            <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cancelar</Text>
            </Pressable>
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Lo que el cliente pidió y no tenemos. Logística lo revisa para compra.</Text>
          <Seccion titulo="Qué pidió">
            <Campo multiline={false} value={buscado} onChangeText={setBuscado} placeholder="Nombre del producto, como lo pidió" autoCapitalize="characters" autoFocus />
            <Campo multiline={false} value={laboratorio} onChangeText={setLaboratorio} placeholder="Laboratorio (si lo sabe)" autoCapitalize="characters" />
          </Seccion>
          <Seccion titulo="Cuántas unidades">
            <Campo multiline={false} value={cantidad} onChangeText={(v) => setCantidad(v.replace(/[^\d]/g, ''))} keyboardType="number-pad" style={{ textAlign: 'center', fontSize: 20, fontWeight: '700' }} />
          </Seccion>
          <BotonGrande texto={enviando ? 'Reportando…' : 'Reportar'} color={MARCA.rojo} deshabilitado={enviando || !fila} onPress={enviar} />
        </ScrollView>
      </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}

export default function VentasPerdidas() {
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const [estado, setEstado] = useState('pendiente');
  const [filas, setFilas] = useState(null);
  const [reportando, setReportando] = useState(false);
  const [procesando, setProcesando] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error } = await fetchVentasPerdidas(estado);
    setFilas(error ? [] : (data || []));
    if (error) fallo('No se pudieron cargar', mensajeAmigable(error));
  }, [estado]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]);

  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const nombreDeSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name;
  const top = estado === 'pendiente' ? masSolicitados(filas || []) : [];

  const marcar = async (r) => {
    setProcesando(r.id);
    const { error } = await updateVentaPerdidaStatus(r.id, 'procesado');
    setProcesando(null);
    if (error) { fallo('No se pudo marcar', mensajeAmigable(error)); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setFilas((f) => (f || []).filter((x) => x.id !== r.id));
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ventas perdidas', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <View style={{ marginHorizontal: 16 }}>
          <BotonGrande texto="Reportar lo que pidieron" color={MARCA.rojo} onPress={() => setReportando(true)} />
        </View>
        <Segmentos activa={estado} onCambiar={setEstado} opciones={[{ id: 'pendiente', label: 'Pendientes' }, { id: 'procesado', label: 'Procesados' }]} />
        {top.length ? (
          <View style={{ marginHorizontal: 16, gap: 8 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 4 }}>Más pedidos</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {top.map((s) => <Pildora key={s.nombre} texto={`${s.nombre} · ${s.total} u. (${s.veces}×)`} color={MARCA.rojo} />)}
            </View>
          </View>
        ) : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : filas.map((r) => {
          const nombre = r.descripcion || r.producto_buscado;
          const buscado = r.descripcion && r.producto_buscado !== r.descripcion ? r.producto_buscado : null;
          const quien = porId.get(String(r.reportado_por));
          return (
            <View key={r.id} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={20}>
                <View style={{ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'center' }}>
                  <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(240,68,56,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.rojo, fontSize: 18, fontWeight: '800' }}>{r.cantidad}</Text>
                    <Text style={{ color: MARCA.rojo, fontSize: 10, fontWeight: '700' }}>u.</Text>
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{nombre}</Text>
                    {buscado ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`buscado: «${buscado}»`}</Text> : null}
                    {r.principio_activo || r.laboratorio ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{[r.principio_activo, r.laboratorio].filter(Boolean).join(' · ')}</Text> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {quien ? <Avatar empleado={quien} tamano={18} /> : null}
                      <Text style={{ color: colorSistema.texto2, fontSize: 12, flex: 1 }} numberOfLines={1}>
                        {[nombreDeSala(r.branch_id), quien ? shortEmployeeName(quien) : null, fechaHora12(r.created_at, { day: '2-digit', month: 'short' })].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </View>
                  {estado === 'pendiente' ? (
                    <Pressable disabled={procesando === r.id} onPress={() => marcar(r)} hitSlop={6}
                      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, borderRadius: 22, justifyContent: 'center', backgroundColor: 'rgba(18,183,106,0.18)', opacity: pressed || procesando === r.id ? 0.5 : 1 })}>
                      <Text style={{ color: MARCA.verde, fontSize: 15, fontWeight: '700' }}>Listo</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Vidrio>
            </View>
          );
        })}
        {filas && !filas.length ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
            {estado === 'pendiente' ? 'Sin ventas perdidas pendientes' : 'Sin registros procesados'}
          </Text>
        ) : null}
      </ScrollView>
      <Reportar abierto={reportando} onCerrar={() => setReportando(false)} onListo={() => { setReportando(false); if (estado === 'pendiente') cargar(); else setEstado('pendiente'); }} />
    </>
  );
}
