// Chat con clientes, NATIVO — la bandeja del portal
// (`views/chat-clientes/ChatClientesView.jsx`): las conversaciones que los
// clientes abren desde la app Puntos Salud, con los mismos filtros (Todas
// abiertas, Nuevas, En atención, Esperando al cliente, Resueltas), la búsqueda
// por nombre, teléfono o mensaje, cuánto lleva esperando cada «Nuevo», quién la
// está respondiendo y cuántos mensajes esperan respuesta. La bandeja (páginas
// de 40, refresco en vivo) es el mismo hook del portal (`useBandejaDelChat`).
//
// Como el portal: filtro por etiqueta y «Preferentes» (Platino y Mayoristas)
// en el menú, las preferentes suben debajo de las «Urgente» con su chip, y
// arriba el estado de la farmacia, el promedio de calificaciones y los
// accesos a Incumplimientos y Ajustes del chat (`componentes/chat/Encabezado`).
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useNowTick } from '@nucleo/hooks/useNowTick';
import { useBandejaDelChat, useEquipoDelChat } from '@nucleo/hooks/useBandejaDelChat';
import { escribeAhora, useRelojDeEscritura } from '@nucleo/hooks/escrituraDelChat';
import { ETIQUETAS, FILTROS, PREFERENTE, esPreferente, estadoDeConversacion, estadoServidor, etiquetasDe, nombreDeCliente, ordenarConPreferentes } from '@nucleo/utils/chatClientes';
import { esCargoDeSupervision } from '@nucleo/utils/decisionDiferencia';
import useFarmaciaEstado from '@nucleo/hooks/useFarmaciaEstado';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import Segmentos from '../componentes/Segmentos';
import Vidrio from '../componentes/Vidrio';
import Tocable from '../componentes/Tocable';
import Avatar from '../componentes/Avatar';
import { ErrorConReintento, useColumnas, useMasAlFinal } from '../componentes/ListaPaginada';
import { MARCA } from '../componentes/inicio/marca';
import { ChipsDeEstado, ClienteAvatar, EtiquetasDeCliente } from '../componentes/chat/Piezas';
import { recordarConversacion } from '../componentes/chat/elegida';
import { precargarHilo } from '@nucleo/data/chatHilo';
import { FichasDeEtiquetas } from '../componentes/chat/Etiquetas';
import Asignacion from '../componentes/chat/Asignacion';
import { estrellas } from '@nucleo/utils/chatPersonal';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { Pildora } from '../componentes/avisos/Piezas';
import Encabezado from '../componentes/chat/Encabezado';

const Fila = memo(function Fila({ c, tomadaPor, atiende, ahora, columnas, equipo }) {
  const sinLeer = Number(c.sin_leer_equipo) || 0;
  const reloj = useRelojDeEscritura([c.cliente_escribiendo_at]);
  const escribe = escribeAhora(c.cliente_escribiendo_at, reloj);
  return (
    <View style={{ ...(columnas > 1 ? { flex: 1 / columnas } : { marginHorizontal: 16 }), marginTop: 10 }}>
      <Tocable accessibilityRole="button" accessibilityLabel={`${nombreDeCliente(c.cliente)}${sinLeer ? `, ${sinLeer} sin leer` : ''}`}
        // Al apoyar el dedo se precarga el hilo: para cuando se suelta, ya está (`chatHilo`).
        onPressIn={() => precargarHilo(c.id)}
        onPress={() => { Haptics.selectionAsync().catch(() => {}); recordarConversacion(c); router.push(`/chat-clientes/${c.id}`); }}>
        <Vidrio radio={18}>
          <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
            <ClienteAvatar cliente={c.cliente} fotoUrl={c.foto_url} tamano={44} conversacion={c} />
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: sinLeer ? '800' : '700' }} numberOfLines={1}>{nombreDeCliente(c.cliente)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>{cuandoLlego(c.ultimo_mensaje_at)}</Text>
                {sinLeer ? (
                  <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: MARCA.rojo }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{sinLeer}</Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                <ChipsDeEstado conversacion={c} atiende={atiende} ahora={ahora} />
                <EtiquetasDeCliente c={c} />
                {esPreferente(c) ? <Pildora texto={`♛ ${PREFERENTE.label}`} color={MARCA.violetaClaro} /> : null}
              </View>
              <FichasDeEtiquetas conversacion={c} />
              <Asignacion conversacion={c} equipo={equipo} />
              {estrellas(c.calificacion) ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{estrellas(c.calificacion)}</Text> : null}
              {tomadaPor ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Avatar empleado={tomadaPor} tamano={18} />
                  <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>{`${shortEmployeeName(tomadaPor)} está respondiendo…`}</Text>
                </View>
              ) : escribe ? (
                <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontStyle: 'italic' }}>escribiendo…</Text>
              ) : (
                <Text style={{ color: sinLeer ? colorSistema.texto : colorSistema.texto2, fontSize: 14, fontWeight: sinLeer ? '600' : '400' }} numberOfLines={2}>
                  {`${c.ultimo_de === 'equipo' ? 'Equipo: ' : ''}${c.ultimo_texto ?? ''}`}
                </Text>
              )}
            </View>
          </View>
        </Vidrio>
      </Tocable>
    </View>
  );
});

