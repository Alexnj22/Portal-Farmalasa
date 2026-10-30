// La prórroga por solicitud, NATIVA (2026-10-30) — gemela de `Prorroga.jsx`
// del portal. Reglamento de reservas v2, cláusula 6.4: el plazo para retirar
// no se alarga solo ni lo alarga la sala; se PIDE con los días que necesita el
// cliente y el motivo, y lo decide quien tenga `dash_reservas_prorroga`
// (Talento Humano y Supervisión de ventas). Una sola autorizada; mientras
// espera, el plazo no vence (lo frena la base).
//
// `modo`:
//   · `pedir`: params `tipo` ('reserva' | 'encargo'), `ids` (coma), `titulo`, `vence`;
//   · `bandeja`: las pendientes de la red, para autorizar (con los días pedidos
//     u otros) o negar con el motivo que se le dice al cliente.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { decidirProrroga, fetchProrrogasPendientes, pedirProrroga } from '@nucleo/data/reservas';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { Accion } from '../componentes/reservas/piezas';

const dia = (v) => fechaTexto(v, { weekday: 'long', day: 'numeric', month: 'long' });
const diasTexto = (n) => `${n} ${Number(n) === 1 ? 'día' : 'días'}`;
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 3);
const enRango = (n) => Number.isInteger(n) && n >= 1 && n <= 365;
const sumar = (vence, n) => (vence && enRango(n) ? new Date(new Date(vence).getTime() + n * 86400000) : null);

export default function ReservaProrroga() {
  const { modo = 'pedir' } = useLocalSearchParams();
  return modo === 'bandeja' ? <Bandeja /> : <Pedir />;
}

