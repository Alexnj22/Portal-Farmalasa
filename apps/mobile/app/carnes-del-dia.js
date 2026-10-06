// Carnés del día, NATIVO — `CarnesDelDiaView` para vigilarlos: los carnés de
// papel vivos ahora mismo, agrupados por la sala de quien los tiene, con quién
// lo entregó, por dónde salió y a qué hora vence; y anular uno (con
// confirmación) si se traspapeló. Un carné de papel abre el portal y marca en
// el kiosco igual que el de plástico, por eso importa saber cuántos andan
// sueltos.
//
// La lista sale del núcleo (`carnesDelDia`), la misma del portal. Imprimir uno
// necesita la ticketera de una computadora: sigue en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { anularCarneTemporal, fetchCarnesVigentes } from '@nucleo/data/carneTemporal';
import { carnesConPersona, carnesPorSala } from '@nucleo/utils/carnesDelDia';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { hora12 } from '@nucleo/utils/hora';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

export default function CarnesDelDia() {
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const [vigentes, setVigentes] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState('');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchCarnesVigentes();
    setError(e ? 'No se pudo leer la lista.' : null);
    setVigentes(e ? [] : (data || []));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(() => carnesConPersona(vigentes, empleados, sucursales)
    .filter((c) => !texto.trim() || tokenMatch(texto.trim(), c.nombre, c.sala, c.loEntrego)), [vigentes, empleados, sucursales, texto]);
  const grupos = carnesPorSala(filas);

  const anular = (c) => Alert.alert('¿Anular este carné?', `El papel de ${c.nombre} deja de servir de inmediato. Si lo necesita, se imprime otro.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Anular', style: 'destructive', onPress: async () => {
      trabajando('Anulando…');
      const r = await anularCarneTemporal(c.id, { employeeId: c.employee_id });
      if (r?.ok) listo('Carné anulado', `El papel de ${c.nombre} ya no sirve.`); else fallo('No se anuló', r?.motivo || 'Intenta de nuevo.');
      cargar();
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Carnés del día', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Persona, sala o quién lo entregó', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {vigentes ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{vigentes.length ? `${vigentes.length} carné${vigentes.length === 1 ? '' : 's'} de papel vivo${vigentes.length === 1 ? '' : 's'} · vencen solos a medianoche` : ''}</Text> : null}
        {vigentes == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : grupos.map((g) => (
          <View key={g.sala} style={{ gap: 8 }}>
            {grupos.length > 1 ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20, marginTop: 4 }}>{`${g.sala} · ${g.items.length}`}</Text> : null}
            {g.items.map((c) => (
              <View key={c.id} style={{ marginHorizontal: 16 }}>
                <Vidrio radio={18}>
                  <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar empleado={c.empleado ?? { name: c.nombre }} tamano={38} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{c.nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{[c.cargo, `lo entregó ${c.loEntrego}`].filter(Boolean).join(' · ')}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={2}>{`Salió por: ${c.impresoEn} · vence ${hora12(c.vence_el)}`}</Text>
                    </View>
                    <Pressable onPress={() => anular(c)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}>
                      <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Anular</Text>
                    </Pressable>
                  </View>
                </Vidrio>
              </View>
            ))}
          </View>
        ))}
        {vigentes && !filas.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{texto.trim() ? 'Nadie con ese nombre tiene un carné vivo' : 'Nadie tiene un carné de papel hoy'}</Text> : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Imprimir un carné (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/carnes-del-dia', nombre: 'Carnés del día' } })} />
        </View>
      </ScrollView>
    </>
  );
}
