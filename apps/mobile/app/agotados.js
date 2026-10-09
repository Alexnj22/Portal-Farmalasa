// Agotados que venden, NATIVO — la pestaña «Agotados» de Min·Máx del portal
// (`views/productos/TabQuiebres.jsx`): lo que la sala no tiene y sí vende.
// El inventario muestra lo que HAY; un agotado no tiene fila y no aparece en
// ninguna pantalla. Ésta es la lista que lo hace visible, con cuántos días lleva
// en cero, la última venta, su Min·Máx y si ya reingresó.
//
// Las cuentas y los filtros salen del núcleo (`resumenDeQuiebres`,
// `filtrarQuiebres`), los mismos del portal. «Con Min/Max» viene puesto: es lo
// que la sala YA decidió tener y no tiene. Con alcance de una sala manda la
// suya. Tocar un producto abre su Mín·Máx.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchQuiebresSala } from '@nucleo/data/stockParams';
import { filtrarQuiebres, resumenDeQuiebres } from '@nucleo/utils/quiebres';
import { BRANCH_A_ERP, ERP_BODEGA, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { formatQty } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { MenuDeFiltros, FiltrosActivos } from '../componentes/Filtros';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { ErrorConReintento, useColumnas } from '../componentes/ListaPaginada';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import { MARCA } from '../componentes/inicio/marca';

const SALAS = ERP_ORDEN.filter((id) => id !== ERP_BODEGA);
const fecha = (d) => (d ? fechaTexto(d, { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

// Una sala puede tener cientos de agotados: la lista es virtualizada y cada
// fila memoizada, así escribir en el buscador no repinta las que no cambian.
const Fila = memo(function Fila({ f, diasFoto, columnas }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/minmax-producto', params: { producto: String(f.erp_product_id), nombre: f.descripcion } }); }}
      style={({ pressed }) => ({ ...(columnas > 1 ? { flex: 1 / columnas } : { marginHorizontal: 16 }), marginTop: 12, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={18} interactivo>
        <View style={{ padding: 14, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.descripcion}</Text>
            {f.abc_class ? <Pildora texto={f.abc_class} color={MARCA.violetaClaro} /> : null}
            <Pildora texto={f.hay_ahora ? 'Ya reingresó' : 'Sigue en cero'} color={f.hay_ahora ? MARCA.verde : MARCA.rojo} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{f.dias_sin}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`de ${diasFoto} días sin existencia`}</Text>
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {[`Última venta ${fecha(f.ultima_venta)}`, f.max_units > 0 ? `Min·Máx ${formatQty(f.min_units)} · ${formatQty(f.max_units)}` : 'sin Min·Máx asignado'].join(' · ')}
          </Text>
        </View>
      </Vidrio>
    </Pressable>
  );
});

export default function Agotados() {
  const { user, getScope } = useAuth();
  const todas = getScope?.('minmax') === 'ALL';
  const miErp = BRANCH_A_ERP[Number(salaDelUsuario(user))] ?? null;
  const [elegida, setElegida] = useState(String(miErp && SALAS.includes(miErp) ? miErp : SALAS[0]));
  const erp = todas ? Number(elegida) : (miErp ?? SALAS[0]);
  const [resp, setResp] = useState(null);
  const [texto, setTexto] = useState('');
  const [conMinMax, setConMinMax] = useState('si');
  const [estado, setEstado] = useState('todos');
  const [recargando, setRecargando] = useState(false);
  const columnas = useColumnas();

  const cargar = useCallback(async () => {
    const { data, error } = await fetchQuiebresSala(erp, 30);
    setResp(error ? { dias_foto: 0, filas: [], error: error.message } : data);
  }, [erp]);
  useEffect(() => { setResp(null); cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al cambiar de sala

  const diasFoto = resp?.dias_foto ?? 0;
  const resumen = useMemo(() => resumenDeQuiebres(resp?.filas, diasFoto), [resp, diasFoto]);
  const visibles = useMemo(() => filtrarQuiebres(resp?.filas, {
    diasFoto, soloConMinMax: conMinMax === 'si', soloSinNada: estado === 'nunca', busca: texto,
  }).filter((f) => estado !== 'reingreso' || f.hay_ahora), [resp, diasFoto, conMinMax, estado, texto]);

  const grupos = [
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: elegida, porDefecto: elegida, onCambiar: setElegida,
      opciones: SALAS.map((id) => ({ id: String(id), label: ERP_NAMES[id] })) }] : []),
    { id: 'minmax', titulo: 'Min·Máx', activa: conMinMax, porDefecto: 'si', onCambiar: setConMinMax,
      opciones: [{ id: 'si', label: 'Sólo con Min·Máx' }, { id: 'todos', label: 'También sin asignar' }] },
    { id: 'estado', titulo: 'Estado', activa: estado, porDefecto: 'todos', onCambiar: setEstado,
      opciones: [{ id: 'todos', label: 'Todos' }, { id: 'nunca', label: 'Nunca hubo' }, { id: 'reingreso', label: 'Ya reingresó' }] },
  ];
  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Agotados', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Buscar producto', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto('') },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <FlatList key={`c${columnas}`} numColumns={columnas} columnWrapperStyle={columnas > 1 ? { gap: 10, paddingHorizontal: 16 } : undefined}
        data={resp == null || resp.error ? [] : visibles} keyExtractor={(f) => String(f.erp_product_id)}
        renderItem={({ item }) => <Fila f={item} diasFoto={diasFoto} columnas={columnas} />}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" initialNumToRender={12} windowSize={9}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}
        ListHeaderComponent={(
          <View style={{ gap: 12 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 20 }}>{`${ERP_NAMES[erp]} · lo que no hay y sí se vende`}</Text>
            <FiltrosActivos grupos={grupos.filter((g) => g.id !== 'sala')} />
            {resp?.error ? <ErrorConReintento mensaje={resp.error} onReintentar={() => { setResp(null); cargar(); }} /> : null}
            {resp == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : resp.error ? null : (
              <>
                <FilaDeKpis>
                  <Kpi icono="PackageMinus" rotulo="Agotados" valor={formatQty(resumen.total)} color={MARCA.rojo} apoyo={`en ${diasFoto} día${diasFoto === 1 ? '' : 's'} mirados`}
                    onPress={() => setEstado('todos')} />
                  <Kpi icono="Ban" rotulo="Nunca hubo" valor={formatQty(resumen.sinNada)} color={MARCA.ambar} apoyo="ni un día con existencia"
                    onPress={() => setEstado(estado === 'nunca' ? 'todos' : 'nunca')} />
                </FilaDeKpis>
                <FilaDeKpis>
                  <Kpi icono="RefreshCw" rotulo="Ya reingresó" valor={formatQty(resumen.reingreso)} color={MARCA.verde} apoyo="hay existencia ahora"
                    onPress={() => setEstado(estado === 'reingreso' ? 'todos' : 'reingreso')} />
                </FilaDeKpis>
              </>
            )}
          </View>
        )}
        ListEmptyComponent={resp == null || resp.error ? null : (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24, marginHorizontal: 24 }}>
            {texto.trim() || estado !== 'todos' || conMinMax !== 'si' ? 'Nada coincide con el filtro.' : `Sin agotados con venta reciente en ${ERP_NAMES[erp]}.`}
          </Text>
        )} />
    </>
  );
}
