// La app de clientes vuelve a pedir la aceptación cuando cambia la VERSIÓN de un
// documento, no cuando cambia su texto. Esta prueba amarra las dos cosas: la
// fecha de cada versión tiene que ser la del «vigente a partir del…» que
// imprime el documento. Actualizar el aviso o el reglamento sin subir su
// versión deja al cliente aceptando un texto que ya no es el vigente — pedido
// del usuario (2026-11-03): «siempre que se actualice, que salga para confirmar».
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REGLAMENTOS, TEXTOS_CONSENTIMIENTO, documentosVigentes,
} from '../../supabase/functions/_shared/consentimientoPuntos.ts';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function vigenciaDe(archivo) {
  const html = readFileSync(resolve(process.cwd(), 'docs/legal', archivo), 'utf8');
  const m = html.match(/class="vigencia">[^<]*?vigente a partir del (\d{1,2}) de (\w+) de (\d{4})/i);
  if (!m) throw new Error(`${archivo}: no tiene «vigente a partir del…»`);
  const mes = MESES.indexOf(m[2].toLowerCase()) + 1;
  return `${m[3]}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

describe('versiones de los documentos que acepta el cliente', () => {
  it('el aviso lleva la fecha de vigencia del aviso de privacidad', () => {
    expect(TEXTOS_CONSENTIMIENTO.aviso).toBe(`aviso-${vigenciaDe('aviso-de-privacidad.html')}`);
  });

  it('cada reglamento lleva la fecha de vigencia de su documento', () => {
    expect(REGLAMENTOS.map((r) => r.desde)).toEqual([
      vigenciaDe('reglamento-programa-de-puntos.html'),
      vigenciaDe('reglamento-programa-de-puntos-v2.html'),
    ]);
    for (const r of REGLAMENTOS) expect(r.version).toBe(`reglamento-${r.desde}`);
  });

  it('el reglamento nuevo se pide desde el día que rige, en hora de El Salvador', () => {
    // 14-nov 23:59 SV = 15-nov 05:59 UTC: todavía el v1
    expect(documentosVigentes(new Date('2026-11-15T05:59:00Z')).reglamento).toBe('reglamento-2026-10-01');
    expect(documentosVigentes(new Date('2026-11-15T06:00:00Z')).reglamento).toBe('reglamento-2026-11-15');
    expect(documentosVigentes(new Date('2026-11-03T12:00:00Z')).aviso).toBe(TEXTOS_CONSENTIMIENTO.aviso);
  });
});
