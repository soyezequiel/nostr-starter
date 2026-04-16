flowchart LR
    subgraph Next["Next.js app routes<br/>rutas de Next.js<br/>Contenedor de las superficies del producto"]
        Home["/ -> src/app/page.tsx<br/>home del producto<br/>Entrada principal del explorador"]
        Profile["/profile<br/>perfil clasico<br/>Vista de cuenta conectada"]
        Badges["/badges<br/>badges clasicos<br/>Vista NIP-58"]
        Labs["/labs/sigma<br/>laboratorio experimental<br/>Rama separada del flujo principal"]
    end

    GraphClient["GraphClient<br/>cliente del grafo<br/>Carga GraphApp solo en navegador"]
    GraphApp["GraphApp<br/>aplicacion del grafo<br/>Shell que orquesta UI y runtime"]
    UI["components/<br/>componentes de interfaz<br/>Paneles, canvas y controles"]
    Kernel["kernel/<br/>nucleo de orquestacion<br/>createKernelFacade y modulos"]
    Store["app/store/<br/>estado global<br/>AppStore y slices de Zustand"]
    Workers["workers/<br/>trabajadores de fondo<br/>Parseo, analisis, verificacion y fisica"]
    Render["render/<br/>pipeline visual<br/>Render model, layout, imagenes y deck.gl"]
    DB["db/<br/>persistencia local<br/>Dexie y repositories"]
    Relays["nostr/<br/>capa de relays<br/>Relay adapter y relay pool"]
    SharedNostr["src/lib/nostr.ts<br/>capa Nostr compartida<br/>NDK, auth, profile y badges"]

    Home --> GraphClient --> GraphApp
    GraphApp --> UI
    UI --> Kernel
    UI --> Store
    Kernel --> Store
    Kernel --> Workers
    Kernel --> DB
    Kernel --> Relays
    Store --> Render
    Workers --> Render
    Render --> UI

    Profile --> SharedNostr
    Badges --> SharedNostr
    Labs -. rama separada del flujo principal .-> GraphClient
