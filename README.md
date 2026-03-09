# Postgres Visualizer

A real-time SQL schema editor and interactive ER diagram visualizer built with React. Write or paste PostgreSQL DDL and instantly see your database structure come to life.

![Built with React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-DDL-4169e1?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### SQL Editor

- Full syntax highlighting with Catppuccin Mocha color theme
- Line numbers with synchronized scrolling
- Tab key support (2-space indent)
- Real-time parsing — diagram updates as you type
- Token-level highlighting for keywords, strings, numbers, comments, identifiers, operators, and built-in functions

### ER Diagram Visualizer

- Interactive SVG canvas with pan (click-drag background) and zoom (scroll wheel or buttons)
- Draggable table and enum nodes — rearrange layout freely
- Foreign key relationships rendered as curved Bézier paths with directional arrows
- Hover highlighting — hover a table to spotlight its connections and fade unrelated nodes
- Click any table to open a detail panel showing columns, constraints, indexes, and foreign keys
- Enum types displayed as distinct styled boxes
- Column badges for PK, FK, NOT NULL, UNIQUE, DEFAULT, and GENERATED

### File Operations

- **Open** — load any `.sql` file from disk
- **Save** — download current editor content with the current filename
- **Save As** — download with a custom filename
- **Export SVG** — export the current diagram as an SVG image

### Schema Stats

- Live stats bar showing total tables, enums, columns, relations, and indexes at a glance

---

## Quick Start

### Option 1: Vite + React (Recommended)

```bash
npm create vite@latest sql-schema-studio -- --template react
cd sql-schema-studio
npm install
```

Replace `src/App.jsx` with the contents of `sql-schema-visualizer.jsx`, then:

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### Option 2: Add to an existing React project

Copy `sql-schema-visualizer.jsx` into your project and import the default export as your root or page component.

---

## Supported SQL Syntax

### Fully Supported (PostgreSQL)

| Feature                                | Example                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `CREATE TABLE`                         | columns, inline constraints                                                 |
| `CREATE TYPE ... AS ENUM`              | custom enum types                                                           |
| `PRIMARY KEY`                          | inline and table-level                                                      |
| `REFERENCES` / `FOREIGN KEY`           | with `ON DELETE CASCADE / SET NULL`                                         |
| `UNIQUE`                               | inline, table-level, and partial unique indexes                             |
| `CHECK`                                | named and unnamed constraints                                               |
| `NOT NULL` / `DEFAULT`                 | all default expressions                                                     |
| `GENERATED ALWAYS AS ... STORED`       | computed columns                                                            |
| `CREATE INDEX` / `CREATE UNIQUE INDEX` | including `WHERE` clause (partial)                                          |
| PostgreSQL types                       | `UUID`, `TIMESTAMPTZ`, `TEXT[]`, `BIGSERIAL`, `NUMERIC(p,s)`, `JSONB`, etc. |

### Partially Supported

| Feature           | Notes                                                           |
| ----------------- | --------------------------------------------------------------- |
| Standard ANSI SQL | Basic `CREATE TABLE`, `REFERENCES`, `CHECK`, `UNIQUE` work fine |
| Comments          | `--` single-line comments are highlighted and ignored by parser |

### Not Supported

| Feature                                   | Reason                                              |
| ----------------------------------------- | --------------------------------------------------- |
| MySQL `AUTO_INCREMENT`, `ENGINE=`         | MySQL-specific DDL syntax                           |
| SQL Server `IDENTITY`, `GO`, `[brackets]` | T-SQL syntax                                        |
| SQLite `AUTOINCREMENT`, `WITHOUT ROWID`   | SQLite-specific                                     |
| `ALTER TABLE`                             | Only `CREATE` statements are parsed                 |
| `CREATE VIEW` / `CREATE FUNCTION`         | Not included in ER diagram scope                    |
| Backtick-quoted identifiers               | MySQL convention — use double quotes or plain names |

---

## Usage Guide

### Editor Panel

Write or paste SQL DDL in the left panel. The parser runs on every keystroke and updates the diagram in real-time. Syntax errors will show a red banner below the toolbar.

### Diagram Panel

- **Pan** — click and drag the background
- **Zoom** — scroll wheel, or use the `+` / `−` buttons (bottom-right)
- **Move nodes** — click and drag any table or enum box
- **Inspect** — click a table to open the detail sidebar with full column info, constraints, indexes, and foreign keys
- **Reset view** — click the "Reset" button to restore default zoom and position

### Relationship Lines

- **Solid lines** (on hover) indicate highlighted active connections
- **Dashed lines** show foreign key relationships at rest
- **Circle** on the FK side, **arrow** on the PK side
- Hover any table to highlight only its direct relationships

---

## Project Structure

```
sql-schema-visualizer.jsx    # Single-file React application
├── parseSQL()               # SQL DDL parser (enums, tables, indexes, constraints, FKs)
├── highlightSQL()           # Token-based syntax highlighter
├── SQLEditor                # Code editor component (textarea + highlight overlay)
├── ERDiagram                # Interactive SVG diagram with drag/pan/zoom
└── App                      # Main layout with toolbar, stats, split/tab view
```

---

## Tech Stack

- **React 18** — functional components with hooks
- **SVG** — all diagram rendering (no canvas, no external libs)
- **Zero dependencies** — no diagram library, no editor library, no build-time CSS

---

## Customization

### Colors

The app uses Catppuccin Mocha palette. To change colors, modify the constants at the top of the file:

- `TOKEN_COLORS` — syntax highlighting colors
- `TABLE_COLORS` — table header colors in the diagram
- Background colors are inline (`#11111b`, `#1e1e2e`, `#181825`, `#313244`)

### Layout

- `TABLE_W` — table card width (default: 290px)
- `COL_H` — row height per column (default: 26px)
- `HEADER_H` — table header height (default: 38px)
- Grid column count is set in `layoutPositions()` (default: 4 columns)

---

## License

MIT
