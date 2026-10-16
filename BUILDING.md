# Build and run Mycel

Mycel is an Electron desktop application. Its interface is built from `index.html`, `styles.css`, and `renderer.js`; `main.cjs` owns the desktop window and local project files; `preload.cjs` exposes the limited, explicit bridge used by the interface.

## Requirements

- Node.js 22.12 or newer
- npm

## Run in development

```sh
npm install
npm start
```

`npm start` opens the desktop application through Electron. No build step is needed for the current source layout.

## Package layout

| File | Purpose |
| --- | --- |
| `main.cjs` | Electron main process, project folders, Markdown files, and metadata |
| `preload.cjs` | Secure IPC bridge between the app and its interface |
| `index.html` | Application shell and navigation |
| `renderer.js` | Chapters, writing, characters, relationships, and progress views |
| `styles.css` | Mycel's warm, paper-like desktop interface |
| `package.json` | App metadata and start command |

Project data is written to the folder chosen by the user. Mycel does not keep manuscript text in an application database.
