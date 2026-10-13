import { describe, it, expect } from 'vitest';
import { alternarEtiqueta, estrellas, miReaccion } from '@nucleo/utils/chatPersonal';
import { ETIQUETAS } from '@nucleo/utils/chatClientes';
import { sinLeerDeAviso, sumaSinLeer } from '@nucleo/hooks/useSinLeerDelChat';

describe('chat del personal', () => {
  it('la burbuja suma lo que espera y sólo cuenta lo abierto', () => {
    expect(sumaSinLeer(new Map([[1, 3], [2, 2]]))).toBe(5);
    expect(sinLeerDeAviso({ eventType: 'UPDATE', new: { id: 7, estado: 'abierta', sin_leer_equipo: 4 } })).toEqual({ id: 7, n: 4 });
    expect(sinLeerDeAviso({ eventType: 'UPDATE', new: { id: 7, estado: 'resuelta', sin_leer_equipo: 4 } })).toEqual({ id: 7, n: 0 });
    expect(sinLeerDeAviso({ eventType: 'DELETE', old: { id: 7 } })).toBeNull();
  });
  it('alternar una etiqueta respeta el orden del catálogo del portal e ignora las desconocidas', () => {
    expect(alternarEtiqueta(['receta'], 'urgente', ETIQUETAS)).toEqual(['urgente', 'receta']);
    expect(alternarEtiqueta(['urgente', 'receta'], 'receta', ETIQUETAS)).toEqual(['urgente']);
    expect(alternarEtiqueta(['receta'], 'inventada', ETIQUETAS)).toEqual(['receta']);
  });
  it('estrellas y mi reacción', () => {
    expect(estrellas(4)).toBe('★★★★☆');
    expect(estrellas(null)).toBeNull();
    expect(miReaccion([{ autor: 'cliente', emoji: '❤️' }, { autor: 'equipo', employee_id: 5, emoji: '👍' }], 5)).toBe('👍');
    expect(miReaccion([{ autor: 'equipo', employee_id: 9, emoji: '👍' }], 5)).toBeNull();
  });
});
