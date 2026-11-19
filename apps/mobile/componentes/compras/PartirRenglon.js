// Separar un renglón de la factura en varios productos, NATIVO — el
// `PartirRenglon` del portal: el pack de dos productos distintos que el
// proveedor factura en uno, o el «2 PACK» que se carga por unidad. Lo guarda
// el núcleo (`guardarParticion`), con la misma bitácora.
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { guardarParticion } from '@nucleo/data/cargarCompra';
import { formatMoney } from '@nucleo/utils/formatNumber';
import ConAurora from '../ConAurora';
import EncabezadoDeHoja from '../EncabezadoDeHoja';
import Interruptor from '../Interruptor';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';
import BuscadorProducto from './BuscadorProducto';
import { Accion, Rotulo } from './carga';

/** El costo repartido según las unidades; el último se queda con el redondeo. */
const parejo = (filas) => {
  const total = filas.reduce((a, f) => a + (Number(f.unidades) || 0), 0);
  if (!(total > 0)) return filas;
  let queda = 100;
  return filas.map((f, k) => {
    if (k === filas.length - 1) return { ...f, porcentaje: String(Math.round(queda * 100) / 100) };
    const p = Math.round((Number(f.unidades) || 0) / total * 10000) / 100;
    queda -= p;
    return { ...f, porcentaje: String(p) };
  });
};
const FILA = { producto: null, unidades: '1', porcentaje: '' };

export default function PartirRenglon({ renglon, partesActuales, llave, emisorNit, documentId, proveedor, onCerrar, onGuardado }) {
  const yaPartido = partesActuales.length > 0;
  const [filas, setFilas] = useState(() => (yaPartido
    ? partesActuales.map((x) => ({ producto: { id: x.parte.product_id, nombre: x.producto }, unidades: String(x.parte.unidades), porcentaje: String(x.parte.porcentaje) }))
    : parejo([{ ...FILA }, { ...FILA }])));
  const [aMano, setAMano] = useState(yaPartido);
  const [recordar, setRecordar] = useState(true);
  const [buscando, setBuscando] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const facturadas = yaPartido ? Number(partesActuales[0].parte.cantidad_factura) : Number(renglon.cantidad);
  const cobradoDe = (x) => Number(x.cantidad) * Number(x.costo) - Number(x.descuento ?? 0);
  const cobrado = yaPartido ? partesActuales.reduce((a, x) => a + cobradoDe(x), 0) : cobradoDe(renglon);
  const poner = (k, cambio) => setFilas((l) => { const n = l.map((f, j) => (j === k ? { ...f, ...cambio } : f)); return aMano ? n : parejo(n); });
  const suma = Math.round(filas.reduce((a, f) => a + (Number(f.porcentaje) || 0), 0) * 100) / 100;
  const ids = filas.map((f) => f.producto?.id).filter(Boolean);
  const problema = filas.some((f) => !f.producto) ? 'Elige el producto de cada parte.'
    : new Set(ids).size !== ids.length ? 'El mismo producto está dos veces. Súmalo en una sola parte.'
    : filas.some((f) => !Number.isInteger(Number(f.unidades)) || Number(f.unidades) < 1) ? 'Las unidades tienen que ser números enteros.'
    : filas.length === 1 && Number(filas[0].unidades) < 2 ? 'Con un solo producto de 1 unidad no hay nada que partir.'
    : filas.some((f) => !(Number(f.porcentaje) > 0)) ? 'Cada parte tiene que llevar algo del costo.'
    : suma !== 100 ? `El costo tiene que sumar 100 % y va en ${suma} %.` : null;

  const guardar = async (partes) => {
    setGuardando(true); trabajando('Guardando…');
    const { error } = await guardarParticion({
      emisorNit, llave, partes, documentId: recordar ? null : documentId,
      contexto: { proveedor, descripcion: renglon.descripcion, documento: documentId, desde: 'app' },
    });
    setGuardando(false);
    if (error) { fallo('No se pudo guardar', error); return; }
    listo(partes.length ? 'Separado en productos' : 'Queda entero');
    onGuardado();
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={() => !guardando && onCerrar()}>
      <ConAurora>
        <EncabezadoDeHoja titulo="Separar en productos" subtitulo={renglon.descripcion} onCerrar={onCerrar} ocupado={guardando} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <Aviso texto={`La factura cobra ${facturadas} × ${formatMoney(cobrado / (facturadas || 1))} = ${formatMoney(cobrado)}. Di qué trae cada una que factura el proveedor.`} />
            {filas.map((f, k) => {
              const entran = facturadas * (Number(f.unidades) || 0);
              const costo = entran > 0 ? cobrado * (Number(f.porcentaje) || 0) / 100 / entran : 0;
              return (
                <Vidrio key={k} radio={20}>
                  <View style={{ padding: 14, gap: 8 }}>
                    <Text style={{ color: f.producto ? colorSistema.texto : colorSistema.texto2, fontSize: 15, fontWeight: '700' }}>{f.producto?.nombre ?? 'Sin producto'}</Text>
                    <View style={{ flexDirection: 'row', gap: 16 }}>
                      <Accion texto={f.producto ? 'Cambiar' : 'Elegir producto'} onPress={() => setBuscando(buscando === k ? null : k)} />
                      {filas.length > 1 ? <Accion texto="Quitar esta parte" color={MARCA.rojo} onPress={() => { setBuscando(null); setFilas((l) => { const n = l.filter((_, j) => j !== k); return aMano ? n : parejo(n); }); }} /> : null}
                    </View>
                    {buscando === k ? <BuscadorProducto onCancelar={() => setBuscando(null)} onElegir={(p) => { poner(k, { producto: { id: p.id, nombre: p.nombre } }); setBuscando(null); }} /> : null}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1, gap: 4 }}><Rotulo>Unidades por cada una</Rotulo>
                        <Campo multiline={false} keyboardType="number-pad" value={f.unidades} onChangeText={(v) => poner(k, { unidades: v.replace(/[^\d]/g, '') })} /></View>
                      <View style={{ flex: 1, gap: 4 }}><Rotulo>% del costo</Rotulo>
                        <Campo multiline={false} keyboardType="decimal-pad" value={f.porcentaje} onChangeText={(v) => { setAMano(true); setFilas((l) => l.map((x, j) => (j === k ? { ...x, porcentaje: v.replace(/[^\d.]/g, '') } : x))); }} /></View>
                    </View>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{`Entran ${entran} a ${formatMoney(costo)}`}</Text>
                  </View>
                </Vidrio>
              );
            })}
            <View style={{ flexDirection: 'row', gap: 16 }}>
              {filas.length < 6 ? <Accion texto="Otro producto" onPress={() => setFilas((l) => { const n = [...l, { ...FILA }]; return aMano ? n : parejo(n); })} /> : null}
              <Accion texto="Repartir parejo" onPress={() => { setAMano(false); setFilas(parejo); }} />
            </View>
            {documentId != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Interruptor value={recordar} onValueChange={setRecordar} />
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Recordar para las próximas facturas de este producto</Text>
              </View>
            ) : null}
            {problema && !guardando ? <Aviso tono="cuidado" texto={problema} /> : null}
            <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} deshabilitado={!!problema || guardando}
              onPress={() => guardar(filas.map((f) => ({ product_id: f.producto.id, unidades: Number(f.unidades), porcentaje: Number(f.porcentaje) })))} />
            {yaPartido ? <BotonGrande texto="Dejar entero" borde deshabilitado={guardando} onPress={() => guardar([])} /> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}
