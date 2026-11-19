// Factura en papel, NATIVA — el `FacturaEnPapel` del portal: proveedores que
// no mandan factura electrónica. Se copia el papel tal como viene y de ahí en
// adelante es la misma carga. Lo guarda el núcleo (`guardarFacturaEnPapel`),
// que pregunta si ese número ya está registrado para el proveedor. Guarda
// borrador: la sesión se cierra sola y una factura larga no se vuelve a teclear.
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { fetchProveedoresParaPapel, guardarFacturaEnPapel } from '@nucleo/data/cargarCompra';
import { sumaDeFacturaEnPapel } from '@nucleo/utils/cargaDeCompra';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hoySV } from '@nucleo/utils/fecha';
import ConAurora from '../ConAurora';
import EncabezadoDeHoja from '../EncabezadoDeHoja';
import Segmentos from '../Segmentos';
import Interruptor from '../Interruptor';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import Fecha from '../formulario/Fecha';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';
import { Accion, CampoDeEleccion, ElegirDeLista, Rotulo } from './carga';

const TIPOS_PAPEL = [{ id: 'CCF', label: 'Crédito fiscal' }, { id: 'COF', label: 'Factura' }, { id: 'FSE', label: 'Sujeto excluido' }];
const RENGLON_VACIO = { codigo: '', descripcion: '', cantidad: '', importe: '', exento: false };
const PAPEL_VACIO = { proveedor_nit: '', tipo_doc: 'CCF', numero: '', serie: '', fecha: '', total: '', renglones: [{ ...RENGLON_VACIO }] };
const decimal = (v) => String(v).replace(/[^\d.]/g, '');

