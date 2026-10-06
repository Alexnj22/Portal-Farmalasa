// Permisos, NATIVO — `PermissionsView`: se elige un cargo y se ve, grupo por
// grupo, a qué módulos entra y qué puede hacer en cada uno; con el permiso
// `permissions` (Gestionar) se EDITA ahí mismo: Ver / Gestionar / Aprobar, el
// alcance (Todos / Mi sucursal / Sólo míos) y las pestañas y capacidades de
// cada módulo. Arriba: Super Usuario, cuánto aguanta su sesión sin uso, el
// nivel de precio máximo (con su rótulo, no la clave) y «Copiar desde…».
//
// Cada interruptor ARRASTRA a otros —apagar «Ver» apaga sus pestañas, los
// widgets van con «Inicio», el maestro de Aprobar con sus familias—, y esa
// cascada sale del núcleo (`planDeCambioDePermiso`), la MISMA del portal. Se
// guarda con las funciones del núcleo que anotan la bitácora solas
// (`guardarPermisoDeCargo`, `copiarPermisosDeCargo`, …): quién le dio acceso a
// quién queda registrado también desde el teléfono.
//
// Lo que se pinta cambia antes de que conteste el servidor; si la escritura
// falla, se recarga del servidor (la pantalla nunca muestra un permiso que
// nadie guardó).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  fetchRolePermissions, fetchRolesForPermissions, guardarPermisoDeCargo, upsertRolePermission, upsertRolePermissionsBulk,
  cambiarNivelDePrecioDeCargo, cambiarSuperUsuarioDeCargo, cambiarTiempoDeInactividadDeCargo, copiarPermisosDeCargo,
} from '@nucleo/data/permissions';
import { MODULE_GROUPS } from '@nucleo/constants/permissionModules';
import { cargosNivelANivel } from '@nucleo/utils/jerarquiaDeCargos';
import {
  MAX_INACTIVIDAD, MIN_INACTIVIDAD, ROTULO_ALCANCE, filasCopiadasDe, mapaDePermisos, permisoEnPalabras, planDeCambioDePermiso,
} from '@nucleo/utils/permisosDeCargo';
import { NIVELES_DE_PRECIO } from '@nucleo/utils/preciosDeProducto';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { Elegir, Interruptor } from '../componentes/personas/Formulario';
import { fallo, listo } from '../componentes/Progreso';

