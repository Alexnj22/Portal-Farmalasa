// Buscar: la búsqueda de TODA la app, en su propia pestaña de la barra —la de
// iOS 26, separada de las demás, como en Música o App Store— (decisión del
// usuario del 2026-09-30). Cada pantalla conserva además su buscador propio
// para su lista; éste encuentra cualquier cosa desde un solo lugar:
//
//   · Productos  — cuánto hay y en qué salas (`buscar_inventario_global_v2`,
//                  el mismo del portal); abre la ficha nativa del producto.
//   · Personas   — del maestro de personal; abre su ficha.
//   · Solicitudes— las que ya están en memoria (la bandeja las carga).
//   · Pantallas  — los módulos que el cargo puede abrir, con las mismas
//                  reglas del Menú.
//
// Cada grupo respeta el permiso de su módulo: buscar no puede ser una puerta
// trasera a lo que el menú no muestra.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { smartFilter, tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { buscarInventarioGlobalV2, MAX_PRODUCTOS_BUSQUEDA } from '@nucleo/data/inventory';
import { MIN_LETRAS_BUSQUEDA, resumirPorProducto } from '@nucleo/utils/consultaInventario';
import { MODULE_MAP } from '@nucleo/constants/moduleMap';
import { MENU_GROUPS, gruposVisibles } from '@nucleo/constants/menuGroups';
import { REQUEST_TYPES } from '@nucleo/store/slices/requestsSlice';
import { formatQty } from '@nucleo/utils/formatNumber';
import { colorSistema } from '../../../componentes/Formulario';
import Avatar from '../../../componentes/Avatar';
import Vidrio from '../../../componentes/Vidrio';
import { useTema } from '../../../tema/tema';
import { iconoDe } from '../../../tema/iconos';
import { abrirModulo, abrirRuta, abrirSolicitud } from '../../../pantallas';

const POR_GRUPO = 5;

function Grupo({ titulo, children, pie }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginHorizontal: 32 }}>{titulo}</Text>
      <View style={{ marginHorizontal: 16 }}><Vidrio radio={22}>{children}</Vidrio></View>
      {pie ? <Text style={{ color: colorSistema.texto2, fontSize: 12, marginHorizontal: 32 }}>{pie}</Text> : null}
    </View>
  );
}

function Renglon({ primero, izquierda, titulo, detalle, derecha, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10,
      backgroundColor: pressed ? colorSistema.separador : 'transparent',
    })}>
      {izquierda}
      <View style={{ flex: 1, gap: 1, paddingVertical: 2, borderTopWidth: primero ? 0 : 0 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16 }} numberOfLines={1}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{detalle}</Text> : null}
      </View>
      {derecha ? <Text style={{ color: colorSistema.texto2, fontSize: 15, fontVariant: ['tabular-nums'] }}>{derecha}</Text> : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text>
    </Pressable>
  );
}

const Separador = () => <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 66 }} />;

