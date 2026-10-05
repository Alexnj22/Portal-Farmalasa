// Cargos, NATIVO — `RolesView` para consultarlo: el organigrama como lista, de
// la cima hacia abajo y sangrado por nivel, con cuántas personas ocupa cada
// cargo, si es por sucursal o global y si es externo. Tocar un cargo muestra a
// quién reporta y quiénes lo ocupan.
//
// La jerarquía sale del núcleo (`jerarquiaDeCargos`), la misma del portal.
// Crear, editar y el organigrama visual siguen en el portal.
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { esCargoExterno, nombreDelSuperior, ocupantesDelCargo, ordenarPorJerarquia, profundidadDeCargo } from '@nucleo/utils/jerarquiaDeCargos';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

export default function Cargos() {
  const roles = useStaffStore((s) => s.roles);
  const empleados = useStaffStore((s) => s.employees);
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(null);
  const activos = useMemo(() => (empleados || []).filter((e) => (e.status || '').toUpperCase() !== 'INACTIVO'), [empleados]);
  const lista = useMemo(() => ordenarPorJerarquia(roles || [], (roles || []).filter((r) => !texto.trim() || tokenMatch(texto.trim(), r.name))), [roles, texto]);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Cargos', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre del cargo', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 8, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${(roles || []).length} cargos · de la cima hacia abajo`}</Text>
        {lista.map((r) => {
          const nivel = profundidadDeCargo(roles, r.id);
          const gente = ocupantesDelCargo(activos, r.id);
          const abiertoEste = abierto === r.id;
          return (
            <Pressable key={r.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(abiertoEste ? null : r.id); }}
              style={{ marginLeft: 16 + Math.min(nivel, 5) * 12, marginRight: 16 }}>
              <Vidrio radio={16} interactivo>
                <View style={{ padding: 12, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{r.name}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${gente.length}${r.max_limit && r.max_limit < 99 ? ` / ${r.max_limit}` : ''}`}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    <Pildora texto={r.scope === 'GLOBAL' ? 'Global' : 'Por sucursal'} color={r.scope === 'GLOBAL' ? MARCA.violeta : MARCA.azulClaro} />
                    {esCargoExterno(r.name) ? <Pildora texto="Externo" color={MARCA.ambar} /> : null}
                  </View>
                  {abiertoEste ? (
                    <View style={{ gap: 6, marginTop: 4 }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                        {`Reporta a ${nombreDelSuperior(roles, r.parent_role_id)}${r.secondary_parent_role_id ? ` y a ${nombreDelSuperior(roles, r.secondary_parent_role_id)}` : ''}`}
                      </Text>
                      {gente.length ? gente.map((e) => (
                        <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Avatar empleado={e} tamano={24} />
                          <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{shortEmployeeName(e)}</Text>
                        </View>
                      )) : <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Nadie ocupa este cargo.</Text>}
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Editar y organigrama (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/cargos', nombre: 'Cargos' } })} />
        </View>
      </ScrollView>
    </>
  );
}
