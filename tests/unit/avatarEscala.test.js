import { describe, it, expect } from 'vitest';
import { TAMANOS_DE_AVATAR, tamanoDeAvatar, geometriaDeAvatar } from '@nucleo/utils/avatar';

describe('escala del avatar', () => {
  it('son seis tamaños', () => expect(TAMANOS_DE_AVATAR).toEqual([20, 28, 36, 48, 64, 104]));
  it('lleva cada tamaño al aprobado más cercano', () => {
    expect([16, 18, 22, 24, 30, 34, 40, 42, 52, 56, 88, 160].map(tamanoDeAvatar))
      .toEqual([20, 20, 20, 28, 28, 36, 36, 48, 48, 64, 104, 104]);
  });
  it('un aprobado queda igual', () => TAMANOS_DE_AVATAR.forEach((t) => expect(tamanoDeAvatar(t)).toBe(t)));
  it('las marcas aparecen en su escalón', () => {
    expect(geometriaDeAvatar(20)).toMatchObject({ firma: true, aro: 1.5, conChip: false });
    expect(geometriaDeAvatar(28)).toMatchObject({ firma: false, aro: 4, conChip: false, conMedalla: false });
    expect(geometriaDeAvatar(36)).toMatchObject({ conChip: true, conMedalla: false });
    expect(geometriaDeAvatar(48)).toMatchObject({ aro: 4.5, conMedalla: true });
  });
});
