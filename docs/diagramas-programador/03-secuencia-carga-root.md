sequenceDiagram
    participant U as "Usuario<br/>persona que pega la identidad"
    participant I as "NpubInput<br/>entrada del root<br/>Valida y decodifica"
    participant G as "GraphApp<br/>shell del grafo<br/>Orquesta UI y runtime"
    participant K as "KernelFacade / RootLoader<br/>nucleo de carga<br/>Coordina cache, relays y store"
    participant R as "RelayAdapter<br/>adaptador de relays<br/>Suscripciones y salud"
    participant D as "Repositories / Dexie<br/>persistencia local<br/>Cache estructurada"
    participant W as "Workers<br/>trabajadores de fondo<br/>Parseo y analisis pesado"
    participant S as "AppStore<br/>estado global<br/>Fuente de verdad visible"
    participant C as "GraphCanvas<br/>canvas del grafo<br/>Renderiza la escena"

    U->>I: pega npub o nprofile
    I->>I: decodeRootPointer()<br/>decodificar root
    I->>G: onValidRoot(pubkey, kind, relays)<br/>root valido
    G->>S: upsertSavedRoot()<br/>guardar root usado
    G->>K: loadRoot(pubkey, options)<br/>pedir carga real
    K->>S: rootLoad=start<br/>inicio de carga con relayUrls y reset parcial
    K->>D: loadCachedSnapshot(rootPubkey)<br/>leer cache local
    D-->>K: profile, contactList e inbound snapshot cacheados

    alt hay cache usable
        K->>S: replaceRootGraph() desde cache<br/>grafo parcial visible
        K->>S: rootLoad=cache-hit / partial<br/>cache encontrada / estado parcial usable
        S-->>C: render parcial inmediato
    else sin cache usable
        K->>S: rootLoad sigue en loading<br/>sigue cargando sin cache suficiente
    end

    K->>R: abrir sesion con relays ordenados<br/>sesion live / en vivo
    R-->>K: relay health updates<br/>salud de relays
    K->>S: updateRelayHealth() y progreso visible

    par fetch live
        K->>R: pedir contact list kind:3 del root
        R-->>K: eventos live<br/>eventos en vivo desde relays
        K->>W: PARSE_CONTACT_LIST<br/>parsear contact list
        W-->>K: follows + relayHints + diagnostics
    and follower discovery
        K->>R: COUNT / evidencia inbound<br/>medir seguidores posibles
        R-->>K: candidatos inbound
        K->>W: parse y merge de followers inbound
        W-->>K: follower evidence normalizada
    end

    K->>D: persistir contact list, perfiles y snapshots
    K->>S: replaceRootGraph() live + progreso final<br/>reemplazo final con evidencia en vivo
    K->>S: schedule analysis, keyword, zaps y profile hydration<br/>programar analisis, keywords, zaps e hidratacion de perfil
    S-->>C: modelo actualizado
    C-->>U: viewport listo o parcial con evidencia visible
