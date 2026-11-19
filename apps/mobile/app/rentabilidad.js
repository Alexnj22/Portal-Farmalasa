// Rentabilidad, NATIVO — la pestaña del portal (`productos/TabRentabilidad`):
// los productos cuya viñeta Regular deja menos de 15 % sobre el costo y los que
// perdieron 5 puntos o más de margen en el período. Cada uno con su costo, el
// precio Regular, el margen, el margen de antes (costo · viñeta · desde cuándo)
// y la viñeta sugerida que recupera ese margen. Lo calcula la base
// (`fetchRentabilidad`, núcleo), lo mismo que ve el portal.
//
// Como el portal: la sección (Todos · En pérdida · Margen bajo · Bajó) fija
// arriba, el período a comparar (30 · 60 · 90 días) como subfiltro, y el
// buscador por producto o presentación. Exige la pestaña del catálogo y ver
// costos. Sólo informa: el precio se cambia al cargar la compra.
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchRentabilidad } from '@nucleo/data/productos';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import Refrescar from '../componentes/Refrescar';
import Segmentos from '../componentes/Segmentos';
import Subfiltro from '../componentes/Subfiltro';
import FijoArriba from '../componentes/FijoArriba';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Cargando, Dato, PantallaSinDato, Vacio } from '../componentes/formulario/Piezas';
import { ErrorConReintento, useColumnas } from '../componentes/ListaPaginada';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const FILTROS = [
  { id: 'todos', label: 'Todos' },
  { id: 'perdida', label: 'En pérdida' },
  { id: 'bajo', label: 'Margen bajo' },
  { id: 'bajo5', label: 'Bajó' },
];
const PERIODOS = [{ id: '30', label: '30 días' }, { id: '60', label: '60 días' }, { id: '90', label: '90 días' }];

// Las mismas tres reglas del portal.
const enPerdida = (x) => x.margen < 0;
const margenBajo = (x) => x.margen >= 0 && x.margen < 15;
const bajo5 = (x) => x.margen_antes != null && x.margen_antes - x.margen >= 5;
const PASA = { todos: () => true, perdida: enPerdida, bajo: margenBajo, bajo5 };

function Fila({ x }) {
  const cayo = x.margen_antes != null ? x.margen_antes - x.margen : null;
  const sube = x.sugerida > x.vineta + 0.004;
  const colorMargen = x.margen < 0 ? MARCA.rojo : x.margen < 15 ? MARCA.ambar : colorSistema.texto2;
  return (
    <Vidrio radio={20}>
      <View style={{ padding: 14, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{x.nombre}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {x.presentacion ?? '—'}
              {x.cambio_costo != null && Math.abs(x.cambio_costo) >= 0.5 ? (
                <Text style={{ color: x.cambio_costo > 0 ? MARCA.rojo : MARCA.verde, fontWeight: '700' }}>
                  {`  costo ${x.cambio_costo > 0 ? '+' : ''}${x.cambio_costo} %`}
                </Text>
              ) : null}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Pildora texto={`${x.margen} %`} color={colorMargen} />
            {cayo != null && cayo >= 0.5 ? <Text style={{ color: MARCA.rojo, fontSize: 12, fontWeight: '700' }}>{`−${cayo.toFixed(1)} pts`}</Text> : null}
          </View>
        </View>
        <Dato primero rotulo="Costo" valor={formatMoney(x.costo)} />
        <Dato rotulo="Regular" valor={formatMoney(x.vineta)} />
        <Dato rotulo="Antes" valor={x.margen_antes != null
          ? `${x.margen_antes} % · ${formatMoney(x.costo_antes)} · ${formatMoney(x.vineta_antes)} · ${fechaNumerica(String(x.desde).slice(0, 10))}`
          : '—'} />
        <Dato rotulo="Sugerida" fuerte valor={sube ? formatMoney(x.sugerida) : '—'} />
      </View>
    </Vidrio>
  );
}

export default function Rentabilidad() {
  const { hasPermission } = useAuth();
  const puede = hasPermission('productos_tab_catalogo') && hasPermission('productos_ver_costos');
  const [dias, setDias] = useState('60');
  const [filtro, setFiltro] = useState('todos');
  const [texto, setTexto] = useState('');
  const busca = useTextoRebotado(texto).trim();
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [turno, setTurno] = useState(0);
  const [recargando, setRecargando] = useState(false);
  const columnas = useColumnas(360);

  useEffect(() => {
    if (!puede) return undefined;
    let vivo = true;
    setFilas(null);
    fetchRentabilidad(Number(dias)).then(({ filas: f, error: e }) => {
      if (!vivo) return;
      setError(e ?? ''); setFilas(f);
      setRecargando(false);
    });
    return () => { vivo = false; };
  }, [dias, puede, turno]);

  const cuenta = useMemo(() => {
    const f = filas ?? [];
    return { perdida: f.filter(enPerdida).length, bajo: f.filter(margenBajo).length, bajo5: f.filter(bajo5).length };
  }, [filas]);
  const vista = useMemo(() => (filas ?? []).filter((x) => PASA[filtro](x) && (!busca || tokenMatch(busca, x.nombre, x.presentacion))),
    [filas, filtro, busca]);

  if (!puede) return <PantallaSinDato titulo="Rentabilidad" texto="Tu cargo no puede ver costos." />;

  const cabecera = (
    <View style={{ gap: 12, marginBottom: 10 }}>
      <Subfiltro opciones={PERIODOS} activa={dias} onCambiar={setDias} />
      <View style={{ marginHorizontal: 16, gap: 6 }}>
        <Aviso texto="Productos con un precio Regular que deja menos de 15 % sobre el costo, y los que bajaron 5 puntos o más de margen en el período. «Sugerida» es el precio que recupera el margen de antes. El historial de costos empieza el 13-ago-2026." />
        {filas ? (
          <Text style={{ color: colorSistema.texto, fontSize: 14, marginHorizontal: 4 }}>
            {`Hoy: ${cuenta.perdida} en pérdida · ${cuenta.bajo} con margen bajo · ${cuenta.bajo5} que bajaron.`}
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_FIJA, title: 'Rentabilidad',
        headerSearchBarOptions: {
          placeholder: 'Producto o presentación', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <FijoArriba>
        <Segmentos activa={filtro} onCambiar={setFiltro} opciones={FILTROS} />
      </FijoArriba>
      <FlatList
        key={`col-${columnas}`}
        data={error ? [] : vista}
        numColumns={columnas}
        columnWrapperStyle={columnas > 1 ? { gap: 10, paddingHorizontal: 16 } : undefined}
        keyExtractor={(x) => `${x.product_id}-${x.id_presentacion}`}
        renderItem={({ item }) => <View style={columnas > 1 ? { flex: 1 / columnas } : { marginHorizontal: 16 }}><Fila x={item} /></View>}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={cabecera}
        ListEmptyComponent={filas == null ? <Cargando />
          : error ? <ErrorConReintento mensaje={error} onReintentar={() => setTurno((t) => t + 1)} />
            : <Vacio titulo={busca ? 'Ningún producto con esa búsqueda' : 'Sin productos con margen bajo o en caída'} tono={busca ? 'neutro' : 'bien'} />}
        ListFooterComponent={<View style={{ height: 48 }} />}
        contentContainerStyle={{ paddingTop: 12 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        windowSize={9}
        refreshControl={<Refrescar refreshing={recargando} onRefresh={() => { setRecargando(true); setTurno((t) => t + 1); }} />}
      />
    </>
  );
}