export default function Buscar() {
  const { hasPermission } = useAuth();
  const tema = useTema();
  const empleados = useStaffStore((s) => s.employees);
  const solicitudes = useStaffStore((s) => s.requests);
  const [texto, setTexto, aplicado] = useBusqueda();
  const [productos, setProductos] = useState({ cargando: false, lista: [], total: 0, error: null });

  const veProductos = hasPermission('inventario') || hasPermission('traslados');
  const vePersonas = hasPermission('staff_list');
  const q = aplicado.trim();

  useEffect(() => {
    if (!veProductos || q.length < MIN_LETRAS_BUSQUEDA) { setProductos({ cargando: false, lista: [], total: 0, error: null }); return undefined; }
    let vivo = true;
    setProductos((p) => ({ ...p, cargando: true }));
    buscarInventarioGlobalV2(q, MAX_PRODUCTOS_BUSQUEDA).then((r) => {
      if (vivo) setProductos({ cargando: false, lista: resumirPorProducto(r.filas), total: r.total, error: r.error });
    });
    return () => { vivo = false; };
  }, [q, veProductos]);

  const modulos = useMemo(() => gruposVisibles(MENU_GROUPS, MODULE_MAP, (k) => hasPermission(k))
    .flatMap((g) => g.visibleModules), [hasPermission]);

  // Las pantallas, por palabra exacta: un nombre de pantalla es corto y la
  // coincidencia aproximada traía «Actualización de datos» buscando «acet».
  const pantallas = q ? modulos.filter((m) => tokenMatch(q, m.label)).slice(0, POR_GRUPO) : [];
  const personas = q && vePersonas
    ? smartFilter(q, (empleados || []).filter((e) => e.is_active !== false), (e) => [e.name, e.code]).results.slice(0, POR_GRUPO) : [];
  const deSolicitudes = q
    ? smartFilter(q, solicitudes || [], (r) => [r.employee?.name, REQUEST_TYPES[r.type]?.label, r.metadata?.correlativo, r.metadata?.producto]).results.slice(0, POR_GRUPO) : [];

  const nada = q.length >= MIN_LETRAS_BUSQUEDA && !productos.cargando
    && !pantallas.length && !personas.length && !deSolicitudes.length && !productos.lista.length;

  return (
    <>
      <Stack.Screen options={{
        headerSearchBarOptions: {
          placeholder: 'Productos, personas, pantallas…',
          autoCapitalize: 'none',
          onChangeText: (e) => setTexto(e.nativeEvent.text),
          onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 22 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
        {!q ? (
          <View style={{ alignItems: 'center', paddingTop: 60, gap: 8, paddingHorizontal: 40 }}>
            <Host matchContents><Icon name={iconoDe('Search')} size={40} color={colorSistema.texto2} /></Host>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>Busca en todo el portal</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>
              {[veProductos && 'productos y existencias', vePersonas && 'personas', 'solicitudes', 'pantallas'].filter(Boolean).join(', ')}.
            </Text>
          </View>
        ) : null}

        {pantallas.length ? (
          <Grupo titulo="Pantallas">
            {pantallas.map((m, i) => (
              <View key={m.key}>
                {i ? <Separador /> : null}
                <Renglon titulo={m.label} onPress={() => abrirModulo(m)}
                  izquierda={<View style={{ width: 40, alignItems: 'center' }}><Host matchContents><Icon name={iconoDe(m.icono)} size={22} color={tema.color.marca} /></Host></View>} />
              </View>
            ))}
          </Grupo>
        ) : null}

        {veProductos && q.length >= MIN_LETRAS_BUSQUEDA ? (
          productos.cargando && !productos.lista.length ? <ActivityIndicator /> : productos.lista.length ? (
            <Grupo titulo="Productos" pie={productos.total > productos.lista.length ? `Se muestran ${productos.lista.length} de ${productos.total}. Escribe más para afinar.` : null}>
              {productos.lista.map((p, i) => (
                <View key={p.erp_product_id ?? p.descripcion}>
                  {i ? <Separador /> : null}
                  <Renglon titulo={p.descripcion}
                    detalle={p.salas.length ? p.salas.map((s) => s.sala).join(' · ') : 'Sin existencias'}
                    derecha={formatQty(p.unidades)}
                    izquierda={<View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colorSistema.acentoTinte, alignItems: 'center', justifyContent: 'center' }}>
                      <Host matchContents><Icon name={iconoDe('Package')} size={20} color={colorSistema.acento} /></Host></View>}
                    onPress={() => p.erp_product_id && router.push({ pathname: '/producto/[id]', params: { id: String(p.erp_product_id), nombre: p.descripcion } })} />
                </View>
              ))}
            </Grupo>
          ) : null
        ) : null}

        {personas.length ? (
          <Grupo titulo="Personas">
            {personas.map((e, i) => (
              <View key={e.id}>
                {i ? <Separador /> : null}
                <Renglon titulo={shortEmployeeName(e)} detalle={e.role_name ?? e.roleName ?? e.role ?? null}
                  izquierda={<Avatar empleado={e} tamano={40} />}
                  onPress={() => abrirRuta(`/personal/empleado/${e.id}`)} />
              </View>
            ))}
          </Grupo>
        ) : null}

        {deSolicitudes.length ? (
          <Grupo titulo="Solicitudes">
            {deSolicitudes.map((r, i) => (
              <View key={r.id}>
                {i ? <Separador /> : null}
                <Renglon titulo={REQUEST_TYPES[r.type]?.label ?? 'Solicitud'} detalle={shortEmployeeName(r.employee)}
                  izquierda={<Avatar empleado={r.employee} tamano={40} />}
                  onPress={() => abrirSolicitud(r.id)} />
              </View>
            ))}
          </Grupo>
        ) : null}

        {q && q.length < MIN_LETRAS_BUSQUEDA && !pantallas.length && !personas.length ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 30 }}>Escribe al menos {MIN_LETRAS_BUSQUEDA} letras.</Text>
        ) : null}
        {nada ? (
          <View style={{ alignItems: 'center', paddingTop: 50, gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>Sin resultados para «{q}»</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Revisa la ortografía o prueba otra palabra.</Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
