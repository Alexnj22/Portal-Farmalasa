// Agregar un producto a mano a un conteo abierto, NATIVO — `AddManualItemForm`
// del portal. El caso típico: el snapshot trae el lote A y en el estante
// aparece también el B. Presentaciones y lotes de la sala salen del núcleo
// (`opcionesParaAgregarAlConteo`, el mismo que usa el portal); lo agrega
// `agregarProductoManualConteo` (RPC `agregar_item_conteo`, que rechaza el
// duplicado producto + presentación + lote y pone el costo).
//
// El escáner elige solo únicamente si el código da UN producto: con varios,
// la lista queda cargada y la persona dice cuál.
import { useEffect, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { opcionesParaAgregarAlConteo, searchActiveProductsForConteo } from '@nucleo/data/conteoInventario';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import ConAurora from '../ConAurora';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import Fecha from '../formulario/Fecha';
import Escaner from '../Escaner';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

const OTRO = '__OTRO__';

function Fila({ rotulo, valor, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{valor ?? 'Elegir'}  ›</Text>
    </Pressable>
  );
}

export default function AgregarRenglon({ visible, conteoId, branchId, simple = false, onCerrar, onAgregado }) {
  const agregar = useStaffStore((s) => s.agregarProductoManualConteo);
  const [texto, setTexto] = useState('');
  const termino = useTextoRebotado(texto).trim();
  const [resultados, setResultados] = useState([]);
  const [producto, setProducto] = useState(null);
  const [opciones, setOpciones] = useState(null);
  const [presentacion, setPresentacion] = useState('');
  const [lote, setLote] = useState('');
  const [loteOtro, setLoteOtro] = useState('');
  const [vence, setVence] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (visible) return;
    setTexto(''); setResultados([]); setProducto(null); setOpciones(null); setAviso(null);
    setPresentacion(''); setLote(''); setLoteOtro(''); setVence('');
  }, [visible]);

  useEffect(() => {
    if (producto || termino.length < 2) { if (!producto) setResultados([]); return; }
    let vivo = true;
    searchActiveProductsForConteo(termino).then(({ data }) => { if (vivo) setResultados(data || []); });
    return () => { vivo = false; };
  }, [termino, producto]);

  const elegir = async (p) => {
    Haptics.selectionAsync().catch(() => {});
    setProducto(p); setOpciones(null); setPresentacion(''); setLote(''); setLoteOtro(''); setVence('');
    const o = await opcionesParaAgregarAlConteo(p.id, branchId, simple);
    setOpciones(o);
    if (o.presentaciones.length === 1) setPresentacion(o.presentaciones[0]);
  };

  const porCodigo = async (codigo) => {
    setEscaneando(false);
    setAviso(null);
    try {
      const { data, error } = await searchActiveProductsForConteo(String(codigo));
      if (error) throw error;
      const filas = data || [];
      if (filas.length === 1) { elegir(filas[0]); return; }
      setTexto(String(codigo));
      setResultados(filas);
      setAviso(filas.length ? `El código ${codigo} coincide con ${filas.length} productos: elige cuál.` : `Ningún producto con el código ${codigo}.`);
    } catch (e) {
      setAviso(`No se pudo buscar el código: ${mensajeAmigable(e)}`);
    }
  };

  const hoja = (titulo, lista, alElegir) => {
    Haptics.selectionAsync().catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions(
      { title: titulo, options: [...lista.map((x) => x.label), 'Cancelar'], cancelButtonIndex: lista.length },
      (i) => { if (i < lista.length) alElegir(lista[i]); },
    );
  };

  const loteFinal = lote === OTRO ? loteOtro.trim() : lote;
  const puede = producto && presentacion && (simple || loteFinal);

  const guardar = async () => {
    if (!puede || guardando) return;
    setGuardando(true);
    try {
      await agregar(conteoId, {
        erpProductId: producto.id, presentacion,
        lote: simple ? null : loteFinal, fechaVencimiento: simple ? null : (vence || null),
      });
      listo('Producto agregado', producto.nombre);
      onAgregado?.(producto);
      onCerrar();
    } catch (e) {
      fallo('No se agregó el producto', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>Agregar un renglón</Text>
              <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text>
              </Pressable>
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
              {`Para un producto que no estaba en la hoja${simple ? '.' : ', o para un lote que no venía.'}`}
            </Text>

            {producto ? (
              <Seccion titulo="Producto">
                <Pressable onPress={() => { setProducto(null); setOpciones(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{producto.nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                      {[producto.laboratorios?.nombre, producto.codigo_barras].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Cambiar</Text>
                </Pressable>
              </Seccion>
            ) : (
              <Seccion titulo="Producto">
                <Campo multiline={false} value={texto} onChangeText={(t) => { setTexto(t); setAviso(null); }} placeholder="Nombre, laboratorio o código" autoCorrect={false} />
                <BotonGrande texto="Escanear el código" borde color={MARCA.azul} onPress={() => setEscaneando(true)} />
                {aviso ? <Aviso tono="nota" texto={aviso} /> : null}
                {resultados.slice(0, 10).map((p, i) => (
                  <Pressable key={p.id} onPress={() => elegir(p)}
                    style={({ pressed }) => ({ paddingVertical: 9, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.nombre}</Text>
                    {p.laboratorios?.nombre ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{p.laboratorios.nombre}</Text> : null}
                  </Pressable>
                ))}
              </Seccion>
            )}

            {producto ? (
              opciones == null ? <ActivityIndicator /> : (
                <Seccion titulo={simple ? 'Cómo viene' : 'Presentación, lote y vencimiento'}>
                  {opciones.presentaciones.length ? (
                    <Fila rotulo="Presentación" valor={presentacion || null}
                      onPress={() => hoja('Presentación', opciones.presentaciones.map((t) => ({ label: t, value: t })), (o) => setPresentacion(o.value))} />
                  ) : <Aviso tono="freno" texto="Este producto no tiene ninguna presentación activa." />}
                  {!simple ? (
                    <>
                      <View style={{ borderTopWidth: 0.5, borderTopColor: colorSistema.separador }} />
                      <Fila rotulo="Lote" valor={lote === OTRO ? 'Otro' : (lote || null)}
                        onPress={() => hoja('Lote', [
                          ...opciones.lotes.map((l) => ({ label: `${l.lote}${l.fecha ? ` · vence ${fechaTexto(l.fecha, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`, value: l.lote, fecha: l.fecha })),
                          { label: 'Otro lote…', value: OTRO },
                        ], (o) => { setLote(o.value); setVence(o.value === OTRO ? '' : (o.fecha || '')); })} />
                      {lote === OTRO ? <Campo multiline={false} value={loteOtro} onChangeText={setLoteOtro} placeholder="Número de lote" autoCapitalize="characters" autoCorrect={false} /> : null}
                      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Vence</Text>
                        {vence ? <Fecha valor={vence} onCambiar={setVence} /> : null}
                        <Pressable onPress={() => setVence(vence ? '' : (opciones.lotes.find((l) => l.lote === lote)?.fecha || hoySV()))} hitSlop={8} style={{ marginLeft: 10 }}>
                          <Text style={{ color: colorSistema.acento, fontSize: 15 }}>{vence ? 'Quitar' : 'Poner fecha'}</Text>
                        </Pressable>
                      </View>
                    </>
                  ) : null}
                </Seccion>
              )
            ) : null}

            {producto && opciones && !puede ? <Aviso texto={!presentacion ? 'Falta elegir la presentación.' : 'Falta el lote.'} /> : null}
            <BotonGrande texto={guardando ? 'Agregando…' : 'Agregar al conteo'} onPress={guardar} deshabilitado={!puede || guardando} />
          </ScrollView>
        </KeyboardAvoidingView>
      </ConAurora>
      <Escaner visible={escaneando} titulo="Agregar al conteo" ayuda="Apunta al código de barras del producto" onCodigo={porCodigo} onCerrar={() => setEscaneando(false)} />
    </Modal>
  );
}

