// Torogoz · descargar camión, NATIVO (el `DescargarModal` de Camiones): se
// cuenta lo que quedó en el camión; lo contado vuelve a bodega y lo que falta
// queda anotado como faltante, con su motivo obligatorio. Cierra la carga.
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { descargarCamion, fetchCamiones, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { cuentaDeDescarga } from '@nucleo/utils/distribucionRutas';
import { formatQty } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../../componentes/formulario/Piezas';
import { MARCA } from '../../../componentes/inicio/marca';
import { volver } from '../../../componentes/volver';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../../../componentes/torogoz/soloConsulta';

const PETROLEO = '#0f6e7d';

export default function DescargarCamion() {
  const { vendedor } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeConfigurar = !!hasPermission?.('distribucion_config', 'can_edit');
  const [camion, setCamion] = useState(null);
  const [contado, setContado] = useState({});
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      const c = (await fetchCamiones()).find((x) => String(x.vendedor_id) === String(vendedor));
      if (!c) { setError('Ese camión ya no tiene carga.'); return; }
      setCamion(c);
      setContado(Object.fromEntries((c.lotes ?? []).filter((l) => Number(l.queda) > 0).map((l) => [l.lote_id, String(l.queda)])));
    } catch (e) {
      setError(mensajeDeDistribucion(e));
    }
  }, [vendedor]);
  useEffect(() => { cargar(); }, [cargar]);

  const cuenta = cuentaDeDescarga(camion?.lotes, contado, nota);

  const descargar = () => {
    Alert.alert('Descargar y cerrar la carga',
      cuenta.faltan > 0 ? `Faltan ${formatQty(cuenta.faltan)} unidades: quedan anotadas como faltante del camión.` : 'Lo contado vuelve a bodega.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Descargar',
          style: cuenta.faltan > 0 ? 'destructive' : 'default',
          onPress: async () => {
            setOcupado(true);
            setError('');
            try {
              const r = await descargarCamion(camion.vendedor_id, cuenta.conAlgo.map((l) => ({ lote_id: l.lote_id, contado: Number(contado[l.lote_id]) })), nota);
              useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_CAMION_DESCARGADO', String(r?.carga_id ?? ''), { vendedor: camion.vendedor_id, ...r, desde: 'app' });
              Haptics.notificationAsync(r?.faltante ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success).catch(() => {});
              Alert.alert('Camión descargado', `${formatQty(r?.devuelto ?? 0)} unidades volvieron a bodega${r?.faltante ? ` · faltan ${formatQty(r.faltante)}` : ''}`,
                [{ text: 'OK', onPress: () => volver('/torogoz/camiones') }]);
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
      <Stack.Screen options={{ ...BARRA_NATIVA, title: camion ? `Descargar · ${shortEmployeeName(camion.vendedor)}` : 'Descargar camión', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        {!puedeConfigurar ? <Aviso tono="cuidado" texto="Tu cargo no puede descargar camiones." /> : null}
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {camion && puedeConfigurar ? (
          <>
            <Seccion titulo="Lo que quedó en el camión" pie="Cuenta lo que quedó. Lo contado vuelve a bodega.">
              {cuenta.conAlgo.length ? cuenta.conAlgo.map((l, i) => {
                const malo = cuenta.malos.includes(l);
                return (
                  <View key={l.lote_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{l.nombre}</Text>
                      <Text style={{ color: malo ? MARCA.rojo : colorSistema.texto2, fontSize: 12 }}>{`Lote ${l.lote} · debería haber ${formatQty(Number(l.queda))}`}</Text>
                    </View>
                    <Campo multiline={false} keyboardType="number-pad" value={contado[l.lote_id] ?? ''} accessibilityLabel={`Contado de ${l.nombre}`}
                      style={{ width: 84, textAlign: 'right', borderWidth: malo ? 1.5 : 0, borderColor: MARCA.rojo }}
                      onChangeText={(t) => setContado((c) => ({ ...c, [l.lote_id]: t.replace(/\D/g, '') }))} />
                  </View>
                );
              }) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>El camión volvió vacío: se cierra la carga.</Text>}
            </Seccion>
            {cuenta.faltan > 0 ? <Aviso tono="cuidado" texto={`Faltan ${formatQty(cuenta.faltan)} unidades: quedan anotadas como faltante del camión.`} /> : null}
            <Seccion titulo={cuenta.faltan > 0 ? '¿Qué pasó con lo que falta?' : 'Nota (opcional)'}>
              <Campo value={nota} onChangeText={setNota} placeholder={cuenta.faltan > 0 ? 'Obligatorio con faltante' : ''} />
            </Seccion>
            {ACCIONES_DE_DINERO
              ? <BotonGrande texto={ocupado ? 'Descargando…' : 'Descargar y cerrar'} color={PETROLEO} deshabilitado={!cuenta.listo || ocupado} onPress={descargar} />
              : <SeHaceEnElPortal texto="Descargar el camión se hace desde el portal." />}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
