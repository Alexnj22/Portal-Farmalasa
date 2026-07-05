// Catálogo de nacionalidades (gentilicios en español) para el campo "Nacionalidad"
// del expediente de empleado — exigido por el Art. 23.1 del Código de Trabajo de
// El Salvador ("...domicilio, residencia y nacionalidad de cada contratante").
// El Salvador y Centroamérica van primero (casos más comunes); el resto del
// catálogo sigue orden alfabético. LiquidSelect ya es buscable, así que el
// orden solo importa para lo más frecuente.
const PRIORITY = [
    'Salvadoreña', 'Guatemalteca', 'Hondureña', 'Nicaragüense', 'Costarricense', 'Panameña', 'Beliceña',
];

const REST = [
    'Afgana', 'Albanesa', 'Alemana', 'Andorrana', 'Angoleña', 'Antiguana', 'Saudita',
    'Argelina', 'Argentina', 'Armenia', 'Australiana', 'Austriaca', 'Azerbaiyana',
    'Bahameña', 'Bangladesí', 'Barbadense', 'Bareiní', 'Belga', 'Beninesa', 'Bielorrusa',
    'Birmana', 'Boliviana', 'Bosnia', 'Botsuana', 'Brasileña', 'Bruneana', 'Búlgara',
    'Burkinesa', 'Burundesa', 'Butanesa', 'Caboverdiana', 'Camboyana', 'Camerunesa',
    'Canadiense', 'Catariana', 'Chadiana', 'Chilena', 'China', 'Chipriota', 'Colombiana',
    'Comorense', 'Congoleña', 'Surcoreana', 'Norcoreana', 'Marfileña', 'Croata', 'Cubana',
    'Danesa', 'Dominiquesa', 'Dominicana', 'Ecuatoriana', 'Egipcia', 'Emiratí',
    'Eritrea', 'Eslovaca', 'Eslovena', 'Española', 'Estadounidense', 'Estonia', 'Etíope',
    'Filipina', 'Finlandesa', 'Fiyiana', 'Francesa', 'Gabonesa', 'Gambiana', 'Georgiana',
    'Ghanesa', 'Granadina', 'Griega', 'Guyanesa', 'Haitiana', 'Húngara', 'India',
    'Indonesia', 'Iraquí', 'Iraní', 'Irlandesa', 'Islandesa', 'Israelí', 'Italiana',
    'Jamaicana', 'Japonesa', 'Jordana', 'Kazaja', 'Keniana', 'Kirguisa', 'Kiribatiana',
    'Kuwaití', 'Laosiana', 'Lesotense', 'Letona', 'Libanesa', 'Liberiana', 'Libia',
    'Liechtensteiniana', 'Lituana', 'Luxemburguesa', 'Macedonia', 'Malgache', 'Malasia',
    'Malauí', 'Maldiva', 'Maliense', 'Maltesa', 'Marroquí', 'Marshalesa', 'Mauriciana',
    'Mauritana', 'Mexicana', 'Micronesia', 'Moldava', 'Monegasca', 'Mongola',
    'Montenegrina', 'Mozambiqueña', 'Namibia', 'Nauruana', 'Nepalí', 'Neerlandesa',
    'Neozelandesa', 'Nigerina', 'Nigeriana', 'Noruega', 'Omaní', 'Pakistaní', 'Palauana',
    'Palestina', 'Papú', 'Paraguaya', 'Peruana', 'Polaca', 'Portuguesa', 'Puertorriqueña',
    'Británica', 'Centroafricana', 'Checa', 'Congoleña (RDC)', 'Dominicana (Rep. Dom.)',
    'Rumana', 'Rusa', 'Ruandesa', 'Samoana', 'Sanmarinense', 'Santalucense',
    'Sanvicentina', 'Santotomense', 'Senegalesa', 'Serbia', 'Seychellense', 'Sierraleonesa',
    'Singapurense', 'Siria', 'Somalí', 'Sri Lankeña', 'Sudafricana', 'Sudanesa',
    'Sudsudanesa', 'Sueca', 'Suiza', 'Surinamesa', 'Tailandesa', 'Tayika', 'Tanzana',
    'Timorense', 'Togolesa', 'Tongana', 'Trinitense', 'Tunecina', 'Turcomana', 'Turca',
    'Tuvaluana', 'Ucraniana', 'Ugandesa', 'Uruguaya', 'Uzbeka', 'Vanuatuense', 'Vaticana',
    'Venezolana', 'Vietnamita', 'Yemenita', 'Yibutiana', 'Zambiana', 'Zimbabuense',
];

export const NATIONALITY_OPTIONS = [
    ...PRIORITY.map(n => ({ value: n, label: n })),
    ...REST.sort((a, b) => a.localeCompare(b, 'es')).map(n => ({ value: n, label: n })),
];
