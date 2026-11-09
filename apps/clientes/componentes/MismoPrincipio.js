// «Mismo principio activo» en la ficha (2026-11-09): otras opciones disponibles.
// La lista sale de la base con coincidencia EXACTA sobre el principio activo
// completo (paracetamol + cafeína no es la misma cosa). Primero los laboratorios
// marcados en el portal y, dentro de cada grupo, de menor a mayor precio. La
// concentración puede variar, por eso el aviso de consultar antes de cambiar.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import FilaProductos from './FilaProductos';
import { colorSistema } from './sistema';
import { llamar } from '../lib/api';
import { datosDePrecio, precioFinal } from '../lib/precioTuyo';

export default function MismoPrincipio({ id }) {
  const [lista, setLista] = useState([]);
  useEffect(() => {
    let vivo = true;
    setLista([]);
    llamar('catalogo_mismo_principio', { id, ...datosDePrecio() }).then((r) => {
      if (!vivo || !r?.ok) return;
      setLista([...(r.productos ?? [])]
        .sort((a, b) => Number(!!b.sugerido) - Number(!!a.sugerido) || precioFinal(a) - precioFinal(b))
        .slice(0, 10));
    });
    return () => { vivo = false; };
  }, [id]);
  if (!lista.length) return null;
  return (
    <View style={{ gap: 8, marginTop: 24, marginHorizontal: 16 }}>
      <FilaProductos titulo="Mismo principio activo" sf="pills.fill" productos={lista} sinAgregar />
      <Text style={{ fontSize: 13, color: colorSistema.texto3, marginHorizontal: 16 }}>
        La concentración puede variar. Consulta a tu médico o farmacéutico antes de cambiar de medicamento.
      </Text>
    </View>
  );
}
