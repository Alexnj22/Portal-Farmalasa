// Un traslado, NATIVO: se abre desde la lista de Traslados, desde una caja
// escaneada o desde un aviso. Hace lo que el portal hace en `DecisionTraslado`
// y `FilaPorRecibir`, con las mismas funciones del núcleo:
//
//   · Si está PENDIENTE y me toca contestar: cuánto sale de cada renglón (la
//     casilla viene puesta en lo que alcanza, `paquetesQueSalen`), «¿por qué no
//     sale todo?» si se recorta, y enviar (`despacharTraslado`) — o rechazar
//     con motivo de la lista cerrada (`rechazarTraslado`), llevando la
//     sugerencia de dónde sí hay.
//   · Si ya salió y es para mi sala: recibir (`recibirTraslado`), anotando lo
//     que faltó renglón por renglón.
//   · Si no: el resumen de cómo terminó.
//
// La existencia se relee AL ABRIR, no al apretar: el número de la casilla tiene
// que ser el de ahora.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchApprovalRequestById } from '@nucleo/data/requests';
import { despacharTraslado, fetchDisponibilidadTraslado, MOTIVOS_RECHAZO, rechazarTraslado, recibirTraslado } from '@nucleo/data/traslados';
import { loQueSeManda, nombreDeLinea, paquetesQueSalen, sugerenciaDeRechazo } from '@nucleo/utils/decisionTraslado';
import { loQueLlego, renglonesDe } from '@nucleo/utils/trasladoTexto';
import { buscadorDePersonas, desdeHace, motivoDeRechazo } from '@nucleo/utils/movimientoTexto';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fmtVence } from '@nucleo/utils/pedirTraslado';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Vidrio from '../../componentes/Vidrio';
import Avatar from '../../componentes/Avatar';
import { Pildora, Ruta } from '../../componentes/traslados/Tarjeta';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

function Bloque({ titulo, children }) {
  return (
    <View style={{ gap: 7 }}>
      {titulo ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>{titulo}</Text> : null}
      <Vidrio radio={20}><View style={{ padding: 14, gap: 10 }}>{children}</View></Vidrio>
    </View>
  );
}

function Cantidad({ valor, max, onCambiar, etiqueta }) {
  const n = Number(valor) || 0;
  const mover = (d) => { const v = Math.max(0, Math.min(max, n + d)); if (v !== n) { Haptics.selectionAsync().catch(() => {}); onCambiar(String(v)); } };
  const Boton = ({ d, texto }) => (
    <Pressable onPress={() => mover(d)} hitSlop={6} accessibilityLabel={`${d > 0 ? 'Más' : 'Menos'} ${etiqueta}`}
      style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
        backgroundColor: pressed ? 'rgba(127,127,127,0.35)' : 'rgba(127,127,127,0.2)' })}>
      <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '600', marginTop: -2 }}>{texto}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Boton d={-1} texto="−" />
      <TextInput value={String(valor ?? '')} onChangeText={(t) => onCambiar(t.replace(/\D/g, ''))} keyboardType="number-pad"
        style={{ width: 44, textAlign: 'center', color: colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}
        accessibilityLabel={`Cuántos ${etiqueta}`} />
      <Boton d={1} texto="+" />
    </View>
  );
}

