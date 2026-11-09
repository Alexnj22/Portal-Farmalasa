// «Mismo principio activo» en la ficha (2026-11-09): otras opciones disponibles,
// de menor a mayor precio. La coincidencia es EXACTA sobre el principio activo
// completo: la búsqueda por texto también trae combinaciones (paracetamol +
// cafeína), y ésas no son la misma cosa. La concentración puede variar, por eso
// el aviso de consultar antes de cambiar.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import FilaProductos from './FilaProductos';
import { colorSistema } from './sistema';
import { llamar } from '../lib/api';
import { datosDePrecio, precioFinal } from '../lib/precioTuyo';

const normal = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

export default function MismoPrincipio({ id, principio }) {
  const [lista, setLista] = useState([]);
  useEffect(() => {
    let vivo = true;
    const clave = normal(principio);
    setLista([]);
    if (clave.length < 3) return undefined;
    llamar('catalogo', { q: String(principio).trim(), desde: 0, limite: 30, ...datosDePrecio() }).then((r) => {
      if (!vivo || !r?.ok) return;
      setLista((r.productos ?? [])
        .filter((p) => p.id !== id && p.disponible && normal(p.principio_activo) === clave)
        .sort((a, b) => precioFinal(a) - precioFinal(b))
        .slice(0, 10));
    });
    return () => { vivo = false; };
  }, [id, principio]);
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
