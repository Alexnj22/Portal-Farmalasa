// Una sección con título dentro de una lista. Compose no tiene un «Section»
// que envuelva filas, así que el título va como una fila más, en el estilo de
// encabezado de lista de Material.
import { ListItem, Text } from '@expo/ui';

export default function Seccion({ titulo, children }) {
  return (
    <>
      {titulo ? (
        <ListItem>
          <Text textStyle={{ fontSize: 13, fontWeight: '600', color: '#49454F' }}>{titulo}</Text>
        </ListItem>
      ) : null}
      {children}
    </>
  );
}
