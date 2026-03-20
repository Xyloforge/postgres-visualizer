import { Tldraw } from 'tldraw';
import 'tldraw/tldraw.css';

export default function Brainstorm() {
  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <Tldraw persistenceKey="pg-schema-brainstorm" inferDarkMode />
    </div>
  );
}
