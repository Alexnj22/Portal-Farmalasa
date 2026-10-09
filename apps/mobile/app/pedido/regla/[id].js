// La regla de despacho de un producto, NATIVA — el panel de edición de
// `TabReglas`: la presentación en que sale (una por factor), de a cuánto por
// lote, cómo se lista en el papel (CAJA/ESTUCHE/BOLSA), si va como caja
// especial (E1, E2…) y una nota. Abajo, el efecto: ante una necesidad de 7
// unidades, cuánto se despacha.
//
// Las opciones, el payload y la cuenta son del núcleo (`reglasDeDespacho`) y
// la escritura también (`guardarReglaDeDespacho`). En el portal se guarda al
// tocar; acá se arma la regla y se guarda con un botón, porque en el teléfono
// un toque por error no puede cambiar lo que despacha Bodega.
import { volver } from '../../../componentes/volver';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchProductPresentacionesForDispatch, fetchReglaDeProducto, guardarReglaDeDespacho } from '@nucleo/data/dispatchRules';
import { ETIQUETAS_DE_DESPACHO, MULTIPLOS, NECESIDAD_EJEMPLO, calcularDespacho, presentacionesOfrecidas, valoresDeRegla } from '@nucleo/utils/reglasDeDespacho';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../../componentes/formulario/Piezas';
import { MARCA } from '../../../componentes/inicio/marca';
import { fallo, listo } from '../../../componentes/Progreso';

function Ficha({ titulo, detalle, activa, onPress, deshabilitado }) {
  return (
    <Pressable disabled={deshabilitado} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 52, minWidth: 96, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, justifyContent: 'center',
        backgroundColor: activa ? MARCA.violetaClaro : 'rgba(127,127,127,0.16)', opacity: deshabilitado ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color: activa ? '#fff' : colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{titulo}</Text>
      {detalle ? <Text style={{ color: activa ? 'rgba(255,255,255,0.8)' : colorSistema.texto2, fontSize: 12 }}>{detalle}</Text> : null}
    </Pressable>
  );
}

