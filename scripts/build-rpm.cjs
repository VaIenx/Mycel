const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const packageInfo = require(path.join(root, "package.json"));
const appDirectory = path.join(root, "dist", "Mycel-linux-x64");
const specTemplate = path.join(root, "packaging", "mycel.spec.in");
const outputDirectory = path.join(root, "dist");

async function build() {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("Der RPM-Build ist für Linux x64 vorgesehen.");

  execFileSync(
    process.execPath,
    [path.join(root, "scripts", "build-linux.cjs")],
    {
      stdio: "inherit",
    },
  );

  const topDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mycel-rpm-"));
  const sourceDirectory = path.join(topDirectory, "SOURCES", "Mycel-linux-x64");
  const specFile = path.join(topDirectory, "SPECS", "mycel.spec");
  const template = await fs.readFile(specTemplate, "utf8");

  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.mkdir(path.dirname(specFile), { recursive: true });
  await fs.cp(appDirectory, sourceDirectory, { recursive: true });
  await fs.writeFile(
    specFile,
    template.replaceAll("@VERSION@", packageInfo.version),
    "utf8",
  );

  execFileSync(
    "rpmbuild",
    [
      "-bb",
      "--define",
      `_topdir ${topDirectory}`,
      "--define",
      "_buildhost mycel-build",
      specFile,
    ],
    { stdio: "inherit" },
  );

  const rpmDirectory = path.join(topDirectory, "RPMS", "x86_64");
  const rpmFile = (await fs.readdir(rpmDirectory)).find((file) =>
    file.endsWith(".rpm"),
  );
  if (!rpmFile) throw new Error("rpmbuild hat keine RPM-Datei erzeugt.");

  const output = path.join(outputDirectory, rpmFile);
  await fs.copyFile(path.join(rpmDirectory, rpmFile), output);
  await fs.rm(topDirectory, { recursive: true, force: true });
  process.stdout.write(`RPM erstellt: ${output}\n`);
}

build().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
