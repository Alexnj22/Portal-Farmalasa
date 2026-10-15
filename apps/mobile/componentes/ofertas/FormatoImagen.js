// El formato correcto de la imagen de una historia o un banner, y si la foto
// elegida lo cumple — `FormatoImagen.jsx` del portal. La medida la da el
// selector de fotos (`asset.width/height`); la regla y los números salen del
// núcleo (`revisarMedidaDeImagen`), los mismos del portal. Una foto con otra
// forma se recorta en el teléfono del cliente.
import { Text, View } from 'react-native';
import { FORMATOS_DE_IMAGEN, revisarMedidaDeImagen } from '@nucleo/utils/ofertasClientes';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';

export default function FormatoImagen({ tipo, medida }) {
  const f = FORMATOS_DE_IMAGEN[tipo];
  if (!f) return null;
  const { formaMal, chica, bien } = revisarMedidaDeImagen(tipo, medida);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>
        <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>{`Formato de ${f.nombre.toLowerCase()}: `}</Text>
        {`${f.ancho} × ${f.alto} px (${f.proporcion}), JPG, PNG o WebP, hasta 3 MB. ${f.zona}`}
      </Text>
      {medida && (formaMal || chica) ? (
        <Aviso tono="cuidado" texto={`Esta imagen mide ${medida.ancho} × ${medida.alto} px.${formaMal ? ` No tiene la forma de ${f.nombre.toLowerCase()} (${f.proporcion}): en la app se va a recortar.` : ''}${chica ? ' Es pequeña: puede verse borrosa.' : ''}`} />
      ) : null}
      {medida && bien ? <Text style={{ color: MARCA.verde, fontSize: 13, fontWeight: '600', marginHorizontal: 4 }}>{`✓ ${medida.ancho} × ${medida.alto} px: tiene el formato correcto.`}</Text> : null}
    </View>
  );
}
