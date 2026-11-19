// Producto nuevo desde un renglón de la factura, NATIVO — el `NuevoProducto`
// del portal. Copia de un producto PARECIDO categoría, laboratorio, marca, las
// casillas y un precio con su mismo margen, y sólo pide lo que el modelo no
// puede saber. «Revisar» arma el alta sin crearla (`simularProductoNuevo`);
// «Crear producto» la da de alta con lo MISMO que se revisó.
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { crearProductoNuevo, simularProductoNuevo } from '@nucleo/data/cargarCompra';
import { barrasDelRenglon, nombreDelRenglon } from '@nucleo/utils/cargaDeCompra';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import ConAurora from '../ConAurora';
import EncabezadoDeHoja from '../EncabezadoDeHoja';
import Interruptor from '../Interruptor';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import { trabajando, cerrarProgreso } from '../Progreso';
import BuscadorProducto from './BuscadorProducto';
import { Accion, CampoDeEleccion, ElegirDeLista, Rotulo } from './carga';

const ROTULO_PRECIO = ['Precio 1', 'Precio 2', 'Precio 3', 'Precio 4', 'Precio 5', 'Precio 6', 'Precio 7'];
const VACIO = { proveedor: null, categoria: null, laboratorio: null, marca: null, perecedero: null, exento: null, decimal: null };
const LISTAS = { proveedor: ['proveedores', 'Proveedor'], laboratorio: ['laboratorios', 'Laboratorio'], categoria: ['categorias', 'Categoría'] };

