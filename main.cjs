const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

let windowRef;
let projectRoot = "";
const projectFile = ".mycel/project.json";

function insideProject(...parts) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Invalid project path");
  return target;
}

function localDateKey() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

async function readProject() {
  if (!projectRoot) return null;
  let metadata = {};
  try {
    metadata = JSON.parse(
      await fs.readFile(insideProject(projectFile), "utf8"),
    );
  } catch {
    metadata = {};
  }
  const chaptersDir = insideProject("Chapters");
  const charactersDir = insideProject("Characters");
  const placesDir = insideProject("Places");
  await fs.mkdir(chaptersDir, { recursive: true });
  await fs.mkdir(charactersDir, { recursive: true });
  await fs.mkdir(placesDir, { recursive: true });
  await fs.mkdir(insideProject(".mycel"), { recursive: true });
  const chapters = [];
  const characters = [];
  const places = [];
  for (const [folder, into, kind] of [
    ["Chapters", chapters, "chapter"],
    ["Characters", characters, "character"],
    ["Places", places, "place"],
  ]) {
    const files = (
      await fs.readdir(insideProject(folder), { withFileTypes: true })
    )
      .filter(
        (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    for (const file of files) {
      const id = path.basename(file.name, ".md");
      const storedBody = await fs.readFile(
        insideProject(folder, file.name),
        "utf8",
      );
      const body = storedBody.replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        (_link, target, display) =>
          display || path.basename(target).replace(/\.md$/i, ""),
      );
      const record = { ...((metadata[kind + "s"] || {})[id] || {}) };
      if (kind === "character") {
        const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
        if (frontmatter) {
          const field = (name) =>
            frontmatter[1].match(
              new RegExp("^" + name + ":\\s*(.*)$", "m"),
            )?.[1] || "";
          const parse = (value, fallback = "") => {
            try {
              return JSON.parse(value);
            } catch {
              return value || fallback;
            }
          };
          record.name ||= parse(field("name"), id);
          record.role ||= parse(field("role"), "Nebenfigur");
          const aliases = parse(field("aliases"), []);
          record.aliases ||= Array.isArray(aliases)
            ? aliases
            : String(aliases)
                .split(/[;,]/)
                .map((alias) => alias.trim())
                .filter(Boolean);
          record.image ||= parse(field("image"), "");
          record.color ||= parse(field("color"), "");
          record.traits ||= parse(field("traits"), "");
          record.relationships ||= parse(field("relationships"), []);
          record.description ||= body.slice(frontmatter[0].length).trim();
        }
        if (record.image && !String(record.image).startsWith("file:"))
          record.image = pathToFileURL(
            insideProject(...String(record.image).split("/")),
          ).href;
      }
      if (kind === "place") {
        const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
        if (frontmatter) {
          const field = (name) =>
            frontmatter[1].match(
              new RegExp("^" + name + ":\\s*(.*)$", "m"),
            )?.[1] || "";
          const parse = (value, fallback = "") => {
            try {
              return JSON.parse(value);
            } catch {
              return value || fallback;
            }
          };
          record.name ||= parse(field("name"), id);
          const aliases = parse(field("aliases"), []);
          record.aliases ||= Array.isArray(aliases)
            ? aliases
            : String(aliases)
                .split(/[;,]/)
                .map((alias) => alias.trim())
                .filter(Boolean);
          record.category ||= parse(field("category"), "Ort");
          record.continent ||= parse(field("continent"), "");
          record.region ||= parse(field("region"), "");
          record.city ||= parse(field("city"), "");
          if (record.parent === undefined)
            record.parent = parse(field("parent"), "");
          record.color ||= parse(field("color"), "");
          record.traits ||= parse(field("traits"), "");
          record.description ||= body.slice(frontmatter[0].length).trim();
        }
        record.name ||= id;
        record.aliases ||= [];
        record.category ||= "Ort";
        record.continent ||= "";
        record.region ||= "";
        record.city ||= "";
        if (record.parent === undefined) record.parent = "";
        record.color ||= "";
        record.traits ||= "";
        record.description ||= "";
      }
      into.push({ id, file: folder + "/" + file.name, body, ...record });
    }
  }
  chapters.sort(
    (a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.id.localeCompare(b.id),
  );
  places.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return {
    name: metadata.name || path.basename(projectRoot),
    root: projectRoot,
    chapters,
    characters,
    places,
    goal: metadata.goal || 100000,
    history: metadata.history || [],
  };
}

async function writeMetadata(patch) {
  const file = insideProject(projectFile);
  await fs.mkdir(path.dirname(file), { recursive: true });
  let metadata = {};
  try {
    metadata = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    metadata = {};
  }
  Object.assign(metadata, patch);
  await fs.writeFile(file, JSON.stringify(metadata, null, 2) + "\n", "utf8");
}

function safeId(value) {
  const id = String(value || "")
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  if (!id) throw new Error("Bitte gib einen Namen ein.");
  return id;
}

function registerIpc() {
  ipcMain.handle("project:choose", async () => {
    const result = await dialog.showOpenDialog(windowRef, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    projectRoot = result.filePaths[0];
    const project = await readProject();
    return project;
  });
  ipcMain.handle("project:current", async () => readProject());
  ipcMain.handle("project:create", async (_event, name) => {
    const result = await dialog.showOpenDialog(windowRef, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const root = path.join(result.filePaths[0], safeId(name));
    await fs.mkdir(root, { recursive: true });
    projectRoot = root;
    await writeMetadata({
      name: String(name).trim(),
      goal: 100000,
      chapters: {},
      characters: {},
      history: [],
    });
    return readProject();
  });
  ipcMain.handle("chapter:save", async (_event, chapter) => {
    const id = safeId(chapter.id);
    const file = insideProject("Chapters", id + ".md");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, String(chapter.body || ""), "utf8");
    await writeMetadata({
      chapters: {
        ...(await readMetadataPart("chapters")),
        [id]: {
          title: String(chapter.title || id),
          order: Number(chapter.order) || 0,
          status: String(chapter.status || "Entwurf"),
          volume: String(chapter.volume || "Band 1"),
          target: Number(chapter.target) || 0,
          updated: new Date().toISOString(),
        },
      },
    });
    return { id, file: "Chapters/" + id + ".md" };
  });
  ipcMain.handle("chapter:delete", async (_event, idValue) => {
    const id = safeId(idValue);
    await fs.rm(insideProject("Chapters", id + ".md"), { force: true });
    const chapters = await readMetadataPart("chapters");
    delete chapters[id];
    await writeMetadata({ chapters });
    return true;
  });
  ipcMain.handle("character:save", async (_event, character) => {
    const id = safeId(character.id || character.name);
    const file = insideProject("Characters", id + ".md");
    await fs.mkdir(path.dirname(file), { recursive: true });
    let image = String(character.image || "");
    if (image.startsWith("file:")) {
      try {
        image = path
          .relative(projectRoot, fileURLToPath(image))
          .split(path.sep)
          .join("/");
      } catch {
        image = "";
      }
    }
    if (image.startsWith("../") || path.isAbsolute(image)) image = "";
    const record = {
      name: String(character.name || "").trim(),
      role: String(character.role || "Nebenfigur"),
      aliases: String(character.aliases || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
      description: String(character.description || ""),
      traits: String(character.traits || ""),
      image,
      color: /^#[0-9a-f]{6}$/i.test(String(character.color || ""))
        ? String(character.color)
        : "#d9e8ff",
      relationships: Array.isArray(character.relationships)
        ? character.relationships
            .filter((rel) => rel && rel.target && rel.type)
            .map((rel) => ({
              target: String(rel.target),
              type: String(rel.type),
            }))
        : [],
    };
    const markdown = `---
name: ${JSON.stringify(record.name)}
role: ${JSON.stringify(record.role)}
aliases: ${JSON.stringify(record.aliases)}
traits: ${JSON.stringify(record.traits)}
image: ${JSON.stringify(record.image)}
color: ${JSON.stringify(record.color)}
relationships: ${JSON.stringify(record.relationships)}
---

${record.description}
`;
    await fs.writeFile(file, markdown, "utf8");
    await writeMetadata({
      characters: { ...(await readMetadataPart("characters")), [id]: record },
    });
    return { id, file: "Characters/" + id + ".md" };
  });
  ipcMain.handle("character:choose-image", async () => {
    const result = await dialog.showOpenDialog(windowRef, {
      properties: ["openFile"],
      filters: [
        { name: "Bilder", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return "";
    const source = result.filePaths[0];
    const extension = path.extname(source).toLowerCase();
    const relative =
      "Characters/images/" +
      safeId(path.basename(source, extension)) +
      extension;
    const target = insideProject(...relative.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    return pathToFileURL(target).href;
  });
  ipcMain.handle("character:delete", async (_event, idValue) => {
    const id = safeId(idValue);
    await fs.rm(insideProject("Characters", id + ".md"), { force: true });
    const characters = await readMetadataPart("characters");
    delete characters[id];
    await writeMetadata({ characters });
    return true;
  });
  ipcMain.handle("place:save", async (_event, place) => {
    const id = safeId(place.id || place.name);
    const file = insideProject("Places", id + ".md");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const record = {
      name: String(place.name || "").trim(),
      aliases: String(place.aliases || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
      category: String(place.category || "Ort"),
      continent: String(place.continent || "").trim(),
      region: String(place.region || "").trim(),
      city: String(place.city || "").trim(),
      parent: String(place.parent || ""),
      description: String(place.description || ""),
      traits: String(place.traits || ""),
      color: /^#[0-9a-f]{6}$/i.test(String(place.color || ""))
        ? String(place.color)
        : "#d9e8ff",
    };
    const markdown = `---
name: ${JSON.stringify(record.name)}
aliases: ${JSON.stringify(record.aliases)}
category: ${JSON.stringify(record.category)}
continent: ${JSON.stringify(record.continent)}
region: ${JSON.stringify(record.region)}
city: ${JSON.stringify(record.city)}
parent: ${JSON.stringify(record.parent)}
color: ${JSON.stringify(record.color)}
traits: ${JSON.stringify(record.traits)}
---

${record.description}
`;
    await fs.writeFile(file, markdown, "utf8");
    await writeMetadata({
      places: { ...(await readMetadataPart("places")), [id]: record },
    });
    return { id, file: "Places/" + id + ".md" };
  });
  ipcMain.handle("place:delete", async (_event, idValue) => {
    const id = safeId(idValue);
    await fs.rm(insideProject("Places", id + ".md"), { force: true });
    const places = await readMetadataPart("places");
    delete places[id];
    for (const place of Object.values(places))
      if (place.parent === id) place.parent = "";
    await writeMetadata({ places });
    return true;
  });
  ipcMain.handle("project:settings", async (_event, settings) => {
    await writeMetadata({ goal: Math.max(0, Number(settings.goal) || 0) });
    return readProject();
  });
  ipcMain.handle("project:session", async (_event, entry) => {
    const history = await readMetadataPart("history");
    const today = localDateKey();
    const last = history[history.length - 1];
    if (last && last.date === today) last.words = Number(entry.words) || 0;
    else history.push({ date: today, words: Number(entry.words) || 0 });
    await writeMetadata({ history: history.slice(-365) });
    return history;
  });
}

async function readMetadataPart(key) {
  try {
    return (
      JSON.parse(await fs.readFile(insideProject(projectFile), "utf8"))[key] ||
      (key === "history" ? [] : {})
    );
  } catch {
    return key === "history" ? [] : {};
  }
}

function createWindow() {
  windowRef = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 960,
    minHeight: 650,
    backgroundColor: "#dfe7df",
    title: "Mycel",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowRef.removeMenu();
  windowRef.maximize();
  windowRef.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  app.setName("Mycel");
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
