# Diagramas para Programadores

Esta guia junta 8 diagramas pensados para entender el programa como programador sin perder el puente con el codigo real.

Objetivo:

- explicar el sistema en espanol
- mantener nombres reales de componentes, tipos y archivos
- permitir que cualquier programador pase rapido de un diagrama al repo

## Formato de los archivos

- Cada archivo de diagrama esta en Mermaid puro.
- Podes copiar el contenido completo del archivo y pegarlo directo en Mermaid Live.
- Si aparece un termino o nombre en ingles, la traduccion y una breve explicacion quedan pegadas al texto original dentro del diagrama.

## Orden de lectura recomendado

| # | Diagrama | Pregunta que responde | Le conviene primero a |
| --- | --- | --- | --- |
| 1 | [Arquitectura por capas](./01-arquitectura-por-capas.md) | Que capas tiene el programa y quien depende de quien | Quien recien entra al repo |
| 2 | [Flujo de pegar un npub o nprofile](./02-flujo-ingreso-root.md) | Que pasa desde el input hasta ver el grafo | Quien quiere entender el caso de uso principal |
| 3 | [Secuencia de carga del root](./03-secuencia-carga-root.md) | En que orden se hablan UI, kernel, relays, cache y store | Quien necesita seguir la ejecucion |
| 4 | [Mapa del estado global](./04-mapa-store-global.md) | Que guarda `AppStore` y que resuelve cada slice | Quien va a tocar UI o estado |
| 5 | [Modelo de datos del grafo](./05-modelo-datos-grafo.md) | Que entidades maneja el dominio y como se relacionan | Quien va a tocar dominio o analisis |
| 6 | [Pipeline de render](./06-pipeline-render.md) | Como se transforma estado en escena dibujable | Quien va a tocar canvas, layout o imagenes |
| 7 | [Persistencia, relays y sesion](./07-persistencia-relays-sesion.md) | De donde salen los datos y que queda cacheado | Quien va a tocar Nostr, cache o cobertura |
| 8 | [Export auditable](./08-export-auditable.md) | Como pasa el sistema de snapshot a ZIP deterministico | Quien va a tocar evidencia o export |

## Como leer esta guia

- Cada archivo responde una sola pregunta principal.
- Cada archivo de diagrama es pegable completo en Mermaid Live.
- El diagrama resume el sistema, no reemplaza al codigo.
- Las explicaciones estan en espanol, pero los nombres de codigo quedan tal cual existen en el repo.

## Glosario rapido

- `root`: identidad base cargada en el explorador.
- `kernel`: capa de orquestacion que conecta UI, store, relays, DB y workers.
- `store`: estado global de la app del grafo montado con Zustand.
- `workers`: procesamiento pesado fuera de React.
- `snapshot`: congelamiento deterministico del estado exportable.
- `relay-aware`: comportamiento que tiene en cuenta cobertura, salud y diferencias entre relays.
