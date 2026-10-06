// Permisos, NATIVO — `PermissionsView` para consultarlo: se elige un cargo y se
// ve, grupo por grupo, a qué módulos entra y qué puede hacer en cada uno (ver,
// gestionar, aprobar, con qué alcance), más las pestañas y capacidades que
// tiene encendidas. Arriba, si es Super Usuario, cuánto aguanta su sesión sin
// uso y su nivel de precio.
//
// El mapa sale del núcleo (`permisosDeCargo`, `cargosNivelANivel`) y el
// catálogo de módulos también (`permissionModules`): lo mismo del portal.
// Cambiar permisos sigue en el portal, donde cada interruptor arrastra a otros.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { fetchRolePermissions, fetchRolesForPermissions } from '@nucleo/data/permissions';
import { MODULE_GROUPS } from '@nucleo/constants/permissionModules';
import { cargosNivelANivel } from '@nucleo/utils/jerarquiaDeCargos';
import { mapaDePermisos, permisoEnPalabras } from '@nucleo/utils/permisosDeCargo';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { MARCA } from '../componentes/inicio/marca';

const CLAVES = MODULE_GROUPS.flatMap((g) => g.modules.flatMap((m) => [m.key, ...(m.sub || []).map((s) => s.key)]));

export default function Permisos() {
  const [roles, setRoles] = useState(null);
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [cargoId, setCargoId] = useState(null);
  const [vista, setVista] = useState('con');
  const [texto, setTexto] = useState('');

  useEffect(() => {
    Promise.all([fetchRolesForPermissions(), fetchRolePermissions()]).then(([r, p]) => {
      if (r.error || p.error) setError((r.error || p.error).message);
      const orden = cargosNivelANivel(r.data || []);
      setRoles(orden);
      setFilas(p.data || []);
      if (orden.length) setCargoId(String(orden[0].id));
    });
  }, []);

  const mapa = useMemo(() => (roles && filas ? mapaDePermisos(filas, roles, CLAVES) : null), [roles, filas]);
  const cargo = (roles || []).find((r) => String(r.id) === cargoId);
  const de = (k) => mapa?.[`${cargoId}:${k}`];
  const grupos = useMemo(() => MODULE_GROUPS.map((g) => ({
    ...g,
    modules: g.modules.filter((m) => (vista === 'todos' || de(m.key)?.can_view) && (!texto.trim() || tokenMatch(texto.trim(), m.label, g.group))),
  })).filter((g) => g.modules.length), [mapa, cargoId, vista, texto]); // eslint-disable-line react-hooks/exhaustive-deps
  const conAcceso = MODULE_GROUPS.reduce((s, g) => s + g.modules.filter((m) => de(m.key)?.can_view).length, 0);
  const filtros = roles?.length ? [{ id: 'cargo', titulo: 'Cargo', activa: cargoId, porDefecto: String(roles[0].id), onCambiar: setCargoId,
    opciones: roles.map((r) => ({ id: String(r.id), label: r.name })) }] : [];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Permisos', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Módulo', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      {filtros.length ? <MenuDeFiltros grupos={filtros} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        {filtros.length ? <FiltrosActivos grupos={filtros} /> : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {!mapa ? <ActivityIndicator style={{ marginTop: 24 }} /> : cargo ? (
          <>
            <View style={{ marginHorizontal: 20, gap: 6 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{cargo.name}</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {cargo.is_su ? <Pildora texto="Super Usuario" color={MARCA.ambar} /> : null}
                <Pildora texto={`${conAcceso} módulos`} color={MARCA.azulClaro} />
                <Pildora texto={`Sesión ${cargo.idle_limit_min ?? 5} min sin uso`} color={MARCA.violeta} />
                {cargo.max_price_level != null ? <Pildora texto={`Precio hasta nivel ${cargo.max_price_level}`} color={MARCA.verde} /> : null}
              </View>
            </View>
            {cargo.is_su ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto="Super Usuario: entra a todo, sin importar lo que diga cada módulo." /></View> : null}
            <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'con', label: 'Con acceso' }, { id: 'todos', label: 'Todos los módulos' }]} />
            {grupos.map((g) => (
              <Seccion key={g.group} titulo={g.group}>
                {g.modules.map((m, i) => {
                  const p = de(m.key);
                  const subs = (m.sub || []).filter((s) => de(s.key)?.can_view);
                  return (
                    <View key={m.key} style={{ gap: 3, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ flex: 1, color: p?.can_view ? colorSistema.texto : colorSistema.texto2, fontSize: 15, fontWeight: '600' }}>{m.label}</Text>
                        {!p?.can_view ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Sin acceso</Text> : null}
                      </View>
                      {p?.can_view ? <Text style={{ color: MARCA.azulClaro, fontSize: 13 }}>{permisoEnPalabras(p, { conAlcance: !!m.hasScope })}</Text> : null}
                      {p?.can_view && subs.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{subs.map((s) => s.label).join(' · ')}</Text> : null}
                    </View>
                  );
                })}
              </Seccion>
            ))}
          </>
        ) : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Cambiar permisos (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/permisos', nombre: 'Permisos' } })} />
        </View>
      </ScrollView>
    </>
  );
}
