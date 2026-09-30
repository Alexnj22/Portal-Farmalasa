// Un envío (una sala MANDA producto sin que se lo pidan), NATIVO. Hace lo que
// el portal hace en `FilasEnvio.jsx`, con las mismas funciones de
// `data/envios.js`, según en qué momento está (`momentoDelEnvio`):
//
//   · por_decidir            — la sala que recibe decide renglón por renglón:
//                              aceptar, devolver (con motivo de la lista
//                              cerrada; «Otro» exige nota) o «no llegó».
//                              `decidirEnvio` manda POSICIONES, nunca productos.
//   · por_recibir_devolucion — la que envió recibe lo devuelto
//                              (`recibirDevolucion`).
//   · por_despachar          — no salió: reintentar (`despacharEnvio`) o
//                              cancelar con motivo (`cancelarEnvio`), esto
//                              último sólo si ningún renglón salió.
//   · lo demás               — de sólo lectura.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cancelarEnvio, DECISIONES_ENVIO, decidirEnvio, despacharEnvio, fetchEnviosVivos, momentoDelEnvio, MOTIVOS_RECHAZO_ENVIO, recibirDevolucion } from '@nucleo/data/envios';
import { buscadorDePersonas, desdeHace } from '@nucleo/utils/movimientoTexto';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Vidrio from '../../componentes/Vidrio';
import Avatar from '../../componentes/Avatar';
import { Pildora, Ruta } from '../../componentes/traslados/Tarjeta';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { usePorDecidir } from '../../componentes/porDecidir';

const ESTADO = {
  por_enviar: ['Sin salir', MARCA.ambar], error: ['No salió', MARCA.rojo], enviada: ['En camino', MARCA.azulClaro],
  aceptada: ['Aceptado', MARCA.verde], devuelta: ['Devuelto', MARCA.rojo], devuelta_recibida: ['Devolución recibida', '#8E8E93'],
  no_llego: ['No llegó', MARCA.rojo],
};

const OPCIONES = [
  { id: DECISIONES_ENVIO.aceptar, texto: 'Aceptar', color: MARCA.verde },
  { id: DECISIONES_ENVIO.devolver, texto: 'Devolver', color: MARCA.rojo },
  { id: DECISIONES_ENVIO.noLlego, texto: 'No llegó', color: MARCA.ambar },
];

function Campo(props) {
  return (
    <TextInput placeholderTextColor={colorSistema.texto2} multiline {...props}
      style={{ minHeight: 42, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: colorSistema.texto, backgroundColor: 'rgba(127,127,127,0.16)' }} />
  );
}

