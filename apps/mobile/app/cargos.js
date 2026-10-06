// Cargos, NATIVO — `RolesView`: el organigrama como lista, de la cima hacia
// abajo y sangrado por nivel, con cuántas personas ocupa cada cargo, si es por
// sucursal o global y si es externo; tocar un cargo muestra a quién reporta y
// quiénes lo ocupan. La otra vista es el organigrama DIBUJADO (sólo lectura).
//
// Con el permiso `roles` (Gestionar): «+» crea un cargo y «Editar» en la ficha
// abre el mismo formulario (nombre, ámbito, superior y matricial, límite) con
// «Eliminar», que se frena si el cargo tiene gente o cargos que dependen de él.
//
// La jerarquía, la disposición del dibujo y las reglas de guardar/eliminar
// salen del núcleo (`jerarquiaDeCargos`), las mismas del portal.
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { esCargoExterno, nombreDelSuperior, ocupantesDelCargo, ordenarPorJerarquia, profundidadDeCargo } from '@nucleo/utils/jerarquiaDeCargos';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import EditorDeCargo from '../componentes/sistema/EditorDeCargo';
import Organigrama from '../componentes/sistema/Organigrama';

export default function Cargos() {
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('roles', 'can_edit');
  const roles = useStaffStore((s) => s.roles);
  const empleados = useStaffStore((s) => s.employees);
  const [texto, setTexto] = useState('');
  const [vista, setVista] = useState('lista');
  const [abierto, setAbierto] = useState(null);
  const [editor, setEditor] = useState({ abierto: false, cargo: null });
  const activos = useMemo(() => (empleados || []).filter((e) => (e.status || '').toUpperCase() !== 'INACTIVO'), [empleados]);
  const lista = useMemo(() => ordenarPorJerarquia(roles || [], (roles || []).filter((r) => !texto.trim() || tokenMatch(texto.trim(), r.name))), [roles, texto]);
  const cuantos = useMemo(() => Object.fromEntries((roles || []).map((r) => [r.id, ocupantesDelCargo(activos, r.id).length])), [roles, activos]);
  const elegido = (roles || []).find((r) => r.id === abierto);

  const abrirEditor = (cargo) => { Haptics.selectionAsync().catch(() => {}); setEditor({ abierto: true, cargo }); };

  const ficha = (r, sangria) => {
    const gente = ocupantesDelCargo(activos, r.id);
    const abiertoEste = abierto === r.id;
    return (
      <Pressable key={r.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(abiertoEste ? null : r.id); }}
        style={{ marginLeft: 16 + sangria, marginRight: 16 }}>
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
                {puedeEditar ? (
                  <Pressable onPress={() => abrirEditor(r)} hitSlop={6}
                    style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Editar el cargo</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        </Vidrio>
      </Pressable>
    );
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Cargos', headerLargeTitle: true,
        headerSearchBarOptions: vista === 'lista' ? {
          placeholder: 'Nombre del cargo', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        } : undefined,
      }} />
      <MenuDeFiltros grupos={[]} extra={puedeEditar ? { icono: 'plus', etiqueta: 'Nuevo cargo', onPress: () => abrirEditor(null) } : null} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 8, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'lista', label: 'Lista' }, { id: 'organigrama', label: 'Organigrama' }]} />
        {vista === 'lista' ? (
          <>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${(roles || []).length} cargos · de la cima hacia abajo`}</Text>
            {lista.map((r) => ficha(r, Math.min(profundidadDeCargo(roles, r.id), 5) * 12))}
          </>
        ) : (
          <>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
              Línea continua: superior directo · punteada: matricial. Toca un cargo para ver su ficha.
            </Text>
            <Organigrama roles={roles || []} ocupantes={cuantos} elegido={abierto}
              onTocar={(id) => { Haptics.selectionAsync().catch(() => {}); setAbierto(id); }} />
            {elegido ? ficha(elegido, 0) : null}
          </>
        )}
      </ScrollView>
      <EditorDeCargo abierto={editor.abierto} cargo={editor.cargo} onCerrar={() => setEditor({ abierto: false, cargo: null })} />
    </>
  );
}
