// «¿Hay en alguna sala?», NATIVO — `ExistenciasSucursales` del portal en una
// hoja: la existencia de un producto en las siete sucursales (Bodega
// incluida), sin salir de lo que se está haciendo. Sale de
// `buscar_inventario_global_v2`, la misma búsqueda del Panel de inventario;
// el núcleo (`existenciasPorProducto`) la suma por producto y sala. Sólo
// lectura. La abren Inventario y la venta en ruta.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { buscarInventarioGlobalV2 } from '@nucleo/data/inventory';
import { ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { existenciasPorProducto } from '@nucleo/utils/distribucionBodega';
import { formatQty } from '@nucleo/utils/formatNumber';
import ConAurora from '../../ConAurora';
import { colorSistema } from '../../Formulario';
import { Aviso, Campo, Seccion } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { Chapa } from './piezas';

export default function Existencias({ visible = true, terminoInicial = '', onCerrar }) {
  const [termino, setTermino] = useState(terminoInicial);
  const [filas, setFilas] = useState(null);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const pedido = useRef(0);

  useEffect(() => { if (visible) setTermino(terminoInicial); }, [visible, terminoInicial]);
  useEffect(() => {
    const q = termino.trim();
    if (!visible || q.length < 2) return undefined;
    const mio = ++pedido.current;
    const t = setTimeout(async () => {
      setCargando(true);
      setError('');
      const r = await buscarInventarioGlobalV2(q, 30);
      if (mio !== pedido.current) return;
      setCargando(false);
      if (r.error) { setError('No se pudo buscar. Revisa la conexión e intenta de nuevo.'); return; }
      setFilas(r.filas);
      setTotal(r.total);
    }, 300);
    return () => clearTimeout(t);
  }, [termino, visible]);

  const productos = useMemo(() => existenciasPorProducto(filas), [filas]);
  const corto = termino.trim().length < 2;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 4 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>Existencias en las sucursales</Text>
            <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Listo</Text>
            </Pressable>
          </View>
          <Campo multiline={false} value={termino} autoFocus autoCorrect={false} placeholder="Producto (nombre o código)" onChangeText={setTermino}
            clearButtonMode="while-editing" />
          {cargando ? <ActivityIndicator /> : null}
          {error ? <Aviso tono="freno" texto={error} /> : null}
          {corto ? <Aviso texto="Escribe al menos dos letras." /> : null}
          {filas && !corto && !cargando && productos.length === 0 ? <Aviso texto="Ninguna sucursal tiene ese producto." /> : null}
          {!corto ? productos.map((p) => {
            const suma = ERP_ORDEN.reduce((t, s) => t + (p.salas.get(s) ?? 0), 0);
            return (
              <Seccion key={p.id}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{p.nombre}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 14, fontVariant: ['tabular-nums'] }}>{`${formatQty(suma)} en total`}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {ERP_ORDEN.map((s) => {
                    const n = p.salas.get(s) ?? 0;
                    return <Chapa key={s} variante={n > 0 ? 'success' : 'neutral'} texto={`${ERP_NAMES[s]}: ${formatQty(n)}`} />;
                  })}
                </View>
              </Seccion>
            );
          }) : null}
          {!corto && total > productos.length && productos.length > 0
            ? <Aviso texto={`Se muestran ${productos.length} de ${total}: escribe más para acotar.`} /> : null}
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}
