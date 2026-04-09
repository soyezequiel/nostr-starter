# Propuesta: Sistema de Nodos Flotantes con Física Procedural

## Visión General
Implementar un sistema de movimiento flotante cinematográfico con colisiones suaves, donde los nodos mantienen una posición "home" y fluctúan alrededor de ella con una sensación orgánica y fluida.

---

## 1. Arquitectura del Sistema

### 1.1 Componentes Principales

```
FloatingNodesEngine
├── PhysicsSimulator (Simulación física lightweight)
├── PerlinNoiseAnimator (Movimiento flotante orgánico)
├── CollisionSystem (Detección y respuesta)
├── DragController (Interacción usuario)
└── ConfigManager (Ajustes cinematográficos)
```

### 1.2 Flujo de Datos

```
Render Loop (60fps)
  ↓
Physics Update
  ├─ Perlin Noise (posición base)
  ├─ Collision Detection
  ├─ Collision Response (damping)
  └─ Drag Forces
  ↓
Node Position = HomePosition + FloatingOffset + CollisionDamping
  ↓
Deck.gl Render
```

---

## 2. Especificación Técnica

### 2.1 Movimiento Flotante (Bobbing)

**Concepto:** Ruido Perlin 3D para movimiento suave y natural.

```typescript
// Pseudo-código del concepto
class FloatingAnimation {
  private noiseScale = 0.3      // Amplitud del movimiento (0-1 unidad del grafo)
  private timeScale = 0.6       // Velocidad de oscilación (0-2 recomendado)
  private independentAxes = true // Cada eje tiene su propio ruido
  
  getFloatingOffset(
    homePos: Vec3,
    elapsedTime: number,
    nodeId: string
  ): Vec3 {
    // Hash del nodeId asegura que cada nodo tiene su propio patrón
    const seedX = hashNode(nodeId, 0)
    const seedY = hashNode(nodeId, 1)
    const seedZ = hashNode(nodeId, 2)
    
    const t = elapsedTime * this.timeScale
    
    return {
      x: perlin3(seedX, t, 0) * this.noiseScale,
      y: perlin3(seedY, t, 0) * this.noiseScale,
      z: perlin3(seedZ, t, 0) * this.noiseScale * 0.5 // Z más sutil
    }
  }
}
```

**Parámetros Configurables:**
- `noiseScale`: 0.3-0.8 (rango de flotación en unidades del grafo)
- `timeScale`: 0.4-1.2 (velocidad de ondulación)
- `zAmplitude`: 0.3-0.6 (reduce movimiento vertical)

---

### 2.2 Sistema de Colisiones

**Objetivo:** Colisiones realistas que repelen sin alejarse demasiado.

```typescript
class CollisionSystem {
  private collisionRadius = 0.5 // Radio de interacción
  private dampingFactor = 0.92  // Absorbe energía (0.85-0.95)
  private maxRepulsion = 0.15   // Distancia máxima de repulsión
  
  computeCollisionForces(nodes: FloatingNode[]): Map<string, Vec3> {
    const collisionForces = new Map<string, Vec3>()
    
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i]
        const nodeB = nodes[j]
        
        const distance = vec3.distance(nodeA.position, nodeB.position)
        
        if (distance < this.collisionRadius * 2) {
          // Colisión detectada
          const overlap = this.collisionRadius * 2 - distance
          const direction = vec3.normalize(nodeA.position - nodeB.position)
          
          const repulsion = Math.min(
            overlap * 0.3, // Proporcional al overlap
            this.maxRepulsion
          )
          
          // Aplicar fuerza (se dispersa gradualmente por damping)
          collisionForces.set(
            nodeA.id,
            (collisionForces.get(nodeA.id) || vec3.zero) + direction * repulsion
          )
          collisionForces.set(
            nodeB.id,
            (collisionForces.get(nodeB.id) || vec3.zero) - direction * repulsion
          )
        }
      }
    }
    
    return collisionForces
  }
  
  applyDamping(velocity: Vec3): Vec3 {
    // La velocidad por colisión decae rápidamente
    return velocity * this.dampingFactor
  }
}
```

**Parámetros Cinematográficos:**
- `dampingFactor`: 0.90-0.96 (menor = más rápido se detiene, mayor = más rebote)
- `maxRepulsion`: 0.1-0.2 (qué tan lejos se empujan)
- `collisionRadius`: Basado en tamaño visual del nodo

**Efecto Visual Esperado:**
- Colisión suave, sin impactos bruscos
- Nodo se aleja pero vuelve a casa rápidamente
- Múltiples colisiones sucesivas generan "danza" visual

---

### 2.3 Dragging Interactivo