const CLAVES = MODULE_GROUPS.flatMap((g) => g.modules.flatMap((m) => [m.key, ...(m.sub || []).map((s) => s.key)]));
const OPCIONES_INACTIVIDAD = [5, 10, 15, 30, 60, 120, 240, 480, 720, 1440];
const enPalabras = (min) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`);

/** Una pastilla que se prende y se apaga (Gestionar, Aprobar, un alcance). */
function Chip({ texto, activo, onPress, deshabilitado, color = MARCA.azulClaro }) {
  return (
    <Pressable disabled={deshabilitado} onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} hitSlop={4}
      style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center',
        backgroundColor: activo ? `${color}38` : 'rgba(127,127,127,0.14)', borderWidth: 1, borderColor: activo ? color : 'transparent',
        opacity: deshabilitado ? 0.5 : pressed ? 0.7 : 1 })}>
      <Text style={{ color: activo ? colorSistema.texto : colorSistema.texto2, fontSize: 13, fontWeight: activo ? '700' : '500' }}>{texto}</Text>
    </Pressable>
  );
}

export default function Permisos() {
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('permissions', 'can_edit');
  const [roles, setRoles] = useState(null);
  const [mapa, setMapa] = useState(null);
  const [error, setError] = useState('');
  const [cargoId, setCargoId] = useState(null);
  const [vista, setVista] = useState('con');
  const [texto, setTexto] = useState('');
  const [guardando, setGuardando] = useState(null);

  const cargar = useCallback(async () => {
    const [r, p] = await Promise.all([fetchRolesForPermissions(), fetchRolePermissions()]);
    if (r.error || p.error) setError((r.error || p.error).message);
    const orden = cargosNivelANivel(r.data || []);
    setRoles(orden);
    setMapa(mapaDePermisos(p.data || [], orden, CLAVES));
    setCargoId((c) => c ?? (orden.length ? String(orden[0].id) : null));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const cargo = (roles || []).find((r) => String(r.id) === cargoId);
  const roleId = cargo?.id;
  const de = (k) => mapa?.[`${cargoId}:${k}`];
  const contexto = { cargo: cargo?.name, desde: 'app' };
  const bloqueado = !puedeEditar || !!guardando;

  const grupos = useMemo(() => MODULE_GROUPS.map((g) => ({
    ...g,
    modules: g.modules.filter((m) => (vista === 'todos' || de(m.key)?.can_view) && (!texto.trim() || tokenMatch(texto.trim(), m.label, g.group, ...(m.sub || []).map((s) => s.label)))),
  })).filter((g) => g.modules.length), [mapa, cargoId, vista, texto]); // eslint-disable-line react-hooks/exhaustive-deps
  const conAcceso = MODULE_GROUPS.reduce((s, g) => s + g.modules.filter((m) => de(m.key)?.can_view).length, 0);
  const filtros = roles?.length ? [{ id: 'cargo', titulo: 'Cargo', activa: cargoId, porDefecto: String(roles[0].id), onCambiar: setCargoId,
    opciones: roles.map((r) => ({ id: String(r.id), label: r.name })) }] : [];

  // ── Cambiar un permiso, con su cascada ──
  const cambiar = async (moduleKey, permType, value) => {
    if (bloqueado || !roleId) return;
    const plan = planDeCambioDePermiso({ permisos: mapa, roleId, moduleKey, permType, value, moduleGroups: MODULE_GROUPS });
    setMapa(plan.estado);
    setGuardando(moduleKey);
    const { error: e } = await guardarPermisoDeCargo(plan.principal, {
      ...contexto, permiso: permType, valor: value, arrastro: plan.arrastra.length || undefined,
      inicio: plan.inicioPasaA === null ? undefined : (plan.inicioPasaA ? 'encendido' : 'apagado'),
    });
    let falla = e;
    if (!falla && plan.cascada.length) falla = (await upsertRolePermissionsBulk(plan.cascada)).error;
    if (!falla && plan.apagadas.length) falla = (await upsertRolePermissionsBulk(plan.apagadas)).error;
    if (!falla && plan.inicio) falla = (await upsertRolePermission(plan.inicio)).error;
    setGuardando(null);
    if (falla) { fallo('No se pudo guardar', mensajeAmigable(falla)); cargar(); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const cambiarRol = (campo, valor) => setRoles((rs) => rs.map((r) => (r.id === roleId ? { ...r, [campo]: valor } : r)));
  const alternarSU = (valor) => {
    const hacer = async () => {
      setGuardando('su');
      cambiarRol('is_su', valor);
      const { error: e } = await cambiarSuperUsuarioDeCargo(roleId, valor, contexto);
      setGuardando(null);
      if (e) { fallo('No se pudo cambiar', mensajeAmigable(e)); cargar(); } else listo(valor ? 'Ahora es Super Usuario' : 'Ya no es Super Usuario', cargo.name);
    };
    if (valor) {
      Alert.alert('¿Hacerlo Super Usuario?', `Todo el que tenga el cargo «${cargo.name}» entrará a todos los módulos, sin importar lo que diga cada uno.`, [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Sí, dar acceso total', style: 'destructive', onPress: hacer },
      ]);
    } else hacer();
  };
  const cambiarInactividad = async (v) => {
    const n = Number(v);
    if (!(n >= MIN_INACTIVIDAD && n <= MAX_INACTIVIDAD)) return;
    const antes = cargo.idle_limit_min ?? 5;
    setGuardando('idle');
    cambiarRol('idle_limit_min', n);
    const { error: e } = await cambiarTiempoDeInactividadDeCargo(roleId, n, contexto);
    setGuardando(null);
    if (e) { cambiarRol('idle_limit_min', antes); fallo('No se pudo cambiar el tiempo', mensajeAmigable(e)); }
  };
  const cambiarPrecio = async (v) => {
    const nivel = v || null;
    setGuardando('precio');
    cambiarRol('max_price_level', nivel);
    const { error: e } = await cambiarNivelDePrecioDeCargo(roleId, nivel, contexto);
    setGuardando(null);
    if (e) { fallo('No se pudo cambiar el nivel', mensajeAmigable(e)); cargar(); }
  };
  const copiarDesde = (desdeId) => {
    const desde = roles.find((r) => String(r.id) === String(desdeId));
    if (!desde) return;
    Alert.alert(`¿Copiar los permisos de «${desde.name}»?`, `«${cargo.name}» queda con exactamente los mismos accesos y nivel de precio; lo que tenía y el otro no, se apaga.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Copiar', style: 'destructive', onPress: async () => {
        setGuardando('copiar');
        const filas = filasCopiadasDe(mapa, desde.id, roleId, MODULE_GROUPS);
        const { error: e } = await copiarPermisosDeCargo(roleId, filas, desde.max_price_level ?? null, { ...contexto, desde: desde.name });
        setGuardando(null);
        if (e) fallo('No se pudo copiar', mensajeAmigable(e)); else listo('Permisos copiados', `de ${desde.name}`);
        cargar();
      } },
    ]);
  };

  const opcionesPrecio = [{ id: '', label: 'Sin límite (todos los precios)' }, ...NIVELES_DE_PRECIO.map((n) => ({ id: n.key, label: n.label }))];
  const minutos = cargo?.idle_limit_min ?? 5;
  const opcionesTiempo = [...new Set([...OPCIONES_INACTIVIDAD, minutos])].sort((a, b) => a - b).map((n) => ({ id: String(n), label: enPalabras(n) }));

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Permisos', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Módulo o pestaña', hideWhenScrolling: false,
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
                {guardando ? <Pildora texto="Guardando…" color={MARCA.violetaClaro} /> : null}
              </View>
            </View>
            {!puedeEditar ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Sólo consulta: tu cargo no puede cambiar permisos." /></View> : null}

            <View style={{ marginHorizontal: 16 }}>
              <Seccion titulo="El cargo">
                <Interruptor primero titulo="Super Usuario" detalle="Entra a todo, sin importar lo que diga cada módulo." valor={!!cargo.is_su} onCambiar={alternarSU} deshabilitado={bloqueado} />
                <Elegir rotulo="Cerrar la sesión sin uso después de" valor={String(minutos)} opciones={opcionesTiempo} onCambiar={cambiarInactividad} deshabilitado={bloqueado} />
                <Elegir rotulo="Nivel de precio máximo" valor={cargo.max_price_level ?? ''} opciones={opcionesPrecio} onCambiar={cambiarPrecio} deshabilitado={bloqueado} />
                {puedeEditar ? (
                  <Elegir rotulo="Copiar los permisos de otro cargo" valor="" vacio="Elegir cargo…"
                    opciones={roles.filter((r) => r.id !== roleId).map((r) => ({ id: String(r.id), label: r.name }))} onCambiar={(v) => v && copiarDesde(v)} deshabilitado={bloqueado} />
                ) : null}
              </Seccion>
            </View>
            {cargo.is_su ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto="Super Usuario: lo de abajo no lo limita mientras esté encendido." /></View> : null}

            <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'con', label: 'Con acceso' }, { id: 'todos', label: 'Todos los módulos' }]} />
            {grupos.map((g) => (
              <View key={g.group} style={{ marginHorizontal: 16 }}>
                <Seccion titulo={g.group}>
                  {g.modules.map((m, i) => {
                    const p = de(m.key) || {};
                    const subs = m.sub || [];
                    return (
                      <View key={m.key} style={{ gap: 8, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: p.can_view ? colorSistema.texto : colorSistema.texto2, fontSize: 15, fontWeight: '600' }}>{m.label}</Text>
                            {p.can_view ? <Text style={{ color: MARCA.azulClaro, fontSize: 12 }}>{permisoEnPalabras(p, { conAlcance: !!m.hasScope })}</Text> : null}
                          </View>
                          <Switch value={!!p.can_view} onValueChange={(v) => cambiar(m.key, 'can_view', v)} disabled={bloqueado} />
                        </View>
                        {p.can_view ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                            <Chip texto="Gestionar" activo={!!p.can_edit} onPress={() => cambiar(m.key, 'can_edit', !p.can_edit)} deshabilitado={bloqueado} />
                            {m.hasApprove ? <Chip texto="Aprobar" activo={!!p.can_approve} color={MARCA.verde} onPress={() => cambiar(m.key, 'can_approve', !p.can_approve)} deshabilitado={bloqueado} /> : null}
                          </View>
                        ) : null}
                        {p.can_view && m.hasScope ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                            <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>ALCANCE</Text>
                            {Object.entries(ROTULO_ALCANCE).map(([v, l]) => (
                              <Chip key={v} texto={l} activo={(p.scope || 'ALL') === v} color={MARCA.violetaClaro} onPress={() => cambiar(m.key, 'scope', v)} deshabilitado={bloqueado} />
                            ))}
                          </View>
                        ) : null}
                        {p.can_view && subs.length ? (
                          <View style={{ gap: 4, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: colorSistema.separador }}>
                            {subs.map((s) => {
                              const ps = de(s.key) || {};
                              return (
                                <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 }}>
                                  <Text style={{ flex: 1, color: ps.can_view ? colorSistema.texto : colorSistema.texto2, fontSize: 14 }}>{s.label}</Text>
                                  <Switch value={!!ps.can_view} onValueChange={(v) => cambiar(s.key, 'can_view', v)} disabled={bloqueado} />
                                </View>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </Seccion>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
