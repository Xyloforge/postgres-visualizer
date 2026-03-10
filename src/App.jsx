import { useState, useRef, useEffect, useCallback, useMemo } from "react";

// ── SQL Parser ──────────────────────────────────────────────────────────────
function parseSQL(sql) {
  const enums = [];
  const tables = [];

  const enumRe = /CREATE\s+TYPE\s+(\w+)\s+AS\s+ENUM\s*\(([^)]+)\)/gi;
  let m;
  while ((m = enumRe.exec(sql))) {
    const values = m[2].match(/'([^']+)'/g)?.map((v) => v.replace(/'/g, "")) || [];
    enums.push({ name: m[1], values });
  }

  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\);/gi;
  while ((m = tableRe.exec(sql))) {
    const tableName = m[1];
    const body = m[2];
    const columns = [];
    const constraints = [];
    const foreignKeys = [];
    const lines = splitTopLevel(body);

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (/^\s*(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)/i.test(line)) {
        const cName = line.match(/CONSTRAINT\s+(\w+)/i)?.[1] || null;
        if (/PRIMARY\s+KEY\s*\(([^)]+)\)/i.test(line)) {
          const cols = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i)[1].split(",").map((c) => c.trim());
          constraints.push({ type: "PRIMARY KEY", name: cName, columns: cols });
        } else if (/UNIQUE\s*\(([^)]+)\)/i.test(line)) {
          const cols = line.match(/UNIQUE\s*\(([^)]+)\)/i)[1].split(",").map((c) => c.trim());
          constraints.push({ type: "UNIQUE", name: cName, columns: cols });
        } else if (/CHECK\s*\(/i.test(line)) {
          const expr = extractParenContent(line, line.search(/CHECK\s*\(/i) + line.match(/CHECK\s*\(/i)[0].length - 1);
          constraints.push({ type: "CHECK", name: cName, expression: expr });
        } else if (/FOREIGN\s+KEY/i.test(line)) {
          const fkCols = line.match(/FOREIGN\s+KEY\s*\(([^)]+)\)/i)?.[1]?.split(",").map((c) => c.trim()) || [];
          const refMatch = line.match(/REFERENCES\s+(\w+)\s*\(([^)]+)\)/i);
          if (refMatch) foreignKeys.push({ columns: fkCols, refTable: refMatch[1], refColumns: refMatch[2].split(",").map((c) => c.trim()) });
        }
        continue;
      }

      const colMatch = line.match(/^(\w+)\s+(.+)/);
      if (!colMatch) continue;
      const colName = colMatch[1];
      if (["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"].includes(colName.toUpperCase())) continue;

      const rest = colMatch[2];
      const col = {
        name: colName,
        type: extractType(rest),
        nullable: !/NOT\s+NULL/i.test(rest),
        pk: /PRIMARY\s+KEY/i.test(rest),
        unique: /UNIQUE/i.test(rest) && !/PRIMARY/i.test(rest),
        default: extractDefault(rest),
        generated: /GENERATED\s+ALWAYS/i.test(rest),
        references: null,
        checks: [],
      };

      const refM = rest.match(/REFERENCES\s+(\w+)\s*\(([^)]+)\)/i);
      if (refM) {
        col.references = { table: refM[1], column: refM[2].trim() };
        const onDel = rest.match(/ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i);
        if (onDel) col.references.onDelete = onDel[1].toUpperCase();
        foreignKeys.push({ columns: [colName], refTable: refM[1], refColumns: [refM[2].trim()] });
      }
      columns.push(col);
    }

    for (const c of constraints) {
      if (c.type === "PRIMARY KEY") {
        for (const cn of c.columns) {
          const col = columns.find((x) => x.name === cn);
          if (col) col.pk = true;
        }
      }
    }
    tables.push({ name: tableName, columns, constraints, foreignKeys });
  }

  const indexes = [];
  const idxRe = /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)(\s+WHERE\s+.+?)?(?=;)/gi;
  while ((m = idxRe.exec(sql))) {
    indexes.push({ name: m[2], table: m[3], unique: !!m[1], columns: m[4].split(",").map((c) => c.trim()), partial: m[5]?.trim() || null });
  }
  return { enums, tables, indexes };
}

function splitTopLevel(s) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts;
}

function extractType(s) {
  const t = s.match(/^(\w+(?:\s*\([^)]+\))?(?:\s*\[\])?)/i);
  return t ? t[1].toUpperCase() : "UNKNOWN";
}