function Campo(props) {
  return (
    <TextInput placeholderTextColor={colorSistema.texto2} multiline {...props}
      style={{ minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colorSistema.texto,
        backgroundColor: 'rgba(127,127,127,0.16)' }} />
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

export default function Traslado() {
  const { id } = useLocalSearchParams();
  const { user, hasPermission, getScope } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const persona = useMemo(() => buscadorDePersonas(empleados), [empleados]);
  const [fila, setFila] = useState(undefined);
  const [disp, setDisp] = useState(null);
  const [cuantos, setCuantos] = useState({});
  const [porQue, setPorQue] = useState('');
  const [modo, setModo] = useState(null);          // null | 'rechazo'
  const [motivo, setMotivo] = useState(null);
  const [texto, setTexto] = useState('');
  const [faltan, setFaltan] = useState({});
  const [notaFalta, setNotaFalta] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error } = await fetchApprovalRequestById(id);
    setFila(error ? null : data);
    if (data?.status === 'PENDING') {
      const r = await fetchDisponibilidadTraslado(id);
      if (!r.error) {
        const d = r.disponibilidad;
        const items = data.metadata?.items || [];
        const lin = Array.isArray(d?.lineas) ? d.lineas : [];
        setDisp(d);
        setCuantos(Object.fromEntries(lin.map((l) => [l.idx, String(paquetesQueSalen(l, items[l.idx]))])));
        // Sin nada en físico la única salida es rechazar, con el motivo puesto.
        if (lin.length && lin.every((l) => paquetesQueSalen(l, items[l.idx]) === 0)) { setModo('rechazo'); setMotivo('Sin existencia en físico'); }
      }
    }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  if (fila === undefined) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Traslado' }} /><Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 140 }}>Cargando…</Text></>;
  if (!fila) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Traslado' }} /><Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 140 }}>Este traslado ya no está disponible.</Text></>;

  const m = fila.metadata ?? {};
  const items = Array.isArray(m.items) ? m.items : [];
  const lineas = Array.isArray(disp?.lineas) ? disp.lineas : [];
  const miSala = String(salaDelUsuario(user) ?? '');
  const todas = getScope?.('traslados') === 'ALL';
  const pendiente = fila.status === 'PENDING';
  const enCamino = fila.status === 'APPROVED' && m.erp_traslado && !m.erp_recibido;
  const puedeContestar = pendiente && hasPermission('traslados', 'can_approve');
  const puedeRecibir = enCamino && hasPermission('traslados', 'can_approve')
    && (todas || String(m.branch_id) === miSala || String(fila.employee_id) === String(user?.id));
  const { aceptadas, hayQueMandar, recortado, nadaEnFisico } = loQueSeManda(lineas, items, cuantos);
  const sugerencia = sugerenciaDeRechazo(lineas, items);
  const pide = persona(fila.employee_id);

  const enviar = async () => {
    setOcupado(true); trabajando('Enviando traslado…');
    const r = await despacharTraslado(fila.id, recortado ? porQue.trim() : '', recortado ? aceptadas : null);
    setOcupado(false);
    if (!r?.ok) {
      const { data: otra } = await fetchApprovalRequestById(fila.id).catch(() => ({ data: null }));
      if (otra?.status !== 'APPROVED') { fallo('No se pudo enviar', r?.error ?? 'Inténtalo de nuevo.'); return; }
    }
    listo(recortado ? 'Enviado lo que hay' : 'Traslado enviado', 'El ticket de la bolsa se imprime en la computadora de la sala.');
    router.back();
  };

  const rechazar = async () => {
    setOcupado(true); trabajando('Rechazando…');
    const { error } = await rechazarTraslado(fila.id, motivo, texto.trim(), sugerencia);
    setOcupado(false);
    if (error) { fallo('No se pudo rechazar', error.message ?? String(error)); return; }
    listo('Traslado rechazado', sugerencia ? `Se le sugirió: ${sugerencia}` : undefined);
    router.back();
  };

  const llegaron = loQueLlego(m);
  const faltantes = llegaron.map((l) => ({ posicion: l.posicion, cantidad: Number(faltan[l.posicion]) || 0, nota: notaFalta.trim() }))
    .filter((f) => f.cantidad > 0);
  const recibir = async () => {
    setOcupado(true); trabajando('Recibiendo…');
    const r = await recibirTraslado(fila.id, faltantes);
    setOcupado(false);
    if (!r?.ok && r?.codigo !== 'YA_RECIBIDO') { fallo('No se pudo recibir', r?.error ?? 'Inténtalo de nuevo.'); return; }
    if (r?.faltante_error) fallo('Recibido, pero sin anotar lo que faltó', r.faltante_error);
    else listo(r?.codigo === 'YA_RECIBIDO' ? 'Ya estaba recibido' : 'Recibido', faltantes.length ? `Se avisó a ${m.origen_branch_name ?? 'la sala'} lo que faltó.` : undefined);
    router.back();
  };

  const estado = pendiente ? { texto: 'Por contestar', color: MARCA.ambar }
    : fila.status === 'REJECTED' ? { texto: 'Rechazado', color: MARCA.rojo }
    : m.erp_recibido ? { texto: 'Recibido', color: MARCA.verde }
    : enCamino ? { texto: 'En camino', color: MARCA.azulClaro } : { texto: fila.status, color: '#8E8E93' };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Traslado' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} />}>

          {/* Quién pide, de dónde a dónde, y cuándo. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar empleado={pide} tamano={52} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 19, fontWeight: '700' }}>{shortEmployeeName(pide)}</Text>
              <Ruta desde={m.origen_branch_name} hacia={m.branch_name} />
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Pidió {desdeHace(fila.created_at, Date.now())}</Text>
            </View>
            <Pildora texto={estado.texto} color={estado.color} />
          </View>

          {/* Qué se pide: renglones y lotes. Mientras se contesta, cada renglón
              lleva su casilla. */}
          <Bloque titulo={puedeContestar && !modo && lineas.length ? 'Cuánto envías' : 'Lo que se pide'}>
            {renglonesDe(m).map((r, i) => {
              const l = lineas.find((x) => x.idx === r.idx);
              const max = l ? paquetesQueSalen(l, items[r.idx]) : 0;
              const sale = Math.min(Number(cuantos[r.idx]) || 0, r.cantidad);
              const factor = Number(items[r.idx]?.factor) || 1;
              const queda = (l?.unidades ?? 0) - sale * factor;
              const editar = puedeContestar && !modo && l && !nadaEnFisico;
              return (
                <View key={r.idx} style={{ gap: 4, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{r.nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                        {editar ? `de ${r.cantidad} ${r.presentacion}${max < r.cantidad ? ` · alcanza para ${max}` : ''}` : `${r.cantidad} ${r.presentacion}`}
                      </Text>
                    </View>
                    {editar ? <Cantidad valor={cuantos[r.idx] ?? ''} max={r.cantidad} etiqueta={nombreDeLinea(l, items)} onCambiar={(v) => setCuantos((c) => ({ ...c, [r.idx]: v }))} /> : null}
                  </View>
                  {r.lotes.map((lt, j) => (
                    <Text key={j} style={{ color: colorSistema.texto2, fontSize: 12 }}>Lote {lt.lote || '—'}{lt.vence ? ` · vence ${fmtVence(lt.vence)}` : ''}{lt.unidades ? ` · ${lt.unidades} u.` : ''}</Text>
                  ))}
                  {/* El mínimo INFORMA, no impide (decisión del usuario, 2026-08-06). */}
                  {editar && sale > 0 && (l.minimo ?? 0) > 0 && queda < l.minimo ? (
                    <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>Te quedas en {queda} y tu mínimo es {l.minimo}.</Text>
                  ) : null}
                </View>
              );
            })}
            {m.reason || fila.note ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Nota: {m.reason || fila.note}</Text> : null}
          </Bloque>

          {/* ── Contestar ── */}
          {puedeContestar && disp?.respaldo ? (
            <Text style={{ color: MARCA.azulClaro, fontSize: 14 }}>{disp.respaldo.sala} está cerrada: lo despachas tú.</Text>
          ) : null}
          {puedeContestar && nadaEnFisico ? (
            <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>
              Ya no puedes enviarlo: quedan {lineas[0]?.unidades ?? 0}.{sugerencia ? ` ${sugerencia}.` : ''}
            </Text>
          ) : null}

          {puedeContestar && !modo ? (
            <View style={{ gap: 12 }}>
              {recortado ? <Campo value={porQue} onChangeText={setPorQue} placeholder="¿Por qué no sale todo?" /> : null}
              <BotonGrande texto={recortado ? 'Enviar lo que hay' : 'Confirmar y enviar'} color={MARCA.verde}
                deshabilitado={ocupado || (lineas.length > 0 && (!hayQueMandar || (recortado && !porQue.trim())))} onPress={enviar} />
              <BotonGrande texto="Rechazar…" color={MARCA.rojo} borde deshabilitado={ocupado} onPress={() => setModo('rechazo')} />
            </View>
          ) : null}

          {puedeContestar && modo === 'rechazo' ? (
            <Bloque titulo="¿Por qué lo rechazas?">
              {MOTIVOS_RECHAZO.map((mo, i) => (
                <Pressable key={mo} onPress={() => { Haptics.selectionAsync().catch(() => {}); setMotivo(mo); }}
                  style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{mo}</Text>
                  {motivo === mo ? <Text style={{ color: MARCA.azulClaro, fontSize: 18, fontWeight: '700' }}>✓</Text> : null}
                </Pressable>
              ))}
              <Campo value={texto} onChangeText={setTexto} placeholder={motivo === 'Otro' ? '¿Cuál es el motivo? (obligatorio)' : 'Algo más que quieras decir (opcional)'} />
              {sugerencia ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Se le va a sugerir: {sugerencia}</Text> : null}
              <BotonGrande texto="Rechazar" color={MARCA.rojo} deshabilitado={ocupado || !motivo || (motivo === 'Otro' && !texto.trim())} onPress={rechazar} />
              {!nadaEnFisico ? <BotonGrande texto="Mejor no" color={colorSistema.texto2} borde onPress={() => { setModo(null); setMotivo(null); }} /> : null}
            </Bloque>
          ) : null}

          {/* ── Recibir ── */}
          {puedeRecibir ? (
            <Bloque titulo="¿Faltó algo?">
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Si llegó todo, deja todo en cero y recibe.</Text>
              {llegaron.map((l) => (
                <View key={l.posicion} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }} numberOfLines={2}>{l.descripcion}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>salieron {l.cantidad}</Text>
                  </View>
                  <Cantidad valor={faltan[l.posicion] ?? '0'} max={l.cantidad} etiqueta={`faltaron de ${l.descripcion}`}
                    onCambiar={(v) => setFaltan((f) => ({ ...f, [l.posicion]: v }))} />
                </View>
              ))}
              {faltantes.length ? <Campo value={notaFalta} onChangeText={setNotaFalta} placeholder="¿Qué pasó? (se le avisa a la sala que envió)" /> : null}
              <BotonGrande texto={faltantes.length ? 'Recibir y anotar lo que faltó' : 'Ya llegó, recibir'} color={MARCA.verde}
                deshabilitado={ocupado} onPress={recibir} />
            </Bloque>
          ) : null}

          {/* ── Cómo terminó ── */}
          {fila.status === 'REJECTED' ? (
            <Bloque titulo="Rechazado">
              <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{motivoDeRechazo(fila) || 'Sin motivo'}</Text>
            </Bloque>
          ) : null}
          {m.erp_traslado ? (
            <Bloque titulo="Seguimiento">
              <Text style={{ color: colorSistema.texto, fontSize: 15 }}>Envió {m.erp_traslado.by_name ?? '—'} · {desdeHace(m.erp_traslado.at, Date.now())}</Text>
              {m.erp_recibido ? <Text style={{ color: colorSistema.texto, fontSize: 15 }}>Recibió {m.erp_recibido.by_name ?? '—'} · {desdeHace(m.erp_recibido.at, Date.now())}</Text> : null}
              {m.erp_traslado.parcial ? <Text style={{ color: MARCA.ambar, fontSize: 13 }}>Salió incompleto{fila.approver_note ? `: ${fila.approver_note}` : ''}</Text> : null}
            </Bloque>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