function BotonGrande({ texto, color = MARCA.azul, onPress, deshabilitado, borde = false }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
        backgroundColor: borde ? 'transparent' : color, borderWidth: borde ? 1.5 : 0, borderColor: color,
        opacity: deshabilitado ? 0.4 : pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Text style={{ color: borde ? color : '#fff', fontSize: 17, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function Envio() {
  const { id } = useLocalSearchParams();
  const { user, getScope } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const persona = useMemo(() => buscadorDePersonas(empleados), [empleados]);
  const [envio, setEnvio] = useState(undefined);
  const [decision, setDecision] = useState({});   // posición → { decision, motivo, nota }
  const [motivoCancelar, setMotivoCancelar] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetchEnviosVivos();
    setEnvio((r.envios || []).find((e) => String(e.id) === String(id)) ?? null);
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  if (envio === undefined) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Envío' }} /><Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 140 }}>Cargando…</Text></>;
  if (!envio) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Envío' }} /><Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 140, paddingHorizontal: 32 }}>Este envío ya se cerró o no es de tu sala.</Text></>;

  const todas = getScope?.('traslados') === 'ALL';
  const momento = momentoDelEnvio(envio, todas ? null : salaDelUsuario(user));
  const lineas = envio.lineas || [];
  const porDecidir = lineas.filter((l) => l.estado === 'enviada');
  const quien = persona(envio.employee_id);

  const decisiones = porDecidir.map((l) => ({ i: l.posicion, ...(decision[l.posicion] || {}) })).filter((d) => d.decision);
  const falta = porDecidir.length - decisiones.length;
  const incompleta = decisiones.some((d) => d.decision === DECISIONES_ENVIO.devolver && (!d.motivo || (d.motivo === 'Otro' && !d.nota?.trim())));
  const elegir = (pos, cambios) => { Haptics.selectionAsync().catch(() => {}); setDecision((d) => ({ ...d, [pos]: { ...(d[pos] || {}), ...cambios } })); };

  const terminar = (titulo, texto) => { usePorDecidir.getState().quitar(`envio:${envio.id}`); listo(titulo, texto); router.back(); };

  const confirmar = async (lista) => {
    setOcupado(true); trabajando('Guardando lo que decidiste…');
    const r = await decidirEnvio(envio.id, lista.map((d) => ({ i: d.i, decision: d.decision, motivo: d.motivo ?? null, nota: d.nota?.trim() ?? '' })));
    setOcupado(false);
    if (!r?.ok) { fallo('No se pudo guardar', r?.error ?? 'Inténtalo de nuevo.'); cargar(); return; }
    if (r.fallos?.length) { fallo('Algunos productos no se pudieron mover', r.fallos.map((f) => `${f.producto}: ${f.error}`).join('\n')); cargar(); return; }
    terminar('Listo', r.cerrado ? 'El envío quedó cerrado.' : undefined);
  };

  const aceptarTodo = () => confirmar(porDecidir.map((l) => ({ i: l.posicion, decision: DECISIONES_ENVIO.aceptar })));

  const recibirLoDevuelto = async () => {
    setOcupado(true); trabajando('Recibiendo lo devuelto…');
    const r = await recibirDevolucion(envio.id);
    setOcupado(false);
    if (!r?.ok) { fallo('No se pudo recibir', r?.error ?? 'Inténtalo de nuevo.'); return; }
    terminar('Devolución recibida');
  };

  const reintentar = async () => {
    setOcupado(true); trabajando('Enviando…');
    const r = await despacharEnvio(envio.id);
    setOcupado(false);
    if (!r?.ok) { fallo('No salió', r?.error ?? 'Inténtalo de nuevo.'); cargar(); return; }
    terminar('Enviado', r.fallos?.length ? `${r.fallos.length} producto(s) no salieron.` : undefined);
  };

  const cancelar = async () => {
    setOcupado(true); trabajando('Cancelando…');
    const r = await cancelarEnvio(envio.id, motivoCancelar.trim());
    setOcupado(false);
    if (!r?.ok) { fallo('No se pudo cancelar', r?.error ?? 'Inténtalo de nuevo.'); return; }
    terminar('Envío cancelado');
  };

  const salioAlgo = lineas.some((l) => l.enviado_at);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: envio.codigo_bolsa ? `Envío ${envio.codigo_bolsa}` : 'Envío' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} />}>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar empleado={quien} tamano={52} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 19, fontWeight: '700' }}>{shortEmployeeName(quien)}</Text>
              <Ruta desde={envio.origen_branch_name} hacia={envio.branch_name} />
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Envió {desdeHace(envio.created_at, Date.now())}</Text>
            </View>
          </View>

          {envio.motivo_tipo || envio.reason ? (
            <Vidrio radio={18}><View style={{ padding: 14, gap: 4 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Por qué lo envía</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{[envio.motivo_tipo, envio.reason].filter(Boolean).join(' · ')}</Text>
            </View></Vidrio>
          ) : null}

          {lineas.map((l) => {
            const [et, col] = ESTADO[l.estado] ?? [l.estado, '#8E8E93'];
            const d = decision[l.posicion] || {};
            const decide = momento === 'por_decidir' && l.estado === 'enviada';
            return (
              <Vidrio key={l.posicion} radio={20}>
                <View style={{ padding: 14, gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{l.descripcion}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{l.cantidad} {l.presentacion_tipo}{l.unidades && l.unidades !== l.cantidad ? ` · ${l.unidades} unidades` : ''}</Text>
                    </View>
                    {!decide ? <Pildora texto={et} color={col} /> : null}
                  </View>
                  {decide ? (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {OPCIONES.map((o) => {
                        const esta = d.decision === o.id;
                        return (
                          <Pressable key={o.id} onPress={() => elegir(l.posicion, { decision: o.id })} style={{ flex: 1 }}>
                            <View style={{ minHeight: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
                              backgroundColor: esta ? o.color : `${o.color}22`, borderWidth: esta ? 0 : 1, borderColor: `${o.color}66` }}>
                              <Text style={{ color: esta ? '#fff' : o.color, fontSize: 14, fontWeight: '700' }}>{o.texto}</Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  {decide && d.decision === DECISIONES_ENVIO.devolver ? (
                    <View style={{ gap: 8 }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {MOTIVOS_RECHAZO_ENVIO.map((m) => (
                          <Pressable key={m} onPress={() => elegir(l.posicion, { motivo: m })}>
                            <View style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999,
                              backgroundColor: d.motivo === m ? MARCA.rojo : 'rgba(127,127,127,0.2)' }}>
                              <Text style={{ color: d.motivo === m ? '#fff' : colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{m}</Text>
                            </View>
                          </Pressable>
                        ))}
                      </View>
                      <Campo value={d.nota ?? ''} onChangeText={(v) => setDecision((x) => ({ ...x, [l.posicion]: { ...(x[l.posicion] || {}), nota: v } }))}
                        placeholder={d.motivo === 'Otro' ? '¿Cuál es el motivo? (obligatorio)' : 'Nota (opcional)'} />
                    </View>
                  ) : null}
                  {decide && d.decision === DECISIONES_ENVIO.noLlego ? (
                    <Campo value={d.nota ?? ''} onChangeText={(v) => setDecision((x) => ({ ...x, [l.posicion]: { ...(x[l.posicion] || {}), nota: v } }))}
                      placeholder="¿Qué pasó? (opcional)" />
                  ) : null}
                  {l.motivo_rechazo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{l.motivo_rechazo}{l.nota_rechazo ? `: ${l.nota_rechazo}` : ''}</Text> : null}
                  {l.error ? <Text style={{ color: MARCA.rojo, fontSize: 13 }}>{l.error}</Text> : null}
                </View>
              </Vidrio>
            );
          })}

          {momento === 'por_decidir' && porDecidir.length ? (
            <View style={{ gap: 12 }}>
              <BotonGrande texto={falta ? `Guardar (${decisiones.length} de ${porDecidir.length})` : 'Guardar lo que decidí'} color={MARCA.azul}
                deshabilitado={ocupado || !decisiones.length || incompleta} onPress={() => confirmar(decisiones)} />
              <BotonGrande texto="Aceptar todo" color={MARCA.verde} borde deshabilitado={ocupado} onPress={aceptarTodo} />
            </View>
          ) : null}

          {momento === 'por_recibir_devolucion' ? (
            <BotonGrande texto="Ya volvió, recibir lo devuelto" color={MARCA.verde} deshabilitado={ocupado} onPress={recibirLoDevuelto} />
          ) : null}

          {momento === 'por_despachar' ? (
            <View style={{ gap: 12 }}>
              <BotonGrande texto="Volver a intentar el envío" color={MARCA.azul} deshabilitado={ocupado} onPress={reintentar} />
              {!salioAlgo ? (
                <>
                  <Campo value={motivoCancelar} onChangeText={setMotivoCancelar} placeholder="Para cancelar: ¿por qué? (obligatorio)" />
                  <BotonGrande texto="Cancelar el envío" color={MARCA.rojo} borde deshabilitado={ocupado || !motivoCancelar.trim()} onPress={cancelar} />
                </>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