function extractDefault(s) {
  const m = s.match(/DEFAULT\s+(.+?)(?=\s+(?:NOT|NULL|PRIMARY|UNIQUE|REFERENCES|CHECK|CONSTRAINT|GENERATED|,|$))/i);
  return m ? m[1].trim() : null;
}

function extractParenContent(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") { depth--; if (depth === 0) return s.slice(openIdx, i + 1); }
  }
  return s.slice(openIdx);
}

// ── SQL Syntax Highlighter ──────────────────────────────────────────────────
const SQL_KEYWORDS = new Set([
  "CREATE","TABLE","TYPE","AS","ENUM","INDEX","UNIQUE","ON","IF","NOT","EXISTS",
  "PRIMARY","KEY","REFERENCES","DEFAULT","NULL","CHECK","CONSTRAINT","CASCADE",
  "SET","DELETE","INSERT","INTO","VALUES","SELECT","FROM","WHERE","AND","OR",
  "FOREIGN","TRIGGER","BEFORE","UPDATE","FOR","EACH","ROW","EXECUTE","FUNCTION",
  "RETURNS","BEGIN","END","NEW","RETURN","LANGUAGE","REPLACE","EXTENSION",
  "GENERATED","ALWAYS","STORED","CASE","WHEN","THEN","ELSE","BETWEEN","IN",
  "BOOLEAN","TRUE","FALSE","NOW","DESC","ASC","BIGSERIAL","SERIAL","TEXT","INT",
  "BIGINT","NUMERIC","UUID","TIMESTAMPTZ","TIMESTAMP","VARCHAR","CHAR","FLOAT",
  "DOUBLE","PRECISION","REAL","SMALLINT","DATE","TIME","INTERVAL","JSONB","JSON",
  "ROUND","WITH","JOIN","LEFT","RIGHT","INNER","OUTER","GROUP","BY","HAVING",
  "ORDER","LIMIT","OFFSET","DISTINCT","ALL","ANY","SOME","LIKE","ILIKE","IS","PARTIAL",
]);

function highlightSQL(code) {
  const tokens = [];
  let i = 0;
  while (i < code.length) {
    if (code[i] === "-" && code[i + 1] === "-") {
      let end = code.indexOf("\n", i);
      if (end === -1) end = code.length;
      tokens.push({ type: "comment", text: code.slice(i, end) });
      i = end; continue;
    }
    if (code[i] === "'") {
      let j = i + 1;
      while (j < code.length && !(code[j] === "'" && code[j + 1] !== "'")) {
        if (code[j] === "'" && code[j + 1] === "'") j += 2; else j++;
      }
      tokens.push({ type: "string", text: code.slice(i, j + 1) });
      i = j + 1; continue;
    }
    if (/\d/.test(code[i]) && (i === 0 || /[\s,(=+\-*/]/.test(code[i - 1]))) {
      let j = i;
      while (j < code.length && /[\d.]/.test(code[j])) j++;
      tokens.push({ type: "number", text: code.slice(i, j) });
      i = j; continue;
    }
    if (/[a-zA-Z_]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_]/.test(code[j])) j++;
      const word = code.slice(i, j);
      const upper = word.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) tokens.push({ type: "keyword", text: word });
      else if (/^(plpgsql|pgcrypto)$/i.test(word)) tokens.push({ type: "builtin", text: word });
      else tokens.push({ type: "identifier", text: word });
      i = j; continue;
    }
    if ("();,{}[]".includes(code[i])) { tokens.push({ type: "punctuation", text: code[i] }); i++; continue; }
    if ("=<>!+-*/%|&".includes(code[i])) { tokens.push({ type: "operator", text: code[i] }); i++; continue; }
    if (code[i] === "\n") { tokens.push({ type: "newline", text: "\n" }); i++; continue; }
    tokens.push({ type: "plain", text: code[i] }); i++;
  }
  return tokens;
}

const TOKEN_COLORS = {
  keyword: "#ff79c6", string: "#f1fa8c", number: "#bd93f9", comment: "#6272a4",
  identifier: "#f8f8f2", builtin: "#8be9fd", punctuation: "#6c7086",
  operator: "#ff6e6e", plain: "#cdd6f4", newline: "",
};