```typescript
class DragController {
  private isDragging = false
  private dragStartPos: Vec3 = null
  private homePosition: Vec3 = null
  private dragVelocity: Vec3 = null
  
  onMouseDown(nodeId: string, worldPos: Vec3) {
    this.isDragging = true
    this.homePosition = nodes[nodeId].homePos
    this.dragStartPos = worldPos
  }
  
  onMouseMove(currentWorldPos: Vec3) {
    if (!this.isDragging) return
    
    // Diferencia entre donde está y donde debería estar
    const dragDelta = currentWorldPos - this.dragStartPos
    
    // Suavizar el movimiento con easing (no inmediato)
    const easing = 0.15
    this.dragVelocity = dragDelta * easing
    
    // Nueva posición home (sigue al cursor pero con lag)
    this.homePosition += this.dragVelocity
  }
  
  onMouseUp() {
    this.isDragging = false
    // El nodo continúa flotando desde su nueva posición home
    // No hay "snap" brusco
  }
}
```

**Experiencia:**
- Drag fluidísimo con pequeño lag (sensación de peso)
- Cuando sueltas, nodo continúa flotando desde nueva posición
- Si hay colisiones durante drag, se resuelven sobre la marcha

---

## 3. Parámetros Cinematográficos (UI Toggle)

### 3.1 Preset "Cinematográfico" (por defecto)

```typescript
const CINEMATIC_PRESET = {
  floating: {
    enabled: true,
    noiseScale: 0.5,
    timeScale: 0.7,
    zAmplitude: 0.4,
  },
  collision: {
    enabled: true,
    dampingFactor: 0.92,
    maxRepulsion: 0.15,
    collisionRadius: 0.5,
  },
  drag: {
    easing: 0.15,
    returnToHomeSpeed: 0.08, // Si sueltas sin terminar drag
  },
  visual: {
    trailEffect: true,         // Mostrar trazos de movimiento
    collisionGlow: true,       // Glow al colisionar
    participleEffects: false,  // Deshabilitado por defecto (caro)
  }
}
```

### 3.2 Otros Presets

**"Dramático"** (movimiento más exagerado)
```
noiseScale: 0.8, timeScale: 0.5, dampingFactor: 0.88
```

**"Sutil"** (apenas perceptible)
```
noiseScale: 0.2, timeScale: 1.0, dampingFactor: 0.95
```

**"Physics"** (más realista, menos cinematográfico)
```
noiseScale: 0.3, timeScale: 1.0, dampingFactor: 0.90, maxRepulsion: 0.25
```

---

## 4. Implementación Detallada

### 4.1 Estructura de Datos

```typescript
interface FloatingNodeState {
  id: string
  homePosition: Vec3              // Posición "anclada"
  currentPosition: Vec3           // Posición actual (home + floating)
  floatingOffset: Vec3            // Del ruido Perlin
  collisionVelocity: Vec3         // Impulso de colisión (decae)
  isDragging: boolean
  dragOffset: Vec3                // Vector desde home mientras se arrastra
}

interface FloatingNodesConfig {
  floating: {
    enabled: boolean
    noiseScale: number
    timeScale: number
    zAmplitude: number
  }
  collision: {
    enabled: boolean
    dampingFactor: number
    maxRepulsion: number
    collisionRadius: (node: GraphRenderNode) => number
  }
  drag: {
    easing: number
    returnToHomeSpeed: number
  }
}
```

### 4.2 Integración con Deck.gl

```typescript
// En GraphSceneLayer.ts o nuevo FloatingNodesLayer.ts

class FloatingNodesLayer extends CompositeLayer {
  private floatingEngine: FloatingNodesEngine
  private nodeStates: Map<string, FloatingNodeState>
  private lastFrameTime: number = 0
  
  updateLayer(updateParams: UpdateParameters) {
    const now = performance.now() / 1000
    const deltaTime = now - this.lastFrameTime
    
    // Actualizar posiciones de todos los nodos
    this.nodeStates.forEach((state, nodeId) => {
      const node = this.props.model.nodes[nodeId]
      
      // 1. Calcular offset flotante
      state.floatingOffset = this.floatingEngine.getFloatingOffset(
        state.homePosition,
        now,
        nodeId
      )
      
      // 2. Detectar y aplicar colisiones
      const collisionForce = this.floatingEngine
        .getCollisionForces(this.nodeStates)
        .get(nodeId) || vec3.zero
      
      state.collisionVelocity = state.collisionVelocity
        .mult(this.config.collision.dampingFactor)
        .add(collisionForce)
      
      // 3. Si está siendo arrastrado, actualizar home
      if (state.isDragging) {
        state.homePosition = state.homePosition.add(state.dragOffset)
      }
      
      // 4. Calcular posición final
      state.currentPosition = state.homePosition
        .add(state.floatingOffset)
        .add(state.collisionVelocity)
    })
    
    this.lastFrameTime = now
  }
}
```

---

## 5. Consideraciones de Rendimiento

### 5.1 Optimizaciones

