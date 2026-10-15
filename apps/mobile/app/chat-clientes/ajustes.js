// «Ajustes del chat», NATIVO — `AjustesDelChat.jsx` del portal: los dos
// mensajes automáticos que recibe un cliente al escribir (con la farmacia en
// horario y fuera de él). Admiten {abre} y {cierra}, que el servidor rellena
// con el horario REAL de las salas; la vista previa los rellena con el estado
// de ahora (`trozosDelMensaje`, núcleo). Sólo quien edita `chat_clientes`
// guarda; la policy de la base lo vuelve a exigir.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchAjustesDelChat, guardarAjustesDelChat } from '@nucleo/data/horarios';
import { LARGO_MAXIMO_MENSAJE, MARCADORES_DEL_CHAT, trozosDelMensaje } from '@nucleo/utils/horarioDelChat';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import useFarmaciaEstado from '@nucleo/hooks/useFarmaciaEstado';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';
import Tocable from '../../componentes/Tocable';
import { EstadoDeLaFarmacia } from '../../componentes/chat/Encabezado';

const CAMPOS = [
  { clave: 'mensaje_abierto', rotulo: 'Con la farmacia en horario', ayuda: 'Lo recibe quien escribe mientras alguna farmacia está abierta.' },
  { clave: 'mensaje_cerrado', rotulo: 'Fuera de horario', ayuda: 'Lo recibe quien escribe con todas las farmacias cerradas. Conviene decir cuándo abren: {abre}.' },
];

function VistaPrevia({ texto, estado }) {
  const trozos = useMemo(() => trozosDelMensaje(texto, estado), [texto, estado]);
  if (!String(texto || '').trim()) return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontStyle: 'italic' }}>El mensaje está vacío.</Text>;
  return (
    <>
      <Text style={{ color: colorSistema.texto, fontSize: 15, lineHeight: 21 }}>
        {trozos.map((t, i) => (t.marcador
          ? <Text key={i} style={{ fontWeight: '800', color: t.faltante ? MARCA.ambar : MARCA.azulClaro }}>{t.texto}</Text>
          : <Text key={i}>{t.texto}</Text>))}
      </Text>
      {trozos.some((t) => t.faltante) ? <Text style={{ color: MARCA.ambar, fontSize: 12 }}>Lo marcado en ámbar no aplica en este momento; se completa solo cuando corresponda.</Text> : null}
    </>
  );
}

function Editor({ campo, valor, onCambio, estado, deshabilitado }) {
  const cursor = useRef(null);
  const insertar = (marcador) => {
    const pos = cursor.current ?? valor.length;
    const nuevo = `${valor.slice(0, pos)}${marcador}${valor.slice(pos)}`.slice(0, LARGO_MAXIMO_MENSAJE);
    cursor.current = Math.min(pos + marcador.length, nuevo.length);
    onCambio(nuevo);
  };
  return (
    <Seccion titulo={campo.rotulo} pie={campo.ayuda}>
      <Campo value={valor} editable={!deshabilitado} maxLength={LARGO_MAXIMO_MENSAJE} style={{ minHeight: 100 }}
        onChangeText={onCambio} onSelectionChange={(e) => { cursor.current = e.nativeEvent.selection.start; }} />
      {!valor.trim() ? <Aviso tono="freno" texto="Escribe un mensaje." /> : null}
      {!deshabilitado ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' }}>Insertar</Text>
          {MARCADORES_DEL_CHAT.map((m) => (
            <Tocable key={m.clave} accessibilityRole="button" accessibilityHint={m.ayuda} disabled={valor.length + m.clave.length > LARGO_MAXIMO_MENSAJE}
              onPress={() => insertar(m.clave)}
              style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', backgroundColor: 'rgba(0,82,204,0.14)' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>{`${m.rotulo} ${m.clave}`}</Text>
            </Tocable>
          ))}
        </View>
      ) : null}
      <View style={{ gap: 4, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' }}>Así lo verá el cliente ahora</Text>
        <VistaPrevia texto={valor} estado={estado} />
      </View>
    </Seccion>
  );
}

export default function AjustesDelChat() {
  const { user, hasPermission } = useAuth();
  const puedeEditar = hasPermission('chat_clientes', 'can_edit');
  const empleados = useStaffStore((s) => s.employees);
  const estado = useFarmaciaEstado();
  const [fila, setFila] = useState(null);
  const [f, setF] = useState({ mensaje_abierto: '', mensaje_cerrado: '' });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    let vivo = true;
    fetchAjustesDelChat()
      .then((r) => { if (!vivo) return; setFila(r ?? {}); setF({ mensaje_abierto: r?.mensaje_abierto ?? '', mensaje_cerrado: r?.mensaje_cerrado ?? '' }); })
      .catch((e) => { if (vivo) { setError(e?.message || 'No se pudieron leer los mensajes.'); setFila({}); } });
    return () => { vivo = false; };
  }, []);
  const editor = useMemo(() => (fila?.updated_by ? (empleados || []).find((e) => String(e.id) === String(fila.updated_by)) ?? null : null), [empleados, fila]);
  const cambiado = !!fila && (f.mensaje_abierto !== (fila.mensaje_abierto ?? '') || f.mensaje_cerrado !== (fila.mensaje_cerrado ?? ''));
  const valido = f.mensaje_abierto.trim() && f.mensaje_cerrado.trim();
  const puedeGuardar = puedeEditar && cambiado && valido && !guardando && !!user?.id;

  const guardar = async () => {
    setGuardando(true);
    try {
      const r = await guardarAjustesDelChat({ mensajeAbierto: f.mensaje_abierto, mensajeCerrado: f.mensaje_cerrado, employeeId: user.id });
      setFila(r);
      setF({ mensaje_abierto: r.mensaje_abierto, mensaje_cerrado: r.mensaje_cerrado });
      listo('Mensajes guardados', 'Los próximos clientes ya los reciben.');
    } catch (e) { fallo('No se pudieron guardar', e?.message || ''); }
    setGuardando(false);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ajustes del chat', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Aviso texto="Respuestas automáticas que recibe el cliente al escribir. El horario sale de las sucursales: los feriados y los horarios especiales se aplican solos." />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}><EstadoDeLaFarmacia estado={estado} /></View>
          {error ? <Aviso tono="freno" texto={error} /> : null}
          {!fila ? <ActivityIndicator style={{ marginTop: 24 }} /> : CAMPOS.map((c) => (
            <Editor key={c.clave} campo={c} valor={f[c.clave]} estado={estado} deshabilitado={!puedeEditar || guardando}
              onCambio={(v) => setF((x) => ({ ...x, [c.clave]: v }))} />
          ))}
          {fila?.updated_by ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {`Última edición: ${shortEmployeeName(editor)}${fila.updated_at ? ` · ${fechaHora12(fila.updated_at, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`}
            </Text>
          ) : null}
          {puedeEditar ? <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar mensajes'} deshabilitado={!puedeGuardar} onPress={guardar} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