// ── SQL Editor ──────────────────────────────────────────────────────────────
function SQLEditor({ value, onChange }) {
  const textareaRef = useRef(null);
  const highlightRef = useRef(null);
  const lineNumRef = useRef(null);
  const lines = value.split("\n");
  const tokens = useMemo(() => highlightSQL(value), [value]);

  const syncScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current && lineNumRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
      lineNumRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const handleTab = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = textareaRef.current;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const nv = value.slice(0, start) + "  " + value.slice(end);
      onChange(nv);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
    }
  };

  return (
    <div style={{ display: "flex", height: "100%", position: "relative", fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace", fontSize: 13, lineHeight: "20px" }}>
      <div ref={lineNumRef} style={{ width: 48, overflowY: "hidden", background: "#181825", color: "#585b70", textAlign: "right", padding: "12px 8px 12px 0", userSelect: "none", flexShrink: 0, borderRight: "1px solid #313244" }}>
        {lines.map((_, i) => <div key={i} style={{ height: 20, fontSize: 12, lineHeight: "20px" }}>{i + 1}</div>)}
      </div>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <pre ref={highlightRef} aria-hidden style={{ position: "absolute", inset: 0, margin: 0, padding: 12, overflow: "auto", whiteSpace: "pre", color: "#cdd6f4", pointerEvents: "none", zIndex: 1 }}>
          {tokens.map((t, i) => t.type === "newline" ? "\n" : <span key={i} style={{ color: TOKEN_COLORS[t.type] || "#cdd6f4" }}>{t.text}</span>)}
        </pre>
        <textarea
          ref={textareaRef} value={value} onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll} onKeyDown={handleTab} spellCheck={false}
          placeholder="Paste your PostgreSQL schema here..."
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", margin: 0, padding: 12, fontFamily: "inherit", fontSize: "inherit", lineHeight: "inherit", background: "transparent", color: "transparent", caretColor: "#f5e0dc", border: "none", outline: "none", resize: "none", zIndex: 2, whiteSpace: "pre", overflow: "auto" }}
        />
      </div>
    </div>
  );
}

// ── ER Diagram ──────────────────────────────────────────────────────────────
const TABLE_COLORS = [
  { header: "#89b4fa", headerText: "#1e1e2e" },
  { header: "#a6e3a1", headerText: "#1e1e2e" },
  { header: "#f9e2af", headerText: "#1e1e2e" },
  { header: "#f38ba8", headerText: "#1e1e2e" },
  { header: "#cba6f7", headerText: "#1e1e2e" },
  { header: "#94e2d5", headerText: "#1e1e2e" },
  { header: "#fab387", headerText: "#1e1e2e" },
  { header: "#74c7ec", headerText: "#1e1e2e" },
  { header: "#f5c2e7", headerText: "#1e1e2e" },
  { header: "#eba0ac", headerText: "#1e1e2e" },
];

const COL_H = 26, TABLE_W = 290, HEADER_H = 38, ENUM_W = 200;

function layoutPositions(tables, enums) {
  const positions = {};
  const cols = 4, gapX = 360, gapY = 60;
  let x = 60, y = 60, maxH = 0, col = 0;
  for (const t of tables) {
    const h = HEADER_H + t.columns.length * COL_H + 12;
    positions[t.name] = { x, y, w: TABLE_W, h };
    maxH = Math.max(maxH, h);
    col++;
    if (col >= cols) { col = 0; x = 60; y += maxH + gapY; maxH = 0; } else { x += gapX; }
  }
  if (col !== 0) { y += maxH + gapY + 20; x = 60; col = 0; maxH = 0; }
  for (const e of enums) {
    const h = 34 + e.values.length * 22 + 10;
    positions["enum:" + e.name] = { x, y, w: ENUM_W, h };
    maxH = Math.max(maxH, h);
    col++;
    if (col >= 5) { col = 0; x = 60; y += maxH + gapY; maxH = 0; } else { x += ENUM_W + 40; }
  }
  return positions;
}

const POSITIONS_KEY = "pg-schema-studio-positions";

function loadSavedPositions() {
  try { return JSON.parse(localStorage.getItem(POSITIONS_KEY)) || {}; } catch { return {}; }
}

