const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageName = "Mycel-linux-x64";
const output = path.join(root, "dist", packageName);
const electronDist = path.join(root, "node_modules", "electron", "dist");
const appDirectory = path.join(output, "resources", "app");

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function build() {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("Dieser Build ist für Linux x64 vorgesehen.");
  if (!(await exists(electronDist)))
    throw new Error(
      "Electron fehlt. Installiere zuerst die Projektabhängigkeiten.",
    );
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.cp(electronDist, output, { recursive: true });
  await fs.mkdir(appDirectory, { recursive: true });

  for (const file of [
    "main.cjs",
    "preload.cjs",
    "renderer.js",
    "index.html",
    "styles.css",
    "mycel.png",
    "mycel-icon.svg",
    "package.json",
    "LICENSE",
  ]) {
    await fs.copyFile(path.join(root, file), path.join(appDirectory, file));
  }

  const launcher = path.join(output, "Mycel");
  await fs.writeFile(
    launcher,
    '#!/bin/sh\nAPP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$APP_DIR/electron" "$APP_DIR/resources/app" "$@"\n',
    "utf8",
  );
  await fs.chmod(launcher, 0o755);

  const desktopEntry = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Mycel",
    "Comment=Lokaler Schreibraum für Romane",
    `Exec=${launcher}`,
    `Icon=${path.join(appDirectory, "mycel.png")}`,
    "Terminal=false",
    "Categories=Office;",
    "StartupWMClass=Mycel",
    "",
  ].join("\n");
  await fs.writeFile(path.join(output, "Mycel.desktop"), desktopEntry, "utf8");
  await fs.chmod(path.join(output, "Mycel.desktop"), 0o755);
  process.stdout.write(`Mycel wurde gebaut: ${output}\n`);
}

build().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
