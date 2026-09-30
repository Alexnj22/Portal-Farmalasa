// Facturas de mi sala, NATIVO — lo que en el portal es la ventana del widget
// (`WidgetFacturasSala.jsx`): las facturas de compra que llegaron por correo y
// falta decir de qué sala son, para poder cargarlas.
//
//   · Tuyas               — ya las tomó la sala: ver el PDF, o soltarla si
//                           todavía no se cargó (después lo decide
//                           contabilidad; la base lo impone).
//   · De tu línea         — el sistema las asoció a la sala por el teléfono del
//                           proveedor; falta confirmarlas.
//   · Sin sala            — cualquiera puede decir «es de mi sala».
//
// Mismas funciones del núcleo: `fetchFacturasSala`, `reclamarFactura`,
// `soltarFactura`, `resumenRenglones`. El PDF se abre con el visor del
// teléfono (URL firmada al momento, `openStoredFile`).
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchFacturasSala, reclamarFactura, resumenRenglones, soltarFactura } from '@nucleo/data/facturasSala';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { BRANCH_A_ERP, ERP_ORDEN } from '@nucleo/constants/erp';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { diasEntre, fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Vidrio from '../componentes/Vidrio';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { Pildora } from '../componentes/traslados/Tarjeta';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const DIAS = 30;
const SALA_POR_DEFECTO = '2';   // La Popular, como el portal (SALA_COMPRAS_POR_DEFECTO)

function Boton({ texto, color, onPress, borde }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center',
        backgroundColor: borde ? 'transparent' : color, borderWidth: borde ? 1.2 : 0, borderColor: color, opacity: pressed ? 0.75 : 1 })}>
      <Text style={{ color: borde ? color : '#fff', fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

function Factura({ f, sala, onCambio }) {
  const mia = f.estado === 'mia';
  const deLinea = f.estado === 'mia_linea';
  const edad = diasEntre(String(f.fecha_emision).slice(0, 10), hoySV());

  const tomar = async () => {
    trabajando('Tomando la factura…');
    const { error } = await reclamarFactura(f.document_id, sala);
    if (error) { fallo('No se pudo tomar', error); return; }
    listo('Es de tu sala', 'Ya la puedes cargar.'); onCambio();
  };
  const soltar = async () => {
    trabajando('Soltando…');
    const { error } = await soltarFactura(f.claim_id, 'La sala la soltó');
    if (error) { fallo('No se pudo soltar', error); return; }
    listo('Factura soltada'); onCambio();
  };
  const verPdf = async () => {
    try { await openStoredFile(f.pdf_path); } catch (e) { fallo('No se pudo abrir el PDF', e?.message ?? String(e)); }
  };

  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={20}>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{f.emisor_nombre || 'Proveedor'}</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(f.monto_total)}</Text>
          </View>
          <Text style={{ color: edad > 7 && !mia ? MARCA.rojo : colorSistema.texto2, fontSize: 13 }}>
            {fechaTexto(String(f.fecha_emision).slice(0, 10))}{f.linea ? ` · línea ${f.linea}` : ''}{!mia ? ` · hace ${edad} d` : ''}
          </Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={3}>{resumenRenglones(f.items_text)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
            {mia ? <Pildora texto={f.registrada ? 'Tuya · ya cargada' : 'Tuya'} color={f.registrada ? MARCA.verde : MARCA.azulClaro} /> : null}
            {deLinea ? <Pildora texto="De tu línea" color={MARCA.azulClaro} /> : null}
            <View style={{ flex: 1 }} />
            {mia ? (
              <>
                {f.pdf_path ? <Boton texto="Ver PDF" color={MARCA.azulClaro} borde onPress={verPdf} /> : null}
                {!f.registrada ? <Boton texto="Soltar" color={colorSistema.texto2} borde onPress={soltar} /> : null}
              </>
            ) : <Boton texto="Es de mi sala" color={MARCA.verde} onPress={tomar} />}
          </View>
        </View>
      </Vidrio>
    </View>
  );
}

function Grupo({ titulo, lista, sala, onCambio }) {
  if (!lista.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 32 }}>{titulo} · {lista.length}</Text>
      {lista.map((f) => <Factura key={`${f.document_id}-${f.claim_id ?? ''}`} f={f} sala={sala} onCambio={onCambio} />)}
    </View>
  );
}

export default function FacturasSala() {
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const todas = getScope?.('dash_facturas_sala') === 'ALL';
  const propia = String(salaDelUsuario(user) ?? '');
  const inicial = BRANCH_A_ERP[propia] != null ? propia : SALA_POR_DEFECTO;
  const [sala, setSala] = useState(inicial);
  const [filas, setFilas] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const salaActiva = todas ? sala : propia;

  const cargar = useCallback(async () => {
    const r = await fetchFacturasSala(salaActiva, { dias: DIAS });
    setFilas(r.error ? [] : r.filas);
  }, [salaActiva]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const opcionesSala = useMemo(() => ERP_ORDEN
    .map((erp) => Object.entries(BRANCH_A_ERP).find(([, e]) => e === erp)?.[0])
    .filter(Boolean)
    .map((bid) => ({ id: String(bid), label: (sucursales || []).find((b) => String(b.id) === String(bid))?.name ?? `Sala ${bid}` })),
  [sucursales]);
  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', opciones: opcionesSala, activa: sala, porDefecto: inicial, onCambiar: setSala }] : [];

  const visibles = (filas || []).filter((f) => !busqueda.trim()
    || tokenMatch(busqueda, String(f.monto_total), f.emisor_nombre, f.items_text, f.etiqueta, f.linea));

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Facturas de mi sala', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Monto, proveedor o producto…', onChangeText: (e) => setBusqueda(e.nativeEvent.text), onCancelButtonPress: () => setBusqueda('') },
      }} />
      {todas ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40, gap: 18 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {filas === null ? <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 40 }}>Cargando…</Text> : null}
        <Grupo titulo="De tu línea · confirma que son tuyas" lista={visibles.filter((f) => f.estado === 'mia_linea')} sala={salaActiva} onCambio={cargar} />
        <Grupo titulo="Sin sala" lista={visibles.filter((f) => f.estado === 'disponible')} sala={salaActiva} onCambio={cargar} />
        <Grupo titulo="Tuyas" lista={visibles.filter((f) => f.estado === 'mia')} sala={salaActiva} onCambio={cargar} />
        {filas && !visibles.length ? (
          <View style={{ alignItems: 'center', paddingTop: 50, gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>{busqueda ? 'Sin resultados' : 'Nada por cargar'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Últimos {DIAS} días.</Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
