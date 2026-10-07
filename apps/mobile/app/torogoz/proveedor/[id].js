// Torogoz · un proveedor, NATIVO — alta (`id = nuevo`) y edición, con el
// mismo formulario que usa la compra (`FormularioProveedor`). Sólo quien
// configura la distribuidora.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchProveedores } from '@nucleo/data/distribucionCompras';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema, Formulario } from '../../../componentes/Formulario';
import { volver } from '../../../componentes/volver';
import FormularioProveedor from '../../../componentes/torogoz/comercial/FormularioProveedor';
import { elegida, useEmisor } from '../../../componentes/torogoz/comercial/Piezas';

export default function ProveedorTorogoz() {
  const { id } = useLocalSearchParams();
  const nuevo = id === 'nuevo';
  const { hasPermission } = useAuth();
  const puede = !!hasPermission?.('distribucion_config', 'can_edit');
  const { emisor } = useEmisor();
  const [inicial, setInicial] = useState(() => (nuevo ? {} : elegida('proveedor', id)));
  const [error, setError] = useState('');

  useEffect(() => {
    if (nuevo || inicial) return undefined;
    let vivo = true;
    fetchProveedores().then((r) => {
      if (!vivo) return;
      const p = r.find((x) => String(x.id) === String(id));
      if (p) setInicial(p); else setError('No se encontró ese proveedor.');
    }).catch((e) => { if (vivo) setError(mensajeDeDistribucion(e)); });
    return () => { vivo = false; };
  }, [id, nuevo, inicial]);

  const espera = !puede ? 'Sólo quien configura la distribuidora edita proveedores.' : error;
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: nuevo ? 'Nuevo proveedor' : inicial?.nombre ?? 'Proveedor' }} />
      {!puede || !inicial ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {espera ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center' }}>{espera}</Text> : <ActivityIndicator />}
        </View>
      ) : (
        <Formulario contentContainerStyle={{ paddingHorizontal: 16, gap: 18, paddingBottom: 60 }}>
          <FormularioProveedor emisorId={emisor?.id} inicial={inicial} onGuardado={() => volver('/torogoz/proveedores')} />
        </Formulario>
      )}
    </>
  );
}