/** `inicial`: la fila a corregir, o null para una nueva. `onGuardada(manualId)`. */
export default function FacturaEnPapel({ inicial, onCerrar, onGuardada }) {
  const clave = `factura-en-papel:${inicial?.id ?? 'nueva'}`;
  const [f, setF] = useState(() => loadDraft(clave)?.f ?? (inicial ? {
    id: inicial.id, proveedor_nit: inicial.proveedor_nit, tipo_doc: inicial.tipo_doc, numero: inicial.numero,
    serie: inicial.serie ?? '', fecha: inicial.fecha_emision, total: String(inicial.total),
    renglones: (inicial.renglones ?? []).map((r) => ({ codigo: r.codigo ?? '', descripcion: r.descripcion, cantidad: String(r.cantidad), importe: String(r.importe), exento: !!r.exento })),
  } : PAPEL_VACIO));
  const [proveedores, setProv] = useState(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [guardando, setG] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { saveDraft(clave, { f }); }, [clave, f]);
  useEffect(() => {
    let vivo = true;
    fetchProveedoresParaPapel().then(({ proveedores: p, error: e }) => { if (!vivo) return; setProv(p); if (e) setError(e); });
    return () => { vivo = false; };
  }, []);

  const poner = (campo, valor) => setF((x) => ({ ...x, [campo]: valor }));
  const ponerRenglon = (i, campo, valor) => setF((x) => ({ ...x, renglones: x.renglones.map((r, k) => (k === i ? { ...r, [campo]: valor } : r)) }));
  const { estimado, total, descuadre } = sumaDeFacturaEnPapel(f);
  const proveedor = (proveedores ?? []).find((p) => p.nit === f.proveedor_nit);

  const guardar = async () => {
    setG(true); setError(''); trabajando('Guardando la factura…');
    const { manualId, error: e } = await guardarFacturaEnPapel({
      ...f, numero: f.numero.trim(), total: Number(f.total),
      renglones: f.renglones.map((r) => ({ codigo: r.codigo, descripcion: r.descripcion, cantidad: Number(r.cantidad), importe: Number(r.importe), exento: r.exento })),
    });
    setG(false);
    if (e) { fallo('No se pudo guardar', e); setError(e); return; }
    listo('Factura guardada', f.numero.trim());
    clearDraft(clave);
    onGuardada(manualId);
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={() => !guardando && onCerrar()}>
      <ConAurora>
        <EncabezadoDeHoja titulo={inicial ? 'Corregir factura en papel' : 'Factura en papel'} subtitulo="Copia el papel tal como viene" onCerrar={onCerrar} ocupado={guardando} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <Aviso texto="Para proveedores que no mandan factura electrónica." />
            <Seccion titulo="La factura">
              <Rotulo>Proveedor</Rotulo>
              <CampoDeEleccion texto={proveedor?.nombre} vacio={proveedores ? '¿De quién es la factura?' : 'Cargando proveedores…'} deshabilitado={!proveedores} onPress={() => setEligiendo(true)} />
              <Rotulo>Tipo</Rotulo>
              <Segmentos activa={f.tipo_doc} onCambiar={(v) => poner('tipo_doc', v)} opciones={TIPOS_PAPEL} margen={0} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Rotulo>Fecha de la factura</Rotulo>
                <Fecha valor={f.fecha} onCambiar={(v) => poner('fecha', v)} hasta={hoySV()} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1, gap: 4 }}><Rotulo>Serie</Rotulo><Campo multiline={false} value={f.serie} onChangeText={(v) => poner('serie', v)} placeholder="Opcional" autoCapitalize="characters" /></View>
                <View style={{ flex: 1.4, gap: 4 }}><Rotulo>Número</Rotulo><Campo multiline={false} value={f.numero} onChangeText={(v) => poner('numero', v)} placeholder="Como sale en el papel" /></View>
              </View>
              <Rotulo>Total ($)</Rotulo>
              <Campo multiline={false} keyboardType="decimal-pad" value={f.total} onChangeText={(v) => poner('total', decimal(v))} />
            </Seccion>

            <Seccion titulo={`Productos · el importe de cada uno${f.tipo_doc === 'COF' ? ', con IVA' : ', sin IVA'}`}>
              {f.renglones.map((r, i) => (
                <View key={i} style={{ gap: 6, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <Rotulo>{`Producto ${i + 1}`}</Rotulo>
                  <Campo value={r.descripcion} onChangeText={(v) => ponerRenglon(i, 'descripcion', v)} placeholder="Descripción" />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1.2 }}><Campo multiline={false} value={r.codigo} onChangeText={(v) => ponerRenglon(i, 'codigo', v)} placeholder="Código (opcional)" /></View>
                    <View style={{ flex: 0.8 }}><Campo multiline={false} keyboardType="number-pad" value={r.cantidad} onChangeText={(v) => ponerRenglon(i, 'cantidad', v.replace(/[^\d.]/g, ''))} placeholder="Cant." /></View>
                    <View style={{ flex: 1 }}><Campo multiline={false} keyboardType="decimal-pad" value={r.importe} onChangeText={(v) => ponerRenglon(i, 'importe', decimal(v))} placeholder="Importe $" /></View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Interruptor value={r.exento} onValueChange={(v) => ponerRenglon(i, 'exento', v)} />
                      <Text style={{ color: colorSistema.texto, fontSize: 15 }}>Exento</Text>
                    </View>
                    {f.renglones.length > 1 ? <Accion texto="Quitar producto" color={MARCA.rojo} onPress={() => setF((x) => ({ ...x, renglones: x.renglones.filter((_, k) => k !== i) }))} /> : null}
                  </View>
                </View>
              ))}
              <Accion texto="Otro producto" onPress={() => setF((x) => ({ ...x, renglones: [...x.renglones, { ...RENGLON_VACIO }] }))} />
              <Text style={{ color: descuadre ? MARCA.ambar : colorSistema.texto2, fontSize: 14, fontWeight: descuadre ? '700' : '400', fontVariant: ['tabular-nums'] }}>
                {`Suma de los productos${f.tipo_doc === 'CCF' ? ' con IVA' : ''}: ${formatMoney(estimado)}${descuadre ? ` · el papel dice ${formatMoney(total)}. Revisa` : ''}`}
              </Text>
            </Seccion>
            {error ? <Aviso tono="freno" texto={error} /> : null}
            <Aviso texto="Al guardar se abre la carga. Ahí eliges los productos, el lote y el vencimiento." />
            <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar y seguir'} deshabilitado={guardando} onPress={guardar} />
          </ScrollView>
        </KeyboardAvoidingView>
        <ElegirDeLista visible={eligiendo} titulo="Proveedor" valor={f.proveedor_nit} opciones={(proveedores ?? []).map((p) => ({ id: p.nit, label: p.nombre }))}
          onElegir={(v) => poner('proveedor_nit', v)} onCerrar={() => setEligiendo(false)} />
      </ConAurora>
    </Modal>
  );
}
