# Los adaptadores del teléfono

El núcleo del portal (`src/data`, `utils`, `store`, `hooks`, `context`) pide lo
que depende del dispositivo por `@plataforma/<nombre>`. La web lo resuelve a
`src/plataforma/<nombre>.js`; esta app, a **este** directorio.

Regla: cada archivo exporta **los mismos nombres** que su gemelo web, con el
mismo contrato. Si algo todavía no existe en el teléfono, se dice (lanza con
`pendiente(...)`) — nunca devuelve un vacío que se lea como un dato.
