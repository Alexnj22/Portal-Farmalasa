// La ficha de un proveedor, NATIVO: sus datos fiscales y de contacto del
// directorio, su categoría, cuántos documentos le recibimos, y —si le debemos
// algo— el acceso directo a sus facturas pendientes (`cxp-proveedor/[nit]`).
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { fetchProveedoresMaestro } from '@nucleo/data/proveedores';
import { fetchCuentasPorPagar } from '@nucleo/data/cuentasPorPagar';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { guardarProveedores, proveedorGuardado } from '../../componentes/compras/proveedores';

export default function Proveedor() {
  const { id } = useLocalSearchParams();
  const [p, setP] = useState(() => proveedorGuardado(id));
  const [deuda, setDeuda] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    try {
      if (!proveedorGuardado(id)) { guardarProveedores(await fetchProveedoresMaestro()); }
      const x = proveedorGuardado(id);
      setP(x);
      if (!x) { setError('No se encontró el proveedor.'); return; }
      if (x.nit) {
        const { filas } = await fetchCuentasPorPagar(null);
        setDeuda((filas || []).find((f) => f.emisor_nit === x.nit) ?? false);
      }
    } catch (e) { setError(mensajeAmigable(e)); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Proveedor', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {!p && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {p ? (
          <>
            <View style={{ gap: 6, marginHorizontal: 4 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>{p.alias || p.nombre_comercial || p.nombre}</Text>
              {(p.alias || p.nombre_comercial) ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{p.nombre}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {p.categoria_nombre ? <Pildora texto={p.categoria_nombre} color={MARCA.azulClaro} /> : <Pildora texto="Sin categoría" color={MARCA.ambar} />}
                {p.activo === false ? <Pildora texto="Inactivo" color={colorSistema.texto2} /> : null}
              </View>
            </View>
            <Seccion titulo="Datos fiscales">
              <Dato primero rotulo="NIT" valor={p.nit || '—'} />
              <Dato rotulo="NRC" valor={p.nrc || '—'} />
              {p.dui ? <Dato rotulo="DUI" valor={p.dui} /> : null}
              {p.desc_actividad ? <Dato rotulo="Actividad" valor={p.desc_actividad} /> : null}
            </Seccion>
            <Seccion titulo="Compras">
              <Dato primero rotulo="Documentos recibidos" valor={Number(p.docs_count || 0).toLocaleString('es-SV')} />
              <Dato rotulo="Última compra" valor={p.ultima_vez_visto ? fechaTexto(p.ultima_vez_visto, { day: 'numeric', month: 'long', year: 'numeric' }) : '—'} />
              {deuda ? <Dato rotulo="Le debemos" valor={formatMoney(deuda.saldo)} fuerte /> : null}
              {deuda && Number(deuda.vencido) > 0 ? <Dato rotulo="Vencido" valor={formatMoney(deuda.vencido)} /> : null}
            </Seccion>
            {deuda ? (
              <BotonGrande texto="Ver sus facturas pendientes" color={MARCA.azul}
                onPress={() => router.push({ pathname: '/cxp-proveedor/[nit]', params: { nit: p.nit, nombre: p.alias || p.nombre } })} />
            ) : deuda === false ? <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>No le debemos nada.</Text> : null}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
