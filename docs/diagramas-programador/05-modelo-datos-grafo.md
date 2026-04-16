classDiagram
    class GraphNode {
      +nodo del grafo / identidad visible
      +pubkey / clave publica
      +label / etiqueta visible
      +source / origen del nodo
      +keywordHits / hits de keywords
      +discoveredAt / momento de descubrimiento
      +profileState / estado del perfil
    }

    class GraphLink {
      +enlace del grafo / relacion dirigida
      +source / origen del enlace
      +target / destino del enlace
      +relation / tipo de relacion
      +weight / peso opcional
    }

    class ConnectionsLinks {
      +conexiones derivadas / enlaces internos
      +coleccion derivada de GraphLink
      +solo entre nodos ya visibles
      +sale de contact lists cacheadas o live / en vivo
    }

    class ZapLayerEdge {
      +arista de zap / relacion economica
      +source / quien paga
      +target / quien recibe
      +relation zap / relacion de zap
      +weight / peso economico
      +receiptCount / cantidad de recibos
    }

    class KeywordMatch {
      +match de keyword / evidencia textual
      +noteId / nota origen
      +excerpt / fragmento encontrado
      +matchedTokens / tokens que hicieron match
      +score / puntaje del match
    }

    class RootLoadState {
      +estado del root / estado operativo
      +status / estado de carga
      +loadedFrom / fuente cache o live en vivo
      +message / mensaje visible
    }

    GraphNode "1" --> "many" GraphLink : source o target
    GraphNode "1" --> "many" KeywordMatch : acumula hits
    GraphLink <|-- ZapLayerEdge : relacion especializada
    ConnectionsLinks --> GraphLink : usa estructura de link
    RootLoadState --> GraphNode : describe el estado del root visible
