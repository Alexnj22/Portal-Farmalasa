// Saly, la IA del portal: lo que siente. No es una persona ni tiene género
// (usuario, 2026-11-03: «es una IA, es una emoción, algo abstracto»), así que
// lo que se nombra es la EMOCIÓN —un sustantivo— y nunca un adjetivo sobre
// ella («contenta», «preocupada»). El dibujo vive en
// components/common/SalyAvatar; acá sólo los nombres, para que el núcleo (que
// no dibuja) pueda decidir qué siente.
export const ANIMOS_DE_SALY = {
    alegria:      { label: 'alegría',      frase: 'siente alegría' },
    atencion:     { label: 'atención',     frase: 'presta atención' },
    preocupacion: { label: 'preocupación', frase: 'siente preocupación' },
    pensando:     { label: 'pensando',     frase: 'está pensando' },
};

// Por debajo de esto Saly deja de reconocerse (usuario, 2026-11-03: «que
// tenga un tamaño mínimo siempre»): la cola, el anillo y los ojos se pierden.
// Lo aplica SalyAvatar —no cada llamador—, para que nadie la achique por olvido.
export const SALY_TAMANO_MINIMO = 32;
