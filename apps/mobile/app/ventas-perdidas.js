// Ventas perdidas, NATIVO — lo que un cliente pidió y no había
// (`VentasPperdidasView`): los pendientes de revisar para compra, con los más
// pedidos arriba, y los ya atendidos. «Listo» lo pasa a procesado.
//
// Y algo que el portal sólo hacía desde la búsqueda del tablero: REPORTAR desde
// el mostrador, con el teléfono en la mano, en el momento en que el cliente lo
// pide. La forma del reporte y el resumen salen del núcleo (`ventasPerdidas`).
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { hoySV } from '@nucleo/utils/fecha';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { compartirCsv } from '../componentes/fiscal/csv';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchVentasPerdidasCompletas, insertVentaPerdida, updateVentaPerdidaStatus } from '@nucleo/data/ventasPerdidas';
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
import { ErrorConReintento, useColumnas } from '../componentes/ListaPaginada';
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

// Una fila: memoizada, así filtrar o marcar «Listo» no repinta toda la lista.
const Fila = memo(function Fila({ r, quien, sala, pendiente, ocupado, onMarcar, columnas }) {
  const nombre = r.descripcion || r.producto_buscado;
  const buscado = r.descripcion && r.producto_buscado !== r.descripcion ? r.producto_buscado : null;
  return (
    <View style={{ ...(columnas > 1 ? { flex: 1 / columnas } : { marginHorizontal: 16 }), marginTop: 12 }}>
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
                {[sala, quien ? shortEmployeeName(quien) : null, fechaHora12(r.created_at, { day: '2-digit', month: 'short' })].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
          {pendiente ? (
            <Pressable disabled={ocupado} onPress={() => onMarcar(r)} hitSlop={6}
              style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, borderRadius: 22, justifyContent: 'center', backgroundColor: 'rgba(18,183,106,0.18)', opacity: pressed || ocupado ? 0.5 : 1 })}>
              <Text style={{ color: MARCA.verde, fontSize: 15, fontWeight: '700' }}>Listo</Text>
            </Pressable>
          ) : null}
        </View>
      </Vidrio>
    </View>
  );
});

