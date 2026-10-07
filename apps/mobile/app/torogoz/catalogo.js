// Torogoz · Catálogo, NATIVO — la pestaña Catálogo del portal (`TabCatalogo`):
// a qué precio se vende cada producto y si puede ir a una tienda.
//
// «Venta libre» la marca una PERSONA contra el listado de la SRS; lo que el
// portal sí sabe es lo que NUNCA puede ir a una tienda —antibiótico, con receta
// o regulado— y eso la base lo bloquea aunque se marque. Las tarjetas filtran
// (venta libre, sólo farmacias, con descuento hoy) y el menú agrega «Fuera de
// los pedidos». Quien configura toca un producto para cambiar su precio y su
// descuento, o agrega uno nuevo.
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchCatalogo } from '@nucleo/data/distribucion';
import { filtrarCatalogo, resumenDeCatalogo } from '@nucleo/utils/distribucionComercial';
import { descuentoDelCatalogo } from '@nucleo/utils/distribucionPrecios';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica, hoySV } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../../componentes/Filtros';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { GRIS, PETROLEO, guardarElegida, useEmisor } from '../../componentes/torogoz/comercial/Piezas';

const POR_PAGINA = 40;

function Fila({ p, hoy, puedeEditar }) {
  const vigente = descuentoDelCatalogo(p, hoy) > 0;
  const pct = Number(p.descuento_pct);
  return (
    <Pressable disabled={!puedeEditar} accessibilityRole={puedeEditar ? 'button' : undefined} accessibilityLabel={p.nombre}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        guardarElegida('precio', p);
        router.push({ pathname: '/torogoz/precio/[id]', params: { id: String(p.product_id) } });
      }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={20} interactivo={puedeEditar}>
        <View style={{ padding: 14, flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{p.nombre}</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {p.controlado ? <Pildora texto="Sólo farmacias · controlado" color={GRIS} />
                : p.venta_libre ? <Pildora texto="Venta libre" color={MARCA.verde} />
                  : <Pildora texto="Sólo farmacias" color={GRIS} />}
              {!p.activo ? <Pildora texto="Fuera de los pedidos" color={MARCA.ambar} /> : null}
              {pct > 0 ? <Pildora texto={`${pct} %`} color={vigente ? MARCA.verde : GRIS} /> : null}
            </View>
            {pct > 0 && (p.descuento_desde || p.descuento_hasta) ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>
                {`Descuento ${p.descuento_desde ? fechaNumerica(p.descuento_desde) : '…'} – ${p.descuento_hasta ? fechaNumerica(p.descuento_hasta) : '…'}`}
              </Text>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(p.precio_con_iva)}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>{`${formatMoney(p.precio_con_iva / 1.13)} sin IVA`}</Text>
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function CatalogoTorogoz() {
  const { hasPermission } = useAuth();
  const puedeConfigurar = !!hasPermission?.('distribucion_config', 'can_edit');
  const { emisor } = useEmisor();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [buscar, setBuscar] = useState('');
  const [canal, setCanal] = useState('todos');
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  const [recargando, setRecargando] = useState(false);
  const pedido = useRef(0);
  const hoy = hoySV();

  const cargar = useCallback(async () => {
    const yo = ++pedido.current;
    try {
      const r = await fetchCatalogo();
      if (yo === pedido.current) { setItems(r); setError(''); }
    } catch {
      if (yo === pedido.current) { setError('No se pudo cargar el catálogo. Revisa la conexión e intenta de nuevo.'); setItems((x) => x ?? []); }
    }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const filtrados = useMemo(() => filtrarCatalogo(items ?? [], { buscar, canal: canal === 'todos' ? '' : canal, hoy }), [items, buscar, canal, hoy]);
  const stats = useMemo(() => resumenDeCatalogo(items ?? [], hoy), [items, hoy]);
  const elegir = (v) => { setCuantos(POR_PAGINA); setCanal(v); };
  const alternar = (v) => elegir(canal === v ? 'todos' : v);

  const grupos = [{ id: 'canal', titulo: 'Mostrar', activa: canal, porDefecto: 'todos', onCambiar: elegir, opciones: [
    { id: 'todos', label: 'Todos' }, { id: 'libre', label: 'Venta libre' }, { id: 'farmacia', label: 'Sólo farmacias' },
    { id: 'descuento', label: 'Con descuento hoy' }, { id: 'inactivo', label: 'Fuera de los pedidos' },
  ] }];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Catálogo', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Buscar producto', hideWhenScrolling: false,
          onChangeText: (e) => { setCuantos(POR_PAGINA); setBuscar(e.nativeEvent.text); }, onCancelButtonPress: () => setBuscar(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        <FilaDeKpis>
          <Kpi icono="Package" rotulo="En catálogo" valor={String(stats.total)} color={PETROLEO} apoyo="se ofrecen en los pedidos" />
          <Kpi icono="ShieldCheck" rotulo="Venta libre" valor={String(stats.libre)} color={MARCA.verde} pide={canal === 'libre'}
            apoyo="tiendas y supermercados" onPress={() => alternar('libre')} />
        </FilaDeKpis>
        <FilaDeKpis>
          <Kpi icono="Ban" rotulo="Sólo farmacias" valor={String(stats.farmacia)} color={MARCA.azulClaro} pide={canal === 'farmacia'}
            apoyo="receta, regulado o sin marcar" onPress={() => alternar('farmacia')} />
          <Kpi icono="Percent" rotulo="Con descuento" valor={String(stats.descuento)} color={MARCA.ambar} pide={canal === 'descuento'}
            apoyo="vigente hoy" onPress={() => alternar('descuento')} />
        </FilaDeKpis>
        {puedeConfigurar && emisor ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto="Agregar producto" color={PETROLEO} onPress={() => router.push({ pathname: '/torogoz/precio/[id]', params: { id: 'nuevo' } })} />
          </View>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {items === null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${filtrados.length} producto${filtrados.length === 1 ? '' : 's'}`}</Text>
        )}
        {filtrados.slice(0, cuantos).map((p) => <Fila key={p.product_id} p={p} hoy={hoy} puedeEditar={puedeConfigurar} />)}
        {filtrados.length > cuantos ? (
          <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde color={PETROLEO} onPress={() => setCuantos((n) => n + POR_PAGINA)} /></View>
        ) : null}
        {items !== null && !filtrados.length && !error ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 32, fontSize: 15, marginHorizontal: 24 }}>
            {buscar.trim() || canal !== 'todos' ? 'Ningún producto coincide con la búsqueda o el filtro.'
              : puedeConfigurar ? 'Catálogo vacío. Agrega productos con «Agregar producto».' : 'Catálogo vacío.'}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}
