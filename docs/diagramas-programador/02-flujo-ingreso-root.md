flowchart TD
    A["Usuario pega npub o nprofile<br/>entrada de identidad<br/>Caso principal del producto"] --> B["NpubInput<br/>campo de entrada<br/>Recibe y vigila el texto"]
    B --> C["decodeRootPointer()<br/>decodificar root<br/>Valida npub o nprofile y extrae pubkey"]
    C -->|valido / root utilizable| D["GraphApp.handleResolveRoot()<br/>resolver root<br/>Cierra UI auxiliar y dispara la carga"]
    C -->|invalido / root rechazado| X["invalid state<br/>estado invalido<br/>Explica por que no se puede cargar"]
    D --> E["upsertSavedRoot()<br/>guardar o actualizar root<br/>Persistencia liviana de roots usados"]
    E --> F["rootLoader.loadRoot(pubkey, options)<br/>cargar root<br/>Entrada al runtime del grafo"]

    F --> G["Root loader session<br/>sesion de carga del root<br/>Elige relay URLs, cache y estado inicial"]
    G --> H["local cache<br/>cache local<br/>Profiles, contact list e inbound snapshots"]
    G --> I["live relays<br/>relays live<br/>Contact lists y follower evidence"]

    H --> J["partial state<br/>estado parcial<br/>loadedFrom=cache o partial"]
    I --> K["Workers<br/>trabajadores de fondo<br/>Normalizan contact lists y evidencia"]
    K --> L["Kernel merge<br/>merge del kernel<br/>Integra nodos, links, inboundLinks y progreso"]
    L --> M["AppStore<br/>estado global actualizado<br/>Fuente de verdad para la UI"]
    M --> N["render pipeline<br/>pipeline de render<br/>Convierte dominio en escena dibujable"]
    N --> O["GraphCanvas + panels<br/>canvas y paneles<br/>Muestran progreso, grafo y detalle"]

    O --> P["Usuario ve el grafo<br/>resultado visible<br/>Progreso, relays y detalle"]
