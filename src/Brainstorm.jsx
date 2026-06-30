import { useCallback, useRef } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

// Excalidraw is MIT-licensed: no license key, no watermark, no production
// restrictions. Drawings persist to localStorage (replacing tldraw's
// persistenceKey).
const STORAGE_KEY = "pg-schema-brainstorm";

function loadInitialData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return {
      elements: saved?.elements ?? [],
      appState: { theme: "dark", ...(saved?.appState ?? {}) },
      files: saved?.files ?? {},
    };
  } catch {
    return { appState: { theme: "dark" } };
  }
}

const initialData = loadInitialData();

export default function Brainstorm() {
  const saveTimer = useRef(null);

  const handleChange = useCallback((elements, appState, files) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            elements,
            appState: {
              viewBackgroundColor: appState.viewBackgroundColor,
              scrollX: appState.scrollX,
              scrollY: appState.scrollY,
              zoom: appState.zoom,
              theme: appState.theme,
            },
            files,
          })
        );
      } catch {
        // ignore quota / serialization errors
      }
    }, 400);
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <Excalidraw initialData={initialData} onChange={handleChange} />
    </div>
  );
}
