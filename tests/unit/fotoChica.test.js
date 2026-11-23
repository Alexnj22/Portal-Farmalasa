import { describe, it, expect } from 'vitest';
import { urlFotoChica } from '@nucleo/utils/fotoChica';

const BASE = 'https://x.supabase.co/storage/v1/object/public/product-photos/';

describe('urlFotoChica', () => {
    it('traduce una foto del catálogo a su copia chica, con su sello', () => {
        expect(urlFotoChica(`${BASE}123.jpg?t=99`)).toBe(`${BASE}chicas/123.jpg?t=99`);
        expect(urlFotoChica(`${BASE}recortadas/7.jpg`)).toBe(`${BASE}chicas/recortadas/7.jpg`);
    });
    it('no toca lo que no es del catálogo ni lo que ya es chico', () => {
        expect(urlFotoChica(`${BASE}chicas/1.jpg`)).toBeNull();
        expect(urlFotoChica('https://x.supabase.co/storage/v1/object/public/photos/a.jpg')).toBeNull();
        expect(urlFotoChica(null)).toBeNull();
        expect(urlFotoChica('')).toBeNull();
    });
});
