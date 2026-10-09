// Conexiones, NATIVO — `SesionesView`: quién tiene el portal abierto y en qué
// dispositivos, cuándo se movió por última vez y cuánto aguanta su sesión sin
// uso. Tocar a alguien abre su ficha en una hoja, repartida por la PUERTA por
// la que entra (carné, código, usuario…; una puerta sin conexiones se muestra
// igual, con «nunca entró» o cuándo fue la última vez). Cada conexión dice el
// dispositivo, si es la app instalada o el navegador, la IP y cuándo se cierra
// sola; se cierra una o todas, con confirmación (si entre ellas está la propia,
// la app sale).
//
// Bloquear y quitar el bloqueo, como el portal (permiso `bloqueos`): cuánto
// tiempo (1 h, 8 h, 1 día, 1 semana o indefinido — `DURACIONES_DE_BLOQUEO`) y
// el motivo; el bloqueo cierra todas sus conexiones. No se ofrece sobre uno
// mismo: la base lo rechaza y quedarías fuera. Todo sale de `data/sesiones`.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  agruparPorPersona, bloquearPersona, cerrarSesion, cerrarTodasDe, desbloquearPersona, describirAcceso, describirBloqueo, describirDispositivo,
  describirLimite, diasDesde, DURACIONES_DE_BLOQUEO, fetchSesiones, haceCuanto, hastaDeBloqueo,
} from '@nucleo/data/sesiones';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import ConAurora from '../componentes/ConAurora';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

// Más de esto en una sola persona merece mirarse (sesiones olvidadas, o algo raro).
const MUCHAS = 5;

