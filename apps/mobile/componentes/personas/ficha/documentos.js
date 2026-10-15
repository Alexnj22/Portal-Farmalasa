// Subir un documento del expediente desde el teléfono: elegir (foto, galería
// o PDF — `elegirOrigen`, que valida contra lo que acepta el bucket), leerlo y
// subirlo al bucket privado `documents`, a la MISMA carpeta que usa el portal:
// la de la ficha si ya existe, o `employee-documents/unassigned` en un alta
// (todavía no hay id). Devuelve `{ url, file_name }` (la URL formato-public,
// que es la que se guarda), o null si se canceló.
import { Alert } from 'react-native';
import { subirArchivo } from '@nucleo/utils/storageFiles';
import { problemaDelArchivo } from '@nucleo/utils/expedienteDeSucursal';
import { elegirOrigen, extDe } from '../../sucursal/elegirArchivo';

const azar = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const carpetaDeDocumentos = (empleadoId) => (empleadoId ? `employees/${empleadoId}/documents` : 'employee-documents/unassigned');

/** Sube lo ya elegido (`{ uri, tipo, nombre }`). Lanza si la subida falla. */
export async function subirElegido(f, empleadoId) {
  const body = await (await fetch(f.uri)).arrayBuffer();
  const problema = problemaDelArchivo({ tipo: f.tipo, tamano: body.byteLength });
  if (problema) { Alert.alert('Ese archivo no entra', problema); return null; }
  const ext = extDe(f.nombre, f.tipo);
  const url = await subirArchivo('documents', `${carpetaDeDocumentos(empleadoId)}/${azar()}.${ext}`, body, { contentType: f.tipo });
  if (!url) throw new Error('La subida no devolvió una URL.');
  return { url, file_name: f.nombre || `documento.${ext}` };
}

/** Elegir y subir de una vez. */
export async function elegirYSubir(empleadoId) {
  const f = await elegirOrigen();
  return f ? subirElegido(f, empleadoId) : null;
}
