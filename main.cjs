const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
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

function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>\"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );
}

function escapeXml(value = "") {
  return escapeHtml(value)
    .replace(/'/g, "&apos;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const source = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, "utf8");
    const compressed = file.store
      ? source
      : zlib.deflateRawSync(source, { level: 6 });
    const checksum = crc32(source);
    const method = file.store ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function manuscriptInlineRuns(text) {
  const source = String(text)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1");
  const tokenPattern =
    /(\*\*[^*]+\*\*|__[^_]+__|(?<!\*)\*[^*]+\*(?!\*)|(?<!_)_[^_]+_(?!_)|~~[^~]+~~|`[^`]+`)/g;
  return source
    .split(tokenPattern)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**"))
        return { text: part.slice(2, -2), bold: true };
      if (part.startsWith("__") && part.endsWith("__"))
        return { text: part.slice(2, -2), bold: true };
      if (part.startsWith("~~") && part.endsWith("~~"))
        return { text: part.slice(2, -2), strike: true };
      if (part.startsWith("`") && part.endsWith("`"))
        return { text: part.slice(1, -1), code: true };
      if (part.startsWith("*") && part.endsWith("*"))
        return { text: part.slice(1, -1), italic: true };
      if (part.startsWith("_") && part.endsWith("_"))
        return { text: part.slice(1, -1), italic: true };
      return { text: part };
    });
}

function manuscriptInlineText(text) {
  return manuscriptInlineRuns(text)
    .map((run) => run.text)
    .join("")
    .trim();
}

function manuscriptInlineHtml(runs) {
  return runs
    .map((run) => {
      let value = escapeHtml(run.text);
      if (run.code) value = `<code>${value}</code>`;
      if (run.bold) value = `<strong>${value}</strong>`;
      if (run.italic) value = `<em>${value}</em>`;
      if (run.strike) value = `<del>${value}</del>`;
      return value;
    })
    .join("");
}

function manuscriptBlocks(chapter) {
  const source = String(chapter.body || "")
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/\r\n?/g, "\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let listOrdered = false;
  let listStart = 1;
  let quote = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const runs = manuscriptInlineRuns(paragraph.join(" "));
    const text = runs
      .map((run) => run.text)
      .join("")
      .trim();
    if (text) blocks.push({ type: "paragraph", text, runs });
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push({
      type: "list",
      ordered: listOrdered,
      start: listStart,
      items: list,
    });
    list = [];
    listOrdered = false;
    listStart = 1;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push({
      type: "quote",
      text: manuscriptInlineText(quote.join(" ")),
      runs: manuscriptInlineRuns(quote.join(" ")),
    });
    quote = [];
  };
  const flushBlocks = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of source.split("\n")) {
    const value = line.trim();
    if (!value) {
      flushBlocks();
      continue;
    }
    if (/^(?:\*\s*){3,}$|^(?:-{3,}|_{3,})$/.test(value)) {
      flushBlocks();
      blocks.push({ type: "scene" });
      continue;
    }
    const heading = value.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushBlocks();
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: manuscriptInlineText(heading[2]),
        runs: manuscriptInlineRuns(heading[2]),
      });
      continue;
    }
    const orderedItem = value.match(/^(\d+)[.)]\s+(.+)$/);
    const unorderedItem = value.match(/^[-*+]\s+(.+)$/);
    if (orderedItem || unorderedItem) {
      const ordered = Boolean(orderedItem);
      if (list.length && ordered !== listOrdered) flushList();
      flushParagraph();
      flushQuote();
      const runs = manuscriptInlineRuns(
        ordered ? orderedItem[2] : unorderedItem[1],
      );
      if (!list.length) {
        listOrdered = ordered;
        listStart = ordered ? Number(orderedItem[1]) : 1;
      }
      list.push({
        runs,
        text: runs
          .map((run) => run.text)
          .join("")
          .trim(),
      });
      continue;
    }
    const quoteLine = value.match(/^>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(value);
  }
  flushBlocks();
  return blocks;
}

function manuscriptHtmlBlocks(chapter) {
  return manuscriptBlocks(chapter)
    .map((block) => {
      if (block.type === "paragraph")
        return `<p>${manuscriptInlineHtml(block.runs)}</p>`;
      if (block.type === "heading") {
        const level = Math.min(6, block.level + 2);
        return `<h${level}>${manuscriptInlineHtml(block.runs)}</h${level}>`;
      }
      if (block.type === "list")
        return `<${block.ordered ? "ol" : "ul"}${
          block.ordered && block.start !== 1 ? ` start="${block.start}"` : ""
        }>${block.items
          .map((item) => `<li>${manuscriptInlineHtml(item.runs)}</li>`)
          .join("")}</${block.ordered ? "ol" : "ul"}>`;
      if (block.type === "quote")
        return `<blockquote><p>${manuscriptInlineHtml(block.runs)}</p></blockquote>`;
      return '<div class="scene-break" role="separator" aria-label="Szenenwechsel">✦</div>';
    })
    .join("");
}

function exportDocumentHtml(title, chapters) {
  const content = chapters
    .map(
      (chapter, index) =>
        `<section class="chapter${index ? " next" : ""}"><h2>${escapeHtml(chapter.title || chapter.id)}</h2>${manuscriptHtmlBlocks(chapter)}</section>`,
    )
    .join("");
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4; margin: 23mm 24mm; }
      body { color: #222; font: 11pt Georgia, serif; line-height: 1.6; }
      h1 { margin: 35vh 0 0; font-size: 28pt; text-align: center; page-break-after: always; }
      h2 { margin: 0 0 1.5em; font-size: 18pt; page-break-before: always; page-break-after: avoid; }
      .chapter:first-of-type h2 { page-break-before: auto; }
      h3, h4, h5, h6 { margin: 1.4em 0 0.5em; page-break-after: avoid; }
      p { margin: 0 0 1em; text-align: justify; orphans: 3; widows: 3; }
      ol, ul { margin: 0 0 1em; padding-left: 1.5em; }
      li { margin: 0.3em 0; }
      blockquote { margin: 1em 2em; font-style: italic; }
      code { font-family: Consolas, monospace; }
      .scene-break { margin: 1.6em 0; text-align: center; letter-spacing: 0.5em; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    ${content}
  </body>
</html>`;
}

function wordXml(text) {
  return String(text)
    .split(/\r?\n/)
    .map(
      (line, index) =>
        `${index ? "<w:r><w:br/></w:r>" : ""}<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`,
    )
    .join("");
}

function wordRun(text, properties = "") {
  return `<w:r>${properties}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function wordInlineXml(runs, italic = false) {
  return runs
    .map((run) => {
      const properties = [];
      if (run.bold) properties.push("<w:b/>");
      if (run.italic || italic) properties.push("<w:i/>");
      if (run.strike) properties.push("<w:strike/>");
      if (run.code)
        properties.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
      const format = properties.length
        ? `<w:rPr>${properties.join("")}</w:rPr>`
        : "";
      return `<w:r>${format}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
    })
    .join("");
}