function ERDiagram({ schema }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [positions, setPositions] = useState({});
  const [dragging, setDragging] = useState(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.85);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [selectedTable, setSelectedTable] = useState(null);

  useEffect(() => {
    const defaults = layoutPositions(schema.tables, schema.enums);
    const saved = loadSavedPositions();
    const merged = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (saved[key]) merged[key] = { ...defaults[key], x: saved[key].x, y: saved[key].y };
    }
    setPositions(merged);
    setSelectedTable(null);
  }, [schema]);

  const startDrag = (name, e) => {
    e.stopPropagation();
    const pos = positions[name];
    setDragging({ name, ox: e.clientX / zoom - pos.x + pan.x / zoom, oy: e.clientY / zoom - pos.y + pan.y / zoom });
  };

  const onMouseMove = useCallback((e) => {
    if (dragging) {
      setPositions((p) => ({ ...p, [dragging.name]: { ...p[dragging.name], x: e.clientX / zoom - dragging.ox + pan.x / zoom, y: e.clientY / zoom - dragging.oy + pan.y / zoom } }));
    } else if (isPanning && panStart.current) {
      setPan({ x: panStart.current.panX + (panStart.current.sx - e.clientX), y: panStart.current.panY + (panStart.current.sy - e.clientY) });
    }
  }, [dragging, isPanning, zoom, pan]);

  const onMouseUp = useCallback(() => {
    if (dragging) {
      setPositions((p) => {
        const saved = loadSavedPositions();
        const updated = { ...saved };
        for (const [k, v] of Object.entries(p)) updated[k] = { x: v.x, y: v.y };
        localStorage.setItem(POSITIONS_KEY, JSON.stringify(updated));
        return p;
      });
    }
    setDragging(null);
    setIsPanning(false);
    panStart.current = null;
  }, [dragging]);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
  }, [onMouseMove, onMouseUp]);

  const onBgMouseDown = (e) => {
    if (e.target === svgRef.current || e.target.classList.contains("er-bg")) {
      setIsPanning(true);
      panStart.current = { sx: e.clientX, sy: e.clientY, panX: pan.x, panY: pan.y };
      setSelectedTable(null);
    }
  };

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const newZoom = Math.min(2, Math.max(0.2, zoom + (e.deltaY > 0 ? -0.06 : 0.06)));
    const scale = newZoom / zoom;
    setPan({ x: (pan.x + sx) * scale - sx, y: (pan.y + sy) * scale - sy });
    setZoom(newZoom);
  }, [zoom, pan]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.addEventListener("wheel", onWheel, { passive: false });
    return () => { if (el) el.removeEventListener("wheel", onWheel); };
  }, [onWheel]);

  const relations = [];
  for (const t of schema.tables) {
    for (const fk of t.foreignKeys) {
      if (positions[t.name] && positions[fk.refTable]) {
        relations.push({ from: t.name, fromCol: fk.columns[0], to: fk.refTable, toCol: fk.refColumns[0] });
      }
    }
  }

  const getColY = (tableName, colName) => {
    const t = schema.tables.find((x) => x.name === tableName);
    if (!t) return 0;
    const idx = t.columns.findIndex((c) => c.name === colName);
    return HEADER_H + (idx >= 0 ? idx : 0) * COL_H + COL_H / 2;
  };

  const resetLayout = () => {
    localStorage.removeItem(POSITIONS_KEY);
    setPositions(layoutPositions(schema.tables, schema.enums));
    setZoom(0.85);
    setPan({ x: 0, y: 0 });
  };

  const viewBox = `${pan.x / zoom} ${pan.y / zoom} ${(containerRef.current?.clientWidth || 1400) / zoom} ${(containerRef.current?.clientHeight || 800) / zoom}`;
  const selTable = schema.tables.find((t) => t.name === selectedTable);
  const selIndexes = schema.indexes?.filter((i) => i.table === selectedTable) || [];

  return (
    <div style={{ display: "flex", height: "100%", background: "#11111b" }}>
      <div ref={containerRef} style={{ flex: 1, cursor: isPanning ? "grabbing" : "grab", overflow: "hidden", position: "relative" }}>
        {/* Zoom controls */}
        <div style={{ position: "absolute", bottom: 16, right: selectedTable ? 336 : 16, zIndex: 10, display: "flex", gap: 4, background: "#1e1e2e", borderRadius: 8, padding: 4, border: "1px solid #313244", transition: "right 0.2s" }}>
          <button onClick={() => setZoom((z) => Math.min(2, z + 0.15))} style={zoomBtnStyle}>+</button>
          <span style={{ color: "#a6adc8", fontSize: 12, padding: "4px 8px", minWidth: 44, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.max(0.2, z - 0.15))} style={zoomBtnStyle}>−</button>
          <button onClick={() => { setZoom(0.85); setPan({ x: 0, y: 0 }); }} style={{ ...zoomBtnStyle, fontSize: 11, padding: "4px 8px" }}>Reset</button>
          <div style={{ width: 1, background: "#45475a", margin: "4px 2px" }} />
          <button onClick={resetLayout} style={{ ...zoomBtnStyle, fontSize: 11, padding: "4px 8px", color: "#f38ba8" }} title="Reset card positions to default layout">Reset Layout</button>
        </div>

        <svg ref={svgRef} width="100%" height="100%" viewBox={viewBox} onMouseDown={onBgMouseDown} style={{ display: "block" }}>
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#181825" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect className="er-bg" x={-5000} y={-5000} width={15000} height={15000} fill="url(#grid)" />

          {/* Relations */}
          {relations.map((r, i) => {
            const fp = positions[r.from], tp = positions[r.to];
            if (!fp || !tp) return null;
            const fy = fp.y + getColY(r.from, r.fromCol);
            const ty = tp.y + getColY(r.to, r.toCol);
            let x1, x2;
            if (fp.x + TABLE_W < tp.x) { x1 = fp.x + TABLE_W; x2 = tp.x; }
            else if (tp.x + TABLE_W < fp.x) { x1 = fp.x; x2 = tp.x + TABLE_W; }
            else { x1 = fp.x + TABLE_W; x2 = tp.x + TABLE_W; }
            const mx = (x1 + x2) / 2;
            const hl = hovered === r.from || hovered === r.to;
            return (
              <g key={i} opacity={hovered && !hl ? 0.15 : 1}>
                <path d={`M ${x1} ${fy} C ${mx} ${fy}, ${mx} ${ty}, ${x2} ${ty}`} fill="none" stroke={hl ? "#f9e2af" : "#585b70"} strokeWidth={hl ? 2.5 : 1.5} strokeDasharray={hl ? "" : "6 3"} />
                <circle cx={x1} cy={fy} r={4} fill={hl ? "#f9e2af" : "#585b70"} />
                <polygon points={`${x2},${ty - 5} ${x2 + (x2 > x1 ? -10 : 10)},${ty} ${x2},${ty + 5}`} fill={hl ? "#f9e2af" : "#585b70"} />
              </g>
            );
          })}

          {/* Enums */}
          {schema.enums.map((en) => {
            const pos = positions["enum:" + en.name];
            if (!pos) return null;
            return (
              <g key={"e:" + en.name} onMouseDown={(e) => startDrag("enum:" + en.name, e)} style={{ cursor: "move" }}>
                <rect x={pos.x} y={pos.y} width={pos.w} height={pos.h} rx={8} fill="#1e1e2e" stroke="#45475a" strokeWidth={1} />
                <rect x={pos.x} y={pos.y} width={pos.w} height={28} rx={8} fill="#45475a" />
                <rect x={pos.x} y={pos.y + 20} width={pos.w} height={8} fill="#45475a" />
                <text x={pos.x + 10} y={pos.y + 19} fill="#cba6f7" fontSize={12} fontWeight={700} fontFamily="monospace">⟨enum⟩ {en.name}</text>
                {en.values.map((v, j) => <text key={j} x={pos.x + 14} y={pos.y + 34 + j * 22 + 13} fill="#a6adc8" fontSize={11} fontFamily="monospace">'{v}'</text>)}
              </g>
            );
          })}

          {/* Tables */}
          {schema.tables.map((t, ti) => {
            const pos = positions[t.name];
            if (!pos) return null;
            const color = TABLE_COLORS[ti % TABLE_COLORS.length];
            const isHov = hovered === t.name;
            const isSel = selectedTable === t.name;
            return (
              <g key={t.name} onMouseDown={(e) => startDrag(t.name, e)} onMouseEnter={() => setHovered(t.name)} onMouseLeave={() => setHovered(null)} onClick={(e) => { e.stopPropagation(); setSelectedTable(t.name); }} style={{ cursor: "move" }}
                opacity={hovered && !isHov && !relations.some((r) => (r.from === t.name && r.to === hovered) || (r.to === t.name && r.from === hovered)) ? 0.4 : 1}>
                <rect x={pos.x + 3} y={pos.y + 3} width={TABLE_W} height={pos.h} rx={10} fill="rgba(0,0,0,0.3)" />
                <rect x={pos.x} y={pos.y} width={TABLE_W} height={pos.h} rx={10} fill="#1e1e2e" stroke={isSel ? color.header : isHov ? "#585b70" : "#313244"} strokeWidth={isSel ? 2.5 : isHov ? 2 : 1} />
                <rect x={pos.x} y={pos.y} width={TABLE_W} height={HEADER_H} rx={10} fill={color.header} />
                <rect x={pos.x} y={pos.y + HEADER_H - 10} width={TABLE_W} height={10} fill={color.header} />
                <text x={pos.x + 14} y={pos.y + 25} fill={color.headerText} fontSize={14} fontWeight={800} fontFamily="monospace">{t.name}</text>
                <text x={pos.x + TABLE_W - 14} y={pos.y + 24} fill={color.headerText} fontSize={10} fontFamily="monospace" textAnchor="end" opacity={0.6}>{t.columns.length} cols</text>
                {t.columns.map((c, ci) => {
                  const cy = pos.y + HEADER_H + ci * COL_H;
                  return (
                    <g key={c.name}>
                      {ci % 2 === 0 && <rect x={pos.x + 1} y={cy} width={TABLE_W - 2} height={COL_H} fill="rgba(255,255,255,0.02)" />}
                      <text x={pos.x + 10} y={cy + 17} fontSize={10} fontFamily="monospace" fill={c.pk ? "#f9e2af" : c.references ? "#89b4fa" : "#585b70"}>{c.pk ? "PK" : c.references ? "FK" : "  "}</text>
                      <text x={pos.x + 34} y={cy + 17} fontSize={12} fontFamily="monospace" fill={c.pk ? "#f9e2af" : "#cdd6f4"} fontWeight={c.pk ? 700 : 400}>{c.name}</text>
                      <text x={pos.x + TABLE_W - 10} y={cy + 17} fontSize={10.5} fontFamily="monospace" fill="#a6adc8" textAnchor="end" opacity={0.7}>{c.type}{!c.nullable ? " ✱" : ""}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Detail panel */}
      {selTable && (
        <div style={{ width: 320, background: "#1e1e2e", borderLeft: "1px solid #313244", overflowY: "auto", padding: 20, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: "#cdd6f4", fontFamily: "monospace", fontSize: 16 }}>{selectedTable}</h3>
            <button onClick={() => setSelectedTable(null)} style={{ background: "none", border: "none", color: "#6c7086", cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
          </div>
          <Section title="Columns">
            {selTable.columns.map((c) => (
              <div key={c.name} style={{ marginBottom: 10, padding: "6px 8px", background: "#181825", borderRadius: 6, borderLeft: `3px solid ${c.pk ? "#f9e2af" : c.references ? "#89b4fa" : "#313244"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#cdd6f4", fontFamily: "monospace", fontSize: 12, fontWeight: 600 }}>{c.name}</span>
                  <span style={{ color: "#a6adc8", fontFamily: "monospace", fontSize: 11 }}>{c.type}</span>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                  {c.pk && <Badge color="#f9e2af">PK</Badge>}
                  {c.unique && <Badge color="#94e2d5">UNIQUE</Badge>}
                  {!c.nullable && <Badge color="#f38ba8">NOT NULL</Badge>}
                  {c.generated && <Badge color="#cba6f7">GENERATED</Badge>}
                  {c.default && <Badge color="#6c7086">DEFAULT: {c.default}</Badge>}
                </div>
                {c.references && (
                  <div style={{ marginTop: 4, fontSize: 11, color: "#89b4fa", fontFamily: "monospace" }}>
                    → {c.references.table}.{c.references.column}
                    {c.references.onDelete && <span style={{ color: "#6c7086" }}> ON DELETE {c.references.onDelete}</span>}
                  </div>
                )}
              </div>
            ))}
          </Section>
          {selTable.constraints.length > 0 && (
            <Section title="Constraints">
              {selTable.constraints.map((c, i) => (
                <div key={i} style={{ marginBottom: 6, padding: "4px 8px", background: "#181825", borderRadius: 4, fontSize: 11, fontFamily: "monospace", color: "#a6adc8" }}>
                  <span style={{ color: "#fab387" }}>{c.type}</span>
                  {c.name && <span style={{ color: "#6c7086" }}> ({c.name})</span>}
                  {c.columns && <span> [{c.columns.join(", ")}]</span>}
                  {c.expression && <div style={{ color: "#6c7086", marginTop: 2, wordBreak: "break-all" }}>{c.expression}</div>}
                </div>
              ))}
            </Section>
          )}
          {selIndexes.length > 0 && (
            <Section title="Indexes">
              {selIndexes.map((idx, i) => (
                <div key={i} style={{ marginBottom: 6, padding: "4px 8px", background: "#181825", borderRadius: 4, fontSize: 11, fontFamily: "monospace", color: "#a6adc8" }}>
                  <div style={{ color: idx.unique ? "#94e2d5" : "#cdd6f4" }}>{idx.unique && "UNIQUE "}{idx.name}</div>
                  <div style={{ color: "#6c7086" }}>({idx.columns.join(", ")})</div>
                  {idx.partial && <div style={{ color: "#cba6f7", fontSize: 10 }}>{idx.partial}</div>}
                </div>
              ))}
            </Section>
          )}
          {selTable.foreignKeys.length > 0 && (
            <Section title="Foreign Keys">
              {selTable.foreignKeys.map((fk, i) => (
                <div key={i} style={{ marginBottom: 4, padding: "4px 8px", background: "#181825", borderRadius: 4, fontSize: 11, fontFamily: "monospace", color: "#89b4fa" }}>
                  {fk.columns.join(", ")} → {fk.refTable}({fk.refColumns.join(", ")})
                </div>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h4 style={{ margin: "0 0 8px 0", color: "#a6adc8", fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5 }}>{title}</h4>
      {children}
    </div>
  );
}

function Badge({ color, children }) {
  return (
    <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: 9, fontFamily: "monospace", fontWeight: 600, color, border: `1px solid ${color}33`, background: `${color}15` }}>{children}</span>
  );
}

const zoomBtnStyle = {
  background: "#313244", border: "none", color: "#cdd6f4", width: 28, height: 28,
  borderRadius: 4, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
};

// ── Main App ────────────────────────────────────────────────────────────────
const DEFAULT_SQL = `CREATE TYPE status AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE priority AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TABLE users (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email      TEXT        UNIQUE NOT NULL,
    name       TEXT        NOT NULL,
    status     status      NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE projects (
    id          BIGSERIAL     PRIMARY KEY,
    owner_id    UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name        TEXT          NOT NULL,
    budget      NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_archived BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_budget CHECK (budget >= 0)
);

CREATE TABLE tasks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  BIGINT      NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    assigned_to UUID        REFERENCES users (id) ON DELETE SET NULL,
    title       TEXT        NOT NULL,
    priority    priority    NOT NULL DEFAULT 'medium',
    is_done     BOOLEAN     NOT NULL DEFAULT FALSE,
    due_at      TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_title CHECK (char_length(title) > 0)
);

CREATE INDEX idx_tasks_project ON tasks (project_id);
CREATE INDEX idx_tasks_assignee ON tasks (assigned_to);

CREATE TABLE comments (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID        NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    author_id  UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    body       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tags (
    id   BIGSERIAL PRIMARY KEY,
    name TEXT      NOT NULL UNIQUE
);

CREATE TABLE task_tags (
    task_id UUID   NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    tag_id  BIGINT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
);`;

const STORAGE_KEY = "pg-schema-studio-sql";

export default function App() {
  const [sql, setSql] = useState(() => localStorage.getItem(STORAGE_KEY) ?? DEFAULT_SQL);
  const [splitView, setSplitView] = useState(true);
  const [activeTab, setActiveTab] = useState("diagram");
  const [parseError, setParseError] = useState(null);

  const schema = useMemo(() => {
    try {
      const s = parseSQL(sql);
      setParseError(null);
      return s;
    } catch (e) {
      setParseError(e.message);
      return { enums: [], tables: [], indexes: [] };
    }
  }, [sql]);

  const stats = useMemo(() => ({
    tables: schema.tables.length,
    enums: schema.enums.length,
    columns: schema.tables.reduce((a, t) => a + t.columns.length, 0),
    relations: schema.tables.reduce((a, t) => a + t.foreignKeys.length, 0),
    indexes: schema.indexes?.length || 0,
  }), [schema]);

  const handleSqlChange = (value) => {
    setSql(value);
    localStorage.setItem(STORAGE_KEY, value);
  };

  const handleClear = () => handleSqlChange("");
  const handleReset = () => handleSqlChange(DEFAULT_SQL);
  const handleCopy = () => { navigator.clipboard.writeText(sql); };
  const handleDownload = () => {
    const blob = new Blob([sql], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "schema.sql";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#11111b", color: "#cdd6f4", fontFamily: "'Inter','Segoe UI',sans-serif" }}>
      {/* Header */}
      <div style={{ height: 48, background: "#181825", borderBottom: "1px solid #313244", display: "flex", alignItems: "center", padding: "0 16px", gap: 8, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 16 }}>
          <span style={{ fontSize: 18 }}>◇</span>
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: 0.5 }}>PG Schema Visualizer</span>
          <span style={{ fontSize: 10, color: "#6c7086", background: "#313244", padding: "2px 6px", borderRadius: 4 }}>PostgreSQL</span>
        </div>

        <div style={{ display: "flex", gap: 2, background: "#11111b", borderRadius: 6, padding: 2 }}>
          {splitView ? (
            <TabBtn active label="Split View" onClick={() => {}} />
          ) : (
            <>
              <TabBtn active={activeTab === "editor"} label="Editor" onClick={() => setActiveTab("editor")} />
              <TabBtn active={activeTab === "diagram"} label="Diagram" onClick={() => setActiveTab("diagram")} />
            </>
          )}
        </div>
        <button onClick={() => setSplitView(!splitView)} style={toolBtnStyle} title={splitView ? "Single view" : "Split view"}>
          {splitView ? "⊞" : "⊟"}
        </button>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", gap: 12, marginRight: 12 }}>
          <Stat label="Tables" value={stats.tables} color="#89b4fa" />
          <Stat label="Enums" value={stats.enums} color="#cba6f7" />
          <Stat label="Cols" value={stats.columns} color="#a6e3a1" />
          <Stat label="FKs" value={stats.relations} color="#f9e2af" />
          <Stat label="Idx" value={stats.indexes} color="#94e2d5" />
        </div>

        <div style={{ width: 1, height: 24, background: "#313244" }} />
        <button onClick={handleCopy} style={toolBtnStyle}>Copy SQL</button>
        <button onClick={handleDownload} style={toolBtnStyle}>Download .sql</button>
        <button onClick={handleClear} style={toolBtnStyle}>Clear</button>
        <button onClick={handleReset} style={{ ...toolBtnStyle, color: "#94e2d5" }}>Demo</button>
      </div>

      {parseError && (
        <div style={{ background: "#f38ba822", color: "#f38ba8", padding: "6px 16px", fontSize: 12, fontFamily: "monospace", borderBottom: "1px solid #f38ba844" }}>
          Parse error: {parseError}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {(splitView || activeTab === "editor") && (
          <div style={{ width: splitView ? "42%" : "100%", display: "flex", flexDirection: "column", borderRight: splitView ? "2px solid #313244" : "none", flexShrink: 0 }}>
            <div style={{ flex: 1, overflow: "hidden", background: "#1e1e2e" }}>
              <SQLEditor value={sql} onChange={handleSqlChange} />
            </div>
          </div>
        )}
        {(splitView || activeTab === "diagram") && (
          <div style={{ flex: 1, overflow: "hidden" }}>
            {schema.tables.length === 0 && !parseError ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#585b70", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 40, opacity: 0.3 }}>◇</span>
                <span style={{ fontSize: 14 }}>Paste PostgreSQL DDL in the editor to visualize</span>
                <span style={{ fontSize: 12, color: "#45475a" }}>or click Demo to load a sample schema</span>
              </div>
            ) : (
              <ERDiagram schema={schema} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, label, onClick }) {
  return <button onClick={onClick} style={{ background: active ? "#313244" : "transparent", border: "none", color: active ? "#cdd6f4" : "#6c7086", padding: "4px 12px", borderRadius: 4, fontSize: 12, cursor: "pointer", fontWeight: active ? 600 : 400 }}>{label}</button>;
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: 9, color: "#6c7086", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

const toolBtnStyle = {
  background: "#313244", border: "1px solid #45475a", color: "#cdd6f4",
  padding: "4px 10px", borderRadius: 5, fontSize: 12, cursor: "pointer",
  fontFamily: "'Inter',sans-serif",
};