// Torogoz · cargar camión, NATIVO (el `CargarModal` de Camiones): se elige el
// vendedor, se agregan lotes de bodega con sus unidades y se carga. La carga
// mueve unidades del lote en bodega al MISMO lote en el camión.
//
// ⚠️ Al cargar se emite de una vez la Nota de Remisión (Código Tributario art.
// 109: la mercadería no circula sin documento), igual que el portal. Es un
// documento ante Hacienda: la confirmación lo dice antes de mandar.
//
// La carga a medio armar se guarda como borrador: la sesión se cierra sola.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import useBorrador from '@nucleo/hooks/useBorrador';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cargarCamion, emitirNotaRemision, fetchVendedores, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { fetchLotes } from '@nucleo/data/distribucionInventario';
import { lotesCargables, validarUnidadesDeCarga, yaEnLaCarga } from '@nucleo/utils/distribucionRutas';
import { formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../../componentes/formulario/Piezas';
import { MARCA } from '../../../componentes/inicio/marca';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../../../componentes/torogoz/soloConsulta';
import { volver } from '../../../componentes/volver';

const PETROLEO = '#0f6e7d';
const MOSTRAR = 30;

export default function CargarCamion() {
  const params = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeConfigurar = !!hasPermission?.('distribucion_config', 'can_edit');
  const [vendedores, setVendedores] = useState([]);
  const [vendedor, setVendedor] = useState(typeof params.vendedor === 'string' ? params.vendedor : '');
  const [lotes, setLotes] = useState(null);
  const [buscar, setBuscar] = useState('');
  const [lote, setLote] = useState('');
  const [unidades, setUnidades] = useState('');
  const [items, setItems] = useState([]);
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const { recuperado, descartar } = useBorrador('distribucion-carga-camion', { vendedor, items, nota },
    { vale: (v) => !!(v?.items?.length || v?.nota) });
  const repuesto = useRef(false);
  useEffect(() => {
    if (repuesto.current || !recuperado) return;
    repuesto.current = true;
    if (recuperado.vendedor) setVendedor(recuperado.vendedor);
    setItems(Array.isArray(recuperado.items) ? recuperado.items : []);
    setNota(recuperado.nota ?? '');
  }, [recuperado]);

  useEffect(() => {
    let vivo = true;
    Promise.all([fetchLotes(), fetchVendedores()])
      .then(([l, v]) => { if (vivo) { setLotes(lotesCargables(l)); setVendedores(v); } })
      .catch((e) => { if (vivo) setError(mensajeDeDistribucion(e)); });
    return () => { vivo = false; };
  }, []);

  const porId = useMemo(() => new Map((lotes ?? []).map((l) => [String(l.id), l])), [lotes]);
  const sel = porId.get(lote);
  const { n, libre, malo } = validarUnidadesDeCarga(sel, items, unidades);
  const q = buscar.trim();
  const candidatos = useMemo(() => (lotes ?? [])
    .filter((l) => Number(l.existencia) - yaEnLaCarga(items, l.id) > 0)
    .filter((l) => !q || tokenMatch(q, l.nombre, l.lote)), [lotes, items, q]);

  const agregar = () => {
    if (!sel || malo || !n) return;
    Haptics.selectionAsync().catch(() => {});
    setItems((xs) => [...xs, { lote_id: sel.id, unidades: n }]);
    setLote(''); setUnidades(''); setBuscar('');
  };

  const cargar = () => {
    const quien = shortEmployeeName(vendedores.find((v) => v.id === vendedor));
    Alert.alert('Cargar el camión', `${items.length} lotes al camión de ${quien}. Al cargar se emite la Nota de Remisión ante Hacienda.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cargar y emitir',
        onPress: async () => {
          setOcupado(true);
          setError('');
          try {
            const carga = await cargarCamion(vendedor, items, nota);
            useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_CAMION_CARGADO', String(carga), { vendedor, items, desde: 'app' });
            descartar();
            let mensaje;
            try {
              const r = await emitirNotaRemision(carga);
              mensaje = r?.numero_control ? `Nota de Remisión ${r.numero_control}` : (r?.aviso ?? 'Listo.');
            } catch (e) {
              mensaje = `Falta la Nota de Remisión: ${mensajeDeDistribucion(e)}`;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            Alert.alert('Camión cargado', mensaje, [{ text: 'OK', onPress: () => volver('/torogoz/camiones') }]);
          } catch (e) {
            setError(mensajeDeDistribucion(e));
          } finally {
            setOcupado(false);
          }
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Cargar camión', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        {!puedeConfigurar ? <Aviso tono="cuidado" texto="Tu cargo no puede cargar camiones." /> : null}
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {recuperado && items.length ? <Aviso texto="Se recuperó la carga que estabas armando." /> : null}
        {puedeConfigurar ? (
          <>
            <Seccion titulo="Vendedor">
              <Opciones color={PETROLEO} valor={vendedor} onCambiar={setVendedor} opciones={vendedores.map((v) => ({ id: v.id, label: shortEmployeeName(v) }))} />
            </Seccion>
            <Seccion titulo="Agregar un lote de bodega">
              <Campo multiline={false} value={buscar} onChangeText={(t) => { setBuscar(t); setLote(''); }} placeholder={lotes ? 'Buscar producto o lote…' : 'Cargando…'} clearButtonMode="while-editing" />
              {sel ? (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${sel.nombre} · ${sel.lote}`}</Text>
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    <Campo multiline={false} keyboardType="number-pad" value={unidades} placeholder="Unidades" style={{ flex: 1 }}
                      onChangeText={(t) => setUnidades(t.replace(/\D/g, ''))} />
                    <Pressable onPress={agregar} disabled={!n || malo} accessibilityRole="button"
                      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: 'center', backgroundColor: PETROLEO, opacity: !n || malo ? 0.4 : pressed ? 0.7 : 1 })}>
                      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Agregar</Text>
                    </Pressable>
                  </View>
                  <Text style={{ color: malo ? MARCA.rojo : colorSistema.texto2, fontSize: 13 }}>{`Hasta ${formatQty(libre)} en bodega`}</Text>
                </View>
              ) : lotes ? (
                <Opciones color={PETROLEO} valor={lote} onCambiar={(v) => setLote(String(v))}
                  opciones={candidatos.slice(0, MOSTRAR).map((l) => ({
                    id: String(l.id), label: `${l.nombre} · ${l.lote}`,
                    detalle: `${formatQty(Number(l.existencia) - yaEnLaCarga(items, l.id))} en bodega${l.vence ? ` · vence ${fechaNumerica(l.vence)}` : ''}`,
                  }))} />
              ) : null}
              {!sel && candidatos.length > MOSTRAR ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Y ${candidatos.length - MOSTRAR} más: escribe para buscar.`}</Text> : null}
            </Seccion>
            {items.length ? (
              <Seccion titulo={`Lo que se carga (${items.length})`}>
                {items.map((it, i) => {
                  const l = porId.get(String(it.lote_id));
                  return (
                    <View key={`${it.lote_id}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{l?.nombre ?? `Lote ${it.lote_id}`}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Lote ${l?.lote ?? ''}${l?.vence ? ` · vence ${fechaNumerica(l.vence)}` : ''}`}</Text>
                      </View>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatQty(it.unidades)}</Text>
                      <Pressable onPress={() => setItems((xs) => xs.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel="Quitar">
                        <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '700' }}>Quitar</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </Seccion>
            ) : null}
            <Seccion titulo="Nota (opcional)" pie="Al cargar se emite la Nota de Remisión que ampara la mercadería en el camión.">
              <Campo value={nota} onChangeText={setNota} placeholder="Ej.: ruta del martes" />
            </Seccion>
            {ACCIONES_DE_DINERO ? (
              <BotonGrande texto={ocupado ? 'Cargando…' : `Cargar${items.length ? ` (${items.length})` : ''}`} color={PETROLEO}
                deshabilitado={!vendedor || !items.length || ocupado} onPress={cargar} />
            ) : <SeHaceEnElPortal texto="Cargar el camión emite la Nota de Remisión: se hace desde el portal." />}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
