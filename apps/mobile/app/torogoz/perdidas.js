// Ventas perdidas de Torogoz, NATIVO — `TabVentasPerdidas` del portal: lo que
// los clientes pidieron y no se les pudo vender. Es la lista de compras: quien
// administra la marca «atendida» cuando ya lo consiguió, o «descartada» si no
// se va a traer (y puede devolverla a pendientes). Se anotan desde la venta o
// desde acá (el + de arriba, con la hoja `VentaPerdida`). El estado va en la
// dirección (`?estado=`), como en el portal.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchEmisor, fetchVentasPerdidas, mensajeDeDistribucion, resolverVentaPerdida } from '@nucleo/data/distribucion';
import { ORIGEN_PERDIDA, filtrarVentasPerdidas } from '@nucleo/utils/distribucionBodega';
import { VISTAS_PERDIDAS } from '@nucleo/utils/distribucionComun';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { formatQty } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { useStaffStore } from '@nucleo/store/staffStore';
import Avatar from '../../componentes/Avatar';
import { MenuDeFiltros } from '../../componentes/Filtros';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import Segmentos from '../../componentes/Segmentos';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';
import VentaPerdida from '../../componentes/torogoz/bodega/VentaPerdida';
import { Chapa, Ficha, PETROLEO, Vacio, confirmar } from '../../componentes/torogoz/bodega/piezas';

const OPCIONES = VISTAS_PERDIDAS.map((v) => ({ id: v.key, label: v.label }));
const PAGINA = 60;

