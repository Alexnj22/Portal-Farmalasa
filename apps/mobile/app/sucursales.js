// Sucursales, NATIVO — `BranchesView`: cada sucursal por tipo, si está abierta
// ahora, su horario de hoy, cuánta gente tiene y sus alertas (permisos que
// vencen, falta regente, pagos de servicios atrasados…). Tocar una abre su
// ficha (`sucursal/[id]`) con la dirección, los teléfonos para llamar, la
// semana entera y la lista de alertas.
//
// Horario, apertura y alertas salen del núcleo (`sucursales`), los mismos del
// portal. Editar una se hace desde su ficha; crearla y el análisis con IA, en el portal.
//
// Como el portal: los kioscos activos «N / 3» de cada una, la dirección con
// municipio y departamento, y en el menú «Alquiladas / Propias». Inactiva =
// sin nadie asignado Y sin kioscos (no sólo sin gente).
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { kioscosActivos } from '@nucleo/utils/kioscos';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchBranchKiosks } from '@nucleo/data/branches';
import { abiertaAhora, ahoraEnSV, alertasDeSucursal, horarioDeHoy, ORDEN_DE_TIPOS, TIPOS_DE_SUCURSAL } from '@nucleo/utils/sucursales';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

export default function Sucursales() {
  const sucursales = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState('ALL');
  const [kioscos, setKioscos] = useState({});
  useEffect(() => {
    let vivo = true;
    Promise.all((sucursales || []).map((b) => fetchBranchKiosks(b.id)
      .then(({ data }) => [b.id, kioscosActivos(data).length]).catch(() => [b.id, 0])))
      .then((pares) => { if (vivo) setKioscos(Object.fromEntries(pares)); });
    return () => { vivo = false; };
  }, [sucursales]);
  const { dia, hora } = ahoraEnSV();
  const ahora = Date.now();

  // Como el portal: sin «Externos», y la gente activa de cada una.
  const filas = useMemo(() => (sucursales || []).filter((b) => (b.type || 'FARMACIA') !== 'EXTERNA').map((b) => {
    const gente = (empleados || []).filter((e) => String(e.branchId ?? e.branch_id) === String(b.id) && (e.status || '').toUpperCase() !== 'INACTIVO');
    return { b, gente, abierta: abiertaAhora(b, dia, hora), alertas: alertasDeSucursal(b, ahora, gente) };
  }), [sucursales, empleados, dia, hora, ahora]);

  const q = texto.trim();
  const visibles = filas.filter(({ b, alertas, gente }) => {
    if (filtro === 'ALERTS' && !alertas.hasAlerts) return false;
    if (filtro === 'INACTIVE' && (gente.length || kioscos[b.id])) return false;   // inactiva = sin gente y sin kioscos
    const tenencia = b.propertyType || b.settings?.propertyType;
    if (filtro === 'RENTED' && tenencia !== 'RENTED') return false;
    if (filtro === 'OWNED' && tenencia !== 'OWNED') return false;
    return !q || tokenMatch(q, b.name, b.address, b.code, b.settings?.location?.municipality, b.settings?.location?.department);
  });
  const porTipo = ORDEN_DE_TIPOS.map((t) => [t, visibles.filter(({ b }) => (b.type || 'FARMACIA') === t)]).filter(([, l]) => l.length);
  const grupos = [{ id: 'filtro', titulo: 'Mostrar', activa: filtro, porDefecto: 'ALL', onCambiar: setFiltro,
    opciones: [{ id: 'ALL', label: 'Todas' }, { id: 'ALERTS', label: 'Con alertas' }, { id: 'INACTIVE', label: 'Inactivas' },
      { id: 'RENTED', label: 'Alquiladas' }, { id: 'OWNED', label: 'Propias' }] }];
  const COLOR_ESTADO = { OPEN: MARCA.verde, CLOSED: colorSistema.texto2, UNKNOWN: MARCA.ambar };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Sucursales', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre o dirección', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        <FiltrosActivos grupos={grupos} />
        {porTipo.map(([tipo, lista]) => (
          <View key={tipo} style={{ gap: 8 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20, marginTop: 4 }}>
              {`${TIPOS_DE_SUCURSAL[tipo]?.sectionLabel ?? tipo} · ${lista.length}`}
            </Text>
            {lista.map(({ b, gente, abierta, alertas }) => (
              <Pressable key={b.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/sucursal/[id]', params: { id: String(b.id) } }); }}
                style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                <Vidrio radio={18} interactivo tinte={alertas.critica ? 'rgba(240,68,56,0.10)' : undefined}>
                  <View style={{ padding: 12, gap: 5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{b.name}</Text>
                      {tipo === 'FARMACIA' ? <Pildora texto={abierta.label} color={COLOR_ESTADO[abierta.status]} /> : null}
                    </View>
                    {b.address ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[b.address, b.settings?.location?.municipality, b.settings?.location?.department].filter(Boolean).join(', ')}</Text> : null}
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                      {[tipo === 'FARMACIA' ? `Hoy ${horarioDeHoy(b, dia)}` : null, `${gente.length} persona${gente.length === 1 ? '' : 's'}`, kioscos[b.id] != null ? `${kioscos[b.id]}/3 kioscos` : null].filter(Boolean).join(' · ')}
                    </Text>
                    {alertas.hasAlerts ? <Pildora texto={alertas.message} color={alertas.critica ? MARCA.rojo : MARCA.ambar} /> : null}
                  </View>
                </Vidrio>
              </Pressable>
            ))}
          </View>
        ))}
        {!visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Ninguna sucursal con ese filtro</Text> : null}
        {/* Editar una sucursal: desde su ficha (horarios, legal, inmueble y servicios). */}
      </ScrollView>
    </>
  );
}
