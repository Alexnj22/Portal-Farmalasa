// Mantenimiento, NATIVO — `MaintenanceView` en el teléfono, completo:
//   · la franja de aviso que se ve arriba de todo el portal (`AvisoDelPortal`):
//     encenderla o apagarla —con un interruptor que no espera al texto, para una
//     emergencia—, y su texto, la versión corta para el teléfono y el color;
//   · los frenos del movimiento de mercadería, con su interruptor;
//   · los módulos que se pueden poner en mantenimiento, cada uno con su
//     candado: al ponerlo se elige cuánto dura (1–24 h, `HORAS_DE_CANDADO`) y
//     después se le escribe el motivo; tocar uno puesto deja cambiar motivo y
//     duración.
// Todo cambio pide confirmación. Los rótulos de los frenos, el tiempo restante
// y las opciones salen del núcleo (`mantenimiento`, `bannerPortal`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchLockableModules, lockModule, unlockModule } from '@nucleo/data/moduleLocks';
import { fetchTrasladoSwitch, setTrasladoSwitch } from '@nucleo/data/trasladoSwitch';
import { apagarBannerPortal, encenderBannerPortal, guardarBannerPortal, VARIANTES_BANNER } from '@nucleo/data/bannerPortal';
import { useBannerPortal } from '@nucleo/hooks/useBannerPortal';
import { MODULE_INFO } from '@nucleo/constants/permissionModules';
import { HORAS_DE_CANDADO, horasDelCandado, rotuloDeInterruptor, tiempoRestante } from '@nucleo/utils/mantenimiento';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaHora12, hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import ConAurora from '../componentes/ConAurora';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const info = (key) => MODULE_INFO[key] || { label: key, desc: '', group: 'Otros' };

function Fila({ titulo, detalle, extra, valor, onCambiar, ocupado, primero, onTocar }) {
  return (
    <Pressable disabled={!onTocar} onPress={onTocar}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: primero ? 0 : 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{detalle}</Text> : null}
        {extra ? <Text style={{ color: MARCA.ambar, fontSize: 12, fontWeight: '600' }}>{extra}</Text> : null}
      </View>
      {ocupado ? <ActivityIndicator /> : <Switch value={valor} onValueChange={onCambiar} />}
    </Pressable>
  );
}

// La franja del portal. El interruptor y el texto van separados a propósito,
// como en el portal: apagarla en una emergencia no espera a que alguien termine
// de redactar, y el texto queda para la próxima vez.
function Franja() {
  const { banner, recargar } = useBannerPortal();
  const [borrador, setBorrador] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const base = useMemo(() => ({ texto: banner?.texto ?? '', textoCorto: banner?.texto_corto ?? '', variante: banner?.variante ?? 'obra' }), [banner]);
  const { texto, textoCorto, variante } = borrador ?? base;
  const editar = (campo, valor) => setBorrador((d) => ({ ...(d ?? base), [campo]: valor }));
  const sucio = !!borrador && (borrador.texto !== base.texto || borrador.textoCorto !== base.textoCorto || borrador.variante !== base.variante);
  const activo = !!banner?.activo;

  const alternar = (encender) => Alert.alert(encender ? '¿Encender el aviso?' : '¿Apagar el aviso?',
    encender ? 'Aparece arriba de todas las pantallas del portal, para todo el mundo.' : 'La franja desaparece del portal.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: encender ? 'Encender' : 'Apagar', style: encender ? 'destructive' : 'default', onPress: async () => {
        setGuardando(true);
        const { error } = encender ? await encenderBannerPortal({ texto, textoCorto, variante }) : await apagarBannerPortal();
        setGuardando(false);
        if (error) { fallo('Aviso del portal', mensajeAmigable(error)); return; }
        setBorrador(null);
        listo(encender ? 'Aviso encendido' : 'Aviso apagado', encender ? 'Ya se ve en el tope de todas las pantallas.' : 'La franja desapareció del portal.');
        recargar();
      } },
    ]);
  const guardar = async () => {
    setGuardando(true);
    const { error } = await guardarBannerPortal({ activo, texto, textoCorto, variante });
    setGuardando(false);
    if (error) { fallo('Aviso del portal', mensajeAmigable(error)); return; }
    setBorrador(null);
    listo('Aviso guardado', activo ? 'Ya se ve con el texto nuevo.' : 'Queda listo para cuando lo enciendas.');
    recargar();
  };

  return (
    <Seccion titulo="Aviso en el portal" pie="Aparece arriba de todo, para todo el mundo, hasta que lo apagues.">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>Franja de aviso</Text>
          <Text style={{ color: activo ? MARCA.ambar : colorSistema.texto2, fontSize: 12, fontWeight: activo ? '600' : '400' }}>
            {activo ? `Encendida${banner?.cambiado_at ? ` desde ${fechaHora12(banner.cambiado_at)}` : ''}` : 'Apagada'}
          </Text>
        </View>
        {guardando ? <ActivityIndicator /> : <Switch value={activo} onValueChange={(v) => { if (v && !texto.trim()) { fallo('Falta el texto', 'Escribe qué dice el aviso antes de encenderlo.'); return; } alternar(v); }} />}
      </View>
      <Campo value={texto} onChangeText={(v) => editar('texto', v)} placeholder="Texto del aviso" maxLength={240} />
      <Campo multiline={false} value={textoCorto} onChangeText={(v) => editar('textoCorto', v)} placeholder="Versión corta (teléfono)" maxLength={80} />
      <Opciones opciones={VARIANTES_BANNER.map((v) => ({ id: v.value, label: v.label }))} valor={variante} onCambiar={(v) => editar('variante', v)} />
      {sucio ? <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar el texto'} onPress={guardar} deshabilitado={guardando} /> : null}
    </Seccion>
  );
}

