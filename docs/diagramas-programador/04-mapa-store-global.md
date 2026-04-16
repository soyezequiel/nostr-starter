flowchart TB
    AppStore["AppStore<br/>estado global de la app<br/>Fuente de verdad del explorador"]

    Graph["graphSlice<br/>slice del grafo<br/>nodes, links, adjacency, root y expansiones"]
    Relay["relaySlice<br/>slice de relays<br/>relayUrls, health, overrides y stale"]
    UI["uiSlice<br/>slice de interfaz<br/>paneles, capa activa, renderConfig y roots guardados"]
    Analysis["analysisSlice<br/>slice de analisis<br/>Resultado del analisis y reuso"]
    Export["exportSlice<br/>slice de export<br/>seleccion profunda y progreso del job"]
    Path["pathfindingSlice<br/>slice de pathfinding<br/>source, target, estado y camino"]
    Keyword["keywordSlice<br/>slice de keywords<br/>corpus, matches y disponibilidad"]
    Zap["zapSlice<br/>slice de zaps<br/>edges de zaps, estado y revision"]

    AppStore --> Graph
    AppStore --> Relay
    AppStore --> UI
    AppStore --> Analysis
    AppStore --> Export
    AppStore --> Path
    AppStore --> Keyword
    AppStore --> Zap
