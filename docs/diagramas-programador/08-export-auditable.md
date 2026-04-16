flowchart TD
    A["Usuario selecciona deep users<br/>+ root fijo<br/>Define el alcance exportable"] --> B["exportSnapshot()<br/>arranque del export<br/>Entrada del flujo de evidencia"]
    B --> C["exportJob.phase = freezing-snapshot<br/>fase de congelamiento<br/>Bloquea el snapshot que se va a exportar"]
    C --> D["freezeSnapshot()<br/>congelar snapshot<br/>Lee store y repositories en forma deterministica"]
    D --> E["FrozenSnapshot<br/>snapshot congelado<br/>captureId, relays, nodes, links, adjacency y users"]
    E --> F["buildMultipartArchive()<br/>armar archivo multipart<br/>Parte el export segun presupuesto"]
    F --> G["buildFileTree()<br/>arbol de archivos<br/>manifest o manifiesto, grafo y evidencia por usuario"]
    G --> H["zipFileTree()<br/>zip deterministico<br/>Orden estable y mtime fija"]
    H --> I["multipart result<br/>resultado en partes<br/>part-001, part-002, ..."]
    I --> J["downloadBlob()<br/>descarga local<br/>Baja cada parte generada"]
    J --> K["exportJob.phase = completed<br/>export terminado<br/>Workflow cerrado"]

    E --> L["Evidencia por usuario<br/>evidencia individual<br/>canonical, raw, graph, zaps e inbound refs"]
    G --> M["manifest.json + capture-profile.json<br/>metadatos del export<br/>Arbol estable y auditable"]