export default function VentasPerdidas() {
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const [estado, setEstado] = useState('pendiente');
  const [filas, setFilas] = useState(null);
  const [reportando, setReportando] = useState(false);
  const [procesando, setProcesando] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [sala, setSala] = useState('todas');
  const [quienFiltro, setQuienFiltro] = useState('todos');
  const [error, setError] = useState(null);
  const columnas = useColumnas();

  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchVentasPerdidasCompletas(estado);
    setError(e ? mensajeAmigable(e) : null);
    setFilas(e ? [] : (data || []));
  }, [estado]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al cambiar de estado

  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const salaPorId = useMemo(() => new Map((sucursales || []).map((b) => [String(b.id), b.name])), [sucursales]);
  const nombreDeSala = useCallback((id) => salaPorId.get(String(id)), [salaPorId]);
  // Filtros por sala y por quién reportó (sobre lo que trae el estado elegido).
  const visibles = useMemo(() => (filas || []).filter((r) => (sala === 'todas' || String(r.branch_id) === sala)
    && (quienFiltro === 'todos' || String(r.reportado_por) === quienFiltro)), [filas, sala, quienFiltro]);
  const top = useMemo(() => (estado === 'pendiente' ? masSolicitados(visibles) : []), [estado, visibles]);
  const grupos = [
    { id: 'sala', titulo: 'Sala', activa: sala, porDefecto: 'todas', onCambiar: setSala,
      opciones: [{ id: 'todas', label: 'Todas' }, ...[...new Set((filas || []).map((r) => String(r.branch_id)).filter((x) => x && x !== 'null'))].map((id) => ({ id, label: nombreDeSala(id) ?? `Sala ${id}` }))] },
    { id: 'quien', titulo: 'Reportó', activa: quienFiltro, porDefecto: 'todos', onCambiar: setQuienFiltro,
      opciones: [{ id: 'todos', label: 'Todos' }, ...[...new Set((filas || []).map((r) => String(r.reportado_por)).filter((x) => x && x !== 'null'))].map((id) => ({ id, label: porId.get(id) ? shortEmployeeName(porId.get(id)) : 'Alguien' }))] },
  ];
  // El mismo CSV del portal (columnas y orden), anotado como salida de datos.
  const exportar = () => compartirCsv({
    headers: ['Fecha', 'Producto', 'Buscado como', 'Cantidad', 'Principio activo', 'Laboratorio', 'Sucursal', 'Reportado por'],
    rows: visibles.map((r) => [fechaHora12(r.created_at, { day: '2-digit', month: 'short', year: 'numeric' }), r.descripcion || r.producto_buscado || '', r.producto_buscado || '', r.cantidad ?? '',
      r.principio_activo || '', r.laboratorio || '', nombreDeSala(r.branch_id) || '', porId.get(String(r.reportado_por))?.name || '']),
    nombre: `ventas_perdidas_${estado}_${hoySV()}`, modulo: 'ventas_perdidas', detalle: { tab: estado },
  }).catch((e) => fallo('No se pudo exportar', mensajeAmigable(e)));

  const marcar = useCallback(async (r) => {
    setProcesando(r.id);
    const { error } = await updateVentaPerdidaStatus(r.id, 'procesado');
    setProcesando(null);
    if (error) { fallo('No se pudo marcar', mensajeAmigable(error)); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setFilas((f) => (f || []).filter((x) => x.id !== r.id));
  }, []);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ventas perdidas', headerLargeTitle: true }} />
      <MenuDeFiltros grupos={grupos} extra={visibles.length ? { icono: 'square.and.arrow.up', etiqueta: 'Exportar CSV', onPress: exportar } : null} />
      <FlatList key={`c${columnas}`} numColumns={columnas} columnWrapperStyle={columnas > 1 ? { gap: 10, paddingHorizontal: 16 } : undefined}
        data={filas == null ? [] : visibles} keyExtractor={(r) => String(r.id)}
        renderItem={({ item: r }) => (
          <Fila r={r} quien={porId.get(String(r.reportado_por))} sala={nombreDeSala(r.branch_id)} columnas={columnas}
            pendiente={estado === 'pendiente'} ocupado={procesando === r.id} onMarcar={marcar} />
        )}
        contentInsetAdjustmentBehavior="automatic" initialNumToRender={12} windowSize={9}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}
        ListHeaderComponent={(
          <View style={{ gap: 12 }}>
            <View style={{ marginHorizontal: 16 }}>
              <BotonGrande texto="Reportar lo que pidieron" color={MARCA.rojo} onPress={() => setReportando(true)} />
            </View>
            <Segmentos activa={estado} onCambiar={setEstado} opciones={[{ id: 'pendiente', label: 'Pendientes' }, { id: 'procesado', label: 'Procesados' }]} />
            <FiltrosActivos grupos={grupos} />
            {top.length ? (
              <View style={{ marginHorizontal: 16, gap: 8 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 4 }}>Más pedidos</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {top.map((t) => <Pildora key={t.nombre} texto={`${t.nombre} · ${t.total} u. (${t.veces}×)`} color={MARCA.rojo} />)}
                </View>
              </View>
            ) : null}
            {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
          </View>
        )}
        ListEmptyComponent={filas == null ? null : error ? <ErrorConReintento mensaje={error} onReintentar={() => { setFilas(null); cargar(); }} /> : (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
            {estado === 'pendiente' ? 'Sin ventas perdidas pendientes' : 'Sin registros procesados'}
          </Text>
        )} />
      <Reportar abierto={reportando} onCerrar={() => setReportando(false)} onListo={() => { setReportando(false); if (estado === 'pendiente') cargar(); else setEstado('pendiente'); }} />
    </>
  );
}