export default function NuevoProducto({ renglon, factor, documentId, manualId = null, pausada, onCerrar, onCreado, onUsar }) {
  const costo = Number(renglon.costo) / (Number(factor) > 0 ? Number(factor) : 1);
  const clave = `producto-nuevo:${documentId ?? `m${manualId}`}:${renglon.codigo_proveedor ?? renglon.descripcion}`;
  const [f, setF] = useState(() => loadDraft(clave)?.f ?? { nombre: nombreDelRenglon(renglon.descripcion), barcode: barrasDelRenglon(renglon.descripcion), precio: '', ...VACIO });
  const [modelo, setModelo] = useState(() => loadDraft(clave)?.modelo ?? (renglon.producto_id ? { id: renglon.producto_id, nombre: renglon.producto } : null));
  const [eligiendo, setElig] = useState(false);
  const [lista, setLista] = useState(null);   // qué catálogo se está eligiendo
  const [catalogos, setCat] = useState(null);
  const [res, setRes] = useState(null);
  const [revisando, setRev] = useState(false);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { saveDraft(clave, { f, modelo }); }, [clave, f, modelo]);

  const datos = (campos) => ({
    documentId, manualId, modeloId: modelo?.id ?? null, costo: Math.round(costo * 1e4) / 1e4,
    nombre: campos.nombre, barcode: campos.barcode, precio: Number(campos.precio) || null,
    ...Object.fromEntries(Object.keys(VACIO).filter((k) => campos[k] != null).map((k) => [k, campos[k]])),
  });
  const revisar = async (campos, conCatalogos) => {
    setRev(true); setError('');
    const { resultado, error: e } = await simularProductoNuevo({ ...datos(campos), catalogos: conCatalogos });
    setRev(false);
    if (e) { setError(e); return; }
    if (resultado.catalogos) setCat(resultado.catalogos);
    const r = resultado.revision;
    // Lo que la persona no tocó toma lo sugerido.
    setF((x) => ({ ...x, ...Object.fromEntries(Object.keys(VACIO).map((k) => [k, x[k] ?? r.valores[k]])),
      precio: x.precio !== '' ? x.precio : (r.precio_sugerido != null ? String(r.precio_sugerido) : '') }));
    setRes(r);
  };
  // Al abrir y al cambiar el parecido: pedir sugerencias de nuevo.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir y al cambiar el parecido
  useEffect(() => { revisar(f, !catalogos); }, [modelo?.id]);

  const poner = (k, v) => { setF((x) => ({ ...x, [k]: v })); setRes(null); };
  const elegirModelo = (prod) => {
    setElig(false);
    setF((x) => ({ ...x, categoria: null, laboratorio: null, marca: null, perecedero: null, exento: null, decimal: null, precio: '' }));
    setModelo({ id: prod.id, nombre: prod.nombre });
  };
  const usarExistente = (x) => { clearDraft(clave); onUsar({ id: x.id, nombre: x.nombre }); };
  const crear = async () => {
    setCreando(true); setError(''); trabajando('Creando el producto…');
    const { resultado, error: e } = await crearProductoNuevo(datos(f));
    setCreando(false); cerrarProgreso();
    if (e) { setError(e); return; }
    clearDraft(clave);
    onCreado(resultado.producto, resultado.notas ?? []);
  };
  const margen = Number(f.precio) > 0 ? Math.round((1 - costo / Number(f.precio)) * 100) : null;
  const opciones = (k) => (catalogos?.[LISTAS[k][0]] ?? []).map((o) => ({ id: String(o.value), label: o.label }));
  const rotuloDe = (k) => opciones(k).find((o) => o.id === String(f[k] ?? ''))?.label;
  const otros = [...(res?.existentes ?? []), ...(res?.parecidos ?? [])].filter((x) => x.activo);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={() => !creando && onCerrar()}>
      <ConAurora>
        <EncabezadoDeHoja titulo="Producto nuevo" subtitulo={renglon.descripcion} onCerrar={onCerrar} ocupado={creando} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {error ? <Aviso tono="freno" texto={error} /> : null}
            <Seccion titulo="Parecido a…" pie="De él se copian categoría, laboratorio, marca y el margen.">
              {modelo && !eligiendo ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Pildora texto={modelo.nombre} color={MARCA.azulClaro} />
                  <Accion texto="Cambiar" onPress={() => setElig(true)} />
                </View>
              ) : <BuscadorProducto onElegir={elegirModelo} onCancelar={() => setElig(false)} />}
            </Seccion>
            <Seccion titulo="Datos">
              <Rotulo>Nombre</Rotulo>
              <Campo value={f.nombre} onChangeText={(v) => poner('nombre', v)} autoCapitalize="characters" />
              <Rotulo>Código de barras</Rotulo>
              <Campo multiline={false} keyboardType="number-pad" value={f.barcode} onChangeText={(v) => poner('barcode', v)} />
              <Rotulo>Precio de venta por unidad ($)</Rotulo>
              <Campo multiline={false} keyboardType="decimal-pad" value={f.precio} onChangeText={(v) => poner('precio', String(v).replace(/[^\d.]/g, ''))} />
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`costo ${formatMoney(costo)}${margen != null ? ` · margen ${margen} %` : ''}${res?.precio_sugerido ? ` · sugerido ${formatMoney(res.precio_sugerido)}` : ''}`}</Text>
              {Object.keys(LISTAS).map((k) => (
                <View key={k} style={{ gap: 4 }}>
                  <Rotulo>{LISTAS[k][1]}</Rotulo>
                  <CampoDeEleccion texto={rotuloDe(k)} vacio={catalogos ? `Elegir ${LISTAS[k][1].toLowerCase()}` : 'Cargando…'} deshabilitado={!catalogos} onPress={() => setLista(k)} />
                </View>
              ))}
              <Rotulo>Marca</Rotulo>
              <Campo multiline={false} value={f.marca ?? ''} onChangeText={(v) => poner('marca', v)} />
              {[['perecedero', 'Vence'], ['exento', 'Exento de IVA'], ['decimal', 'Se vende por fracción']].map(([k, t]) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{t}</Text>
                  <Interruptor value={!!f[k]} onValueChange={(v) => poner(k, v)} />
                </View>
              ))}
            </Seccion>
            {res && !res.listo ? <Aviso tono="cuidado" texto={res.problemas.join(' · ')} /> : null}
            {otros.length ? (
              <Seccion titulo={res.existentes?.length ? '¿Es éste?' : 'Ya existen parecidos. Si es uno, úsalo'}>
                {otros.map((x) => (
                  <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>{x.nombre}</Text>
                    <Accion texto="Usar este" onPress={() => usarExistente(x)} />
                  </View>
                ))}
              </Seccion>
            ) : null}
            {res?.listo ? (
              <Seccion titulo="Listo para crear">
                <Text style={{ color: MARCA.verde, fontSize: 15, fontWeight: '700' }}>{`${res.nombre}, presentación de 1 unidad a ${formatMoney(res.precio)}.`}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{res.precios.map((p, k) => `${ROTULO_PRECIO[k]} ${formatMoney(p)}`).join(' · ')}</Text>
              </Seccion>
            ) : null}
            {pausada ? <Aviso tono="cuidado" texto="Con las compras en pausa no se crean productos." /> : null}
            <Aviso texto={res?.listo ? 'Se crea y queda elegido aquí.' : 'Revisa los datos antes de crearlo.'} />
            {res?.listo
              ? <BotonGrande texto={creando ? 'Creando…' : 'Crear producto'} deshabilitado={creando || pausada} onPress={crear} />
              : <BotonGrande texto={revisando ? 'Revisando…' : 'Revisar'} deshabilitado={revisando || !f.nombre.trim()} onPress={() => revisar(f, !catalogos)} />}
          </ScrollView>
        </KeyboardAvoidingView>
        <ElegirDeLista visible={!!lista} titulo={lista ? LISTAS[lista][1] : ''} valor={lista ? String(f[lista] ?? '') : ''} opciones={lista ? opciones(lista) : []}
          onElegir={(v) => { const o = (catalogos?.[LISTAS[lista][0]] ?? []).find((x) => String(x.value) === String(v)); poner(lista, o ? o.value : v); }}
          onCerrar={() => setLista(null)} />
      </ConAurora>
    </Modal>
  );
}
