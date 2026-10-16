# Mycel

Mycel is a calm, local-first desktop writing app by **Valenx** (GitHub: [@VaIenx](https://github.com/VaIenx)). It helps novelists write chapters, manage characters, and follow their writing progress. Manuscripts stay in ordinary Markdown files on your computer.

## Features

- Write and organize chapters by volume, status, and order.
- Build character profiles with roles, aliases, descriptions, portraits, and relationships.
- Link character names in the manuscript to their profiles.
- Track manuscript word counts, daily writing, and progress toward a word goal.
- Open and continue a project from its local folder.

## Start

Install [Node.js](https://nodejs.org/) 22.12 or newer, then run from the project folder:

```sh
npm install
npm start
```

## Project files

Choose a parent folder when creating a project. Mycel creates a project folder with this structure:

```text
My Novel/
├── Chapters/             One Markdown file per chapter
├── Characters/           One Markdown profile per character
│   └── images/           Portraits selected in Mycel
└── .mycel/
    └── project.json      Order, status, character details, goal, daily totals
```

Chapter text and character profiles remain readable and editable outside Mycel. The small `.mycel/project.json` file stores organization and progress data; it does not contain the manuscript text. Back up the whole project folder to preserve a project.

## Development

The desktop app uses Electron and plain HTML, CSS, and JavaScript. See [BUILDING.md](BUILDING.md) for the source layout and development commands.

## Privacy

Mycel works with local folders and does not require an account. It does not upload manuscript content. Project files stay on your computer unless you move or sync them yourself.

## License

Mycel is distributed under the [MIT License](LICENSE).
