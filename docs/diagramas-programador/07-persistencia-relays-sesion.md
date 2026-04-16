flowchart LR
    Defaults["defaultRelayUrls<br/>relays por defecto<br/>Base de arranque del sistema"]
    NIP65["NIP-65 / relay lists cacheadas<br/>listas de relays<br/>Hints o pistas persistidas por identidad"]
    Override["relay override del usuario<br/>sobrescritura manual<br/>Cambio intencional del set activo"]
    Ordering["orderRelayUrlsByDiscoveryStats()<br/>ordenar por discovery<br/>Mergea fuentes y prioriza relays prometedores"]
    Adapter["RelayAdapter / relay pool<br/>adaptador de relays<br/>Abre sesiones y suscripciones"]
    Session["relay-session + root-loader<br/>sesion activa de carga<br/>Coordina cache, red y progreso"]
    Health["relay health<br/>salud del relay<br/>connected=conectado, partial=parcial, degraded=degradado, offline=fuera de linea"]
    Repos["repositories<br/>repositorios tipados<br/>Frontera entre kernel y DB"]
    Dexie["Dexie DB<br/>base local del navegador<br/>Cachea profiles, contact lists, snapshots y mas"]
    Store["AppStore<br/>estado visible<br/>relayUrls, relayHealth, isGraphStale y rootLoad"]

    Defaults --> Ordering
    NIP65 --> Ordering
    Override --> Ordering
    Ordering --> Adapter --> Session
    Adapter --> Health --> Store
    Session --> Repos --> Dexie
    Dexie --> Repos
    Session --> Store
    Store -->|estado partial o stale visible / parcial o vencido| Store