export default function ReglaDeProducto() {
  const { id, nombre, lab } = useLocalSearchParams();
  const productId = Number(id);
  const { hasPermission } = useAuth();
  const puede = hasPermission('pedidos_tab_reglas', 'can_edit');
  const [regla, setRegla] = useState(undefined);
  const [presentaciones, setPresentaciones] = useState(null);
  const [vals, setVals] = useState(null);
  const [otro, setOtro] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchReglaDeProducto(productId);
        setRegla(r);
        setVals(valoresDeRegla(r));
        const { data } = await fetchProductPresentacionesForDispatch(productId, r?.dispatch_id_presentacion);
        setPresentaciones(presentacionesOfrecidas(data ?? [], r?.dispatch_id_presentacion ?? null));
      } catch (e) {
        fallo('No se pudo cargar la regla', mensajeAmigable(e));
        setRegla(null); setVals(valoresDeRegla(null)); setPresentaciones([]);
      }
    })();
  }, [productId]);

  const cambio = useMemo(() => {
    if (!vals) return false;
    const a = valoresDeRegla(regla);
    return JSON.stringify(a) !== JSON.stringify(vals);
  }, [regla, vals]);

  if (regla === undefined || !vals || !presentaciones) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Regla' }} /><ActivityIndicator style={{ marginTop: 40 }} /></>;

  const multiplo = Number(vals.dispatch_multiplo) || 1;
  const elegida = presentaciones.find((p) => p.id_presentacion === vals.dispatch_id_presentacion);
  const tipo = elegida?.presentaciones?.tipo ?? '';
  const { porEtiqueta, cantidad } = calcularDespacho(multiplo, vals.dispatch_label);
  const set = (patch) => { Haptics.selectionAsync().catch(() => {}); setVals((v) => ({ ...v, ...patch })); };

  const guardar = async () => {
    setGuardando(true);
    try {
      const guardada = await guardarReglaDeDespacho(productId, vals, regla);
      const nueva = guardada ? { ...guardada, dispatch_tipo: tipo || null } : null;
      setRegla(nueva);
      setVals(valoresDeRegla(nueva));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(guardada ? 'Regla guardada' : 'Regla quitada', String(nombre ?? ''));
      volver('/pedido/reglas');
    } catch (e) {
      fallo('No se pudo guardar', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };
  const confirmar = () => Alert.alert(vals.dispatch_id_presentacion ? 'Guardar la regla' : 'Quitar la regla',
    vals.dispatch_id_presentacion
      ? `${tipo}${multiplo > 1 ? ` ×${multiplo}` : ''}${vals.dispatch_label ? ` · en el papel como ${vals.dispatch_label}` : ''}${vals.caja_especial ? ' · caja especial' : ''}. Los próximos pedidos salen así.`
      : 'El producto vuelve a salir sin regla de despacho.',
    [{ text: 'Cancelar', style: 'cancel' }, { text: vals.dispatch_id_presentacion ? 'Guardar' : 'Quitar', style: vals.dispatch_id_presentacion ? 'default' : 'destructive', onPress: guardar }]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Regla de despacho', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
        <View style={{ marginHorizontal: 4, gap: 2 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{nombre}</Text>
          {lab ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{lab}</Text> : null}
        </View>
        {!puede ? <Aviso texto="Puedes ver la regla; cambiarla pide permiso de edición en Reglas." /> : null}
        <Seccion titulo="Presentación de despacho">
          {!presentaciones.length ? <Aviso tono="cuidado" texto="Sin presentaciones en catálogo: no se puede asignar regla de despacho." /> : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {presentaciones.map((p) => (
                <Ficha key={p.id_presentacion} titulo={p.presentaciones?.tipo ?? 'DESCONOCIDO'} detalle={p.factor > 1 ? `×${p.factor} unidades` : 'unidad base'}
                  activa={vals.dispatch_id_presentacion === p.id_presentacion} deshabilitado={!puede}
                  onPress={() => set({ dispatch_id_presentacion: vals.dispatch_id_presentacion === p.id_presentacion ? null : p.id_presentacion })} />
              ))}
            </View>
          )}
        </Seccion>
        {vals.dispatch_id_presentacion ? (
          <>
            <Seccion titulo="Por lote" pie={multiplo > 1 ? `Redondea hacia arriba al múltiplo de ${multiplo}.` : 'Sin múltiplo: sale la cantidad exacta.'}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {MULTIPLOS.map((n) => <Ficha key={n} titulo={`×${n}`} activa={multiplo === n} deshabilitado={!puede} onPress={() => { setOtro(''); set({ dispatch_multiplo: String(n) }); }} />)}
              </View>
              <Campo multiline={false} keyboardType="number-pad" editable={puede} placeholder="Otro…" value={MULTIPLOS.includes(multiplo) ? otro : String(multiplo)}
                onChangeText={(t) => { const n = parseInt(t, 10); setOtro(t.replace(/\D/g, '')); if (n > 0) setVals((v) => ({ ...v, dispatch_multiplo: String(n) })); }} />
              <Text style={{ color: colorSistema.texto, fontSize: 15 }}>
                {`Necesidad ${NECESIDAD_EJEMPLO} und. → se despacha `}
                <Text style={{ fontWeight: '800', color: MARCA.violetaClaro }}>{`${cantidad} ${porEtiqueta ? vals.dispatch_label : (tipo ? `pack(s) de ${tipo}` : 'pack(s)')}`}</Text>
              </Text>
            </Seccion>
            <Seccion titulo="Mostrar en el papel como" pie="Sólo para cajas físicas grandes (Electrolit, sueros): se listan aparte, una caja por fila con su lote.">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {ETIQUETAS_DE_DESPACHO.map((l) => <Ficha key={l} titulo={l} activa={vals.dispatch_label === l} deshabilitado={!puede} onPress={() => set({ dispatch_label: vals.dispatch_label === l ? '' : l })} />)}
              </View>
            </Seccion>
            <Seccion titulo="Caja especial">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{vals.caja_especial ? 'Cada unidad lleva su etiqueta E1, E2… independiente.' : 'Viaja en las cajas normales.'}</Text>
                <Switch value={!!vals.caja_especial} disabled={!puede} onValueChange={(on) => set({ caja_especial: on })} />
              </View>
            </Seccion>
          </>
        ) : null}
        <Seccion titulo="Notas internas">
          <Campo value={vals.notes} editable={puede && !!vals.dispatch_id_presentacion} onChangeText={(t) => setVals((v) => ({ ...v, notes: t }))}
            placeholder={vals.dispatch_id_presentacion ? 'Observación opcional…' : 'Elige una presentación primero'} />
        </Seccion>
        {puede ? (
          <View style={{ gap: 10 }}>
            <BotonGrande texto={guardando ? 'Guardando…' : vals.dispatch_id_presentacion ? 'Guardar regla' : 'Quitar regla'}
              color={vals.dispatch_id_presentacion ? MARCA.violetaClaro : MARCA.rojo} deshabilitado={guardando || !cambio} onPress={confirmar} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
