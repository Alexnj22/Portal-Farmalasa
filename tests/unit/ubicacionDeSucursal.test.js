import { describe, it, expect } from 'vitest';
import { coordenadasDeEnlace, esDominioDeMapa, lugarDeEnlace } from '../../supabase/functions/_shared/enlaceDeMapa.ts';
import { ubicacionDesdeDireccion, completarUbicacion, enlaceDelPunto } from '@nucleo/utils/ubicacionDeSucursal';

// El enlace REAL de La Popular, tal como lo devuelve `maps.app.goo.gl` (2026-10-29).
const LA_POPULAR = 'https://www.google.com/maps/place/Farmacia+La+Popular/@14.1862594,-89.5326519,11z/data=!4m7!3m6!1s0x8f630f4a00f27e53:0x4d6ac7be443a81c5!8m2!3d14.1862698!4d-89.2277867!15sChNmYXJt!16s%2Fg%2F11cjkvsrmf?entry=tts';

describe('coordenadasDeEnlace', () => {
    it('toma el PIN del lugar, no el centro de la vista (que acá cae a 30 km)', () => {
        expect(coordenadasDeEnlace(LA_POPULAR)).toEqual({ lat: 14.1862698, lng: -89.2277867, precision: 'pin' });
    });
    it('lee una consulta por coordenadas', () => {
        expect(coordenadasDeEnlace('https://www.google.com/maps/search/?api=1&query=14.1,-89.2'))
            .toEqual({ lat: 14.1, lng: -89.2, precision: 'consulta' });
        expect(coordenadasDeEnlace('https://maps.google.com/?q=13.7,-89.19'))
            .toEqual({ lat: 13.7, lng: -89.19, precision: 'consulta' });
        expect(coordenadasDeEnlace('https://www.google.com/maps/search/13.70,+-89.20'))
            .toEqual({ lat: 13.7, lng: -89.2, precision: 'consulta' });
    });
    it('sin pin ni consulta cae a la vista, y lo dice', () => {
        expect(coordenadasDeEnlace('https://www.google.com/maps/@13.69,-89.21,15z'))
            .toEqual({ lat: 13.69, lng: -89.21, precision: 'vista' });
    });
    it('desenvuelve la pantalla de consentimiento', () => {
        const u = 'https://consent.google.com/m?continue=' + encodeURIComponent(LA_POPULAR);
        expect(coordenadasDeEnlace(u)?.precision).toBe('pin');
    });
    it('el enlace corto no trae coordenadas: hay que abrirlo', () => {
        expect(coordenadasDeEnlace('https://maps.app.goo.gl/BytumHsWbSeYHckf9')).toBeNull();
        expect(coordenadasDeEnlace('')).toBeNull();
    });
    it('rechaza coordenadas imposibles', () => {
        expect(coordenadasDeEnlace('https://www.google.com/maps/@0,0,3z')).toBeNull();
        expect(coordenadasDeEnlace('https://www.google.com/maps/@95.1,-89.2,3z')).toBeNull();
    });
});

describe('esDominioDeMapa / lugarDeEnlace', () => {
    it('sólo Google: el servidor no sigue redirecciones a cualquier sitio', () => {
        expect(esDominioDeMapa('maps.app.goo.gl')).toBe(true);
        expect(esDominioDeMapa('www.google.com')).toBe(true);
        expect(esDominioDeMapa('www.google.com.sv')).toBe(true);
        expect(esDominioDeMapa('google.com.evil.io')).toBe(false);
        expect(esDominioDeMapa('169.254.169.254')).toBe(false);
    });
    it('saca el nombre del lugar y no confunde una coordenada con un nombre', () => {
        expect(lugarDeEnlace(LA_POPULAR)).toBe('Farmacia La Popular');
        expect(lugarDeEnlace('https://www.google.com/maps/place/14.18,-89.22/')).toBeNull();
    });
});

describe('ubicacionDesdeDireccion', () => {
    it('La Popular: lo que devolvió OpenStreetMap, al catálogo', () => {
        expect(ubicacionDesdeDireccion({
            road: '1a Avenida Norte', town: 'Agua Caliente',
            municipality: 'Chalatenango Centro', state: 'Chalatenango', country_code: 'sv',
        })).toEqual({
            departamento: 'Chalatenango', municipio: 'Chalatenango Centro',
            distrito: 'Agua Caliente', direccion: '1a Avenida Norte, Agua Caliente',
        });
    });
    it('sin municipio lo deduce del distrito', () => {
        const r = ubicacionDesdeDireccion({ town: 'Agua Caliente', state: 'Chalatenango' });
        expect(r.municipio).toBe('Chalatenango Centro');
        expect(r.departamento).toBe('Chalatenango');
    });
    it('tolera tildes y el «Departamento de»', () => {
        expect(ubicacionDesdeDireccion({ state: 'Departamento de Cuscatlan' }).departamento).toBe('Cuscatlán');
    });
    it('lo que no reconoce queda en null — no adivina', () => {
        expect(ubicacionDesdeDireccion({ state: 'Guatemala', town: 'Esquipulas' }))
            .toEqual({ departamento: null, municipio: null, distrito: null, direccion: 'Esquipulas' });
        expect(ubicacionDesdeDireccion(null).departamento).toBeNull();
    });
});

describe('completarUbicacion — sólo llena lo vacío', () => {
    const hallado = { departamento: 'Chalatenango', municipio: 'Chalatenango Centro', direccion: '1a Avenida Norte, Agua Caliente' };
    it('ficha vacía: lo escribe todo', () => {
        expect(completarUbicacion({}, hallado)).toEqual({
            cambios: { department: 'Chalatenango', municipality: 'Chalatenango Centro', address: '1a Avenida Norte, Agua Caliente' },
            distintos: [],
        });
    });
    it('ficha completa y distinta: no pisa nada y lo informa', () => {
        const r = completarUbicacion(
            { department: 'Chalatenango', municipality: 'Chalatenango Sur', address: 'Barrio El Centro' }, hallado);
        expect(r.cambios).toEqual({});
        expect(r.distintos).toEqual([{ campo: 'Municipio', actual: 'Chalatenango Sur', mapa: 'Chalatenango Centro' }]);
    });
    it('no escribe un municipio de OTRO departamento', () => {
        const r = completarUbicacion({ department: 'San Salvador' }, hallado);
        expect(r.cambios.municipality).toBeUndefined();
        expect(r.distintos[0].campo).toBe('Departamento');
    });
    it('el enlace del punto elegido a mano', () => {
        expect(enlaceDelPunto(14.18627, -89.2277867)).toBe('https://www.google.com/maps/search/?api=1&query=14.1862700,-89.2277867');
    });
});
