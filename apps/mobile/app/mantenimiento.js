// Mantenimiento, NATIVO — `MaintenanceView` en el teléfono, para actuar rápido:
// los frenos del movimiento de mercadería (sacar de bodega, recibir en la
// sala, devoluciones, sobrantes) con su interruptor, y los módulos que se
// pueden poner en mantenimiento (los demás quedan en solo lectura), con lo
// que le queda a cada candado. Todo cambio pide confirmación.
//
// Los rótulos de los frenos y el tiempo restante salen del núcleo
// (`mantenimiento`); qué módulos se pueden bloquear lo decide la base. El
// motivo, la duración y el aviso del portal se ajustan en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchLockableModules, lockModule, unlockModule } from '@nucleo/data/moduleLocks';
import { fetchTrasladoSwitch, setTrasladoSwitch } from '@nucleo/data/trasladoSwitch';
import { MODULE_INFO } from '@nucleo/constants/permissionModules';
import { rotuloDeInterruptor, tiempoRestante } from '@nucleo/utils/mantenimiento';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const info = (key) => MODULE_INFO[key] || { label: key, desc: '', group: 'Otros' };

function Fila({ titulo, detalle, extra, valor, onCambiar, ocupado, primero }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: primero ? 0 : 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{detalle}</Text> : null}
        {extra ? <Text style={{ color: MARCA.ambar, fontSize: 12, fontWeight: '600' }}>{extra}</Text> : null}
      </View>
      {ocupado ? <ActivityIndicator /> : <Switch value={valor} onValueChange={onCambiar} />}
    </View>
  );
}

export default function Mantenimiento() {
  const { moduleLocks, refreshModuleLocks } = useAuth();
  const [bloqueables, setBloqueables] = useState(null);
  const [traslado, setTraslado] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [texto, setTexto] = useState('');
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
  const lista = useMemo(() => (bloqueables || []).filter((k) => !texto.trim() || tokenMatch(texto.trim(), info(k).label, info(k).group))
    .sort((a, b) => (!!activos[b] - !!activos[a]) || info(a).label.localeCompare(info(b).label, 'es')), [bloqueables, texto, activos]);
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
  const alternarModulo = (key, poner) => {
    const nombre = info(key).label;
    confirmar(poner ? `¿Poner «${nombre}» en mantenimiento?` : `¿Terminar el mantenimiento de «${nombre}»?`,
      poner ? 'Los demás quedan en solo lectura por 4 horas. El motivo y la duración se ajustan en el portal.' : 'Ya se va a poder editar.', async () => {
        setOcupado(key); trabajando('Guardando…');
        const { error } = poner ? await lockModule(key, null, 4, { via: 'app' }) : await unlockModule(key);
        if (error) fallo(nombre, mensajeAmigable(error)); else { listo(nombre, poner ? 'En mantenimiento.' : 'Mantenimiento terminado.'); await cargar(); }
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 14, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <View style={{ marginHorizontal: 16 }}>
          <Aviso tono="cuidado" texto="El candado detiene personas, no procesos: las actualizaciones automáticas siguen escribiendo." />
        </View>
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
          <Seccion titulo={`Módulos · ${Object.keys(activos).length} en mantenimiento`}>
            {lista.map((k, i) => {
              const l = activos[k];
              return <Fila key={k} primero={!i} titulo={info(k).label} detalle={l ? [l.reason, `por ${l.locked_by_name ?? '—'}`].filter(Boolean).join(' · ') : info(k).group}
                extra={l ? tiempoRestante(l.expires_at) : null} valor={!!l} ocupado={ocupado === k} onCambiar={(v) => alternarModulo(k, v)} />;
            })}
            {!lista.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Ningún módulo con ese nombre.</Text> : null}
          </Seccion>
        )}
        <View style={{ marginHorizontal: 16 }}>
          <BotonGrande texto="Motivo, duración y aviso (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/mantenimiento', nombre: 'Mantenimiento' } })} />
        </View>
      </ScrollView>
    </>
  );
}
