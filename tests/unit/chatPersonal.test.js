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

import { asignadoDe, escaladaDe } from '@nucleo/utils/chatPersonal';
import { avisoEsperaDecisionConMayoristas, claveDeDecisionConMayoristas, claveDeMayorista } from '@nucleo/utils/accionesDeAviso';
import { ordenarBandeja } from '@nucleo/utils/bandejaDeAvisos';

describe('asignación y escalera del chat', () => {
    it('escalada: supervisión manda sobre sala; sin escalones, null', () => {
        expect(escaladaDe({})).toBeNull();
        expect(escaladaDe({ escalada_sala_at: '2026-10-14T15:00:00Z' }).nivel).toBe('sala');
        expect(escaladaDe({ escalada_sala_at: 'x', escalada_supervision_at: '2026-10-14T15:05:00Z' }).nivel).toBe('supervision');
    });
    it('asignado: el id o null', () => {
        expect(asignadoDe({ asignada_a: 'e1' })).toBe('e1');
        expect(asignadoDe({ asignada_a: null })).toBeNull();
    });
});

describe('aviso de solicitud de mayorista', () => {
    const aviso = { id: 'n1', type: 'MAYORISTA_SOLICITUD', metadata: { customer_id: 42 } };
    const puede = (m, a) => m === 'mayoristas' && a === 'can_approve';
    it('espera mientras el cliente siga solicitado', () => {
        expect(avisoEsperaDecisionConMayoristas(aviso, puede, new Set(['42']))).toBe(true);
        expect(avisoEsperaDecisionConMayoristas(aviso, puede, new Set())).toBe(false);
    });
    it('sin el conjunto, o sin permiso, no se traba como pendiente', () => {
        expect(avisoEsperaDecisionConMayoristas(aviso, puede, null)).toBe(false);
        expect(avisoEsperaDecisionConMayoristas(aviso, () => false, new Set(['42']))).toBe(false);
    });
    it('no se repite en la bandeja si «Por decidir» ya lo trae', () => {
        expect(claveDeDecisionConMayoristas(aviso)).toBe(claveDeMayorista(42));
        const r = ordenarBandeja([aviso], [{ clave: 'mayorista:42' }], (n) => avisoEsperaDecisionConMayoristas(n, puede, new Set(['42'])));
        expect(r.pendientes).toHaveLength(0);
        expect(r.totalPorDecidir).toBe(1);
    });
});