function Pedir() {
  const { tipo = 'reserva', ids = '', titulo = '', vence = '' } = useLocalSearchParams();
  const [dias, setDias] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const n = Number(dias);
  const valido = enRango(n) && motivo.trim().length >= 3;
  const quedaria = sumar(vence || null, n);

  const pedir = async () => {
    setOcupado(true); trabajando('Pidiendo…');
    try {
      for (const id of String(ids).split(',').filter(Boolean)) await pedirProrroga(tipo, id, n, motivo);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('Prórroga pedida', 'La autoriza Talento Humano o Supervisión de ventas. Mientras tanto, el plazo no vence.');
      router.back();
    } catch (err) { fallo('No se pudo pedir la prórroga', mensajeAmigable(err, 'Intenta de nuevo.')); } finally { setOcupado(false); }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pedir prórroga' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled">
          <Aviso texto={`${titulo}${vence ? ` · hoy puede retirar hasta el ${dia(vence)}` : ''}. Se pide una sola vez: la autoriza Talento Humano o Supervisión de ventas, y al cliente le llega el aviso.`} />
          <Seccion titulo="Días que necesita" pie={quedaria ? `Quedaría hasta el ${dia(quedaria)}.` : undefined}>
            <Campo multiline={false} value={dias} keyboardType="number-pad" onChangeText={(v) => setDias(soloDigitos(v))} placeholder="Ej. 15"
              style={{ textAlign: 'center', fontWeight: '700' }} />
          </Seccion>
          <Seccion titulo="Motivo">
            <Campo value={motivo} onChangeText={setMotivo} maxLength={300} placeholder="Por qué el cliente no puede venir en el plazo" />
          </Seccion>
          <BotonGrande texto="Pedir prórroga" onPress={pedir} deshabilitado={!valido || ocupado} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

/** Junta las solicitudes de un mismo pedido: se deciden de una vez. */
function agrupar(lista) {
  const grupos = new Map();
  for (const p of lista || []) {
    const clave = `${p.tipo}:${p.codigo}`;
    const g = grupos.get(clave);
    if (g) { g.ids.push(p.id); g.productos.push(p.producto); continue; }
    grupos.set(clave, { ...p, ids: [p.id], productos: [p.producto] });
  }
  return [...grupos.values()];
}

function Bandeja() {
  const { hasPermission } = useAuth();
  const puede = hasPermission('dash_reservas_prorroga');
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  const [refrescando, setRefrescando] = useState(false);
  const [abierta, setAbierta] = useState(null);

  const cargar = useCallback(async () => {
    try { setLista(agrupar(await fetchProrrogasPendientes())); setError(''); }
    catch (err) { setError(mensajeAmigable(err, 'No se pudieron leer las prórrogas.')); }
  }, []);
  useEffect(() => { if (puede) cargar(); }, [puede, cargar]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Prórrogas por autorizar' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={async () => { setRefrescando(true); await cargar(); setRefrescando(false); }} />}>
        {!puede ? <Aviso tono="cuidado" texto="Autorizar prórrogas es de Talento Humano y Supervisión de ventas." />
          : error ? <Aviso tono="cuidado" texto={error} />
          : lista === null ? <ActivityIndicator />
          : !lista.length ? <Aviso texto="No hay prórrogas esperando. Cuando la sala o un cliente pida una, aparece aquí." />
          : lista.map((p) => (
            <Seccion key={`${p.tipo}:${p.codigo}`} titulo={`${diasTexto(p.dias)} más · ${p.codigo}`}
              pie={`${p.origen === 'app' ? 'Pedida por el cliente en la app' : 'Pedida por la sala'}${p.vence ? ` · hoy vence el ${dia(p.vence)}` : ''}`}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${String(p.cliente ?? '').split(/\s+/)[0]} · ${p.sala ?? ''}`}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{p.productos.join(', ')}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Motivo: ${p.motivo}`}</Text>
              {abierta?.codigo === p.codigo && abierta?.tipo === p.tipo
                ? <Decidir p={p} autorizar={abierta.autorizar} onCerrar={() => setAbierta(null)} onListo={() => { setAbierta(null); cargar(); }} />
                : (
                  <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                    <Accion texto="Autorizar" relleno color={MARCA.verde} onPress={() => setAbierta({ ...p, autorizar: true })} />
                    <Accion texto="No autorizar" color={MARCA.rojo} onPress={() => setAbierta({ ...p, autorizar: false })} />
                  </View>
                )}
            </Seccion>
          ))}
      </ScrollView>
    </>
  );
}

function Decidir({ p, autorizar: inicial, onCerrar, onListo }) {
  const [autorizar, setAutorizar] = useState(inicial ? 'si' : 'no');
  const [dias, setDias] = useState(String(p.dias));
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const n = Number(dias);
  const si = autorizar === 'si';
  const valido = si ? enRango(n) : nota.trim().length >= 3;
  const quedaria = sumar(p.vence ? `${p.vence}T12:00:00` : null, n);

  const decidir = async () => {
    setOcupado(true); trabajando('Guardando…');
    try {
      let vence = null;
      for (const id of p.ids) vence = (await decidirProrroga(id, si, nota, si ? n : null))?.vence ?? vence;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(si ? 'Prórroga autorizada' : 'Prórroga no autorizada',
        si ? `Puede retirar hasta el ${dia(vence)}. La sala y el cliente reciben el aviso.` : 'La sala y el cliente reciben el aviso con el motivo.');
      onListo();
    } catch (err) { fallo('No se pudo', mensajeAmigable(err, 'Intenta de nuevo.')); } finally { setOcupado(false); }
  };

  return (
    <View style={{ gap: 12, paddingTop: 6 }}>
      <Opciones opciones={[{ id: 'si', label: 'Autorizar' }, { id: 'no', label: 'No autorizar' }]} valor={autorizar} onCambiar={setAutorizar} />
      {si ? (
        <>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Días que se autorizan${quedaria ? ` · quedaría hasta el ${dia(quedaria)}` : ''}`}</Text>
          <Campo multiline={false} value={dias} keyboardType="number-pad" onChangeText={(v) => setDias(soloDigitos(v))}
            style={{ textAlign: 'center', fontWeight: '700' }} />
        </>
      ) : null}
      <Campo value={nota} onChangeText={setNota} maxLength={300} placeholder={si ? 'Nota (opcional)' : 'Motivo (se le dice al cliente)'} />
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <Accion texto={si ? 'Autorizar' : 'No autorizar'} relleno color={si ? MARCA.verde : MARCA.rojo} deshabilitado={!valido || ocupado} onPress={decidir} />
        <Accion texto="Ahora no" sinFondo onPress={onCerrar} />
      </View>
    </View>
  );
}
