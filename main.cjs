const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

let windowRef;
let projectRoot = "";
const projectFile = ".mycel/project.json";

function recentProjectsFile() {
  return path.join(app.getPath("userData"), "recent-projects.json");
}

async function readRecentProjects() {
  try {
    const saved = JSON.parse(await fs.readFile(recentProjectsFile(), "utf8"));
    const projects = [];
    for (const item of saved) {
      try {
        const stat = await fs.stat(item.root);
        if (!stat.isDirectory()) continue;
        let metadata = {};
        try {
          metadata = JSON.parse(
            await fs.readFile(path.join(item.root, projectFile), "utf8"),
          );
        } catch {}
        projects.push({
          root: item.root,
          name: metadata.name || path.basename(item.root),
        });
      } catch {}
    }
    const recent = projects.slice(0, 8);
    await fs.writeFile(
      recentProjectsFile(),
      JSON.stringify(recent, null, 2) + "\n",
      "utf8",
    );
    return recent;
  } catch {
    return [];
  }
}

async function rememberProject(root, name) {
  const recent = await readRecentProjects();
  const projects = [
    { root, name },
    ...recent.filter((project) => project.root !== root),
  ].slice(0, 8);
  await fs.mkdir(path.dirname(recentProjectsFile()), { recursive: true });
  await fs.writeFile(
    recentProjectsFile(),
    JSON.stringify(projects, null, 2) + "\n",
    "utf8",
  );
}

async function forgetProject(root) {
  const recent = await readRecentProjects();
  const projects = recent.filter((project) => project.root !== root);
  await fs.writeFile(
    recentProjectsFile(),
    JSON.stringify(projects, null, 2) + "\n",
    "utf8",
  );
  return projects;
}

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
  const knowledgeDir = insideProject("Knowledge");
  const mediaDir = insideProject("Media");
  await fs.mkdir(chaptersDir, { recursive: true });
  await fs.mkdir(charactersDir, { recursive: true });
  await fs.mkdir(placesDir, { recursive: true });
  await fs.mkdir(knowledgeDir, { recursive: true });
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.mkdir(insideProject(".mycel"), { recursive: true });
  const chapters = [];
  const characters = [];
  const places = [];
  const knowledge = [];
  for (const [folder, into, kind] of [
    ["Chapters", chapters, "chapter"],
    ["Characters", characters, "character"],
    ["Places", places, "place"],
    ["Knowledge", knowledge, "knowledge"],
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
      const collection = kind === "knowledge" ? "knowledge" : kind + "s";
      const record = { ...((metadata[collection] || {})[id] || {}) };
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
          record.notes ||= parse(field("notes"), "");
          record.relationships ||= parse(field("relationships"), []);
          record.wikiSections ||= parse(field("wikiSections"), []);
          record.description ||= body.slice(frontmatter[0].length).trim();
        }
        record.image = await mediaImageUrl(record.image);
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
          record.image ||= parse(field("image"), "");
          record.color ||= parse(field("color"), "");
          record.traits ||= parse(field("traits"), "");
          record.wikiSections ||= parse(field("wikiSections"), []);
          record.description ||= body.slice(frontmatter[0].length).trim();
        }
        record.name ||= id;
        record.aliases ||= [];
        record.category ||= "Ort";
        record.continent ||= "";
        record.region ||= "";
        record.city ||= "";
        record.image ||= "";
        record.color ||= "";
        record.traits ||= "";
        record.wikiSections ||= [];
        record.description ||= "";
        record.image = await mediaImageUrl(record.image);
      }
      if (kind === "knowledge") {
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
          record.category ||= parse(field("category"), "Allgemein");
          const aliases = parse(field("aliases"), []);
          record.aliases ||= Array.isArray(aliases)
            ? aliases
            : String(aliases)
                .split(/[;,]/)
                .map((alias) => alias.trim())
                .filter(Boolean);
          record.color ||= parse(field("color"), "");
          record.image ||= parse(field("image"), "");
          record.traits ||= parse(field("traits"), "");
          record.wikiSections ||= parse(field("wikiSections"), []);
          record.relationships ||= parse(field("relationships"), []);
          record.description ||= body.slice(frontmatter[0].length).trim();
        }
        record.name ||= id;
        record.category ||= "Allgemein";
        record.aliases ||= [];
        record.color ||= "";
        record.image ||= "";
        record.traits ||= "";
        record.wikiSections ||= [];
        record.relationships ||= [];
        record.description ||= "";
        record.image = await mediaImageUrl(record.image);
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
  knowledge.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return {
    name: metadata.name || path.basename(projectRoot),
    root: projectRoot,
    chapters,
    characters,
    places,
    knowledge,
    goal: metadata.goal || 100000,
    placeMap: metadata.placeMap || { image: "", markers: {} },
    chapterStatuses: metadata.chapterStatuses || [],
    chapterStatusColors: metadata.chapterStatusColors || {},
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

async function mediaImageUrl(image) {
  if (!image) return "";
  let source;
  try {
    source = String(image).startsWith("file:")
      ? fileURLToPath(image)
      : insideProject(...String(image).split("/"));
    const relativeSource = path.relative(projectRoot, source);
    if (relativeSource.startsWith("..") || path.isAbsolute(relativeSource))
      return "";
    if (relativeSource.split(path.sep)[0] === "Media")
      return pathToFileURL(source).href;
    await fs.access(source);
    const extension = path.extname(source).toLowerCase();
    if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(extension)) return "";
    const mediaDir = insideProject("Media");
    await fs.mkdir(mediaDir, { recursive: true });
    const base = safeId(
      relativeSource.slice(0, -extension.length).split(path.sep).join("-"),
    );
    const target = path.join(mediaDir, base + extension);
    if (path.resolve(target) !== path.resolve(source))
      await fs.copyFile(source, target);
    return pathToFileURL(target).href;
  } catch {
    return "";
  }
}

