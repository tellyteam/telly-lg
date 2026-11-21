// Turns dist-tizen into an installable Samsung TV package (.wgt) in build-tizen/: adds config.xml
// (with the version from package.json) and the icon, then signs and packs it with Tizen Studio's
// `tizen` command, using your Samsung certificate profile (TIZEN_PROFILE, "telly" by default).
// SAMSUNG.md says how to make the profile and put the package on a TV.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const config = readFileSync("tizen/config.xml", "utf8").replace(/(<widget[^>]*\sversion=")[^"]*"/, `$1${version}"`);
writeFileSync("dist-tizen/config.xml", config);
copyFileSync("tizen/icon.png", "dist-tizen/icon.png");

const studio = process.env.TIZEN_STUDIO ?? join(homedir(), "tizen-studio");
const cli = join(studio, "tools", "ide", "bin", "tizen");
if (!existsSync(cli)) {
  console.error(`\ndist-tizen is built, but Tizen Studio's tizen command isn't at ${cli}, so it can't be signed and packed.`);
  console.error("Install Tizen Studio (or set TIZEN_STUDIO to where it is): see SAMSUNG.md.");
  process.exit(1);
}

const profile = process.env.TIZEN_PROFILE ?? "telly";
mkdirSync("build-tizen", { recursive: true });
const out = join("build-tizen", `telly_${version}.wgt`);
rmSync(join("build-tizen", "telly.wgt"), { force: true });
// Absolute paths: the tizen command resolves relative ones against its own folder.
execFileSync(cli, ["package", "-t", "wgt", "-s", profile, "-o", resolve("build-tizen"), "--", resolve("dist-tizen")], { stdio: "inherit" });
renameSync(join("build-tizen", "telly.wgt"), out);
console.log(`\n${out}`);
