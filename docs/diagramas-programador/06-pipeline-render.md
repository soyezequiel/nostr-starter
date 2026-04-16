flowchart LR
    Store["AppStore<br/>estado global<br/>nodes, links, inboundLinks, analysis, activeLayer y renderConfig"]
    Derivations["render derivations<br/>derivaciones de render<br/>Seleccion de capa, comparacion, LOD y payload serializado"]
    RenderWorker["renderModelWorker / buildGraphRenderModel<br/>worker de render<br/>Arma el modelo visual fuera de React"]
    Model["GraphRenderModel<br/>modelo renderizable<br/>Nodos, edges, labels, physicsEdges y LOD"]
    Physics["graphPhysics / physicsGateway<br/>fisica del layout<br/>Reheat, ticks y acomodado espacial"]
    Images["imageRuntime<br/>runtime de imagenes<br/>Presupuesto, buckets, residencia y avatar quality"]
    ViewState["graphViewState<br/>estado de camara<br/>Fit inicial, viewport e interacciones"]
    Canvas["GraphCanvas<br/>canvas del grafo<br/>Coordina render, fisica y paneles"]
    Deck["GraphViewportLazy / deck.gl<br/>renderer WebGL<br/>Dibuja la escena final"]

    Store --> Derivations --> RenderWorker --> Model
    Model --> Physics --> Canvas
    Model --> Images --> Canvas
    Model --> ViewState --> Canvas
    Canvas --> Deck