function wordBlock(block) {
  if (block.type === "paragraph")
    return `<w:p>${wordInlineXml(block.runs)}</w:p>`;
  if (block.type === "heading") {
    const style = `Heading${Math.min(6, block.level + 1)}`;
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>
      ${wordInlineXml(block.runs)}
    </w:p>`;
  }
  if (block.type === "list")
    return block.items
      .map((item, index) => {
        const marker = block.ordered ? `${block.start + index}. ` : "• ";
        return `<w:p><w:pPr><w:ind w:left="420" w:hanging="240"/></w:pPr>
          ${wordInlineXml([{ text: marker }, ...item.runs])}
        </w:p>`;
      })
      .join("");
  if (block.type === "quote")
    return `<w:p><w:pPr><w:ind w:left="720" w:right="360"/></w:pPr>
      ${wordInlineXml(block.runs, true)}
    </w:p>`;
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>
    ${wordRun("✦")}
  </w:p>`;
}

function createDocx(title, chapters) {
  const paragraphs = [
    `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${wordXml(title)}</w:p>`,
    ...chapters.flatMap((chapter) => [
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${wordXml(chapter.title || chapter.id)}</w:p>`,
      ...manuscriptBlocks(chapter).map(wordBlock),
    ]),
  ].join("");
  const headingStyles = [2, 3, 4, 5, 6]
    .map((level) => {
      const size = Math.max(20, 30 - level * 2);
      return `<w:style w:type="paragraph" w:styleId="Heading${level}">
  <w:name w:val="heading ${level}"/>
  <w:basedOn w:val="Normal"/>
  <w:next w:val="Normal"/>
  <w:qFormat/>
  <w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr>
  <w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/></w:pPr>
</w:style>`;
    })
    .join("");
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="22"/></w:rPr>
    <w:pPr><w:spacing w:after="180" w:line="360" w:lineRule="auto"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="36"/></w:rPr>
    <w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="30"/></w:rPr>
    <w:pPr><w:pageBreakBefore/><w:keepNext/><w:spacing w:after="300"/></w:pPr>
  </w:style>
  ${headingStyles}
</w:styles>`;
  return createZip([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: "word/document.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1304" w:right="1361" w:bottom="1304" w:left="1361" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      name: "word/styles.xml",
      content: styles,
    },
  ]);
}

function createEpub(title, chapters) {
  const chapterFiles = chapters.map((chapter, index) => {
    const fileName = `chapter-${index + 1}.xhtml`;
    return {
      name: `OEBPS/${fileName}`,
      content: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="de">
  <head>
    <title>${escapeHtml(chapter.title || chapter.id)}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <h1>${escapeHtml(chapter.title || chapter.id)}</h1>
    ${manuscriptHtmlBlocks(chapter)}
  </body>
</html>`,
      title: chapter.title || chapter.id,
      fileName,
    };
  });
  const manifest = chapterFiles
    .map(
      (chapter, index) =>
        `<item id="chapter-${index + 1}" href="${chapter.fileName}" media-type="application/xhtml+xml"/>`,
    )
    .join("");
  const spine = chapterFiles
    .map((_, index) => `<itemref idref="chapter-${index + 1}"/>`)
    .join("");
  const nav = chapterFiles
    .map(
      (chapter) =>
        `<li><a href="${chapter.fileName}">${escapeHtml(chapter.title)}</a></li>`,
    )
    .join("");
  return createZip([
    {
      name: "mimetype",
      content: "application/epub+zip",
      store: true,
    },
    {
      name: "META-INF/container.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    },
    {
      name: "OEBPS/content.opf",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="de">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:mycel:${Date.now()}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>de</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
    ${manifest}
  </manifest>
  <spine><itemref idref="title"/>${spine}</spine>
</package>`,
    },
    {
      name: "OEBPS/title.xhtml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="de">
  <head>
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body><h1>${escapeHtml(title)}</h1></body>
</html>`,
    },
    {
      name: "OEBPS/nav.xhtml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="de">
  <head><title>Inhalt</title></head>
  <body>
    <nav epub:type="toc"><h1>Inhalt</h1><ol>${nav}</ol></nav>
  </body>
</html>`,
    },
    {
      name: "OEBPS/style.css",
      content: `body { font-family: Georgia, serif; line-height: 1.6; margin: 5%; }
h1 { font-size: 1.5em; margin: 0 0 1.5em; }
h2, h3, h4, h5, h6 { page-break-after: avoid; }
p { margin: 0 0 1em; text-align: justify; }
ol, ul { margin: 0 0 1em; padding-left: 1.5em; }
li { margin: 0.3em 0; }
blockquote { margin: 1em 2em; font-style: italic; }
code { font-family: Consolas, monospace; }
.scene-break { margin: 1.6em 0; text-align: center; letter-spacing: 0.5em; }`,
    },
    ...chapterFiles,
  ]);
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
      if (kind === "chapter") record.pov ||= "";
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
    timelineEvents: Array.isArray(metadata.timelineEvents)
      ? metadata.timelineEvents
      : [],
    editorMarks: Array.isArray(metadata.editorMarks)
      ? metadata.editorMarks
      : [],
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
          pov: String(chapter.pov || "").trim(),
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
    const editorMarks = await readMetadataPart("editorMarks");
    await writeMetadata({
      chapters,
      editorMarks: (Array.isArray(editorMarks) ? editorMarks : []).filter(
        (mark) => mark.chapterId !== id,
      ),
    });
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
              history: Array.isArray(rel.history)
                ? rel.history
                    .filter((item) => item && item.chapterId && item.note)
                    .map((item) => ({
                      chapterId: String(item.chapterId),
                      note: String(item.note),
                    }))
                : [],
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
        history: relation.history,
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
  ipcMain.handle("timeline:save", async (_event, eventValues) => {
    const project = await readProject();
    const chapterIds = new Set(project.chapters.map((chapter) => chapter.id));
    const timelineEvents = (Array.isArray(eventValues) ? eventValues : [])
      .filter((event) => event && event.title)
      .map((event, index) => ({
        id: safeId(event.id || `event-${Date.now()}-${index}`),
        title: String(event.title).trim(),
        when: String(event.when || "").trim(),
        description: String(event.description || ""),
        chapterId: chapterIds.has(String(event.chapterId || ""))
          ? String(event.chapterId)
          : "",
        order: Number.isFinite(Number(event.order))
          ? Number(event.order)
          : index,
      }));
    await writeMetadata({ timelineEvents });
    return readProject();
  });
  ipcMain.handle("editor-marks:save", async (_event, markValues) => {
    const project = await readProject();
    const chapterIds = new Set(project.chapters.map((chapter) => chapter.id));
    const editorMarks = (Array.isArray(markValues) ? markValues : [])
      .filter((mark) => mark && chapterIds.has(String(mark.chapterId || "")))
      .map((mark, index) => ({
        id: safeId(mark.id || `mark-${Date.now()}-${index}`),
        type: mark.type === "question" ? "question" : "note",
        chapterId: String(mark.chapterId),
        start: Math.max(0, Math.floor(Number(mark.start) || 0)),
        end: Math.max(0, Math.floor(Number(mark.end) || 0)),
        quote: String(mark.quote || "").slice(0, 2000),
        note: String(mark.note || "").slice(0, 10000),
        contextBefore: String(mark.contextBefore || "").slice(-80),
        contextAfter: String(mark.contextAfter || "").slice(0, 80),
        resolved: mark.type === "question" && Boolean(mark.resolved),
        createdAt: String(mark.createdAt || new Date().toISOString()),
      }))
      .filter((mark) => mark.end >= mark.start && mark.quote && mark.note);
    await writeMetadata({ editorMarks });
    return readProject();
  });
  ipcMain.handle("manuscript:export", async (_event, options = {}) => {
    const project = await readProject();
    const format = String(options.format || "pdf").toLowerCase();
    if (!["docx", "pdf", "epub"].includes(format))
      throw new Error("Unbekanntes Exportformat.");
    const chapters = project.chapters
      .map((chapter) => ({ ...chapter, title: chapter.title || chapter.id }))
      .sort(
        (left, right) =>
          (left.order ?? 9999) - (right.order ?? 9999) ||
          left.id.localeCompare(right.id),
      );
    if (!chapters.length) throw new Error("Das Projekt enthält keine Kapitel.");
    const title = String(options.title || project.name).trim() || project.name;
    const extension = format;
    const result = await dialog.showSaveDialog(windowRef, {
      title: "Manuskript exportieren",
      defaultPath: path.join(projectRoot, `${safeId(title)}.${extension}`),
      filters: [
        {
          name: format.toUpperCase(),
          extensions: [extension],
        },
      ],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    if (format === "pdf") {
      const printWindow = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true },
      });
      const temporaryHtmlPath = path.join(
        app.getPath("temp"),
        `mycel-export-${process.pid}-${Date.now()}.html`,
      );
      try {
        await fs.writeFile(
          temporaryHtmlPath,
          exportDocumentHtml(title, chapters),
          "utf8",
        );
        await printWindow.loadFile(temporaryHtmlPath);
        const pdf = await printWindow.webContents.printToPDF({
          pageSize: "A4",
          printBackground: true,
          margins: { top: 0.9, right: 0.9, bottom: 0.9, left: 0.9 },
        });
        await fs.writeFile(result.filePath, pdf);
      } finally {
        printWindow.close();
        await fs.rm(temporaryHtmlPath, { force: true });
      }
    } else {
      const archive =
        format === "docx"
          ? createDocx(title, chapters)
          : createEpub(title, chapters);
      await fs.writeFile(result.filePath, archive);
    }
    return { path: result.filePath };
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
