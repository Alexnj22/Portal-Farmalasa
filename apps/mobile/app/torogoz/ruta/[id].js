// Torogoz · editar una ruta (o crear una: `/torogoz/ruta/nueva`) — el panel
// «Armar rutas» del portal: nombre, vendedor, días de visita y el orden en que
// se visitan sus clientes. Los clientes se asignan desde su ficha (campo
// Ruta), así que una ruta nueva sale sin orden hasta que tenga clientes.
//
// Guardar pide confirmación: escribe la ruta y, si ya existía, su orden.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchClientesDeRuta, fetchRutas, fetchVendedores, guardarRuta, mensajeDeDistribucion, ordenarRuta } from '@nucleo/data/distribucion';
import { DIAS_RUTA, alternarDia, moverEnLista } from '@nucleo/utils/distribucionRutas';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../../componentes/formulario/Piezas';
import { volver } from '../../../componentes/volver';

const PETROLEO = '#0f6e7d';

function Flecha({ texto, etiqueta, deshabilitado, onPress }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado} accessibilityLabel={etiqueta} hitSlop={6}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(127,127,127,0.16)', opacity: deshabilitado ? 0.25 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function EditarRuta() {
  const { id } = useLocalSearchParams();
  const nueva = id === 'nueva';
  const { hasPermission } = useAuth();
  const puedeConfigurar = !!hasPermission?.('distribucion_config', 'can_edit');
  const [sel, setSel] = useState(nueva ? { id: null, nombre: '', vendedorId: '', dias: [], activo: true } : null);
  const [clientes, setClientes] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setError('');
    try {
      const [rs, vs] = await Promise.all([nueva ? Promise.resolve([]) : fetchRutas(), fetchVendedores()]);
      setVendedores(vs);
      if (!nueva) {
        const r = rs.find((x) => String(x.id) === String(id));
        if (!r) { setError('Esta ruta ya no existe.'); return; }
        setSel({ id: r.id, nombre: r.nombre, vendedorId: r.vendedor_id ?? '', dias: r.dias ?? [], activo: r.activo });
        setClientes(await fetchClientesDeRuta(r.id));
      }
    } catch (e) {
      setError(mensajeDeDistribucion(e));
    }
  }, [id, nueva]);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = () => {
    Alert.alert(nueva ? 'Crear la ruta' : 'Guardar la ruta', `${sel.nombre.trim()}${clientes.length ? ` · ${clientes.length} clientes en este orden` : ''}`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Guardar',
        onPress: async () => {
          setGuardando(true);
          setError('');
          try {
            const nuevoId = await guardarRuta({ id: sel.id, nombre: sel.nombre.trim(), vendedorId: sel.vendedorId, dias: sel.dias, activo: sel.activo });
            if (sel.id && clientes.length) await ordenarRuta(sel.id, clientes.map((c) => c.id));
            useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_RUTA', String(nuevoId), { nombre: sel.nombre.trim(), dias: sel.dias, vendedor: sel.vendedorId || null, desde: 'app' });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            volver('/torogoz/rutas?rutas=armar');
          } catch (e) {
            setError(mensajeDeDistribucion(e));
          } finally {
            setGuardando(false);
          }
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: nueva ? 'Nueva ruta' : (sel?.nombre || 'Ruta'), headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        {!puedeConfigurar ? <Aviso tono="cuidado" texto="Tu cargo no puede armar rutas." /> : null}
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {sel && puedeConfigurar ? (
          <>
            <Seccion titulo="Nombre">
              <Campo multiline={false} value={sel.nombre} placeholder="Ej.: Chalatenango norte" onChangeText={(t) => setSel((s) => ({ ...s, nombre: t }))} />
            </Seccion>
            <Seccion titulo="Se visita" pie="Toca los días en que el vendedor pasa por esta ruta.">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                {DIAS_RUTA.map((d) => {
                  const on = sel.dias.includes(d.n);
                  return (
                    <Pressable key={d.n} accessibilityRole="button" accessibilityState={{ selected: on }}
                      onPress={() => { Haptics.selectionAsync().catch(() => {}); setSel((s) => ({ ...s, dias: alternarDia(s.dias, d.n) })); }}
                      style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: on ? PETROLEO : 'rgba(127,127,127,0.16)', transform: [{ scale: pressed ? 0.94 : 1 }] })}>
                      <Text style={{ color: on ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '800' }}>{d.c}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Seccion>
            <Seccion titulo="Vendedor">
              <Opciones color={PETROLEO} valor={sel.vendedorId || ''} onCambiar={(v) => setSel((s) => ({ ...s, vendedorId: v }))}
                opciones={[{ id: '', label: 'Sin vendedor' }, ...vendedores.map((v) => ({ id: v.id, label: shortEmployeeName(v) }))]} />
            </Seccion>
            {sel.id ? (
              <Seccion titulo={`Orden de visita (${clientes.length} clientes)`} pie={clientes.length ? null : 'Sin clientes. Se asignan desde la ficha del cliente (campo Ruta).'}>
                {clientes.length ? clientes.map((c, i) => (
                  <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <Text style={{ width: 22, color: colorSistema.texto2, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{i + 1}</Text>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }} numberOfLines={1}>{c.nombre}</Text>
                    <Flecha texto="↑" etiqueta={`Subir ${c.nombre}`} deshabilitado={i === 0} onPress={() => setClientes((cs) => moverEnLista(cs, i, -1))} />
                    <Flecha texto="↓" etiqueta={`Bajar ${c.nombre}`} deshabilitado={i === clientes.length - 1} onPress={() => setClientes((cs) => moverEnLista(cs, i, 1))} />
                  </View>
                )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin clientes todavía.</Text>}
              </Seccion>
            ) : null}
            <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar ruta'} color={PETROLEO} deshabilitado={!sel.nombre.trim() || guardando} onPress={guardar} />
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
