import { readFile } from "node:fs/promises";

/**
 * Refuse to run a browser suite against a build that is not the one on disk.
 *
 * This exists because of the most dangerous failure this project has hit. A mutation run rebuilt
 * the app, restarted the server, and the suite reported 20/20 — against the *previous* build. The
 * new `npm start` had died with EADDRINUSE because the old server still held port 3000, and nothing
 * anywhere said so. The suite drove a stale binary and produced a plausible, wrong number.
 *
 * Detecting that by reading the start log afterwards depends on somebody remembering to look, which
 * is exactly the property a verification harness must not have. So the check is a precondition: the
 * build id Next writes to `.next/BUILD_ID` must appear in the HTML the running server actually
 * serves. If a different build is answering — a stale server, a server someone else started, a
 * rebuild that never happened — the ids differ and the suite refuses to start.
 *
 * It catches strictly more than a port check would: "I forgot to rebuild" fails here too, and that
 * is the same class of mistake with the same symptom.
 *
 * Call it before opening a browser:
 *
 *     import { assertFreshBuild } from "./assert-fresh-build.mjs";
 *     await assertFreshBuild(BASE);
 */
export async function assertFreshBuild(baseUrl = "http://localhost:3000", probePath = "/login") {
  let expected;
  try {
    expected = (await readFile(".next/BUILD_ID", "utf8")).trim();
  } catch {
    throw new Error(
      "STALE BUILD CHECK: .next/BUILD_ID is missing. Run `npm run build` before a browser suite — " +
        "these suites drive a production build, not the dev server.",
    );
  }

  let html;
  try {
    const res = await fetch(`${baseUrl}${probePath}`, { redirect: "follow" });
    html = await res.text();
  } catch (e) {
    throw new Error(
      `STALE BUILD CHECK: nothing is serving ${baseUrl}. Start it with ` +
        `\`setsid nohup npm start > start.log 2>&1 < /dev/null &\` and wait for it to answer. (${e.message})`,
    );
  }

  if (!html.includes(expected)) {
    throw new Error(
      `STALE BUILD CHECK FAILED.\n\n` +
        `  .next/BUILD_ID on disk : ${expected}\n` +
        `  the server on ${baseUrl} is serving a DIFFERENT build.\n\n` +
        `The usual cause is that an older \`npm start\` still holds the port, so the one you just\n` +
        `launched exited with EADDRINUSE and you are driving the previous build. Stop every running\n` +
        `server (\`pkill -f next-server\`), confirm the port is free, start again, and re-run.\n\n` +
        `Refusing to continue: a suite that runs against a stale build reports a number that looks\n` +
        `real and means nothing.`,
    );
  }
}
