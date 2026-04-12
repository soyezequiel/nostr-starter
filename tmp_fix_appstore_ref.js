const fs = require('fs');
const filepath = 'src/features/graph/render/DeckGraphRenderer.tsx';
let c = fs.readFileSync(filepath, 'utf8');

// 1. Update import
c = c.replace(
  "import { useAppStore } from '@/features/graph/app/store'",
  "import { appStore, useAppStore } from '@/features/graph/app/store'"
);

// 2. Fix the state update calls
c = c.replace(
  'useAppStore.getState().setHoveredNode(pubkey, neighbors)',
  'appStore.getState().setHoveredNode(pubkey, neighbors)'
);
c = c.replace(
  'useAppStore.getState().clearHover()',
  'appStore.getState().clearHover()'
);

fs.writeFileSync(filepath, c);
console.log('Update fix done');