async function chooseProjectImage(folder) {
  const mediaDir = insideProject("Media");
  await fs.mkdir(mediaDir, { recursive: true });
  const result = await dialog.showOpenDialog(windowRef, {
    defaultPath: mediaDir,
    properties: ["openFile"],
    filters: [
      {
        name: "Bilder",
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"],
      },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return "";
  const source = result.filePaths[0];
  const extension = path.extname(source).toLowerCase();
  const base = safeId(path.basename(source, extension));
  let fileName = base + extension;
  let target = path.join(mediaDir, fileName);
  let suffix = 2;
  while (path.resolve(target) !== path.resolve(source)) {
    try {
      await fs.access(target);
      fileName = `${base}-${suffix++}${extension}`;
      target = path.join(mediaDir, fileName);
    } catch {
      break;
    }
  }
  if (path.resolve(source) !== path.resolve(target))
    await fs.copyFile(source, target);
  return pathToFileURL(target).href;
}

function registerIpc() {
  ipcMain.handle("project:choose", async () => {
    const result = await dialog.showOpenDialog(windowRef, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    projectRoot = result.filePaths[0];
    const project = await readProject();
    await rememberProject(projectRoot, project.name);
    return project;
  });
  ipcMain.handle("project:current", async () => readProject());
  ipcMain.handle("media:list", async () => {
    if (!projectRoot) return [];
    const directory = insideProject("Media");
    await fs.mkdir(directory, { recursive: true });
    const files = await fs.readdir(directory, { withFileTypes: true });
    return files
      .filter(
        (file) =>
          file.isFile() && /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name),
      )
      .map((file) => ({
        name: file.name,
        url: pathToFileURL(insideProject("Media", file.name)).href,
      }));
  });
  ipcMain.handle("project:recent", async () => readRecentProjects());
  ipcMain.handle("project:forget-recent", async (_event, root) =>
    forgetProject(root),
  );
  ipcMain.handle("project:open-recent", async (_event, root) => {
    const recent = await readRecentProjects();
    const project = recent.find((item) => item.root === root);
    if (!project) return null;
    projectRoot = project.root;
    const opened = await readProject();
    await rememberProject(projectRoot, opened.name);
    return opened;
  });
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
      knowledge: {},
      history: [],
    });
    const project = await readProject();
    await rememberProject(projectRoot, project.name);
    return project;
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
      notes: String(character.notes || ""),
      wikiSections: Array.isArray(character.wikiSections)
        ? character.wikiSections
            .filter((section) => section && section.title)
            .map((section) => ({
              title: String(section.title).trim(),
              body: String(section.body || ""),
            }))
        : [],
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
              bidirectional: Boolean(rel.bidirectional),
            }))
        : [],
    };
    const markdown = `---
name: ${JSON.stringify(record.name)}
role: ${JSON.stringify(record.role)}
aliases: ${JSON.stringify(record.aliases)}
traits: ${JSON.stringify(record.traits)}
notes: ${JSON.stringify(record.notes)}
image: ${JSON.stringify(record.image)}
color: ${JSON.stringify(record.color)}
relationships: ${JSON.stringify(record.relationships)}
wikiSections: ${JSON.stringify(record.wikiSections)}
---

${record.description}
`;
    await fs.writeFile(file, markdown, "utf8");
    const characters = await readMetadataPart("characters");
    for (const [otherId, other] of Object.entries(characters)) {
      if (otherId === id) continue;
      other.relationships = (other.relationships || []).filter(
        (relation) => relation.target !== id || !relation.bidirectional,
      );
    }
    characters[id] = record;
    for (const relation of record.relationships) {
      if (!relation.bidirectional || !characters[relation.target]) continue;
      const target = characters[relation.target];
      target.relationships = (target.relationships || []).filter(
        (item) => item.target !== id,
      );
      target.relationships.push({
        target: id,
        type: relation.type,
        bidirectional: true,
      });
    }
    await writeMetadata({ characters });
    return { id, file: "Characters/" + id + ".md" };
  });
  ipcMain.handle("character:choose-image", () =>
    chooseProjectImage("Characters"),
  );
  ipcMain.handle("place:choose-image", () => chooseProjectImage("Places"));
  ipcMain.handle("character:delete", async (_event, idValue) => {
    const id = safeId(idValue);
    await fs.rm(insideProject("Characters", id + ".md"), { force: true });
    const characters = await readMetadataPart("characters");
    delete characters[id];
    for (const character of Object.values(characters))
      character.relationships = (character.relationships || []).filter(
        (relation) => relation.target !== id,
      );
    await writeMetadata({ characters });
    return true;
  });
  ipcMain.handle("place:save", async (_event, place) => {
    const id = safeId(place.id || place.name);
    const file = insideProject("Places", id + ".md");
    await fs.mkdir(path.dirname(file), { recursive: true });
    let image = String(place.image || "");
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
      name: String(place.name || "").trim(),
      aliases: String(place.aliases || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
      category: String(place.category || "Ort"),
      continent: String(place.continent || "").trim(),
      region: String(place.region || "").trim(),
      city: String(place.city || "").trim(),
      description: String(place.description || ""),
      traits: String(place.traits || ""),
      wikiSections: Array.isArray(place.wikiSections)
        ? place.wikiSections
            .filter((section) => section && section.title)
            .map((section) => ({
              title: String(section.title).trim(),
              body: String(section.body || ""),
            }))
        : [],
      image,
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
color: ${JSON.stringify(record.color)}
traits: ${JSON.stringify(record.traits)}
image: ${JSON.stringify(record.image)}
wikiSections: ${JSON.stringify(record.wikiSections)}
---

${record.description}
`;
    await fs.writeFile(file, markdown, "utf8");
    await writeMetadata({
      places: { ...(await readMetadataPart("places")), [id]: record },
    });
    return { id, file: "Places/" + id + ".md" };
  });
  ipcMain.handle("place:map", async (_event, map) => {
    const image = await mediaImageUrl(String(map.image || ""));
    const markers = Object.fromEntries(
      Object.entries(map.markers || {})
        .filter(([id, marker]) => {
          try {
            safeId(id);
            return (
              Number.isFinite(Number(marker.x)) &&
              Number.isFinite(Number(marker.y))
            );
          } catch {
            return false;
          }
        })
        .map(([id, marker]) => [
          safeId(id),
          {
            x: Math.min(100, Math.max(0, Number(marker.x))),
            y: Math.min(100, Math.max(0, Number(marker.y))),
          },
        ]),
    );
    await writeMetadata({ placeMap: { image, markers } });
    return readProject();
  });
  ipcMain.handle("place:delete", async (_event, idValue) => {
    const id = safeId(idValue);
    await fs.rm(insideProject("Places", id + ".md"), { force: true });
    const places = await readMetadataPart("places");
    delete places[id];
    const placeMap = {
      image: "",
      markers: {},
      ...(await readMetadataPart("placeMap")),
    };
    if (placeMap.markers) delete placeMap.markers[id];
    await writeMetadata({ places, placeMap });
    return true;
  });
  ipcMain.handle("knowledge:save", async (_event, entry) => {
    const id = safeId(entry.id || entry.name);
    const file = insideProject("Knowledge", id + ".md");
    await fs.mkdir(path.dirname(file), { recursive: true });
    let image = String(entry.image || "");
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
      name: String(entry.name || "").trim(),
      category: String(entry.category || "Allgemein").trim(),
      aliases: String(entry.aliases || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
      description: String(entry.description || ""),
      traits: String(entry.traits || ""),
      image,
      wikiSections: Array.isArray(entry.wikiSections)
        ? entry.wikiSections
            .filter((section) => section && section.title)
            .map((section) => ({
              title: String(section.title).trim(),
              body: String(section.body || ""),
            }))
        : [],
      color: /^#[0-9a-f]{6}$/i.test(String(entry.color || ""))
        ? String(entry.color)
        : "#d9e8ff",
      relationships: Array.isArray(entry.relationships)
        ? entry.relationships
            .filter(
              (relation) =>
                relation &&
                ["character", "place", "knowledge"].includes(
                  relation.targetKind,
                ) &&
                relation.target &&
                relation.type,
            )
            .map((relation) => ({
              targetKind: String(relation.targetKind),
              target: String(relation.target),
              type: String(relation.type),
            }))
        : [],
    };
    const markdown = `---
name: ${JSON.stringify(record.name)}
category: ${JSON.stringify(record.category)}
aliases: ${JSON.stringify(record.aliases)}
color: ${JSON.stringify(record.color)}
traits: ${JSON.stringify(record.traits)}
relationships: ${JSON.stringify(record.relationships)}
wikiSections: ${JSON.stringify(record.wikiSections)}
image: ${JSON.stringify(record.image)}
---

${record.description}
`;
    await fs.writeFile(file, markdown, "utf8");
    await writeMetadata({
      knowledge: {
        ...(await readMetadataPart("knowledge")),
        [id]: record,
      },
    });
    return { id, file: "Knowledge/" + id + ".md" };
  });
  ipcMain.handle("knowledge:delete", async (_event, idValue) => {
    const id = safeId(idValue);
    await fs.rm(insideProject("Knowledge", id + ".md"), { force: true });
    const knowledge = await readMetadataPart("knowledge");
    delete knowledge[id];
    for (const entry of Object.values(knowledge))
      entry.relationships = (entry.relationships || []).filter(
        (relation) =>
          relation.targetKind !== "knowledge" || relation.target !== id,
      );
    await writeMetadata({ knowledge });
    return true;
  });
  ipcMain.handle("project:settings", async (_event, settings) => {
    await writeMetadata({
      goal: Math.max(0, Number(settings.goal) || 0),
      ...(Array.isArray(settings.chapterStatuses)
        ? {
            chapterStatuses: [
              ...new Set(
                settings.chapterStatuses
                  .map(String)
                  .map((status) => status.trim())
                  .filter(Boolean),
              ),
            ],
          }
        : {}),
      ...(settings.chapterStatusColors
        ? { chapterStatusColors: settings.chapterStatusColors }
        : {}),
    });
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
    icon: path.join(__dirname, "mycel.png"),
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
