// Pedir que cuenten, NATIVO — `NuevaConsultaExistencia` del portal: se le
// pregunta a una o varias sucursales cuánto tienen de un producto. La sucursal
// cuenta sin ver la existencia registrada y el portal le dice si cuadra.
//
// Abre con el producto ya elegido cuando viene del inventario (`producto`,
// `nombre`, `sala` = el `erp_sucursal_id` de la tarjeta); si no, se elige con
// el mismo buscador del portal (`buscarProductosMinMax`, dos letras de piso).
// Se puede preguntar a todas, la propia incluida: preguntar no mueve
// existencia. Lo crea `crearConsultaExistencia` (núcleo), con sus mensajes.
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { crearConsultaExistencia, fetchSalasConInventario } from '@nucleo/data/consultasExistencia';
import { buscarProductosMinMax } from '@nucleo/data/minmaxRequests';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { Presionable as Pressable } from '../../componentes/Tocable';
import Indicador from '../../componentes/Indicador';
import MarcaDeEleccion from '../../componentes/MarcaDeEleccion';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, PantallaSinDato, Seccion } from '../../componentes/formulario/Piezas';
import { fallo, listo } from '../../componentes/Progreso';

export default function PedirConteo() {
  const { producto: pId, nombre: pNombre, sala: pSala, motivo: pMotivo } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const fijo = pId ? { id: Number(pId), nombre: String(pNombre ?? '') } : null;
  const [producto, setProducto] = useState(fijo);
  const [salas, setSalas] = useState(null);
  const [elegidas, setElegidas] = useState(() => new Set(pSala ? [Number(pSala)] : []));
  // Desde un conteo llega con el motivo escrito (2026-11-28).
  const [motivo, setMotivo] = useState(pMotivo ? String(pMotivo) : '');
  const [enviando, setEnviando] = useState(false);
  const [texto, setTexto] = useState('');
  const termino = useTextoRebotado(texto, 150).trim();
  const [resultados, setResultados] = useState({ filas: [], aproximado: false, buscando: false });

  useEffect(() => {
    let vivo = true;
    fetchSalasConInventario().then(({ data, error }) => {
      if (!vivo) return;
      if (error) fallo('No se cargaron las sucursales', mensajeAmigable(error));
      setSalas(data ?? []);
    });
    return () => { vivo = false; };
  }, []);
  useEffect(() => {
    if (producto || termino.length < 2) { setResultados({ filas: [], aproximado: false, buscando: false }); return undefined; }
    let vivo = true;
    setResultados((r) => ({ ...r, buscando: true }));
    buscarProductosMinMax(termino, 20).then(({ filas, aproximado }) => { if (vivo) setResultados({ filas: filas ?? [], aproximado, buscando: false }); });
    return () => { vivo = false; };
  }, [termino, producto]);

  if (!hasPermission('conteo_inventario', 'can_edit')) {
    return <PantallaSinDato titulo="Pedir conteo" texto="Tu cargo no puede pedir conteos." />;
  }

  const lista = salas ?? [];
  const todas = lista.length > 0 && lista.every((s) => elegidas.has(s.erp_sucursal_id));
  const alternar = (id) => setElegidas((prev) => {
    const sig = new Set(prev);
    if (sig.has(id)) sig.delete(id); else sig.add(id);
    return sig;
  });
  // Lo que falta, en el mismo orden del portal: el botón se apaga por esto.
  const queFalta = !producto ? 'Elige el producto.' : elegidas.size === 0 ? 'Elige al menos una sucursal.' : null;

  const enviar = async () => {
    if (queFalta || enviando) return;
    setEnviando(true);
    const { error } = await crearConsultaExistencia({ producto: producto.id, salas: [...elegidas], motivo: motivo.trim() || null, origen: 'manual' });
    setEnviando(false);
    if (error) { fallo('No se pidió', mensajeAmigable(error)); return; }
    listo('Conteo pedido', `${elegidas.size === 1 ? 'La sucursal recibió' : `Las ${elegidas.size} sucursales recibieron`} el aviso para contar.`);
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pedir que cuenten', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
          <Aviso texto="La sucursal cuenta sin ver la existencia registrada. El portal le dice si cuadra." />

          <Seccion titulo="Producto">
            {producto ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{producto.nombre}</Text>
                {!fijo ? (
                  <Pressable onPress={() => setProducto(null)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Cambiar</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <>
                <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="¿Qué producto?" autoCorrect={false} />
                {resultados.buscando ? <Indicador /> : null}
                {!resultados.buscando && termino.length >= 2 && !resultados.filas.length ? (
                  <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Sin resultados para «${termino}»`}</Text>
                ) : null}
                {resultados.aproximado && resultados.filas.length ? <Aviso texto="No hay coincidencia exacta. Estos son productos parecidos." /> : null}
                {resultados.filas.map((p) => (
                  <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setProducto({ id: p.id, nombre: p.nombre }); setTexto(''); }}
                    style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingVertical: 6, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.nombre}</Text>
                    {p.principio_activo || p.laboratorio_nombre ? (
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[p.principio_activo, p.laboratorio_nombre].filter(Boolean).join(' · ')}</Text>
                    ) : null}
                  </Pressable>
                ))}
              </>
            )}
          </Seccion>

          <Seccion titulo="Sucursales">
            {salas == null ? <Indicador /> : (
              <>
                <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setElegidas(todas ? new Set() : new Set(lista.map((s) => s.erp_sucursal_id))); }}
                  disabled={!lista.length} style={{ alignSelf: 'flex-end', minHeight: 36, justifyContent: 'center' }}>
                  <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '600' }}>{todas ? 'Ninguna' : 'Todas'}</Text>
                </Pressable>
                {lista.map((s, i) => (
                  <Pressable key={s.erp_sucursal_id} onPress={() => { Haptics.selectionAsync().catch(() => {}); alternar(s.erp_sucursal_id); }}
                    accessibilityRole="checkbox" accessibilityState={{ checked: elegidas.has(s.erp_sucursal_id) }}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{s.nombre}</Text>
                    <MarcaDeEleccion elegida={elegidas.has(s.erp_sucursal_id)} multiple />
                  </Pressable>
                ))}
              </>
            )}
          </Seccion>

          <Seccion titulo="Por qué (opcional)">
            <Campo value={motivo} onChangeText={setMotivo} placeholder="Ej.: cambió el tamaño de la caja" />
          </Seccion>

          <Aviso texto="Si no cuadra, la sucursal vuelve a contar una vez. Si sigue sin cuadrar, un supervisor o administrador hace el ajuste. El resumen le llega al supervisor de ventas, a Bodega y a quien pidió el conteo." />
          {queFalta ? <Aviso tono="cuidado" texto={queFalta} /> : null}
          <BotonGrande texto={enviando ? 'Pidiendo…' : 'Pedir conteo'} deshabilitado={!!queFalta || enviando} onPress={enviar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
