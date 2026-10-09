// Carnés del día, NATIVO — `CarnesDelDiaView` para vigilarlos: los carnés de
// papel vivos ahora mismo, agrupados por la sala de quien los tiene, con quién
// lo entregó, por dónde salió y a qué hora vence; y anular uno (con
// confirmación) si se traspapeló. Un carné de papel abre el portal y marca en
// el kiosco igual que el de plástico, por eso importa saber cuántos andan
// sueltos.
//
// La lista sale del núcleo (`carnesDelDia`), la misma del portal. Y emitir
// uno: al escribir un nombre aparecen las personas (como el buscador del
// portal, que filtra las dos mitades a la vez: se ve si ya tiene un carné vivo
// antes de imprimirle otro) y «Imprimir carné» pregunta en qué sala sale y lo
// manda a su caja (`useCarneDePapel`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { anularCarneTemporal, fetchCarnesVigentes } from '@nucleo/data/carneTemporal';
import { carnesConPersona, carnesPorSala } from '@nucleo/utils/carnesDelDia';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { useCarneDePapel } from '../componentes/personas/CarneDePapel';

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
  const imprimir = useCarneDePapel();
  const nombreDeSala = useMemo(() => new Map((sucursales || []).map((b) => [String(b.id), b.name])), [sucursales]);
  // Como el portal: los activos que coinciden, hasta 12.
  const candidatos = useMemo(() => (texto.trim()
    ? (empleados || []).filter((e) => (e.status ?? 'ACTIVO') === 'ACTIVO' && tokenMatch(texto.trim(), e.name, e.first_names, e.last_names, e.role, e.username)).slice(0, 12)
    : []), [texto, empleados]);

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
        {texto.trim() ? (
          <View style={{ gap: 8, marginTop: 8 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20 }}>Imprimir un carné</Text>
            {!candidatos.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>{(empleados || []).length ? 'Nadie con ese nombre. Revisa cómo está escrito en su ficha.' : 'Todavía no se cargó el personal.'}</Text> : null}
            {candidatos.map((e) => (
              <View key={e.id} style={{ marginHorizontal: 16 }}>
                <Vidrio radio={18}>
                  <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar empleado={e} tamano={38} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{shortEmployeeName(e)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{[e.role || 'Sin cargo', nombreDeSala.get(String(e.branchId))].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <Pressable hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}
                      onPress={() => imprimir({ employeeId: e.id, nombre: shortEmployeeName(e), cargo: e.role || '', sala: nombreDeSala.get(String(e.branchId)) || '', motivo: 'Desde Sistema', alTerminar: cargar })}>
                      <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>Imprimir</Text>
                    </Pressable>
                  </View>
                </Vidrio>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <Aviso texto="Para imprimir uno, escribe el nombre de la persona en el buscador." />
          </View>
        )}
      </ScrollView>
    </>
  );
}