export default function ChatClientes() {
  const { user, hasPermission } = useAuth();
  const puedeResponder = hasPermission('chat_clientes', 'can_edit');
  // Incumplimientos: supervisión o quien edita el chat (como el portal).
  const veIncumplimientos = puedeResponder || esCargoDeSupervision(user?.rango);
  const estadoFarmacia = useFarmaciaEstado();
  const [filtro, setFiltro] = useState('abierta');
  const [etiqueta, setEtiqueta] = useState('todas');
  const [preferentes, setPreferentes] = useState('no');
  const filtrosActivos = (etiqueta !== 'todas' ? 1 : 0) + (preferentes === 'si' ? 1 : 0);
  const [busqueda, setBusqueda] = useState('');
  const [recargando, setRecargando] = useState(false);
  const ahora = useNowTick(30_000);
  const columnas = useColumnas();
  const { equipo, asegurarEquipo } = useEquipoDelChat();
  const { conversaciones, hayMas, cargandoMas, error, cargar, verMas } = useBandejaDelChat(
    // Con un filtro puesto también las resueltas se piden enteras: es un filtro
    // de acá y no puede mirar sólo la primera página.
    estadoServidor(filtro), { asegurarEquipo, todas: filtro !== 'resuelta' || filtrosActivos > 0 });
  // La etiqueta elegida y las preferentes; «Urgente» arriba y las preferentes después.
  const conEtiqueta = useMemo(() => ordenarConPreferentes((conversaciones ?? [])
    .filter((c) => etiqueta === 'todas' || etiquetasDe(c).includes(etiqueta))
    .filter((c) => preferentes !== 'si' || esPreferente(c))), [conversaciones, etiqueta, preferentes]);
  const grupos = [
    { id: 'etiqueta', titulo: 'Etiqueta', activa: etiqueta, porDefecto: 'todas', onCambiar: setEtiqueta,
      opciones: [{ id: 'todas', label: 'Todas' }, ...Object.entries(ETIQUETAS).map(([id, e]) => ({ id, label: e.label }))] },
    { id: 'preferentes', titulo: 'Atención', activa: preferentes, porDefecto: 'no', onCambiar: setPreferentes,
      opciones: [{ id: 'no', label: 'Todos los clientes' }, { id: 'si', label: 'Preferentes (Platino y Mayoristas)' }] },
  ];

  // Cuántas en cada estado, para el número de cada filtro (con las abiertas cargadas).
  const cuentas = useMemo(() => {
    if (filtro === 'resuelta') return null;
    const n = { nuevo: 0, atencion: 0, esperando: 0 };
    conEtiqueta.forEach((c) => { const e = estadoDeConversacion(c); if (e in n) n[e] += 1; });
    return n;
  }, [conEtiqueta, filtro]);
  const opciones = Object.keys(FILTROS).map((k) => ({ id: k, label: cuentas?.[k] ? `${FILTROS[k].label} · ${cuentas[k]}` : FILTROS[k].label }));

  const visibles = useMemo(() => {
    const entran = new Set(FILTROS[filtro]?.estados ?? []);
    return conEtiqueta.filter((c) => entran.has(estadoDeConversacion(c)))
      .filter((c) => !busqueda || tokenMatch(busqueda, c.cliente ?? '', c.telefono ?? '', c.ultimo_texto ?? ''));
  }, [conEtiqueta, busqueda, filtro]);
  // «Resueltas» pagina al llegar abajo; las abiertas ya se piden todas (los filtros son derivados).
  const scroll = useMasAlFinal(useCallback(() => { if (!cargandoMas) verMas(); }, [cargandoMas, verMas]), filtro === 'resuelta' && hayMas && !busqueda && filtrosActivos === 0);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Chat con clientes', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Nombre, teléfono o mensaje', onChangeText: (e) => setBusqueda(e.nativeEvent.text) } }} />
      <MenuDeFiltros grupos={grupos} />
      <FlatList key={`c${columnas}`} numColumns={columnas} columnWrapperStyle={columnas > 1 ? { gap: 10, paddingHorizontal: 16 } : undefined}
        data={visibles} keyExtractor={(c) => String(c.id)}
        renderItem={({ item: c }) => (
          <Fila c={c} ahora={ahora} columnas={columnas}
            tomadaPor={c.tomada_vigente && String(c.tomada_por) !== String(user?.id) ? equipo.get(c.tomada_por) ?? { id: c.tomada_por } : null}
            atiende={c.tomada_vigente ? equipo.get(c.tomada_por) ?? null : null} equipo={equipo} />
        )}
        {...scroll}
        contentInsetAdjustmentBehavior="automatic" initialNumToRender={12} windowSize={9} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}
        ListHeaderComponent={(
          <View style={{ gap: 8 }}>
            <Encabezado estado={estadoFarmacia} veIncumplimientos={veIncumplimientos} puedeEditar={puedeResponder} />
            <Segmentos activa={filtro} onCambiar={setFiltro} opciones={opciones} />
            <FiltrosActivos grupos={grupos} />
            {!conversaciones && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
          </View>
        )}
        ListFooterComponent={cargandoMas ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null}
        ListEmptyComponent={error ? <ErrorConReintento mensaje={error} onReintentar={cargar} /> : !conversaciones ? null : (
          <View style={{ alignItems: 'center', marginTop: 40, marginHorizontal: 24, gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700', textAlign: 'center' }}>
              {busqueda ? 'Sin resultados' : preferentes === 'si' && etiqueta === 'todas' ? 'Sin clientes preferentes' : etiqueta !== 'todas' ? `Nadie con «${ETIQUETAS[etiqueta].label}»` : `Sin conversaciones: ${FILTROS[filtro]?.label.toLowerCase() ?? ''}`}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>
              {busqueda ? 'Prueba con otro nombre o teléfono.' : filtrosActivos > 0 ? 'Quita los filtros para ver las demás.' : 'Cuando un cliente escriba desde la app, aparece aquí.'}
            </Text>
          </View>
        )} />
    </>
  );
}