| Aspecto | Solución |
|--------|----------|
| **Cálculo Perlin** | Usar lookup table pre-calculada o WASM SimplexNoise |
| **Colisiones O(n²)** | Spatial hashing para n > 200 nodos |
| **GPU vs CPU** | Mantener en CPU para control fino, usar compute shader si n > 500 |
| **60fps** | Presupuesto: ~2-3ms por frame |

### 5.2 Fallback

Si hay lag detectado:
```typescript
if (frameTime > 16.67) {
  // Desactivar automáticamente efectos costosos
  config.visual.trailEffect = false
  config.visual.collisionGlow = false
  config.collision.enabled = true  // Mantener física crítica
}
```

---

## 6. Experiencia Cinematográfica: Detalles Visuales

### 6.1 Collision Feedback

```typescript
// Cuando hay colisión, añadir glow temporal
onCollisionDetected(nodeId: string) {
  const node = this.nodeStates[nodeId]
  node.collisionGlow = {
    intensity: 1.0,
    duration: 0.3, // segundos
  }
  
  // En shader: multiplicar color por (1 + glowIntensity)
}
```

### 6.2 Motion Trails (Opcional)

```typescript
// Guardar último 5 frames de posición
class MotionTrail {
  positions: Vec3[] = []
  maxLength = 5
  
  update(newPos: Vec3) {
    this.positions.unshift(newPos)
    if (this.positions.length > this.maxLength) {
      this.positions.pop()
    }
  }
  
  // Renderizar como LineLayer con fade gradient
}
```

### 6.3 Damping Visual

El `dampingFactor` define el "feel" del sistema:
- **0.85** → Rebote de pelota (poco cinematográfico)
- **0.90** → Dinamismo equilibrado ✨
- **0.94** → Muy suave, casi sin movimiento después de colisión
- **0.98** → Sistema casi energético (poco realista)

---

## 7. Checklist de Implementación

- [ ] Crear `FloatingNodesEngine` con Perlin noise
- [ ] Implementar `CollisionSystem` con spatial hashing
- [ ] Crear `DragController` con easing suave
- [ ] Integrar con `GraphSceneLayer` (nuevo layer o patch existente)
- [ ] UI para toggles y presets
- [ ] Optimización de performance
- [ ] Tests de colisiones edge cases
- [ ] Documentación de parámetros

---

## 8. Librerías Recomendadas

```json
{
  "simplex-noise": "^2.4.0",      // Ruido Perlin/Simplex
  "three-stdlib": "^1.30.0",      // Vec3 math (o implementar custom)
  "gl-matrix": "^3.4.3"           // Álgebra lineal ligera
}
```

O implementar custom si quieres evitar dependencias:
```typescript
// Fnv-1a hash para seed, lookup table para Perlin
// ~200 líneas de código)
```

---

## 9. Casos de Prueba

### 9.1 Colisiones

- [ ] Dos nodos cercanos: ¿Se repelen suavemente?
- [ ] Tres nodos en línea: ¿El del medio se aleja menos?
- [ ] Colisión durante drag: ¿Se resuelve fluidamente?
- [ ] Muchas colisiones simultáneas: ¿Sin popping?

### 9.2 Flotación

- [ ] ¿Cada nodo oscila independientemente?
- [ ] ¿Se mantiene cerca de su posición home?
- [ ] ¿El movimiento es suave (sin saltos)?

### 9.3 Interacción

- [ ] ¿Drag es fluido sin lag?
- [ ] ¿Soltar el mouse continúa flotando?
- [ ] ¿Puedo mover nodos a cualquier ubicación?

---

## 10. Ejemplo de Uso en la UI

```tsx
<GraphSettings>
  <Toggle 
    label="Floating Nodes"
    defaultChecked={true}
    onChange={(enabled) => floatingEngine.setEnabled(enabled)}
  />
  
  <Select 
    label="Movement Preset"
    defaultValue="cinematic"
    options={['cinematic', 'dramatic', 'subtle', 'physics']}
    onChange={(preset) => floatingEngine.applyPreset(preset)}
  />
  
  <Slider
    label="Float Amount"
    min={0.1}
    max={1}
    defaultValue={0.5}
    onChange={(val) => floatingEngine.config.floating.noiseScale = val}
  />
  
  <Slider
    label="Collision Damping"
    min={0.85}
    max={0.98}
    defaultValue={0.92}
    onChange={(val) => floatingEngine.config.collision.dampingFactor = val}
  />
</GraphSettings>
```

---

## Resumen: Por qué esto es "Cinematográfico"

✨ **Movimiento Orgánico:** Perlin noise genera fluctuaciones naturales, no robóticas
✨ **Peso Visual:** Damping hace que los nodos tengan "inercia"  
✨ **Interacción Fluida:** Drag con easing suave, no instantáneo
✨ **Dinámicas Sutiles:** Colisiones no detienen movimiento, lo modulan
✨ **Configurabilidad:** Presets que van de "sutil" a "dramático"
✨ **Escalabilidad:** Funciona bien desde 10 a 500+ nodos