function Ficha({ p, onCerrar, puedeCerrar, puedeBloquear, onCerrarConexion, onRecargar }) {
  const [bloqueando, setBloqueando] = useState(false);
  const [duracion, setDuracion] = useState('24');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const bloqueo = describirBloqueo(p.bloqueado_hasta);

  const bloquear = async () => {
    setOcupado(true);
    const { data, error } = await bloquearPersona(p.ficha_id, hastaDeBloqueo(duracion), motivo.trim(), { persona: p.empleado, cuenta: p.cuenta });
    setOcupado(false);
    if (error) { fallo('No se pudo bloquear', error.message || 'Vuelve a intentar.'); return; }
    listo('Persona bloqueada', `Se cerraron ${data} conexiones y ya no puede entrar.`);
    onRecargar(); onCerrar();
  };
  const quitar = () => Alert.alert('Quitar bloqueo', `${shortEmployeeName({ name: p.empleado || p.cuenta })} podrá volver a entrar al portal.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', onPress: async () => {
      const { error } = await desbloquearPersona(p.ficha_id, { persona: p.empleado, cuenta: p.cuenta });
      if (error) { fallo('No se pudo desbloquear', error.message || ''); return; }
      listo('Bloqueo quitado', 'Ya puede volver a entrar al portal.');
      onRecargar(); onCerrar();
    } },
  ]);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar empleado={{ id: p.ficha_id, name: p.empleado, photo: p.foto }} tamano={48} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{shortEmployeeName({ name: p.empleado || p.cuenta })}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[p.cargo, p.cuenta].filter(Boolean).join(' · ')}</Text>
            </View>
            <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text></Pressable>
          </View>
          {bloqueo ? <Aviso tono="freno" texto={`${bloqueo}${p.bloqueo_motivo ? ` — ${p.bloqueo_motivo}` : ''}`} /> : null}
          {p.conexiones.length > MUCHAS ? <Aviso tono="cuidado" texto={`Tiene ${p.conexiones.length} conexiones abiertas: puede haber sesiones olvidadas.`} /> : null}

          {(p.accesos?.length ? p.accesos : [{ acceso: null, conexiones: p.conexiones }]).map((puerta) => (
            <Seccion key={puerta.acceso ?? 'sin'} titulo={`${puerta.acceso ? describirAcceso(puerta.acceso) : 'Conexiones'} · ${puerta.conexiones.length === 0 ? 'sin conexiones' : puerta.conexiones.length === 1 ? '1 conexión' : `${puerta.conexiones.length} conexiones`}`}>
              {puerta.conexiones.length ? [...puerta.conexiones.filter((c) => c.es_actual), ...puerta.conexiones.filter((c) => !c.es_actual)].map((c, i) => (
                <View key={c.session_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 9 : 0 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{`${describirDispositivo(c.agente)}${c.es_actual ? ' · este equipo' : ''}`}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                      {[c.clase === 'app' ? 'App instalada' : 'Navegador', haceCuanto(c.ultimo_uso || c.ultima_renovacion || c.inicio), c.ip ? `IP ${c.ip}` : null].filter(Boolean).join(' · ')}
                    </Text>
                    {describirLimite(c.limite_min) ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Se cierra sola tras ${describirLimite(c.limite_min)} sin uso`}</Text> : null}
                  </View>
                  {puedeCerrar ? (
                    <Pressable onPress={() => onCerrarConexion(p, c)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}>
                      <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Cerrar</Text>
                    </Pressable>
                  ) : null}
                </View>
              )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Sin conexiones abiertas · ${haceCuanto(puerta.ultimo_movimiento) || 'nunca entró'}`}</Text>}
            </Seccion>
          ))}

          {puedeCerrar && p.conexiones.length > 1 ? <BotonGrande texto={`Cerrar las ${p.conexiones.length}`} borde color={MARCA.rojo} onPress={() => onCerrarConexion(p, null)} /> : null}

          {puedeBloquear && p.bloqueado ? <BotonGrande texto="Quitar bloqueo" color={MARCA.verde} onPress={quitar} /> : null}
          {puedeBloquear && !p.bloqueado && !p.tiene_esta ? (
            bloqueando ? (
              <Seccion titulo="Bloquear" pie="Se cierran todas sus conexiones y no puede volver a entrar hasta que venza o lo quites.">
                <Opciones opciones={DURACIONES_DE_BLOQUEO.map((d) => ({ id: d.value, label: d.label }))} valor={duracion} onCambiar={setDuracion} color={MARCA.rojo} />
                <Campo value={motivo} onChangeText={setMotivo} placeholder="Motivo (opcional)" />
                <BotonGrande texto={ocupado ? 'Bloqueando…' : 'Bloquear'} color={MARCA.rojo} onPress={bloquear} deshabilitado={ocupado} />
              </Seccion>
            ) : <BotonGrande texto="Bloquear…" borde color={MARCA.rojo} onPress={() => setBloqueando(true)} />
          ) : null}
          {puedeBloquear && !p.bloqueado && p.tiene_esta ? <Aviso texto="No puedes bloquearte a ti mismo." /> : null}
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}

export default function Sesiones() {
  const { hasPermission, logout } = useAuth();
  const puedeCerrar = hasPermission('sesiones', 'can_edit');
  const puedeBloquear = hasPermission('bloqueos', 'can_edit');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState('todas');
  const [texto, setTexto] = useState('');
  const [abierta, setAbierta] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchSesiones();
    setError(e ? (e.code === '42501' ? 'Tu cargo todavía no tiene acceso a Conexiones.' : 'No se pudo cargar la lista.') : null);
    setFilas(data || []);
  }, []);
  // Al día cada minuto sólo mientras se mira: con otra pantalla encima no consulta.
  useFocusEffect(useCallback(() => { cargar(); const t = setInterval(cargar, 60_000); return () => clearInterval(t); }, [cargar]));

  const personas = useMemo(() => agruparPorPersona(filas || []), [filas]);
  const visibles = personas.filter((p) => {
    if (texto.trim() && !tokenMatch(texto.trim(), p.empleado, p.cuenta, p.cargo)) return false;
    const d = diasDesde(p.ultimo_movimiento);
    if (filtro === 'hoy') return d <= 1;
    if (filtro === 'olvidadas') return d > 7;
    if (filtro === 'bloqueadas') return p.bloqueado;
    return true;
  });
  const vivas = personas.reduce((s, p) => s + p.conexiones.length, 0);
  const bloqueadas = personas.filter((p) => p.bloqueado).length;
  const elegida = abierta ? personas.find((p) => (p.ficha_id ?? p.cuenta) === abierta) : null;

  const cerrar = (persona, conexion) => {
    const todas = !conexion;
    const mia = todas ? persona.tiene_esta : conexion.es_actual;
    Alert.alert(
      todas ? `¿Cerrar las ${persona.conexiones.length} conexiones?` : '¿Cerrar esta conexión?',
      `${shortEmployeeName({ name: persona.empleado })}${mia ? ' — incluye la de este equipo: vas a tener que volver a entrar.' : ''}`,
      [{ text: 'Cancelar', style: 'cancel' }, { text: 'Cerrar', style: 'destructive', onPress: async () => {
        trabajando('Cerrando…');
        const quien = { persona: persona.empleado, cuenta: persona.cuenta };
        const { data, error: e } = todas ? await cerrarTodasDe(persona.ficha_id, quien) : await cerrarSesion(conexion.session_id, quien);
        if (e) { fallo('No se pudo cerrar', 'Vuelve a intentar en un momento.'); return; }
        listo(todas ? `${data} conexiones cerradas` : 'Conexión cerrada', 'Esos dispositivos ya no pueden renovar su acceso.');
        if (mia) { logout(); return; }
        if (todas) setAbierta(null);
        cargar();
      } }],
    );
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Conexiones', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Persona, cuenta o cargo', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={filtro} onCambiar={setFiltro} opciones={[
          { id: 'todas', label: 'Todas' }, { id: 'hoy', label: 'Hoy' }, { id: 'olvidadas', label: 'Olvidadas' },
          ...(bloqueadas ? [{ id: 'bloqueadas', label: `Bloqueadas · ${bloqueadas}` }] : []),
        ]} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${personas.length} persona${personas.length === 1 ? '' : 's'} · ${vivas} conexi${vivas === 1 ? 'ón abierta' : 'ones abiertas'}`}</Text> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((p) => {
          const bloqueo = describirBloqueo(p.bloqueado_hasta);
          return (
            <Pressable key={p.ficha_id ?? p.cuenta} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(p.ficha_id ?? p.cuenta); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={18} interactivo tinte={p.bloqueado ? 'rgba(240,68,56,0.12)' : undefined}>
                <View style={{ padding: 12, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar empleado={{ id: p.ficha_id, name: p.empleado, photo: p.foto }} tamano={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{shortEmployeeName({ name: p.empleado || p.cuenta })}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[p.cargo, haceCuanto(p.ultimo_movimiento) || 'nunca entró'].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <Pildora texto={`${p.conexiones.length}`} color={p.conexiones.length > MUCHAS ? MARCA.ambar : p.conexiones.length ? MARCA.verde : colorSistema.texto2} />
                  </View>
                  {bloqueo ? <Pildora texto={p.bloqueo_motivo ? `${bloqueo} · ${p.bloqueo_motivo}` : bloqueo} color={MARCA.rojo} /> : null}
                  {p.tiene_esta ? <Pildora texto="Incluye este equipo" color={MARCA.azulClaro} /> : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {filas && !visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Nadie en este grupo</Text> : null}
      </ScrollView>
      {elegida ? (
        <Ficha p={elegida} onCerrar={() => setAbierta(null)} puedeCerrar={puedeCerrar} puedeBloquear={puedeBloquear}
          onCerrarConexion={cerrar} onRecargar={cargar} />
      ) : null}
    </>
  );
}
