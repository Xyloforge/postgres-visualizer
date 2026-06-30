import { Tldraw } from 'tldraw';
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite';
import 'tldraw/tldraw.css';

// Self-host tldraw assets (icons/fonts/translations/embed-icons) from our own
// origin instead of cdn.tldraw.com. Firefox & Safari block the cross-origin
// SVG sprite load in production, which produces the console "Security Error".
const assetUrls = getAssetUrlsByImport();

export default function Brainstorm() {
  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <Tldraw
        persistenceKey="pg-schema-brainstorm"
        inferDarkMode
        assetUrls={assetUrls}
      />
    </div>
  );
}
