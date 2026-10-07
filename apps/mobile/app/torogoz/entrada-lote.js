// Entrada de lote de Torogoz, NATIVO — el `EntradaModal` del inventario del
// portal: el producto del catálogo (con buscador o escaneando la caja), el
// lote como viene en la caja, el vencimiento, las unidades sueltas y una nota.
// Escribe con la misma función de la base (`entradaDeLote`), que deja el
// movimiento. Se escribe con la caja en la mano y la sesión se cierra sola: lo
// escrito se guarda como borrador.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { fetchCatalogo, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { entradaDeLote } from '@nucleo/data/distribucionInventario';
import { leerEntero, productoPorCodigo } from '@nucleo/utils/distribucionBodega';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { formatQty } from '@nucleo/utils/formatNumber';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useStaffStore } from '@nucleo/store/staffStore';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import Escaner from '../../componentes/Escaner';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';
import { volver } from '../../componentes/volver';
import FechaOpcional from '../../componentes/torogoz/bodega/FechaOpcional';
import { PETROLEO, confirmar } from '../../componentes/torogoz/bodega/piezas';

const VACIA = { productoId: '', lote: '', vence: '', unidades: '', nota: '' };

export default function EntradaDeLote() {
  const { emisor } = useLocalSearchParams();
  const emisorId = emisor ? Number(emisor) : null;
  const llave = emisorId ? `distribucion-entrada-lote-${emisorId}` : null;
  const [f, setF] = useState(() => ({ ...VACIA, ...((llave && loadDraft(llave)) || {}) }));
  const [catalogo, setCatalogo] = useState(null);
  const [texto, setTexto] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const poner = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    let vivo = true;
    fetchCatalogo().then((r) => { if (vivo) setCatalogo(r); })
      .catch(() => { if (vivo) { setCatalogo([]); fallo('Sin catálogo', 'No se pudo cargar el catálogo de la distribuidora.'); } });
    return () => { vivo = false; };
  }, []);
  useEffect(() => { if (llave && (f.productoId || f.lote || f.unidades)) saveDraft(llave, f); }, [llave, f]);

  const opciones = useMemo(() => {
    const q = texto.trim();
    return (catalogo ?? []).filter((p) => !q || tokenMatch(q, p.nombre)).slice(0, 30).map((p) => ({ id: String(p.product_id), label: p.nombre }));
  }, [catalogo, texto]);
  const producto = (catalogo ?? []).find((p) => String(p.product_id) === String(f.productoId));
  const cant = leerEntero(f.unidades);
  const falta = !emisorId ? 'Faltan los datos de la empresa que factura.' : !f.productoId ? 'Elige el producto.' : !f.lote.trim() ? 'Escribe el lote como viene en la caja.'
    : !(cant > 0) ? 'Escribe un número entero de unidades.' : null;

  const alEscanear = (codigo) => {
    const p = productoPorCodigo(catalogo, codigo);
    if (!p) { fallo('Código sin producto', `${codigo} no es de ningún producto del catálogo de la distribuidora.`); return false; }
    setEscaneando(false);
    setF((x) => ({ ...x, productoId: String(p.product_id) }));
    return true;
  };

  const guardar = async () => {
    if (falta || guardando) return;
    const lote = f.lote.trim().toUpperCase();
    const ok = await confirmar('¿Registrar la entrada?',
      `${producto?.nombre} · lote ${lote} · ${formatQty(cant)} unidades · vence ${f.vence ? fechaNumerica(f.vence) : 'sin fecha'}.`, 'Registrar');
    if (!ok) return;
    setGuardando(true);
    try {
      const r = await entradaDeLote({ emisorId, productId: Number(f.productoId), lote, vence: f.vence || null, unidades: cant, nota: f.nota.trim() });
      useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_LOTE_ENTRADA', String(r?.lote_id ?? ''),
        { product_id: Number(f.productoId), lote, vence: f.vence || null, unidades: cant, desde: 'app' });
      if (llave) clearDraft(llave);
      listo('Entrada registrada', `${producto?.nombre} · ${formatQty(cant)}`);
      volver('/torogoz/inventario');
    } catch (e) {
      fallo('No se pudo registrar', mensajeDeDistribucion(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Entrada de lote', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
        <Seccion titulo="Producto">
          {catalogo == null ? <ActivityIndicator /> : producto ? (
            <Pressable onPress={() => poner('productoId')('')} style={{ minHeight: 44, justifyContent: 'center' }} accessibilityRole="button">
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{producto.nombre}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Tocar para cambiar</Text>
            </Pressable>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <View style={{ flex: 1 }}><Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Nombre del producto" autoCorrect={false} /></View>
                <Pressable onPress={() => setEscaneando(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Escanear"
                  style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '600' }}>Escanear</Text>
                </Pressable>
              </View>
              {opciones.length ? <Opciones opciones={opciones} valor={f.productoId} color={PETROLEO} onCambiar={poner('productoId')} />
                : <Aviso texto="Ningún producto del catálogo coincide." />}
            </>
          )}
        </Seccion>
        <Seccion titulo="Lote" pie="Como viene en la caja.">
          <Campo multiline={false} value={f.lote} autoCapitalize="characters" autoCorrect={false} onChangeText={(t) => poner('lote')(t.toUpperCase())} placeholder="Lote" />
        </Seccion>
        <Seccion titulo="Vence">
          <FechaOpcional valor={f.vence} onCambiar={poner('vence')} />
        </Seccion>
        <Seccion titulo="Unidades" pie="En unidades sueltas: una caja de 24 son 24.">
          <Campo multiline={false} keyboardType="number-pad" value={f.unidades} onChangeText={poner('unidades')} placeholder="Unidades" />
        </Seccion>
        <Seccion titulo="Nota (opcional)">
          <Campo value={f.nota} onChangeText={poner('nota')} placeholder="Proveedor, número de factura de compra…" />
        </Seccion>
        {falta ? <Aviso texto={falta} /> : null}
        <BotonGrande texto={guardando ? 'Registrando…' : 'Registrar entrada'} color={PETROLEO} onPress={guardar} deshabilitado={!!falta || guardando} />
      </ScrollView>
      <Escaner visible={escaneando} titulo="Escanear producto" ayuda="Apunta al código de barras de la caja." onCodigo={alEscanear} onCerrar={() => setEscaneando(false)} />
    </>
  );
}