// Motivo y duración de un candado puesto.
function EditarCandado({ k, lock, onCerrar, onGuardar }) {
  const [motivo, setMotivo] = useState(lock?.reason ?? '');
  const [horas, setHoras] = useState(lock ? horasDelCandado(lock) : '4');
  if (!k) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{info(k).label}</Text>
            <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text></Pressable>
          </View>
          {lock ? <Aviso texto={`En mantenimiento · ${tiempoRestante(lock.expires_at)}${lock.locked_by_name ? ` · lo puso ${lock.locked_by_name}` : ''}`} /> : null}
          <Seccion titulo="Motivo" pie="Lo ven quienes intenten editar mientras dure.">
            <Campo value={motivo} onChangeText={setMotivo} placeholder="Ej. Reconteo de inventario" />
          </Seccion>
          <Seccion titulo="Duración">
            <Opciones opciones={HORAS_DE_CANDADO.map((h) => ({ id: h.value, label: h.label }))} valor={horas} onCambiar={setHoras} />
          </Seccion>
          <BotonGrande texto="Guardar" onPress={() => onGuardar(k, motivo.trim() || null, Number(horas))} />
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}

export default function Mantenimiento() {
  const { moduleLocks, refreshModuleLocks } = useAuth();
  const [bloqueables, setBloqueables] = useState(null);
  const [traslado, setTraslado] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [texto, setTexto] = useState('');
  const [editando, setEditando] = useState(null);
  const [, setTick] = useState(0);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const [b, t] = await Promise.all([fetchLockableModules(), fetchTrasladoSwitch()]);
    if (b.error || t.error) fallo('Mantenimiento', mensajeAmigable(b.error || t.error));
    setBloqueables((b.data || []).map((m) => m.module_key));
    setTraslado(t.data || []);
    refreshModuleLocks?.();
  }, [refreshModuleLocks]);
  useEffect(() => { cargar(); const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, [cargar]);

  const activos = useMemo(() => {
    const ahora = new Date();
    return Object.fromEntries(Object.values(moduleLocks || {}).filter((l) => new Date(l.expires_at) > ahora).map((l) => [l.module_key, l]));
  }, [moduleLocks]);
  // Por grupo, como el portal; los que están en mantenimiento arriba de su grupo.
  const grupos = useMemo(() => {
    const lista = (bloqueables || []).filter((k) => !texto.trim() || tokenMatch(texto.trim(), info(k).label, info(k).group));
    const porGrupo = new Map();
    for (const k of lista) { const g = info(k).group || 'Otros'; if (!porGrupo.has(g)) porGrupo.set(g, []); porGrupo.get(g).push(k); }
    return [...porGrupo].map(([g, ks]) => [g, ks.sort((a, b) => (!!activos[b] - !!activos[a]) || info(a).label.localeCompare(info(b).label, 'es'))])
      .sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [bloqueables, texto, activos]);
  const envioPausado = (traslado || []).find((t) => t.accion === 'enviar')?.pausado;
  const confirmar = (titulo, mensaje, accion) => Alert.alert(titulo, mensaje, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Sí', style: 'destructive', onPress: accion }]);

  const alternarTraslado = (t, pausar) => {
    const r = rotuloDeInterruptor(t.accion);
    confirmar(pausar ? `¿Pausar «${r.titulo}»?` : `¿Reanudar «${r.titulo}»?`, pausar ? r.pausa : r.reanuda, async () => {
      setOcupado(t.accion); trabajando(pausar ? 'Pausando…' : 'Reanudando…');
      const { error } = await setTrasladoSwitch(t.accion, pausar, null);
      if (error) fallo('Traslados', mensajeAmigable(error)); else { listo(pausar ? 'Movimiento en pausa' : 'Movimiento reanudado', pausar ? r.pausa : r.reanuda); await cargar(); }
      setOcupado(null);
    });
  };
  const poner = (key, motivo, horas, contexto) => (async () => {
    setOcupado(key); trabajando('Guardando…');
    const { error } = await lockModule(key, motivo, horas, contexto);
    if (error) fallo(info(key).label, mensajeAmigable(error)); else { listo(info(key).label, `En mantenimiento por ${horas === 1 ? '1 hora' : `${horas} horas`}.`); await cargar(); }
    setOcupado(null);
  })();
  const alternarModulo = (key, ponerlo) => {
    const nombre = info(key).label;
    if (ponerlo) {
      // Primero cuánto dura; el motivo se escribe después, en su hoja.
      Haptics.selectionAsync().catch(() => {});
      ActionSheetIOS.showActionSheetWithOptions({
        title: `Poner «${nombre}» en mantenimiento`, message: 'Los demás quedan en solo lectura. ¿Por cuánto tiempo?',
        options: [...HORAS_DE_CANDADO.map((h) => h.label), 'Cancelar'], cancelButtonIndex: HORAS_DE_CANDADO.length,
      }, async (i) => {
        if (i >= HORAS_DE_CANDADO.length) return;
        await poner(key, null, Number(HORAS_DE_CANDADO[i].value), { via: 'app' });
        setEditando(key);
      });
      return;
    }
    confirmar(`¿Terminar el mantenimiento de «${nombre}»?`, 'Ya se va a poder editar.', async () => {
      setOcupado(key); trabajando('Guardando…');
      const { error } = await unlockModule(key);
      if (error) fallo(nombre, mensajeAmigable(error)); else { listo(nombre, 'Mantenimiento terminado.'); await cargar(); }
      setOcupado(null);
    });
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Mantenimiento', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Módulo', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Aviso tono="cuidado" texto="El candado detiene personas, no procesos: las actualizaciones automáticas siguen escribiendo." />
        <Franja />
        {traslado == null ? <ActivityIndicator /> : traslado.length ? (
          <Seccion titulo="Movimiento de mercadería">
            {traslado.map((t, i) => {
              const r = rotuloDeInterruptor(t.accion);
              return <Fila key={t.accion} primero={!i} titulo={r.titulo} detalle={r.detalle} extra={t.pausado ? `En pausa desde ${hora12(t.cambiado_at)}` : null}
                valor={!!t.pausado} ocupado={ocupado === t.accion} onCambiar={(v) => alternarTraslado(t, v)} />;
            })}
            {envioPausado ? <Aviso tono="cuidado" texto="Lo que ya salió sigue en camino: deja la recepción abierta para poder cerrarlo." /> : null}
          </Seccion>
        ) : null}
        {bloqueables == null ? <ActivityIndicator /> : (
          <>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>{`${Object.keys(activos).length} módulo${Object.keys(activos).length === 1 ? '' : 's'} en mantenimiento · toca uno puesto para cambiar motivo y duración`}</Text>
            {grupos.map(([g, ks]) => (
              <Seccion key={g} titulo={g}>
                {ks.map((k, i) => {
                  const l = activos[k];
                  return <Fila key={k} primero={!i} titulo={info(k).label}
                    detalle={l ? [l.reason || 'Sin motivo escrito', l.locked_by_name ? `por ${l.locked_by_name}` : null].filter(Boolean).join(' · ') : info(k).desc}
                    extra={l ? tiempoRestante(l.expires_at) : null} valor={!!l} ocupado={ocupado === k}
                    onCambiar={(v) => alternarModulo(k, v)} onTocar={l ? () => setEditando(k) : undefined} />;
                })}
              </Seccion>
            ))}
            {!grupos.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Ningún módulo con ese nombre.</Text> : null}
          </>
        )}
      </ScrollView>
      {editando ? (
        <EditarCandado k={editando} lock={activos[editando]} onCerrar={() => setEditando(null)}
          onGuardar={async (k, motivo, horas) => { setEditando(null); await poner(k, motivo, horas, { via: 'app', edit: 'motivo' }); }} />
      ) : null}
    </>
  );
}
