// «Venta perdida», NATIVO — el `VentaPerdidaModal` del portal en una hoja:
// lo que un cliente pidió y no se le pudo vender. Tres caminos, y la fila
// guarda cuál fue (`origen`), porque de eso depende cuánto se le cree al
// nombre:
//   · catalogo — viene de la venta: un producto del catálogo sin existencia.
//   · srs      — un medicamento elegido del registro de la SRS (nombre,
//                principio activo, laboratorio y registro salen de ahí).
//   · insumo   — lo que no está en la SRS: el nombre a mano.
//
// La usan Ventas perdidas y la venta en ruta. Escribe con la misma función
// del portal (`anotarVentaPerdida`) y la misma línea de bitácora.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { buscarEnSrs } from '@nucleo/data/srs';
import { anotarVentaPerdida, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { medicamentoDeSrs } from '@nucleo/utils/distribucionBodega';
import { leerMonto } from '@nucleo/utils/distribucionComun';
import { useStaffStore } from '@nucleo/store/staffStore';
import ConAurora from '../../ConAurora';
import Segmentos from '../../Segmentos';
import { colorSistema } from '../../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { fallo, listo } from '../../Progreso';
import { PETROLEO, confirmar } from './piezas';

const TIPOS = [{ id: 'medicamento', label: 'Medicamento' }, { id: 'insumo', label: 'Insumo' }];

/**
 * @param producto   del catálogo, cuando viene de la venta: { product_id, nombre, motivo }
 * @param onGuardado ({ id, producto, cantidad }) => void
 */
export default function VentaPerdida({ visible = true, emisorId, cliente = null, pedidoId = null, producto = null, cantidad = 1, buscado = '', onCerrar, onGuardado }) {
  const desdeCatalogo = !!producto;
  const [tipo, setTipo] = useState('medicamento');
  const [q, setQ] = useState(buscado);
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [errorSrs, setErrorSrs] = useState('');
  const [elegido, setElegido] = useState(null);
  const [nombreInsumo, setNombreInsumo] = useState(buscado);
  const [cant, setCant] = useState(String(cantidad || 1));
  const [guardando, setGuardando] = useState(false);
  const pedido = useRef(0);

  // La búsqueda en la SRS sale sola al escribir (con pausa), como en el portal.
  useEffect(() => {
    if (desdeCatalogo || tipo !== 'medicamento') return undefined;
    const texto = q.trim();
    if (texto.length < 3) return undefined;
    const mio = ++pedido.current;
    const t = setTimeout(async () => {
      setBuscando(true);
      setErrorSrs('');
      try {
        const json = await buscarEnSrs(texto, { porPagina: 8 });
        if (mio !== pedido.current) return;
        setResultados((json.data ?? []).map(medicamentoDeSrs).filter((r) => r.nombre));
      } catch {
        if (mio !== pedido.current) return;
        setErrorSrs('El registro de la SRS no respondió. Si es urgente, anótalo como insumo con el nombre.');
        setResultados(null);
      } finally {
        if (mio === pedido.current) setBuscando(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [q, tipo, desdeCatalogo]);

  const n = leerMonto(cant);
  const nombreFinal = desdeCatalogo ? producto.nombre : tipo === 'medicamento' ? elegido?.nombre : nombreInsumo.trim();
  const falta = !nombreFinal ? (tipo === 'medicamento' && !desdeCatalogo ? 'Elige el medicamento de la lista.' : 'Escribe el nombre del insumo.')
    : !(n > 0) ? 'La cantidad tiene que ser mayor que cero.' : null;

  const guardar = async () => {
    if (falta || guardando) return;
    const ok = await confirmar('¿Anotar la venta perdida?', `${nombreFinal} · ${n}${cliente?.nombre ? ` · ${cliente.nombre}` : ''}. Queda en la lista para comprarlo.`, 'Anotar');
    if (!ok) return;
    setGuardando(true);
    const origen = desdeCatalogo ? 'catalogo' : tipo === 'medicamento' ? 'srs' : 'insumo';
    try {
      const id = await anotarVentaPerdida({
        emisorId, clienteId: cliente?.id, productId: producto?.product_id ? Number(producto.product_id) : null, pedidoId,
        origen, producto: nombreFinal, cantidad: n, buscado: desdeCatalogo ? null : q,
        registroSrs: origen === 'srs' ? elegido.registro : null,
        principioActivo: origen === 'srs' ? elegido.principio : null,
        laboratorio: origen === 'srs' ? elegido.laboratorio : null,
      });
      useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_VENTA_PERDIDA', String(id), { origen, producto: nombreFinal, cantidad: n, desde: 'app' });
      listo('Venta perdida anotada', nombreFinal);
      onGuardado?.({ id, producto: nombreFinal, cantidad: n });
    } catch (e) {
      fallo('No se pudo anotar', mensajeDeDistribucion(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={guardando ? undefined : onCerrar}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 4 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }} numberOfLines={1}>
              {`Venta perdida${cliente?.nombre ? ` · ${cliente.nombre}` : ''}`}
            </Text>
            <Pressable onPress={onCerrar} disabled={guardando} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cancelar</Text>
            </Pressable>
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>
            Lo que el cliente pidió y no se le pudo vender. Queda en la lista de Ventas perdidas para comprarlo.
          </Text>

          {desdeCatalogo ? (
            <Seccion titulo="Producto">
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{producto.nombre}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{producto.motivo ?? 'Sin existencia'}</Text>
            </Seccion>
          ) : (
            <>
              <Segmentos opciones={TIPOS} activa={tipo} margen={0} onCambiar={(v) => { setTipo(v); setElegido(null); }} />
              {tipo === 'medicamento' ? (
                <Seccion titulo="Buscar en el registro de la SRS">
                  <Campo multiline={false} value={q} autoFocus autoCorrect={false} placeholder="Nombre comercial o principio activo"
                    onChangeText={(t) => { setQ(t); setElegido(null); }} />
                  {buscando ? <ActivityIndicator /> : null}
                  {errorSrs ? <Aviso tono="cuidado" texto={errorSrs} /> : null}
                  {q.trim().length < 3 ? <Aviso texto="Escribe al menos tres letras." /> : null}
                  {resultados && q.trim().length >= 3 && resultados.length === 0 && !buscando ? (
                    <Pressable onPress={() => { setTipo('insumo'); setNombreInsumo(q); }} style={{ minHeight: 44, justifyContent: 'center' }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                        La SRS no tiene nada con ese nombre. <Text style={{ color: MARCA.azulClaro, fontWeight: '700' }}>Anotarlo como insumo</Text>
                      </Text>
                    </Pressable>
                  ) : null}
                  {resultados?.length && q.trim().length >= 3 ? resultados.map((r, k) => {
                    const activo = elegido === r;
                    return (
                      <Pressable key={`${r.registro}-${k}`} accessibilityRole="button" accessibilityState={{ selected: activo }}
                        onPress={() => { Haptics.selectionAsync().catch(() => {}); setElegido(r); }}
                        style={({ pressed }) => ({ flexDirection: 'row', gap: 10, minHeight: 48, paddingVertical: 8, borderTopWidth: k ? 0.5 : 0,
                          borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>
                            {r.nombre}{!r.activo ? <Text style={{ color: colorSistema.texto2, fontWeight: '400', fontSize: 13 }}> · registro inactivo</Text> : null}
                          </Text>
                          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                            {[r.principio, r.forma, r.laboratorio, r.registro && `Reg. ${r.registro}`].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        {activo ? <Text style={{ color: PETROLEO, fontSize: 19, fontWeight: '700' }}>✓</Text> : null}
                      </Pressable>
                    );
                  }) : null}
                </Seccion>
              ) : (
                <Seccion titulo="Nombre del insumo">
                  <Campo multiline={false} value={nombreInsumo} autoFocus onChangeText={setNombreInsumo} placeholder="Ej.: gasa estéril 4x4, jeringa 5 ml" />
                </Seccion>
              )}
            </>
          )}

          <Seccion titulo="Cantidad que pidió">
            <Campo multiline={false} keyboardType="decimal-pad" value={cant} selectTextOnFocus
              onChangeText={(t) => setCant(t.replace(/[^0-9.]/g, ''))} />
          </Seccion>
          {falta ? <Aviso texto={falta} /> : null}
          <BotonGrande texto={guardando ? 'Anotando…' : 'Anotar venta perdida'} color={PETROLEO} onPress={guardar} deshabilitado={!!falta || guardando} />
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}
