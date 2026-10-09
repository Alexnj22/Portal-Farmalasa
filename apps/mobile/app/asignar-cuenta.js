// Asignar una cuenta del sistema anterior a una ficha, NATIVO —
// `AsignarCuentaModal` de Puntos. Se buscan fichas candidatas (las del mismo
// teléfono y nombre parecido salen solas; con 3 letras se busca), se elige una
// y se escribe por qué (al menos cinco letras). Los puntos pasan con todo su
// historial y no se deshace desde acá: la base firma con la sesión de quien
// asigna (`puntos_panel_asignar`).
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { asignarCuentaAnterior, fetchFichasCandidatas, QUE_HACER_POR_MOTIVO } from '@nucleo/data/puntos';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { puntosTexto } from '@nucleo/utils/puntosTexto';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

export default function AsignarCuenta() {
  const { cuenta: crudo } = useLocalSearchParams();
  const puedeAsignar = useAuth().hasPermission('puntos', 'can_edit');
  const [cuenta] = useState(() => { try { return JSON.parse(crudo); } catch { return null; } });
  const [termino, setTermino] = useState('');
  const [fichas, setFichas] = useState([]);
  const [buscando, setBuscando] = useState(true);
  const [elegida, setElegida] = useState(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!cuenta) return undefined;
    let vivo = true;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const q = termino.trim();
        const r = await fetchFichasCandidatas(cuenta.id_cliente, q.length >= 3 ? q : null);
        if (vivo) setFichas(r ?? []);
      } catch (e) { if (vivo) fallo('No se pudo buscar', mensajeAmigable(e)); } finally { if (vivo) setBuscando(false); }
    }, termino ? 350 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [termino, cuenta]);

  if (!cuenta) return <Aviso tono="freno" texto="No se pudo leer la cuenta." />;
  const ficha = fichas.find((f) => f.id === elegida) ?? null;
  const listoParaAsignar = puedeAsignar && ficha && nota.trim().length >= 5 && !guardando;

  const asignar = () => Alert.alert('¿Asignar la cuenta?', `${puntosTexto(cuenta.saldo)} puntos de la cuenta ${cuenta.id_cliente} pasan a ${ficha.nombre}, con todo su historial.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Asignar', onPress: async () => {
      setGuardando(true); trabajando('Asignando…');
      try {
        const r = await asignarCuentaAnterior({ idCliente: cuenta.id_cliente, customerId: ficha.id, nota: nota.trim(), simular: false });
        if (!r?.ok) throw new Error(r?.error || 'No se pudo asignar');
        listo('Cuenta asignada', `${puntosTexto(r.puntos)} puntos pasaron a ${ficha.nombre}. Su saldo quedó en ${puntosTexto(r.saldo_despues)}.`);
        router.back();
      } catch (e) { fallo('No se pudo asignar', mensajeAmigable(e)); } finally { setGuardando(false); }
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `Cuenta ${cuenta.id_cliente}` }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Seccion titulo="Del sistema anterior" pie={cuenta.motivo}>
            <Dato primero rotulo="Nombre" valor={cuenta.nombre || 'Sin nombre'} />
            <Dato rotulo="Puntos" valor={`${puntosTexto(cuenta.saldo)} (${formatMoney((Number(cuenta.saldo) || 0) / 100)})`} />
            <Dato rotulo="DUI" valor={cuenta.dui || '—'} />
            <Dato rotulo="Teléfono" valor={cuenta.telefono || '—'} />
          </Seccion>
          {QUE_HACER_POR_MOTIVO[cuenta.motivo] ? <Aviso texto={QUE_HACER_POR_MOTIVO[cuenta.motivo]} /> : null}
          <Seccion titulo="¿A qué ficha van estos puntos?">
            <Campo multiline={false} value={termino} onChangeText={setTermino} placeholder="Buscar ficha por nombre, DUI o teléfono…" />
            {buscando ? <ActivityIndicator /> : !fichas.length ? (
              <Aviso texto={termino.trim() ? 'Ninguna ficha coincide.' : 'No hay fichas con el mismo teléfono ni un nombre parecido. Busca la ficha arriba.'} />
            ) : fichas.map((f) => {
              const activa = f.id === elegida;
              return (
                <Pressable key={f.id} onPress={() => setElegida(activa ? null : f.id)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingVertical: 6, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                  <Text style={{ color: activa ? MARCA.verde : colorSistema.texto2, fontSize: 20 }}>{activa ? '☑' : '☐'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                      {`DUI ${f.dui || 'sin cargar'} · ${f.telefono || 'sin teléfono'}${f.saldo_actual != null ? ` · ya tiene ${puntosTexto(f.saldo_actual)} puntos` : ''}`}
                    </Text>
                  </View>
                  {f.por_telefono ? <Pildora texto="Mismo teléfono" color={MARCA.verde} /> : null}
                </Pressable>
              );
            })}
          </Seccion>
          <Seccion titulo="Por qué" pie="Al menos cinco letras: queda en el historial de la cuenta.">
            <Campo value={nota} onChangeText={setNota} placeholder="Ej.: confirmé con su DUI en caja" />
          </Seccion>
          {!puedeAsignar ? <Aviso tono="freno" texto="Asignar cuentas es de quien puede editar Puntos." /> : null}
          <BotonGrande texto={guardando ? 'Asignando…' : 'Asignar'} color={MARCA.verde} deshabilitado={!listoParaAsignar} onPress={asignar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
