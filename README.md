# Mycel

Mycel is a calm, local-first desktop writing app by **Valenx** (GitHub: [@VaIenx](https://github.com/VaIenx)). It helps novelists write chapters, develop characters and places, collect world knowledge, and follow their writing progress. Manuscripts stay in ordinary Markdown files on your computer.

## Features

- Write and organize chapters by volume, status, and order.
- Build character profiles with roles, aliases, descriptions, portraits, and relationships.
- Organize places by category and hierarchy, with images and descriptions.
- Create flexible knowledge entries for races, religions, magic, objects, and more.
- Link characters, places, and knowledge automatically when their names or aliases appear in the manuscript.
- Connect knowledge entries to characters, places, and other entries.
- Track manuscript word counts, daily writing, and progress toward a word goal.
- Search the whole project and replace text throughout the manuscript.
- Open and continue a project from its local folder.

## Start

Install [Node.js](https://nodejs.org/) 22.12 or newer, then run from the project folder:

```sh
npm install
npm start
```

On Linux, build Mycel as a standalone desktop app:

```sh
npm run build:linux
```

The runnable app folder and desktop entry are created in `dist/Mycel-linux-x64`. The desktop shortcut opens Mycel directly without `npm start`.

## Demo project

`Mycel-Testprojekt` includes sample chapters, linked characters, hierarchical places with images, and connected knowledge entries. Open the folder in Mycel to explore these features.

## Ideas for future extensions

- Plan scenes with a point of view, purpose, and short summary.
- Keep chapter snapshots so earlier drafts can be compared or restored.
- Export a manuscript to DOCX, PDF, or EPUB with configurable formatting.
- Reorder chapters and scenes directly in the outline.
- Add project backups with a simple restore flow.

## Project files

Choose a parent folder when creating a project. Mycel creates a project folder with this structure:

```text
My Novel/
├── Chapters/             One Markdown file per chapter
├── Characters/           One Markdown profile per character
│   └── images/           Portraits selected in Mycel
├── Places/               One Markdown profile per place
│   └── images/           Place images selected in Mycel
├── Knowledge/            One Markdown profile per knowledge entry
└── .mycel/
    └── project.json      Organization, profiles, goal, and daily totals
```

Chapter text, character profiles, places, and knowledge entries remain readable and editable outside Mycel. The small `.mycel/project.json` file stores organization and progress data; it does not contain the manuscript text. Back up the whole project folder to preserve a project.

## Development

The desktop app uses Electron and plain HTML, CSS, and JavaScript. See [BUILDING.md](BUILDING.md) for the source layout and development commands.

## Privacy

Mycel works with local folders and does not require an account. It does not upload manuscript content. Project files stay on your computer unless you move or sync them yourself.

## License

Mycel is distributed under the [MIT License](LICENSE).
