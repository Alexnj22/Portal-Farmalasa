import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PROPS_CAMARA, aceptaImagenes } from '../../src/utils/capturaDeFoto.js';

// El bug que originó esto no dio error ni se vio en pantalla: el input decía
// `capture="environment"` y aun así abría el explorador de archivos, porque su
// `accept` era una lista fina. Lo que hay que anclar es exactamente eso — la
// condición que la WebView de Capacitor evalúa:
//
//     captureEnabled && acceptTypes.contains("image/*")
//
// Es una comparación de cadenas EXACTA sobre la lista partida por comas.

describe('PROPS_CAMARA — la pareja que abre la cámara', () => {
    it('trae el token image/* tal cual, sin nada más en la lista', () => {
        expect(PROPS_CAMARA.accept).toBe('image/*');
        expect(PROPS_CAMARA.accept.split(',').map(s => s.trim())).toContain('image/*');
    });

    it('trae capture, que sin él nunca se evalúa el accept', () => {
        expect(PROPS_CAMARA.capture).toBe('environment');
    });

    it('no lleva el type adentro: los gates leen el marcado como texto', () => {
        expect(PROPS_CAMARA.type).toBeUndefined();
    });
});

describe('aceptaImagenes — cuándo vale la pena ofrecer la cámara', () => {
    it('reconoce el comodín y los MIME sueltos', () => {
        expect(aceptaImagenes('image/*')).toBe(true);
        expect(aceptaImagenes('image/*,application/pdf')).toBe(true);
        expect(aceptaImagenes('application/pdf,image/jpeg,image/png,image/webp')).toBe(true);
    });

    it('reconoce los accept escritos por extensión (expediente del empleado)', () => {
        expect(aceptaImagenes('.pdf,.jpg,.jpeg,.png')).toBe(true);
        expect(aceptaImagenes('.pdf,image/*')).toBe(true);
    });

    it('dice que no cuando sólo se admiten documentos', () => {
        expect(aceptaImagenes('application/pdf')).toBe(false);
        expect(aceptaImagenes('.pdf,.doc,.docx')).toBe(false);
        expect(aceptaImagenes('text/csv')).toBe(false);
    });

    it('sin accept se admite todo, foto incluida', () => {
        expect(aceptaImagenes()).toBe(true);
        expect(aceptaImagenes('')).toBe(true);
    });
});

// La otra mitad del arreglo vive fuera de JavaScript: sin el <queries> del
// manifiesto, `resolveActivity(ACTION_IMAGE_CAPTURE)` devuelve null en Android
// 11+ y Capacitor cae al explorador igual que antes. Un `capture` correcto no
// alcanza, así que las dos mitades se vigilan juntas.
describe('AndroidManifest — la app tiene que poder VER la cámara', () => {
    it('declara el <queries> de IMAGE_CAPTURE', () => {
        const manifiesto = fs.readFileSync(
            path.join(process.cwd(), 'android/app/src/main/AndroidManifest.xml'), 'utf8');
        expect(manifiesto).toMatch(/<queries>[\s\S]*android\.media\.action\.IMAGE_CAPTURE[\s\S]*<\/queries>/);
    });
});
