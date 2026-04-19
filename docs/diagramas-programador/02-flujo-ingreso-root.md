flowchart TD
    A["Usuario pega npub, nprofile, hex, NIP-05 o link<br/>entrada de identidad<br/>Caso principal del producto"] --> B["SigmaRootInput<br/>campo de entrada<br/>Recibe y resuelve el texto"]
    B --> C["resolveRootIdentity()<br/>resolver root<br/>Normaliza input humano hacia pubkey, relays y evidencia"]
    C -->|NIP-19 o hex directo| C1["parser local<br/>sin red<br/>Extrae pubkey y relay hints si existen"]
    C -->|NIP-05| C2["resolveNip05Identifier()<br/>alias verificable<br/>Consulta .well-known/nostr.json con timeout"]
    C1 --> D
    C2 --> D
    C -->|invalido / root rechazado| X["invalid state<br/>estado invalido<br/>Explica por que no se puede cargar"]
    D["GraphApp.loadRootFromPointer()<br/>resolver root<br/>Cierra UI auxiliar y dispara la carga"]
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
