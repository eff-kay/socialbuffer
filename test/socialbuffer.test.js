import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../bin/socialbuffer.js", import.meta.url).pathname;
const examplePath = new URL("../example-post.md", import.meta.url).pathname;

test("dry-run recognizes a remote image without publishing", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      cliPath,
      "post",
      "--file",
      examplePath,
      "--image-url",
      "https://example.com/benchmark.png",
      "--alt",
      "Benchmark results",
      "--dry-run",
    ],
    { env: { ...process.env, BUFFER_X_CHANNEL_ID: "test-channel" } },
  );

  assert.equal(JSON.parse(stdout).hasAssets, true);
});

test("an explicit env file wins over a project-local fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "socialbuffer-env-"));
  const explicitEnv = join(directory, "explicit.env");

  try {
    await writeFile(explicitEnv, "BUFFER_X_CHANNEL_ID=explicit-channel\n");
    await writeFile(join(directory, ".env"), "BUFFER_X_CHANNEL_ID=project-channel\n");
    const env = { ...process.env, SOCIALBUFFER_ENV_FILE: explicitEnv };
    delete env.BUFFER_X_CHANNEL_ID;
    delete env.BUFFER_CHANNEL_ID;

    const { stdout } = await execFileAsync(
      process.execPath,
      [cliPath, "post", "--file", examplePath, "--dry-run"],
      { cwd: directory, env },
    );

    assert.equal(JSON.parse(stdout).channelId, "explicit-channel");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("custom scheduling requires and preserves a due date", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      cliPath,
      "post",
      "--file",
      examplePath,
      "--mode",
      "customScheduled",
      "--due-at",
      "2026-09-14T09:00:00-04:00",
      "--dry-run",
    ],
    { env: { ...process.env, BUFFER_X_CHANNEL_ID: "test-channel" } },
  );

  assert.equal(JSON.parse(stdout).dueAt, "2026-09-14T09:00:00-04:00");

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [cliPath, "post", "--file", examplePath, "--mode", "customScheduled", "--dry-run"],
      { env: { ...process.env, BUFFER_X_CHANNEL_ID: "test-channel" } },
    ),
    /--due-at is required/,
  );
});
