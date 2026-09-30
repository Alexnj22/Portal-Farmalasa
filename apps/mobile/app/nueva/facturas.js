// Nueva solicitud de facturación — paso 1: elegir la factura. Las del mes de
// la sala, lo más nuevo arriba, con el buscador del sistema (número,
// cliente, total o el nombre del vendedor). Mismas lecturas del portal
// (`fetchBranchInvoicesRecent`, `searchBranchInvoices`) y el mismo ámbito
// (`ambitoDeFacturas`). Con alcance «todas», la sala se elige en el menú.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchBranchInvoicesRecent, searchBranchInvoices } from '@nucleo/data/facturacion';
import { ambitoDeFacturas, esAnulada } from '@nucleo/utils/solicitudFacturacion';
import { SALAS_VENTA } from '@nucleo/utils/metasUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Vidrio from '../../componentes/Vidrio';
import { MenuDeFiltros } from '../../componentes/Filtros';
import { Pildora } from '../../componentes/traslados/Tarjeta';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { MARCA } from '../../componentes/inicio/marca';
import { guardarFactura } from '../../componentes/formulario/facturaElegida';

function Fila({ f, onPress }) {
  const anulada = esAnulada(f);
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={18} interactivo>
        <View style={{ padding: 13, gap: 4, opacity: anulada ? 0.55 : 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{f.correlativo}</Text>
            <Pildora texto={f.tipo_documento} color={f.tipo_documento === 'CCF' ? MARCA.rojo : MARCA.azulClaro} />
            {anulada ? <Pildora texto="Anulada" color="#8E8E93" /> : null}
            <View style={{ flex: 1 }} />
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(f.total)}</Text>
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
            {fechaTexto(String(f.fecha).slice(0, 10))} · {f.cliente || 'Consumidor final'}{f.tipo_pago ? ` · ${f.tipo_pago}` : ''}
          </Text>
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function Facturas() {
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const todas = getScope?.('dash_annulment_req') === 'ALL';
  const propia = String(salaDelUsuario(user) ?? '');
  const [salaElegida, setSala] = useState(SALAS_VENTA.map(String).includes(propia) ? propia : String(SALAS_VENTA[0]));
  const sala = todas ? salaElegida : propia;
  const [filas, setFilas] = useState(null);
  const [texto, setTexto, aplicado] = useBusqueda();
  const [recargando, setRecargando] = useState(false);
  const ambito = useMemo(() => ambitoDeFacturas(), []);

  const cargar = useCallback(async () => {
    const q = aplicado.trim();
    if (q.length >= 2) {
      // El nombre del vendedor también encuentra: sus códigos van a la búsqueda.
      const codigos = (empleados || []).filter((e) => e.code && tokenMatch(q, e.name)).map((e) => String(e.code));
      const r = await searchBranchInvoices(sala, ambito, q, codigos);
      setFilas(r.error ? [] : r.data);
    } else {
      const r = await fetchBranchInvoicesRecent(sala, ambito);
      setFilas(r.error ? [] : r.data);
    }
  }, [sala, ambito, aplicado, empleados]);
  useEffect(() => { cargar(); }, [cargar]);

  const nombre = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? `Sala ${id}`;
  const grupos = todas ? [{
    id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: salaElegida, onCambiar: setSala,
    opciones: SALAS_VENTA.map((id) => ({ id: String(id), label: nombre(id) })),
  }] : [];

  const abrir = (f) => {
    guardarFactura(f, { id: sala, name: nombre(sala) });
    router.push({ pathname: '/nueva/factura/[id]', params: { id: String(f.id) } });
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Elige la factura', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Número, cliente, total o vendedor', onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto('') },
      }} />
      {todas ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40, gap: 10 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {todas ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 32 }}>{nombre(sala)} · este mes</Text> : null}
        {filas === null ? <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 40 }}>Cargando…</Text> : null}
        {(filas || []).map((f) => <Fila key={f.id} f={f} onPress={() => abrir(f)} />)}
        {filas && !filas.length ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 40, paddingHorizontal: 32 }}>
            {texto ? 'Ninguna factura coincide.' : 'Sin facturas este mes.'}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}