function Accion({ texto, color, relleno, onPress, deshabilitado }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: relleno ? color : 'transparent', borderWidth: relleno ? 0 : 1.5, borderColor: color,
        opacity: deshabilitado ? 0.4 : pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color: relleno ? '#fff' : color, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function VentasPerdidas() {
  const { estado: enUrl } = useLocalSearchParams();
  const vista = OPCIONES.some((o) => o.id === enUrl) ? enUrl : 'pendiente';
  const { hasPermission } = useAuth();
  const puedeVender = !!hasPermission?.('distribucion', 'can_edit');
  const puedeConfigurar = !!hasPermission?.('distribucion_config', 'can_edit');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [buscar, setBuscar] = useState('');
  const [ocupado, setOcupado] = useState(null);
  const [anotando, setAnotando] = useState(false);
  const [emisor, setEmisor] = useState(null);
  const [cuantos, setCuantos] = useState(PAGINA);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    setError('');
    try { setFilas(await fetchVentasPerdidas({ estado: vista })); } catch (e) { setError(mensajeDeDistribucion(e)); setFilas((f) => f ?? []); }
  }, [vista]);
  useFocusEffect(useCallback(() => { setFilas(null); setCuantos(PAGINA); cargar(); }, [cargar]));
  useFocusEffect(useCallback(() => { fetchEmisor().then(setEmisor).catch(() => setEmisor(null)); }, []));

  const filtrados = useMemo(() => filtrarVentasPerdidas(filas, buscar), [filas, buscar]);
  // La foto sale de la ficha ya firmada del equipo: `photo_url` crudo es de un bucket privado y no abre.
  const empleados = useStaffStore((s) => s.employees);
  const fotos = useMemo(() => new Map((empleados ?? []).map((e) => [String(e.id), e.photo])), [empleados]);

  const resolver = async (f, estado) => {
    const titulo = estado === 'atendida' ? '¿Marcar como atendida?' : estado === 'descartada' ? '¿Descartar?' : '¿Volver a pendientes?';
    const mensaje = estado === 'atendida' ? `${f.producto}: ya se consiguió.` : estado === 'descartada' ? `${f.producto}: no se va a traer.` : f.producto;
    if (!(await confirmar(titulo, mensaje, estado === 'atendida' ? 'Atendida' : estado === 'descartada' ? 'Descartar' : 'Volver', { destructivo: estado === 'descartada' }))) return;
    setOcupado(f.id);
    try {
      await resolverVentaPerdida(f.id, estado);
      useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_VENTA_PERDIDA_RESUELTA', String(f.id), { estado, producto: f.producto, desde: 'app' });
      listo(estado === 'atendida' ? 'Marcada como atendida' : estado === 'descartada' ? 'Descartada' : 'Vuelve a pendientes', f.producto);
      await cargar();
    } catch (e) {
      fallo('No se pudo cambiar', mensajeDeDistribucion(e));
    } finally {
      setOcupado(null);
    }
  };

  const extra = puedeVender && emisor ? { icono: 'plus', etiqueta: 'Anotar venta perdida', onPress: () => setAnotando(true) } : null;

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Ventas perdidas', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Producto o cliente', hideWhenScrolling: true,
          onChangeText: (e) => setBuscar(e.nativeEvent.text), onCancelButtonPress: () => setBuscar(''),
        },
      }} />
      <MenuDeFiltros grupos={[]} extra={extra} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos opciones={OPCIONES} activa={vista} onCambiar={(v) => router.setParams({ estado: v })} />
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>
          Lo que los clientes pidieron y no se les pudo vender: la lista de lo que hay que comprar.
        </Text>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 16 }} /> : filtrados.length === 0 ? (
          buscar ? <Vacio titulo="Sin resultados" texto="Ninguna venta perdida coincide con la búsqueda." />
            : vista === 'pendiente' ? <Vacio titulo="Sin pendientes" texto="Nada de lo que pidieron quedó sin atender." />
              : <Vacio titulo={vista === 'atendida' ? 'Sin atendidas' : 'Sin descartadas'} />
        ) : (
          <>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${formatQty(filtrados.length)} ventas perdidas`}</Text>
            {filtrados.slice(0, cuantos).map((f) => {
              const o = ORIGEN_PERDIDA[f.origen] ?? ORIGEN_PERDIDA.insumo;
              return (
                <Ficha key={f.id}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{f.producto}</Text>
                      <Chapa variante={o.variant} texto={o.label} />
                      {f.principio_activo || f.laboratorio
                        ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[f.principio_activo, f.laboratorio].filter(Boolean).join(' · ')}</Text> : null}
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${f.dist_clientes?.nombre ?? 'Sin cliente'} · ${fechaNumerica(f.created_at)}`}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatQty(Number(f.cantidad), { decimalesMax: 2 })}</Text>
                      {f.employees ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Avatar empleado={{ id: f.employees.id, name: f.employees.name, photo: fotos.get(String(f.employees.id)) }} tamano={22} />
                          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{shortEmployeeName(f.employees)}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  {puedeConfigurar ? (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                      {vista === 'pendiente' ? (
                        <>
                          <Accion texto="Descartar" color={colorSistema.texto2} onPress={() => resolver(f, 'descartada')} deshabilitado={ocupado === f.id} />
                          <Accion texto="Atendida" color={PETROLEO} relleno onPress={() => resolver(f, 'atendida')} deshabilitado={ocupado === f.id} />
                        </>
                      ) : <Accion texto="Volver a pendientes" color={MARCA.azulClaro} onPress={() => resolver(f, 'pendiente')} deshabilitado={ocupado === f.id} />}
                    </View>
                  ) : null}
                </Ficha>
              );
            })}
            {filtrados.length > cuantos ? (
              <Pressable onPress={() => setCuantos((n) => n + PAGINA)} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '600' }}>{`Ver ${Math.min(PAGINA, filtrados.length - cuantos)} más`}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
      {anotando && emisor ? (
        <VentaPerdida emisorId={emisor.id} onCerrar={() => setAnotando(false)}
          onGuardado={() => { setAnotando(false); if (vista === 'pendiente') cargar(); else router.setParams({ estado: 'pendiente' }); }} />
      ) : null}
    </>
  );
}
