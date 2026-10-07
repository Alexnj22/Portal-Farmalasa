// Camiones (autoventa, `TabCamiones` del portal): lo que lleva cada camión
// por lote —cargado, vendido y lo que queda— con su Nota de Remisión. Quien
// administra carga, descarga y emite la Nota que falte.
//
// ⚠️ Emitir la Nota de Remisión es un documento ante Hacienda: siempre con
// confirmación, y la respuesta del servidor se muestra tal cual.
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { emitirNotaRemision, fetchCamiones, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { ESTADO_DOCUMENTO } from '@nucleo/utils/distribucionComun';
import { cargaSinNota, resumenDeCamiones } from '@nucleo/utils/distribucionRutas';
import { formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { signPhotosDeep } from '@nucleo/utils/storageFiles';
import { colorSistema } from '../../Formulario';
import Vidrio from '../../Vidrio';
import Avatar from '../../Avatar';
import Kpi, { FilaDeKpis } from '../../inicio/Kpi';
import { Esqueleto } from '../../inicio/Widget';
import { Aviso, BotonGrande, Campo } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../soloConsulta';
import Etiqueta from './Etiqueta';

const PETROLEO = '#0f6e7d';

function Boton({ texto, color = PETROLEO, lleno = false, onPress, deshabilitado }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center',
        backgroundColor: lleno ? color : `${color}26`, opacity: deshabilitado ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ color: lleno ? '#fff' : color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

function Cifra({ rotulo, valor, fuerte }) {
  return (
    <View style={{ alignItems: 'flex-end', minWidth: 54 }}>
      <Text style={{ color: fuerte ? colorSistema.texto : colorSistema.texto2, fontSize: fuerte ? 16 : 14, fontWeight: fuerte ? '800' : '600', fontVariant: ['tabular-nums'] }}>{valor}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 10 }}>{rotulo}</Text>
    </View>
  );
}

export default function Camiones({ puedeConfigurar }) {
  const [camiones, setCamiones] = useState(null);
  const [error, setError] = useState('');
  const [emitiendo, setEmitiendo] = useState(null);
  const [buscar, setBuscar] = useState('');

  const cargar = useCallback(async () => {
    setError('');
    try {
      const c = await fetchCamiones();
      await signPhotosDeep(c).catch(() => {});
      setCamiones(c);
    } catch (e) {
      setError(mensajeDeDistribucion(e));
    }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const totales = useMemo(() => resumenDeCamiones(camiones), [camiones]);
  const q = buscar.trim();
  const visibles = useMemo(() => (camiones ?? []).map((c) => ({ ...c, lotes: (c.lotes ?? []).filter((l) => !q || tokenMatch(q, l.nombre, l.lote)) })), [camiones, q]);

  const emitir = (c) => {
    Alert.alert('Emitir la Nota de Remisión', `Ampara ante Hacienda la mercadería del camión de ${shortEmployeeName(c.vendedor)}.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Emitir',
        onPress: async () => {
          setEmitiendo(c.carga.id);
          try {
            const r = await emitirNotaRemision(c.carga.id);
            useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_NOTA_REMISION', String(c.carga.id), { estado: r?.estado ?? null, desde: 'app' });
            Alert.alert('Nota de Remisión', r?.numero_control ?? r?.aviso ?? 'Listo.');
            cargar();
          } catch (e) {
            Alert.alert('No se pudo emitir la Nota de Remisión', mensajeDeDistribucion(e));
          } finally {
            setEmitiendo(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={{ gap: 14 }}>
      <FilaDeKpis>
        <Kpi icono="Truck" rotulo="En ruta" color={PETROLEO} valor={camiones ? formatQty(totales.camiones) : '…'} apoyo="Con carga abierta" />
        <Kpi icono="Package" rotulo="Unidades" color={MARCA.azulClaro} valor={camiones ? formatQty(totales.unidades) : '…'} apoyo="Fuera de bodega" />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="FileText" rotulo="Sin Nota de Remisión" color={MARCA.ambar} pide={totales.sinNota > 0}
          valor={camiones ? formatQty(totales.sinNota) : '…'} apoyo="No deberían circular así" />
      </FilaDeKpis>
      {/* Cargar y descargar emiten la Nota de Remisión ante Hacienda: en sólo consulta (soloConsulta.js), desde el portal. */}
      {puedeConfigurar && !ACCIONES_DE_DINERO ? (
        <View style={{ marginHorizontal: 16 }}><SeHaceEnElPortal texto="Cargar y descargar los camiones se hace desde el portal." /></View>
      ) : null}
      {puedeConfigurar && ACCIONES_DE_DINERO ? (
        <View style={{ marginHorizontal: 16 }}>
          <BotonGrande texto="Cargar camión" color={PETROLEO} onPress={() => router.push('/torogoz/camion/cargar')} />
        </View>
      ) : null}
      {(camiones ?? []).some((c) => c.lotes?.length) ? (
        <View style={{ marginHorizontal: 16 }}>
          <Campo multiline={false} value={buscar} onChangeText={setBuscar} placeholder="Buscar producto o lote…" clearButtonMode="while-editing" />
        </View>
      ) : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {camiones === null && !error ? <View style={{ marginHorizontal: 16 }}><Vidrio radio={20}><View style={{ padding: 14 }}><Esqueleto /></View></Vidrio></View> : null}
      {camiones && !camiones.length && !error ? (
        <View style={{ marginHorizontal: 16 }}><Aviso texto="Ningún camión lleva mercadería. Para vender desde el camión, cárgalo primero." /></View>
      ) : null}
      {visibles.map((c) => {
        const sinNota = cargaSinNota(c.carga);
        const est = c.carga?.dte ? ESTADO_DOCUMENTO[c.carga.dte.estado] : null;
        return (
          <View key={c.vendedor_id} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={20}>
              <View style={{ padding: 14, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Avatar empleado={c.vendedor} tamano={38} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{shortEmployeeName(c.vendedor)}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                      {c.carga ? `Cargado el ${fechaNumerica(c.carga.created_at)}` : 'Sin carga abierta'}
                      {c.carga?.dte ? ` · NR ${String(c.carga.dte.numero_control).slice(-6)}` : ''}
                    </Text>
                  </View>
                </View>
                {est || sinNota ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {est ? <Etiqueta variante={est.variant} texto={est.label} /> : null}
                    {sinNota ? <Etiqueta variante="warning" texto="Sin Nota de Remisión" /> : null}
                  </View>
                ) : null}
                {c.lotes.length ? c.lotes.map((l, i) => (
                  <View key={l.lote_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, borderTopWidth: i ? 0.5 : 0.5, borderTopColor: colorSistema.separador }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{l.nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Lote ${l.lote}${l.vence ? ` · vence ${fechaNumerica(l.vence)}` : ''}`}</Text>
                    </View>
                    <Cifra rotulo="cargado" valor={formatQty(Number(l.cargado))} />
                    <Cifra rotulo="vendido" valor={formatQty(Number(l.vendido))} />
                    <Cifra rotulo="queda" valor={formatQty(Number(l.queda))} fuerte />
                  </View>
                )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{q ? 'Ningún producto coincide.' : 'El camión está vacío.'}</Text>}
                {puedeConfigurar && ACCIONES_DE_DINERO ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                    {sinNota ? <Boton texto={emitiendo === c.carga.id ? 'Emitiendo…' : 'Emitir Nota de Remisión'} color={MARCA.ambar} deshabilitado={!!emitiendo} onPress={() => emitir(c)} /> : null}
                    {c.carga && !c.carga.dte ? <Boton texto="Cargar más" onPress={() => router.push(`/torogoz/camion/cargar?vendedor=${c.vendedor_id}`)} /> : null}
                    <Boton texto="Descargar" lleno onPress={() => router.push(`/torogoz/camion/descargar?vendedor=${c.vendedor_id}`)} />
                  </View>
                ) : null}
              </View>
            </Vidrio>
          </View>
        );
      })}
    </View>
  );
}
